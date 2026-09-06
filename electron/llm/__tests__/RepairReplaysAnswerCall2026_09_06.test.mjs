// electron/llm/__tests__/RepairReplaysAnswerCall2026_09_06.test.mjs
//
// A post-answer repair was dispatched as
//
//     streamChat(repairPrompt, undefined, undefined, undefined, true, true)
//
// while the answer that produced the text it was repairing had the transcript,
// the screenshot, the reference files, the realtime prompt, the mode prompt and
// the evidence pack. So the repair was asked to improve an answer whose evidence
// it could not see — on a screenshot turn it could not see the screen at all —
// and with skipModeInjection still true it could not pull any of it back. It was
// reasoning from the prior answer's text alone.
//
// WhatToAnswerLLM already composes the answer as one argument tuple with
// ignoreKnowledgeMode and skipModeInjection BOTH true, which means everything is
// already inside that tuple's message and system prompt rather than injected
// downstream. So the tuple is self-contained: remembering it and replaying it
// gives a repair the same turn at no retrieval cost.
//
// Verified on the wire in scratchpad/repro-repair-wire.js — a real dist-electron
// bundle against a local HTTP server, inspecting the repair request's actual
// body. Before: only the repair instruction. After: transcript, reference text,
// realtime prompt, system prompt, repair instruction, and a base64 image
// payload. This file pins the semantics that probe cannot: the failure modes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Module, { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const cjs = createRequire(path.join(root, 'package.json'));

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-replay-test-'));
const electronStub = new Module('electron');
electronStub.exports = {
  app: {
    isReady: () => true,
    getPath: (n) => (n === 'userData' ? tmpUserData : os.tmpdir()),
    getAppPath: () => root,
    getName: () => 'natively-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
  },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: async () => [] },
  net: { isOnline: () => true },
};
electronStub.loaded = true;
cjs.cache[cjs.resolve('electron')] = electronStub;

const { LLMHelper } = cjs(path.join(root, 'dist-electron/electron/LLMHelper.js'));
const {
  repairDeadlineMs, REPAIR_VISION_MIN_FIRST_USEFUL_MS,
  regenerationBudgetMs, LIVE_TURN_TOTAL_BUDGET_MS, REGENERATION_MIN_SHARE_OF_ROUTE,
} = cjs(path.join(root, 'dist-electron/electron/llm/index.js'));

// The measured tail this repo already pins for a vision first token.
const OBSERVED_MAX_SUCCESSFUL_TTFT_MS = 11_629;

const ANSWER_MSG = 'TRANSCRIPT + REFERENCE FILES + REALTIME PROMPT, all composed';
const SYSTEM = 'the answer system prompt';
const ROUTE = { answerType: 'general_meeting_answer', pinnedModeId: 'mode-7' };

function helperWithRememberedAnswer() {
  const h = new LLMHelper(undefined, false);
  const turn = new AbortController();
  const args = [ANSWER_MSG, ['/tmp/shot.png'], 'ctx', SYSTEM, true, true, ['reference_files'], turn.signal, 4096, ROUTE];
  h.rememberAnswerCall(turn.signal, args);
  return { h, turn, args };
}

