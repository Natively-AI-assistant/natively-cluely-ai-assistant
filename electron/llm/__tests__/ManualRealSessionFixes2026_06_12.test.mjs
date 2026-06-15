// electron/llm/__tests__/ManualRealSessionFixes2026_06_12.test.mjs
//
// Manual regression 2026-06-12 — fixes for REAL ~200-question session failures:
//   P2  identity routing: candidate-ambiguous probes reach the profile fast
//       path; assistant-meta probes stay canned.
//   P3  answer diversity guard: repeats flagged across different questions.
//   P4  scaffolds hidden by default (speakable rendering directive), kept on
//       explicit structure requests; WTA always speakable.
//   P5  bullet/artifact cleanup: no orphan "*" lines.
//   P6  sales voice: SALES_TEMPLATE seller voice, never assistant identity.
//   P7  built-with / open-source routing to project_about (regression pins).
//   +   formatIntro variants, project grammar fix, two-item list grammar.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');

const { resolveIdentityProbe } = await import(pathToFileURL(path.join(distRoot, 'llm/manualIdentityRouting.js')).href);
const { planAnswer, formatAnswerPlanForPrompt, isSpeakableOnlyPlan } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);
const { cleanAnswerArtifacts, AnswerDiversityGuard, compressToSpeakable } = await import(pathToFileURL(path.join(distRoot, 'llm/answerPolish.js')).href);
const { tryBuildManualProfileFastPathAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/manualProfileIntelligence.js')).href);

const PROFILE = {
    name: 'Aarav Menon',
    experience: [
        { role: 'Data Analyst', company: 'Initech' },
        { role: 'Junior Engineer', company: 'Globex' },
    ],
    skills: ['SQL', 'Python', 'Tableau'],
    projects: [{ name: 'SQL-Copilot', description: 'A query assistant for analysts' }],
};

// ── P2: identity routing ─────────────────────────────────────────────────────
describe('P2: identity probe routing', () => {
    test('candidate-ambiguous probes go to the fast path when a profile is loaded', () => {
        for (const q of ['who are you?', 'what is your name?', 'introduce yourself', 'tell me who you are']) {
            assert.equal(resolveIdentityProbe(q, true).kind, 'candidate_fast_path', q);
        }
    });
    test('candidate-ambiguous probes stay canned with NO profile', () => {
        for (const q of ['who are you?', 'introduce yourself']) {
            const d = resolveIdentityProbe(q, false);
            assert.equal(d.kind, 'assistant_reply', q);
            assert.match(d.reply, /I'm Natively/);
        }
    });
    test('assistant-meta probes stay canned even WITH a profile', () => {
        const cases = [
            ['are you an AI?', /I'm Natively/],
            ['are you chatgpt?', /I'm Natively/],
            ['what is natively?', /I'm Natively/],
            ['what model are you?', /I'm Natively/],
            ['who built natively?', /developed by Evin John/],
            ['who made you', /developed by Evin John/],
        ];
        for (const [q, re] of cases) {
            const d = resolveIdentityProbe(q, true);
            assert.equal(d.kind, 'assistant_reply', q);
            assert.match(d.reply, re, q);
        }
    });
    test('normal questions are untouched', () => {
        for (const q of ['solve two sum', 'why should we hire you?', 'who are you reporting to in this role?']) {
            assert.equal(resolveIdentityProbe(q, true).kind, 'none', q);
        }
    });
    test('the fast path actually answers the routed probes (no Natively leak possible)', () => {
        for (const q of ['who are you?', 'what is your name?', 'introduce yourself']) {
            const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'manual_input' });
            assert.ok(r?.answer, q);
            assert.match(r.answer, /Aarav Menon/);
            assert.doesNotMatch(r.answer, /Natively|AI assistant/i);
        }
    });
});

// ── P4: scaffolds hidden by default ──────────────────────────────────────────
describe('P4: speakable-by-default rendering', () => {
    const plan = (q, source = 'manual_input') => planAnswer({ question: q, source, speakerPerspective: source === 'manual_input' ? 'user' : 'interviewer' });
    test('default gap/jd-fit/behavioral/project get the speakable rendering directive', () => {
        for (const q of ['what gaps do you have for this role?', 'why are you a good fit for this role?', 'tell me about a time you failed', 'tell me about your best project']) {
            const p = plan(q);
            assert.ok(isSpeakableOnlyPlan(p), `${q} → ${p.answerType}`);
            assert.match(formatAnswerPlanForPrompt(p, false), /OUTPUT ONLY the final speakable answer/);
        }
    });
    test('explicit structure requests keep the sections', () => {
        for (const q of ['what gaps do you have? explain in detail', 'why should we hire you in bullet points', 'tell me about a conflict you handled, use STAR format']) {
            const p = plan(q);
            assert.ok(!isSpeakableOnlyPlan(p), `${q} (style=${p.answerStyle})`);
        }
    });
    test('implicit behavioral phrasing ("tell me about a time…") stays speakable', () => {
        const p = plan('tell me about a time you failed');
        assert.equal(p.answerStyle, 'star');
        assert.ok(isSpeakableOnlyPlan(p), 'implicit STAR cue must not expose section labels');
    });
    test('WTA is ALWAYS speakable even when phrased detailed', () => {
        const p = plan('what gaps do you have for this role? walk me through in detail', 'what_to_answer');
        assert.ok(isSpeakableOnlyPlan(p));
    });
    test('coding answers never get the speakable directive (scaffold is their contract)', () => {
        const p = plan('solve two sum');
        assert.ok(!isSpeakableOnlyPlan(p));
        assert.doesNotMatch(formatAnswerPlanForPrompt(p, false), /OUTPUT ONLY the final speakable/);
    });
});

// ── P5: artifact cleanup ─────────────────────────────────────────────────────
describe('P5: bullet/artifact cleanup', () => {
    test('orphan bullet lines removed; real bullets kept', () => {
        const out = cleanAnswerArtifacts('My strengths:\n* SQL depth\n*\n* \n- \n* Python fluency\n*');
        assert.doesNotMatch(out, /^\s*[-*•]\s*$/m);
        assert.match(out, /SQL depth/);
        assert.match(out, /Python fluency/);
        assert.ok(!out.endsWith('*'));
    });
    test('code blocks preserved byte-for-byte', () => {
        const code = '```python\n# comment with *\nx = [a * b]\n```';
        const out = cleanAnswerArtifacts(`Look:\n${code}\n*`);
        assert.ok(out.includes(code));
    });
    test('bullet-points styles still render content ("hire you in bullet points")', () => {
        // The cleanup must not strip CONTENT bullets — only empty markers.
        const ans = '* Proven SQL depth at Initech\n* Shipped SQL-Copilot\n* Fast ramp on Tableau';
        assert.equal(cleanAnswerArtifacts(ans), ans);
    });
});

// ── P3: diversity guard ──────────────────────────────────────────────────────
describe('P3: answer diversity guard', () => {
    test('same answer to DIFFERENT questions is flagged; same question is allowed', () => {
        const g = new AnswerDiversityGuard(20);
        const intro = "I'm Aarav Menon, a Data Analyst at Initech. I work mainly with SQL, Python, and Tableau.";
        g.record(intro, 'identity_answer', 'introduce yourself');
        assert.equal(g.check(intro, 'identity_answer', 'introduce yourself').repeated, false, 'same question re-asked');
        const v = g.check(intro, 'identity_answer', 'walk me through your background');
        assert.equal(v.repeated, true, 'cross-question reuse');
    });
    test('repeated scaffold labels across questions are flagged', () => {
        const g = new AnswerDiversityGuard(20);
        const a1 = 'The Honest Gap:\nLess Tableau depth.\nWhy It\'s Manageable:\nStrong SQL.\nHow I\'d Close It:\nTwo-week ramp.\nSpeakable Final Answer:\nMy gap is Tableau, manageable through my SQL depth.';
        const a2 = 'The Honest Gap:\nLimited R experience.\nWhy It\'s Manageable:\nPython covers it.\nHow I\'d Close It:\nSide project.\nSpeakable Final Answer:\nMy gap is R, manageable through Python.';
        g.record(a1, 'gap_analysis_answer', 'what gaps do you have?');
        const v = g.check(a2, 'gap_analysis_answer', 'what is your weakness for this role?');
        assert.equal(v.repeated, true);
        assert.equal(v.reason, 'same_scaffold');
    });
    test('history bounded to maxItems', () => {
        const g = new AnswerDiversityGuard(5);
        for (let i = 0; i < 30; i++) g.record(`answer number ${i} entirely unique content here`, 'general_meeting_answer', `q${i}`);
        assert.equal(g.size, 5);
    });
    test('compressToSpeakable extracts the speakable body and strips labels', () => {
        const out = compressToSpeakable('The Honest Gap:\nTableau.\n\nSpeakable Final Answer:\nMy main gap is Tableau, but my SQL depth gets me productive on dashboards within weeks.');
        assert.doesNotMatch(out, /Honest Gap|Speakable Final Answer/);
        assert.match(out, /Tableau/);
    });
});

// ── P6: sales voice ──────────────────────────────────────────────────────────
describe('P6: sales template voice', () => {
    const salesQs = ['why is your product expensive?', 'can you reduce the price?', 'why should a customer choose your product?'];
    test('sales questions carry seller voice + assistant-identity ban + resume ban', () => {
        for (const q of salesQs) {
            const p = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
            assert.ok(['sales_answer', 'product_candidate_mix_answer'].includes(p.answerType), `${q} → ${p.answerType}`);
            const c = formatAnswerPlanForPrompt(p, false);
            assert.match(c, /SELLER'S spoken voice|seller\/representative/i, q);
            assert.match(c, /NEVER say "I'm Natively"|Never identify as an AI assistant/, q);
            assert.ok(p.forbiddenContextLayers.includes('resume'), q);
        }
    });
    test('named-competitor comparison routes to sales via the SALES MODE prior (the real set-17 setup)', () => {
        // "how do you compare with Cluely?" has no generic sales keyword — adding
        // one would capture "how do you compare two algorithms" (checked before
        // technical). The W1 mode prior owns this: ambiguous turn + sales mode.
        const salesMode = { id: 'm', templateType: 'sales', name: 'Sales', isCustom: false };
        const p = planAnswer({ question: 'how do you compare with Cluely?', source: 'manual_input', speakerPerspective: 'user', activeMode: salesMode });
        assert.equal(p.answerType, 'sales_answer');
        assert.match(formatAnswerPlanForPrompt(p, false), /SELLER'S spoken voice/i);
    });
    test('customer-objection coaching routes to sales with seller voice', () => {
        const p = planAnswer({ question: 'customer says it is too slow, what should I say?', source: 'manual_input', speakerPerspective: 'user' });
        assert.equal(p.answerType, 'sales_answer');
    });
});

// ── P7: built-with / open-source routing pins ───────────────────────────────
describe('P7: project tech-stack/source routing', () => {
    const route = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' }).answerType;
    test('"what is Natively built with?" → project_about (tech stack), never source-evidence refusal', () => {
        assert.equal(route('what is Natively built with?'), 'project_about_answer');
    });
    test('"is Natively open source?" → project_about', () => {
        assert.equal(route('is Natively open source?'), 'project_about_answer');
    });
    test('"show me the exact source code" → source_code_evidence (refuse unless loaded)', () => {
        assert.equal(route('show me the exact source code of Natively'), 'source_code_evidence_answer');
    });
    test('"give me the GitHub link" → project_link (loaded link only)', () => {
        assert.equal(route('give me the GitHub link for Natively'), 'project_link_answer');
    });
});

// ── Behavioral war-story vs live-debugging routing (stress seq_056) ─────────
describe('behavioral past-experience routing', () => {
    const route = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' }).answerType;
    test('"difficult bug you solved" is a STAR story (candidate voice), not a debugging task', () => {
        for (const q of ['tell me about a difficult bug you solved', 'describe a bug you fixed under pressure', 'what was the hardest bug you ever faced?']) {
            const p = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
            assert.equal(p.answerType, 'behavioral_interview_answer', q);
            assert.equal(p.voicePerspective === 'first_person_candidate' || p.voicePerspective === 'second_person_user', true, q);
        }
    });
    test('live debugging asks stay technical (profile forbidden)', () => {
        for (const q of ['why is my API returning 500?', 'how would you debug a memory leak?', 'there is a bug in this function, find it']) {
            const t = route(q);
            assert.ok(['debugging_question_answer', 'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer'].includes(t), `${q} → ${t}`);
        }
    });
});

// ── Intro variants + grammar fixes ───────────────────────────────────────────
describe('intro variants + grammar', () => {
    test('intro/background/style questions produce DIFFERENT grounded intros', () => {
        const intro = tryBuildManualProfileFastPathAnswer({ question: 'introduce yourself', profile: PROFILE, source: 'manual_input' })?.answer;
        const background = tryBuildManualProfileFastPathAnswer({ question: 'walk me through your background', profile: PROFILE, source: 'manual_input' })?.answer;
        const style = tryBuildManualProfileFastPathAnswer({ question: 'how would you describe yourself?', profile: PROFILE, source: 'manual_input' })?.answer;
        assert.ok(intro && background && style);
        assert.notEqual(intro, background);
        assert.notEqual(intro, style);
        for (const a of [intro, background, style]) assert.match(a, /Aarav Menon/);
    });
    test('intro variant selection is deterministic (same question → same answer)', () => {
        const a = tryBuildManualProfileFastPathAnswer({ question: 'introduce yourself', profile: PROFILE, source: 'manual_input' })?.answer;
        const b = tryBuildManualProfileFastPathAnswer({ question: 'introduce yourself', profile: PROFILE, source: 'manual_input' })?.answer;
        assert.equal(a, b);
    });
    test('project description article lowercased after copula ("is a privacy-first", not "is A")', () => {
        const r = tryBuildManualProfileFastPathAnswer({ question: 'tell me about SQL-Copilot', profile: PROFILE, source: 'manual_input' });
        if (r?.answer) {
            assert.doesNotMatch(r.answer, /\bis A\s/);
            assert.match(r.answer, /is a query assistant/);
        }
    });
    test('two-item skill list reads "X and Y" (no Oxford comma)', () => {
        const twoSkill = { ...PROFILE, skills: ['SQL', 'Python'] };
        const r = tryBuildManualProfileFastPathAnswer({ question: 'introduce yourself', profile: twoSkill, source: 'manual_input' });
        assert.match(r.answer, /SQL and Python/);
        assert.doesNotMatch(r.answer, /SQL, and Python/);
    });
});

// ── Wiring pins (source-level) ───────────────────────────────────────────────
describe('wiring pins', () => {
    const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
    const llmHelperSrc = readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
    const orchSrc = readFileSync(path.resolve(__dirname, '../../../premium/electron/knowledge/KnowledgeOrchestrator.ts'), 'utf8');

    test('ipcHandlers uses resolveIdentityProbe (old inline regex gone)', () => {
        assert.doesNotMatch(ipcSrc, /const IDENTITY_PROBE_RE\s*=/);
        assert.match(ipcSrc, /resolveIdentityProbe\(message, probeProfileReady\)/);
    });
    test('sales/lecture are contract-injected on the manual path', () => {
        assert.match(ipcSrc, /'sales_answer', 'product_candidate_mix_answer', 'lecture_answer',\s*\n\s*\]\);/);
    });
    test('mode injection is NOT skipped for mode-scoped answers under CHAT_MODE_PROMPT', () => {
        assert.match(llmHelperSrc, /isModeScopedAnswer/);
        assert.match(llmHelperSrc, /isUniversalOverride && !isModeScopedAnswer/);
    });
    test('bare-followup gate respects the rolling context snapshot + active-mode surface', () => {
        assert.match(ipcSrc, /!context && !autoContextSnapshot && isBareFollowUp\(message\)/);
        assert.match(ipcSrc, /buildContextFreeClarification\(clarSurface\)/);
    });
    test('gap pivots gated on fit/gap/behavioral answer types', () => {
        assert.match(orchSrc, /gapRelevantTypes = new Set\(\['jd_fit_answer', 'gap_analysis_answer', 'behavioral_interview_answer'\]\)/);
    });
    test('live company research is budget-bounded in the hot path', () => {
        assert.match(orchSrc, /Promise\.race\(\[\s*researchPromise/);
    });
    test('foreground gate wired: manual begin/end + embedding queue + live indexer yield', () => {
        assert.match(ipcSrc, /ForegroundGate\.begin\('manual'\)/);
        const pipelineSrc = readFileSync(path.resolve(__dirname, '../../rag/EmbeddingPipeline.ts'), 'utf8');
        assert.match(pipelineSrc, /ForegroundGate\.waitUntilIdle\(\)/);
        const indexerSrc = readFileSync(path.resolve(__dirname, '../../rag/LiveRAGIndexer.ts'), 'utf8');
        assert.match(indexerSrc, /ForegroundGate\.waitUntilIdle\(\)/);
    });
    test('final polish + diversity guard run at the manual render boundary', () => {
        assert.match(ipcSrc, /cleanAnswerArtifacts\(fullResponse\)/);
        assert.match(ipcSrc, /_manualDiversityGuard\.check\(fullResponse/);
    });
});
