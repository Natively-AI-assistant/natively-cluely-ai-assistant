// Unit tests for scripts/write-mac-update-manifest.mjs — the latest-mac.yml
// generator used when a signed build dies before electron-builder writes the
// updater manifest.
//
// The fixture below is the VERBATIM latest-mac.yml that electron-builder published
// to the V2.8.7 GitHub release, so "we render what electron-builder renders" is
// asserted against the real thing rather than against my idea of the format.
// Everything here is pure: no artifacts, no hashing, no filesystem.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  macZipNames,
  renderMacUpdateManifest,
  diffManifest,
} from '../write-mac-update-manifest.mjs';

// Verbatim `gh release download V2.8.7 --pattern latest-mac.yml`, 2026-08-26.
const PUBLISHED = `version: 2.8.7
files:
  - url: Natively-2.8.7-mac.zip
    sha512: 1G1C82pqV1KyAlvHhqozxTlasHo1RH1vdIn3lYTZ6da4R7NkBhE2HnREl6032YlrTS8l5KjXpjr6UUNlHswf6w==
    size: 988882979
  - url: Natively-2.8.7-arm64-mac.zip
    sha512: v9DFSfZijqPm1lCvZaZT4NrzE5kjB2e8wbUKFvQJzekbJ4QflOyO93VLiEH4fH8VdK2DS0fdlQoqemF0yafs2A==
    size: 983972024
path: Natively-2.8.7-mac.zip
sha512: 1G1C82pqV1KyAlvHhqozxTlasHo1RH1vdIn3lYTZ6da4R7NkBhE2HnREl6032YlrTS8l5KjXpjr6UUNlHswf6w==
releaseDate: '2026-08-26T02:10:41.756Z'
`;

const PUBLISHED_FILES = [
  { url: 'Natively-2.8.7-mac.zip', sha512: '1G1C82pqV1KyAlvHhqozxTlasHo1RH1vdIn3lYTZ6da4R7NkBhE2HnREl6032YlrTS8l5KjXpjr6UUNlHswf6w==', size: 988882979 },
  { url: 'Natively-2.8.7-arm64-mac.zip', sha512: 'v9DFSfZijqPm1lCvZaZT4NrzE5kjB2e8wbUKFvQJzekbJ4QflOyO93VLiEH4fH8VdK2DS0fdlQoqemF0yafs2A==', size: 983972024 },
];

// The artifacts actually on disk after the 2026-08-26 rebuild — same names, DIFFERENT
// bytes. This pairing is the whole reason the tool exists.
const ON_DISK_SIZES = { 'Natively-2.8.7-mac.zip': 988958558, 'Natively-2.8.7-arm64-mac.zip': 984047576 };

test('renders byte-for-byte what electron-builder published', () => {
  const out = renderMacUpdateManifest({
    version: '2.8.7',
    files: PUBLISHED_FILES,
    releaseDate: '2026-08-26T02:10:41.756Z',
  });
  assert.equal(out, PUBLISHED);
});

test('the legacy top-level path/sha512 point at the FIRST (x64) file', () => {
  const out = renderMacUpdateManifest({ version: '9.9.9', files: PUBLISHED_FILES, releaseDate: 'D' });
  assert.match(out, /\npath: Natively-2\.8\.7-mac\.zip\n/);
  assert.match(out, new RegExp(`\\nsha512: ${PUBLISHED_FILES[0].sha512.replace(/[+/=]/g, (c) => `\\${c}`)}\\nreleaseDate`));
});

test('refuses to render an empty manifest', () => {
  assert.throws(() => renderMacUpdateManifest({ version: '1.0.0', files: [], releaseDate: 'D' }), /files is empty/);
});

test('zip names follow electron-builder: x64 unsuffixed, arm64 suffixed, x64 first', () => {
  assert.deepEqual(macZipNames('Natively', '2.8.7'), [
    'Natively-2.8.7-mac.zip',
    'Natively-2.8.7-arm64-mac.zip',
  ]);
});

test('diffManifest passes a manifest that matches the artifacts', () => {
  const results = diffManifest(PUBLISHED, PUBLISHED_FILES);
  assert.deepEqual(results.map((r) => r.status), ['ok', 'ok']);
});

test('diffManifest catches the REAL incident: a manifest from an earlier build', () => {
  // Identical filenames, identical version — only the bytes differ. Publishing this
  // pairing means electron-updater downloads ~1 GB and then fails sha512 validation.
  const actual = PUBLISHED_FILES.map((f) => ({
    ...f,
    size: ON_DISK_SIZES[f.url],
    sha512: 'DIFFERENTHASHFROMTHEREBUILD==',
  }));
  const results = diffManifest(PUBLISHED, actual);
  assert.deepEqual(results.map((r) => r.status), ['size', 'size']);
  assert.match(results[0].detail, /988882979 vs disk 988958558/);
});

test('diffManifest reports a sha512 drift even when the size happens to match', () => {
  const actual = PUBLISHED_FILES.map((f) => ({ ...f, sha512: 'AAAA==' }));
  const results = diffManifest(PUBLISHED, actual);
  assert.deepEqual(results.map((r) => r.status), ['sha512', 'sha512']);
});

test('diffManifest reports an advertised artifact that does not exist', () => {
  const results = diffManifest(PUBLISHED, [PUBLISHED_FILES[0]]);
  assert.deepEqual(results.map((r) => r.status), ['ok', 'missing']);
});

test('a rendered manifest verifies against its own inputs (round trip)', () => {
  const text = renderMacUpdateManifest({ version: '2.8.7', files: PUBLISHED_FILES, releaseDate: 'D' });
  assert.deepEqual(diffManifest(text, PUBLISHED_FILES).map((r) => r.status), ['ok', 'ok']);
});