describe('a repair inherits the turn the answer had', () => {
  test('every context-bearing argument survives the replay', () => {
    const { h, turn } = helperWithRememberedAnswer();
    const repairSignal = new AbortController().signal;
    const r = h.replayAnswerCall(turn.signal, 'REPAIR ME', repairSignal);

    assert.ok(r, 'the turn had a remembered answer');
    assert.deepEqual(r[1], ['/tmp/shot.png'], 'the screenshot must reach the repair');
    assert.equal(r[2], 'ctx');
    assert.equal(r[3], SYSTEM, 'the answer system prompt must reach the repair');
    assert.deepEqual(r[6], ['reference_files'], 'the data scopes must reach the repair');
    assert.equal(r[8], 4096, 'the thinking budget must reach the repair');
    assert.deepEqual(r[9], ROUTE, 'the route decision must reach the repair');
  });

  test('the repair instruction is APPENDED, not substituted for the context', () => {
    const { h, turn } = helperWithRememberedAnswer();
    const r = h.replayAnswerCall(turn.signal, 'REPAIR ME', new AbortController().signal);
    assert.ok(r[0].includes(ANSWER_MSG), 'the answer prompt is the context the repair needs');
    assert.ok(r[0].includes('REPAIR ME'), 'the repair instruction must survive');
    assert.ok(r[0].indexOf(ANSWER_MSG) < r[0].indexOf('REPAIR ME'), 'the instruction comes last');
  });

  test('the abort signal is the REPAIR’s, never the answer’s', () => {
    // By the time a repair runs, the answer's controller is often already
    // aborted — frequently that is WHY the repair is running. Replaying it
    // yields zero tokens, trips no useful-threshold, and looks exactly like the
    // old behaviour while saying nothing.
    const { h, turn } = helperWithRememberedAnswer();
    turn.abort();
    const mine = new AbortController().signal;
    const r = h.replayAnswerCall(turn.signal, 'REPAIR ME', mine);
    assert.equal(r[7], mine);
    assert.equal(r[7].aborted, false, 'a replayed aborted signal would silently produce nothing');
  });
});

describe('the replay is scoped to its own turn', () => {
  test('a different turn inherits nothing', () => {
    // Replaying turn N-1 on turn N hands the repair a stale transcript and a
    // stale screenshot — strictly worse than the `undefined` it passed before.
    const { h } = helperWithRememberedAnswer();
    assert.equal(h.replayAnswerCall(new AbortController().signal, 'REPAIR', undefined), null);
  });

  test('no remembered answer returns null so the caller keeps its own arguments', () => {
    // A live branch, not an edge case: the ScopeFallback route and the
    // Context-OS refuse/clarify terminals never compose an answer call.
    const h = new LLMHelper(undefined, false);
    assert.equal(h.replayAnswerCall(new AbortController().signal, 'REPAIR', undefined), null);
    assert.equal(h.replayAnswerCall(undefined, 'REPAIR', undefined), null);
    assert.equal(h.replayAnswerCall(null, 'REPAIR', undefined), null);
  });

  test('remembering is a no-op without a key rather than throwing', () => {
    const h = new LLMHelper(undefined, false);
    h.rememberAnswerCall(undefined, ['m']);
    h.rememberAnswerCall(null, ['m']);
    assert.equal(h.replayAnswerCall(undefined, 'x', undefined), null);
  });
});

describe('the inherited prompt cannot blow the context budget', () => {
  test('an oversized answer prompt is trimmed but the instruction is not', () => {
    // The answer prompt was already fitted to the model's context window, so
    // appending pushes past what it was fitted to. Trim the inherited half —
    // never the instruction, which is the only part that says what to do.
    const h = new LLMHelper(undefined, false);
    const turn = new AbortController();
    const huge = 'x'.repeat(80_000);
    h.rememberAnswerCall(turn.signal, [huge, undefined, undefined, undefined, true, true, [], turn.signal]);
    const r = h.replayAnswerCall(turn.signal, 'REPAIR ME PLEASE', new AbortController().signal);
    assert.ok(r[0].length < huge.length, 'the inherited prompt must be trimmed');
    assert.ok(r[0].includes('REPAIR ME PLEASE'), 'the repair instruction must never be trimmed away');
    assert.ok(/truncated for the repair pass/.test(r[0]), 'the trim must be visible to the model');
  });
});

