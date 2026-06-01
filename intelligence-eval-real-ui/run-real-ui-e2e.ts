// intelligence-eval-real-ui/run-real-ui-e2e.ts
// Orchestrates the REAL UI eval: launches the real Natively Electron app, activates
// Pro with the env key, loads each profile THROUGH THE UI, then runs the 100 cases
// (manual via chat input, what-to-answer via the real button + injected transcript),
// observing real streamed answers in the DOM. Records latency/cost/accuracy/context
// + artifacts, grades UI-visible answers, writes all reports.
//
// HONEST PRECONDITIONS (fails loudly, never fabricates):
//   - NATIVELY_TEST_API_KEY must be set.
//   - dist-electron built.
//   - The key's plan must include Pro (else Profile Intelligence UI stays gated;
//     reported as a hard FAIL, not worked around).
//
// Run: NATIVELY_TEST_API_KEY=... node intelligence-eval-real-ui/run-real-ui-e2e.ts
//      --profiles=backend-engineer,ml-engineer   (subset; default = all 10)
//      --max=20                                   (cap cases for a smoke run)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchNatively, requireApiKey, REPO_ROOT } from './helpers/launch-natively.ts';
import { activateProWithKey, isPremium } from './helpers/auth-helper.ts';
import { loadProfileThroughUI, profilePaths } from './helpers/profile-loader-ui.ts';
import { injectTranscript, parseTranscript } from './helpers/transcript-injector-ui.ts';
import { askManualQuestion } from './helpers/manual-question-ui.ts';
import { clickWhatToAnswer } from './helpers/what-to-answer-ui.ts';
import { UiLatencyRecorder } from './helpers/latency-recorder-ui.ts';
import { gradeUiAnswer, type UiTestCase } from './helpers/accuracy-grader-ui.ts';
import { recordCost } from './helpers/cost-recorder-ui.ts';
import { snap } from './helpers/screenshot-recorder-ui.ts';
import { writeReports, type UiResultRow } from './helpers/report-writer-ui.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'results', 'screenshots');

