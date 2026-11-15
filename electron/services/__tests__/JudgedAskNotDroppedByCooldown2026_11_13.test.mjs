/**
 * A judged Auto Answer ask is not silently dropped by a cooldown
 * (pipeline forensics 2026-11-13, F-ACC-08, register D3 and D4).
 *
 * D3: a DIFFERENT question judged soon after the last answer passed the
 *     planner's same-utterance check and was then dropped by the time-only 3 s
 *     throttle in runWhatShouldISay: no answer, and Auto Answer had already
 *     recorded it as answered.
 * D4: a prefetch that declined ("Nothing actionable") stamped the answered-turn
 *     cooldown with the candidate text, so the judge's slower "answer" verdict
 *     on the same ask read as a repeat and the planner stayed silent.
 *
 * Uses the REAL planner (planSuggestionTrigger): the cooldown is what is tested.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = path.resolve(__dirname, '../../../dist-electron/electron');

const Q1 = 'How long are raw spans kept before they are compacted?';
const Q2 = 'And which team owns the compaction job on call?';

async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}

async function makeEngine(replies) {
    const { IntelligenceEngine } = await import(pathToFileURL(path.join(dist, 'IntelligenceEngine.js')).href);
    const { SessionTracker } = require(path.join(dist, 'SessionTracker.js'));
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.verifyAnswerClaims = async (o) => o.answer;
    let call = 0;
    engine.whatToAnswerLLM = { async *generateStream() { yield replies[Math.min(call++, replies.length - 1)]; } };
    const finals = [];
    const skipped = [];
    engine.on('suggested_answer', (text, question) => finals.push({ text, question }));
    engine.on('suggestion_skipped', (s) => skipped.push(s));
    return { engine, session, finals, skipped, calls: () => call };
}

const judged = (q, id) => ({ context: '', lastQuestion: q, confidence: 0.9, automatic: true, questionId: id, answerability: 0.9,
    dialogueAct: 'question', isFollowUp: false, endpointSource: 'provider_endpoint', candidateGeneration: 1 });

test('D3: a different question judged right after an answer is answered', async () => {
    const { engine, session, finals } = await makeEngine(['Raw spans are kept for 14 days.', 'The storage team owns it.']);
    session.addTranscript({ speaker: 'interviewer', text: Q1, timestamp: Date.now(), final: true });
    await engine.handleSuggestionTrigger(judged(Q1, '1-q1'));
    await until(() => finals.length === 1);
    session.addTranscript({ speaker: 'interviewer', text: Q2, timestamp: Date.now(), final: true });
    await engine.handleSuggestionTrigger(judged(Q2, '1-q2'));        // well inside 3 s
    await until(() => finals.length === 2);
    assert.match(finals[1].text, /storage team/);
});

test('D3 guard: the SAME ask judged again inside the window is still not answered twice', async () => {
    const { engine, session, finals, skipped } = await makeEngine(['Raw spans are kept for 14 days.']);
    session.addTranscript({ speaker: 'interviewer', text: Q1, timestamp: Date.now(), final: true });
    await engine.handleSuggestionTrigger(judged(Q1, '1-q1'));
    await until(() => finals.length === 1);
    await engine.handleSuggestionTrigger(judged(Q1, '1-q1b'));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(finals.length, 1);
    assert.equal(skipped.at(-1)?.reason, 'cooldown');
});

test('D4: a prefetch that declined does not silence the judged answer on the same ask', async () => {
    const { engine, session, finals } = await makeEngine(['Nothing actionable right now.', 'Raw spans are kept for 14 days.']);
    session.addTranscript({ speaker: 'interviewer', text: Q1, timestamp: Date.now(), final: true });
    engine.prefetchAutoAnswer('1-q1', Q1);
    await until(() => engine.getActiveMode() === 'idle');
    assert.equal(finals.length, 0, 'the declined prefetch shows nothing');
    await engine.handleSuggestionTrigger({ ...judged(Q1, '1-q1'), reuseSpeculative: true });
    await until(() => finals.length === 1);
    assert.match(finals[0].text, /14 days/);
});

test('D4 guard: a declined prefetch still throttles the next prefetch', async () => {
    const { engine, session, calls } = await makeEngine(['Nothing actionable right now.']);
    session.addTranscript({ speaker: 'interviewer', text: Q1, timestamp: Date.now(), final: true });
    engine.prefetchAutoAnswer('1-q1', Q1);
    await until(() => engine.getActiveMode() === 'idle');
    const after = calls();
    engine.prefetchAutoAnswer('1-q2', Q2);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls(), after, 'no second prefetch inside the window');
});
