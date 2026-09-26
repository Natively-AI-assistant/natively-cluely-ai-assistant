// tests/context-os-real-backend/judge-score.mjs
//
// Standalone second-tier scoring pass over a completed benchmark results.jsonl.
// Runs the independent LLM judge (llm-judge.mjs) ONLY on deterministic near-miss
// answers and reports the merged two-tier pass rate. Kept separate from the live
// Electron runner so it (a) never slows the main streaming loop, (b) can re-score
// any prior run, and (c) makes the judge a distinct, auditable invocation as the
// plan requires.
//
// Usage:
//   NATIVELY_API_BASE=http://127.0.0.1:3000 \
//   node tests/context-os-real-backend/judge-score.mjs <results.jsonl> [--out judged.jsonl]
//
// Requires the local Natively backend reachable at NATIVELY_API_BASE with the
// x-natively-local-test token. If the judge backend is unavailable the pass is
// marked INCOMPLETE and exits non-zero (a missing judge is a gate failure, never
// a silent pass — plan section 6).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { scoreTwoTier } from './llm-judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const resultsPath = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
if (!resultsPath || !fs.existsSync(resultsPath)) {
  console.error(`Usage: node judge-score.mjs <results.jsonl> [--out judged.jsonl]\n  results file not found: ${resultsPath}`);
  process.exit(2);
}

const bankPath = path.resolve(__dirname, 'fixtures/sample-thesis/question-bank.json');
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const byId = new Map(bank.cases.map((c) => [c.id, c]));

const rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

let detPass = 0;
let judgeUpgrades = 0;
let judgeConsulted = 0;
let judgeUnavailable = 0;
let hardFails = 0;
const judged = [];
const upgradedIds = [];

for (const r of rows) {
  const testCase = byId.get(r.caseId);
  const det = r.score;
  if (!testCase || !det) { judged.push(r); continue; }
  // Reconstruct the question on the case (results.jsonl doesn't carry it).
  const caseWithQ = { ...testCase, rubric: testCase.rubric };
  if (det.pass) {
    detPass++;
    judged.push({ ...r, twoTier: { pass: true, tier: 'deterministic' } });
    continue;
  }
  const verdict = await scoreTwoTier(caseWithQ, r.answer || '', det, { timeoutMs: 45000 });
  if (verdict.tier === 'deterministic_hard') hardFails++;
  if (verdict.tier === 'judge' || verdict.tier === 'judge_unavailable') judgeConsulted++;
  if (verdict.tier === 'judge_unavailable') judgeUnavailable++;
  if (verdict.pass && verdict.tier === 'judge') { judgeUpgrades++; upgradedIds.push(r.caseId); }
  judged.push({ ...r, twoTier: verdict });
}

const twoTierPass = judged.filter((r) => r.twoTier?.pass).length;
const total = rows.length;

const lines = [];
lines.push(`Results: ${resultsPath}`);
lines.push(`Total cases:            ${total}`);
lines.push(`Deterministic pass:     ${detPass} (${(100 * detPass / total).toFixed(1)}%)`);
lines.push(`Judge consulted:        ${judgeConsulted} near-miss answers`);
lines.push(`Judge upgrades:         ${judgeUpgrades}  -> ${upgradedIds.join(', ') || '(none)'}`);
lines.push(`Judge unavailable:      ${judgeUnavailable}`);
lines.push(`Two-tier pass:          ${twoTierPass} (${(100 * twoTierPass / total).toFixed(1)}%)`);
console.log(lines.join('\n'));

if (outPath) {
  fs.writeFileSync(outPath, judged.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nWrote judged results: ${outPath}`);
}

// A missing judge on ANY consulted near-miss makes the run incomplete.
if (judgeUnavailable > 0) {
  console.error(`\nINCOMPLETE: judge backend was unavailable for ${judgeUnavailable} case(s). Not a valid final score.`);
  process.exit(1);
}
process.exit(0);
