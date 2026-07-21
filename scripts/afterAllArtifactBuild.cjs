/**
 * afterAllArtifactBuild.cjs — electron-builder hook (used by electron-builder.signed.cjs).
 *
 * electron-builder's built-in `mac.notarize` notarizes + staples the .app (so the
 * .app inside the updater ZIP is stapled). TWO gaps remained that this hook closes:
 *
 *  (1) electron-builder's own DMG-creation CORRUPTS the embedded app signature.
 *      Apple's notary log on the eb-built DMG reported:
 *        "The signature of the binary is invalid" @ Natively.app/Contents/MacOS/Natively
 *      Verified: the standalone .app and the .app inside the ZIP pass
 *      `codesign --verify --deep --strict`, but the .app inside the eb DMG does NOT
 *      (even after ditto-copying it back out) — so eb's DMG layout step breaks it.
 *      FIX: ignore eb's .dmg artifacts and REBUILD each DMG from the pristine signed
 *      .app using `create-dmg` (which stages via `hdiutil create -srcfolder`, a
 *      block-copy that preserves the framework `Versions/Current` symlinks +
 *      `_CodeSignature`). Proven clean: the rebuilt DMG's app passes deep verify +
 *      spctl "Notarized Developer ID".
 *
 *  (2) eb does not notarize/staple the DMG container. A downloaded DMG that isn't
 *      notarized+stapled trips Gatekeeper and needs the `xattr` workaround we're
 *      eliminating.
 *
 * Per macOS arch slice (release/mac = x64, release/mac-arm64 = arm64):
 *   1. create-dmg → styled DMG from the signed .app (signs the DMG with Developer ID)
 *   2. xcrun notarytool submit --wait
 *   3. xcrun stapler staple
 * Then re-patch each dmg's sha512/size in latest*.yml (the dmg is brand-new bytes),
 * and assert the updater ZIP manifest still matches (the updater consumes the ZIP).
 *
 * Credentials (no plaintext secrets in source): prefers App Store Connect API key
 * (CI), then Apple ID + app-specific password, then the local keychain profile
 * (APPLE_KEYCHAIN_PROFILE, e.g. `natively-notary`). No-op if none are present.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VOLNAME = 'Natively';
const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'dmg-background.png');
const VOLICON = path.resolve(__dirname, '..', 'assets', 'natively.icns');

function sha512base64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function resolveDeveloperIdIdentity() {
  if (process.env.NATIVELY_SIGN_IDENTITY) return process.env.NATIVELY_SIGN_IDENTITY;
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  try {
    const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' });
    const m = out.match(/"(Developer ID Application:[^"]+)"/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return null; // codesign step skipped if unresolved; notarization can still proceed
}

/** notarytool credential args, mirroring scripts/notarize.js precedence. null => no creds. */
function notarytoolArgs() {
  const e = process.env;
  if (e.APPLE_API_KEY && e.APPLE_API_KEY_ID && e.APPLE_API_ISSUER) {
    return ['--key', e.APPLE_API_KEY, '--key-id', e.APPLE_API_KEY_ID, '--issuer', e.APPLE_API_ISSUER];
  }
  if (e.APPLE_ID && e.APPLE_APP_SPECIFIC_PASSWORD && e.APPLE_TEAM_ID) {
    return ['--apple-id', e.APPLE_ID, '--password', e.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', e.APPLE_TEAM_ID];
  }
  if (e.APPLE_KEYCHAIN_PROFILE) {
    const a = ['--keychain-profile', e.APPLE_KEYCHAIN_PROFILE];
    if (e.APPLE_KEYCHAIN) a.push('--keychain', e.APPLE_KEYCHAIN);
    return a;
  }
  return null;
}

function patchYmlDmgHashes(outDir, dmgPaths) {
  const ymls = fs.readdirSync(outDir).filter((f) => /^latest.*\.yml$/.test(f));
  for (const dmg of dmgPaths) {
    const name = path.basename(dmg);
    const size = fs.statSync(dmg).size;
    const sha = sha512base64(dmg);
    const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(- url: ${escName}\\s*\\n\\s*sha512: )[^\\n]+(\\s*\\n\\s*size: )\\d+`);
    let matchedSomewhere = false;
    for (const yml of ymls) {
      const ymlPath = path.join(outDir, yml);
      const txt = fs.readFileSync(ymlPath, 'utf8');
      if (re.test(txt)) {
        fs.writeFileSync(ymlPath, txt.replace(re, `$1${sha}$2${size}`));
        matchedSomewhere = true;
        console.log(`[dmg-notarize] patched ${name} hash in ${yml}`);
      }
    }
    // The dmg may legitimately be absent from the manifest; warn so a future
    // electron-builder yml format change (which would silently no-match) is visible.
    if (!matchedSomewhere) {
      console.warn(`[dmg-notarize] WARNING: ${name} not found in any latest*.yml — hash NOT patched (yml format change?).`);
    }
  }
}

/**
 * Mount a DMG read-only and assert the .app inside passes `codesign --verify --deep
 * --strict` and Gatekeeper. This is the regression guard for the electron-builder
 * DMG-corruption bug: if a future DMG-build path ever breaks the embedded signature
 * again, the build FAILS here instead of shipping a non-notarizable installer.
 */
function verifyDmgAppSignature(dmgPath) {
  const attach = execFileSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-noverify'], { encoding: 'utf8' });
  const mountLine = attach.split('\n').find((l) => l.includes('/Volumes/'));
  const mount = mountLine ? mountLine.slice(mountLine.indexOf('/Volumes/')).trim() : null;
  if (!mount) throw new Error(`[dmg] could not mount ${path.basename(dmgPath)} for verification`);
  try {
    const app = fs.readdirSync(mount).find((f) => f.endsWith('.app'));
    if (!app) throw new Error(`[dmg] no .app found inside ${path.basename(dmgPath)}`);
    const appInDmg = path.join(mount, app);
    // Throws (non-zero exit) if the embedded signature is invalid — exactly the eb bug.
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appInDmg], { stdio: 'inherit' });
    // NOTE: spctl writes its "accepted / source=Notarized Developer ID" verdict to
    // STDERR, not stdout. Capture both (2>&1) or the verdict string is empty and this
    // guard false-rejects a perfectly notarized app. spctl exits non-zero only on
    // rejection, so a clean exit already means accepted; we still assert the text.
    let sp = '';
    try {
      sp = execSync(`spctl -a -t execute -vv ${JSON.stringify(appInDmg)} 2>&1`, { encoding: 'utf8' });
    } catch (e) {
      sp = `${e.stdout || ''}${e.stderr || ''}`;
      throw new Error(`[dmg] app inside ${path.basename(dmgPath)} REJECTED by Gatekeeper: ${sp.trim()}`);
    }
    if (!/Notarized Developer ID|accepted/.test(sp)) {
      throw new Error(`[dmg] app inside ${path.basename(dmgPath)} not Gatekeeper-accepted: ${sp.trim()}`);
    }
    console.log(`[dmg] verified embedded app signature + Gatekeeper inside ${path.basename(dmgPath)} ✅`);
  } finally {
    try { execFileSync('hdiutil', ['detach', mount, '-quiet'], { stdio: 'ignore' }); } catch { /* best-effort */ }
  }
}

/** Non-throwing check: is this DMG already stapled with a Gatekeeper-accepted app inside? */
function isDmgAlreadyValid(dmgPath) {
  try {
    execFileSync('xcrun', ['stapler', 'validate', dmgPath], { stdio: 'ignore' });
    verifyDmgAppSignature(dmgPath); // throws if the embedded app isn't accepted
    return true;
  } catch {
    return false;
  }
}

/**
 * Assert the updater ZIP entries in latest*.yml match the on-disk zips. The updater
 * downloads the ZIP, so a stale ZIP hash here is a real, shipping-breaking bug — fail
 * the build loudly rather than ship a broken auto-update.
 */
function verifyZipManifest(outDir) {
  const ymls = fs.readdirSync(outDir).filter((f) => /^latest.*\.yml$/.test(f));
  for (const yml of ymls) {
    const txt = fs.readFileSync(path.join(outDir, yml), 'utf8');
    const re = /- url: (\S+\.zip)\s*\n\s*sha512: ([^\n]+)\s*\n\s*size: (\d+)/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const [, name, sha, size] = m;
      const zipPath = path.join(outDir, name);
      if (!fs.existsSync(zipPath)) continue;
      const actualSha = sha512base64(zipPath);
      const actualSize = String(fs.statSync(zipPath).size);
      if (actualSha !== sha.trim() || actualSize !== size) {
        throw new Error(
          `[dmg-notarize] FATAL: ${yml} ZIP manifest mismatch for ${name} — the auto-updater would reject this build. ` +
          `yml(sha512=${sha.trim().slice(0, 12)}…,size=${size}) vs disk(sha512=${actualSha.slice(0, 12)}…,size=${actualSize}).`
        );
      }
      console.log(`[dmg-notarize] verified ZIP manifest: ${name} ✅`);
    }
  }
}

/**
 * Build a styled, Developer-ID-signed DMG from a single signed .app using create-dmg.
 * create-dmg stages via `hdiutil create -srcfolder`, preserving the app's nested
 * code signatures (unlike electron-builder's DMG layout, which corrupts them).
 * Returns the output dmg path. Throws if create-dmg is unavailable or fails.
 */
function buildStyledDmg({ appPath, outDmg, identity }) {
  // Stage ONLY the .app in an isolated temp dir so create-dmg's window contains
  // exactly [Natively.app, Applications-droplink] and nothing stray.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-dmg-'));
  const stagedApp = path.join(stage, path.basename(appPath));
  execFileSync('ditto', [appPath, stagedApp], { stdio: 'inherit' }); // ditto preserves signatures

  if (fs.existsSync(outDmg)) fs.unlinkSync(outDmg);

  const args = [
    '--volname', VOLNAME,
    '--window-pos', '200', '120',
    '--window-size', '660', '400',
    '--icon-size', '120',
    '--icon', path.basename(appPath), '170', '190',
    '--app-drop-link', '490', '190',
    '--hide-extension', path.basename(appPath),
    '--no-internet-enable',
    '--hdiutil-quiet',
  ];
  if (fs.existsSync(VOLICON)) args.push('--volicon', VOLICON);
  // Background is opt-in. assets/dmg-background.png is 2640×1600 px = 660×400 pt at 4x,
  // but create-dmg/Finder lays a non-@2x image 1:1 point-for-pixel into the 660×400-pt
  // window, so the artwork renders off-scale/mis-positioned relative to the icon/drop-link.
  // Ship the default white DMG window unless a correctly-sized background is explicitly enabled.
  if (process.env.NATIVELY_DMG_BACKGROUND === '1' && fs.existsSync(BACKGROUND)) {
    args.push('--background', BACKGROUND);
  }
  if (identity) args.push('--codesign', identity); // sign the DMG container itself
  args.push(outDmg, stage);

  try {
    // create-dmg exits 2 when it built the dmg but couldn't set the .DS_Store layout
    // (e.g. headless/no Finder); the dmg is still valid + signed, so tolerate exit 2.
    execFileSync('create-dmg', args, { stdio: 'inherit' });
  } catch (e) {
    if (e.status === 2 && fs.existsSync(outDmg)) {
      console.warn('[dmg] create-dmg exit 2 (cosmetic layout skipped) — dmg built + signed OK.');
    } else {
      throw e;
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return outDmg;
}

/** Find the signed .app for a given arch dir produced by electron-builder. */
function findAppForArch(outDir, archDir) {
  const dir = path.join(outDir, archDir);
  if (!fs.existsSync(dir)) return null;
  const app = fs.readdirSync(dir).find((f) => f.endsWith('.app'));
  return app ? path.join(dir, app) : null;
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return [];

  const ebDmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  // Nothing DMG-related and no mac apps => not our concern.
  const outDir = ebDmgs.length
    ? path.dirname(ebDmgs[0])
    : path.resolve(process.cwd(), 'release');

  const creds = notarytoolArgs();
  if (!creds) {
    console.log('[dmg] No notarization credentials in env — leaving electron-builder DMGs as-is (expected for unsigned/dev builds).');
    return [];
  }
  const identity = resolveDeveloperIdIdentity();
  if (!identity) {
    console.warn('[dmg] No Developer ID identity resolved — cannot rebuild signed DMGs. Skipping.');
    return [];
  }

  // Map electron-builder's arch output dirs to their final dmg names. eb names the
  // arm64 dmg "<name>-arm64.dmg" and the x64 dmg "<name>.dmg" (matching latest-mac.yml).
  const archMap = [
    { archDir: 'mac-arm64', suffix: '-arm64' },
    { archDir: 'mac', suffix: '' },
  ];

  const rebuiltDmgs = [];
  const version = require('../package.json').version;
  for (const { archDir, suffix } of archMap) {
    const appPath = findAppForArch(outDir, archDir);
    if (!appPath) continue;
    const dmgName = `${VOLNAME}-${version}${suffix}.dmg`;
    const outDmg = path.join(outDir, dmgName);

    // Idempotent re-run: if this DMG already exists, is stapled, and its embedded app
    // passes Gatekeeper, skip the expensive create-dmg + ~15-min notarize round-trip.
    // (Lets a re-run finish only the missing arch without re-notarizing a good one.)
    if (fs.existsSync(outDmg) && isDmgAlreadyValid(outDmg)) {
      console.log(`[dmg] ${dmgName} already built + stapled + Gatekeeper-accepted — skipping rebuild.`);
      rebuiltDmgs.push(outDmg);
      continue;
    }

    console.log(`[dmg] Rebuilding clean styled DMG for ${archDir}: ${dmgName}`);
    buildStyledDmg({ appPath, outDmg, identity });

    console.log(`[dmg] notarytool submit ${dmgName} (several minutes)…`);
    execFileSync('xcrun', ['notarytool', 'submit', outDmg, ...creds, '--wait'], { stdio: 'inherit' });
    console.log(`[dmg] stapler staple ${dmgName}`);
    execFileSync('xcrun', ['stapler', 'staple', outDmg], { stdio: 'inherit' });
    // Verify the app INSIDE the freshly built+stapled dmg before trusting it.
    verifyDmgAppSignature(outDmg);
    rebuiltDmgs.push(outDmg);
  }

  if (rebuiltDmgs.length === 0) {
    console.warn('[dmg] No mac app dirs found to rebuild DMGs from.');
    return [];
  }

  // Brand-new dmg bytes — refresh the manifest hashes, then assert the updater ZIPs.
  patchYmlDmgHashes(outDir, rebuiltDmgs);
  verifyZipManifest(outDir);
  console.log('[dmg] All DMGs rebuilt (create-dmg) + signed + notarized + stapled + verified; ZIP manifest verified.');
  return [];
};
