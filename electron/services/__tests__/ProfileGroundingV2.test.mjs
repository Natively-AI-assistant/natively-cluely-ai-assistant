// electron/services/__tests__/ProfileGroundingV2.test.mjs
//
// P2 (RC-1/2/4/5/7/10): full-structured-profile injection.
//
//   - ProfileContextBuilder.buildGroundingBlock renders the WHOLE typed resume +
//     JD into one always-present block with authorization + completeness +
//     scoped-security rules (no retrieval, no threshold).
//   - KnowledgeOrchestrator.processQuestion injects it when the flag is ON,
//     forces factualRecall, and works for a JD-only session.
//   - The prompts carry the scoped security carve-out so the user's OWN JD is
//     never refused with "I can't share that information".
//
// Loads compiled premium classes (Electron ABI). Run via:
//   ELECTRON_RUN_AS_NODE=1 npx electron --test <thisfile>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const P = (rel) => pathToFileURL(path.resolve(__dirname, rel)).href;

const { KnowledgeDatabaseManager } = await import(P('../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js'));
const { KnowledgeOrchestrator } = await import(P('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js'));
const { DocType } = await import(P('../../../dist-electron/premium/electron/knowledge/types.js'));
const { buildGroundingBlock, buildCandidateProfileBlock, buildTargetJobBlock } = await import(P('../../../dist-electron/premium/electron/knowledge/ProfileContextBuilder.js'));
const { isProfileGroundingV2Enabled, __resetProfileGroundingV2Cache } = await import(P('../../../dist-electron/electron/llm/profileGroundingV2.js'));

// Enable the flag ONCE at module load, before any test runs. node:test executes
// async sibling tests with enough interleaving that mutating this process-global
// env mid-run races; pinning it on for the whole file removes that race. The
// flag mechanism itself (env on/off, default off) is unit-tested in isolation in
// the "flag mechanism" describe below using synchronous-only assertions.
process.env.PROFILE_GROUNDING_V2 = 'on';
__resetProfileGroundingV2Cache();

