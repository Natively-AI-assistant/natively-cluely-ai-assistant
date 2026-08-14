// electron/services/__tests__/IngestResilience.test.mjs
//
// D2 regression (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R2/R2b): the
// live real-UI failure was `resumeLoaded=false` for 169s because structured
// extraction is LLM-only — when the extraction LLM is down/billing-blocked it
// throws, ingestDocument returns {success:false}, activeResume is never saved,
// and the profile is NEVER ready (identity/projects fall back to "I am Natively").
//
// These tests prove the orchestrator now degrades gracefully:
//   1. extraction-LLM failure → heuristic fallback → ingest SUCCEEDS, profile READY
//   2. embed failure → keep the document (facts answerable), don't roll back
//   3. PI_HEURISTIC_EXTRACTION=off restores the original throw/rollback behavior

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/' + rel)).href);

const { KnowledgeDatabaseManager } = await load('KnowledgeDatabaseManager.js');
const { KnowledgeOrchestrator } = await load('KnowledgeOrchestrator.js');
const { DocType } = await load('types.js');

const RESUME = `Evin John
Founder & Full-Stack Engineer
evin.john@example.com

SKILLS
Languages: TypeScript, Python, Go
Frameworks: React, FastAPI
Cloud: AWS, GCP

EXPERIENCE
Founder at Natively (2024-01 - Present)
- Built a real-time meeting copilot.

PROJECTS
ABTest-Framework: A/B testing library. React, Node.js

EDUCATION
B.Tech in Computer Science, Cochin University (2021-08 - 2025-05)
`;

const makeTemp = (content) => {
  const p = path.join(os.tmpdir(), `pi-ingest-${Math.abs(hashStr(content))}.txt`);
  fs.writeFileSync(p, content);
  return p;
};
// Math.random is unavailable in some harnesses; derive a stable name from content.
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

const LLM_DOWN = async () => { throw new Error('429 billing decision: account suspended'); };
const EMBED_OK = async () => Array(128).fill(0).map((_, i) => (i % 7) * 0.01);
const EMBED_DOWN = async () => { throw new Error('embedding endpoint 403'); };

describe('D2: ingest resilience when the extraction LLM is down', () => {
  let db, orchestrator, resumeFile;

  beforeEach(() => {
    delete process.env.PI_HEURISTIC_EXTRACTION;
    db = new KnowledgeDatabaseManager(new Database(':memory:'));
    db.initializeSchema();
    orchestrator = new KnowledgeOrchestrator(db);
    resumeFile = makeTemp(RESUME);
  });
  afterEach(() => {
    try { fs.unlinkSync(resumeFile); } catch {}
    try { db.close?.(); } catch {}
    delete process.env.PI_HEURISTIC_EXTRACTION;
  });

  test('extraction-LLM failure falls back to heuristic; ingest SUCCEEDS and profile is READY', async () => {
    orchestrator.setGenerateContentFn(LLM_DOWN);
    orchestrator.setEmbedFn(EMBED_OK);

    const result = await orchestrator.ingestDocument(resumeFile, DocType.RESUME);
    assert.equal(result.success, true, `ingest should succeed via heuristic fallback, got: ${result.error}`);

    const profile = orchestrator.getProfileData();
    assert.ok(profile, 'profile must exist after heuristic ingest');
    assert.equal(profile.identity.name, 'Evin John');
    assert.ok(profile.experience.some((e) => /natively/i.test(e.company) || /founder/i.test(e.role)));
    assert.ok((profile.skillsFlat || []).length > 0, 'skills should be populated heuristically');
    assert.equal(profile.structured_data?._extraction_mode ?? profile._extraction_mode ?? 'heuristic', 'heuristic');
  });

  test('embedding-endpoint failure does NOT break the answerable profile', async () => {
    // chunkAndEmbedDocument degrades gracefully (Promise.allSettled + retry,
    // stores nodes without embeddings) so a dead embedder never throws — the
    // structured profile is saved and identity/skills stay answerable. This is
    // the end-to-end guarantee we must never regress (RAG quality degrades, the
    // PROFILE does not disappear).
    orchestrator.setGenerateContentFn(async () => JSON.stringify({
      identity: { name: 'Evin John', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' },
      skills: { languages: ['TypeScript'], frameworks: ['React'], cloud: [], databases: [], ml: [], devops: [], tools: [] },
      experience: [{ company: 'Natively', role: 'Founder', start_date: '2024-01', end_date: null, bullets: ['Built copilot'] }],
      projects: [], education: [], achievements: [], certifications: [], leadership: [],
    }));
    orchestrator.setEmbedFn(EMBED_DOWN);

    const result = await orchestrator.ingestDocument(resumeFile, DocType.RESUME);
    assert.equal(result.success, true, `embed failure should still succeed (degraded), got: ${result.error}`);
    const profile = orchestrator.getProfileData();
    assert.ok(profile, 'profile must be kept despite embed failure');
    assert.equal(profile.identity.name, 'Evin John');
  });

  test('PI_HEURISTIC_EXTRACTION=off restores throw behavior (extraction)', async () => {
    process.env.PI_HEURISTIC_EXTRACTION = 'off';
    orchestrator.setGenerateContentFn(LLM_DOWN);
    orchestrator.setEmbedFn(EMBED_OK);

    const result = await orchestrator.ingestDocument(resumeFile, DocType.RESUME);
    assert.equal(result.success, false, 'with kill-switch off, extraction failure must fail the ingest');
    const profile = orchestrator.getProfileData();
    assert.ok(!profile || !profile.identity?.name, 'no profile should be saved when disabled');
  });
});
