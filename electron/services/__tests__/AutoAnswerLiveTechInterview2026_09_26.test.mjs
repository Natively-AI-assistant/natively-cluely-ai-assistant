/**
 * Auto Answer — live technical-interview run, 2026-09-26 (Natively API, real
 * capture + real STT, tests/auto-answer-live). Three engine-side defects, each
 * seen in the session log:
 *
 *  1. "Can you hear me okay?" — judge: answer, a=0.4 (above the 0.30
 *     ANSWER_FLOOR). The engine dispatched it, then handleSuggestionTrigger's
 *     `confidence < 0.5` line returned without a word. Nothing showed, and the
 *     finished prefetch stayed in the speculative slot.
 *  2. After the coding problem, every automatic answer came out labelled
 *     "Brainstorming Approaches": the planner routes ANY trigger to brainstorm
 *     once the session has detected a coding question.
 *  3. Prefetch fired for 3 of 12 asks: an expired, unadopted speculation is
 *     never released, and the prefetch guard only checks `!== null`.
 *
 * Same poke-the-instance pattern as AutoAnswerPrefetchReveal2026_09_03: the
 * real engine, a fake What-to-Answer stream.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const plannerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/PlannerDecision.js');
const require = createRequire(import.meta.url);
const { planNextAssistantAction } = require(plannerPath);

const flush = () => new Promise((r) => setImmediate(r));

async function makeEngine(answer = 'Yes, I can hear you clearly, thanks for checking.') {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    let runs = 0;
    engine.whatToAnswerLLM = {
        async *generateStream() { runs++; yield answer; },
    };
    // The planner classifies through the ONNX worker in production; these
    // tests pin what the TRIGGER does with its decision.
    engine.planSuggestionTrigger = async (trigger) => ({ kind: 'answer', reason: 'answerable_question', confidence: trigger.confidence ?? 0.9 });
    const finals = [];
    engine.on('suggested_answer', (text, question) => finals.push({ text, question }));
    return { engine, session, finals, runs: () => runs };
}

function untilIdle(engine) {
    return new Promise((resolve) => {
        if (engine.getActiveMode() === 'idle') return resolve();
        const h = (mode) => { if (mode === 'idle') { engine.off('mode_changed', h); resolve(); } };
        engine.on('mode_changed', h);
    });
}

const autoTrigger = (text, a, id = '1-q1') => ({
    context: '', lastQuestion: text, confidence: a, automatic: true, questionId: id,
    answerability: a, dialogueAct: 'social', isFollowUp: false, endpointSource: 'quiet_window',
    candidateGeneration: 1, reuseSpeculative: true,
});

// ── 1. the 0.3-0.5 band ──────────────────────────────────────────────────────

test('an automatic trigger at a=0.4 (above Auto Answer\'s own floor) is answered, not silently dropped', async () => {
    const { engine, session, finals } = await makeEngine();
    session.addTranscript({ speaker: 'interviewer', text: 'Hi there, thanks for making the time today. Can you hear me okay?', timestamp: Date.now(), final: true });
    engine.prefetchAutoAnswer('1-q1', 'Hi there, thanks for making the time today. Can you hear me okay?');
    await untilIdle(engine);
    await engine.handleSuggestionTrigger(autoTrigger('Can you hear me okay?', 0.4));
    await flush();
    assert.equal(finals.length, 1, 'the judge said answer and the engine dispatched it: it must show');
    assert.equal(engine.getSpeculativeSnapshot().text, null, 'and the prefetch was consumed, not left holding the slot');
});

test('a MANUAL/legacy trigger with an explicit sub-0.5 confidence is still skipped (unchanged)', async () => {
    const { engine, finals, runs } = await makeEngine();
    await engine.handleSuggestionTrigger({ context: '', lastQuestion: 'maybe a question here', confidence: 0.4 });
    await flush();
    assert.equal(finals.length, 0);
    assert.equal(runs(), 0);
});

// ── 2. the planner must not re-route the interviewer's words ────────────────

const base = { now: 100_000, lastTriggerTime: 0, cooldownMs: 3000 };

test('planner: an automatic ask after a coding problem is ANSWERED, not brainstormed', () => {
    const d = planNextAssistantAction({ ...base, triggerQuestion: "What's the time complexity of your remove operation? And why?", confidence: 0.9, hasDetectedCodingQuestion: true, automatic: true });
    assert.equal(d.kind, 'answer');
});

test('planner: automatic asks that carry the user-request keywords are answered too', () => {
    for (const q of [
        'Can you summarize the trade-offs you just described?',       // recap keyword
        'What are your options if the cache node dies?',              // brainstorm keyword
        'Could you clarify what you mean by eventual consistency?',   // clarify keyword
    ]) {
        const d = planNextAssistantAction({ ...base, triggerQuestion: q, confidence: 0.9, automatic: true });
        assert.equal(d.kind, 'answer', q);
    }
});

test('planner: an automatic verdict in the 0.3-0.5 band is answered (Auto Answer applied its own floor)', () => {
    const d = planNextAssistantAction({ ...base, triggerQuestion: 'Can you hear me okay?', confidence: 0.4, automatic: true });
    assert.equal(d.kind, 'answer');
});

test('planner: the cooldown still silences a fragment of the same utterance on the automatic path', () => {
    const d = planNextAssistantAction({ triggerQuestion: 'How does a hash map handle collisions?', confidence: 0.9, automatic: true,
        now: 101_000, lastTriggerTime: 100_000, cooldownMs: 3000, lastTriggerQuestion: 'How does a hash map handle collisions' });
    assert.equal(d.kind, 'silent');
    assert.equal(d.reason, 'cooldown');
});

test('planner: user-initiated routing is unchanged — a detected coding question still brainstorms a non-automatic trigger', () => {
    const d = planNextAssistantAction({ ...base, triggerQuestion: 'What should I do next here?', confidence: 0.9, hasDetectedCodingQuestion: true });
    assert.equal(d.kind, 'brainstorm');
});

// ── 3. an expired speculation releases the slot ─────────────────────────────

test('prefetch: an EXPIRED, finished speculation no longer blocks the next prefetch', async () => {
    const { engine, runs } = await makeEngine('A process has its own address space; threads share one.');
    engine.prefetchAutoAnswer('1-q1', 'So the first thing to know is that everything is stored in one place.');
    await untilIdle(engine);
    assert.equal(runs(), 1);
    // The judge ruled that statement silent; its adoption window has passed.
    engine.speculativeTextExpiry = Date.now() - 1;
    engine.prefetchAutoAnswer('1-q2', "What's the difference between a process and a thread?");
    await untilIdle(engine);
    assert.equal(runs(), 2, 'the new question gets its head start');
    assert.equal(engine.getSpeculativeSnapshot().questionId, '1-q2');
});

test('prefetch: a speculation still inside its adoption window keeps the slot', async () => {
    const { engine, runs } = await makeEngine();
    engine.prefetchAutoAnswer('1-q1', "What's the difference between a process and a thread?");
    await untilIdle(engine);
    engine.prefetchAutoAnswer('1-q2', 'How does a hash map handle collisions?');
    await flush();
    assert.equal(runs(), 1, 'an adoptable prefetch is not thrown away for another');
});
