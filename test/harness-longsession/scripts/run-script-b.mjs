// test/harness-longsession/scripts/run-script-b.mjs
//
// Runs Script B (technical deep-dive, reference-PDF grounded via a real
// ModesManager "lecture" mode + real hybrid retrieval) end-to-end against the
// REAL backend and returns { scorecard, perPress, promptSizeOverTime }.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { runScript } = require('../lib/run-script.cjs');
const { gradeScriptRun } = await import('../grading/grade-run.mjs');

const SCRIPT_PATH = path.join(__dirname, 'script-b-technical-deepdive.json');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

async function setupFn(ctx) {
  const scriptJson = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  const refPdfPath = path.join(REPO_ROOT, scriptJson.fixtures.referencePdfPath);

  const mode = ctx.modesManager.createMode({ name: 'Attention Paper Deep-Dive', templateType: scriptJson.fixtures.modeTemplateType });
  ctx.modesManager.setActiveMode(mode.id);

  const { ingestModeReferenceFile } = require('../../../dist-electron/electron/services/ModeReferenceFileIngestion.js');
  const ingestResult = await ingestModeReferenceFile({ modeId: mode.id, filePath: refPdfPath });
  // ingestModeReferenceFile fires indexing in the background (fire-and-forget
  // per its own doc comment). Wait for it explicitly here so the FIRST press
  // isn't racing a cold index (production tolerates this via lexical
  // fallback; the harness wants a warm index for a clean G1/G3 read on early
  // presses). Re-fetch the full ModeReferenceFile row (with real .content)
  // rather than indexing the partial ingestResult shape.
  const files = ctx.modesManager.getReferenceFiles(mode.id);
  const file = files.find((f) => f.id === ingestResult.id) || files[0];
  if (file) await ctx.modesManager.indexReferenceFile(file).catch((e) => console.warn('[script-b setup] indexReferenceFile failed (non-fatal, lexical fallback remains):', e?.message));
  console.log(`[script-b setup] Created mode ${mode.id} (${scriptJson.fixtures.modeTemplateType}), ingested reference file ${ingestResult.fileName} (${ingestResult.pageCount ?? '?'} pages)`);
}

export async function run(opts = {}) {
  const { pressResults, promptSizeOverTime } = await runScript(SCRIPT_PATH, { setupFn });

  // Source context for the G4 hallucination judge: a raw text extraction of
  // the reference PDF (same fixture the model was grounded on).
  let sourceText = '';
  try {
    const { PDFParse } = require('pdf-parse');
    const scriptJson = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
    const buf = fs.readFileSync(path.join(REPO_ROOT, scriptJson.fixtures.referencePdfPath));
    const parser = new PDFParse({ data: buf });
    const parsed = await parser.getText();
    sourceText = parsed.text || '';
  } catch (e) {
    console.warn('[script-b] could not extract reference PDF text for G4 judge source context:', e?.message);
  }

  const { scorecard, perPress } = await gradeScriptRun('script-b', pressResults, () => sourceText, opts);
  return { scorecard, perPress, promptSizeOverTime };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const skipJudge = process.argv.includes('--skip-judge');
  run({ skipJudge }).then((result) => {
    console.log('HARNESS_RESULT_JSON_BEGIN');
    console.log(JSON.stringify(result));
    console.log('HARNESS_RESULT_JSON_END');
    process.exit(0);
  }).catch((e) => {
    console.error('[script-b] FATAL', e && e.stack || e);
    process.exit(1);
  });
}
