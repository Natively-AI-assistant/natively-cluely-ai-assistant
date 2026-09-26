// scripts/smoke-okf-background-threshold.js
//
// OKF senior-review-fix smoke test: verifies ModesManager.addReferenceFile's
// size-threshold routing between the synchronous generateForFile path
// (typical documents) and the background generateForFileInBackground path
// (very large documents, via KnowledgeIndexQueue) — against a real Electron
// app + SQLite DB.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-background-threshold.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-threshold-test-'));
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
  const { knowledgeIndexQueue } = require(path.join(distRoot, 'services/knowledge/KnowledgeIndexQueue.js'));

  const mm = ModesManager.getInstance();

  // --- small content: stays synchronous, pack queryable immediately ---
  const mode1 = mm.createMode({ name: 'Threshold Test Small', templateType: 'general' });
  const smallContent = `[Page 1]\n1.1 Research Questions\n\nRQ1: test question.\nRQ2: test question two.\n`;
  const file1 = mm.addReferenceFile({ modeId: mode1.id, fileName: 'small.pdf', content: smallContent });
  const packImmediate = KnowledgeManager.getInstance().getPackForFile(file1.id);
  check('small content (<300k chars): pack is queryable IMMEDIATELY after addReferenceFile returns (synchronous path preserved)', Boolean(packImmediate) && packImmediate.cards.length > 0);

  // --- large content: routed through the background queue ---
  const events = [];
  const listener = (p) => events.push(p);
  knowledgeIndexQueue.on('progress', listener);

  const mode2 = mm.createMode({ name: 'Threshold Test Large', templateType: 'general' });
  // Build >300k chars of parseable section content so extraction actually
  // does meaningful work (not just padding).
  let largeContent = '';
  for (let i = 1; i <= 2500; i++) {
    largeContent += `[Page ${i}]\n${i}.1 Section Title ${i}\n\nThis is body text for section ${i} describing some concept in detail across several sentences to give the extractor real content to work with.\n\n`;
  }
  check('constructed large content actually exceeds the 300k threshold', largeContent.length > 300_000, `length=${largeContent.length}`);

  const file2 = mm.addReferenceFile({ modeId: mode2.id, fileName: 'large.pdf', content: largeContent });
  // Background path: addReferenceFile returns before generation completes —
  // give the background job a moment to at least reach 'running'/'done'.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const sawEventForFile2 = events.some((e) => e.fileId === file2.id);
  check('large content (>300k chars): KnowledgeIndexQueue emitted a progress event for this file (background path was actually used)', sawEventForFile2, JSON.stringify(events.map((e) => ({ fileId: e.fileId, status: e.status }))));

  // Poll briefly for completion (background extraction on 800 sections may take a moment).
  let packEventually = null;
  for (let i = 0; i < 20; i++) {
    packEventually = KnowledgeManager.getInstance().getPackForFile(file2.id);
    if (packEventually) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check('large content: pack is eventually generated via the background path', Boolean(packEventually) && packEventually.cards.length > 0, packEventually ? `cards=${packEventually.cards.length}` : 'null');

  knowledgeIndexQueue.off('progress', listener);

  console.log(`\n[smoke-okf-threshold] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-threshold] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
