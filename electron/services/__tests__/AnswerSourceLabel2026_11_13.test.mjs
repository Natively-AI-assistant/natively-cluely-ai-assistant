/**
 * Every What-to-Answer final carries the source badge its evidence earns
 * (pipeline forensics 2026-11-13, F-ACC-04).
 *
 * Before: the normal final emit and the adopted-prefetch reveal passed no
 * label, so main stamped 'General knowledge' on every answer, resume-grounded
 * or not. The only computed label sat on the provider-error branch and said
 * 'Reference material' (not a SourceLabel) for ANY evidence, transcript too.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const { sourceLabelFromEvidenceBlock, computeAnswerSourceLabel } = await import(pathToFileURL(path.join(dist, 'llm/SourceBadge.js')).href);

const ev = (type, n = 1) => Array.from({ length: n }, (_, i) => `<evidence id="e${type}${i}" source_type="${type}">x</evidence>`).join('\n');

describe('label from the evidence the V3 prompt carried', () => {
    test('no evidence, or only meeting context, is general knowledge', () => {
        assert.equal(sourceLabelFromEvidenceBlock(''), 'General knowledge');
        assert.equal(sourceLabelFromEvidenceBlock(undefined), 'General knowledge');
        assert.equal(sourceLabelFromEvidenceBlock(ev('MEETING_TRANSCRIPT', 3) + ev('SCREEN_CONTEXT')), 'General knowledge',
            'transcript evidence is not a document the badge may claim');
    });
    test('single document kinds', () => {
        assert.equal(sourceLabelFromEvidenceBlock(ev('RESUME', 2)), 'From: Resume');
        assert.equal(sourceLabelFromEvidenceBlock(ev('PROFILE_FACT')), 'From: Resume');
        assert.equal(sourceLabelFromEvidenceBlock(ev('JOB_DESCRIPTION')), 'From: Job description');
        assert.equal(sourceLabelFromEvidenceBlock(ev('REFERENCE_FILE') + ev('MEETING_TRANSCRIPT')), 'From: Reference files');
    });
    test('mixed kinds name the two with the most items', () => {
        assert.equal(sourceLabelFromEvidenceBlock(ev('RESUME') + ev('JOB_DESCRIPTION')), 'Mixed: Resume + Job description');
        assert.equal(sourceLabelFromEvidenceBlock(ev('RESUME') + ev('PROJECT_FILE')), 'Mixed: Resume + Reference files');
        assert.equal(sourceLabelFromEvidenceBlock(ev('JOB_DESCRIPTION') + ev('REFERENCE_FILE')), 'Mixed: Job description + Reference files');
        assert.equal(sourceLabelFromEvidenceBlock(ev('RESUME', 3) + ev('JOB_DESCRIPTION') + ev('REFERENCE_FILE', 2)), 'Mixed: Resume + Reference files');
    });
    test('never the off-union "Reference material"', () => {
        assert.notEqual(computeAnswerSourceLabel({ v3Prompt: { evidenceBlock: ev('REFERENCE_FILE') } }), 'Reference material');
    });
    test('legacy path (no V3 prompt) keeps the TurnPlan rule', () => {
        assert.equal(computeAnswerSourceLabel({ v3Prompt: null, turnPlan: null }), 'General knowledge');
        assert.equal(computeAnswerSourceLabel({ v3Prompt: null, turnPlan: { questionKind: 'doc_question', evidenceSourcesToProbe: ['reference_files'] } }), 'From: Reference files');
    });
});

// ── Engine: the label reaches both the live final and the adopted reveal ──

const Q = 'Which database did you migrate the billing service to?';
async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}
async function makeEngine() {
    const { IntelligenceEngine } = await import(pathToFileURL(path.join(dist, 'IntelligenceEngine.js')).href);
    const { SessionTracker } = require(path.join(dist, 'SessionTracker.js'));
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.planSuggestionTrigger = async (t) => ({ kind: 'answer', reason: 'answerable_question', confidence: t.confidence ?? 0.9 });
    engine.verifyAnswerClaims = async (o) => o.answer;
    engine.whatToAnswerLLM = { async *generateStream() { yield 'We moved billing to Postgres in 2024.'; } };
    // V3 composition is not reachable from a unit test; the label rule itself
    // is covered above. Here: whatever the rule returns must reach the overlay.
    engine.answerSourceLabel = () => 'From: Resume';
    const finals = [];
    engine.on('suggested_answer', (text, _q, _c, gen, label) => finals.push({ text, gen, label }));
    session.addTranscript({ speaker: 'interviewer', text: Q, timestamp: Date.now(), final: true });
    return { engine, finals };
}

describe('engine emits', () => {
    test('the live final carries the label', async () => {
        const { engine, finals } = await makeEngine();
        await engine.runWhatShouldISay(Q, 0.9);
        await until(() => finals.length === 1);
        assert.equal(finals[0].label, 'From: Resume');
    });
    test('an adopted prefetch revealed by the dispatch carries the label', async () => {
        const { engine, finals } = await makeEngine();
        engine.prefetchAutoAnswer('1-q1', Q);
        await until(() => engine.getActiveMode() === 'idle');
        await engine.handleSuggestionTrigger({ context: '', lastQuestion: Q, confidence: 0.9, automatic: true, questionId: '1-q1', answerability: 0.9,
            dialogueAct: 'question', isFollowUp: false, endpointSource: 'provider_endpoint', candidateGeneration: 1, reuseSpeculative: true });
        await until(() => finals.length === 1);
        assert.equal(finals[0].label, 'From: Resume');
    });
    test('the real rule reads the snapshot\'s V3 evidence', async () => {
        const { IntelligenceEngine } = await import(pathToFileURL(path.join(dist, 'IntelligenceEngine.js')).href);
        const label = IntelligenceEngine.prototype.answerSourceLabel.call({}, { v3Prompt: { evidenceBlock: ev('JOB_DESCRIPTION') } }, null);
        assert.equal(label, 'From: Job description');
    });
});
