// electron/rag/__tests__/SalaryEstimatePersistence2026_08_02.test.mjs
//
// Regression: the résumé-derived salary estimate lived ONLY in
// SalaryIntelligenceEngine's in-memory cache, computed at ingest. Every app
// relaunch emptied it, so the V3 PROFILE_FACT source (wired 2026-08-02)
// vanished on cold start and "what is my expected salary" regressed to
// DOCUMENT_FACT_NOT_FOUND until the user re-uploaded their résumé.
//
// Fix under test: KnowledgeDB persists the estimate (single row, keyed by the
// engine's résumé-identity derivation) and
// KnowledgeOrchestrator.getResumeSalaryEstimate() falls back to it — but ONLY
// when the key still matches the CURRENT active résumé, so a row from a
// replaced résumé is never served.
//
// A "relaunch" here is a FRESH orchestrator instance over the SAME database —
// exactly what a process restart is from this layer's point of view.
//
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge');
const { KnowledgeOrchestrator } = await import(pathToFileURL(path.join(dist, 'KnowledgeOrchestrator.js')).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(path.join(dist, 'KnowledgeDatabaseManager.js')).href);
const { DocType } = await import(pathToFileURL(path.join(dist, 'types.js')).href);

const tmp = [];
afterEach(() => { for (const f of tmp.splice(0)) { try { fs.rmSync(f, { force: true }); } catch {} } });

const resumeFile = (tag) => {
  const f = path.join(os.tmpdir(), `salary-persist-${process.pid}-${tag}-${Date.now()}.txt`);
  fs.writeFileSync(f, 'Rohan Varma\nSoftware Engineering Intern at AetherGrid\nShipped a streaming pipeline.', 'utf8');
  tmp.push(f);
  return f;
};

const RESUME_JSON = (name = 'Rohan Varma') => JSON.stringify({
  identity: { name },
  skills: { languages: ['TypeScript'], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [] },
  experience: [{ company: 'AetherGrid', role: 'Software Engineering Intern', start_date: '2025-06', end_date: '2025-08',
    bullets: ['Shipped a streaming pipeline with sub-80ms latency.'] }],
  projects: [], education: [], achievements: [], certifications: [], leadership: [],
});

const ESTIMATE_JSON = JSON.stringify({
  role: 'Software Engineering Intern', location: 'Kochi, India', currency: 'INR',
  min: 350000, max: 650000, confidence: 'medium',
  justification_factors: ['0.6 years experience'],
});

const isSalaryPrompt = (parts) => {
  const text = Array.isArray(parts) ? parts.map((p) => p?.text ?? '').join(' ') : String(parts ?? '');
  return /salary|compensation/i.test(text) && !/STAR \(Situation/.test(text);
};

function makeOrchestrator(db, { resumeName = 'Rohan Varma' } = {}) {
  const orch = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
  orch.setGenerateContentFn(async (parts) => {
    if (isSalaryPrompt(parts)) return ESTIMATE_JSON;
    if (/STAR \(Situation/.test(String(Array.isArray(parts) ? parts.map((p) => p?.text ?? '').join(' ') : parts))) {
      return JSON.stringify([{ index: 1, situation: 's', task: 't', action: 'a', result: 'r', full_narrative: 'n'.repeat(60) }]);
    }
    return RESUME_JSON(resumeName);
  });
  orch.setEmbedFn(async () => new Array(384).fill(0.01));
  return orch;
}

/** Poll until the fire-and-forget salary pre-compute has persisted. */
async function waitForPersistedEstimate(db, timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    const row = db.prepare('SELECT cache_key FROM salary_estimates WHERE id = 1').get();
    if (row) return row;
    if (Date.now() - t0 > timeoutMs) throw new Error('salary estimate was never persisted');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('salary estimate survives a relaunch (2026-08-02)', () => {
  test('a fresh orchestrator over the same DB serves the persisted estimate cold', async () => {
    const db = new Database(':memory:');
    try {
      // "First launch": ingest computes + persists.
      const first = makeOrchestrator(db);
      const r = await first.ingestDocument(resumeFile('a'), DocType.RESUME);
      assert.equal(r.success, true, r.error ?? '');
      await waitForPersistedEstimate(db);

      // "Relaunch": fresh instance, empty engine cache, same DB.
      const second = makeOrchestrator(db);
      const est = second.getResumeSalaryEstimate();
      assert.ok(est, 'cold start must serve the persisted estimate — this was null before the fix');
      assert.equal(est.min, 350000);
      assert.equal(est.max, 650000);
      assert.equal(est.currency, 'INR');

      // And it primed the engine cache: a second read needs no DB row.
      db.prepare('DELETE FROM salary_estimates').run();
      assert.ok(second.getResumeSalaryEstimate(), 'the first cold read must prime the in-memory cache');
    } finally {
      db.close();
    }
  });

  test('a persisted estimate for a REPLACED résumé is rejected, not served', async () => {
    const db = new Database(':memory:');
    try {
      const first = makeOrchestrator(db);
      const r = await first.ingestDocument(resumeFile('a'), DocType.RESUME);
      assert.equal(r.success, true, r.error ?? '');
      await waitForPersistedEstimate(db);

      // A different person's résumé replaces the row the estimate was keyed to.
      // Overwrite the ACTIVE document's identity directly — the persisted
      // estimate row still carries Rohan's key and must fail the comparison.
      const doc = db.prepare("SELECT id, structured_data FROM knowledge_documents WHERE type = 'resume'").get();
      const sd = JSON.parse(doc.structured_data);
      sd.identity.name = 'Completely Different Person';
      db.prepare('UPDATE knowledge_documents SET structured_data = ? WHERE id = ?')
        .run(JSON.stringify(sd), doc.id);

      const second = makeOrchestrator(db);
      assert.equal(second.getResumeSalaryEstimate(), null,
        'a stale estimate keyed to a previous résumé must never be served for the current one');
    } finally {
      db.close();
    }
  });

  test('no active résumé ⇒ no estimate, even with a row present (fail closed)', () => {
    const db = new Database(':memory:');
    try {
      // Schema init lives in the orchestrator (production order), so build it
      // first, then plant the orphaned row.
      const orch = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
      new KnowledgeDatabaseManager(db).saveSalaryEstimate('Ghost|Role|Co', JSON.parse(ESTIMATE_JSON));
      assert.equal(orch.getResumeSalaryEstimate(), null,
        'an orphaned estimate row must not resurrect a deleted profile');
    } finally {
      db.close();
    }
  });

  test('a corrupt persisted row degrades to null, never a throw', async () => {
    const db = new Database(':memory:');
    try {
      const first = makeOrchestrator(db);
      await first.ingestDocument(resumeFile('a'), DocType.RESUME);
      await waitForPersistedEstimate(db);
      db.prepare("UPDATE salary_estimates SET estimate_json = 'not json' WHERE id = 1").run();
      const second = makeOrchestrator(db);
      assert.equal(second.getResumeSalaryEstimate(), null);
    } finally {
      db.close();
    }
  });
});
