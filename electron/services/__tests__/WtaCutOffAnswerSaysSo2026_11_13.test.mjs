/**
 * An adopted Auto Answer that was cut off says so, and is not stored
 * (pipeline forensics 2026-11-13, F-ACC-01).
 *
 * The live path already sent the stream's stop reason with its final (#644).
 * The adopted-prefetch path — the most common Auto Answer path — finished its
 * row through revealSpeculativeAnswer, which emitted the final WITHOUT it, so
 * a truncated adopted answer read as complete even once LLMHelper reported
 * the truncation.
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

const Q = 'How long are raw spans kept before they are compacted?';
const PARTIAL = 'Raw spans are kept for 14';

async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}

async function makeEngine({ cut }) {
    const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
    const { SessionTracker } = require(sessionPath);
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.planSuggestionTrigger = async (t) => ({ kind: 'answer', reason: 'answerable_question', confidence: t.confidence ?? 0.9 });
    engine.verifyAnswerClaims = async (o) => o.answer;
    engine.whatToAnswerLLM = {
        // Argument 14 is the caller-owned truncation sink (WhatToAnswerLLM.generateStream).
        async *generateStream(...args) {
            const sink = args[13];
            yield cut ? PARTIAL : `${PARTIAL} days in the hot tier, then compacted.`;
            if (cut && sink) { sink.truncated = true; sink.reason = 'provider_failed_after_first_token'; }
        },
    };
    const finals = [];
    engine.on('suggested_answer', (text, question, _c, gen, _label, stopReason) => finals.push({ text, gen, stopReason }));
    session.addTranscript({ speaker: 'interviewer', text: Q, timestamp: Date.now(), final: true });
    return { engine, session, finals };
}

const trigger = { context: '', lastQuestion: Q, confidence: 0.9, automatic: true, questionId: '1-q1', answerability: 0.9,
    dialogueAct: 'question', isFollowUp: false, endpointSource: 'provider_endpoint', candidateGeneration: 1, reuseSpeculative: true };

test('a cut-off prefetch revealed by the dispatch carries its stop reason and is not stored', async () => {
    const { engine, session, finals } = await makeEngine({ cut: true });
    engine.prefetchAutoAnswer('1-q1', Q);
    await until(() => engine.getActiveMode() === 'idle');      // finished before the verdict
    await engine.handleSuggestionTrigger(trigger);              // adopts by reveal
    await until(() => finals.length === 1);
    assert.equal(finals[0].text, PARTIAL);
    assert.equal(finals[0].stopReason, 'provider_failed_after_first_token', 'the overlay is told the answer is cut off');
    assert.equal(session.getLastAssistantMessage(), null, 'a cut-off answer is not history for the next turn');
});

test('a complete prefetch carries no stop reason and is stored (unchanged)', async () => {
    const { engine, session, finals } = await makeEngine({ cut: false });
    engine.prefetchAutoAnswer('1-q1', Q);
    await until(() => engine.getActiveMode() === 'idle');
    await engine.handleSuggestionTrigger(trigger);
    await until(() => finals.length === 1);
    assert.equal(finals[0].stopReason, undefined);
    assert.ok(session.getLastAssistantMessage()?.includes('14 days'));
});