describe('an image-bearing repair gets a window it can actually finish in', () => {
  test('replayedAnswerHasImages reports what the repair will carry', () => {
    const { h, turn } = helperWithRememberedAnswer();
    assert.equal(h.replayedAnswerHasImages(turn.signal), true);

    const h2 = new LLMHelper(undefined, false);
    const t2 = new AbortController();
    h2.rememberAnswerCall(t2.signal, ['m', undefined, undefined, undefined, true, true, [], t2.signal]);
    assert.equal(h2.replayedAnswerHasImages(t2.signal), false);
    assert.equal(h2.replayedAnswerHasImages(new AbortController().signal), false);
  });

  test('a vision repair clears the measured vision tail', () => {
    // These budgets were sized when a repair was text-only, because that is all
    // it was. Now that it inherits the screenshot it pays image encode +
    // multimodal prefill — p50 5.6s, tail 11.6s. A 7000ms window there can never
    // finish, which would re-create the wasted-repair defect from the other
    // direction.
    const ms = repairDeadlineMs({ hasImages: true, minMs: 7000 });
    assert.ok(ms > OBSERVED_MAX_SUCCESSFUL_TTFT_MS,
      `a vision repair gets ${ms}ms but the measured tail is ${OBSERVED_MAX_SUCCESSFUL_TTFT_MS}ms`);
    assert.equal(ms, REPAIR_VISION_MIN_FIRST_USEFUL_MS);
  });

  test('a text repair is unaffected by the vision floor', () => {
    assert.equal(repairDeadlineMs({ hasImages: false, minMs: 7000 }), 7000);
    assert.equal(repairDeadlineMs({ minMs: 7000 }), 7000);
  });

  test('local still wins over the vision floor', () => {
    assert.ok(repairDeadlineMs({ isLocal: true, hasImages: true, minMs: 7000 }) > REPAIR_VISION_MIN_FIRST_USEFUL_MS);
  });
});

