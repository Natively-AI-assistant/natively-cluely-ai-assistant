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
async function until(cond, ms = 3000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}

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

test('prefetch: the SAME question keeps a finished prefetch; a DIFFERENT one replaces it', async () => {
    const { engine, runs } = await makeEngine();
    engine.prefetchAutoAnswer('1-q1', "What's the difference between a process and a thread?");
    await untilIdle(engine);
    engine.prefetchAutoAnswer('1-q2', "What's the difference between a process and a thread?");
    await flush();
    assert.equal(runs(), 1, 'an adoptable prefetch is claimed, not regenerated');
    assert.equal(engine.getSpeculativeSnapshot().questionId, '1-q2');
    // A different candidate: its dispatch could never adopt the old text
    // (another id, and under the similarity bar), so it gets its own head start.
    engine.prefetchAutoAnswer('1-q3', 'How does a hash map handle collisions?');
    await untilIdle(engine);
    assert.equal(runs(), 2);
    assert.equal(engine.getSpeculativeSnapshot().questionId, '1-q3');
});

// ── 4. the prefetch and the engine's own interim speculation ────────────────
// Live T04: an interim speculation on "…a process and a" held the slot, the
// prefetch of the finished question was refused, and the dispatch then
// rejected the interim run (Jaccard 0.60) and started over.

async function makeGatedEngine() {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    const gates = [];
    let runs = 0;
    engine.whatToAnswerLLM = {
        async *generateStream() {
            const n = ++runs;
            let release; const gate = new Promise((r) => { release = r; }); gates[n] = release;
            yield `ANSWER-${n} starts here and`;
            await gate;
            yield ` it finishes with more words for run ${n}.`;
        },
    };
    engine.planSuggestionTrigger = async (trigger) => ({ kind: 'answer', reason: 'answerable_question', confidence: trigger.confidence ?? 0.9 });
    const finals = [];
    engine.on('suggested_answer', (text, question) => finals.push({ text, question }));
    return { engine, finals, runs: () => runs, release: (n) => gates[n]?.() };
}

test('prefetch REPLACES an interim speculation on fewer words, and the dispatch adopts the prefetch', async () => {
    const { engine, finals, runs, release } = await makeGatedEngine();
    void engine.runWhatShouldISay("Nice. What's the difference between a process", 1, undefined, { speculative: true });
    await until(() => runs() === 1);
    assert.equal(runs(), 1, 'interim speculation running');
    engine.prefetchAutoAnswer('1-q7', "Nice. What's the difference between a process and a thread?");
    await until(() => runs() === 2);
    assert.equal(runs(), 2, 'the finished question started its own run');
    release(1); await flush(); await flush();                      // the replaced run winds down
    const snap = engine.getSpeculativeSnapshot();
    assert.equal(snap.questionId, '1-q7', 'the replaced run must not wipe the new slot');
    assert.match(String(snap.text), /and a thread\?/);
    await engine.handleSuggestionTrigger(autoTrigger("What's the difference between a process and a thread?", 1, '1-q7'));
    release(2);
    await untilIdle(engine); await flush();
    assert.equal(runs(), 2, 'adopted — no third generation');
    assert.equal(finals.length, 1);
    assert.match(finals[0].text, /ANSWER-2/);
});

test('prefetch CLAIMS an interim speculation that already covers the question — no second generation', async () => {
    const { engine, finals, runs, release } = await makeGatedEngine();
    void engine.runWhatShouldISay('How does a hash map handle collisions between keys?', 1, undefined, { speculative: true });
    await until(() => runs() === 1);
    engine.prefetchAutoAnswer('1-q8', 'How does a hash map handle collisions between keys?');
    await flush(); await flush();
    assert.equal(runs(), 1, 'the running speculation is claimed, not duplicated');
    assert.equal(engine.getSpeculativeSnapshot().questionId, '1-q8');
    await engine.handleSuggestionTrigger(autoTrigger('How does a hash map handle collisions between keys?', 1, '1-q8'));
    release(1);
    await untilIdle(engine); await flush();
    assert.equal(runs(), 1);
    assert.equal(finals.length, 1);
    assert.match(finals[0].text, /ANSWER-1/);
});

test('prefetch never takes over a NON-speculative run (a dispatch or a press in flight)', async () => {
    const { engine, runs, release } = await makeGatedEngine();
    void engine.runWhatShouldISay('Tell me about a time you disagreed with a teammate.', 1, undefined, { skipCooldown: true });
    await until(() => runs() === 1);
    engine.prefetchAutoAnswer('1-q9', 'And how did you resolve it in the end with them?');
    await flush(); await flush();
    assert.equal(runs(), 1, 'a live answer is never superseded by a prefetch');
    release(1);
    await untilIdle(engine);
});

test('speculationCoversQuestion: a prefix is NOT the whole question, however similar it scores', async () => {
    const { speculationCoversQuestion, speculativeQuestionSimilarity } = require(path.resolve(__dirname, '../../../dist-electron/electron/llm/speculativeSimilarity.js'));
    const full = "Nice. What's the difference between a process and a thread?";
    assert.ok(speculativeQuestionSimilarity("Nice. What's the difference between", full) >= 0.75, 'the dispatch metric accepts the prefix');
    assert.equal(speculationCoversQuestion("Nice. What's the difference between", full), false);
    assert.equal(speculationCoversQuestion("Nice. What's the difference between a process", full), false);
    assert.equal(speculationCoversQuestion("Nice. What's the difference between a process and a thread", full), true);
});

// ── 5. the dispatch's text-matched reuse must have heard the question ───────

test('dispatch does NOT adopt a speculation on a fragment of the task (live T08)', async () => {
    const { engine, finals, runs, release } = await makeGatedEngine();
    void engine.runWhatShouldISay('And third, get a random element, where every element has the same', 1, undefined, { speculative: true });
    await until(() => runs() === 1);
    release(1); await untilIdle(engine);
    const task = "I want you to design a data structure that supports three operations. First, insert a value. Second, remove a value. And third, get a random element, where every element has the same probability of being returned.";
    const dispatched = engine.handleSuggestionTrigger({ ...autoTrigger(task, 1, '1-q21'), reuseSpeculative: false });
    await until(() => runs() === 2);
    release(2); await dispatched; await flush();
    assert.equal(finals.length, 1);
    assert.match(finals[0].text, /ANSWER-2/, 'answered the whole task afresh, not the fragment');
});

test('dispatch still adopts a text-matched speculation that heard the whole question', async () => {
    const { engine, finals, runs, release } = await makeGatedEngine();
    void engine.runWhatShouldISay('How does a hash map handle collisions between keys', 1, undefined, { speculative: true });
    await until(() => runs() === 1);
    release(1); await untilIdle(engine);
    await engine.handleSuggestionTrigger({ ...autoTrigger('How does a hash map handle collisions between keys?', 1, '1-q6'), reuseSpeculative: false });
    await flush(); await flush();
    assert.equal(runs(), 1);
    assert.equal(finals.length, 1);
    assert.match(finals[0].text, /ANSWER-1/);
});
