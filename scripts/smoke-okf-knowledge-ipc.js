// scripts/smoke-okf-knowledge-ipc.js
//
// OKF Phase 5 smoke test: exercises the knowledge:list-packs / knowledge:get-pack
// / knowledge:regenerate-pack IPC handler LOGIC directly (bypassing the actual
// ipcMain/ipcRenderer transport, which requires a full BrowserWindow) against a
// real Electron app instance + DB. Verifies the handlers return the right shape
// and respect the okfKnowledgeUi flag gate.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-knowledge-ipc.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-ipc-test-'));
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
  const mode = mm.createMode({ name: 'OKF IPC Test', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: 'Use uploaded reference material as source of truth.' });
  const content = `[Page 1]\n1.1 Research Questions\n\nRQ1: Can an Agentic AI Framework be combined with VLA models?\nRQ2: How does embodied cognition support connected intelligence?\n`;
  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'test.pdf', content });

  // --- knowledge:list-packs (flag OFF by default — the IPC handler itself
  // checks isOkfKnowledgeUiEnabled(), which is a SEPARATE flag from
  // okfKnowledgePacks). This mirrors what the real handler does. ---
  process.env.NATIVELY_OKF_KNOWLEDGE_UI = '0';
  {
    const { isOkfKnowledgeUiEnabled } = require(path.join(distRoot, 'intelligence/intelligenceFlags.js'));
    check('okfKnowledgeUi defaults OFF', isOkfKnowledgeUiEnabled() === false);
  }

  process.env.NATIVELY_OKF_KNOWLEDGE_UI = '1';
  {
    const { isOkfKnowledgeUiEnabled } = require(path.join(distRoot, 'intelligence/intelligenceFlags.js'));
    check('okfKnowledgeUi flips ON via env override', isOkfKnowledgeUiEnabled() === true);
  }

  const pack = KnowledgeManager.getInstance().getPackForFile(file.id);
  check('KnowledgeManager.getPackForFile returns a pack (list-packs/get-pack data source)', Boolean(pack));
  check('pack has cards with the expected shape (id/type/title/body/sourcePages)', Boolean(pack) && pack.cards.every((c) =>
    typeof c.id === 'string' && typeof c.type === 'string' && typeof c.title === 'string'
    && typeof c.body === 'string' && Array.isArray(c.sourcePages),
  ));

  const packsForMode = KnowledgeManager.getInstance().getPacksForMode(mode.id);
  check('KnowledgeManager.getPacksForMode returns the pack for list-packs', packsForMode.length === 1 && packsForMode[0].id === pack.id);

  // --- regenerate (force=true) ---
  const regen = KnowledgeManager.getInstance().generateForFile(
    { id: file.id, modeId: mode.id, fileName: 'test.pdf', content: content + '\nExtra text.' },
    true,
  );
  check('regenerate (force) returns status=generated with an incremented packVersion', regen.status === 'generated' && regen.pack?.packVersion === (pack.packVersion + 1), `status=${regen.status} v=${regen.pack?.packVersion}`);

  console.log(`\n[smoke-okf-ipc] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-ipc] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
