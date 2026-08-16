// electron/llm/__tests__/ModeHybridEligibility2026_08_13.test.mjs
//
// Phase 2 of the semantic-retrieval repair: LLMHelper's two hybrid-eligibility
// sites (chatWithGemini + streamChat) now share ONE module —
// electron/llm/modeHybridEligibility. This suite pins:
//   1. eligibility parity (rerank flag OR doc-grounded, both sites),
//   2. ARGUMENT parity: the two sites' invocation styles (no-race vs raced)
//      hand the hybrid wrapper byte-identical arguments and return identical
//      blocks — the "identical question + files → identical chunk set" gate,
//   3. the site-1 bug fix: retrievalOptions.forceDocumentGrounding is now
//      threaded (the old 5-arg call left it undefined, so the wrapper's
//      doc-grounded branch never fired on chatWithGemini),
//   4. race semantics: timeout → { block: null, timedOut: true } and the late
//      promise is absorbed (no unhandledRejection).
//
// Run with:
//   npm run build:electron
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/llm/__tests__/ModeHybridEligibility2026_08_13.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { shouldUseHybridRetrieval, runHybridModeRetrieval, hybridRetrievalBudgetMs } =
  await import(pathToFileURL(path.resolve(
    __dirname, '../../../dist-electron/electron/llm/modeHybridEligibility.js',
  )).href);

afterEach(() => { delete process.env.NATIVELY_RAG_LOCAL_RERANK; });

// ── 1. Eligibility ──────────────────────────────────────────────────────────

test('doc-grounded is ALWAYS eligible, regardless of the rerank flag', () => {
  process.env.NATIVELY_RAG_LOCAL_RERANK = 'off';
  assert.equal(shouldUseHybridRetrieval({ forceDocumentGrounding: true }), true);
});

test('non-doc-grounded follows the ragLocalRerank flag (the streamChat semantics, now canonical)', () => {
  process.env.NATIVELY_RAG_LOCAL_RERANK = 'off';
  assert.equal(shouldUseHybridRetrieval({ forceDocumentGrounding: false }), false,
    'prod posture: flag off + non-doc → lexical');
  process.env.NATIVELY_RAG_LOCAL_RERANK = 'on';
  assert.equal(shouldUseHybridRetrieval({ forceDocumentGrounding: false }), true,
    'dev/test posture: flag on → hybrid even without doc grounding');
});

test('budget policy: 2000ms doc-grounded, 1000ms otherwise', () => {
  assert.equal(hybridRetrievalBudgetMs(true), 2000);
  assert.equal(hybridRetrievalBudgetMs(false), 1000);
});

// ── 2+3. Argument parity across the two sites' invocation styles ────────────

function capturingModesMgr(block = '<mode_context>chunk-A chunk-B</mode_context>') {
  const calls = [];
  return {
    calls,
    buildRetrievedActiveModeContextBlockHybrid: async (...args) => { calls.push(args); return block; },
  };
}

const SAME_ARGS = {
  query: 'what methodology did the thesis use?',
  context: '[ME]: earlier turn',
  answerType: 'lecture_answer',
  forceDocumentGrounding: true,
  pinnedModeId: undefined,
  followUpReferentHint: undefined,
};

test('site-1 style (no race) and site-2 style (raced) hand the wrapper IDENTICAL arguments and return the same block', async () => {
  const site1 = capturingModesMgr();
  const site2 = capturingModesMgr();

  const r1 = await runHybridModeRetrieval(site1, { ...SAME_ARGS, budgetMs: null });
  const r2 = await runHybridModeRetrieval(site2, { ...SAME_ARGS, budgetMs: 2000 });

  assert.equal(site1.calls.length, 1);
  assert.equal(site2.calls.length, 1);
  assert.deepEqual(site1.calls[0], site2.calls[0],
    'both entry-point styles must produce byte-identical wrapper arguments');
  assert.equal(r1.block, r2.block, 'identical inputs → identical retrieved block');
  assert.equal(r1.timedOut, false);
  assert.equal(r2.timedOut, false);
});

test('retrievalOptions.forceDocumentGrounding is threaded (the chatWithGemini fix)', async () => {
  const mgr = capturingModesMgr();
  await runHybridModeRetrieval(mgr, { ...SAME_ARGS, budgetMs: null });
  const [query, context, tokenBudget, answerType, excludeCustomContext, pinnedModeId, allowRerank, retrievalOptions] = mgr.calls[0];
  assert.equal(query, SAME_ARGS.query);
  assert.equal(context, SAME_ARGS.context);
  assert.equal(tokenBudget, undefined, 'doc-grounded → undefined so the retriever auto-upgrades to DOC_GROUNDED_TOKEN_BUDGET');
  assert.equal(answerType, 'lecture_answer');
  assert.equal(excludeCustomContext, true);
  assert.equal(pinnedModeId, undefined);
  assert.equal(allowRerank, true);
  assert.equal(retrievalOptions?.forceDocumentGrounding, true,
    'the wrapper\'s doc-grounded branch keys off this — it MUST be present');
});

test('non-doc-grounded passes tokenBudget 1800 (both sites)', async () => {
  const mgr = capturingModesMgr();
  await runHybridModeRetrieval(mgr, { ...SAME_ARGS, forceDocumentGrounding: false, budgetMs: 1000 });
  assert.equal(mgr.calls[0][2], 1800);
  assert.equal(mgr.calls[0][7]?.forceDocumentGrounding, false);
});

// ── 4. Race semantics ───────────────────────────────────────────────────────

test('race timeout → { block: null, timedOut: true }, and the late promise is absorbed', async () => {
  let resolveLate;
  const mgr = {
    buildRetrievedActiveModeContextBlockHybrid: () => new Promise((res) => { resolveLate = res; }),
  };
  const r = await runHybridModeRetrieval(mgr, { ...SAME_ARGS, budgetMs: 10 });
  assert.equal(r.timedOut, true);
  assert.equal(r.block, null, 'timeout must be distinguishable from a successful empty retrieval');
  // Late completion must not throw or become an unhandled rejection.
  resolveLate('too late');
  await new Promise((r2) => setTimeout(r2, 5));
});

test('missing wrapper method → { block: null, timedOut: false } (caller falls back to lexical)', async () => {
  const r = await runHybridModeRetrieval({}, { ...SAME_ARGS, budgetMs: null });
  assert.deepEqual(r, { block: null, timedOut: false });
});
