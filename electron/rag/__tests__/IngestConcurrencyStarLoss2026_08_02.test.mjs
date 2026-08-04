// electron/rag/__tests__/IngestConcurrencyStarLoss2026_08_02.test.mjs
//
// Regression: re-uploading a résumé while the previous ingest was still
// generating STAR stories SILENTLY DESTROYED the first ingest's stories.
//
// Straight off a production log (2026-08-02, packaged 2.8.5):
//   03:46:41  upload A saves doc 61, starts STAR generation (~35s of LLM calls)
//   03:47:03  upload B runs deleteDocumentsByType(RESUME) -> doc 61 deleted,
//             saves doc 62
//   03:47:18  upload A's STAR nodes finally land -> saveNodes(..., docId=61)
//             -> [KnowledgeOrchestrator] Failed to generate STAR stories:
//                FOREIGN KEY constraint failed
//
// ingestDocument's step 4 deletes every document of the type before saving the
// new one, while step 8 awaits multi-second LLM calls AFTER its document row
// exists — so two same-type ingests interleave destructively. The STAR catch
// treats the failure as "optional enrichment", which is right for a flaky LLM
// and wrong for "our parent row was deleted underneath us": six generated
// stories were thrown away and nothing surfaced to the user.
//
// Fixed by serializing ingests per DocType (_ingestChainByType). This test
// drives the REAL orchestrator against an in-memory DB and reproduces the
// interleaving deterministically with a gate, rather than pinning source text.
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

