/**
 * The same question is planned the same way whether Auto Answer or the hotkey
 * answers it (pipeline forensics 2026-11-13, F-ACC-11 / register D8).
 *
 * runWhatShouldISay stamped any non-empty `question` as typed input
 * (source 'manual_input'). Auto Answer and the prefetch pass the heard
 * question as that argument, so their turns were planned as typed chat:
 * a different unmatched-question fallback, voice and speakability than the
 * hotkey on the very same line. A typed or pressed question still plans as
 * manual input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = path.resolve(__dirname, '../../../dist-electron/electron');

const QUESTIONS = [
    'So what do you think about all this?',
    'How would you handle a teammate who keeps missing deadlines?',
    'What are your strengths?',
];

async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}

async function planFor(q, how) {
    const { IntelligenceEngine } = await import(pathToFileURL(path.join(dist, 'IntelligenceEngine.js')).href);
    const { SessionTracker } = require(path.join(dist, 'SessionTracker.js'));
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.verifyAnswerClaims = async (o) => o.answer;
    engine.planSuggestionTrigger = async (t) => ({ kind: 'answer', reason: 'answerable_question', confidence: t.confidence ?? 0.9 });
    let plan = null;
    engine.whatToAnswerLLM = { async *generateStream(...args) { plan = args[9]; yield 'A short spoken answer here.'; } };
    session.addTranscript({ speaker: 'interviewer', text: q, timestamp: Date.now(), final: true });
    if (how === 'hotkey') await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });
    if (how === 'typed') await engine.runWhatShouldISay(q, 0.9, undefined, { skipCooldown: true });
    if (how === 'auto') await engine.handleSuggestionTrigger({ context: '', lastQuestion: q, confidence: 0.9, automatic: true, questionId: '1-q1', answerability: 0.9,
        dialogueAct: 'question', isFollowUp: false, endpointSource: 'provider_endpoint', candidateGeneration: 1 });
    await until(() => plan !== null);
    return { answerType: plan.answerType, voice: plan.voicePerspective ?? plan.outputPerspective ?? null };
}

for (const q of QUESTIONS) {
    test(`Auto Answer plans "${q}" exactly as the hotkey does`, async () => {
        const hotkey = await planFor(q, 'hotkey');
        const auto = await planFor(q, 'auto');
        assert.deepEqual(auto, hotkey);
    });
}

test('a typed question still plans as typed input (at least one of these differs from the heard plan)', async () => {
    let differs = 0;
    for (const q of QUESTIONS) {
        const typed = await planFor(q, 'typed');
        const hotkey = await planFor(q, 'hotkey');
        if (JSON.stringify(typed) !== JSON.stringify(hotkey)) differs += 1;
    }
    assert.ok(differs > 0, 'manual_input still has its own planning for typed questions');
});
