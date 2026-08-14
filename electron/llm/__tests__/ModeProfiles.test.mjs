// electron/llm/__tests__/ModeProfiles.test.mjs
//
// PI v3 (W1): the active mode is a routing PRIOR on the classification
// FALLTHROUGH only. Invariants under test:
//   1. Ambiguous turns route to the mode's fallback type (sales → sales_answer,
//      lecture → lecture_answer, team-meet/recruiting → general_meeting_answer).
//   2. Explicit signals ALWAYS win — a coding/identity/negotiation/profile ask
//      in ANY mode routes exactly as it does with no mode (leak invariant).
//   3. The rewritten fallback type carries its own layer rules (sales_answer
//      forbids resume/jd/negotiation) so no profile can leak into a sales turn.
//   4. No-mode / general mode behavior is byte-for-byte unchanged.
//
// Runs against the COMPILED dist-electron output (same pattern as the other
// planner tests) so it exercises exactly what ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { planAnswer } = await import('../../../dist-electron/electron/llm/AnswerPlanner.js');
const { applyModeFallback, MODE_CONTEXT_PROFILES } = await import('../../../dist-electron/electron/llm/modeProfiles.js');

const mode = (templateType, name = templateType) => ({
    id: `mode_${templateType}`, templateType, name, isCustom: false,
});

// An utterance that matches NO explicit pattern and is not candidate-directed —
// the pure fallthrough case. (Vague discourse, no profile attribute words.)
const AMBIGUOUS_LIVE = 'so, hmm, what do you think about all of this then?';

test('W1-1: ambiguous live turn in SALES mode routes to sales_answer', () => {
    const plan = planAnswer({
        question: AMBIGUOUS_LIVE,
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('sales'),
    });
    assert.equal(plan.answerType, 'sales_answer');
    // The rewritten type carries its own leak rules: resume/jd/negotiation forbidden.
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
    assert.ok(plan.forbiddenContextLayers.includes('jd'));
    assert.ok(plan.forbiddenContextLayers.includes('negotiation'));
    assert.equal(plan.profileContextPolicy, 'forbidden');
});

test('W1-2: ambiguous live turn in LECTURE mode routes to lecture_answer (reference files in, resume out)', () => {
    const plan = planAnswer({
        question: AMBIGUOUS_LIVE,
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('lecture'),
    });
    assert.equal(plan.answerType, 'lecture_answer');
    assert.ok(plan.requiredContextLayers.includes('reference_files'));
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
});

test('W1-3: ambiguous live turn in TEAM-MEET / RECRUITING stays conversation-scoped', () => {
    for (const t of ['team-meet', 'recruiting']) {
        const plan = planAnswer({
            question: AMBIGUOUS_LIVE,
            source: 'what_to_answer',
            speakerPerspective: 'interviewer',
            activeMode: mode(t),
        });
        assert.equal(plan.answerType, 'general_meeting_answer', `mode=${t}`);
        assert.equal(plan.profileContextPolicy, 'forbidden', `mode=${t}`);
    }
});

test('W1-4: no mode / general / technical-interview keep the mode-blind fallthrough byte-for-byte', () => {
    const noMode = planAnswer({ question: AMBIGUOUS_LIVE, source: 'what_to_answer', speakerPerspective: 'interviewer' });
    for (const m of [null, mode('general'), mode('technical-interview'), mode('looking-for-work')]) {
        const plan = planAnswer({
            question: AMBIGUOUS_LIVE,
            source: 'what_to_answer',
            speakerPerspective: 'interviewer',
            activeMode: m,
        });
        assert.equal(plan.answerType, noMode.answerType, `mode=${m?.templateType ?? 'none'}`);
        assert.deepEqual(plan.forbiddenContextLayers, noMode.forbiddenContextLayers);
        assert.deepEqual(plan.requiredContextLayers, noMode.requiredContextLayers);
    }
});

// ── Invariant 2: explicit signals always win, in EVERY mode ────────────────
const EXPLICIT_CASES = [
    // [question, expected type, leak assertion]
    ['solve two sum in python', 'dsa_question_answer'],
    ['write a function to reverse a linked list', /coding|dsa/],
    ['what is your name?', 'identity_answer'],
    ['what salary are you expecting?', 'negotiation_answer'],
    ['tell me about your projects', /project/],
    ['have you used WebRTC before?', 'skill_experience_answer'],
    ['explain BFS', 'technical_concept_answer'],
];
const ALL_MODES = Object.keys(MODE_CONTEXT_PROFILES);

test('W1-5: explicit answer-type signals are NEVER overridden by any mode', () => {
    for (const m of ALL_MODES) {
        for (const [q, expected] of EXPLICIT_CASES) {
            const plan = planAnswer({
                question: q,
                source: 'what_to_answer',
                speakerPerspective: 'interviewer',
                activeMode: mode(m),
            });
            if (expected instanceof RegExp) {
                assert.match(plan.answerType, expected, `mode=${m} q="${q}" got=${plan.answerType}`);
            } else {
                assert.equal(plan.answerType, expected, `mode=${m} q="${q}"`);
            }
        }
    }
});

test('W1-6: coding in sales mode still forbids ALL profile layers (leak invariant)', () => {
    const plan = planAnswer({
        question: 'write a SQL query to find duplicate emails',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('sales'),
    });
    assert.ok(['coding_question_answer', 'dsa_question_answer'].includes(plan.answerType));
    assert.equal(plan.profileContextPolicy, 'forbidden');
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
});

test('W1-7: an EXPLICIT meeting-recap match is not rewritten by the sales prior (fellThrough=false)', () => {
    // "action items" matches MEETING_PATTERNS explicitly — not a fallthrough.
    const plan = planAnswer({
        question: 'what were the action items from this conversation?',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('sales'),
    });
    assert.equal(plan.answerType, 'general_meeting_answer');
});

// ── applyModeFallback unit contract ─────────────────────────────────────────
test('W1-8: applyModeFallback only rewrites floor types and only when fellThrough', () => {
    const sales = mode('sales');
    assert.equal(applyModeFallback('unknown_answer', true, 'manual_input', sales), 'sales_answer');
    assert.equal(applyModeFallback('general_meeting_answer', true, 'what_to_answer', sales), 'sales_answer');
    // Not a fallthrough → untouched.
    assert.equal(applyModeFallback('general_meeting_answer', false, 'what_to_answer', sales), 'general_meeting_answer');
    // Non-floor type → untouched even when fellThrough is (incorrectly) true.
    assert.equal(applyModeFallback('identity_answer', true, 'what_to_answer', sales), 'identity_answer');
    // No mode → untouched.
    assert.equal(applyModeFallback('unknown_answer', true, 'manual_input', null), 'unknown_answer');
});

test('W1-9: candidate-directed unmatched question still routes to a profile type in sales mode', () => {
    // classifyUnmatchedFallback claims candidate-directed questions BEFORE the
    // mode prior — the mode must not strip profile grounding from "about me" asks.
    const plan = planAnswer({
        question: 'what would you say is your background here?',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        hasCandidateProfile: true,
        activeMode: mode('sales'),
    });
    assert.notEqual(plan.answerType, 'sales_answer');
    assert.equal(plan.profileContextPolicy, 'required');
});
