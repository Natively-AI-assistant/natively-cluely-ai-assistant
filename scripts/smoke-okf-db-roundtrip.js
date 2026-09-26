// scripts/smoke-okf-db-roundtrip.js
//
// OKF Phase 2 smoke test: verifies the DB migration (v19->v20) + KnowledgeManager
// generate/persist/retrieve/regenerate/delete round-trip against a REAL Electron
// app instance. The native better-sqlite3 binding requires the real electron
// binary (not ELECTRON_RUN_AS_NODE / plain node) — see scripts/e2e-thesis-real-path.js
// for the same pattern.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-db-roundtrip.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-db-test-'));
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

  const mm = ModesManager.getInstance();
  const mode = mm.createMode({ name: 'OKF DB Test', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: 'Use uploaded reference material as source of truth.' });

  const content = `[Page 1]
1.1 Research Questions

RQ1: Can an Agentic AI Framework be combined with Visual-Language-Action models?
RQ2: How does embodied cognition support connected intelligence?

[Page 2]
2.1 OpenVLA-OFT

OpenVLA-OFT is an improved version of OpenVLA. It uses parallel decoding and achieves 43x faster throughput than base OpenVLA.
`;

  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'test.pdf', content });
  const pack = KnowledgeManager.getInstance().getPackForFile(file.id);
  check('addReferenceFile triggers pack generation', Boolean(pack));
  check('generated pack has >=2 cards', Boolean(pack) && pack.cards.length >= 2, pack && `got ${pack.cards.length}`);
  check('generated pack cards include Research Questions and OpenVLA-OFT', Boolean(pack) && pack.cards.some(c => c.title === 'Research Questions') && pack.cards.some(c => c.title === 'OpenVLA-OFT'));

  const r2 = KnowledgeManager.getInstance().generateForFile({ id: file.id, modeId: mode.id, fileName: 'test.pdf', content });
  check('unchanged content is a no-op (skipped_unchanged)', r2.status === 'skipped_unchanged', r2.status);

  const r3 = KnowledgeManager.getInstance().generateForFile({ id: file.id, modeId: mode.id, fileName: 'test.pdf', content: content + '\nNew text added.' });
  check('changed content (new hash) regenerates with incremented packVersion', r3.status === 'generated' && r3.pack?.packVersion === 2, `status=${r3.status} packVersion=${r3.pack?.packVersion}`);

  mm.deleteReferenceFile(file.id);
  const packAfterDelete = KnowledgeManager.getInstance().getPackForFile(file.id);
  check('deleteReferenceFile invalidates the pack', packAfterDelete === null);

  console.log(`\n[smoke-okf-db] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[smoke-okf-db] FATAL', e); try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {} process.exit(2); });
