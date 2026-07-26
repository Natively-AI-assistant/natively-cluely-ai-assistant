// electron/llm/__tests__/TurnPlannerMatrix.test.mjs
//
// Campaign 3 (fix/answer-policy-engine, 2026-07-19) — TurnPlanner behavior
// matrix suite. Covers every cell of the founder's §5 matrix:
//   {question_kind × probe_outcome × mode_profile} → expected behavior
//
// This is a UNIT test of the matrix (no Electron, no LLM, no benchmark
// quota). Each cell verifies that planTurn emits the expected questionKind,
// probe order, and groundingProfile. The same matrix will be reused in
// iter 7+ for live-harness runs once quota allows.
//
// Pure: only imports the TurnPlanner module + node:test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planTurn, DEFAULT_GROUNDING_PROFILE, SEMINAR_GROUNDING_PROFILE } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/TurnPlanner.js')).href
);

/** Helper: compute a TurnPlan under specified inputs. */
const tp = (question, opts = {}) => planTurn({
    question,
    answerType: opts.answerType ?? null,
    intent: opts.intent ?? null,
    availability: opts.availability ?? {
        hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true,
    },
    turnSourceDecision: null,
    sourceContract: opts.sourceContract ?? null,
});

describe('TurnPlanner matrix: question_kind × availability × profile', () => {
    // ── PROFILE_QUESTION ─────────────────────────────────────────────
    test('cell[profile_question × full availability × default] = profile, probe profile+jd, seedBG=true', () => {
        const p = tp("What's your name?", { answerType: 'identity_answer' });
        assert.equal(p.questionKind, 'profile_question');
        assert.deepEqual(p.evidenceSourcesToProbe, ['profile_resume', 'projects', 'profile_jd']);
        assert.equal(p.answerDirectives.seedCandidateBackground, true);
        assert.equal(p.groundingProfile.evidencePreference, 'preferred');
        assert.equal(p.groundingProfile.onNoEvidence, 'answer_general_labeled');
    });

    test('cell[profile_question × NO profile × default] = profile, empty probe, label general', () => {
        const p = tp("What's your name?", { availability: {
            hasReferenceFiles: false, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: true,
        } });
        assert.equal(p.questionKind, 'profile_question');
        assert.deepEqual(p.evidenceSourcesToProbe, []);
        assert.equal(p.groundingProfile.onNoEvidence, 'answer_general_labeled',
            'no profile → fall back to general knowledge (labeled), NEVER refuse');
    });

    // ── JD_QUESTION ──────────────────────────────────────────────────
    test('cell[jd_question × full × default] = jd, probe jd FIRST (founder §2.3)', () => {
        const p = tp('What is the job regarding?', { answerType: 'jd_summary_answer' });
        assert.equal(p.questionKind, 'jd_question');
        assert.equal(p.evidenceSourcesToProbe[0], 'profile_jd',
            'jd_question MUST probe profile_jd first — the question is about the role');
        assert.equal(p.answerDirectives.seedCandidateBackground, true,
            'jd_question still seeds candidate background when the role is in scope');
    });

    test('cell[jd_question × NO jd × default] = jd, probe profile only (no JD loaded)', () => {
        const p = tp('What is the job regarding?', { availability: {
            hasReferenceFiles: false, hasProfileFacts: true, hasJobDescription: false, hasLiveTranscript: true,
        } });
        assert.equal(p.questionKind, 'jd_question');
        assert.deepEqual(p.evidenceSourcesToProbe, ['profile_resume']);
    });

    // ── GENERAL ──────────────────────────────────────────────────────
    test('cell[general × full × default] = general, probe all, seedBG=false (seeder-leash)', () => {
        const p = tp("What's your salary expectation?", { answerType: 'negotiation_answer' });
        assert.equal(p.questionKind, 'general');
        assert.equal(p.answerDirectives.seedCandidateBackground, false,
            'CRITICAL: general questions MUST NOT auto-seed candidate background (founder §2.5)');
        assert.deepEqual(p.evidenceSourcesToProbe,
            ['profile_resume', 'projects', 'profile_jd', 'reference_files'],
            'general probes all available sources so a content match still grounds the answer');
    });

    test('cell[general × no availability × default] = general, empty probe, general-labeled', () => {
        const p = tp("What's your salary expectation?", { availability: {
            hasReferenceFiles: false, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: true,
        } });
        assert.equal(p.questionKind, 'general');
        assert.deepEqual(p.evidenceSourcesToProbe, []);
        assert.equal(p.answerDirectives.seedCandidateBackground, false);
        assert.equal(p.groundingProfile.onNoEvidence, 'answer_general_labeled',
            'NEVER refuse in non-refuse profiles — must answer general-labeled');
    });

    // ── DOC_QUESTION ─────────────────────────────────────────────────
    test('cell[doc_question × refs available] = doc, probe reference_files only', () => {
        const p = tp('summarize the deck', { answerType: 'lecture_answer', availability: {
            hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true,
        } });
        assert.equal(p.questionKind, 'doc_question');
        assert.deepEqual(p.evidenceSourcesToProbe, ['reference_files']);
    });

    // ── CODING_QUESTION ──────────────────────────────────────────────
    test('cell[coding_question × coding] = coding, probe refs first then profile', () => {
        const p = tp('reverse a linked list', { answerType: 'coding_question_answer' });
        assert.equal(p.questionKind, 'coding_question');
        assert.equal(p.evidenceSourcesToProbe[0], 'reference_files');
    });
});