function resumeFile(tag) {
  const file = path.join(os.tmpdir(), `ingest-race-${process.pid}-${tag}-${Date.now()}.txt`);
  fs.writeFileSync(file, 'Rohan Varma\nSoftware Engineering Intern at AetherGrid\nShipped a streaming pipeline.', 'utf8');
  tmpFiles.push(file);
  return file;
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

const STAR_JSON = JSON.stringify([{
  index: 1, situation: 'A latency-sensitive pipeline.', task: 'Cut end-to-end latency.',
  action: 'Rewrote the transport and batched writes.', result: 'Sub-80ms interaction latency.',
  full_narrative: 'I owned a streaming pipeline that needed to feel instant, so I rewrote the transport and batched the writes, landing sub-80ms interaction latency.',
}]);

const isStarPrompt = (parts) => {
  const text = Array.isArray(parts) ? parts.map((p) => p?.text ?? '').join(' ') : String(parts ?? '');
  return /STAR \(Situation, Task, Action, Result\)/.test(text);
};

/**
 * KnowledgeDatabaseManager that RECORDS the write ops ingestDocument performs.
 *
 * The distinguishing signal is ordering, not row counts: both before and after
 * the fix exactly one résumé survives with one STAR node (the loser's rows are
 * CASCADE-deleted either way). What separates them is whether one ingest's
 * writes interleave with another's delete — verified pre-fix as
 *   delete, saveNodes(doc 1), delete, saveNodes(doc 2), saveNodes(doc 2),
 *   "Failed to generate STAR stories: FOREIGN KEY constraint failed"
 * i.e. doc 1's STAR write arrived after doc 1 had been deleted.
 */
function recordingDb(db, ops) {
  const kdb = new KnowledgeDatabaseManager(db);
  const wrap = (name, describe) => {
    const orig = kdb[name].bind(kdb);
    kdb[name] = (...args) => {
      // Record the ATTEMPT, including one that throws. The failing write IS the
      // defect — recording only successes hid it completely: an earlier version
      // of this helper pushed after `orig(...)` returned, so the FOREIGN KEY
      // throw skipped the push and the invariant below saw a clean sequence.
      try {
        const out = orig(...args);
        ops.push({ ...describe(args, out), ok: true });
        return out;
      } catch (err) {
        ops.push({ ...describe(args, undefined), ok: false, error: String(err?.message ?? err) });
        throw err;
      }
    };
  };
  wrap('deleteDocumentsByType', (args) => ({ op: 'delete', type: args[0] }));
  wrap('saveDocument', (args, id) => ({ op: 'saveDocument', docId: id }));
  wrap('saveNodes', (args) => ({ op: 'saveNodes', docId: args[1], count: (args[0] ?? []).length }));
  return kdb;
}

/**
 * Orchestrator wired to an in-memory DB. Only the FIRST STAR call is gated —
 * gating every call made both ingests park on one promise and resume in order,
 * which never reproduced the interleaving (an earlier version of this test
 * passed against the UNFIXED code; that is the vacuity this shape avoids).
 */
function makeOrchestrator(db, gate, ops) {
  const orch = new KnowledgeOrchestrator(recordingDb(db, ops));
  let starCalls = 0;
  orch.setGenerateContentFn(async (parts) => {
    if (isStarPrompt(parts)) {
      starCalls += 1;
      if (starCalls === 1) { gate.markReached(); await gate.promise; }
      return STAR_JSON;
    }
    return RESUME_JSON;
  });
  orch.setEmbedFn(async () => new Array(384).fill(0.01));
  return { orch, starCount: () => starCalls };
}

function makeGate() {
  let release;
  const promise = new Promise((r) => { release = r; });
  let reached;
  const reachedPromise = new Promise((r) => { reached = r; });
  return { promise, release: () => release(), reached: reachedPromise, markReached: () => reached() };
}

/** Every saveNodes must target a document that had not already been deleted. */
function firstWriteAfterDelete(ops) {
  const live = new Set();
  for (const e of ops) {
    if (e.op === 'delete') live.clear();
    else if (e.op === 'saveDocument') live.add(e.docId);
    else if (e.op === 'saveNodes' && !live.has(e.docId)) return e;
  }
  return null;
}

describe('concurrent same-type ingests must not destroy each other (2026-08-02)', () => {
  test('a re-upload during STAR generation does not orphan the first ingest\'s nodes', async () => {
    const db = new Database(':memory:');
    try {
      const gate = makeGate();
      const ops = [];
      const { orch, starCount } = makeOrchestrator(db, gate, ops);

      const first = orch.ingestDocument(resumeFile('a'), DocType.RESUME);
      await gate.reached;                        // A is now parked inside STAR generation

      // B arrives mid-flight. Before the fix its step-4 delete removed A's
      // document row while A was still awaiting the LLM.
      const second = orch.ingestDocument(resumeFile('b'), DocType.RESUME);
      // Real time, not one tick: B must get an actual chance to run
      // delete -> saveDocument -> saveNodes while A is parked. Releasing
      // immediately is what made the earlier version of this test vacuous.
      await new Promise((r) => setTimeout(r, 400));
      gate.release();

      const [ra, rb] = await Promise.all([first, second]);
      assert.equal(ra.success, true, `first ingest must succeed: ${ra.error ?? ''}`);
      assert.equal(rb.success, true, `second ingest must succeed: ${rb.error ?? ''}`);
      assert.equal(starCount(), 2, 'each ingest generates its own STAR stories');

      // THE invariant. Pre-fix this finds saveNodes(docId=1) after doc 1's
      // delete — the FOREIGN KEY error and the six discarded STAR stories.
      const violation = firstWriteAfterDelete(ops);
      assert.equal(violation, null,
        `an ingest wrote nodes to a document another ingest had already deleted: ${JSON.stringify(violation)} — ops=${JSON.stringify(ops)}`);

      // And directly: no write may fail. The orchestrator swallows a STAR
      // failure as "optional enrichment", so `success:true` above is NOT
      // evidence the stories survived — this is what makes the loss silent.
      const failed = ops.filter((e) => e.ok === false);
      assert.deepEqual(failed, [],
        `a database write failed during concurrent ingest (production logged "FOREIGN KEY constraint failed" here): ${JSON.stringify(failed)}`);

      // And the shape holds end-to-end: one live résumé, with its STAR story.
      const docs = db.prepare("select id from knowledge_documents where type = 'resume'").all();
      assert.equal(docs.length, 1, 'one active résumé is the documented invariant');
      const starNodes = db.prepare(
        "select count(*) c from context_nodes where document_id = ? and category = 'star_story'").get(docs[0].id);
      assert.ok(starNodes.c > 0, 'the active résumé must keep its STAR stories');
      const orphans = db.prepare(
        'select count(*) c from context_nodes n left join knowledge_documents d on d.id = n.document_id where d.id is null').get();
      assert.equal(orphans.c, 0, 'no node may outlive its document');
    } finally {
      db.close();
    }
  });

  test('a résumé and a JD still ingest concurrently — only same-type writers queue', async () => {
    const db = new Database(':memory:');
    try {
      const gate = makeGate();
      const { orch } = makeOrchestrator(db, gate, []);
      // Nothing gates the JD path (no STAR stories), so it must complete even
      // while the résumé is parked — serialization is per type, not global.
      const resume = orch.ingestDocument(resumeFile('r'), DocType.RESUME);
      const jd = await Promise.race([
        orch.ingestDocument(resumeFile('j'), DocType.JD).then(() => 'jd-done'),
        new Promise((r) => setTimeout(() => r('timeout'), 5000)),
      ]);
      assert.equal(jd, 'jd-done', 'a JD upload must not be blocked behind an in-flight résumé ingest');
      gate.release();
      await resume;
    } finally {
      db.close();
    }
  });
});
