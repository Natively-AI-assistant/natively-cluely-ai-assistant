// A rerank the caller cannot wait for must not be STARTED (2026-09-07).
//
// MEASURED on a real session with Voyage rerank-2.5-lite (hosted, via
// OpenRouter) selected: the recap hotkey runs LLMHelper's legacy streamChat
// retrieval, which races the whole hybrid call against 1000ms
// (modeHybridEligibility.hybridRetrievalBudgetMs). Inside it the rerank got the
// selected-reranker MANUAL budget of 8000ms, took 1388ms, was billed
// ($0.00166 — the query was the whole 120s transcript, ~30x a normal turn),
// and its result was discarded because the outer race had already fallen back
// to sync lexical (`doc_grounded_hybrid_timeout`). Nothing surfaced it.
//
// The retriever now takes the caller's deadline and skips a rerank whose own
// budget cannot fit inside it. The un-raced site (chatWithGemini, budgetMs
// null) and the V3 ports (no race) are untouched: no deadline → always fits.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd());
const { rerankBudgetFitsDeadline, resolveRerankBudgetMs } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankBudget.js'));

describe('rerankBudgetFitsDeadline', () => {
  test('no deadline (an un-raced caller) always fits', () => {
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: 8000 }), true);
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: 8000, deadlineMs: null }), true);
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: 8000, deadlineMs: undefined }), true);
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: 8000, deadlineMs: 0 }), true);
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: 8000, deadlineMs: Number.NaN }), true);
  });

  test('the measured case: a selected reranker on the 1000ms raced legacy path does not fit', () => {
    const manual = resolveRerankBudgetMs({ explicitlySelected: true, surface: 'manual' });
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: manual, deadlineMs: 1000 }), false);
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: manual, deadlineMs: 2000 }), false, 'doc-grounded 2000ms is still shorter than 8000ms');
  });

  test('the bundled default fits a doc-grounded race but not the plain 1000ms one', () => {
    const bundled = resolveRerankBudgetMs({ explicitlySelected: false, surface: 'manual' });
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: bundled, deadlineMs: 2000 }), true);
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: bundled, deadlineMs: 1000 }), false);
  });

  test('a budget equal to the deadline fits', () => {
    assert.equal(rerankBudgetFitsDeadline({ budgetMs: 1000, deadlineMs: 1000 }), true);
  });
});

describe('the deadline is wired through, not just defined', () => {
  const src = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

  test('ModeHybridRetriever consults the deadline before entering the rerank race', () => {
    const s = src('electron/services/modes/ModeHybridRetriever.ts');
    const gate = s.indexOf("rerankBudgetFitsDeadline({ budgetMs: RERANK_BUDGET_MS, deadlineMs: rerankDeadlineMs })");
    const enter = s.indexOf("markH4HybridStage('rerank_enter'");
    assert.ok(gate > 0, 'the gate must exist');
    assert.ok(gate < enter, 'the gate must run BEFORE the rerank is started');
    assert.match(s, /markH4HybridStage\('rerank_skipped_deadline'/, 'a skipped rerank must be traceable');
    assert.match(s, /rerankDeadlineMs\?: number;/, 'retrieve() must accept the deadline');
  });

  test('ModeContextRetriever.retrieveHybrid forwards the deadline to the hybrid retriever (the hop the first live check found missing)', () => {
    // Measured 2026-09-07: with ModesManager and the eligibility module both
    // forwarding the deadline, the live recap STILL traced
    // `rerank_enter … budgetMs: 8000` — this wrapper re-lists the retrieve()
    // fields by hand and had dropped it.
    const s = src('electron/services/ModeContextRetriever.ts');
    const call = s.indexOf('this._hybridRetriever!.retrieve({');
    assert.ok(call > 0);
    const body = s.slice(call, s.indexOf('});', call));
    assert.match(body, /rerankSurface: options\.rerankSurface,/);
    assert.match(body, /rerankDeadlineMs: options\.rerankDeadlineMs,/);
  });

  test('ModesManager forwards the deadline on the doc-grounded branch (the other branch spreads retrievalOptions)', () => {
    const s = src('electron/services/ModesManager.ts');
    assert.match(s, /rerankDeadlineMs: retrievalOptions\?\.rerankDeadlineMs,/);
    assert.match(s, /\.\.\.retrievalOptions,/);
  });
});
