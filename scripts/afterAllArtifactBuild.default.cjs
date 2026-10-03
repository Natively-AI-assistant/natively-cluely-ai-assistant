// ────────────────────────────────────────────────────────────────────────────
// afterAllArtifactBuild.default.cjs — DEFAULT (ad-hoc / `npm run dist`) build hook.
//
// Builds the macOS DMG and verifies every packaged artifact has its Electron
// runtime. Wired via package.json → build.afterAllArtifactBuild. The SIGNED path
// uses its own hook (scripts/afterAllArtifactBuild.cjs) and is unaffected.
//
// WHY THIS EXISTS (v2.9.1 "cannot be opened" crash):
//   On macOS 27, electron-builder's own DMG step produced an app whose
//     Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework
//   (the framework's 191 MB main Mach-O) was MISSING — the symlink dyld loads via
//   @rpath then dangled and every launch aborted ("Library not loaded: @rpath/
//   Electron Framework…"). The staged .app and the .zip were fine; only the
//   electron-builder DMG was broken, deterministically, on both arches.
//
// THE FIX — two parts:
//   1. package.json build.mac.target drops the `dmg` target (zip only), so
//      electron-builder never runs its binary-stripping DMG step.
//   2. This hook builds the DMG itself with `hdiutil create -srcfolder`, a plain
//      block-copy that preserves the framework's Versions/Current symlinks + the
//      main binary. We deliberately do NOT use `create-dmg`: on macOS 27 its
//      Finder-AppleScript styling pass hangs on "Resource busy" at unmount and
//      leaks multi-GB scratch images. `hdiutil create` has no mount/AppleScript
//      dance, so it is robust here.
//   3. The produced DMG is mounted and verified: the framework binary must be
//      present and non-empty, AND `codesign --verify --deep` must pass. Both are
//      FATAL — an invalid signature makes macOS 27 ignore the app's entitlements and
//      SIGTRAP the main process at ElectronMain (V8 cannot set up JIT). A correctly
//      signed ad-hoc build (scripts/ad-hoc-sign.js, no post---deep re-sign) passes.
//
// CROSS-PLATFORM: the DMG build + framework check are macOS-only (behind
// platform==='darwin'). Windows has no Electron Framework bundle; its branch
// verifies the unpacked Chromium runtime (exe + core DLLs + app.asar). Unknown
// platforms are a no-op. Platform, fs, exec, DMG build, and mount/detach are all
// injected so BOTH platform branches are unit-testable from either host (never
// mutate process.platform).
// ────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');

// The framework's main binary, relative to the .app root. Absent/empty ⇒ the app
// cannot launch (the @rpath load of Electron Framework fails at dyld).
const MAC_FRAMEWORK_BINARY =
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework';
// The top-level symlink dyld actually resolves (→ Versions/Current/… → A/…). Checking
// it (existsSync follows symlinks) proves the whole chain resolves, not just the file.
const MAC_FRAMEWORK_SYMLINK =
  'Contents/Frameworks/Electron Framework.framework/Electron Framework';

// Core Chromium runtime files a Windows Electron app cannot launch without,
// relative to the unpacked app dir — the Windows analogue of the framework binary.
const WIN_REQUIRED_FILES = [
  'ffmpeg.dll',
  'libEGL.dll',
  'libGLESv2.dll',
  'vk_swiftshader.dll',
  'icudtl.dat',
  path.join('resources', 'app.asar'),
];

/** Filesystem-predicate view from a real (or fake) fs module. */
function fsView(fsImpl) {
  return {
    exists: (p) => fsImpl.existsSync(p),
    sizeOf: (p) => fsImpl.statSync(p).size,
    listDir: (p) => (fsImpl.existsSync(p) ? fsImpl.readdirSync(p) : []),
  };
}

/**
 * Problems with a macOS .app's Electron runtime. Pure: injected fs predicates in,
 * array of human-readable problem strings out (empty = healthy). No codesign here
 * (that is a separate, advisory exec check) so it is testable with fixtures alone.
 */
