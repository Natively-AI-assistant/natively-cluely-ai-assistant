#!/usr/bin/env node
// test/harness-longsession/run-all.mjs
//
// Runs all 3 Phase 2 harness scripts (A/B/C) end-to-end against the REAL
// natively-api backend + MiniMax-M3, applies the G1-G8 gates, and writes
// test/harness-longsession/reports/run-NNN.json + run-NNN.md.
//
// Usage:
//   node test/harness-longsession/run-all.mjs [--skip-judge] [--only=a,b,c]
//
// --skip-judge  : skip the MiniMax LLM-judge calls (G3/G4 judge tiers) —
//                 useful for a fast structural smoke-check of the harness
//                 itself without burning judge-model tokens. Deterministic
//                 gates (G1/G2/G5/G6/G7/G8, and G3/G4 where a manifest/
//                 forbidden-list exists) still run for real.
// --only=a,b,c  : run only the named scripts (comma-separated, case-
//                 insensitive) instead of all three. Useful for a
//                 single-script end-to-end verification pass.
//
// Each script run is REAL infrastructure: real rolling-transcript store, real
// question extraction, real prompt assembly, real retrieval (profile
// grounding for A/C, mode hybrid retrieval for B), and a REAL call per press
// to the local natively-api backend (MiniMax-M3 when
// NATIVELY_FORCE_PRIMARY_GEN=minimax is set there). This is expensive in
// tokens/time — see loop2.md §1.5 for the quota-guard procedure to run
// before invoking this for real.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(__dirname, 'reports');

const args = process.argv.slice(2);
const skipJudge = args.includes('--skip-judge');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()) : null;

const SCRIPTS = [
  { key: 'a', name: 'Script A (SWE interview, resume+JD)', modulePath: './scripts/run-script-a.mjs' },
  { key: 'b', name: 'Script B (technical deep-dive, reference PDF)', modulePath: './scripts/run-script-b.mjs' },
  { key: 'c', name: 'Script C (adversarial/messy)', modulePath: './scripts/run-script-c.mjs' },
];

function nextRunNumber() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const existing = fs.readdirSync(REPORTS_DIR).filter((f) => /^run-\d+\.json$/.test(f));
  const nums = existing.map((f) => Number(f.match(/^run-(\d+)\.json$/)[1]));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return String(next).padStart(3, '0');
}

function overallCounts(scorecards) {
  let greetingFlags = 0;
  let hallucFails = 0;
  let extractionPass = 0, extractionTotal = 0;
  let qualityPass = 0, qualityTotal = 0;
  let recallPass = 0, recallTotal = 0;
  let desyncPass = 0, desyncTotal = 0;
  let injectionPass = 0, injectionTotal = 0;
  for (const sc of scorecards) {
    greetingFlags += sc.G2_greeting_failure.flaggedCount;
    hallucFails += sc.G4_hallucination.failCount;
    extractionPass += sc.G1_question_extraction.pass; extractionTotal += sc.G1_question_extraction.total;
    qualityPass += sc.G3_answer_quality.pass; qualityTotal += sc.G3_answer_quality.total;
    recallPass += sc.G5_long_range_recall.pass; recallTotal += sc.G5_long_range_recall.total;
    desyncPass += sc.G6_desync.pass; desyncTotal += sc.G6_desync.total;
    injectionPass += sc.G7_injection.pass; injectionTotal += sc.G7_injection.total;
  }
  return {
    greetingFailures: greetingFlags,
    hallucinationFlags: hallucFails,
    questionExtractionAccuracy: extractionTotal > 0 ? (100 * extractionPass) / extractionTotal : null,
    answerQualityAccuracy: qualityTotal > 0 ? (100 * qualityPass) / qualityTotal : null,
    longRangeRecallAccuracy: recallTotal > 0 ? (100 * recallPass) / recallTotal : null,
    desyncAccuracy: desyncTotal > 0 ? (100 * desyncPass) / desyncTotal : null,
    injectionResistance: injectionTotal > 0 ? (100 * injectionPass) / injectionTotal : null,
  };
}

function exitConditionMet(overall) {
  return overall.greetingFailures === 0
    && overall.hallucinationFlags === 0
    && (overall.questionExtractionAccuracy === null || overall.questionExtractionAccuracy >= 98)
    && (overall.answerQualityAccuracy === null || overall.answerQualityAccuracy >= 95)
    && (overall.longRangeRecallAccuracy === null || overall.longRangeRecallAccuracy >= 90);
}

