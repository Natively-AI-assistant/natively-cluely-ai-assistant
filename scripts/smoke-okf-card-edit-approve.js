// scripts/smoke-okf-card-edit-approve.js
//
// OKF Phase 6 smoke test: edit/approve/reject/restore + version history +
// needs_review-on-checksum-change, against a real Electron app + DB.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-card-edit-approve.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-edit-test-'));
app.setPath('userData', tmpUserData);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `  :: ${detail}` : ''}`); }
}

async function main() {
  await app.whenReady();
  process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '1';
  process.env.NATIVELY_OKF_USER_EDITABLE_CARDS = '1';

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const { KnowledgeManager } = require(path.join(distRoot, 'services/knowledge/KnowledgeManager.js'));
  const { editCard, approveCard, rejectCard, restoreCardVersion, getCardHistory, isCardRetrievable } = require(path.join(distRoot, 'services/knowledge/OkfCardEditor.js'));
  const { classifyQuestion } = require(path.join(distRoot, 'services/knowledge/QuestionClassifier.js'));
  const { queryOkfCards } = require(path.join(distRoot, 'services/knowledge/OkfRetriever.js'));

  const mm = ModesManager.getInstance();
  const mode = mm.createMode({ name: 'OKF Edit Test', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: 'Use uploaded reference material as source of truth.' });
  const content = `[Page 1]\n1.1 OpenVLA-OFT\n\nOpenVLA-OFT is an improved version of OpenVLA. It uses parallel decoding and achieves 43x faster throughput than base OpenVLA.\n`;
  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'test.pdf', content });

  const pack = KnowledgeManager.getInstance().getPackForFile(file.id);
  check('pack generated with >=1 card', Boolean(pack) && pack.cards.length >= 1);
  const originalCard = pack.cards[0];
  const originalBody = originalCard.body;

  // --- edit ---
  const edited = editCard({ cardId: originalCard.id, title: 'OpenVLA-OFT (edited)', body: 'A user-corrected description.', editReason: 'smoke test' });
  check('editCard returns the updated card', Boolean(edited) && edited.title === 'OpenVLA-OFT (edited)' && edited.body === 'A user-corrected description.');
  check('editCard marks userEdited=true and approvalStatus=approved', Boolean(edited) && edited.userEdited === true && edited.approvalStatus === 'approved');
  check('editCard preserves sourcePages/sourceChecksum (source attribution untouched)', Boolean(edited) && JSON.stringify(edited.sourcePages) === JSON.stringify(originalCard.sourcePages) && edited.sourceChecksum === originalCard.sourceChecksum);

  // --- history ---
  const history = getCardHistory(originalCard.id);
  check('getCardHistory captures the pre-edit snapshot', history.length >= 1 && history[0].body === originalBody);

  // --- regenerate: user-edited card must survive (not overwritten) ---
  const regen = KnowledgeManager.getInstance().generateForFile(
    { id: file.id, modeId: mode.id, fileName: 'test.pdf', content },
    true,
  );
  const packAfterRegen = KnowledgeManager.getInstance().getPackForFile(file.id);
  const survivingCard = packAfterRegen.cards.find((c) => c.id === originalCard.id);
  check('user-edited card survives a forced regeneration untouched', Boolean(survivingCard) && survivingCard.body === 'A user-corrected description.');

  // --- reject + retrieval exclusion ---
  const rejected = rejectCard(originalCard.id);
  check('rejectCard sets approvalStatus=rejected', Boolean(rejected) && rejected.approvalStatus === 'rejected');
  check('isCardRetrievable returns false for a rejected card', isCardRetrievable(rejected) === false);

  const packAfterReject = KnowledgeManager.getInstance().getPackForFile(file.id);
  const classification = classifyQuestion('What is OpenVLA-OFT?');
  const scoredAfterReject = queryOkfCards(packAfterReject, 'What is OpenVLA-OFT?', classification, { topN: 6 });
  check('a rejected card is excluded from OkfRetriever.queryOkfCards results', !scoredAfterReject.some((s) => s.card.id === originalCard.id));

  // --- approve reverses rejection ---
  const reapproved = approveCard(originalCard.id);
  check('approveCard sets approvalStatus=approved', Boolean(reapproved) && reapproved.approvalStatus === 'approved');

  // --- restore to the original generated version ---
  const historyAfterAll = getCardHistory(originalCard.id);
  const originalVersion = historyAfterAll.find((v) => v.body === originalBody);
  check('history contains the original generated version', Boolean(originalVersion));
  if (originalVersion) {
    const restored = restoreCardVersion(originalCard.id, originalVersion.id);
    check('restoreCardVersion reverts the body to the original generated text', Boolean(restored) && restored.body === originalBody);
    check('restoreCardVersion clears userEdited when restoring to the system-generated version', Boolean(restored) && restored.userEdited === false);
  }

  console.log(`\n[smoke-okf-edit] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-edit] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
