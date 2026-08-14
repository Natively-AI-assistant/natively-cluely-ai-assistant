#!/usr/bin/env node
// scripts/upload-release.mjs
//
// Auto-upload the signed .dmg produced by `npm run dist:signed` to the
// natively release Google Drive folder, via the existing `rclone` remote
// named `gdrive:`.
//
// WHY RCLONE (not the Drive REST API): the project already has a configured
// rclone OAuth token for `gdrive:` (verified via `rclone config userinfo`).
// Re-using it means no new credentials in source, no browser auth on every
// build, and the same access-control surface the team already audits.
//
// WHICH FILE:
//   electron-builder's signed config (`electron-builder.signed.cjs`) builds
//   only the `zip` target with electron-builder, then scripts/afterAllArtifactBuild.cjs
//   rebuilds the styled .dmg from the pristine signed .app and writes the
//   final artifact to either `dist/` or `release/` (depending on whether
//   `output: "release"` from package.json is respected by the signed path).
//   We search both — no hard-coded path — so the script works for either.
//
// TARGET FOLDER (Google Drive):
//   id  : 18efvri8m_JBwuVdD3AxrCG8QZ_SbghSn
//   name: "natively 2.8.1 beta 1"  (this may evolve per release)
//   The remote is personal OAuth for evinjohnignatious@gmail.com — the folder
//   must be shared (editor) with that exact email. rclone accesses it via
//   the curly-brace folder-id syntax: `gdrive:{18efvri8m_JBwuVdD3AxrCG8QZ_SbghSn}/`.
//
// GOTCHA (verified 2026-07-08):
//   `rclone lsf "gdrive:{folderid}"` returns "directory not found" BEFORE any
//   file has been written to the folder, even when the folder is owned by the
//   same OAuth account and reachable via the Drive REST API directly. The
//   copy itself succeeds silently and a follow-up `lsf` then lists the
//   uploaded files — so the test path (`rclone copy` + immediate `lsf`) is
//   the real verification, not the pre-upload listing.
//
// SKIP ESCAPE HATCHES:
//   NATIVELY_SKIP_RELEASE_UPLOAD=1  → exit 0 silently (local dev / CI dry-runs)
//   NATIVELY_SKIP_RELEASE_UPLOAD=prompt  → ask before uploading (default in TTY)
//
// Usage:
//   node scripts/upload-release.mjs                       # upload current version
//   NATIVELY_SKIP_RELEASE_UPLOAD=1 node scripts/upload-release.mjs
//   NATIVELY_RELEASE_VERSION=2.8.0 node scripts/upload-release.mjs  # explicit override

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const GDRIVE_FOLDER_ID = '18efvri8m_JBwuVdD3AxrCG8QZ_SbghSn';
// Drive's rclone backend needs the folder id passed via `--drive-root-folder-id`
// when the destination path itself starts with `/` (i.e. rooted). The curly-brace
// path syntax (`gdrive:{folderid}/`) is ambiguous: if a sibling folder whose
// literal NAME is "{folderid}" exists, rclone routes the file there instead of
// resolving the id (verified 2026-07-08: file landed in a sibling folder named
// literally `{18efvri8m_JBwuVdD3AxrCG8QZ_SbghSn}`). The flag form is unambiguous.
const GDRIVE_REMOTE = 'gdrive:/';
const RCLONE_BIN = process.env.RCLONE_BIN || 'rclone';
// Common rclone args applied to every operation. `--drive-root-folder-id` scopes
// the operation to a specific folder by id, regardless of any path/name collision.
const RCLONE_DRIVE_ARGS = ['--drive-root-folder-id', GDRIVE_FOLDER_ID];

async function main() {

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

function fail(msg, code = 1) {
  console.error(`[upload-release] ${msg}`);
  process.exit(code);
}

// 1. Resolve version: env override > package.json
const pkg = readJson(path.join(repoRoot, 'package.json'));
const version = (process.env.NATIVELY_RELEASE_VERSION || pkg.version || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-\w+(\.\d+)?)?$/.test(version)) {
  fail(`could not resolve a valid version (got "${version}"). Set NATIVELY_RELEASE_VERSION or fix package.json#version.`);
}
console.log(`[upload-release] version = ${version}`);

// 2. Find the signed .dmg — search both dist/ and release/ (electron-builder's
//    `output` setting + afterAllArtifactBuild's path resolution vary by build).
//    We build a regex because:
//      (a) `productName` may be missing from package.json (live: only `name:"natively"`)
//      (b) scripts/afterAllArtifactBuild.cjs hardcodes VOLNAME='Natively' so the
//          actual filename casing is "Natively-…", not always matching productName
//      (c) multiple architectures can ship side-by-side (universal / arm64 / x64)
const productName = pkg.productName || pkg.name || 'natively';
const dmgRegexes = [
  new RegExp(`^Natively-${version.replace(/\./g, '\\.')}\\.dmg$`, 'i'),
  new RegExp(`^Natively-${version.replace(/\./g, '\\.')}-arm64\\.dmg$`, 'i'),
  new RegExp(`^Natively-${version.replace(/\./g, '\\.')}-x64\\.dmg$`, 'i'),
  new RegExp(`^${productName}-Setup-${version.replace(/\./g, '\\.')}\\.dmg$`, 'i'),
  new RegExp(`^${productName}-Setup-${version.replace(/\./g, '\\.')}-arm64\\.dmg$`, 'i'),
];
const searchDirs = ['dist', 'release'].map((d) => path.join(repoRoot, d));

