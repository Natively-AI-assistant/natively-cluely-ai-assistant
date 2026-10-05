/**
 * An adopted prefetch that STREAMS must not paint the hidden <verification_spec>.
 *
 * AutoAnswerPrefetchSpecStrip covers the FINAL: revealSpeculativeAnswer strips
 * the block from the text it stores and emits. Since 2026-09-22 an adopted
 * in-flight prefetch also paints live (paintBuffered) and flushes its held
 * prefix at completion (`pendingBuffer`), and neither went through a stripper:
 * a speculative run is never `isCoding`, so it gets no StreamingSpecStripper.
 * With "Verify coding answers" on, a code-first answer (coding_question_answer
 * opens with a fence, so the scaffold hold does not catch it) painted its
 * trailing test-case block into the answer row until the final replaced it.
 * Review finding on PR #597 (Greptile, 2026-09-22).
 *
 * Its own file because verificationEnabled caches the env value on first read:
 * it must be set before anything asks.
 */
process.env.NATIVELY_CODE_VERIFY = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

const QUESTION = 'Write a React hook that debounces a value.';
// Code-first, as the implementation contract asks: no leading heading, so it paints.
const CODE_PREFIX = "```tsx\nimport { useEffect, useState } from 'react';\n\n// Returns `value` once it has stopped changing for `delayMs`.\nexport function useDebounced<T>(value: T, delayMs: number): T {\n  const [debounced, setDebounced] = useState(value);\n";
const CODE_TAIL = '  useEffect(() => {\n    const id = setTimeout(() => setDebounced(value), delayMs);\n    return () => clearTimeout(id);\n  }, [value, delayMs]);\n  return debounced;\n}\n```\n\nThe timer restarts on every change, so only the last value in the window lands.';
const BODY = CODE_PREFIX + CODE_TAIL;
// Long enough (>= the 160-char paint threshold) to be painted LIVE.
const LONG_SPEC = '\n<verification_spec>{"entry":"useDebounced","language":"typescript","cases":[{"input":[1,100],"expected":1},{"input":[2,100],"expected":2},{"input":[3,100],"expected":3}]}</verification_spec>';
// Short enough to still sit in the prefix buffer when the stream ends.
const SHORT_SPEC = '\n<verification_spec>{"entry":"useDebounced","cases":[]}</verification_spec>';

const flush = () => new Promise((r) => setImmediate(r));

function untilIdle(engine) {
    return new Promise((resolve) => {
        if (engine.getActiveMode() === 'idle') return resolve();
        const handler = (mode) => { if (mode === 'idle') { engine.off('mode_changed', handler); resolve(); } };
        engine.on('mode_changed', handler);
    });
}

/** The provider yields `chunks`, holding the LAST one until `gate` resolves. */
async function makeEngine(chunks, gate) {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.whatToAnswerLLM = {
        async *generateStream() {
            for (let i = 0; i < chunks.length; i++) {
                if (gate && i === chunks.length - 1) await gate;
                yield chunks[i];
            }
        },
    };
    engine.planSuggestionTrigger = async () => ({ kind: 'answer', reason: 'answerable_question', confidence: 0.9 });
    const finals = [];
    const tokens = [];
    const ids = [];
    engine.on('suggested_answer', (answer, _q, _c, generationId) => finals.push({ answer, generationId }));
    engine.on('suggested_answer_token', (token, _q, _c, generationId) => { tokens.push(token); ids.push(generationId); });
    return { engine, session, finals, tokens, ids };
}

function dispatch(engine, id) {
    return engine.runAutoAnswer({
        id, text: QUESTION, confidence: 0.9, answerability: 0.9, dialogueAct: 'technical_question',
        isFollowUp: false, endpointSource: 'quiet_window', candidateGeneration: 1,
    }, { reuseSpeculative: true, context: '' });
}

/** Prefetch, adopt it while the last chunk is held, then let the stream finish. */
async function adoptMidStream(chunks) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const h = await makeEngine(chunks, gate);
    h.engine.prefetchAutoAnswer('s1', QUESTION);
    await flush(); await flush();
    assert.deepEqual(h.tokens, [], 'unadopted, the prefetch paints nothing');
    await dispatch(h.engine, 's1');
    await flush(); await flush();
    assert.ok(h.tokens.length >= 1, 'adoption painted the text generated so far (the path under test)');
    release();
    await untilIdle(h.engine);
    await flush();
    return h;
}

function assertNoSpec(text, where) {
    assert.ok(!/verification_spec/i.test(text), `${where} carries the hidden block: ${JSON.stringify(text.slice(-240))}`);
    assert.ok(!/"entry"/.test(text), `${where} carries its JSON payload`);
}

test('a spec that streams in AFTER adoption is never painted', async () => {
    const { engine, finals, tokens, ids } = await adoptMidStream([CODE_PREFIX, CODE_TAIL, LONG_SPEC]);
    assertNoSpec(tokens.join(''), 'the live stream');
    assert.equal(tokens.join('').trimEnd(), BODY.trimEnd(), 'every visible character of the answer was painted, once');
    assert.equal(finals.length, 1);
    assertNoSpec(finals[0].answer, 'the final');
    assert.equal(new Set(ids).size, 1, 'one row');
    assert.equal(finals[0].generationId, ids[0], 'and the final replaces it');
    engine.reset();
});

test('a spec still held in the prefix buffer at completion is not flushed into the row', async () => {
    const { engine, finals, tokens } = await adoptMidStream([CODE_PREFIX, CODE_TAIL, SHORT_SPEC]);
    assertNoSpec(tokens.join(''), 'the completion flush');
    assert.equal(tokens.join('').trimEnd(), BODY.trimEnd());
    assert.equal(finals.length, 1);
    assertNoSpec(finals[0].answer, 'the final');
    engine.reset();
});

test('with verification on, an answer that has no spec streams complete — the stripper\'s held tail is flushed', async () => {
    const { engine, finals, tokens } = await adoptMidStream([CODE_PREFIX, CODE_TAIL, '\n\nOne more line after the explanation.']);
    // StreamingSpecStripper holds back the last 18 characters of every push in
    // case they begin the tag; a completion that skipped finish() lost them.
    assert.equal(tokens.join(''), BODY + '\n\nOne more line after the explanation.');
    assert.equal(finals.length, 1);
    engine.reset();
});

test('a painted row whose answer strips to nothing is discarded, not left open', async () => {
    const { engine, finals } = await makeEngine([]);
    const discards = [];
    engine.on('suggested_answer_discard', (reason) => discards.push(reason));
    const finished = (generationId) => ({
        generationId, question: QUESTION, confidence: 0.9,
        text: '<verification_spec>{"entry":"x","cases":[]}</verification_spec>',
        writeDecision: { policy: 'store_conversational_only' },
    });

    engine.revealSpeculativeAnswer(finished(7), true, { emitted: true, pendingBuffer: '' });
    assert.deepEqual(finals, [], 'no final for an empty answer');
    // Before: a bare return. The renderer had opened a streaming row for this
    // generation and never got its final or a discard, so it stayed open.
    assert.deepEqual(discards, ['empty_after_strip']);

    engine.revealSpeculativeAnswer(finished(8), true, undefined);
    assert.deepEqual(discards, ['empty_after_strip'], 'nothing was painted, so there is no row to discard');
    engine.reset();
});
