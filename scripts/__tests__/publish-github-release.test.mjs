// Unit tests for scripts/publish-github-release.mjs — the release uploader that
// makes sure every updater artifact ships with its .blockmap (V2.8.8 shipped none,
// so every client downloaded ~1 GB in full).
//
// Both platform branches are exercised explicitly; the manifests below are the
// VERBATIM latest.yml / latest-mac.yml of the V2.8.8 GitHub release (2026-09-22).
// Pure: no network, no gh, no filesystem except an in-memory gzip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  normalizePlatform,
  manifestName,
  extraInstallerNames,
  parseManifestFiles,
  parseManifestVersion,
  deriveOldPath,
  checkTagDerivation,
  blockmapCoveredSize,
  planUpload,
  tagVersionParts,
  pickPreviousTag,
} from '../publish-github-release.mjs';

const WIN_288 = `version: 2.8.8
files:
  - url: Natively-Setup-2.8.8-x64.exe
    sha512: FI6z4FxmsdY/iMdXahN5H11zoS2RyxqLvUM/aFtt30uhuvHoQ5z7EkxT/wu2O73K2umu2l32GuzP8jtRjIzvzQ==
    size: 890812552
path: Natively-Setup-2.8.8-x64.exe
sha512: FI6z4FxmsdY/iMdXahN5H11zoS2RyxqLvUM/aFtt30uhuvHoQ5z7EkxT/wu2O73K2umu2l32GuzP8jtRjIzvzQ==
releaseDate: '2026-08-28T16:05:43.406Z'
`;

const MAC_288 = `version: 2.8.8
files:
  - url: Natively-2.8.8-mac.zip
    sha512: /podZU7G6fvMDYnEJvuqhu73rkOZSB4GLN/EhZO6EIgJnqOmTjVwYPPYejcx5C+XgjjO8bCVKhsE+JrnhQZo0w==
    size: 993086647
  - url: Natively-2.8.8-arm64-mac.zip
    sha512: M1EpgjmR9TF3f5hWQ1diXXG/SbUJeEs440uHSovU3e7z3NKfn6kRFU/kPTzL+kYTsk6yEWFXCzLqogmWsm6YvA==
    size: 988175687
path: Natively-2.8.8-mac.zip
sha512: /podZU7G6fvMDYnEJvuqhu73rkOZSB4GLN/EhZO6EIgJnqOmTjVwYPPYejcx5C+XgjjO8bCVKhsE+JrnhQZo0w==
releaseDate: '2026-08-27T18:18:28.039Z'
`;

/** A disk listing where every blockmap exactly covers its file. */
function completeDisk(files, extra = {}) {
  const disk = { ...extra };
  for (const f of files) {
    disk[f.url] = { size: f.size };
    disk[`${f.url}.blockmap`] = { size: 800000, blockmapCovers: f.size };
  }
  return disk;
}

test('platform flag is exhaustive — no silent default to the host OS', () => {
  assert.equal(normalizePlatform('mac'), 'darwin');
  assert.equal(normalizePlatform('darwin'), 'darwin');
  assert.equal(normalizePlatform('win'), 'win32');
  assert.equal(normalizePlatform('win32'), 'win32');
  assert.throws(() => normalizePlatform(undefined), /--platform must be/);
  assert.throws(() => normalizePlatform('linux'), /--platform must be/);
});

test('manifest names match what electron-updater requests per platform', () => {
  assert.equal(manifestName('darwin'), 'latest-mac.yml');
  assert.equal(manifestName('win32'), 'latest.yml');
  assert.throws(() => manifestName('linux'), /Unsupported platform/);
});

test('parses the real V2.8.8 manifests', () => {
  assert.equal(parseManifestVersion(MAC_288), '2.8.8');
  assert.deepEqual(parseManifestFiles(MAC_288).map((f) => [f.url, f.size]), [
    ['Natively-2.8.8-mac.zip', 993086647],
    ['Natively-2.8.8-arm64-mac.zip', 988175687],
  ]);
  assert.deepEqual(parseManifestFiles(WIN_288).map((f) => [f.url, f.size]), [['Natively-Setup-2.8.8-x64.exe', 890812552]]);
});

test('mac: uploads both zips + blockmaps + DMGs, manifest LAST', () => {
  const files = parseManifestFiles(MAC_288);
  const disk = completeDisk(files, {
    'Natively-2.8.8.dmg': { size: 1022618949 },
    'Natively-2.8.8-arm64.dmg': { size: 1017744332 },
    'builder-debug.yml': { size: 10 },
  });
  const plan = planUpload({ platform: 'darwin', manifestText: MAC_288, disk, productName: 'Natively', version: '2.8.8' });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.uploads, [
    'Natively-2.8.8-mac.zip',
    'Natively-2.8.8-mac.zip.blockmap',
    'Natively-2.8.8-arm64-mac.zip',
    'Natively-2.8.8-arm64-mac.zip.blockmap',
    'Natively-2.8.8.dmg',
    'Natively-2.8.8-arm64.dmg',
    'latest-mac.yml',
  ]);
});

test('win: uploads the NSIS installer + its blockmap, manifest LAST', () => {
  const files = parseManifestFiles(WIN_288);
  const plan = planUpload({ platform: 'win32', manifestText: WIN_288, disk: completeDisk(files), productName: 'Natively', version: '2.8.8' });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.uploads, ['Natively-Setup-2.8.8-x64.exe', 'Natively-Setup-2.8.8-x64.exe.blockmap', 'latest.yml']);
  assert.deepEqual(extraInstallerNames('win32', 'Natively', '2.8.8'), []);
});