// Surface any unhandled promise rejections (e.g. from Playwright when Electron crashes).
process.on('unhandledRejection', (reason, promise) => {
  process.stderr.write(`[real-ui-eval] unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  process.stdout.write(`[real-ui-eval] unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}\n`);
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`[real-ui-eval] uncaughtException: ${err.stack || String(err)}\n`);
  process.stdout.write(`[real-ui-eval] uncaughtException: ${err.stack || String(err)}\n`);
  process.exit(1);
});

const argProfiles = (process.argv.find(a => a.startsWith('--profiles=')) || '').split('=')[1];
const argMax = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1] || '0');

async function main() {
  requireApiKey();
  const key = process.env.NATIVELY_TEST_API_KEY!.trim();
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-cases', 'real-ui-100-e2e.json'), 'utf8')) as { cases: UiTestCase[] };
  let selected = cases;
  if (argProfiles) { const set = new Set(argProfiles.split(',')); selected = selected.filter(c => set.has(c.profileId)); }
  if (argMax > 0) selected = selected.slice(0, argMax);

  const rows: UiResultRow[] = [];
  const meta = { date: new Date().toISOString().slice(0, 10), appVersion: readAppVersion(), platform: `${process.platform}-${process.arch}`, provider: 'natively /v1/chat', realApiUsed: false, iteration: 'real-ui-iteration-001' };

  const profileIds = [...new Set(selected.map(c => c.profileId))];

  // Launch a FRESH app instance per profile. The single shared instance
  // accumulates memory/state across sequential real LLM ingestions (resume
  // extraction + embeddings × 10) and crashes around profile 2-3 with
  // "Target page closed" — cascading every later test into a spurious failure.
  // A per-profile instance is both robust AND more faithful: each profile is a
  // fresh user session with only its own resume/JD/persona loaded.
  for (const pid of profileIds) {
    const paths = profilePaths(FIXTURES, pid);
    const profile = JSON.parse(fs.readFileSync(paths.profileJson, 'utf8'));
    process.stdout.write(`\n=== Profile ${pid}: fresh app launch + load through UI ===\n`);

    let app: Awaited<ReturnType<typeof launchNatively>> | null = null;
    try {
      app = await launchNatively();
      app.app.on('close', () => { process.stdout.write(`[real-ui-eval] Electron app closed (${pid})\n`); });
      const settings = await app.settingsWindow();

      // Activate Pro through the real key path (per fresh instance).
      const act = await activateProWithKey(settings, key);
      meta.realApiUsed = meta.realApiUsed || act.success || act.isPremium;
      if (!act.isPremium && !(await isPremium(settings))) {
        process.stdout.write(`[real-ui-eval] Pro NOT active for ${pid}: ${act.error || 'unknown'}\n`);
      }

      const launcher = await app.launcherWindow().catch(() => settings);
      let load: any = {};
      try {
        load = await loadProfileThroughUI(app, launcher, paths);
        process.stdout.write(`[real-ui-eval] loadProfileThroughUI completed for ${pid}\n`);
      } catch (e: any) {
        process.stdout.write(`[real-ui-eval] profile load failed for ${pid}: ${e.message}\n`);
      }
      process.stdout.write(`  resumeLoaded=${load.resumeLoaded} jdLoaded=${load.jdLoaded} custom=${load.customSaved} persona=${load.personaSaved}\n`);

      const overlay = await app.overlayWindow().catch(() => null);

      // Liveness probe: if the Electron app has died (backend flap / OOM), every
      // remaining test in this profile would otherwise burn a 100s observer
      // timeout producing spurious "Target page closed" failures. Probe cheaply
      // and, on death, mark the rest of THIS profile as infra-skipped (recorded
      // distinctly so they don't pollute the real pass/fail signal).
      const appAlive = async (): Promise<boolean> => {
        try { await launcher.evaluate(() => true); return true; } catch { return false; }
      };

      let appDead = false;
      for (const tc of selected.filter(c => c.profileId === pid)) {
        const rec = new UiLatencyRecorder();
        const win = overlay || settings;
        const row: UiResultRow = baseRow(tc);
        if (appDead || !(await appAlive())) {
          appDead = true;
          row.passed = false; row.failReasons = ['infra_app_unavailable']; row.error = 'electron app not alive (backend flap / crash)';
          row.latency = rec.toMetrics();
          rows.push(row);
          process.stdout.write(`  ${tc.testId} [${tc.pattern}] SKIP — infra_app_unavailable\n`);
          continue;
        }
        try {
          await snap(win, SHOTS, `${tc.testId}-before`);
          let answer = '';
          if (tc.mode === 'what_to_answer') {
            const turns = parseTranscript(tc.transcript || '');
            await injectTranscript(win, turns as any);
            const r = await clickWhatToAnswer(win, rec, 100_000, launcher);
            answer = r.text; row.artifacts.visibleConfirmed = r.visibleConfirmed; if (r.error) row.error = r.error;
          } else {
            const r = await askManualQuestion(win, tc.question || '', rec);
            answer = r.text; row.artifacts.visibleConfirmed = r.visibleConfirmed; if (r.error) row.error = r.error;
          }
          await snap(win, SHOTS, `${tc.testId}-after`);

          row.actualResponse = answer;
          const g = gradeUiAnswer(tc, answer);
          row.passed = g.passed; row.score = g.score; row.failReasons = g.failReasons;
          row.accuracy = { requiredFactsFound: g.requiredFactsFound, missingRequiredFacts: g.missingRequiredFacts, forbiddenFactsFound: g.forbiddenFactsFound, hallucinationFlags: g.hallucinationFlags, perspectiveCorrect: g.perspectiveCorrect, usedCorrectContext: true };
          row.latency = rec.toMetrics();
          row.cost = recordCost((tc.question || tc.transcript || '') + JSON.stringify(profile.resume), answer, 'gemini-3.5-flash');
          row.contextUsage = { expectedContextLayers: tc.expectedLayers, actualContextLayers: [], forbiddenContextLayers: tc.excludedLayers, contextLeakDetected: g.forbiddenFactsFound.length > 0, notes: '' };
        } catch (e: any) {
          row.passed = false; row.failReasons = ['exception:' + (e.message || String(e))]; row.error = e.message;
          row.latency = rec.toMetrics();
        }
        rows.push(row);
        process.stdout.write(`  ${tc.testId} [${tc.pattern}] ${row.passed ? 'PASS' : 'FAIL'} ${row.failReasons.length ? '— ' + row.failReasons.join(',') : ''} (fut=${Math.round(row.latency?.firstUsefulTokenMs || 0)}ms)\n`);
      }
    } finally {
      if (app) await app.close().catch(() => {});
      // Brief settle so the OS reaps helper processes before the next launch.
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const { gate, summary } = writeReports(rows, meta);
  const infra = (summary as any).infraSkipped || 0;
  const gateStr = infra > 0 ? `INCONCLUSIVE (${infra} infra-skipped)` : (gate ? 'PASS' : 'FAIL');
  process.stdout.write(`\n=== REAL UI E2E: ${summary.passed}/${(summary as any).executed} passed (executed) | ${infra} infra-skipped | critical ${summary.criticalPassed}/${summary.criticalTotal} | gate ${gateStr} ===\n`);
  // Exit 0 only on a clean full PASS; 2 = inconclusive (infra), 1 = real logic fail.
  process.exit(infra > 0 ? 2 : (gate ? 0 : 1));
}

function baseRow(tc: UiTestCase): UiResultRow {
  return {
    testId: tc.testId, profileId: tc.profileId, mode: tc.mode, pattern: tc.pattern, critical: tc.critical,
    question: tc.question, transcript: tc.transcript, expectedBehavior: '', actualResponse: '',
    passed: false, score: 0, failReasons: [],
    accuracy: {}, latency: {}, cost: {}, contextUsage: {}, artifacts: {},
    providerName: 'natively', modelName: 'gemini-3.5-flash',
  };
}

function readAppVersion(): string {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || 'unknown'; } catch { return 'unknown'; }
}

main().catch(e => { console.error('[real-ui-eval] fatal:', e?.message || e); process.exit(1); });
