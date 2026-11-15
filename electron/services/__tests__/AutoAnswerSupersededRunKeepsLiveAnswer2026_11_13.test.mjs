/**
 * Auto Answer — a run replaced AFTER its stream ended must not touch the live
 * answer (pipeline forensics 2026-11-13, F-CTX-01 / F-CTX-02).
 *
 * The sequence, from the replay traces (P3-s17b, P3-s17c, REST1-3-s02):
 *  1. An interviewer interim starts a speculative run on part of the question
 *     (gen A). Its stream finishes and it enters the claim-verifier pass.
 *  2. The Auto Answer prefetch for the finished question replaces it (gen B).
 *  3. Gen A's verifier returns. Before the fix it completed anyway:
 *     setMode('idle') under gen B, and its stale text parked as the finished
 *     speculative answer.
 *  4a. Dispatch adopted gen B and it was painting: with the engine "idle", the
 *      next question-like interim (a remark, an aside) started a speculation
 *      that aborted the visible answer — nothing replaced it.
 *  4b. Dispatch arrived after step 3: `stillStreaming` read false and the
 *      engine revealed gen A's draft — the answer to the cut-off question.
 *
 * Also pinned: an adopted, visible stream is not "the engine's own
 * speculation" for the prefetch gate, so a new candidate's prefetch cannot
 * abort it before the judge has ruled.
 *
 * Same poke-the-instance pattern as AutoAnswerLiveTechInterview2026_09_26:
 * the real engine, scripted What-to-Answer streams, a held verifier.
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

const TRUNCATED = 'What is the difference between a process and';
const FULL = 'What is the difference between a process and a thread?';
const STALE = 'STALE draft for the cut-off question, generated from fewer words than were asked.';
const LIVE_HEAD = 'A process owns its own address space and resources, ';
const LIVE_TAIL = 'while threads inside it share that memory and are cheaper to switch.';

async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error('condition not met in time');
        await new Promise((r) => setTimeout(r, 5));
    }
}

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

/**
 * Engine with two scripted runs:
 *  - run 1 (the interim speculation): yields STALE at once; its claim verifier
 *    is held until `releaseStaleVerifier()`.
 *  - run 2 (the prefetch): yields LIVE_HEAD, waits for `releaseLiveTail()`,
 *    then LIVE_TAIL. Its verifier passes straight through.
 * Any later run yields a short distinct answer.
 */
async function makeEngine({ holdLiveVerifier = false } = {}) {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.planSuggestionTrigger = async (trigger) => ({ kind: 'answer', reason: 'answerable_question', confidence: trigger.confidence ?? 0.9 });

    const liveTail = deferred();
    const staleVerifier = deferred();
    const liveVerifier = deferred();
    let runs = 0;
    engine.whatToAnswerLLM = {
        async *generateStream() {
            const n = ++runs;
            if (n === 1) { yield STALE; return; }
            if (n === 2) { yield LIVE_HEAD; await liveTail.promise; yield LIVE_TAIL; return; }
            yield `Later run ${n} answer text that is long enough to be shown.`;
        },
    };
    let verifierCalls = 0;
    engine.verifyAnswerClaims = async (opts) => {
        verifierCalls++;
        if (opts.answer.startsWith('STALE')) await staleVerifier.promise;
        if (holdLiveVerifier && opts.answer.includes('threads inside it share')) await liveVerifier.promise;
        return opts.answer;
    };

    const tokens = [];
    const finals = [];
    const discards = [];
    engine.on('suggested_answer_token', (text, _q, _c, gen) => tokens.push({ text, gen }));
    engine.on('suggested_answer', (text, question, _c, gen) => finals.push({ text, question, gen }));
    engine.on('suggested_answer_discard', (reason, gen) => discards.push({ reason, gen }));

    session.addTranscript({ speaker: 'interviewer', text: FULL, timestamp: Date.now(), final: true });

    return {
        engine, session, tokens, finals, discards,
        runs: () => runs,
        verifierCalls: () => verifierCalls,
        releaseLiveTail: () => liveTail.resolve(),
        releaseStaleVerifier: () => staleVerifier.resolve(),
        releaseLiveVerifier: () => liveVerifier.resolve(),
    };
}

