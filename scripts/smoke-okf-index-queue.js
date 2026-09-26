// scripts/smoke-okf-index-queue.js
//
// OKF Phase 7 smoke test: verifies KnowledgeIndexQueue's cross-bundle
// singleton fix — enqueues a background job via KnowledgeManager.js's
// bundled copy of the module, and listens for progress events via a
// SEPARATE require() of KnowledgeIndexQueue.js (simulating ipcHandlers.ts's
// bundle, which is a different esbuild entry point than KnowledgeManager.ts).
// Before the globalThis fix, the listener would never fire.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-index-queue.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-queue-test-'));
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
  // Separate require path than KnowledgeManager.js internally uses — this
  // is the "different bundle" simulation.
  const { knowledgeIndexQueue } = require(path.join(distRoot, 'services/knowledge/KnowledgeIndexQueue.js'));
  const { KnowledgeManager } = require(path.join(distRoot, 'services/knowledge/KnowledgeManager.js'));

  const mm = ModesManager.getInstance();
  const mode = mm.createMode({ name: 'OKF Queue Test', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: 'Use uploaded reference material as source of truth.' });
  const content = `[Page 1]\n1.1 Research Questions\n\nRQ1: test question one.\nRQ2: test question two.\n`;

  // knowledge_sources.file_id has an FK to mode_reference_files(id) — the
  // background job needs a REAL reference-file row, not a fabricated id.
  // Create the file WITHOUT content so ModesManager.addReferenceFile's own
  // (synchronous, Phase-2-wired) generateForFile call is a no-op — this
  // smoke test drives generateForFileInBackground explicitly instead.
  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'test.pdf', content: '' });
  const fileId = file.id;

  const events = [];
  knowledgeIndexQueue.on('progress', (p) => events.push(p));

  const result = await KnowledgeManager.getInstance().generateForFileInBackground({
    id: fileId, modeId: mode.id, fileName: 'test.pdf', content,
  });

  check('generateForFileInBackground resolves with status=generated', result.status === 'generated', result.status);
  check('progress events include a "running" status (cross-bundle EventEmitter singleton works)', events.some((e) => e.status === 'running'));
  check('progress events include a "done" status', events.some((e) => e.status === 'done'));
  check('all progress events reference the correct fileId', events.every((e) => e.fileId === fileId));

  // Duplicate concurrent call collapses to the same in-flight promise.
  const eventsBefore = events.length;
  const [r1, r2] = await Promise.all([
    KnowledgeManager.getInstance().generateForFileInBackground({ id: fileId, modeId: mode.id, fileName: 'test.pdf', content }, true),
    KnowledgeManager.getInstance().generateForFileInBackground({ id: fileId, modeId: mode.id, fileName: 'test.pdf', content }, true),
  ]);
  check('concurrent duplicate background calls resolve to the same result (single-flight)', r1.pack?.id === r2.pack?.id);

  console.log(`\n[smoke-okf-queue] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-queue] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