describe('TurnPlanner matrix: SEMINAR profile', () => {
    // Force seminar by writing the env flag before any planTurn call in this
    // suite. (TurnPlanner reads process.env.NATIVELY_SEMINAR_MODE === '1'.)
    // Set/unset inside each test (node test runner doesn't guarantee setup
    // ordering across describe blocks).
    test('seminar profile = required / say_not_found_then_answer_general (strict)', () => {
        const prev = process.env.NATIVELY_SEMINAR_MODE;
        process.env.NATIVELY_SEMINAR_MODE = '1';
        try {
            const p = tp('what does the paper say about X?');
            assert.equal(p.groundingProfile.evidencePreference, 'required');
            assert.equal(p.groundingProfile.onNoEvidence, 'say_not_found_then_answer_general');
            assert.equal(p.groundingProfile.labelStyle, 'badge');
        } finally {
            if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
            else process.env.NATIVELY_SEMINAR_MODE = prev;
        }
    });

    test('seminar off-file question: seedBG respects kind; profile = strict; (no answerless invariant)', () => {
        const prev = process.env.NATIVELY_SEMINAR_MODE;
        process.env.NATIVELY_SEMINAR_MODE = '1';
        try {
            const p = tp('who is the CEO?', {
                answerType: 'general_meeting_answer',
                availability: { hasReferenceFiles: true, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: true },
            });
            assert.equal(p.questionKind, 'general');
            assert.equal(p.groundingProfile.onNoEvidence, 'say_not_found_then_answer_general',
                'seminar still answers — just labels');
            assert.equal(p.answerDirectives.seminarNotFoundPreamble, true,
                'seminar profile must flag the not-in-files preamble');
        } finally {
            if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
            else process.env.NATIVELY_SEMINAR_MODE = prev;
        }
    });
});

describe('TurnPlanner matrix: invariant — never answerless', () => {
    test('every question_kind × every availability emits a TurnPlan (never null)', () => {
        const kinds = ['profile_question', 'jd_question', 'doc_question', 'coding_question', 'general'];
        const availabilities = [
            { hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true },
            { hasReferenceFiles: false, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: true },
            { hasReferenceFiles: true, hasProfileFacts: false, hasJobDescription: false, hasLiveTranscript: false },
        ];
        for (const k of kinds) {
            for (const a of availabilities) {
                const p = tp('any question', { answerType: null, availability: a });
                assert.ok(p, `planner returned null for ${k}`);
                assert.ok(p.questionKind, `kind must be set for ${k}`);
            }
        }
    });

    test('default profile is NEVER refuse (founder §2.3: refuse exists only for compliance custom modes)', () => {
        assert.notEqual(DEFAULT_GROUNDING_PROFILE.onNoEvidence, 'refuse');
        assert.notEqual(SEMINAR_GROUNDING_PROFILE.onNoEvidence, 'refuse',
            'seminar is strict but does NOT refuse — it answers with the not-in-files preamble');
    });
});

describe('TurnPlanner matrix: source badge strings (founder §2.6)', () => {
    test('profile_question + STRONG evidence → label style "badge" (not paragraph)', () => {
        const p = tp("What's your name?", { answerType: 'identity_answer' });
        assert.equal(p.groundingProfile.labelStyle, 'badge');
        assert.equal(p.answerDirectives.labelGeneral, true,
            'general knowledge answers must carry the "General knowledge" badge');
    });

    test('seminar + off-file → seminarNotFoundPreamble=true (the §2.6 "Not in your reference files" badge)', () => {
        const prev = process.env.NATIVELY_SEMINAR_MODE;
        process.env.NATIVELY_SEMINAR_MODE = '1';
        try {
            const p = tp('what is the square root of pi?', { answerType: 'general' });
            assert.equal(p.groundingProfile.onNoEvidence, 'say_not_found_then_answer_general');
            assert.equal(p.answerDirectives.seminarNotFoundPreamble, true);
        } finally {
            if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
            else process.env.NATIVELY_SEMINAR_MODE = prev;
        }
    });
});