const autoTrigger = (text, id = '1-q1') => ({
    context: '', lastQuestion: text, confidence: 0.9, automatic: true, questionId: id,
    answerability: 0.9, dialogueAct: 'question', isFollowUp: false, endpointSource: 'provider_endpoint',
    candidateGeneration: 1, reuseSpeculative: true,
});

/** Steps 1-2: interim speculation in its verifier, replaced by the prefetch. */
async function staleRunWaitingBehindPrefetch(h) {
    void h.engine.runWhatShouldISay(TRUNCATED, 0.8, undefined, { speculative: true });
    await until(() => h.verifierCalls() === 1);              // gen A: stream done, verifier held
    h.engine.prefetchAutoAnswer('1-q1', FULL);
    await until(() => h.runs() === 2);                       // gen B streaming (muted)
    assert.equal(h.engine.getActiveMode(), 'what_to_say');
}

test('F-CTX-01: a replaced run finishing its verifier does not mark the engine idle under the live adopted answer', async () => {
    const h = await makeEngine();
    await staleRunWaitingBehindPrefetch(h);

    await h.engine.handleSuggestionTrigger(autoTrigger(FULL));   // adopts gen B, paints live
    await until(() => h.tokens.length > 0);
    const liveGen = h.tokens[0].gen;

    h.releaseStaleVerifier();                                     // gen A completes now
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.engine.getActiveMode(), 'what_to_say', 'the adopted answer is still streaming: the engine is busy');
    assert.equal(h.engine.isAnswerStreaming(), true);

    // The interviewer makes a remark that hasQuestionSignal accepts, well past the cooldown.
    h.engine.lastTriggerTime = 0;
    h.engine.handleTranscript({ speaker: 'interviewer', text: 'Right, okay, so is that the same thing our networking team meant?', timestamp: Date.now(), final: false, confidence: 0.95 });
    await new Promise((r) => setTimeout(r, 900));                 // past the speculation debounce
    assert.equal(h.runs(), 2, 'no speculation may start on top of the visible answer');

    h.releaseLiveTail();
    await until(() => h.finals.length === 1);
    assert.deepEqual(h.discards.filter((d) => d.gen === liveGen), [], 'the visible answer was never discarded');
    assert.equal(h.finals[0].gen, liveGen);
    assert.ok(h.finals[0].text.includes('threads inside it share'), 'the whole answer to the full question is the final');
    assert.ok(!h.finals.some((f) => f.text.startsWith('STALE')));
    await until(() => h.engine.getActiveMode() === 'idle');
});

test('F-CTX-02: when the stale run finishes before the dispatch, the dispatch still adopts the full-question stream', async () => {
    const h = await makeEngine();
    await staleRunWaitingBehindPrefetch(h);

    h.releaseStaleVerifier();                                     // gen A completes BEFORE the verdict
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.engine.getActiveMode(), 'what_to_say', 'gen B still owns the engine');
    assert.equal(h.engine.getSpeculativeSnapshot().text, FULL, 'the slot still holds the full question');

    await h.engine.handleSuggestionTrigger(autoTrigger(FULL));
    h.releaseLiveTail();
    await until(() => h.finals.length === 1);
    assert.ok(!h.finals[0].text.startsWith('STALE'), 'the cut-off question\'s draft must never be revealed');
    assert.ok(h.finals[0].text.includes('threads inside it share'));
    assert.equal(h.runs(), 2, 'adopted, not restarted');
});

test('prefetch gate: a new candidate cannot abort an adopted answer that is on screen', async () => {
    const h = await makeEngine();
    h.releaseStaleVerifier();
    // Skip the interim run: make run 1 the prefetch by consuming the STALE script first.
    void h.engine.runWhatShouldISay(TRUNCATED, 0.8, undefined, { speculative: true });
    await until(() => h.verifierCalls() === 1);
    await until(() => h.engine.getActiveMode() === 'idle');
    h.engine.lastTriggerTime = 0;
    h.engine.prefetchAutoAnswer('1-q1', FULL);
    await until(() => h.runs() === 2);
    await h.engine.handleSuggestionTrigger(autoTrigger(FULL));
    await until(() => h.tokens.length > 0);
    const liveGen = h.tokens[h.tokens.length - 1].gen;

    h.engine.lastTriggerTime = 0;
    h.engine.prefetchAutoAnswer('1-q2', 'Sorry, can everyone else hear that echo on the line?');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.runs(), 2, 'the aside\'s prefetch did not start');

    h.releaseLiveTail();
    await until(() => h.finals.some((f) => f.gen === liveGen));
    assert.deepEqual(h.discards.filter((d) => d.gen === liveGen), []);
});

