/**
 * A registry entry whose payload directory is gone must not count as installed.
 *
 * Found live on 2026-09-03. `~/.natively/extensions/registry.json` held two
 * enabled `type: reranker` entries -- `probe-reranker` (a leftover probe whose
 * payload directory had been deleted) and the user's real `jina-reranker-v35`.
 *
 * `RerankerRegistry.activeExtensionId()` refuses to choose when more than one
 * reranker extension is enabled, and correctly so: silently picking one would
 * reorder the user's evidence by whichever happened to sort first. But nothing
 * noticed that the probe could never load, so a dead entry permanently disabled
 * a working extension, with no error anywhere -- reranking simply fell back to
 * the built-in while the UI showed the extension enabled.
 *
 * The entry cannot self-heal through the crash counter either: the seam only
 * COUNTS enabled entries, so the dead one is never loaded and never crashes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const base = path.join(repoRoot, 'dist-electron/electron/services/extensions');
const { ExtensionRegistry } = require(path.join(base, 'ExtensionRegistry.js'));
const { RerankerRegistry } = require(
  path.join(repoRoot, 'dist-electron/electron/services/reranking/RerankerRegistry.js'),
);

const APP_VERSION = '2.8.8';

function manifestFor(id) {
  return {
    id, name: id, version: '1.0.0', apiVersion: '1', type: 'reranker',
    entrypoint: 'dist/index.js', author: 'community',
    homepage: 'https://github.com/example/x',
    engines: { natively: '>=2.8.0' },
    permissions: ['filesystem.models'], models: [], config: {},
  };
}

function stage(root, ids, { withPayload }) {
  const file = path.join(root, 'extensions', 'registry.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    extensions: ids.map((id) => ({
      id, manifest: manifestFor(id), source: 'local:test',
      installedAt: new Date().toISOString(), enabled: true,
      grantedPermissions: ['filesystem.models'], config: {},
    })),
  }, null, 2));

  for (const id of withPayload) {
    fs.mkdirSync(path.join(root, 'extensions', id, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'extensions', id, 'dist', 'index.js'), 'module.exports = {};');
  }
  return file;
}

test('an entry whose payload directory is gone is dropped, and says why', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-stale-'));
  const file = stage(root, ['live-reranker', 'ghost-reranker'], { withPayload: ['live-reranker'] });

  const registry = new ExtensionRegistry({ filePath: file, appVersion: APP_VERSION, rootOverride: root });

  assert.deepEqual(registry.list().map((r) => r.id), ['live-reranker']);
  assert.match(registry.warnings().join('; '), /ghost-reranker/);
  assert.match(registry.warnings().join('; '), /payload/i);
});

test('the dead entry no longer blocks the rerank seam', () => {
  // This is the user-visible consequence: two enabled rerankers means the
  // registry refuses to choose and the built-in keeps the seam. Dropping the
  // dead one leaves exactly one, so the real extension is used again.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-stale-'));
  const file = stage(root, ['live-reranker', 'ghost-reranker'], { withPayload: ['live-reranker'] });

  const registry = new ExtensionRegistry({ filePath: file, appVersion: APP_VERSION, rootOverride: root });
  const source = {
    list: () => registry.list(),
    running: () => [],
    load: async () => {},
    rerank: async () => null,
  };
  const rr = new RerankerRegistry({ isEnabled: () => true, source, logger: { warn() {} } });

  assert.equal(rr.activeExtensionId(), 'live-reranker');
});

test('a live entry is still kept when both payloads exist', () => {
  // Guard against over-correcting: the drop must be about a MISSING payload,
  // not about having more than one extension installed.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-stale-'));
  const file = stage(root, ['a-reranker', 'b-reranker'], { withPayload: ['a-reranker', 'b-reranker'] });

  const registry = new ExtensionRegistry({ filePath: file, appVersion: APP_VERSION, rootOverride: root });
  assert.deepEqual(registry.list().map((r) => r.id).sort(), ['a-reranker', 'b-reranker']);
  assert.equal(registry.warnings().length, 0);
});
