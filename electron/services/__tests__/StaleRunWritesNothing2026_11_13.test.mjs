/**
 * A What-to-Answer run that was replaced or whose meeting ended while it was
 * still being checked writes nothing: no history line, no usage row, no final
 * (pipeline forensics 2026-11-13, F-CTX-08). Before, only the speculative
 * branch checked; a typed/dispatched run wrote its stale answer into the ring
 * and history of the next turn or the next meeting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const Q = 'What is the difference between a process and a thread?';
const ANSWER = 'A process owns its own address space, while threads inside it share that memory.';

async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}

async function rig() {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.planSuggestionTrigger = async (t) => ({ kind: 'answer', reason: 'answerable_question', confidence: t.confidence ?? 0.9 });
    engine.whatToAnswerLLM = { async *generateStream() { yield ANSWER; } };
    let release; const held = new Promise((r) => { release = r; });
    let verifying = false;
    engine.verifyAnswerClaims = async (o) => { verifying = true; await held; return o.answer; };
    const finals = [];
    engine.on('suggested_answer', (text, _q, _c, gen) => finals.push({ text, gen }));
    session.addTranscript({ speaker: 'interviewer', text: Q, timestamp: Date.now(), final: true });
    return { engine, session, finals, release: () => release(), verifying: () => verifying };
}

test('meeting end while the answer is being checked: nothing is stored or shown', async () => {
    const h = await rig();
    const run = h.engine.runWhatShouldISay(Q, 0.9);
    await until(h.verifying);
    h.engine.cancelAnswersForMeetingEnd();
    h.release();
    await run;
    assert.equal(h.finals.length, 0, 'no final for the ended meeting');
    assert.equal(h.session.getLastAssistantMessage(), null, 'no history line');
    assert.equal((h.session.getFullUsage?.() ?? []).filter((u) => u.answer === ANSWER).length, 0, 'no usage row');
});

test('an undisturbed run still stores and shows its answer (unchanged)', async () => {
    const h = await rig();
    const run = h.engine.runWhatShouldISay(Q, 0.9);
    await until(h.verifying);
    h.release();
    await run;
    assert.equal(h.finals.length, 1);
    assert.ok(h.session.getLastAssistantMessage()?.includes('address space'));
});