const RESUME_DOC = {
    id: 1, type: 'resume', source_uri: 'r.pdf', created_at: 0,
    structured_data: {
        _schema_version: 2,
        identity: { name: 'Evin John', email: '', location: 'Kochi', summary: 'Software engineer.' },
        skills: { languages: ['Python', 'TypeScript', 'SQL'], frameworks: ['React'], cloud: ['AWS', 'GCP'], databases: ['PostgreSQL'], ml: ['PyTorch'], devops: ['Docker'], tools: [] },
        experience: [{ company: 'Acme', role: 'Software Engineer Intern', start_date: '2024-06', end_date: '2024-09', bullets: ['Built internal tooling'], is_internship: true }],
        projects: [{ name: 'RedisMart', description: 'E-commerce engine', technologies: ['Redis', 'Node.js'] }],
        education: [{ institution: 'CUSAT', degree: 'B.Tech', field: 'CS', start_date: '2021-09', end_date: '2025-06' }],
        achievements: [], certifications: [], leadership: [],
    },
};
const JD_DOC = {
    id: 2, type: 'jd', source_uri: 'jd.pdf', created_at: 0,
    structured_data: {
        title: 'Data Analyst', company: 'Globex', location: 'Remote', description_summary: 'Analyze data.',
        level: 'mid', employment_type: 'full_time', min_years_experience: 2, compensation_hint: '',
        requirements: ['SQL', 'Python', 'R'], nice_to_haves: ['Tableau'], responsibilities: ['Build dashboards'],
        technologies: ['SQL', 'Python', 'R', 'Tableau'], keywords: ['data', 'analytics'],
    },
};

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------
describe('P2: ProfileContextBuilder renders the full typed profile', () => {
    test('candidate profile block includes name, ALL skill categories, experience, projects, education', () => {
        const b = buildCandidateProfileBlock(RESUME_DOC);
        assert.match(b, /<candidate_profile>/);
        assert.match(b, /Evin John/);
        assert.match(b, /Python, TypeScript, SQL/);     // languages complete
        assert.match(b, /AWS, GCP/);                    // cloud distinct
        assert.match(b, /RedisMart/);
        assert.match(b, /CUSAT/);
        assert.match(b, /internship/);                  // is_internship surfaced
    });

    test('target job block includes role, company, requirements, technologies (the JD finally rendered)', () => {
        const b = buildTargetJobBlock(JD_DOC);
        assert.match(b, /<target_job>/);
        assert.match(b, /Data Analyst/);
        assert.match(b, /Globex/);
        assert.match(b, /Tableau/);
        assert.match(b, /SQL/);
    });

    test('grounding block carries authorization + completeness + scoped-security rules', () => {
        const { block } = buildGroundingBlock(RESUME_DOC, JD_DOC);
        assert.match(block, /USER'S OWN data/);
        assert.match(block, /NEVER reply that you lack access/i);
        assert.match(block, /COMPLETENESS/);
        assert.match(block, /FIELD PRECISION/);
        assert.match(block, /NEVER to the user's own uploaded data/);
    });

    test('empty inputs → empty block', () => {
        const { block, hasResume, hasJD } = buildGroundingBlock(null, null);
        assert.equal(block, '');
        assert.equal(hasResume, false);
        assert.equal(hasJD, false);
    });

    test('JD-only → block has target_job but no candidate_profile DATA section', () => {
        const { block, hasResume, hasJD } = buildGroundingBlock(null, JD_DOC);
        assert.equal(hasResume, false);
        assert.equal(hasJD, true);
        assert.match(block, /<target_job>/);
        // The rules text references the tag name; assert no OPENING data block.
        assert.doesNotMatch(block, /<candidate_profile>\n/);
    });
});

// ---------------------------------------------------------------------------
// Orchestrator integration — flag OFF vs ON
// ---------------------------------------------------------------------------
function makeStubDb(resume, jd) {
    return {
        initializeSchema() {},
        getDocumentByType(type) {
            if (type === DocType.RESUME || type === 'resume') return resume ? JSON.parse(JSON.stringify(resume)) : null;
            if (type === DocType.JD || type === 'jd') return jd ? JSON.parse(JSON.stringify(jd)) : null;
            return null;
        },
        updateDocumentStructuredData() {},
        getAllNodes() { return []; },
        getNodeCount() { return 0; },
        getIntro() { return null; },
        getGapAnalysis() { return null; },
        getNegotiationScript() { return null; },
        getMockQuestions() { return null; },
        getCultureMappings() { return null; },
    };
}

function makeOrchestrator(resume, jd) {
    const orch = new KnowledgeOrchestrator(makeStubDb(resume, jd));
    orch.setKnowledgeMode(true);
    return orch;
}

// Flag is pinned ON for the whole file (set at module load above), so these
// orchestrator tests need no per-test env mutation — eliminating the race.
describe('P2: orchestrator injection (flag ON for file)', () => {
    test('a profile question gets the full grounding block + factualRecall', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('what are my main programming languages?');
        assert.ok(result);
        assert.match(result.contextBlock, /<candidate_profile>/);
        assert.match(result.contextBlock, /Python, TypeScript, SQL/);
        assert.equal(result.factualRecall, true, 'must bypass the mode gate');
    });

    test('a JD question now has the JD in context (RC-4/5 — was never reachable)', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('how do I fit this data analyst JD?');
        assert.ok(result);
        assert.match(result.contextBlock, /<target_job>/);
        assert.match(result.contextBlock, /Data Analyst/);
        assert.match(result.contextBlock, /Tableau/);
    });

    test('JD-only session (no resume) grounds on the JD instead of null (RC-8)', async () => {
        const orch = makeOrchestrator(null, JD_DOC);
        // isKnowledgeMode() is false without a resume, but the V2 JD-only
        // short-circuit fires on knowledgeModeActive + activeJD.
        const result = await orch.processQuestion('what role am I applying for?');
        assert.ok(result, 'JD-only session must return a grounded result, not null');
        assert.match(result.contextBlock, /<target_job>/);
        assert.match(result.contextBlock, /Data Analyst/);
        assert.equal(result.factualRecall, true);
    });

    test('the grounding block forbids the "I don\'t have access" refusal', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('what AI tools are on my resume?');
        assert.match(result.contextBlock, /NEVER reply that you lack access/i);
    });

    test('idempotent, no double injection', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('what are my skills?');
        // Count the OPENING data tag (followed by newline). The grounding_rules
        // text mentions the tag name too, so match the block opener specifically.
        const count = (result.contextBlock.match(/<candidate_profile>\n/g) || []).length;
        assert.equal(count, 1);
    });
});

