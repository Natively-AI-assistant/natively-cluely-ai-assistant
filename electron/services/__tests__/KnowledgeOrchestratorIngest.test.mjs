// electron/services/__tests__/KnowledgeOrchestratorIngest.test.mjs
//
// Regression for FINDING-004: Premium ingest path (PDF/DOCX through
// KnowledgeOrchestrator.ingestDocument) is gated end-to-end but has no
// service-level test that asserts a parsed resume produces the right
// <candidate_experience> blocks downstream.
//
// This test uses the actual KnowledgeDatabaseManager (not a stub) so all
// its methods are available without any method-shimming overhead.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture: realistic resume text
// ---------------------------------------------------------------------------
const RESUME_FIXTURE = `
Sarah Chen
senior software engineer
san francisco, ca | sarah.chen@gmail.com

SUMMARY
6 years of experience building distributed systems and developer tooling.

EXPERIENCE

Senior Software Engineer | Stripe | 2021-03 - Present
- Led development of a real-time fraud detection pipeline
- Architected microfrontend platform serving 2000+ internal users
Technologies: TypeScript, React, Kafka, PostgreSQL

Software Engineer | Notion | 2018-06 - 2021-02
- Built the collaborative commenting system
Technologies: TypeScript, Node.js, PostgreSQL

Software Engineer | Cruise Automation | 2016-07 - 2018-05
- Developed telemetry dashboards for autonomous vehicles
Technologies: Python, React, Spark

PROJECTS
PriceX: A price-comparison browser extension with 10k monthly active users.
Built with React, Node.js, and PostgreSQL.

SKILLS
TypeScript, React, Node.js, Python, PostgreSQL, Redis, Kafka, AWS

EDUCATION
Stanford University | BS Computer Science | 2012-09 - 2016-06
`;

const JD_FIXTURE = `
Job Title: Senior Backend Engineer
Company: Anthropic
Location: San Francisco, CA

Requirements:
- 5+ years of software engineering experience
- Strong proficiency in Python or Go
- Experience with distributed systems

Technologies: Python, Go, Kubernetes, PostgreSQL
Level: senior
`;

