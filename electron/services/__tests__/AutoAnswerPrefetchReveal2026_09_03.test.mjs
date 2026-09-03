/**
 * Auto Answer prefetch adoption — live session 2026-09-03 (meeting gen 13).
 *
 * Two real questions were judged answerable (a=0.9 and a=1.0) and neither was
 * ever shown. Both died on the speculative prefetch:
 *
 *   13-q4  The prefetch FINISHED two seconds before the judge ruled. Its text
 *          was returned to a `.catch`-only caller and discarded; the dispatch
 *          then "adopted" a stream that no longer existed and returned. And
 *          because completion stamped lastTriggerTime, the planner's 3 s
 *          cooldown would have silenced the dispatch anyway.
 *   13-q6  The prefetch was STILL STREAMING when the verdict landed. The
 *          engine reported itself busy (mode what_to_say), the dispatch parked,
 *          and the next candidate superseded it 195 ms later.
 *
 * A speculative stream never renders (by design — the judge may say no), so
 * adoption is the ONLY moment it can become visible. These tests pin that a
 * prefetch adopted in either state reaches the renderer and the session.
 *
 * Same poke-the-instance pattern as AutoAnswerEngineReview2026_08_24.test.mjs:
 * a fake whatToAnswerLLM stream, the real runWhatShouldISay / adoption path.
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

const QUESTION = 'Why did you choose PostgreSQL over the alternatives for this service?';
const ANSWER = 'I picked PostgreSQL for the ecosystem and the tooling around it, and because the team already knew it well.';

const flush = () => new Promise((r) => setImmediate(r));

/**
 * An engine whose What-to-Answer provider yields `chunks`. When `gate` is
 * given the stream waits on it before its last chunk, so a test can hold a
 * prefetch open and dispatch INTO it.
 */
async function makeEngine({ chunks = [ANSWER], gate = null } = {}) {
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
    // The planner classifies intent through the ONNX worker in production; the
    // decision under test is what happens AFTER it says "answer".
    engine.planSuggestionTrigger = async () => ({ kind: 'answer', reason: 'answerable_question', confidence: 0.9 });
    const finals = [];
    const tokens = [];
    engine.on('suggested_answer', (answer, question, confidence, generationId) => finals.push({ answer, question, generationId }));
    engine.on('suggested_answer_token', (token) => tokens.push(token));
    return { engine, session, finals, tokens };
}

/** Resolves once the engine reports idle (the speculative run finished). */
function untilIdle(engine) {
    return new Promise((resolve) => {
        if (engine.getActiveMode() === 'idle') return resolve();
        const handler = (mode) => { if (mode === 'idle') { engine.off('mode_changed', handler); resolve(); } };
        engine.on('mode_changed', handler);
    });
}

function dispatch(engine, id, reuseSpeculative = true) {
    return engine.runAutoAnswer({
        id, text: QUESTION, confidence: 0.9, answerability: 0.9, dialogueAct: 'technical_question',
        isFollowUp: false, endpointSource: 'quiet_window', candidateGeneration: 1,
    }, { reuseSpeculative, context: '' });
}

test('13-q4: a prefetch that finished before the judge ruled is revealed on dispatch, not discarded', async () => {
    const { engine, session, finals, tokens } = await makeEngine();
    engine.prefetchAutoAnswer('q4', QUESTION);
    assert.equal(engine.getActiveMode(), 'what_to_say', 'the prefetch is streaming');
    await untilIdle(engine);
    assert.deepEqual(finals, [], 'a speculative stream never renders on its own');

    await dispatch(engine, 'q4');
    assert.equal(finals.length, 1, 'the dispatch reveals the finished prefetch');
    assert.equal(finals[0].answer, ANSWER);
    assert.equal(finals[0].question, QUESTION);
    assert.ok(tokens.length >= 1 && tokens.join('') === ANSWER, 'the row is opened with the text, as the live path does');
    assert.equal(session.getFullUsage().at(-1)?.answer, ANSWER, 'and it is on the session record like any shown answer');
    engine.reset();
});

test('a finished prefetch does not stamp the trigger cooldown — the dispatch that adopts it is not silenced', async () => {
    const { engine } = await makeEngine();
    engine.prefetchAutoAnswer('q4', QUESTION);
    await untilIdle(engine);
    assert.equal(engine.lastTriggerTime, 0,
        'the cooldown slot belongs to the real trigger; stamping it at completion made the planner refuse the adoption as "cooldown"');
    engine.reset();
});

test('13-q6: the engine accepts a dispatch while its OWN prefetch is streaming, and reveals it when the stream ends', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { engine, finals } = await makeEngine({ chunks: [ANSWER.slice(0, 40), ANSWER.slice(40)], gate });
    engine.prefetchAutoAnswer('q6', QUESTION);
    await flush();
    assert.equal(engine.getActiveMode(), 'what_to_say', 'the prefetch is in flight');
    assert.equal(engine.canAutoAnswer(), true,
        'a live prefetch is not "busy": the dispatch adopts it — refusing it parked the verdict until the next candidate killed it');

    await dispatch(engine, 'q6');
    assert.deepEqual(finals, [], 'adopted mid-stream: nothing to show until the stream finishes');
    release();
    await untilIdle(engine);
    await flush();
    assert.equal(finals.length, 1, 'the adopted stream is revealed at completion');
    assert.equal(finals[0].answer, ANSWER);
    engine.reset();
});

test('canAutoAnswer still refuses a MANUAL What-to-Answer stream', async () => {
    const { engine } = await makeEngine();
    engine.activeMode = 'what_to_say';          // a manual press, no speculative identity
    assert.equal(engine.canAutoAnswer(), false);
    engine.activeMode = 'idle';
});

test('an un-adopted prefetch stays hidden; a later manual press does not leak it', async () => {
    const { engine, finals } = await makeEngine();
    engine.prefetchAutoAnswer('q9', QUESTION);
    await untilIdle(engine);
    assert.deepEqual(finals, []);
    // forceFresh is what the manual button sends; the stored prefetch must go with the cache.
    const run = engine.runWhatShouldISay('Something else entirely?', 0.9, undefined, { skipCooldown: true, forceFresh: true });
    await run;
    assert.equal(finals.filter((f) => f.answer === ANSWER && f.question === QUESTION).length, 0,
        'the prefetched answer is never shown under a different question');
    engine.reset();
});
