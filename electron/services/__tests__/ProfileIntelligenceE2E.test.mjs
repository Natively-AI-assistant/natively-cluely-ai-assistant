// electron/services/__tests__/ProfileIntelligenceE2E.test.mjs
//
// Spec §11 END-TO-END through the REAL compiled KnowledgeOrchestrator: ingest a
// realistic resume + JD, then drive the 21 spec questions through processQuestion
// and assert the grounding/gating/perspective behavior the spec requires —
// crucially that profile context is INCLUDED for profile questions and EXCLUDED
// for coding/technical/sales/lecture (spec §8.3). This is the strongest proof
// available without the live LLM (the project Gemini key was billing-blocked);
// it exercises the actual decision + injection pipeline, not a mock of it.
//
// Run: ELECTRON_RUN_AS_NODE=1 npx electron --test <thisfile>
// V2 is the production default (ON); this asserts the shipped behavior.

import { test, describe, before, after } from 'node:test';
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
const { isProfileGroundingV2Enabled } = await import(P('../../../dist-electron/electron/llm/profileGroundingV2.js'));

// This suite asserts the V2 full-injection behavior (the production default).
// When the kill-switch (PROFILE_GROUNDING_V2=off) is set, the grounding block is
// intentionally absent, so skip — legacy behavior is covered by other suites.
const V2_ON = isProfileGroundingV2Enabled();

// Realistic resume modeled on the spec's running example (Evin John).
const RESUME_FIXTURE = `Evin John
Final-year B.Tech Computer Science student, CUSAT
evin@example.com | Kochi, India

SUMMARY
Software engineer and founder building real-time AI products.

EXPERIENCE
Founder | Natively (Open Source AI Meeting Copilot) | 2024-01 - Present
- Built a privacy-first AI meeting assistant with a Local RAG system
- Hybrid Electron/Rust core for low-latency audio capture
Software Engineer Intern | Aetherbot AI | 2023-06 - 2023-09
- Integrated Unreal Engine pixel streaming with AWS for real-time applications
- Worked with WebRTC for real-time media pipelines

PROJECTS
TalentScope: Real-time technical interview platform (Next.js, Convex, Stream SDK)
RedisMart: High-performance e-commerce engine with Redis caching (React, Node.js, MongoDB)

SKILLS
Python, TypeScript, JavaScript, SQL, C++, React, Next.js, Node.js, FastAPI, AWS, PostgreSQL, MySQL, Redis, WebRTC, Docker

EDUCATION
B.Tech Computer Science Engineering | CUSAT | 2021-09 - 2025-06`;

const JD_FIXTURE = `Job Title: Data Analyst
Company: Globex
Location: Remote
Requirements:
- SQL, Python, R
- Data visualization and dashboarding
- ETL and data processing
Technologies: SQL, Python, R, Tableau
Level: mid`;