function writeMarkdown(reportPath, report) {
  const L = [];
  const W = (s = '') => L.push(s);
  W(`# Long-Session Harness Run ${report.runId}`);
  W('');
  W(`Timestamp: ${report.timestamp}`);
  W(`Scripts run: ${report.scripts.map((s) => s.scriptId).join(', ')}`);
  W(`Judge tier: ${report.skipJudge ? 'SKIPPED (--skip-judge)' : 'MiniMax LLM-judge (real)'}`);
  W('');
  W('## Overall (loop2.md L4 exit-condition targets)');
  W('');
  W('| Metric | Value | Target | Met? |');
  W('|---|---|---|---|');
  W(`| Greeting failures | ${report.overall.greetingFailures} | = 0 | ${report.overall.greetingFailures === 0 ? 'YES' : 'NO'} |`);
  W(`| Hallucination flags | ${report.overall.hallucinationFlags} | = 0 | ${report.overall.hallucinationFlags === 0 ? 'YES' : 'NO'} |`);
  W(`| Question extraction accuracy | ${fmtPct(report.overall.questionExtractionAccuracy)} | >= 98% | ${okPct(report.overall.questionExtractionAccuracy, 98)} |`);
  W(`| Answer quality | ${fmtPct(report.overall.answerQualityAccuracy)} | >= 95% | ${okPct(report.overall.answerQualityAccuracy, 95)} |`);
  W(`| Long-range recall | ${fmtPct(report.overall.longRangeRecallAccuracy)} | >= 90% | ${okPct(report.overall.longRangeRecallAccuracy, 90)} |`);
  W(`| Desync accuracy | ${fmtPct(report.overall.desyncAccuracy)} | = 100% | ${okPct(report.overall.desyncAccuracy, 100)} |`);
  W(`| Injection resistance | ${fmtPct(report.overall.injectionResistance)} | = 100% | ${okPct(report.overall.injectionResistance, 100)} |`);
  W('');
  W(`**L4 exit condition met by this single run: ${report.exitConditionMet ? 'YES' : 'NO'}** (L4 formally requires TWO consecutive green full-benchmark runs — see campaign2-log.md for the running tally.)`);
  W('');
  for (const s of report.scripts) {
    W(`## ${s.scriptId}`);
    W('');
    W(`Presses: ${s.scorecard.presses}`);
    W('');
    W('| Gate | Result |');
    W('|---|---|');
    W(`| G1 Question extraction | ${s.scorecard.G1_question_extraction.pass}/${s.scorecard.G1_question_extraction.total} (${fmtPct(s.scorecard.G1_question_extraction.pct)}) |`);
    W(`| G2 Greeting failures | ${s.scorecard.G2_greeting_failure.flaggedCount}/${s.scorecard.G2_greeting_failure.total} flagged |`);
    W(`| G3 Answer quality | ${s.scorecard.G3_answer_quality.pass}/${s.scorecard.G3_answer_quality.total} (${fmtPct(s.scorecard.G3_answer_quality.pct)}) |`);
    W(`| G4 Hallucination | ${s.scorecard.G4_hallucination.failCount}/${s.scorecard.G4_hallucination.total} flagged |`);
    W(`| G5 Long-range recall | ${s.scorecard.G5_long_range_recall.pass}/${s.scorecard.G5_long_range_recall.total} (${fmtPct(s.scorecard.G5_long_range_recall.pct)}) |`);
    W(`| G6 Desync | ${s.scorecard.G6_desync.pass}/${s.scorecard.G6_desync.total} (${fmtPct(s.scorecard.G6_desync.pct)}) |`);
    W(`| G7 Injection | ${s.scorecard.G7_injection.pass}/${s.scorecard.G7_injection.total} (${fmtPct(s.scorecard.G7_injection.pct)}) |`);
    W('');
    W('G8 Latency buckets (real wall-clock ms, per simulated-minute bucket):');
    W('');
    W('| Bucket | count | p50 | p95 | mean |');
    W('|---|---|---|---|---|');
    for (const [bucket, v] of Object.entries(s.scorecard.G8_latency.buckets)) {
      W(`| ${bucket} | ${v.count} | ${fmtMs(v.p50)} | ${fmtMs(v.p95)} | ${fmtMs(v.mean)} |`);
    }
    W(`Superlinear growth flag: ${s.scorecard.G8_latency.superlinearGrowthFlag ? 'YES (0-10 vs 20-30 p50 more than 2x)' : 'no'}`);
    W('');
    const failures = s.perPress.filter((p) => p.G1.pass === false || p.G2.flagged || (p.G3_deterministic.applicable && !p.G3_deterministic.pass) || (p.G4_forbidden.applicable && !p.G4_forbidden.pass) || (p.G5.applicable && !p.G5.pass) || !p.G6.pass || (p.G7.applicable && !p.G7.pass));
    if (failures.length > 0) {
      W('### Per-press failures');
      W('');
      for (const p of failures) {
        W(`- **${p.pressId}** (${p.label}, t=${p.t}): answer="${p.answerPreview.replace(/\n/g, ' ')}"`);
        if (p.G1.pass === false) W(`  - G1 FAIL: extracted "${p.G1.extracted}" vs canonical "${p.G1.canonical}" (overlap ${p.G1.overlap?.toFixed(2)})`);
        if (p.G2.flagged) W(`  - G2 FAIL: greeting pattern matched (${p.G2.matchedPattern})`);
        if (p.G3_deterministic.applicable && !p.G3_deterministic.pass) W(`  - G3 FAIL (deterministic): missing facts ${JSON.stringify(p.G3_deterministic.missing)}${p.G3_judge ? `; judge pass=${p.G3_judge.pass}` : ''}`);
        if (p.G4_forbidden.applicable && !p.G4_forbidden.pass) W(`  - G4 FAIL: forbidden fact hit "${p.G4_forbidden.hit}"`);
        if (p.G4_judge && !p.G4_judge.pass) W(`  - G4 judge FAIL: ${JSON.stringify(p.G4_judge.details)}`);
        if (p.G5.applicable && !p.G5.pass) W(`  - G5 FAIL: missing recalled facts ${JSON.stringify(p.G5.missing)}`);
        if (!p.G6.pass) W(`  - G6 FAIL: extractionOk=${p.G6.extractionOk} onTopic=${p.G6.onTopic}`);
        if (p.G7.applicable && !p.G7.pass) W(`  - G7 FAIL: injection COMPLIED WITH`);
      }
      W('');
    }
  }
  fs.writeFileSync(reportPath, L.join('\n') + '\n');
}

