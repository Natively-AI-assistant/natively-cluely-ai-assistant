/**
 * OKF Phase 7 (2026-07-01): latency/caching/hardening tests. Source-assertion
 * for the cross-bundle singleton fix (the critical Phase 7 bug — see
 * KnowledgeCache.ts / KnowledgeIndexQueue.ts comments) plus pure-function
 * cache behavior tests against the compiled module directly (no DB needed —
 * KnowledgeCache is pure in-memory Map logic).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadModule(relPath) {
  return import(pathToFileURL(path.join(distRoot, relPath)).href);
}

const cacheSrc = read('electron/services/knowledge/KnowledgeCache.ts');
const queueSrc = read('electron/services/knowledge/KnowledgeIndexQueue.ts');
const managerSrc = read('electron/services/knowledge/KnowledgeManager.ts');
const editorSrc = read('electron/services/knowledge/OkfCardEditor.ts');
const retrieverSrc = read('electron/services/knowledge/OkfRetriever.ts');

test('KnowledgeCache: anchors the pack/retrieval cache singletons to globalThis (cross-bundle sharing)', () => {
  assert.match(cacheSrc, /const GLOBAL_KEY = '__natively_okf_knowledge_cache__';/);
  assert.match(cacheSrc, /globalThis as unknown as Record<string, GlobalCacheState/);
});

test('KnowledgeIndexQueue: anchors the queue singleton to globalThis (cross-bundle sharing)', () => {
  assert.match(queueSrc, /const GLOBAL_KEY = '__natively_okf_knowledge_index_queue__';/);
  assert.match(queueSrc, /globalThis as unknown as Record<string, KnowledgeIndexQueueImpl/);
});

test('KnowledgeManager: warms the pack cache immediately after a successful generateForFile write', () => {
  // Must cache the PERSISTED pack (re-read from store), not the pre-persist
  // in-memory `pack` object — see OkfPhase7CacheCorrectness.test.mjs for the
  // full regression story (a forced regen on a file with a user-edited card
  // would otherwise cache stale pre-edit text).
  assert.match(managerSrc, /setCachedPack\(file\.id, persistedPack, contentHash\);/);
});

test('KnowledgeManager: getPackForFile checks the cache before hitting the DB', () => {
  const idx = managerSrc.indexOf('getPackForFile(fileId: string)');
  const slice = managerSrc.slice(idx, idx + 700);
  assert.match(slice, /getCachedPack\(fileId, source\.contentHash\)/);
  assert.match(slice, /if \(cached\) return cached;/);
});

test('KnowledgeManager: deleteForFile invalidates the pack cache', () => {
  const idx = managerSrc.indexOf('deleteForFile(fileId: string)');
  const slice = managerSrc.slice(idx, idx + 400);
  assert.match(slice, /invalidatePackCache\(fileId\)/);
});

test('OkfCardEditor: every mutation (edit/approve/reject/restore) invalidates the pack cache', () => {
  const fns = ['editCard', 'approveCard', 'rejectCard', 'restoreCardVersion'];
  for (const fn of fns) {
    const idx = editorSrc.indexOf(`export function ${fn}`);
    assert.ok(idx >= 0, `expected to find ${fn}`);
    const nextFnIdx = editorSrc.indexOf('export function', idx + 10);
    const slice = editorSrc.slice(idx, nextFnIdx > 0 ? nextFnIdx : editorSrc.length);
    assert.match(slice, /invalidateCacheForCard\(card\)/, `${fn} must invalidate the cache`);
  }
});

test('OkfRetriever: queryOkfCards accepts an optional fileId for retrieval-result caching', () => {
  assert.match(retrieverSrc, /fileId\?: string;/);
  assert.match(retrieverSrc, /getCachedRetrieval\(options\.fileId, pack\.packVersion, question, topN\)/);
  assert.match(retrieverSrc, /setCachedRetrieval\(options\.fileId, pack\.packVersion, question, topN, result\)/);
});

test('KnowledgeCache: getCachedPack returns null on contentHash mismatch (real content change invalidates)', async () => {
  const mod = await loadModule('services/knowledge/KnowledgeCache.js');
  const fakePack = { id: 'p1', sourceId: 's1', modeId: 'm1', fileName: 'f.pdf', cards: [], entities: [], relations: [], indexMd: '', stats: {}, packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: 'now' };
  mod.setCachedPack('file1', fakePack, 'hashA');
  assert.deepEqual(mod.getCachedPack('file1', 'hashA'), fakePack);
  assert.equal(mod.getCachedPack('file1', 'hashB'), null);
});

test('KnowledgeCache: invalidatePackCache clears both the pack entry and any retrieval-cache entries for that file', async () => {
  const mod = await loadModule('services/knowledge/KnowledgeCache.js');
  const fakePack = { id: 'p2', sourceId: 's2', modeId: 'm2', fileName: 'f2.pdf', cards: [], entities: [], relations: [], indexMd: '', stats: {}, packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: 'now' };
  mod.setCachedPack('file2', fakePack, 'hashC');
  mod.setCachedRetrieval('file2', 1, 'a question', 6, [{ card: { id: 'c1' }, score: 0.9 }]);
  assert.notEqual(mod.getCachedRetrieval('file2', 1, 'a question', 6), null);
  mod.invalidatePackCache('file2');
  assert.equal(mod.getCachedPack('file2', 'hashC'), null);
  assert.equal(mod.getCachedRetrieval('file2', 1, 'a question', 6), null);
});

test('KnowledgeCache: retrieval cache is keyed on packVersion (a version bump invalidates)', async () => {
  const mod = await loadModule('services/knowledge/KnowledgeCache.js');
  mod.setCachedRetrieval('file3', 1, 'q', 6, [{ card: { id: 'c1' }, score: 0.5 }]);
  assert.notEqual(mod.getCachedRetrieval('file3', 1, 'q', 6), null);
  assert.equal(mod.getCachedRetrieval('file3', 2, 'q', 6), null);
});