function makeTempFile(content, ext = '.txt') {
    const tmp = path.join(__dirname, `__fixture_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmp, content, 'utf-8');
    return tmp;
}

// ---------------------------------------------------------------------------
// Dynamic imports (after build)
// ---------------------------------------------------------------------------
const { KnowledgeDatabaseManager } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js')).href
);
const orchestratorMod = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js')).href
);
const { KnowledgeOrchestrator } = orchestratorMod;
const { DocType } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/types.js')).href
);

const MOCK_GENERATE_CONTENT = async (contents) => {
    const prompt = contents[0]?.text || '';
    if (prompt.includes('RESUME TEXT') || prompt.includes('resume')) {
        return JSON.stringify({
            identity: {
                name: 'Sarah Chen', email: 'sarah.chen@gmail.com', phone: '',
                location: 'San Francisco, CA', linkedin: '', github: '', website: '', summary: ''
            },
            skills: ['TypeScript', 'React', 'Node.js', 'Python', 'PostgreSQL', 'Redis', 'Kafka', 'AWS'],
            experience: [
                { company: 'Stripe', role: 'Senior Software Engineer', start_date: '2021-03', end_date: null, bullets: ['Led fraud detection pipeline'] },
                { company: 'Notion', role: 'Software Engineer', start_date: '2018-06', end_date: '2021-02', bullets: ['Built commenting system'] },
                { company: 'Cruise Automation', role: 'Software Engineer', start_date: '2016-07', end_date: '2018-05', bullets: ['Telemetry dashboards'] }
            ],
            projects: [{ name: 'PriceX', description: 'Price comparison extension', technologies: ['React', 'Node.js'], url: '' }],
            education: [{ institution: 'Stanford', degree: 'BS', field: 'CS', start_date: '2012-09', end_date: '2016-06', gpa: '' }],
            achievements: [], certifications: [], leadership: []
        });
    } else {
        return JSON.stringify({
            title: 'Senior Backend Engineer', company: 'Anthropic', location: 'San Francisco, CA',
            description_summary: 'Building reliable AI systems.', level: 'senior', employment_type: 'full_time',
            min_years_experience: 5, compensation_hint: '', requirements: ['5+ years', 'distributed systems'],
            nice_to_haves: [], responsibilities: [], technologies: ['Python', 'Go'], keywords: ['AI']
        });
    }
};

const MOCK_EMBED_FN = async () => Array(128).fill(0).map((_, i) => (i % 7) * 0.01);

describe('FINDING-004: KnowledgeOrchestrator ingest pipeline', () => {
    let db;
    let orchestrator;
    let tmpResumeFile;
    let tmpJdFile;

    beforeEach(() => {
        db = new KnowledgeDatabaseManager(new Database(':memory:'));
        db.initializeSchema();
        orchestrator = new KnowledgeOrchestrator(db);
        orchestrator.setGenerateContentFn(MOCK_GENERATE_CONTENT);
        orchestrator.setEmbedFn(MOCK_EMBED_FN);
        tmpResumeFile = makeTempFile(RESUME_FIXTURE, '.txt');
        tmpJdFile = makeTempFile(JD_FIXTURE, '.txt');
    });

    afterEach(() => {
        try { fs.unlinkSync(tmpResumeFile); } catch {}
        try { fs.unlinkSync(tmpJdFile); } catch {}
        try { db.close?.(); } catch {}
    });

    test('resume ingest produces correct identity, experience, and skill blocks via getProfileData()', async () => {
        const result = await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        assert.equal(result.success, true, `Ingest failed: ${result.error}`);

        const profile = orchestrator.getProfileData();
        assert.ok(profile, 'getProfileData() must return a profile object');
        assert.equal(profile.identity.name, 'Sarah Chen');
        assert.ok(profile.experience.length >= 3);
        const companies = profile.experience.map(e => e.company);
        assert.ok(companies.includes('Stripe'));
        assert.ok(companies.includes('Notion'));
        assert.ok(companies.includes('Cruise Automation'));
        // skills is now a categorized object {languages,frameworks,cloud,...};
        // the derived flat list is exposed as skillsFlat.
        assert.ok(profile.skills && typeof profile.skills === 'object');
        assert.ok(Array.isArray(profile.skillsFlat) && profile.skillsFlat.length > 0);
        assert.ok(profile.nodeCount > 0);
    });

    test('JD ingest produces context nodes distinct from resume nodes', async () => {
        await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        const jdResult = await orchestrator.ingestDocument(tmpJdFile, DocType.JD);
        assert.equal(jdResult.success, true, `JD ingest failed: ${jdResult.error}`);

        const resumeNodes = db.getAllNodes().filter(n => n.source_type === DocType.RESUME);
        const jdNodes = db.getAllNodes().filter(n => n.source_type === DocType.JD);
        assert.ok(resumeNodes.length > 0);
        assert.ok(jdNodes.length > 0);

        const resumeCategories = [...new Set(resumeNodes.map(n => n.category))];
        const jdCategories = [...new Set(jdNodes.map(n => n.category))];
        assert.ok(resumeCategories.join(';') !== jdCategories.join(';'));
    });

    test('sparse-but-valid LLM resume entries retain persistence and atomic nodes', async () => {
        orchestrator.setGenerateContentFn(async () => JSON.stringify({
            identity: { name: 'Sparse Candidate', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' },
            skills: { languages: ['TypeScript'], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [] },
            experience: [{ company: 'Acme', role: 'Engineer', start_date: '2024-01', end_date: null }],
            projects: [{ name: 'Metrics App', description: 'Shows product metrics', highlights: ['Improved activation by 42%.'] }],
            education: [], achievements: [], certifications: [], leadership: [],
        }));

        const result = await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        assert.equal(result.success, true, `Sparse resume ingest failed: ${result.error}`);

        const profile = orchestrator.getProfileData();
        assert.deepEqual(profile.experience[0].bullets, []);
        assert.deepEqual(profile.projects[0].technologies, []);
        assert.ok(profile.projects[0].highlights.includes('Improved activation by 42%.'));
        assert.ok(db.getAllNodes().some(n => n.category === 'skills_languages'));
    });

    test('deleteDocumentsByType removes resume and resets knowledge mode', async () => {
        await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        orchestrator.setKnowledgeMode(true);
        assert.equal(orchestrator.isKnowledgeMode(), true);

        orchestrator.deleteDocumentsByType(DocType.RESUME);
        assert.equal(orchestrator.isKnowledgeMode(), false);

        const profile = orchestrator.getProfileData();
        assert.equal(profile, null, 'Profile must be null after resume deletion');
    });

    test('profile shape has all fields the IPC renderer expects', async () => {
        await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        const profile = orchestrator.getProfileData();

        for (const field of ['identity', 'skills', 'experienceCount', 'projectCount', 'educationCount', 'nodeCount', 'experience', 'projects', 'activeJD', 'hasActiveJD']) {
            assert.ok(field in profile, `profile must have "${field}" field`);
        }
    });

    test('ingest without LLM configured returns a clear error', async () => {
        const unconfigured = new KnowledgeOrchestrator(db);
        const result = await unconfigured.ingestDocument(tmpResumeFile, DocType.RESUME);
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('not configured'));
    });

    test('re-ingest does not multiply nodes unboundedly', async () => {
        await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        const nodeCount1 = db.getAllNodes().length;

        await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        const nodeCount2 = db.getAllNodes().length;

        assert.ok(nodeCount2 <= nodeCount1 * 2, 'Re-ingest must replace not multiply');
    });
});

// ---------------------------------------------------------------------------
// Code-review finding: the degenerate-extraction quality gate was only wired
// for DocType.RESUME. An LLM that returns VALID JSON with title stuck at the
// "Unknown Role" fallback and empty requirements/responsibilities (the JD
// equivalent of "Unknown Candidate" + empty body) parses without throwing, so
// the catch-based heuristic fallback never fires. This asserts the JD side now
// gets the same treatment: the orchestrator must detect the degenerate JD and
// switch to the deterministic heuristic, which can recover real data from the
// same raw JD text.
// ---------------------------------------------------------------------------
describe('KnowledgeOrchestrator — degenerate JD extraction quality gate', () => {
    let db, orchestrator, tmpJdFile;

    const DEGENERATE_JD_GENERATE_CONTENT = async () => JSON.stringify({
        title: 'Unknown Role', company: '', location: '',
        description_summary: '', level: 'mid', employment_type: 'full_time',
        min_years_experience: 0, compensation_hint: '',
        requirements: [], nice_to_haves: [], responsibilities: [],
        technologies: [], keywords: [],
    });

    beforeEach(() => {
        db = new KnowledgeDatabaseManager(new Database(':memory:'));
        db.initializeSchema();
        orchestrator = new KnowledgeOrchestrator(db);
        orchestrator.setGenerateContentFn(DEGENERATE_JD_GENERATE_CONTENT);
        orchestrator.setEmbedFn(MOCK_EMBED_FN);
        tmpJdFile = makeTempFile(JD_FIXTURE, '.txt');
    });

    afterEach(() => {
        try { fs.unlinkSync(tmpJdFile); } catch {}
        try { db.close?.(); } catch {}
    });

    test('a degenerate-but-valid LLM JD response is replaced by the deterministic heuristic', async () => {
        const result = await orchestrator.ingestDocument(tmpJdFile, DocType.JD);
        assert.equal(result.success, true, `Ingest failed: ${result.error}`);

        const jd = orchestrator.activeJD?.structured_data;
        assert.ok(jd, 'activeJD must be populated');
        assert.notEqual(jd.title, 'Unknown Role', 'the degenerate LLM title must have been replaced by the heuristic');
        assert.match(jd.title, /Senior Backend Engineer/i, 'heuristic recovers the real title from JD_FIXTURE');
        assert.equal(jd._extraction_mode, 'heuristic', 'extraction_mode must record the fallback occurred');
    });
});

// ---------------------------------------------------------------------------
// Degenerate extraction → deterministic heuristic fallback.
//
// Reproduces the real user log: the extraction model returned VALID JSON with a
// name but an EMPTY body, which parsed fine, so `Created 0 atomic nodes` and the
// profile was effectively empty. Under the flash-lite→3.5-flash extraction
// pattern there is NO stronger model to escalate to (Pro/MiniMax are excluded by
// design), so on a degenerate-but-valid result the orchestrator falls to the
// deterministic heuristic, which recovers name/experience/education from the raw
// text. These tests pin that behavior (and that a GOOD parse is left untouched).
// ---------------------------------------------------------------------------
describe('KnowledgeOrchestrator — degenerate resume → heuristic fallback', () => {
    let db, orchestrator, tmpResumeFile;

    // Degenerate: a NAME but an empty body — the exact "0 nodes" bug.
    const DEGENERATE_RESUME = () => JSON.stringify({
        identity: { name: 'Sarah Chen', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' },
        skills: [], experience: [], projects: [], education: [],
        achievements: [], certifications: [], leadership: [],
    });

    // A FULL, non-degenerate parse — what the model returns on a good run.
    const GOOD_RESUME = () => JSON.stringify({
        identity: { name: 'Sarah Chen', email: 'sarah.chen@gmail.com', phone: '', location: 'San Francisco, CA', linkedin: '', github: '', website: '', summary: '' },
        skills: ['TypeScript', 'React', 'PostgreSQL'],
        experience: [
            { company: 'Stripe', role: 'Senior Software Engineer', start_date: '2021-03', end_date: null, bullets: ['Led fraud detection pipeline'] },
            { company: 'Notion', role: 'Software Engineer', start_date: '2018-06', end_date: '2021-02', bullets: ['Built commenting system'] },
        ],
        projects: [{ name: 'PriceX', description: 'Price comparison extension', technologies: ['React'], url: '' }],
        education: [{ institution: 'Stanford', degree: 'BS', field: 'CS', start_date: '2012-09', end_date: '2016-06', gpa: '' }],
        achievements: [], certifications: [], leadership: [],
    });

    beforeEach(() => {
        db = new KnowledgeDatabaseManager(new Database(':memory:'));
        db.initializeSchema();
        orchestrator = new KnowledgeOrchestrator(db);
        orchestrator.setEmbedFn(MOCK_EMBED_FN);
        tmpResumeFile = makeTempFile(RESUME_FIXTURE, '.txt');
    });

    afterEach(() => {
        try { fs.unlinkSync(tmpResumeFile); } catch {}
        try { db.close?.(); } catch {}
    });

    test('degenerate LLM result → deterministic heuristic recovers a body', async () => {
        orchestrator.setGenerateContentFn(DEGENERATE_RESUME);

        const result = await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        assert.equal(result.success, true, `Ingest failed: ${result.error}`);

        // The RESUME_FIXTURE has clean section headers, so the heuristic recovers a body.
        const profile = orchestrator.getProfileData();
        assert.ok(profile.experience.length > 0, 'heuristic must recover experience from the raw text');
        assert.ok(profile.nodeCount > 0, 'atomic nodes must be created from the recovered body');
        assert.equal(orchestrator.activeResume?.structured_data?._extraction_mode, 'heuristic');
    });

    test('there is no strong-model escalation hook (extraction is flash-lite→3.5-flash only)', () => {
        // The stronger-model escalation was removed — extraction never escalates to
        // Pro/MiniMax. This guards against re-introducing a strong-fn setter.
        assert.equal(typeof orchestrator.setStrongGenerateContentFn, 'undefined');
    });

    test('GOOD (non-degenerate) primary parse is kept as an LLM result (no heuristic swap)', async () => {
        orchestrator.setGenerateContentFn(GOOD_RESUME);

        const result = await orchestrator.ingestDocument(tmpResumeFile, DocType.RESUME);
        assert.equal(result.success, true, `Ingest failed: ${result.error}`);

        const profile = orchestrator.getProfileData();
        assert.equal(profile.identity.name, 'Sarah Chen');
        assert.ok(profile.experience.length >= 2);
        assert.ok(profile.nodeCount > 0);
        assert.notEqual(orchestrator.activeResume?.structured_data?._extraction_mode, 'heuristic');
    });
});