function fmtPct(v) { return v === null ? 'n/a' : `${v.toFixed(1)}%`; }
function okPct(v, target) { return v === null ? 'n/a' : (v >= target ? 'YES' : 'NO'); }
function fmtMs(v) { return v === null || v === undefined ? 'n/a' : `${v.toFixed(0)}ms`; }

/**
 * Runs one script's entrypoint in an ISOLATED child process rather than via
 * in-process `import()`. This is load-bearing, not a style choice: every
 * script's setup wires the REAL compiled `DatabaseManager`/`ModesManager`
 * singletons (dist-electron modules cache across `require`/`import` calls
 * within one Node process), each pointed at its OWN scratch userData/sqlite
 * file. Running two scripts in-process back-to-back leaves the FIRST
 * script's DatabaseManager singleton (and its sqlite connection, already
 * closed/rm -rf'd) wired into the SECOND script's ModesManager, producing a
 * `FOREIGN KEY constraint failed` the moment the second script tries to
 * write to a database file that no longer matches what the cached singleton
 * thinks it opened. A fresh child process gets a fresh module cache, so each
 * script's singletons are genuinely private to that script's run — the
 * bootstrap's isolation guarantee that its per-script mkdtemp userData dir
 * implies but a shared process would silently violate.
 */
function runScriptInChildProcess(modulePath, extraArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [modulePath, ...extraArgs], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text); // stream through so a live run is still watchable
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`${modulePath} exited with code ${code}`));
        return;
      }
      const begin = stdout.indexOf('HARNESS_RESULT_JSON_BEGIN');
      const end = stdout.indexOf('HARNESS_RESULT_JSON_END');
      if (begin === -1 || end === -1) {
        reject(new Error(`${modulePath} did not emit a HARNESS_RESULT_JSON block (stdout truncated or format changed)`));
        return;
      }
      const jsonText = stdout.slice(begin + 'HARNESS_RESULT_JSON_BEGIN'.length, end).trim();
      try {
        resolve(JSON.parse(jsonText));
      } catch (e) {
        reject(new Error(`Failed to parse HARNESS_RESULT_JSON from ${modulePath}: ${e.message}`));
      }
    });
  });
}

async function main() {
  const runners = SCRIPTS.filter((s) => !only || only.includes(s.key));
  if (runners.length === 0) {
    console.error(`No scripts matched --only=${only?.join(',')}`);
    process.exit(2);
  }

  const scriptReports = [];
  for (const s of runners) {
    console.log(`\n[run-all] === Running ${s.name} (isolated child process) ===`);
    const modulePath = path.join(__dirname, s.modulePath);
    const extraArgs = skipJudge ? ['--skip-judge'] : [];
    const result = await runScriptInChildProcess(modulePath, extraArgs);
    scriptReports.push(result);
    console.log(`[run-all] ${s.name} done: G1=${result.scorecard.G1_question_extraction.pass}/${result.scorecard.G1_question_extraction.total} G2_flags=${result.scorecard.G2_greeting_failure.flaggedCount} G4_flags=${result.scorecard.G4_hallucination.failCount}`);
  }

  const overall = overallCounts(scriptReports.map((r) => r.scorecard));
  const runId = nextRunNumber();
  const report = {
    runId,
    timestamp: new Date().toISOString(),
    skipJudge,
    scriptsRequested: runners.map((s) => s.key),
    scripts: scriptReports.map((r) => ({ scriptId: r.scorecard.scriptId, scorecard: r.scorecard, perPress: r.perPress, promptSizeOverTime: r.promptSizeOverTime })),
    overall,
    exitConditionMet: exitConditionMet(overall),
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const jsonPath = path.join(REPORTS_DIR, `run-${runId}.json`);
  const mdPath = path.join(REPORTS_DIR, `run-${runId}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeMarkdown(mdPath, report);

  console.log(`\n[run-all] Wrote ${jsonPath}`);
  console.log(`[run-all] Wrote ${mdPath}`);
  console.log(`[run-all] Overall: ${JSON.stringify(overall, null, 2)}`);
  console.log(`[run-all] Exit condition met (this run): ${report.exitConditionMet}`);
}

main().catch((e) => {
  console.error('[run-all] FATAL', e && e.stack || e);
  process.exit(1);
});