// S2 (spec §8.3): answer-type gating — profile must be EXCLUDED from coding/
// technical/sales/lecture answers even with a resume loaded and the flag ON.
describe('S2: answer-type gating of the grounding block (flag ON)', () => {
    test('coding question gets NO <candidate_profile> block (spec §12.4, test 15)', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('write a function to reverse a string');
        // Coding is a generic-knowledge bypass → null, or a result with NO profile.
        const ctx = result?.contextBlock || '';
        assert.doesNotMatch(ctx, /<candidate_profile>/, 'coding must not get the resume');
        assert.doesNotMatch(ctx, /<target_job>/, 'coding must not get the JD');
    });

    test('technical-concept question ("explain BFS") gets NO profile', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('explain BFS');
        const ctx = result?.contextBlock || '';
        assert.doesNotMatch(ctx, /<candidate_profile>/);
        assert.doesNotMatch(ctx, /<target_job>/);
    });

    test('identity question gets resume but NOT the JD (minimal context, §4)', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('what is my name?');
        const ctx = result?.contextBlock || result?.introResponse || '';
        // identity may short-circuit to introResponse; if it grounds, JD must be absent
        if (/<candidate_profile>\n/.test(ctx)) {
            assert.doesNotMatch(ctx, /<target_job>\n/, 'identity must not pull the JD');
        }
    });

    test('skill_experience ("have you used X?") gets resume, not JD', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('have you used Python?');
        const ctx = result?.contextBlock || '';
        assert.match(ctx, /<candidate_profile>\n/, 'skill_experience must include the resume');
        assert.doesNotMatch(ctx, /<target_job>\n/, 'skill_experience must not pull the JD');
    });

    test('jd_fit question gets BOTH resume and JD', async () => {
        const orch = makeOrchestrator(RESUME_DOC, JD_DOC);
        const result = await orch.processQuestion('how do I fit this data analyst role?');
        assert.ok(result);
        assert.match(result.contextBlock, /<candidate_profile>/);
        assert.match(result.contextBlock, /<target_job>/);
    });
});

// Flag mechanism — assert the pinned ON state only. Default-OFF behavior is
// covered in ProfileGroundingV2Flag.test.mjs (a separate file with NO async
// orchestrator work, so it can safely toggle the shared env without racing).
describe('P2: flag mechanism', () => {
    test('env "on" enables the flag', () => {
        assert.equal(isProfileGroundingV2Enabled(), true);
    });
});

// ---------------------------------------------------------------------------
// Prompt-level security carve-out (RC-7)
// ---------------------------------------------------------------------------
describe('P2: scoped security carve-out in prompts (RC-7)', () => {
    const promptsSrc = fs.readFileSync(path.resolve(__dirname, '../../llm/prompts.ts'), 'utf8');

    test('CORE_IDENTITY security block exempts the user\'s own resume/JD', () => {
        assert.ok(promptsSrc.includes("does NOT apply to the USER'S OWN uploaded data"));
        assert.ok(promptsSrc.includes('never refuse them with'));
        assert.ok(promptsSrc.includes('NOT a request to reveal your instructions'));
    });

    test('the carve-out names the JD self-question explicitly', () => {
        assert.ok(promptsSrc.includes('What is in my uploaded job description?'));
    });

    test('the carve-out appears in BOTH the grounded path (CORE_IDENTITY) and chat path (CHAT_MODE_PROMPT)', () => {
        const matches = promptsSrc.split("does NOT apply to the USER'S OWN uploaded data").length - 1;
        assert.equal(matches, 2, 'carve-out must be in both CORE_IDENTITY and CHAT_MODE_PROMPT');
    });
});