function macAppProblems(appPath, view) {
  const problems = [];

  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  if (!view.exists(macosDir) || view.listDir(macosDir).length === 0) {
    problems.push('Contents/MacOS has no main executable');
  }

  const bin = path.join(appPath, MAC_FRAMEWORK_BINARY);
  if (!view.exists(bin)) {
    problems.push(
      `missing Electron Framework binary (${MAC_FRAMEWORK_BINARY}) — dyld would abort at launch ` +
        'with "Library not loaded: @rpath/Electron Framework.framework/Electron Framework"'
    );
  } else if (view.sizeOf(bin) === 0) {
    problems.push(`Electron Framework binary is 0 bytes (${MAC_FRAMEWORK_BINARY})`);
  }

  // existsSync follows the symlink chain; a dangling Versions/Current also fails here.
  if (!view.exists(path.join(appPath, MAC_FRAMEWORK_SYMLINK))) {
    problems.push(
      `top-level Electron Framework symlink does not resolve (${MAC_FRAMEWORK_SYMLINK}) — the @rpath load would fail`
    );
  }

  return problems;
}

/** Problems with a Windows unpacked app dir's Chromium runtime (pure). */
function winUnpackedProblems(dir, view) {
  const problems = [];
  if (!view.listDir(dir).some((f) => f.toLowerCase().endsWith('.exe'))) {
    problems.push('no .exe (main executable) in the unpacked app dir');
  }
  for (const rel of WIN_REQUIRED_FILES) {
    if (!view.exists(path.join(dir, rel))) problems.push(`missing Electron runtime file: ${rel}`);
  }
  return problems;
}

/** Staged mac apps electron-builder leaves under <outDir>/mac[-arm64]. */
function stagedMacApps(outDir, view) {
  const apps = [];
  for (const archDir of ['mac-arm64', 'mac']) {
    const dir = path.join(outDir, archDir);
    for (const name of view.listDir(dir)) {
      if (name.endsWith('.app')) apps.push({ appPath: path.join(dir, name), archDir });
    }
  }
  return apps;
}

/** eb DMG naming: arm64 → "<name>-<version>-arm64.dmg", x64 → "<name>-<version>.dmg". */
function dmgNameFor(archDir, volname, version) {
  const suffix = archDir === 'mac-arm64' ? '-arm64' : '';
  return `${volname}-${version}${suffix}.dmg`;
}

/** Compact first-line form of an exec/error for a problem/warning message. */
function oneLine(err) {
  const s =
    `${(err && err.stderr) || ''}${(err && err.stdout) || ''}` || String((err && err.message) || err);
  return s.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').slice(0, 300);
}

/**
 * The gate/finalize logic. `deps` is fully injectable:
 *   { platform, view, outDir, version, volname,
 *     buildDmg({appPath,outDmg,volname}), attach(dmg)->mount, detach(mount),
 *     verifyCodesign(appPath)->{ok,message}, log, warn }
 * darwin: build each staged app's DMG via deps.buildDmg, then mount+verify it.
 * win32 : verify the unpacked Chromium runtime (no DMG).
 * Throws (fails the build) on any fatal problem. Returns the built DMG paths.
 */
