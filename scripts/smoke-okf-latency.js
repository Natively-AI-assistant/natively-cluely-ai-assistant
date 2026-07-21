// scripts/smoke-okf-latency.js
//
// OKF Phase 7 latency smoke test: measures warm-cache timings against the
// spec targets (warm OKF card retrieval < 50ms, warm evidence assembly
// < 100ms, doc-grounded retrieval < 300ms when warm) against the real
// thesis pack.
//
// Run: ./node_modules/.bin/electron scripts/smoke-okf-latency.js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-latency-test-'));
app.setPath('userData', tmpUserData);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${label}${detail ? `  (${detail})` : ''}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `  :: ${detail}` : ''}`); }
}

async function ingestPdfText(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (pdfjsLib) {
    try {
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = require('node:url').pathToFileURL(workerPath).href;
    } catch { /* best effort */ }
  }
  const { PDFParse } = require('pdf-parse');
  const data = await new PDFParse({ data: fs.readFileSync(pdfPath) }).getText();
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n');
  }
  return data.text || '';
}

async function main() {
  await app.whenReady();
  process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '1';

  const pdfPath = path.join(repoRoot, 'Sample thesis for testing.pdf');
  if (!fs.existsSync(pdfPath)) {
    console.log('[smoke-okf-latency] SKIP — no thesis PDF at repo root');
    process.exit(0);
  }
  const content = await ingestPdfText(pdfPath);

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const { KnowledgeManager } = require(path.join(distRoot, 'services/knowledge/KnowledgeManager.js'));
  const { classifyQuestion } = require(path.join(distRoot, 'services/knowledge/QuestionClassifier.js'));
  const { queryOkfCards } = require(path.join(distRoot, 'services/knowledge/OkfRetriever.js'));
  const { assembleEvidence } = require(path.join(distRoot, 'services/knowledge/EvidenceAssembler.js'));
  const { getCacheStats } = require(path.join(distRoot, 'services/knowledge/KnowledgeCache.js'));

  const mm = ModesManager.getInstance();
  const mode = mm.createMode({ name: 'OKF Latency Test', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: 'Use uploaded reference material as source of truth.' });
  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'thesis.pdf', content });

  const question = 'What is OpenVLA-OFT?';
  const classification = classifyQuestion(question);

  // Cold call — warms KnowledgeManager's pack cache AND OkfRetriever's
  // retrieval cache. Not asserted against a target (extraction dominates).
  const coldPack = KnowledgeManager.getInstance().getPackForFile(file.id);
  check('pack generated with cards (precondition for latency measurement)', Boolean(coldPack) && coldPack.cards.length > 0);
  queryOkfCards(coldPack, question, classification, { topN: 6, fileId: file.id });

  // --- warm getPackForFile (should hit KnowledgeCache.packCache) ---
  const t0 = Date.now();
  const warmPack = KnowledgeManager.getInstance().getPackForFile(file.id);
  const packMs = Date.now() - t0;
  check('warm getPackForFile is fast (cache hit)', packMs < 20, `${packMs}ms`);
  check('warm getPackForFile returns the same pack version', warmPack.packVersion === coldPack.packVersion);

  // --- warm OKF card retrieval (should hit KnowledgeCache.retrievalCache) ---
  const t1 = Date.now();
  const scored = queryOkfCards(warmPack, question, classification, { topN: 6, fileId: file.id });
  const retrievalMs = Date.now() - t1;
  check('warm OKF card retrieval < 50ms (target from spec)', retrievalMs < 50, `${retrievalMs}ms`);
  check('warm retrieval returns cards', scored.length > 0);

  // --- warm evidence assembly ---
  const t2 = Date.now();
  const evidence = assembleEvidence({ pack: warmPack, scoredCards: scored, rawChunkText: '', classification });
  const assemblyMs = Date.now() - t2;
  check('warm evidence assembly < 100ms (target from spec)', assemblyMs < 100, `${assemblyMs}ms`);
  check('evidence pack has a non-zero tier', evidence.tier >= 1 && evidence.tier <= 4);

  // --- combined warm doc-grounded retrieval (pack fetch + card query + evidence assembly) ---
  const t3 = Date.now();
  const p = KnowledgeManager.getInstance().getPackForFile(file.id);
  const s = queryOkfCards(p, question, classification, { topN: 6, fileId: file.id });
  assembleEvidence({ pack: p, scoredCards: s, rawChunkText: '', classification });
  const combinedMs = Date.now() - t3;
  check('combined warm doc-grounded retrieval < 300ms (target from spec)', combinedMs < 300, `${combinedMs}ms`);

  const stats = getCacheStats();
  check('KnowledgeCache reports non-zero pack + retrieval cache entries', stats.packCacheSize > 0 && stats.retrievalCacheSize > 0, JSON.stringify(stats));

  // --- deletion cleanup ---
  mm.deleteReferenceFile(file.id);
  const afterDelete = KnowledgeManager.getInstance().getPackForFile(file.id);
  check('deleted file has no pack after deletion (cache + DB both cleared)', afterDelete === null);

  console.log(`\n[smoke-okf-latency] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-latency] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
