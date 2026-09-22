// Owner decision after a live A/B in a real dev session (2026-09-21): the low-confidence query rewrite is
// ON only for a turn with no hosted embedding provider answering. With natively embeddings it fired 0 of
// 14 times and the run was 14/14 without it; with the bundled embedder it took 9/12 to 10/12.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { bindQueryRewriter, queryRewriteScope } = await import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence/retrieval/rewriter-binding.js')).href);
const helper = { generateQueryRewrite: async () => '{"query":"reporting line director"}' };

describe('where the rewrite is bound', () => {
  test('hosted embeddings answering → NOT bound', () => assert.equal(bindQueryRewriter(helper, { usesHostedEmbeddings: () => true, env: {} }), undefined));
  test('bundled model / no embedder / demoted provider → bound, and it works', async () => {
    const rw = bindQueryRewriter(helper, { usesHostedEmbeddings: () => false, env: {} });
    assert.equal(typeof rw, 'function');
    assert.equal((await rw('Who would be my manager?')).query, 'reporting line director');
  });
  test('cannot tell (the check throws) → bound: that is the user it exists for', () => {
    assert.equal(typeof bindQueryRewriter(helper, { usesHostedEmbeddings: () => { throw new Error('not initialised'); }, env: {} }), 'function');
  });
  test('NATIVELY_RETRIEVAL_QUERY_REWRITE_SCOPE=all widens it to hosted users', () => {
    assert.equal(queryRewriteScope({ NATIVELY_RETRIEVAL_QUERY_REWRITE_SCOPE: ' ALL ' }), 'all');
    assert.equal(queryRewriteScope({}), 'local');
    assert.equal(typeof bindQueryRewriter(helper, { usesHostedEmbeddings: () => true, env: { NATIVELY_RETRIEVAL_QUERY_REWRITE_SCOPE: 'all' } }), 'function');
  });
  test('no helper, or a helper without the single-rung call → not bound', () => {
    assert.equal(bindQueryRewriter(null, { usesHostedEmbeddings: () => false }), undefined);
    assert.equal(bindQueryRewriter({}, { usesHostedEmbeddings: () => false }), undefined);
  });
});
