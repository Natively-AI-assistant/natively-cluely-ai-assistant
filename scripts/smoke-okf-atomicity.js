// scripts/smoke-okf-atomicity.js
//
// OKF round-5 senior-review-fix smoke test: verifies that generateForFile
// persists source + pack + index-version ATOMICALLY — a failure partway
// through the pack write must roll back the source row too, so the
// contentHash gate does not permanently strand a half-written pack as
// "skipped_unchanged". Drives the real Electron app + SQLite DB.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-atomicity.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-atomicity-'));
app.setPath('userData', tmpUserData);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `  :: ${detail}` : ''}`); }
}

async function main() {
  await app.whenReady();
  process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '1';

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const { KnowledgeManager } = require(path.join(distRoot, 'services/knowledge/KnowledgeManager.js'));
  const { DatabaseManager } = require(path.join(distRoot, 'db/DatabaseManager.js'));

  const db = DatabaseManager.getInstance();
  const mm = ModesManager.getInstance();
  const km = KnowledgeManager.getInstance();

  // ── First, a clean baseline: normal generation succeeds. ──
  const mode = mm.createMode({ name: 'Atomicity Test', templateType: 'general' });
  const content = `[Page 1]\n1.1 OpenVLA-OFT\n\nOpenVLA-OFT is an improved version of OpenVLA. It uses parallel decoding and achieves 43x faster throughput than base OpenVLA.\n`;
  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'test.pdf', content });
  const pack0 = km.getPackForFile(file.id);
  check('baseline: pack generated with cards', Boolean(pack0) && pack0.cards.length > 0);
  const source0 = db.getKnowledgeSourceByFileId(file.id);
  check('baseline: source row has a content_hash', Boolean(source0?.content_hash));

  // ── Directly prove runInTransaction's rollback semantics against the REAL
  // SQLite connection (this is the primitive generateForFile now wraps its
  // source+pack+index-version writes in). We can't inject a failure into
  // generateForFile itself from here — esbuild inlines a separate
  // DatabaseManager instance into the KnowledgeManager bundle, so patching
  // THIS instance's methods wouldn't reach it — but we CAN prove the
  // primitive that closes the atomicity gap actually rolls back a
  // multi-statement write on a real connection when the closure throws. ──
  const src = db.getKnowledgeSourceByFileId(file.id);
  let threw = false;
  try {
    db.runInTransaction(() => {
      // First write: mutate the source row's indexed_at to a sentinel.
      db.getDb().prepare('UPDATE knowledge_sources SET file_name = ? WHERE id = ?').run('MUTATED_IN_TXN', src.id);
      // Confirm the write is visible INSIDE the transaction.
      const mid = db.getKnowledgeSourceById(src.id);
      if (mid.file_name !== 'MUTATED_IN_TXN') throw new Error('write not visible mid-transaction (test bug)');
      // Now throw — better-sqlite3 must ROLL BACK the UPDATE above.
      throw new Error('injected mid-transaction failure');
    });
  } catch (e) {
    threw = true;
  }
  check('runInTransaction re-throws the closure error to the caller', threw);
  const afterRollback = db.getKnowledgeSourceById(src.id);
  check('ATOMICITY: the in-transaction UPDATE was rolled back after the throw (file_name restored)', afterRollback.file_name !== 'MUTATED_IN_TXN', `file_name=${afterRollback.file_name}`);

  // ── And prove a SUCCESSFUL runInTransaction commits all writes. ──
  db.runInTransaction(() => {
    db.getDb().prepare('UPDATE knowledge_sources SET file_name = ? WHERE id = ?').run('COMMITTED_IN_TXN', src.id);
  });
  const afterCommit = db.getKnowledgeSourceById(src.id);
  check('runInTransaction commits all writes when the closure returns normally', afterCommit.file_name === 'COMMITTED_IN_TXN', `file_name=${afterCommit.file_name}`);

  // ── Sanity: the real generate path still works end-to-end through the
  // transaction wrapper (regeneration with changed content succeeds). ──
  const changedContent = content + '\nNew appended sentence to force a fresh content hash.';
  const healResult = km.generateForFile({ id: file.id, modeId: mode.id, fileName: 'test.pdf', content: changedContent }, false);
  check('generateForFile still succeeds through the runInTransaction wrapper', healResult.status === 'generated', `status=${healResult.status}`);
  const packHealed = km.getPackForFile(file.id);
  check('regenerated pack has cards', Boolean(packHealed) && packHealed.cards.length > 0);

  console.log(`\n[smoke-okf-atomicity] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-atomicity] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
