// scripts/smoke-okf-cascade-delete.js
//
// OKF hardening regression smoke test (2026-07-01, post-review): verifies
// the explicit cascade-delete fix against a REAL Electron app + SQLite DB.
// This codebase never runs `PRAGMA foreign_keys = ON`, so declared FK
// CASCADE clauses on the knowledge_* tables never fire — before this fix,
// deleting a reference file or a whole Mode would leave knowledge_packs/
// knowledge_cards/knowledge_entities/knowledge_relations rows permanently
// orphaned. Verifies both the single-file delete path
// (ModesManager.deleteReferenceFile) and the whole-mode delete path
// (ModesManager.deleteMode, previously NOT cleaned up at all).
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-cascade-delete.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-cascade-test-'));
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

  const content = `[Page 1]\n1.1 Research Questions\n\nRQ1: test question one.\nRQ2: test question two.\n`;
  const db = DatabaseManager.getInstance();

  // ── Path 1: single-file delete ──────────────────────────────────────
  const mm = ModesManager.getInstance();
  const mode1 = mm.createMode({ name: 'Cascade Test 1', templateType: 'general' });
  const file1 = mm.addReferenceFile({ modeId: mode1.id, fileName: 'test.pdf', content });
  const pack1 = KnowledgeManager.getInstance().getPackForFile(file1.id);
  check('file1: pack generated with cards', Boolean(pack1) && pack1.cards.length > 0);

  const source1 = db.getKnowledgeSourceByFileId(file1.id);
  check('file1: knowledge_sources row exists before delete', Boolean(source1));
  check('file1: knowledge_packs row exists before delete', Boolean(db.getKnowledgePackBySourceId(source1.id)));
  check('file1: knowledge_cards rows exist before delete', db.getKnowledgeCardsByPackId(pack1.id).length > 0);

  mm.deleteReferenceFile(file1.id);

  check('file1: knowledge_packs row is gone after deleteReferenceFile (was orphaned before this fix)', db.getKnowledgePackBySourceId(source1.id) === null);
  check('file1: knowledge_cards rows are gone after deleteReferenceFile (was orphaned before this fix)', db.getKnowledgeCardsByPackId(pack1.id).length === 0);
  check('file1: knowledge_sources row is gone after deleteReferenceFile', db.getKnowledgeSourceByFileId(file1.id) === null);

  // ── Path 2: whole-mode delete (previously NOT cleaned up at all) ────
  const mode2 = mm.createMode({ name: 'Cascade Test 2', templateType: 'general' });
  const file2 = mm.addReferenceFile({ modeId: mode2.id, fileName: 'test2.pdf', content });
  const pack2 = KnowledgeManager.getInstance().getPackForFile(file2.id);
  check('file2 (mode2): pack generated with cards', Boolean(pack2) && pack2.cards.length > 0);

  const source2 = db.getKnowledgeSourceByFileId(file2.id);
  check('file2: knowledge_packs row exists before deleteMode', Boolean(db.getKnowledgePackBySourceId(source2.id)));

  mm.deleteMode(mode2.id);

  check('file2: knowledge_packs row is gone after deleteMode (previously orphaned — deleteMode never touched knowledge_* rows at all)', db.getKnowledgePackBySourceId(source2.id) === null);
  check('file2: knowledge_sources row is gone after deleteMode', db.getKnowledgeSourceByFileId(file2.id) === null);

  console.log(`\n[smoke-okf-cascade-delete] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-cascade-delete] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
