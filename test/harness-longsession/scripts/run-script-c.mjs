// test/harness-longsession/scripts/run-script-c.mjs
//
// Runs Script C (adversarial/messy, same resume+JD fixtures as Script A so
// this script isolates the ADVERSARIAL dimension — rephrases, split
// questions, filler, one embedded prompt injection, long-range recall) end-
// to-end against the REAL backend and returns { scorecard, perPress,
// promptSizeOverTime }.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { runScript } = require('../lib/run-script.cjs');
const { gradeScriptRun } = await import('../grading/grade-run.mjs');

const SCRIPT_PATH = path.join(__dirname, 'script-c-adversarial.json');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

async function setupFn(ctx) {
  const scriptJson = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  const resumePath = path.join(REPO_ROOT, scriptJson.fixtures.resumePath);
  const jdPath = path.join(REPO_ROOT, scriptJson.fixtures.jdPath);

  const { DocType } = require('../../../dist-electron/premium/electron/knowledge/types.js');
  const resumeResult = await ctx.knowledgeOrchestrator.ingestDocument(resumePath, DocType.RESUME);
  if (!resumeResult?.success) throw new Error(`Resume ingestion failed: ${resumeResult?.error}`);
  const jdResult = await ctx.knowledgeOrchestrator.ingestDocument(jdPath, DocType.JD);
  if (!jdResult?.success) throw new Error(`JD ingestion failed: ${jdResult?.error}`);
  ctx.knowledgeOrchestrator.setKnowledgeMode(true);
  console.log(`[script-c setup] Ingested resume (${resumePath}) + JD (${jdPath}); knowledgeMode=${ctx.knowledgeOrchestrator.isKnowledgeMode()}`);
}

export async function run(opts = {}) {
  const { pressResults, promptSizeOverTime } = await runScript(SCRIPT_PATH, { setupFn });

  const resumeTxtPath = path.join(REPO_ROOT, 'test-fixtures/profiles/p01/_resume.txt');
  const jdTxtPath = path.join(REPO_ROOT, 'test-fixtures/profiles/p01/_jd.txt');
  const sourceText = [
    fs.existsSync(resumeTxtPath) ? fs.readFileSync(resumeTxtPath, 'utf8') : '',
    fs.existsSync(jdTxtPath) ? fs.readFileSync(jdTxtPath, 'utf8') : '',
  ].join('\n\n');

  const { scorecard, perPress } = await gradeScriptRun('script-c', pressResults, () => sourceText, opts);
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
    console.error('[script-c] FATAL', e && e.stack || e);
    process.exit(1);
  });
}