test('unchanged: before adoption, the prefetch still replaces an interim speculation on fewer words', async () => {
    const h = await makeEngine();
    await staleRunWaitingBehindPrefetch(h);   // asserts run 2 started
    h.releaseStaleVerifier();
    h.releaseLiveTail();
    await until(() => h.engine.getActiveMode() === 'idle');
    assert.equal(h.engine.getSpeculativeSnapshot().text, FULL);
    assert.ok(!h.finals.some((f) => f.text.startsWith('STALE')), 'nothing was revealed without a dispatch');
});

test('a visible answer replaced during its verifier sends no late discard (the renderer would clear the NEW row)', async () => {
    const h = await makeEngine({ holdLiveVerifier: true });
    h.releaseStaleVerifier();
    void h.engine.runWhatShouldISay(TRUNCATED, 0.8, undefined, { speculative: true });   // run 1, finishes
    await until(() => h.verifierCalls() === 1);
    await until(() => h.engine.getActiveMode() === 'idle');
    h.engine.lastTriggerTime = 0;
    h.engine.prefetchAutoAnswer('1-q1', FULL);                                            // run 2
    await until(() => h.runs() === 2);
    await h.engine.handleSuggestionTrigger(autoTrigger(FULL));                           // adopted, painting
    await until(() => h.tokens.length > 0);
    const firstGen = h.tokens[0].gen;
    h.releaseLiveTail();                                                                  // stream ends, verifier held
    await until(() => h.verifierCalls() === 2);
    assert.equal(h.engine.getActiveMode(), 'what_to_say');

    // A new judged question replaces it (run 3 paints).
    h.engine.lastTriggerTime = 0;
    await h.engine.handleSuggestionTrigger({ ...autoTrigger('And how does a mutex differ from a semaphore?', '1-q2'), reuseSpeculative: false });
    await until(() => h.tokens.some((t) => t.gen !== firstGen));
    const discardsBefore = h.discards.length;

    h.releaseLiveVerifier();                                                              // run 2 resumes, already replaced
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.discards.length, discardsBefore, 'no discard once the successor is painting');
    assert.ok(!h.finals.some((f) => f.gen === firstGen), 'the replaced run does not finalize over its successor');
    await until(() => h.finals.some((f) => f.text.startsWith('Later run 3')));
});

test('F-CTX-07: stopping the meeting cancels the answer still streaming; it never finishes into the next meeting', async () => {
    const h = await makeEngine();
    h.releaseStaleVerifier();
    void h.engine.runWhatShouldISay(TRUNCATED, 0.8, undefined, { speculative: true });   // run 1, finishes
    await until(() => h.engine.getActiveMode() === 'idle' && h.verifierCalls() === 1);
    h.engine.lastTriggerTime = 0;
    h.engine.prefetchAutoAnswer('1-q1', FULL);                                            // run 2
    await until(() => h.runs() === 2);
    await h.engine.handleSuggestionTrigger(autoTrigger(FULL));
    await until(() => h.tokens.length > 0);
    const modes = [];
    h.engine.on('mode_changed', (m) => modes.push(m));

    h.engine.cancelAnswersForMeetingEnd();
    assert.equal(h.engine.getActiveMode(), 'idle');
    assert.deepEqual(modes, ['idle'], 'the renderer hears the engine went idle');
    const tokensAtStop = h.tokens.length;

    h.releaseLiveTail();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.tokens.length, tokensAtStop, 'no tokens after the stop');
    assert.equal(h.finals.length, 0, 'the old answer is never finalized');
    assert.equal(h.session.getLastAssistantMessage(), null, 'nor recorded as an answer');
});
