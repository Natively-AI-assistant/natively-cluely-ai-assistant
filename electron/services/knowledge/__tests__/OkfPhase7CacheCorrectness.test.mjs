/**
 * OKF Phase 7 regression test: KnowledgeManager.generateForFile must cache
 * (and return) the PERSISTED pack, not the freshly-extracted in-memory
 * object — a forced regeneration on a file with a user-edited card would
 * otherwise cache the pre-edit text (replaceKnowledgeCards preserves the
 * edited card server-side, but the in-memory `pack` variable built before
 * persistence does not reflect that). Caught by scripts/smoke-okf-card-edit-approve.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const managerSrc = fs.readFileSync(path.join(repoRoot, 'electron/services/knowledge/KnowledgeManager.ts'), 'utf8');

test('KnowledgeManager: caches the PERSISTED pack (re-read from store), not the pre-persist in-memory object', () => {
  assert.match(managerSrc, /const persistedPack = this\.store\.getPackBySourceId\(sourceId\);/);
  assert.match(managerSrc, /if \(persistedPack\) setCachedPack\(file\.id, persistedPack, contentHash\);/);
});

test('KnowledgeManager: generateForFile returns the persisted pack, not the pre-persist in-memory object', () => {
  assert.match(managerSrc, /return \{ status: 'generated', pack: persistedPack \?\? pack \};/);
});

test('KnowledgeManager: cache warm happens AFTER store.savePack (ordering matters — cache-then-save would cache stale data)', () => {
  // savePack's call signature gained a second (sourceChecksum) argument in
  // the senior-review needs_review fix — match on the call prefix rather
  // than the full exact statement so this test doesn't go stale again on a
  // future signature change that doesn't affect ordering.
  const saveIdx = managerSrc.indexOf('this.store.savePack(pack,');
  const cacheIdx = managerSrc.indexOf('setCachedPack(file.id, persistedPack, contentHash);');
  assert.ok(saveIdx >= 0 && cacheIdx >= 0 && saveIdx < cacheIdx, 'savePack must run before the cache warm');
});
