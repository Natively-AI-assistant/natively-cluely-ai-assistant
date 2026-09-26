#!/usr/bin/env node
// scripts/write-mac-update-manifest.mjs
//
// Generate (or verify) release/latest-mac.yml — the macOS auto-update feed that
// electron-updater fetches from the GitHub release named in package.json's
// `build.publish` block.
//
// WHY THIS EXISTS (2026-08-26):
//   electron-builder writes latest-mac.yml at the very END of a run. When a signed
//   build dies before that — e.g. the notary upload drops, which is what
//   scripts/lib/notary-transient.cjs now retries — you are left with perfectly good,
//   notarized, stapled ZIPs and DMGs and NO manifest. Re-running the whole ~55-minute
//   build just to regenerate a 500-byte YAML is absurd; this reproduces it exactly
//   from the artifacts on disk.
//
//   It also guards the failure that motivated it: the release V2.8.7 was publishing a
//   latest-mac.yml from an EARLIER build (x64 zip size 988882979) while the ZIPs on
//   disk were 988958558 bytes. electron-updater validates the downloaded ZIP against
//   the manifest's sha512, so a stale manifest does not merely mispoint — it makes
//   every update fail integrity checking after a ~1 GB download. Hashes here are
//   always computed from the actual bytes, never carried over.
//
// SCOPE: only the macOS ZIPs go in `files`. This project builds ONLY the zip target
// through electron-builder (electron-builder.signed.cjs) and produces the DMGs in
// scripts/afterAllArtifactBuild.cjs, so electron-builder never listed the DMGs here
// either — the updater consumes the ZIP. Matching that exactly is deliberate: the
// generated file must be byte-shaped like the one electron-builder would have written.
//
// USAGE
//   node scripts/write-mac-update-manifest.mjs                 # write release/latest-mac.yml
//   node scripts/write-mac-update-manifest.mjs --dry-run       # print it, write nothing
//   node scripts/write-mac-update-manifest.mjs --verify [file] # compare a manifest to the artifacts
//   node scripts/write-mac-update-manifest.mjs --out-dir dist --version 2.8.7
//
// Pure Node (no unzip/shell), so it runs identically on macOS and Windows.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** The updater payloads, in the order electron-builder emits them (x64, then arm64). */
export function macZipNames(productName, version) {
  return [`${productName}-${version}-mac.zip`, `${productName}-${version}-arm64-mac.zip`];
}

/** Streaming sha512 → base64, so a ~1 GB artifact never lands in one Buffer. */
export function sha512base64(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

/**
 * Render latest-mac.yml exactly as electron-builder does: two-space indent, `- url:`
 * entries, then the legacy top-level `path`/`sha512` pointing at the FIRST file, then
 * a single-quoted ISO releaseDate.
 * @param {{version: string, files: Array<{url: string, sha512: string, size: number}>, releaseDate: string}} m
 */
export function renderMacUpdateManifest({ version, files, releaseDate }) {
  if (!files || files.length === 0) throw new Error('renderMacUpdateManifest: files is empty');
  const lines = [`version: ${version}`, 'files:'];
  for (const f of files) {
    lines.push(`  - url: ${f.url}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`);
  }
  lines.push(`path: ${files[0].url}`, `sha512: ${files[0].sha512}`, `releaseDate: '${releaseDate}'`);
  return `${lines.join('\n')}\n`;
}

/**
 * Compare a manifest's claims against artifacts on disk.
 * @returns {Array<{url: string, status: 'ok'|'missing'|'size'|'sha512', detail?: string}>}
 */
export function diffManifest(manifestText, actual) {
  const byUrl = new Map(actual.map((a) => [a.url, a]));
  const results = [];
  const re = /- url: (\S+)\s*\n\s*sha512: (\S+)\s*\n\s*size: (\d+)/g;
  let m;
  while ((m = re.exec(manifestText)) !== null) {
    const [, urlName, sha, size] = m;
    const disk = byUrl.get(urlName);
    if (!disk) {
      results.push({ url: urlName, status: 'missing', detail: 'no such artifact on disk' });
    } else if (String(disk.size) !== size) {
      results.push({ url: urlName, status: 'size', detail: `manifest ${size} vs disk ${disk.size}` });
    } else if (disk.sha512 !== sha) {
      results.push({
        url: urlName,
        status: 'sha512',
        detail: `manifest ${sha.slice(0, 12)}… vs disk ${disk.sha512.slice(0, 12)}…`,
      });
    } else {
      results.push({ url: urlName, status: 'ok' });
    }
  }
  return results;
}

function parseArgs(argv) {
  const opts = { dryRun: false, verify: null, outDir: 'release', version: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--verify') opts.verify = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    else if (a === '--out-dir') opts.outDir = argv[++i];
    else if (a === '--version') opts.version = argv[++i];
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = opts.version || pkg.version;
  const productName = pkg.build?.productName || pkg.productName || 'Natively';
  const outDir = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(repoRoot, opts.outDir);

  const names = macZipNames(productName, version);
  const missing = names.filter((n) => !fs.existsSync(path.join(outDir, n)));
  if (missing.length) {
    console.error(
      `[update-manifest] Missing updater ZIP(s) in ${outDir}:\n  ${missing.join('\n  ')}\n` +
        '[update-manifest] Refusing to write a manifest that advertises artifacts you do not have.'
    );
    process.exit(1);
  }

  console.log(`[update-manifest] Hashing ${names.length} artifacts in ${outDir} (a ~1 GB sha512 takes a few seconds each)…`);
  const files = [];
  for (const name of names) {
    const p = path.join(outDir, name);
    const size = fs.statSync(p).size;
    const sha512 = await sha512base64(p);
    files.push({ url: name, sha512, size });
    console.log(`[update-manifest]   ${name}  size=${size}  sha512=${sha512.slice(0, 16)}…`);
  }

  if (opts.verify !== null) {
    const target = opts.verify || path.join(outDir, 'latest-mac.yml');
    if (!fs.existsSync(target)) {
      console.error(`[update-manifest] --verify: no manifest at ${target}`);
      process.exit(1);
    }
    const results = diffManifest(fs.readFileSync(target, 'utf8'), files);
    let bad = 0;
    for (const r of results) {
      if (r.status === 'ok') console.log(`[update-manifest] OK       ${r.url}`);
      else {
        bad++;
        console.error(`[update-manifest] MISMATCH ${r.url} — ${r.status}: ${r.detail}`);
      }
    }
    if (results.length !== files.length) {
      console.error(
        `[update-manifest] Manifest lists ${results.length} file(s) but ${files.length} artifact(s) exist on disk.`
      );
      bad++;
    }
    if (bad) {
      console.error(
        '[update-manifest] This manifest does NOT describe these artifacts. electron-updater validates the ' +
          'downloaded ZIP against sha512, so publishing it means every update fails AFTER a ~1 GB download.'
      );
      process.exit(1);
    }
    console.log('[update-manifest] Manifest matches the artifacts on disk ✅');
    return;
  }

  const text = renderMacUpdateManifest({ version, files, releaseDate: new Date().toISOString() });
  if (opts.dryRun) {
    console.log(`[update-manifest] --dry-run, would write ${path.join(outDir, 'latest-mac.yml')}:\n`);
    process.stdout.write(text);
    return;
  }
  const outFile = path.join(outDir, 'latest-mac.yml');
  fs.writeFileSync(outFile, text);
  console.log(`[update-manifest] Wrote ${outFile}\n`);
  process.stdout.write(text);
}

// Only run when invoked directly, so the helpers above stay importable from tests.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('[update-manifest]', err && err.message ? err.message : err);
    process.exit(1);
  });
}
