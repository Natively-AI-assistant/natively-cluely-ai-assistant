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
const { repairDeadlineMs, REPAIR_VISION_MIN_FIRST_USEFUL_MS } = cjs(path.join(root, 'dist-electron/electron/llm/index.js'));

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
