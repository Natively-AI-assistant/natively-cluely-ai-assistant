// electron/llm/__tests__/SourceBadge.test.mjs
//
// Campaign 3 (fix/answer-policy-engine, 2026-07-19, founder §2.6):
// Source badge helper tests. Covers the behavior matrix cells for
// {question_kind × evidence_found × profile}.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { computeSourceBadge, renderSourceBadge } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/SourceBadge.js')).href
);

/** Helper: minimal TurnPlan stub. */
const tp = (kind, opts = {}) => ({
    questionKind: kind,
    evidenceSourcesToProbe: opts.probes ?? ['profile_resume', 'projects', 'profile_jd'],
    groundingProfile: opts.profile ?? {
        evidencePreference: 'preferred',
        onNoEvidence: 'answer_general_labeled',
        labelStyle: 'badge',
    },
    answerDirectives: {
        candidateIdentityOverride: null,
        labelGeneral: true,
        seminarNotFoundPreamble: false,
        seedCandidateBackground: false,
    },
});

describe('SourceBadge: behavior matrix (founder §2.6)', () => {
    // ── profile_question ──────────────────────────────────────────
    test('profile_question × STRONG profile evidence → "From: Resume"', () => {
        const label = computeSourceBadge({ turnPlan: tp('profile_question', { probes: ['profile_resume'] }), evidenceFound: true });
        assert.equal(label, 'From: Resume');
    });

    test('profile_question × NO evidence × default profile → "General knowledge"', () => {
        const label = computeSourceBadge({ turnPlan: tp('profile_question', { probes: [] }), evidenceFound: false });
        assert.equal(label, 'General knowledge');
    });

    test('profile_question × profile+jd evidence → "Mixed: Resume + Job description"', () => {
        const label = computeSourceBadge({ turnPlan: tp('profile_question', { probes: ['profile_resume', 'profile_jd'] }), evidenceFound: true });
        assert.equal(label, 'Mixed: Resume + Job description');
    });

    // ── jd_question ───────────────────────────────────────────────
    test('jd_question × STRONG jd evidence → "From: Job description"', () => {
        const label = computeSourceBadge({ turnPlan: tp('jd_question', { probes: ['profile_jd'] }), evidenceFound: true });
        assert.equal(label, 'From: Job description');
    });

    test('jd_question × NO jd × reference_files probe → "From: Reference files"', () => {
        const label = computeSourceBadge({ turnPlan: tp('jd_question', { probes: ['reference_files'] }), evidenceFound: true });
        assert.equal(label, 'From: Reference files');
    });

    // ── doc_question ──────────────────────────────────────────────
    test('doc_question × STRONG reference evidence → "From: Reference files"', () => {
        const label = computeSourceBadge({ turnPlan: tp('doc_question', { probes: ['reference_files'] }), evidenceFound: true });
        assert.equal(label, 'From: Reference files');
    });

    test('doc_question × NO evidence → "General knowledge"', () => {
        const label = computeSourceBadge({ turnPlan: tp('doc_question', { probes: [] }), evidenceFound: false });
        assert.equal(label, 'General knowledge');
    });

    // ── coding_question / general ─────────────────────────────────
    test('coding_question × ANY → "General knowledge"', () => {
        const label = computeSourceBadge({ turnPlan: tp('coding_question', { probes: ['reference_files', 'profile_resume'] }), evidenceFound: true });
        assert.equal(label, 'General knowledge',
            'coding answers are general — they should not advertise a file source');
    });

    test('general × ANY → "General knowledge"', () => {
        const label = computeSourceBadge({ turnPlan: tp('general'), evidenceFound: false });
        assert.equal(label, 'General knowledge');
    });

    // ── Seminar ───────────────────────────────────────────────────
    test('seminar + off-document → "Not in your reference files — from general knowledge:"', () => {
        const seminar = tp('general', { profile: {
            evidencePreference: 'required',
            onNoEvidence: 'say_not_found_then_answer_general',
            labelStyle: 'badge',
        } });
        const label = computeSourceBadge({ turnPlan: seminar, evidenceFound: false });
        assert.equal(label, 'Not in your reference files — from general knowledge:',
            'seminar profile MUST use the not-in-files preamble for off-doc questions (founder §2.3)');
    });

    test('seminar + strong ref-file evidence → "From: Reference files"', () => {
        const seminar = tp('doc_question', { profile: {
            evidencePreference: 'required',
            onNoEvidence: 'say_not_found_then_answer_general',
            labelStyle: 'badge',
        } });
        const label = computeSourceBadge({ turnPlan: seminar, evidenceFound: true });
        assert.equal(label, 'From: Reference files',
            'seminar with grounded answer uses the regular grounded badge (no preamble)');
    });

    // ── Override ──────────────────────────────────────────────────
    test('forceLabel overrides the matrix', () => {
        const label = computeSourceBadge({ turnPlan: tp('general'), forceLabel: 'From: Resume' });
        assert.equal(label, 'From: Resume');
    });

    // ── Empty input ───────────────────────────────────────────────
    test('null turnPlan → "General knowledge"', () => {
        const label = computeSourceBadge({ turnPlan: null });
        assert.equal(label, 'General knowledge');
    });

    test('renderSourceBadge returns the label verbatim', () => {
        assert.equal(renderSourceBadge('From: Resume'), 'From: Resume');
        assert.equal(renderSourceBadge('General knowledge'), 'General knowledge');
    });
});