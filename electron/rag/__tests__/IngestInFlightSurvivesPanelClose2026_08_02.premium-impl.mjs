// electron/rag/__tests__/IngestInFlightSurvivesPanelClose2026_08_02.test.mjs
//
// Regression: closing the Profile Intelligence settings panel while a résumé or
// JD was indexing LOOKED like it abandoned the indexing.
//
// It never did. The panel is a React modal inside the shell renderer
// (App.tsx closeManagerPanel -> setActiveManagerPanel(null)), so closing it
// unmounts a subtree — it does not destroy the window and it does not cancel
// the IPC handler. safeHandle('profile:upload-resume') ignores the event and
// awaits orchestrator.ingestDocument in the MAIN process, which runs to
// completion and then enables knowledge mode.
//
// What actually broke was ownership of the progress state: profileUploading /
// profileUploadStatus were component-local, so a reopen mid-ingest re-rendered
// the EMPTY upload slot. The user reasonably read that as "it ditched the
// indexing" — and could upload the same file again, which before the
// _ingestChainByType fix destroyed the first ingest's STAR nodes
// (see IngestConcurrencyStarLoss2026_08_02).
//
// Fix: main owns the flag. KnowledgeOrchestrator.isIngesting(type) derives from
// the serialization chain, and profile:get-status hands it to the renderer as
// resume_indexing_in_flight / jd_indexing_in_flight so a remounted panel can
// re-adopt the in-flight ingest instead of showing an empty slot.
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

const tmpFiles = [];
afterEach(() => { for (const f of tmpFiles.splice(0)) { try { fs.rmSync(f, { force: true }); } catch {} } });

// extractDocumentText rejects near-empty files ("may be a scanned or corrupt
// document") BEFORE any LLM call, so a too-short fixture never reaches the gate.
function docFile(tag, extra = '') {
  const file = path.join(os.tmpdir(), `ingest-inflight-${process.pid}-${tag}-${Date.now()}.txt`);
  fs.writeFileSync(
    file,
    `Rohan Varma\nSoftware Engineering Intern at AetherGrid\nShipped a streaming pipeline.${extra}`,
    'utf8',
  );
  tmpFiles.push(file);
  return file;
}

/** Fail loudly instead of hanging the suite if the gate is never reached. */
function withTimeout(promise, label, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms).unref?.()),
  ]);
}

const RESUME_JSON = JSON.stringify({
  identity: { name: 'Rohan Varma' },
  skills: { languages: ['TypeScript'], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [] },
  experience: [{
    company: 'AetherGrid', role: 'Software Engineering Intern',
    start_date: '2025-06', end_date: '2025-08',
    bullets: ['Shipped a streaming pipeline with sub-80ms latency.'],
  }],
  projects: [], education: [], achievements: [], certifications: [], leadership: [],
});

function makeGate() {
  let release; const promise = new Promise((r) => { release = r; });
  let reached; const reachedPromise = new Promise((r) => { reached = r; });
  return { promise, release: () => release(), reached: reachedPromise, markReached: () => reached() };
}

/** Orchestrator whose FIRST LLM call parks on `gate`, simulating a slow ingest. */
function makeOrchestrator(db, gate, { failFirst = false } = {}) {
  const orch = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
  let calls = 0;
  orch.setGenerateContentFn(async () => {
    calls += 1;
    if (calls === 1) {
      gate.markReached();
      await gate.promise;
      if (failFirst) throw new Error('extraction exploded');
    }
    return RESUME_JSON;
  });
  orch.setEmbedFn(async () => new Array(384).fill(0.01));
  return orch;
}

describe('in-flight ingest is observable from main (2026-08-02)', () => {
  test('isIngesting(RESUME) is true while indexing and false once it lands', async () => {
    const db = new Database(':memory:');
    try {
      const gate = makeGate();
      const orch = makeOrchestrator(db, gate);

      assert.equal(orch.isIngesting(DocType.RESUME), false, 'idle before any upload');

      const run = orch.ingestDocument(docFile('a'), DocType.RESUME);
      await withTimeout(gate.reached, 'ingest to reach the gate');

      // THE invariant behind the bug report. This is the moment the user closes
      // the panel: the component unmounts, its local uploading state is gone,
      // and main must still be able to answer "yes, this is indexing" so the
      // remounted panel re-adopts it instead of rendering the empty upload slot.
      assert.equal(orch.isIngesting(DocType.RESUME), true, 'must report in-flight while parked mid-ingest');
      assert.equal(orch.isIngesting(DocType.JD), false, 'per-type: a résumé ingest must not mark the JD slot busy');

      gate.release();
      const result = await run;
      assert.equal(result.success, true, `ingest must succeed: ${result.error ?? ''}`);
      assert.equal(orch.isIngesting(DocType.RESUME), false, 'clears once the ingest lands');
    } finally { db.close(); }
  });

  test('stays true across a queued same-type ingest, then clears', async () => {
    const db = new Database(':memory:');
    try {
      const gate = makeGate();
      const orch = makeOrchestrator(db, gate);

      const first = orch.ingestDocument(docFile('a'), DocType.RESUME);
      await withTimeout(gate.reached, 'ingest to reach the gate');
      const second = orch.ingestDocument(docFile('b', ' Also led a migration.'), DocType.RESUME);

      // A queued upload is still "indexing" from the user's point of view — the
      // flag must not drop to false in the window between the two.
      assert.equal(orch.isIngesting(DocType.RESUME), true, 'in-flight while a second ingest is queued behind the first');

      gate.release();
      await Promise.all([first, second]);
      assert.equal(orch.isIngesting(DocType.RESUME), false, 'clears only after the whole chain drains');
    } finally { db.close(); }
  });

  test('clears when the ingest fails, so the panel cannot hang on "processing"', async () => {
    const db = new Database(':memory:');
    try {
      const gate = makeGate();
      const orch = makeOrchestrator(db, gate, { failFirst: true });

      const run = orch.ingestDocument(docFile('a'), DocType.RESUME);
      await withTimeout(gate.reached, 'ingest to reach the gate');
      assert.equal(orch.isIngesting(DocType.RESUME), true);

      gate.release();
      await run; // ingestDocument reports failure as a value, it does not reject
      assert.equal(orch.isIngesting(DocType.RESUME), false, 'a failed ingest must not leave the flag stuck on');
    } finally { db.close(); }
  });

  test('profile:get-status surfaces both flags to the renderer', () => {
    // The orchestrator flag is only useful if the panel can read it back; this
    // pins the wiring the remount path depends on.
    const source = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
    const start = source.indexOf("safeHandle('profile:get-status'");
    assert.ok(start > -1, "profile:get-status handler must exist");
    const next = source.indexOf('safeHandle(', start + 10);
    const body = source.slice(start, next > -1 ? next : undefined);
    assert.match(body, /resume_indexing_in_flight:\s*Boolean\(.*isIngesting/s);
    assert.match(body, /jd_indexing_in_flight:\s*Boolean\(.*isIngesting/s);
  });
});
