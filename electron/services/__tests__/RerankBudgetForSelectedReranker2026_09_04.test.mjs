/**
 * A reranker the user explicitly chose must be given time to actually finish.
 *
 * THE BUG. `ModeHybridRetriever` hardcoded `RERANK_BUDGET_MS = 1200` and raced
 * the rerank against it. That budget exists to protect a manual answer's
 * first-useful deadline from a cold 400MB local model load — a good reason for
 * the BUNDLED default, which the user never opted into.
 *
 * But it applied identically to a reranker the user went out of their way to
 * download, select, and verify. A real configuration on this machine:
 *
 *     provider=openrouter  model=qwen/qwen3-reranker-8b
 *     lastTest: { ok: true, latencyMs: 2052 }
 *
 * 2052ms against a 1200ms budget. It lost the race on every single query, the
 * candidate order was left untouched, and nothing anywhere reported it. Test
 * Connection said "ok". The code comment one gate above already describes this
 * class of failure — "with nothing anywhere reporting that it had not run" —
 * and the timeout was the second instance of it.
 *
 * So: the bundled default keeps 1200ms, and a reranker the user selected gets
 * a budget it can actually finish inside.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { resolveRerankBudgetMs, describeRerankLatencyFit, BUNDLED_RERANK_BUDGET_MS, SELECTED_RERANK_BUDGET_MS } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankBudget.js'));

describe('resolveRerankBudgetMs', () => {
  test('the bundled default keeps its 1200ms budget on both surfaces', () => {
    assert.equal(resolveRerankBudgetMs({ explicitlySelected: false, surface: 'live' }), 1200);
    assert.equal(resolveRerankBudgetMs({ explicitlySelected: false, surface: 'manual' }), 1200);
    assert.equal(BUNDLED_RERANK_BUDGET_MS, 1200);
  });

  test('a chosen reranker gets 3000ms on the live path', () => {
    assert.equal(resolveRerankBudgetMs({ explicitlySelected: true, surface: 'live' }), 3000);
    assert.equal(SELECTED_RERANK_BUDGET_MS.live, 3000);
  });

  test('a chosen reranker gets 8000ms on the manual path', () => {
    assert.equal(resolveRerankBudgetMs({ explicitlySelected: true, surface: 'manual' }), 8000);
    assert.equal(SELECTED_RERANK_BUDGET_MS.manual, 8000);
  });

  test('an unknown surface falls back to the tighter live budget, never the looser one', () => {
    // A caller that forgets to declare its surface must not be handed the 8s
    // manual budget on a latency-critical live turn.
    assert.equal(resolveRerankBudgetMs({ explicitlySelected: true, surface: undefined }), 3000);
    assert.equal(resolveRerankBudgetMs({ explicitlySelected: true }), 3000);
  });

  test('the real failing configuration now clears its budget', () => {
    // qwen/qwen3-reranker-8b measured at 2052ms — the case that motivated this.
    const measured = 2052;
    assert.ok(measured > resolveRerankBudgetMs({ explicitlySelected: false, surface: 'live' }),
      'precondition: it did NOT clear the bundled budget');
    assert.ok(measured < resolveRerankBudgetMs({ explicitlySelected: true, surface: 'live' }),
      'a selected reranker at 2052ms must now fit inside its budget');
  });
});

describe('the seam uses the resolver', () => {
  test('ModeHybridRetriever no longer hardcodes the rerank budget', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');
    assert.match(src, /resolveRerankBudgetMs/,
      'the rerank race must take its budget from the resolver');
    assert.doesNotMatch(src, /const\s+RERANK_BUDGET_MS\s*=\s*1200/,
      'the hardcoded 1200ms constant must be gone');
  });
});

describe('the manual path declares itself', () => {
  test('runHybridModeRetrieval asks for the manual rerank surface', async () => {
    // Behavioural, not a source match: capture what the wrapper actually passes.
    const { runHybridModeRetrieval } = require(
      path.join(repoRoot, 'dist-electron/electron/llm/modeHybridEligibility.js'));

    let retrievalOptions;
    const modesMgr = {
      buildRetrievedActiveModeContextBlockHybrid: async (...args) => {
        retrievalOptions = args[7];
        return 'block';
      },
    };

    await runHybridModeRetrieval(modesMgr, { query: 'q', budgetMs: null });

    assert.equal(retrievalOptions?.rerankSurface, 'manual',
      'the manual path must claim the manual budget, not fall back to the live one');
  });
});

describe('describeRerankLatencyFit', () => {
  test('a fast model fits everywhere and warrants no warning', () => {
    const fit = describeRerankLatencyFit(800);
    assert.equal(fit.fitsLive, true);
    assert.equal(fit.fitsManual, true);
    assert.equal(fit.warning, undefined);
  });

  test('the measured 2052ms model now fits both budgets', () => {
    const fit = describeRerankLatencyFit(2052);
    assert.equal(fit.fitsLive, true);
    assert.equal(fit.fitsManual, true);
    assert.equal(fit.warning, undefined);
  });

  test('a model that clears manual but not live says so, and says what still works', () => {
    const fit = describeRerankLatencyFit(4000);
    assert.equal(fit.fitsLive, false);
    assert.equal(fit.fitsManual, true);
    assert.match(fit.warning, /live/i);
    assert.match(fit.warning, /3000|3,000|3s/i);
  });

  test('a model that clears neither budget is reported as not affecting results', () => {
    const fit = describeRerankLatencyFit(9000);
    assert.equal(fit.fitsLive, false);
    assert.equal(fit.fitsManual, false);
    assert.match(fit.warning, /will not|won't|never/i);
  });

  test('a failed test with no latency yields no warning', () => {
    assert.equal(describeRerankLatencyFit(0).warning, undefined);
    assert.equal(describeRerankLatencyFit(undefined).warning, undefined);
  });
});

describe('the probe reports the fit', () => {
  test('the reranker test-connection handler attaches the latency fit', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    assert.match(src, /describeRerankLatencyFit/,
      'Test Connection must report whether the measured latency can actually rerank');
  });
});
