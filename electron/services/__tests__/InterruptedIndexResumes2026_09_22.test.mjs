// A reference file interrupted MID-INDEX is resumed at the next launch (2026-09-22).
//
// Live-reproduced: quit the app while the local embedder is indexing the
// benchmark corpus, relaunch the same profile, wait 90s. The 38 files that were
// `pending` were re-indexed by the launch sweep. The 2 files that were
// `indexing` at the moment of the quit stayed `indexing` for good, half of
// their chunks never embedded, because the sweep's eligibility set was
// lexical_only / failed / pending. Mode activation (prewarm) re-indexes
// anything not `ready`, but a mode that was already active at launch is never
// re-activated, so nothing ever picked those files up again.
//
// A persisted `indexing` state at launch can only be left over from a process
// that died or quit mid-index. Re-indexing it is safe even in the rare case it
// is live: ModeHybridRetriever.indexFile is single-flight per file id, so a
// second call joins the running job rather than starting another.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { ModeContextRetriever, RETRY_ELIGIBLE_INDEX_STATUSES } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/services/ModeContextRetriever.js')).href);

function retrieverWithStatuses(statusById) {
  const indexed = [];
  const r = new ModeContextRetriever();
  r._hybridRetriever = {
    getFileIndexStatus: (id) => ({ status: statusById[id], chunkCount: 0, embeddedChunkCount: 0 }),
    indexFile: async (file) => { indexed.push(file.id); },
  };
  return { r, indexed };
}
const file = (id) => ({ id, modeId: 'm1', fileName: `${id}.md`, content: 'x', createdAt: 'now' });

describe('the launch sweep resumes interrupted indexing', () => {
  test('a file left `indexing` by a previous process is re-indexed', async () => {
    const { r, indexed } = retrieverWithStatuses({ a: 'indexing' });
    await r.retryLexicalOnlyFiles([file('a')]);
    assert.deepEqual(indexed, ['a'], 'an interrupted file must not stay `indexing` forever');
  });

  test('the previously eligible states are still re-indexed', async () => {
    const { r, indexed } = retrieverWithStatuses({ a: 'lexical_only', b: 'failed', c: 'pending' });
    await r.retryLexicalOnlyFiles([file('a'), file('b'), file('c')]);
    assert.deepEqual(indexed, ['a', 'b', 'c']);
  });

  test('ready and ocr_required files are left alone', async () => {
    const { r, indexed } = retrieverWithStatuses({ a: 'ready', b: 'ocr_required' });
    await r.retryLexicalOnlyFiles([file('a'), file('b')]);
    assert.deepEqual(indexed, []);
  });

  test('ModesManager gates the sweep on the SAME set (it had two private copies)', () => {
    assert.ok(RETRY_ELIGIBLE_INDEX_STATUSES instanceof Set);
    assert.ok(RETRY_ELIGIBLE_INDEX_STATUSES.has('indexing'));
    const src = fs.readFileSync(path.resolve(root, 'electron/services/ModesManager.ts'), 'utf8');
    assert.doesNotMatch(src, /new Set\(\['lexical_only', 'failed', 'pending'\]\)/, 'no private copy of the eligibility set may remain');
    assert.equal((src.match(/RETRY_ELIGIBLE_INDEX_STATUSES\.has\(/g) || []).length, 2, 'both ModesManager gates use the shared set');
  });
});