test('refuses when a blockmap is missing — the exact V2.8.8 failure', () => {
  for (const [platform, text] of [['darwin', MAC_288], ['win32', WIN_288]]) {
    const files = parseManifestFiles(text);
    const dmgs = Object.fromEntries(extraInstallerNames(platform, 'Natively', '2.8.8').map((n) => [n, { size: 1 }]));
    const disk = completeDisk(files, dmgs);
    delete disk[`${files[0].url}.blockmap`];
    const plan = planUpload({ platform, manifestText: text, disk, productName: 'Natively', version: '2.8.8' });
    assert.equal(plan.problems.length, 1, platform);
    assert.match(plan.problems[0], /blockmap missing — without it every client does a FULL download/);
  }
});

test('refuses a blockmap from a different build (covers the wrong byte count)', () => {
  const files = parseManifestFiles(WIN_288);
  const disk = completeDisk(files);
  disk['Natively-Setup-2.8.8-x64.exe.blockmap'].blockmapCovers = 890000000;
  const plan = planUpload({ platform: 'win32', manifestText: WIN_288, disk, productName: 'Natively', version: '2.8.8' });
  assert.match(plan.problems.join('\n'), /belongs to a different build/);
});

test('refuses a stale manifest (size mismatch) and a wrong-version manifest', () => {
  const files = parseManifestFiles(MAC_288);
  const disk = completeDisk(files);
  disk['Natively-2.8.8-mac.zip'].size = 993086000;
  disk['Natively-2.8.8-mac.zip.blockmap'].blockmapCovers = 993086000;
  const stale = planUpload({ platform: 'darwin', manifestText: MAC_288, disk, productName: 'Natively', version: '2.8.8' });
  assert.match(stale.problems.join('\n'), /stale manifest/);

  const wrongVersion = planUpload({ platform: 'darwin', manifestText: MAC_288, disk: completeDisk(files), productName: 'Natively', version: '2.9.0' });
  assert.match(wrongVersion.problems.join('\n'), /is for version 2\.8\.8, not 2\.9\.0/);
});

test('old-blockmap derivation mirrors electron-updater (version replaced in the TAG too)', () => {
  assert.equal(
    deriveOldPath('/Natively-AI-assistant/natively-cluely-ai-assistant/releases/download/V2.9.0/Natively-2.9.0-arm64-mac.zip', '2.9.0', '2.8.8'),
    '/Natively-AI-assistant/natively-cluely-ai-assistant/releases/download/V2.8.8/Natively-2.8.8-arm64-mac.zip'
  );
  assert.equal(deriveOldPath('Natively-Setup-2.9.0-x64.exe', '2.9.0', '2.8.8'), 'Natively-Setup-2.8.8-x64.exe');
});

test('tag casing must survive the derivation (GitHub tags are case-sensitive)', () => {
  assert.deepEqual(checkTagDerivation({ newTag: 'V2.9.0', newVersion: '2.9.0', oldTag: 'V2.8.8', oldVersion: '2.8.8' }), {
    ok: true,
    derivedTag: 'V2.8.8',
  });
  // v2.7.0 -> V2.8.8 style mix: /download/v2.8.8/ is a 404 => silent full download.
  assert.deepEqual(checkTagDerivation({ newTag: 'v2.9.0', newVersion: '2.9.0', oldTag: 'V2.8.8', oldVersion: '2.8.8' }), {
    ok: false,
    derivedTag: 'v2.8.8',
  });
});

test('blockmapCoveredSize sums chunk sizes of the gzipped JSON electron-builder writes', () => {
  const bm = zlib.gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['a', 'b'], sizes: [100, 23] }] }));
  assert.equal(blockmapCoveredSize(bm), 123);
  assert.throws(() => blockmapCoveredSize(zlib.gzipSync('{"version":"2"}')), /not a blockmap/);
});

test('mac: a missing DMG is a problem, not a silently thinner release', () => {
  const files = parseManifestFiles(MAC_288);
  const disk = completeDisk(files, { 'Natively-2.8.8.dmg': { size: 1022618949 } });
  const plan = planUpload({ platform: 'darwin', manifestText: MAC_288, disk, productName: 'Natively', version: '2.8.8' });
  assert.deepEqual(plan.problems, ['Natively-2.8.8-arm64.dmg missing — the release page would have no installer']);
});

// Verbatim shape of `gh release list` for this repo (2026-09-22), plus a future V2.9.0.
const RELEASES = [
  { tagName: 'V2.9.0', isDraft: false, isPrerelease: false },
  { tagName: 'V2.8.8', isDraft: false, isPrerelease: false },
  { tagName: 'v2.7.0', isDraft: false, isPrerelease: false },
  { tagName: 'v2.1.0-beta.2', isDraft: false, isPrerelease: true },
  { tagName: '2.1.0', isDraft: false, isPrerelease: false },
  { tagName: 'v2.0', isDraft: false, isPrerelease: false },
  { tagName: 'V3.0.0', isDraft: true, isPrerelease: false },
];

test('previous release is chosen by VERSION — auditing an old tag never compares against a newer one', () => {
  assert.equal(pickPreviousTag(RELEASES, '2.9.1'), 'V2.9.0');
  assert.equal(pickPreviousTag(RELEASES, '2.9.0'), 'V2.8.8');
  assert.equal(pickPreviousTag(RELEASES, '2.8.8'), 'v2.7.0'); // not V2.9.0, which is newer
  assert.equal(pickPreviousTag(RELEASES, '2.1.0'), 'v2.0'); // prereleases skipped
  assert.equal(pickPreviousTag(RELEASES, '2.0'), null);
  assert.equal(pickPreviousTag(RELEASES, '3.1.0'), 'V2.9.0'); // drafts skipped
  assert.deepEqual(tagVersionParts('v2.0'), [2, 0]);
  assert.equal(tagVersionParts('v2.1.0-beta.2'), null);
});