const candidates = [];
for (const dir of searchDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.dmg') && dmgRegexes.some((re) => re.test(f))) {
      candidates.push(path.join(dir, f));
    }
  }
}
if (candidates.length === 0) {
  fail(
    `no signed .dmg matching version ${version} found.\n` +
    `  Looked in: ${searchDirs.join(', ')}\n` +
    `  Did \`npm run dist:signed\` finish successfully?`,
  );
}
// Dedupe by basename (the same file can match multiple patterns if version is bare).
const seen = new Set();
const uniqueDmgs = candidates.filter((p) => {
  if (seen.has(path.basename(p))) return false;
  seen.add(path.basename(p));
  return true;
});
console.log(`[upload-release] found ${uniqueDmgs.length} dmg(s):`);
for (const d of uniqueDmgs) {
  const sz = fs.statSync(d).size;
  console.log(`  - ${path.relative(repoRoot, d)}  (${(sz / 1024 / 1024).toFixed(1)} MiB)`);
}

// 3. Skip if requested
if (process.env.NATIVELY_SKIP_RELEASE_UPLOAD === '1') {
  console.log('[upload-release] NATIVELY_SKIP_RELEASE_UPLOAD=1 — skipping upload.');
  process.exit(0);
}

// 4. Confirm in interactive mode (TTY) — auto-upload only if -y / CI / explicit yes
const autoYes =
  process.env.NATIVELY_SKIP_RELEASE_UPLOAD !== 'prompt' &&
  (process.env.CI === 'true' || process.env.CI === '1' || !process.stdin.isTTY || process.argv.includes('-y'));
if (process.env.NATIVELY_SKIP_RELEASE_UPLOAD !== 'prompt' && !autoYes && process.stdin.isTTY) {
  console.log(`[upload-release] about to upload ${uniqueDmgs.length} file(s) to Google Drive folder`);
  console.log(`              ${GDRIVE_REMOTE}`);
  console.log('              (re-run with -y or set CI=1 to skip this prompt)');
  // Read a single line of input. If non-TTY or stdin is closed, default to yes so
  // the build doesn't hang in pipelines that forgot to set CI.
  const answer = await new Promise((resolve) => {
    process.stdout.write('              Proceed? [y/N] ');
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => resolve(d.toString().trim().toLowerCase()));
    process.stdin.once('end', () => resolve('y'));
  });
  if (answer !== 'y' && answer !== 'yes') {
    console.log('[upload-release] aborted by user.');
    process.exit(0);
  }
}

// 5. Verify rclone + remote exist
try {
  sh(RCLONE_BIN, ['version']);
} catch (e) {
  fail(`rclone not found at "${RCLONE_BIN}". Install via "brew install rclone" or set RCLONE_BIN.`);
}
try {
  sh(RCLONE_BIN, ['listremotes']);
} catch (e) {
  fail(`rclone cannot list remotes (no config?). Run "rclone config" to set up "gdrive:".`);
}

// 6. Upload each .dmg. Use `copyto` (not `copy`) so the destination filename
//    matches the source — preserves `Natively-2.8.1.dmg` / `-arm64.dmg` exactly,
//    which is what latest-mac.yml expects for auto-updater sanity.
//    `--drive-root-folder-id` scopes the destination to the real target folder
//    and bypasses any sibling folder whose name happens to look like a path.
for (const dmg of uniqueDmgs) {
  const name = path.basename(dmg);
  const dest = `${GDRIVE_REMOTE}${name}`;
  console.log(`[upload-release] uploading ${name} → gdrive folder ${GDRIVE_FOLDER_ID}`);
  try {
    // -v so progress shows; --stats-one-line so the summary is compact.
    const out = sh(RCLONE_BIN, ['copyto', '-v', '--stats-one-line', '--stats=10s', dmg, dest, ...RCLONE_DRIVE_ARGS]);
    process.stdout.write(out);
  } catch (e) {
    const stderr = e?.stderr?.toString?.() || e?.message || String(e);
    fail(`rclone copyto failed for ${name}:\n${stderr}`);
  }
}

// 7. Verify the upload landed by listing the folder.
console.log('[upload-release] verifying upload…');
try {
  const listed = sh(RCLONE_BIN, ['lsf', ...RCLONE_DRIVE_ARGS, GDRIVE_REMOTE]);
  const uploadedNames = listed.split('\n').filter(Boolean);
  for (const dmg of uniqueDmgs) {
    const name = path.basename(dmg);
    if (!uploadedNames.includes(name)) {
      fail(`verification failed: ${name} not visible in folder ${GDRIVE_FOLDER_ID} after upload.`);
    }
  }
  console.log(`[upload-release] ✓ all ${uniqueDmgs.length} dmg(s) verified in Drive folder.`);
} catch (e) {
  // Listing by folder-id can return "directory not found" even when the folder
  // exists + accepts writes (see GOTCHA in header). Trust the copy exit code
  // (which is non-zero on real failure) and warn instead of failing here.
  const stderr = e?.stderr?.toString?.() || '';
  console.warn(`[upload-release] WARNING: post-upload verification skipped: ${stderr.trim() || e.message}`);
}

console.log('[upload-release] done.');
}

main().catch((e) => {
  console.error('[upload-release] unexpected error:', e?.stack || e?.message || String(e));
  process.exit(1);
});