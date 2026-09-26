// The profile semantic arm carries its race deadline to the reranker
// (live 2026-09-27, looking for work: "semantic arm exceeded 1200 ms" on 19 of
// 19 turns — the arm is raced at the plan timeout, the rerank it started had a
// longer budget, so every answer waited 1.2 s and got BM25 only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), 'dist-electron/electron');
const { buildProfileRawRetriever } = await import(pathToFileURL(path.join(root, 'services/knowledge/v3ProfileSources.js')).href);
const docs = [{ kind: 'resume', sourceId: 'p-cv', versionId: 'h1', fileName: 'cv.txt', structured: null, rawText: 'Backend engineer at Ledgerly. Led the payout service rewrite in Go.' }];

test('a raced call hands its timeout to the reranker as rerankDeadlineMs', async () => {
  let seen = null;
  const rr = buildProfileRawRetriever({ retrieveHybridRaw: async (_m, _f, o) => { seen = o; return { chunks: [] }; } }, docs, { tokenBudget: 1800, rerankSurface: 'live' });
  await rr('tell me about the payout rewrite', { topK: 8, timeoutMs: 1200 });
  assert.equal(seen.rerankDeadlineMs, 1200);
  assert.equal(seen.queryEmbedRetryBudgetMs, 1200, 'unchanged');
});

test('an un-raced call (no timeout) sets no rerank deadline', async () => {
  let seen = null;
  const rr = buildProfileRawRetriever({ retrieveHybridRaw: async (_m, _f, o) => { seen = o; return { chunks: [] }; } }, docs, { tokenBudget: 1800, rerankSurface: 'manual' });
  await rr('tell me about the payout rewrite', { topK: 8 });
  assert.equal(Object.prototype.hasOwnProperty.call(seen, 'rerankDeadlineMs'), false);
});