describe('every repair call site actually replays', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('IntelligenceEngine routes all six repairs through repairCallArgs', () => {
    const src = strip(fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8'));
    const spread = (src.match(/\.\.\.this\.repairCallArgs\(/g) || []).length;
    assert.equal(spread, 6, `expected 6 replayed repair sites, found ${spread}`);
    // None may still pass the old hand-written argument list.
    assert.equal(/streamChat\(\s*\n\s*\w+,\s*\n\s*undefined,\s*\n\s*undefined,/.test(src), false,
      'a repair site is still passing undefined for images and context');
  });

  test('ipcHandlers routes all five repairs through repairCallArgs', () => {
    const src = strip(fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8'));
    const n = (src.match(/repairCallArgs\(llmHelper,/g) || []).length;
    assert.equal(n, 5, `expected 5 replayed repair sites, found ${n}`);
  });

  test('the answer paths remember, and only the answer paths', () => {
    const wta = strip(fs.readFileSync(path.join(root, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8'));
    const ipc = strip(fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8'));
    assert.equal((wta.match(/rememberAnswerCall\?\.\(/g) || []).length, 1, 'WTA remembers its answer call once');
    assert.equal((ipc.match(/rememberAnswerCall\?\.\(/g) || []).length, 1, 'manual chat remembers its answer call once');
    // A repair must never overwrite the copy it is about to read.
    const ie = strip(fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8'));
    assert.equal(/rememberAnswerCall/.test(ie), false, 'IntelligenceEngine must only ever replay, never remember');
  });
});


describe('a REGENERATION is not a repair, and the difference is the prompt', () => {
  // Two different failures. A post-answer REPAIR has an answer to improve, so it
  // appends an instruction saying how. A REGENERATION has no answer at all — the
  // request was correct and simply did not come back — so the second attempt is
  // the same request again. Appending anything there would make attempt 2 a
  // different question from the one the user asked.
  test('retryAnswerCall re-sends the prompt BYTE-IDENTICAL', () => {
    const { h, turn } = helperWithRememberedAnswer();
    const r = h.retryAnswerCall(turn.signal, new AbortController().signal);
    assert.equal(r[0], ANSWER_MSG, 'a regeneration must not alter the question');
    // And the contrast with the repair path, which deliberately does alter it.
    const repaired = h.replayAnswerCall(turn.signal, 'REPAIR ME', new AbortController().signal);
    assert.notEqual(repaired[0], ANSWER_MSG);
    assert.ok(repaired[0].startsWith(ANSWER_MSG));
  });

  test('everything except the abort signal is carried through untouched', () => {
    const { h, turn, args } = helperWithRememberedAnswer();
    const mine = new AbortController().signal;
    const r = h.retryAnswerCall(turn.signal, mine);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 9]) {
      assert.deepEqual(r[i], args[i], `argument ${i} must survive the regeneration verbatim`);
    }
    assert.equal(r[7], mine, 'only the signal changes — the original was aborted by the deadline cleanup');
  });

  test('an unremembered turn cannot be regenerated', () => {
    const { h } = helperWithRememberedAnswer();
    assert.equal(h.retryAnswerCall(new AbortController().signal, undefined), null);
    assert.equal(h.retryAnswerCall(null, undefined), null);
  });
});

describe('the regeneration budget bounds the PAIR of attempts, not each half', () => {
  test('a fresh turn gets its whole route budget', () => {
    assert.equal(regenerationBudgetMs({ routeBudgetMs: 8000, elapsedMs: 0 }), 8000);
  });

  test('the turn total caps the second attempt', () => {
    // 15s user endpoint + a full second 15s would be 30s. The total is 25s.
    const ms = regenerationBudgetMs({ routeBudgetMs: 15000, elapsedMs: 15000 });
    assert.ok(ms > 0 && ms <= 10000, `expected the remainder of the turn total, got ${ms}`);
    assert.equal(15000 + ms <= LIVE_TURN_TOTAL_BUDGET_MS, true);
  });

  test('a regeneration that could only fail is not attempted', () => {
    // A vision turn that already spent 20s of the 25s total would get 5s, far
    // under the 11.6s tail a vision first token is measured at. Spending 5s to
    // learn nothing is worse than the canned line.
    assert.equal(regenerationBudgetMs({ routeBudgetMs: 20000, elapsedMs: 20000 }), 0);
    assert.equal(regenerationBudgetMs({ routeBudgetMs: 30000, elapsedMs: 30000 }), 0);
  });

  test('the share floor is what makes that call, and it is a real fraction', () => {
    assert.ok(REGENERATION_MIN_SHARE_OF_ROUTE > 0 && REGENERATION_MIN_SHARE_OF_ROUTE <= 1);
    const route = 10000;
    const justEnough = regenerationBudgetMs({
      routeBudgetMs: route,
      elapsedMs: LIVE_TURN_TOTAL_BUDGET_MS - route * REGENERATION_MIN_SHARE_OF_ROUTE,
    });
    assert.ok(justEnough > 0, 'exactly at the floor should still run');
    const justUnder = regenerationBudgetMs({
      routeBudgetMs: route,
      elapsedMs: LIVE_TURN_TOTAL_BUDGET_MS - route * REGENERATION_MIN_SHARE_OF_ROUTE + 1,
    });
    assert.equal(justUnder, 0, 'just under the floor should decline');
  });

  test('no combination can exceed the turn total', () => {
    for (const routeBudgetMs of [8000, 13000, 15000, 20000, 30000]) {
      for (const elapsedMs of [0, 5000, 12000, 19000, 24000, 40000]) {
        const ms = regenerationBudgetMs({ routeBudgetMs, elapsedMs });
        if (ms > 0) {
          assert.ok(elapsedMs + ms <= LIVE_TURN_TOTAL_BUDGET_MS,
            `route ${routeBudgetMs} after ${elapsedMs} gave ${ms}, total ${elapsedMs + ms}`);
        }
      }
    }
  });
});

describe('the WTA failure path regenerates before it gives up', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ie = strip(fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8'));

  test('the canned no-answer line is reached only after a regeneration attempt', () => {
    const regenAt = ie.indexOf('retryAnswerCall');
    const cannedAt = ie.indexOf('did not produce an answer in time');
    assert.ok(regenAt > 0, 'the WTA failure path must attempt a regeneration');
    assert.ok(regenAt < cannedAt, 'the regeneration must be attempted BEFORE the canned line');
  });

  test('the regeneration times itself rather than inheriting the failed attempt', () => {
    // Reusing attempt 1's start records the whole dead budget as this endpoint's
    // first-token cost — the upward ratchet the adaptive budget guards against.
    assert.match(ie, /answerStreamStartedAt = Date\.now\(\);\s*\n\s*recordedFirstToken = false;/,
      'the regeneration must reset the latency start and the recorded flag');
    assert.equal(/const answerStreamStartedAt/.test(ie), false,
      'answerStreamStartedAt must be reassignable for the regeneration to time itself');
  });

  test('supersession is re-checked after the regeneration, not only before', () => {
    assert.match(ie, /shouldAbort: \(\) => this\.currentGenerationId !== generationId/);
    assert.match(ie, /regenUsable = this\.currentGenerationId === generationId/);
  });

  test('the trace can distinguish "retried and succeeded" from "was just slow"', () => {
    for (const marker of ['answer_regeneration_started', 'answer_regeneration_succeeded', 'answer_regeneration_failed']) {
      assert.ok(ie.includes(marker), `missing trace marker ${marker}`);
    }
  });
});

describe('a selected single provider now fails over — or retries itself in parallel', () => {
  // Until 2026-09-06 the Custom / cURL / LiteLLM / NVIDIA NIM branches returned
  // unconditionally, so a user on their own gateway had NO failover on the text
  // path. Worse, the only mechanism in LLMHelper that turns SLOWNESS into
  // failover is the Natively TTFT race, which those users never reach: a gateway
  // that connects then goes quiet throws nothing, so no catch fires and nothing
  // falls through. The outer live deadline was the only thing that noticed, and
  // a deadline can only give up.
  //
  // Behaviour is proven in scratchpad/repro-failover.js against a real HTTP
  // server: a stalled gateway with a spare keyed fails over at 9s and the spare
  // answers; with NO spare the same gateway is re-issued in parallel and the
  // second connection answers at 9008ms; a healthy gateway is called exactly
  // once. These pin the wiring that probe cannot re-run in CI.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const llm = strip(fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8'));
  const ie = strip(fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8'));

  test('every user-endpoint text branch goes through the fallback engine', () => {
    const n = (llm.match(/this\.streamSelectedProviderWithFailover\(/g) || []).length;
    assert.equal(n, 3, `custom, litellm and nvidia_nim must all route through it — found ${n}`);
  });

  test('the rung budget comes from the route table, NOT the 2.5s text default', () => {
    // DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs is 2_500, sized for the shipped
    // chain. Applying it to this population would fail over at 2.5s against a
    // measured 11.6s tail, silently undoing the whole route table.
    assert.match(llm, /\.\.\.DEFAULT_TEXT_FALLBACK_CONFIG,[\s\S]{0,400}?ttftTimeoutMs: budgetMs/,
      'the engine config must override ttftTimeoutMs with the route budget');
    assert.match(llm, /const budgetMs = totalHardTimeoutMs\(\{/,
      'the budget must come from the shared route table');
  });

  test('the hedge only arms when there is nothing to fail over to', () => {
    assert.match(llm, /const hedging = spares\.length === 0;/);
    assert.match(llm, /hedgeEnabled: hedging/);
    assert.match(llm, /if \(hedging\) \{[\s\S]{0,600}?hedgeWith = \{/,
      'hedgeWith must only be attached when no spare rung exists');
  });

  test('the hedge partner gets its own id so the primary breaker cannot suppress it', () => {
    assert.match(llm, /id: `\$\{opts\.id\}#hedge`/);
  });

  test('one attempt per rung, so a hedged turn is two calls and not four', () => {
    assert.match(llm, /maxAttempts: 1,/,
      'the engine default of 2 would make a hedged single-provider turn four billed requests');
  });

  test('a rung with a spare behind it waits LESS than one without', () => {
    assert.match(llm, /const primaryTtftMs = spares\.length > 0 \? this\.hedgeDelayForBudget\(budgetMs\) : budgetMs;/,
      'waiting the full ceiling before failing over makes failover as slow as giving up');
  });

  test('the hedge delay uses the adaptive max, not a second latency statistic', () => {
    // The engine's own EWMA input is absent on this path (the terminal branch
    // never populated textHealth), and a second statistic for one provider is
    // the recurring mistake in this area.
    assert.match(llm, /hedgeDelayForBudget\(budgetMs: number\)[\s\S]{0,400}?this\.observedAnswerLatency\(\)/);
    assert.match(llm, /hedgeDelayDefaultMs: this\.hedgeDelayForBudget\(budgetMs\)/);
  });

  test('IE does not ALSO regenerate a route the engine already retried', () => {
    // Otherwise a single-provider user pays a third identical call on their own
    // key for a gateway that has already been tried twice concurrently.
    assert.match(ie, /engineAlreadyRetried[\s\S]{0,300}?isUsingUserEndpoint\(\) === true/);
    assert.match(ie, /const regenBudget = engineAlreadyRetried \? 0 :/);
  });
});