async function runHook(buildResult, deps) {
  const { platform, view, outDir, version, volname } = deps;
  const log = deps.log || (() => {});
  const warn = deps.warn || (() => {});

  if (platform === 'darwin') {
    const staged = stagedMacApps(outDir, view);
    if (staged.length === 0) {
      warn('[verify-runtime] no staged macOS app found under the output dir — nothing to finalize.');
      return [];
    }

    // Rename staged .app bundles from "corespeechd.app" → "Natively.app"
    // BEFORE DMG creation so Finder/Dock/Spotlight show "Natively" in the DMG.
    // CFBundleDisplayName only works when it matches the folder name (Apple docs).
    for (const { appPath, archDir } of staged) {
      const disguisedPath = path.join(path.dirname(appPath), 'corespeechd.app');
      const brandPath = path.join(path.dirname(appPath), 'Natively.app');
      if (view.exists(disguisedPath) && !view.exists(brandPath)) {
        try {
          fs.renameSync(disguisedPath, brandPath);
          log(`[verify-runtime] Renamed bundle: ${disguisedPath} → ${brandPath}`);
          // Update the appPath for DMG building
          const idx = staged.findIndex(s => s.appPath === appPath);
          if (idx >= 0) staged[idx].appPath = brandPath;
        } catch (e) {
          warn(`[verify-runtime] Failed to rename bundle ${disguisedPath}: ${e.message}`);
        }
      }
    }

    const built = [];
    const problems = [];

    for (const { appPath, archDir } of staged) {
      const outDmg = path.join(outDir, dmgNameFor(archDir, volname, version));
      log(`[verify-runtime] building DMG via hdiutil: ${path.basename(outDmg)}`);
      deps.buildDmg({ appPath, outDmg, volname });
      built.push(outDmg);

      let mount;
      try {
        mount = deps.attach(outDmg);
      } catch (e) {
        problems.push(`${path.basename(outDmg)}: could not mount for verification — ${oneLine(e)}`);
        continue;
      }
      try {
        const appName = view.listDir(mount).find((f) => f.endsWith('.app'));
        if (!appName) {
          problems.push(`${path.basename(outDmg)}: no .app found inside the DMG`);
          continue;
        }
        const appInDmg = path.join(mount, appName);
        const probs = macAppProblems(appInDmg, view);
        for (const p of probs) problems.push(`${path.basename(outDmg)} → ${appName}: ${p}`);
        if (probs.length === 0) {
          // FATAL: an invalid signature (e.g. a sealed resource modified after the
          // --deep seal — see scripts/ad-hoc-sign.js) makes macOS 27 ignore the app's
          // entitlements and SIGTRAP the main process at ElectronMain (V8 cannot set up
          // JIT). A correctly signed ad-hoc build passes `codesign --verify --deep`.
          const cs = deps.verifyCodesign(appInDmg);
          if (!cs.ok) {
            problems.push(
              `${path.basename(outDmg)}: codesign --verify failed — "${cs.message}" ` +
                '(an invalid signature makes macOS 27 ignore entitlements and SIGTRAP the app at launch)'
            );
          }
        }
      } finally {
        if (mount) deps.detach(mount);
      }
    }

    if (problems.length) {
      throw new Error(
        '[verify-runtime] FATAL: a packaged macOS DMG is missing its Electron runtime:\n' +
          problems.map((p) => `  - ${p}`).join('\n') +
          '\n\nThis is the v2.9.1 "cannot be opened because of a problem" crash (dyld cannot load the ' +
          'Electron Framework). The artifact must not ship.'
      );
    }
    log(
      `[verify-runtime] OK — built + verified ${built.length} DMG(s) via hdiutil; Electron Framework present in each ✅`
    );
    return built;
  }

  if (platform === 'win32') {
    const dirs = view
      .listDir(outDir)
      .filter((n) => n.startsWith('win') && /unpacked$/.test(n))
      .map((n) => path.join(outDir, n));
    if (dirs.length === 0) {
      warn('[verify-runtime] no win-unpacked dir found to verify (skipping Windows runtime check).');
      return [];
    }
    const problems = [];
    for (const dir of dirs) {
      for (const p of winUnpackedProblems(dir, view)) problems.push(`${path.basename(dir)}: ${p}`);
    }
    if (problems.length) {
      throw new Error(
        '[verify-runtime] FATAL: a packaged Windows app is missing its Electron/Chromium runtime:\n' +
          problems.map((p) => `  - ${p}`).join('\n') +
          '\n\nThe installer would produce an app that cannot launch. The artifact must not ship.'
      );
    }
    log(`[verify-runtime] OK — ${dirs.length} Windows unpacked app(s) have the core Chromium runtime ✅`);
    return [];
  }

  return [];
}

