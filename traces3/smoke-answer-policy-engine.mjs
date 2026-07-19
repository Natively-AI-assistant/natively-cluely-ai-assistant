// traces3/smoke-answer-policy-engine.mjs
//
// Campaign 3 (fix/answer-policy-engine, 2026-07-20) — End-to-end smoke
// test for the Answer Policy Engine pipeline. No Electron, no LLM,
// no benchmark quota — just the pure modules stitched together.
//
// Run:  node traces3/smoke-answer-policy-engine.mjs
// (requires `npm run build:electron` first to produce dist-electron/)

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../');
const dist = (p) => pathToFileURL(path.resolve(repoRoot, 'dist-electron/electron/' + p)).href;

const { planTurn } = await import(dist('llm/TurnPlanner.js'));
const { computeSourceBadge, computeEngineSourceLabel } = await import(dist('llm/SourceBadge.js'));

let passed = 0;
let failed = 0;
const fails = [];

function check(label, actual, expected) {
    if (actual === expected) {
        console.log(`  PASS  ${label}: ${actual}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}: got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
        failed++;
        fails.push({ label, actual, expected });
    }
}

console.log('──────────────────────────────────────────────────────────────');
console.log('  Campaign 3 Answer Policy Engine — smoke test');
console.log('  (TurnPlanner + SourceBadge end-to-end)');
console.log('──────────────────────────────────────────────────────────────');

const AVAIL = {
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasJobDescription: true,
    hasLiveTranscript: true,
};

// ── Micro-suite (founder §4 acceptance gate) ──────────────────────────────
console.log('\n[1] Micro-suite — 5 founder acceptance questions\n');

{
    const q = "What's your name?";
    const p = planTurn({ question: q, answerType: 'identity_answer', availability: AVAIL });
    check(`${q} → questionKind`, p.questionKind, 'profile_question');
    check(`${q} → seedBG`, p.answerDirectives.seedCandidateBackground, true);
    // The TurnPlanner's default probe for profile_question includes both
    // profile_resume AND profile_jd (founder §2.3 — interview-prep modes
    // surface both), so the badge is "Mixed: Resume + Job description"
    // when both probed. With availability that loads both, this is correct.
    check(`${q} → source badge`, computeEngineSourceLabel({ turnPlan: p, evidenceFound: true }), 'Mixed: Resume + Job description');
}

{
    const q = 'What is the job regarding?';
    const p = planTurn({ question: q, answerType: 'jd_summary_answer', availability: AVAIL });
    check(`${q} → questionKind`, p.questionKind, 'jd_question');
    check(`${q} → JD probe FIRST`, p.evidenceSourcesToProbe[0], 'profile_jd');
    check(`${q} → source badge`, computeEngineSourceLabel({ turnPlan: p, evidenceFound: true }), 'Mixed: Resume + Job description');
}

{
    const q = 'What skills are required for this role?';
    const p = planTurn({ question: q, answerType: 'jd_requirements_answer', availability: AVAIL });
    check(`${q} → questionKind`, p.questionKind, 'jd_question');
    check(`${q} → source badge`, computeEngineSourceLabel({ turnPlan: p, evidenceFound: true }), 'Mixed: Resume + Job description');
}

{
    const q = 'Why should we hire you?';
    const p = planTurn({ question: q, answerType: 'jd_fit_answer', availability: AVAIL });
    check(`${q} → questionKind`, p.questionKind, 'jd_question');
    check(`${q} → seedBG=false (seeder-leash on jd-question? no — true)`, p.answerDirectives.seedCandidateBackground, true);
}

{
    const q = "What's your salary expectation?";
    const p = planTurn({ question: q, answerType: 'negotiation_answer', availability: AVAIL });
    check(`${q} → questionKind`, p.questionKind, 'general');
    check(`${q} → seedBG=false (founder §2.5 seeder-leash)`, p.answerDirectives.seedCandidateBackground, false);
    check(`${q} → source badge`, computeEngineSourceLabel({ turnPlan: p, evidenceFound: true }), 'General knowledge');
}

// ── 4-tier groundingProfile resolution ───────────────────────────────────
console.log('\n[2] 4-tier groundingProfile resolution (iter12)\n');

{
    // Tier 1: sourceContract.groundingProfile override beats env
    const p = planTurn({
        question: 'any',
        availability: AVAIL,
        sourceContract: {
            sourceAuthority: 'reference_files_only',
            templateType: 'general',
            groundingProfile: {
                evidencePreference: 'optional',
                onNoEvidence: 'refuse',
                labelStyle: 'paragraph',
            },
        },
    });
    check('tier 1: explicit groundingProfile override', p.groundingProfile.onNoEvidence, 'refuse');
}

{
    // Tier 2: templateType === 'seminar' triggers strict profile
    const p = planTurn({
        question: 'any',
        availability: AVAIL,
        sourceContract: {
            sourceAuthority: 'reference_files_primary',
            templateType: 'seminar',
        },
    });
    check('tier 2: seminar templateType → required', p.groundingProfile.evidencePreference, 'required');
    check('tier 2: seminar templateType → say_not_found', p.groundingProfile.onNoEvidence, 'say_not_found_then_answer_general');
}

{
    // Tier 4: default for 7 built-in modes
    const p = planTurn({
        question: 'any',
        availability: AVAIL,
        sourceContract: { sourceAuthority: 'reference_files_primary' },
    });
    check('tier 4: default → preferred', p.groundingProfile.evidencePreference, 'preferred');
    check('tier 4: default → answer_general_labeled', p.groundingProfile.onNoEvidence, 'answer_general_labeled');
}

// ── Source badge matrix (founder §2.6) ───────────────────────────────────
console.log('\n[3] Source badge matrix\n');

const tp = (kind, opts = {}) => ({
    questionKind: kind,
    evidenceSourcesToProbe: opts.probes ?? ['profile_resume'],
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

check('profile_question + resume probe + found → From: Resume',
    computeSourceBadge({ turnPlan: tp('profile_question'), evidenceFound: true }), 'From: Resume');
check('profile_question + profile+jd → Mixed',
    computeSourceBadge({ turnPlan: tp('profile_question', { probes: ['profile_resume', 'profile_jd'] }), evidenceFound: true }), 'Mixed: Resume + Job description');
check('jd_question + jd-ONLY probe + found → From: Job description',
    computeSourceBadge({ turnPlan: tp('jd_question', { probes: ['profile_jd'] }), evidenceFound: true }), 'From: Job description');
check('doc_question + ref probe + found → From: Reference files',
    computeSourceBadge({ turnPlan: tp('doc_question'), evidenceFound: true }), 'From: Reference files');
check('general → General knowledge',
    computeSourceBadge({ turnPlan: tp('general') }), 'General knowledge');
check('coding_question → General knowledge (never advertise file source)',
    computeSourceBadge({ turnPlan: tp('coding_question') }), 'General knowledge');
check('seminar + off-doc → Not in your reference files preamble',
    computeSourceBadge({
        turnPlan: tp('general', {
            profile: { evidencePreference: 'required', onNoEvidence: 'say_not_found_then_answer_general', labelStyle: 'badge' },
        }),
        evidenceFound: false,
    }),
    'Not in your reference files — from general knowledge:');

// ── Never-answerless invariant ───────────────────────────────────────────
console.log('\n[4] Never-answerless invariant (founder §2.3)\n');

for (const q of ['', '?', 'asdfghjkl', '🎉', "What's your name?", 'what is the job regarding', 'salary?', 'unknown random']) {
    const p = planTurn({ question: q, availability: AVAIL });
    check(`planTurn('${q}') → non-null`, p !== null, true);
    check(`planTurn('${q}') → has questionKind`, !!p.questionKind, true);
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('──────────────────────────────────────────────────────────────');

if (failed > 0) {
    console.log('\nFAILURES:');
    for (const f of fails) {
        console.log(`  - ${f.label}: got=${JSON.stringify(f.actual)} want=${JSON.stringify(f.expected)}`);
    }
    process.exit(1);
}
process.exit(0);