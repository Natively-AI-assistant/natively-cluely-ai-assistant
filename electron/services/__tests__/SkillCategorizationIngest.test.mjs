// electron/services/__tests__/SkillCategorizationIngest.test.mjs
//
// RC-3 integration: the full ingest path with sub-categorized skills.
//   1. A resume whose extractor returns categorized skills lands in getProfileData
//      with the categorized object + a derived skillsFlat.
//   2. DocumentChunker emits per-category skill nodes (skills_cloud, etc.).
//   3. A legacy v1 profile (flat skills array stored directly in the DB) is
//      migrated to categorized v2 on refresh, deterministically, and persisted.
//
// Loads compiled premium classes (Electron ABI) — run via:
//   ELECTRON_RUN_AS_NODE=1 npx electron --test <thisfile>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RESUME_FIXTURE = `Evin John\nsoftware engineer\nSKILLS\nPython, TypeScript, React, AWS, PostgreSQL, PyTorch, Docker\n`;

function makeTempFile(content, ext = '.txt') {
    const tmp = path.join(__dirname, `__skfix_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmp, content, 'utf-8');
    return tmp;
}

const P = (rel) => pathToFileURL(path.resolve(__dirname, rel)).href;
const { KnowledgeDatabaseManager } = await import(P('../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js'));
const { KnowledgeOrchestrator } = await import(P('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js'));
const { DocType } = await import(P('../../../dist-electron/premium/electron/knowledge/types.js'));
const { createDocumentNodes } = await import(P('../../../dist-electron/premium/electron/knowledge/DocumentChunker.js'));

// Extractor returns the NEW categorized shape (as the upgraded prompt instructs).
const MOCK_GENERATE_CONTENT = async () => JSON.stringify({
    identity: { name: 'Evin John', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' },
    skills: {
        languages: ['Python', 'TypeScript'],
        frameworks: ['React'],
        cloud: ['AWS'],
        databases: ['PostgreSQL'],
        ml: ['PyTorch'],
        devops: ['Docker'],
        tools: [],
    },
    experience: [], projects: [], education: [], achievements: [], certifications: [], leadership: []
});
const MOCK_EMBED_FN = async () => Array(128).fill(0).map((_, i) => (i % 7) * 0.01);

describe('RC-3 integration: categorized skills end-to-end', () => {
    let db, orchestrator, tmpResume;

    beforeEach(() => {
        db = new KnowledgeDatabaseManager(new Database(':memory:'));
        db.initializeSchema();
        orchestrator = new KnowledgeOrchestrator(db);
        orchestrator.setGenerateContentFn(MOCK_GENERATE_CONTENT);
        orchestrator.setEmbedFn(MOCK_EMBED_FN);
        tmpResume = makeTempFile(RESUME_FIXTURE);
    });
    afterEach(() => {
        try { fs.unlinkSync(tmpResume); } catch {}
        try { db.close?.(); } catch {}
    });

    test('getProfileData exposes categorized skills + a derived flat list', async () => {
        const r = await orchestrator.ingestDocument(tmpResume, DocType.RESUME);
        assert.equal(r.success, true, `ingest failed: ${r.error}`);
        const profile = orchestrator.getProfileData();
        assert.ok(profile.skills && typeof profile.skills === 'object' && !Array.isArray(profile.skills));
        assert.deepEqual(profile.skills.cloud, ['AWS']);
        assert.deepEqual(profile.skills.languages, ['Python', 'TypeScript']);
        assert.ok(Array.isArray(profile.skillsFlat));
        assert.ok(profile.skillsFlat.includes('AWS'));
        assert.ok(profile.skillsFlat.includes('Python'));
    });

    test('DocumentChunker emits per-category skill nodes', () => {
        const structured = {
            identity: { name: 'X' },
            skills: { languages: ['Python'], cloud: ['AWS', 'GCP'], frameworks: [], databases: [], ml: [], devops: [], tools: [] },
            experience: [], projects: [], education: [], achievements: [], certifications: [], leadership: []
        };
        const nodes = createDocumentNodes(structured, DocType.RESUME);
        const cats = nodes.map(n => n.category);
        assert.ok(cats.includes('skills_languages'), 'must emit a skills_languages node');
        assert.ok(cats.includes('skills_cloud'), 'must emit a skills_cloud node');
        // empty categories produce no node
        assert.ok(!cats.includes('skills_frameworks'));
        const cloudNode = nodes.find(n => n.category === 'skills_cloud');
        assert.ok(cloudNode.text_content.includes('AWS') && cloudNode.text_content.includes('GCP'));
        // cloud node must NOT contain a language
        assert.ok(!cloudNode.text_content.includes('Python'));
    });
});

describe('RC-3 integration: v1→v2 backfill of legacy flat-skills profile', () => {
    let db, orchestrator;

    beforeEach(() => {
        db = new KnowledgeDatabaseManager(new Database(':memory:'));
        db.initializeSchema();
        orchestrator = new KnowledgeOrchestrator(db);
        orchestrator.setGenerateContentFn(MOCK_GENERATE_CONTENT);
        orchestrator.setEmbedFn(MOCK_EMBED_FN);
    });
    afterEach(() => { try { db.close?.(); } catch {} });

    test('a stored flat-skills (v1) resume is categorized + persisted on refresh', async () => {
        // Insert a legacy profile directly: skills is a flat array, no _schema_version.
        const legacy = {
            identity: { name: 'Legacy User', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' },
            skills: ['Python', 'AWS', 'React', 'PostgreSQL'],
            experience: [], projects: [], education: [], achievements: [], certifications: [], leadership: []
        };
        const id = db.saveDocument({ type: DocType.RESUME, source_uri: 'legacy.pdf', structured_data: legacy });

        // A fresh orchestrator over the same DB triggers refreshCache → migration.
        const orch2 = new KnowledgeOrchestrator(db);
        const profile = orch2.getProfileData();
        assert.ok(profile, 'profile must load');
        assert.ok(profile.skills && !Array.isArray(profile.skills), 'skills must be categorized after migration');
        assert.ok(profile.skills.languages.includes('Python'));
        assert.ok(profile.skills.cloud.includes('AWS'));
        assert.ok(profile.skills.frameworks.includes('React'));
        assert.ok(profile.skills.databases.includes('PostgreSQL'));

        // Persisted back: re-read raw from DB shows categorized + version stamp.
        const reread = db.getDocumentByType(DocType.RESUME);
        assert.ok(!Array.isArray(reread.structured_data.skills), 'DB must now hold categorized skills');
        assert.equal(reread.structured_data._schema_version, 2);
    });

    test('migration is idempotent — a second load does not corrupt categorized skills', async () => {
        const legacy = {
            identity: { name: 'U', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' },
            skills: ['Go', 'Kubernetes'],
            experience: [], projects: [], education: [], achievements: [], certifications: [], leadership: []
        };
        db.saveDocument({ type: DocType.RESUME, source_uri: 'l.pdf', structured_data: legacy });
        new KnowledgeOrchestrator(db).getProfileData();           // first migration
        const profile = new KnowledgeOrchestrator(db).getProfileData(); // second load
        assert.ok(profile.skills.languages.includes('Go'));
        assert.ok(profile.skills.devops.includes('Kubernetes'));
    });
});
