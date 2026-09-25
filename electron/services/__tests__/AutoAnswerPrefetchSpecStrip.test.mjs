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
    process.env.NATIVELY_CODE_VERIFY = '1';
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
    delete process.env.NATIVELY_CODE_VERIFY;
    engine.reset();
});

test('an adopted streaming prefetch strips verification_spec from pending buffer', async () => {
    process.env.NATIVELY_CODE_VERIFY = '1';
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);

    const tokens = [];
    const finals = [];
    engine.on('suggested_answer_token', (token) => tokens.push(token));
    engine.on('suggested_answer', (answer) => finals.push(answer));

    // Reveal an adopted prefetch that streamed live with pending buffer containing verification_spec
    engine.revealSpeculativeAnswer(
        {
            generationId: 2,
            question: QUESTION,
            confidence: 0.9,
            text: 'Valid code snippet\n<verification_spec>{"entry":"rev"}</verification_spec>',
            writeDecision: { policy: 'store_conversational_only' },
        },
        true,
        {
            emitted: true,
            pendingBuffer: 'Valid code snippet\n<verification_spec>{"entry":"rev"}</verification_spec>',
        },
    );

    assert.equal(tokens.length, 1, 'pending buffer emitted');
    assert.ok(tokens[0].includes('Valid code snippet'));
    assert.ok(!tokens[0].includes('verification_spec'), 'pending buffer must not contain verification_spec');
    assert.equal(finals.length, 1, 'final answer emitted');
    assert.ok(!finals[0].includes('verification_spec'), 'final must not contain verification_spec');
    engine.reset();
    delete process.env.NATIVELY_CODE_VERIFY;
});

test('an adopted streaming prefetch emits suggested_answer_discard when empty after strip', async () => {
    process.env.NATIVELY_CODE_VERIFY = '1';
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);

    const discards = [];
    const finals = [];
    engine.on('suggested_answer_discard', (reason) => discards.push(reason));
    engine.on('suggested_answer', (answer) => finals.push(answer));

    // Reveal an adopted prefetch where text consists entirely of verification_spec
    engine.revealSpeculativeAnswer(
        {
            generationId: 3,
            question: QUESTION,
            confidence: 0.9,
            text: '<verification_spec>{"entry":"rev"}</verification_spec>',
            writeDecision: { policy: 'store_conversational_only' },
        },
        true,
        {
            emitted: true,
            pendingBuffer: '',
        },
    );

    assert.equal(finals.length, 0, 'no final answer emitted for empty text');
    assert.equal(discards.length, 1, 'discard event emitted');
    assert.equal(discards[0], 'empty_after_strip', 'correct discard reason emitted');
    engine.reset();
    delete process.env.NATIVELY_CODE_VERIFY;
});

test('when code verification is disabled, literal <verification_spec in examples is preserved', async () => {
    delete process.env.NATIVELY_CODE_VERIFY;
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);

    const finals = [];
    engine.on('suggested_answer', (answer) => finals.push(answer));

    const exampleAnswer = 'Here is an XML example: <verification_spec>test</verification_spec> and more code.';
    engine.revealSpeculativeAnswer(
        {
            generationId: 4,
            question: QUESTION,
            confidence: 0.9,
            text: exampleAnswer,
            writeDecision: { policy: 'store_conversational_only' },
        },
        true,
        {
            emitted: true,
            pendingBuffer: '',
        },
    );

    assert.equal(finals.length, 1);
    assert.equal(finals[0], exampleAnswer, 'unmodified when verification is disabled');
    engine.reset();
});
