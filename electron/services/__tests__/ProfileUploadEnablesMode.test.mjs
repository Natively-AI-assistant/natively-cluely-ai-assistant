// electron/services/__tests__/ProfileUploadEnablesMode.test.mjs
//
// RC-8 regression: uploading a profile must make it immediately usable, and an
// uploaded JD must be visible even before a resume exists.
//
// The live failure: a user uploaded a resume + JD, then every question returned
// "I don't have access to your personal information." Root cause: knowledge mode
// was a SEPARATE manual toggle the upload handlers never flipped, and a JD-only
// session could never enter knowledge mode at all, and getProfileData() returned
// null whenever a resume was absent (hiding an uploaded JD).
//
// This test pins the orchestrator-level contract that the P0 fix relies on:
//   1. After a resume ingest, setKnowledgeMode(true) actually enables mode.
//   2. getProfileData() exposes an uploaded JD even with NO resume (JD-only).
//   3. The IPC upload handlers call setKnowledgeMode(true) on success (source check).
//
// It loads the COMPILED premium class (dist-electron/...) so it doubles as the
// "did the premium edit actually compile and load" check that build:electron's
// skipped typecheck does not provide.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RESUME_FIXTURE = `
Evin John
software engineer
kochi, india | evin@example.com

EXPERIENCE
Software Engineer Intern | Acme | 2024-06 - 2024-09
- Built internal tooling

SKILLS
TypeScript, Python, AWS, PostgreSQL

EDUCATION
CUSAT | B.Tech Computer Science | 2021-09 - 2025-06
`;

const JD_FIXTURE = `
Job Title: Data Analyst
Company: Globex
Location: Remote

Requirements:
- SQL, Python, R
- Data visualization

Technologies: SQL, Python, R, Tableau
Level: mid
`;

function makeTempFile(content, ext = '.txt') {
    const tmp = path.join(__dirname, `__p0fixture_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmp, content, 'utf-8');
    return tmp;
}

const { KnowledgeDatabaseManager } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js')).href
);
const { KnowledgeOrchestrator } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js')).href
);
const { DocType } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/types.js')).href
);

const MOCK_GENERATE_CONTENT = async (contents) => {
    const prompt = contents[0]?.text || '';
    if (/resume|RESUME TEXT/i.test(prompt) && !/job description|JD TEXT/i.test(prompt)) {
        return JSON.stringify({
            identity: { name: 'Evin John', email: 'evin@example.com', phone: '', location: 'Kochi, India', linkedin: '', github: '', website: '', summary: '' },
            skills: ['TypeScript', 'Python', 'AWS', 'PostgreSQL'],
            experience: [{ company: 'Acme', role: 'Software Engineer Intern', start_date: '2024-06', end_date: '2024-09', bullets: ['Built internal tooling'] }],
            projects: [],
            education: [{ institution: 'CUSAT', degree: 'B.Tech', field: 'Computer Science', start_date: '2021-09', end_date: '2025-06', gpa: '' }],
            achievements: [], certifications: [], leadership: []
        });
    }
    return JSON.stringify({
        title: 'Data Analyst', company: 'Globex', location: 'Remote',
        description_summary: 'Analyze data.', level: 'mid', employment_type: 'full_time',
        min_years_experience: 2, compensation_hint: '', requirements: ['SQL, Python, R', 'Data visualization'],
        nice_to_haves: [], responsibilities: [], technologies: ['SQL', 'Python', 'R', 'Tableau'], keywords: ['data']
    });
};

const MOCK_EMBED_FN = async () => Array(128).fill(0).map((_, i) => (i % 7) * 0.01);

describe('RC-8: upload enables mode + JD-only visibility', () => {
    let db;
    let orchestrator;
    let tmpResume;
    let tmpJd;

    beforeEach(() => {
        db = new KnowledgeDatabaseManager(new Database(':memory:'));
        db.initializeSchema();
        orchestrator = new KnowledgeOrchestrator(db);
        orchestrator.setGenerateContentFn(MOCK_GENERATE_CONTENT);
        orchestrator.setEmbedFn(MOCK_EMBED_FN);
        tmpResume = makeTempFile(RESUME_FIXTURE, '.txt');
        tmpJd = makeTempFile(JD_FIXTURE, '.txt');
    });

    afterEach(() => {
        try { fs.unlinkSync(tmpResume); } catch {}
        try { fs.unlinkSync(tmpJd); } catch {}
        try { db.close?.(); } catch {}
    });

    test('knowledge mode is OFF before any upload', () => {
        assert.equal(orchestrator.isKnowledgeMode(), false);
    });

    test('after resume ingest, setKnowledgeMode(true) actually enables mode', async () => {
        const result = await orchestrator.ingestDocument(tmpResume, DocType.RESUME);
        assert.equal(result.success, true, `ingest failed: ${result.error}`);
        orchestrator.setKnowledgeMode(true);
        assert.equal(orchestrator.isKnowledgeMode(), true, 'mode must be ON after resume upload + enable');
    });

    test('JD-only session: getProfileData() surfaces the uploaded JD (was null before fix)', async () => {
        const result = await orchestrator.ingestDocument(tmpJd, DocType.JD);
        assert.equal(result.success, true, `JD ingest failed: ${result.error}`);

        const profile = orchestrator.getProfileData();
        assert.ok(profile, 'getProfileData() must NOT be null when only a JD is uploaded');
        assert.equal(profile.hasActiveJD, true, 'hasActiveJD must be true in a JD-only session');
        assert.ok(profile.activeJD, 'activeJD payload must be present');
        assert.equal(profile.activeJD.title, 'Data Analyst');
        assert.equal(profile.activeJD.company, 'Globex');
        assert.ok(Array.isArray(profile.activeJD.technologies));
        assert.ok(profile.activeJD.technologies.includes('Tableau'));
    });

    test('resume + JD: getProfileData() exposes both', async () => {
        await orchestrator.ingestDocument(tmpResume, DocType.RESUME);
        await orchestrator.ingestDocument(tmpJd, DocType.JD);
        const profile = orchestrator.getProfileData();
        assert.ok(profile);
        assert.equal(profile.identity.name, 'Evin John');
        assert.equal(profile.hasActiveJD, true);
        assert.equal(profile.activeJD.title, 'Data Analyst');
    });
});

// ---------------------------------------------------------------------------
// Source-level: the IPC upload handlers must auto-enable knowledge mode.
// (The handlers require an Electron runtime to execute, so we assert on source
//  the same way ProfileIntelligenceGate.test.mjs does.)
// ---------------------------------------------------------------------------
describe('RC-8: IPC upload handlers auto-enable knowledge mode', () => {
    const SOURCE = path.resolve(__dirname, '../../ipcHandlers.ts');
    const source = fs.readFileSync(SOURCE, 'utf8');

    for (const handler of ['profile:upload-resume', 'profile:upload-jd']) {
        test(`handler "${handler}" calls setKnowledgeMode(true) on success`, () => {
            const start = source.indexOf(`safeHandle('${handler}'`);
            assert.ok(start >= 0, `${handler} not found`);
            // Bound the slice to this handler's body (until the next safeHandle).
            const next = source.indexOf('safeHandle(', start + 10);
            const body = source.slice(start, next > 0 ? next : start + 2500);
            assert.ok(
                body.includes('setKnowledgeMode(true)'),
                `${handler} must call setKnowledgeMode(true) so the upload is immediately usable`
            );
            assert.ok(
                body.includes("set('knowledgeMode', true)"),
                `${handler} must persist knowledgeMode=true so it survives restart`
            );
        });
    }
});
