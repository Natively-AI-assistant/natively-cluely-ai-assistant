// F-120 regression pin (audit/autopilot-2026-08-14).
//
// EmbeddingPipeline broadcasts 'embedding:fallback-activated' and
// 'embedding:space-persist-failed' — silent semantic-search degradation —
// and repo-wide each had one producer and zero consumers, while the sibling
// channels (incompatible-provider warning, reindex progress) were fully
// wired. Live-reproduced in scripts/audit/F-120-repro.mjs.
//
// Contracts pinned here: preload subscribes both channels under
// onEmbeddingDegraded, and App.tsx consumes it into the generic status
// banner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..', '..');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8');
const appTsx = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');

test('preload subscribes both embedding degradation channels', () => {
  const idx = preload.indexOf('onEmbeddingDegraded:');
  assert.notEqual(idx, -1, 'preload must expose onEmbeddingDegraded (F-120)');
  const body = preload.slice(idx, idx + 900);
  assert.ok(/ipcRenderer\.on\('embedding:fallback-activated'/.test(body), 'must subscribe embedding:fallback-activated');
  assert.ok(/ipcRenderer\.on\('embedding:space-persist-failed'/.test(body), 'must subscribe embedding:space-persist-failed');
  assert.ok(/removeListener\('embedding:fallback-activated'/.test(body), 'unsubscribe must remove both listeners');
});

test('App.tsx consumes onEmbeddingDegraded into a user-visible banner', () => {
  const idx = appTsx.indexOf('onEmbeddingDegraded');
  assert.notEqual(idx, -1, 'App.tsx must register an onEmbeddingDegraded listener (F-120)');
  const body = appTsx.slice(idx, idx + 700);
  assert.ok(
    /setOllamaPullStatus\('failed'\)/.test(body),
    'the listener must surface degradation via the status banner'
  );
});
