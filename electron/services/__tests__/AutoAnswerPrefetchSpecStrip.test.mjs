/**
 * A revealed prefetch must not carry the hidden <verification_spec>.
 *
 * Review finding on #541. `runWhatShouldISay` sets
 * `isCoding = !isSpeculative && …`, so a speculative run gets neither the
 * StreamingSpecStripper nor the live path's `stripVerificationSpec`. The
 * PROMPT, however, is not gated on `isSpeculative`: WhatToAnswerLLM passes
 * `isCodeVerificationEnabled()` straight to `formatAnswerPlanForPrompt`, which
 * knows nothing about speculation — so a coding prefetch is still told to emit
 * the hidden block. Discarding the text hid that; revealing it does not, and
 * `cleanAnswerArtifacts` (the only cleanup the reveal path runs) has no spec
 * handling. Without the strip the raw JSON reaches the UI and the session
 * record. Gated behind code verification (default OFF), never on the default path.
 *
 * Same poke-the-instance pattern as AutoAnswerPrefetchReveal2026_09_03.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

const QUESTION = 'Write a function that reverses a linked list in place.';
const BODY = 'Walk the list once, re-pointing each next pointer as you go, and return the new head.';
const SPEC = '\n<verification_spec>{"entry":"reverse","language":"python","cases":[]}</verification_spec>';

const untilIdle = (engine) => new Promise((resolve) => {
    if (engine.getActiveMode() === 'idle') return resolve();
    const handler = (mode) => { if (mode === 'idle') { engine.off('mode_changed', handler); resolve(); } };
    engine.on('mode_changed', handler);
});

test('a revealed prefetch never carries the hidden <verification_spec>', async () => {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    // The provider trails the hidden block after the answer, as it is told to
    // whenever code verification is on.
    engine.whatToAnswerLLM = { async *generateStream() { yield BODY; yield SPEC; } };
    engine.planSuggestionTrigger = async () => ({ kind: 'answer', reason: 'answerable_question', confidence: 0.9 });
    const finals = [];
    engine.on('suggested_answer', (answer) => finals.push(answer));

    engine.prefetchAutoAnswer('c1', QUESTION);
    await untilIdle(engine);
    await engine.runAutoAnswer({
        id: 'c1', text: QUESTION, confidence: 0.9, answerability: 0.9, dialogueAct: 'technical_question',
        isFollowUp: false, endpointSource: 'quiet_window', candidateGeneration: 1,
    }, { reuseSpeculative: true, context: '' });

    assert.equal(finals.length, 1, 'the prefetch was revealed');
    assert.ok(finals[0].includes('re-pointing'), 'the real answer survives the strip');
    assert.ok(!/verification_spec/i.test(finals[0]), `the hidden block must never reach the UI, got: ${finals[0]}`);
    assert.ok(!/"entry"/.test(finals[0]), 'nor its JSON payload');
    const stored = session.getFullUsage().at(-1)?.answer ?? '';
    assert.ok(!/verification_spec/i.test(stored), 'nor the session record');
    engine.reset();
});