// ─── Real (non-injected) implementations ───
function realBuildDmg({ appPath, outDmg, volname }, { fs, os, execFileSync }) {
  // Stage ONLY the .app + an /Applications drop-link in an isolated temp dir, then
  // hdiutil-create from that folder. ditto is a clonefile/CoW copy on APFS (cheap)
  // and preserves the nested code signatures + framework symlinks.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-dmg-'));
  try {
    execFileSync('ditto', [appPath, path.join(stage, path.basename(appPath))], { stdio: 'inherit' });
    execFileSync('ln', ['-s', '/Applications', path.join(stage, 'Applications')], { stdio: 'inherit' });
    if (fs.existsSync(outDmg)) fs.rmSync(outDmg, { force: true });
    // -srcfolder block-copies the tree (keeps Versions/Current symlinks + the main
    // binary); UDZO = compressed; no Finder/AppleScript styling, so no macOS-27 hang.
    execFileSync(
      'hdiutil',
      ['create', '-volname', volname, '-srcfolder', stage, '-ov', '-format', 'UDZO', outDmg],
      { stdio: 'inherit' }
    );
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function realAttach(dmgPath, execFileSync) {
  const out = execFileSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-noverify'], {
    encoding: 'utf8',
  });
  const line = String(out).split('\n').find((l) => l.includes('/Volumes/'));
  const mount = line ? line.slice(line.indexOf('/Volumes/')).trim() : null;
  if (!mount) throw new Error(`could not determine mount point for ${path.basename(dmgPath)}`);
  return mount;
}

function realDetach(mount, execFileSync) {
  try {
    execFileSync('hdiutil', ['detach', mount, '-quiet'], { stdio: 'ignore' });
  } catch {
    try {
      execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
    } catch {
      /* best-effort: a leaked read-only mount must not fail an otherwise-passing build */
    }
  }
}

function realVerifyCodesign(appPath, execFileSync) {
  try {
    execFileSync('codesign', ['--verify', '--deep', appPath], { stdio: 'pipe' });
    return { ok: true, message: '' };
  } catch (e) {
    return { ok: false, message: oneLine(e) };
  }
}

/** electron-builder entrypoint: default export, invoked with the BuildResult. */
module.exports = async function afterAllArtifactBuild(buildResult) {
  const fs = require('fs');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const version = require('../package.json').version;
  const volname = require('./disguise-name.cjs').darwin;
  const artifacts = (buildResult && buildResult.artifactPaths) || [];
  const outDir = artifacts.length
    ? path.dirname(artifacts[0])
    : path.resolve(process.cwd(), 'release');

  return runHook(buildResult, {
    platform: process.platform,
    view: fsView(fs),
    outDir,
    version,
    volname,
    buildDmg: (args) => realBuildDmg(args, { fs, os, execFileSync }),
    attach: (dmg) => realAttach(dmg, execFileSync),
    detach: (mount) => realDetach(mount, execFileSync),
    verifyCodesign: (app) => realVerifyCodesign(app, execFileSync),
    log: console.log,
    warn: console.warn,
  });
};

// Exported for scripts/__tests__ — electron-builder only ever calls the default hook.
module.exports.runHook = runHook;
module.exports.macAppProblems = macAppProblems;
module.exports.winUnpackedProblems = winUnpackedProblems;
module.exports.stagedMacApps = stagedMacApps;
module.exports.dmgNameFor = dmgNameFor;
module.exports.fsView = fsView;
module.exports.MAC_FRAMEWORK_BINARY = MAC_FRAMEWORK_BINARY;
module.exports.MAC_FRAMEWORK_SYMLINK = MAC_FRAMEWORK_SYMLINK;
module.exports.WIN_REQUIRED_FILES = WIN_REQUIRED_FILES;