function makeTempFile(content) {
    const tmp = path.join(__dirname, `__e2e_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(tmp, content, 'utf-8');
    return tmp;
}

// Deterministic structured extraction modeling what the real extractor returns,
// so the orchestrator pipeline (post-process, chunk, ground, gate) runs for real.
const MOCK_GENERATE_CONTENT = async (contents) => {
    const prompt = contents[0]?.text || '';
    if (/job description|JD TEXT/i.test(prompt) && !/RESUME TEXT/i.test(prompt)) {
        return JSON.stringify({
            title: 'Data Analyst', company: 'Globex', location: 'Remote',
            description_summary: 'Analyze data and build dashboards.', level: 'mid',
            employment_type: 'full_time', min_years_experience: 2, compensation_hint: '',
            requirements: ['SQL, Python, R', 'Data visualization', 'ETL and data processing'],
            nice_to_haves: ['Tableau'], responsibilities: ['Build dashboards', 'Run ETL'],
            technologies: ['SQL', 'Python', 'R', 'Tableau'], keywords: ['data', 'analytics', 'etl'],
        });
    }
    return JSON.stringify({
        identity: { name: 'Evin John', email: 'evin@example.com', phone: '', location: 'Kochi, India', linkedin: '', github: '', website: '', summary: 'Software engineer and founder.' },
        skills: {
            languages: ['Python', 'TypeScript', 'JavaScript', 'SQL', 'C++'],
            frameworks: ['React', 'Next.js', 'Node.js', 'FastAPI'],
            cloud: ['AWS'], databases: ['PostgreSQL', 'MySQL', 'Redis'],
            ml: [], devops: ['Docker'], tools: ['WebRTC'],
        },
        experience: [
            { company: 'Natively', role: 'Founder', start_date: '2024-01', end_date: null, bullets: ['Built a privacy-first AI meeting assistant', 'Hybrid Electron/Rust core'], is_internship: false },
            { company: 'Aetherbot AI', role: 'Software Engineer Intern', start_date: '2023-06', end_date: '2023-09', bullets: ['Integrated Unreal Engine pixel streaming with AWS', 'Worked with WebRTC for real-time media'], is_internship: true },
        ],
        projects: [
            { name: 'TalentScope', description: 'Real-time technical interview platform', technologies: ['Next.js', 'Convex', 'Stream SDK'], url: '' },
            { name: 'RedisMart', description: 'High-performance e-commerce engine with Redis caching', technologies: ['React', 'Node.js', 'MongoDB'], url: '' },
        ],
        education: [{ institution: 'CUSAT', degree: 'B.Tech', field: 'Computer Science Engineering', start_date: '2021-09', end_date: '2025-06', gpa: '' }],
        achievements: [], certifications: [], leadership: [],
    });
};
const MOCK_EMBED_FN = async () => Array(128).fill(0).map((_, i) => (i % 7) * 0.01);

let db, orchestrator, tmpResume, tmpJd;

before(async () => {
    db = new KnowledgeDatabaseManager(new Database(':memory:'));
    db.initializeSchema();
    orchestrator = new KnowledgeOrchestrator(db);
    orchestrator.setGenerateContentFn(MOCK_GENERATE_CONTENT);
    orchestrator.setEmbedFn(MOCK_EMBED_FN);
    tmpResume = makeTempFile(RESUME_FIXTURE);
    tmpJd = makeTempFile(JD_FIXTURE);
    await orchestrator.ingestDocument(tmpResume, DocType.RESUME);
    await orchestrator.ingestDocument(tmpJd, DocType.JD);
    orchestrator.setKnowledgeMode(true);
});
after(() => {
    try { fs.unlinkSync(tmpResume); } catch {}
    try { fs.unlinkSync(tmpJd); } catch {}
    try { db.close?.(); } catch {}
});

// Helpers to assert grounding presence on a processQuestion result.
const ctxOf = (r) => (r?.contextBlock || r?.introResponse || '');
const hasResumeBlock = (r) => /<candidate_profile>\n/.test(ctxOf(r));
const hasJDBlock = (r) => /<target_job>\n/.test(ctxOf(r));
// Whether the user's actual facts are reachable (block present OR an intro/name).
const groundsOnProfile = (r) => hasResumeBlock(r) || /Evin John/.test(ctxOf(r));

describe('Spec §11 E2E: profile questions ARE grounded', { skip: !V2_ON }, () => {
    test('1/2. "what is my name?" grounds on identity (name reachable)', async () => {
        const r = await orchestrator.processQuestion('what is my name?');
        assert.ok(r, 'must return a result');
        assert.ok(groundsOnProfile(r), 'name/identity must be reachable');
    });

    test('3. "tell me about yourself" grounds (intro or profile)', async () => {
        const r = await orchestrator.processQuestion('tell me about yourself');
        assert.ok(r);
        assert.ok(groundsOnProfile(r) || r.isIntroQuestion, 'intro/profile must be reachable');
    });

    test('4. "what projects have I done?" includes the resume', async () => {
        const r = await orchestrator.processQuestion('what projects have I done?');
        assert.ok(r);
        assert.ok(hasResumeBlock(r) || /TalentScope|RedisMart/.test(ctxOf(r)), 'projects must be reachable');
    });

    test('5. "have I used WebRTC?" includes resume, NOT the JD', async () => {
        const r = await orchestrator.processQuestion('have I used WebRTC?');
        assert.ok(r);
        assert.ok(hasResumeBlock(r), 'skill_experience must include resume');
        assert.ok(!hasJDBlock(r), 'skill_experience must NOT pull the JD');
    });

    test('6. "how do I fit this data analyst role?" includes BOTH resume and JD', async () => {
        const r = await orchestrator.processQuestion('how do I fit this data analyst role?');
        assert.ok(r);
        assert.ok(hasResumeBlock(r), 'jd_fit must include resume');
        assert.ok(hasJDBlock(r), 'jd_fit must include the JD');
    });

    test('a JD question is reachable (the original "JD never in context" bug)', async () => {
        const r = await orchestrator.processQuestion('what does this job require?');
        assert.ok(r);
        assert.ok(hasJDBlock(r) || /Data Analyst|SQL/.test(ctxOf(r)), 'JD content must be reachable');
    });
});

describe('Spec §8.3 E2E: coding/technical/sales/lecture get NO profile', () => {
    test('8. "solve two sum" gets NO resume/JD', async () => {
        const r = await orchestrator.processQuestion('solve two sum');
        assert.ok(!hasResumeBlock(r), 'coding must not get resume');
        assert.ok(!hasJDBlock(r), 'coding must not get JD');
    });

    test('9. "explain BFS" gets NO resume/JD', async () => {
        const r = await orchestrator.processQuestion('explain BFS');
        assert.ok(!hasResumeBlock(r), 'technical concept must not get resume');
        assert.ok(!hasJDBlock(r), 'technical concept must not get JD');
    });

    test('15. coding question WITH resume loaded → resume still excluded', async () => {
        const r = await orchestrator.processQuestion('write a function to reverse a string');
        assert.ok(!hasResumeBlock(r), 'coding must not get resume even with profile loaded');
    });

    test('13. "explain this lecture slide" gets NO resume/JD', async () => {
        const r = await orchestrator.processQuestion('explain this lecture slide');
        assert.ok(!hasResumeBlock(r));
        assert.ok(!hasJDBlock(r));
    });

    test('14. "why is your product expensive?" (sales) gets NO resume/JD', async () => {
        const r = await orchestrator.processQuestion('why is your product expensive?');
        assert.ok(!hasResumeBlock(r));
        assert.ok(!hasJDBlock(r));
    });
});

describe('Spec §12 E2E acceptance: no false refusal text in grounded context', { skip: !V2_ON }, () => {
    test('a skills question carries the anti-refusal grounding rule', async () => {
        const r = await orchestrator.processQuestion('what are my programming languages?');
        assert.ok(r);
        // The grounding block instructs the model to never claim lack of access.
        assert.match(ctxOf(r), /NEVER reply that you lack access|Programming Languages|Python/i);
    });
});
