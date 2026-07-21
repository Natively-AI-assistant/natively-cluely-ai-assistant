import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

function extractHandler(channel) {
  const start = ipcSource.indexOf(`safeHandle('${channel}'`);
  assert.ok(start >= 0, `could not locate ${channel}`);
  let i = ipcSource.indexOf('{', start);
  let depth = 1;
  const bodyStart = i + 1;
  i++;
  while (i < ipcSource.length && depth > 0) {
    const ch = ipcSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${channel}`);
  return ipcSource.slice(bodyStart, i - 1);
}

test('profile upload handlers gate filesystem paths through a TTL-bounded allowlist', () => {
  assert.ok(
    /const\s+PROFILE_SELECTED_PATH_TTL_MS\s*=\s*60_000/.test(ipcSource),
    'BUG: profile path allowlist must declare a bounded TTL constant.',
  );
  assert.ok(
    /const\s+profileSelectedPaths\s*=\s*new\s+Map<\s*string\s*,\s*number\s*>\s*\(\s*\)/.test(ipcSource),
    'BUG: profile path allowlist must be a Map<path, expiresAt>.',
  );
  const consumer = ipcSource.indexOf('const consumeSelectedProfilePath');
  assert.ok(consumer >= 0, 'BUG: consumeSelectedProfilePath helper must exist.');
  const consumerBody = ipcSource.slice(consumer, ipcSource.indexOf('};', consumer) + 2);
  assert.ok(/typeof\s+filePath\s*!==\s*['"]string['"]/.test(consumerBody), 'BUG: consumer must reject non-string paths.');
  assert.ok(/profileSelectedPaths\.delete\s*\(\s*key\s*\)/.test(consumerBody), 'BUG: consumer must be one-shot (delete after success).');
  assert.ok(/Date\.now\s*\(\s*\)\s*>\s*expiresAt/.test(consumerBody), 'BUG: consumer must enforce TTL expiry.');
  assert.ok(/normalizeProfilePath\s*\(\s*filePath\s*\)/.test(consumerBody), 'BUG: consumer must look up paths via the normalizer to defeat trivial obfuscation.');
  assert.ok(/const\s+normalizeProfilePath\s*=\s*\([^)]*\)[^=]*=>\s*path\.resolve\s*\(\s*p\s*\)/.test(ipcSource), 'BUG: normalizeProfilePath must use path.resolve to canonicalize.');
  assert.ok(/const\s+sweepExpiredProfilePaths/.test(ipcSource), 'BUG: profile path allowlist must sweep expired entries before insertion.');

  const selectBody = extractHandler('profile:select-file');
  assert.ok(
    /registerSelectedProfilePath\s*\(\s*selected\s*\)/.test(selectBody),
    'BUG: profile:select-file must register the dialog-selected path via the TTL helper before returning.',
  );

  for (const channel of ['profile:upload-resume', 'profile:upload-jd']) {
    const body = extractHandler(channel);
    assert.ok(
      /const\s+resolvedPath\s*=\s*consumeSelectedProfilePath\s*\(\s*filePath\s*\)/.test(body),
      `BUG: ${channel} must consume the user-selected path allowlist.`,
    );
    assert.ok(/if\s*\(\s*!resolvedPath\s*\)/.test(body), `BUG: ${channel} must reject paths that were never selected via the dialog.`);
    assert.ok(
      /ingestDocument\s*\(\s*resolvedPath\s*,/.test(body),
      `BUG: ${channel} must ingest the resolved allowlisted path, not the raw renderer-provided string.`,
    );
  }
});
