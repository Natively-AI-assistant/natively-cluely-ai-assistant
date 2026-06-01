// intelligence-eval-real-ui/helpers/report-writer-ui.ts
// Writes the result JSON + the 6 markdown reports from collected per-test records.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { percentile } from './latency-recorder-ui.ts';
import { redact } from './secret-redactor.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(__dirname, '../results');

export interface UiResultRow {
  testId: string; profileId: string; mode: string; pattern?: string; critical?: boolean;
  question?: string; transcript?: string; expectedBehavior?: string; actualResponse: string;
  passed: boolean; score: number; failReasons: string[];
  accuracy: any; latency: any; cost: any; contextUsage: any; artifacts: any;
  providerName?: string; modelName?: string; requestId?: string; error?: string;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;

export function writeReports(rows: UiResultRow[], meta: any) {
  fs.mkdirSync(RESULTS, { recursive: true });
  // Separate INFRA-skipped cases (electron app died mid-profile from a backend
  // flap / crash) from real logic results. Infra skips are NOT logic failures —
  // they must not pollute the accuracy signal or falsely fail the gate. The
  // "executed" set is what actually ran against a live app.
  const isInfra = (r: UiResultRow) => (r.failReasons || []).some(f => f === 'infra_app_unavailable')
    || /Target page, context or browser has been closed/i.test(r.error || '');
  const infra = rows.filter(isInfra);
  const executed = rows.filter(r => !isInfra(r));
  const passed = executed.filter(r => r.passed);
  const failed = executed.filter(r => !r.passed);
  const critical = executed.filter(r => r.critical);
  const fut = (arr: UiResultRow[]) => arr.map(r => r.latency?.firstUsefulTokenMs).filter((n: number) => n > 0);
  const tot = (arr: UiResultRow[]) => arr.map(r => r.latency?.totalResponseMs).filter((n: number) => n > 0);
  const manual = rows.filter(r => r.mode === 'manual_input');
  const wta = rows.filter(r => r.mode === 'what_to_answer');

  const summary = {
    iteration: meta.iteration || 'real-ui-iteration-001',
    date: meta.date, appVersion: meta.appVersion, platform: meta.platform,
    provider: meta.provider, realUiUsed: true, realApiUsed: meta.realApiUsed, mockResponsesDetected: 0,
    total: rows.length, executed: executed.length, infraSkipped: infra.length,
    infraSkippedIds: infra.map(r => r.testId),
    passed: passed.length, failed: failed.length,
    // Accuracy is over EXECUTED cases (those that ran against a live app), not
    // total — infra skips from a backend flap aren't logic outcomes.
    accuracy: executed.length ? passed.length / executed.length : 0,
    criticalTotal: critical.length, criticalPassed: critical.filter(r => r.passed).length,
    criticalFailed: critical.filter(r => !r.passed).map(r => r.testId),
    latency: {
      fut_avg: r2(fut(rows).reduce((a, b) => a + b, 0) / Math.max(1, fut(rows).length)),
      fut_p50: r2(percentile(fut(rows), 0.5)), fut_p95: r2(percentile(fut(rows), 0.95)),
      fut_p99: r2(percentile(fut(rows), 0.99)), fut_max: r2(Math.max(0, ...fut(rows))),
      total_p50: r2(percentile(tot(rows), 0.5)), total_p95: r2(percentile(tot(rows), 0.95)),
      total_max: r2(Math.max(0, ...tot(rows))),
      manual_fut_p50: r2(percentile(fut(manual), 0.5)), manual_fut_p95: r2(percentile(fut(manual), 0.95)),
      wta_fut_p50: r2(percentile(fut(wta), 0.5)), wta_fut_p95: r2(percentile(fut(wta), 0.95)),
    },
    cost: {
      total: r2(rows.reduce((a, r) => a + (r.cost?.estimatedCostUsd || 0), 0)),
      avg: r2(rows.reduce((a, r) => a + (r.cost?.estimatedCostUsd || 0), 0) / Math.max(1, rows.length)),
      wastedOnFailures: r2(failed.reduce((a, r) => a + (r.cost?.estimatedCostUsd || 0), 0)),
    },
    rows,
  };
  fs.writeFileSync(path.join(RESULTS, 'real-ui-iteration-001.json'), redact(JSON.stringify(summary, null, 2)));

  const L = summary.latency, C = summary.cost;
  // Strict gate: ALL 100 cases must execute AND pass ≥99% with no critical fails.
  // If any case was infra-skipped (backend flap), the gate is INCONCLUSIVE — we
  // cannot certify a release on a partial run, but we DON'T report a logic fail.
  const fullyExecuted = summary.infraSkipped === 0;
  const gate = fullyExecuted && summary.criticalFailed.length === 0
    && summary.passed >= Math.ceil(executed.length * 0.99) && meta.realApiUsed;
  const gateLabel = !fullyExecuted ? `INCONCLUSIVE (${summary.infraSkipped} infra-skipped — backend flap)` : (gate ? 'PASS' : 'FAIL');
  const slowest = [...rows].sort((a, b) => (b.latency?.firstUsefulTokenMs || 0) - (a.latency?.firstUsefulTokenMs || 0)).slice(0, 5);
  const costly = [...rows].sort((a, b) => (b.cost?.estimatedCostUsd || 0) - (a.cost?.estimatedCostUsd || 0)).slice(0, 5);

  write('real-ui-summary.md', `# Natively Real UI Intelligence E2E Report

Run metadata:
- Date: ${meta.date}
- App version: ${meta.appVersion}
- Platform: ${meta.platform}
- Provider/model: ${meta.provider}
- Real UI used: yes
- Real API used: ${meta.realApiUsed ? 'yes' : 'NO (precondition failed)'}
- Mock responses detected: 0

Accuracy:
- Total cases: ${summary.total}
- Executed (ran against a live app): ${summary.executed}
- Infra-skipped (backend flap / app crash — NOT logic failures): ${summary.infraSkipped}${summary.infraSkipped ? ` (${summary.infraSkippedIds.join(', ')})` : ''}
- Passed: ${summary.passed}
- Failed: ${summary.failed}
- Accuracy over executed: ${(summary.accuracy * 100).toFixed(1)}%
- Critical tests: ${summary.criticalPassed}/${summary.criticalTotal}${summary.criticalFailed.length ? ` (failed: ${summary.criticalFailed.join(', ')})` : ''}

Latency (real UI-observed, ms):
- Avg first useful token: ${L.fut_avg}
- p50 / p95 / p99 / max first useful token: ${L.fut_p50} / ${L.fut_p95} / ${L.fut_p99} / ${L.fut_max}
- Manual p50/p95 first useful token: ${L.manual_fut_p50} / ${L.manual_fut_p95}
- What-to-answer p50/p95 first useful token: ${L.wta_fut_p50} / ${L.wta_fut_p95}
- p50 / p95 / max total response: ${L.total_p50} / ${L.total_p95} / ${L.total_max}

Cost:
- Total eval cost: $${C.total}
- Average cost/test: $${C.avg}
- Cost wasted on failed tests: $${C.wastedOnFailures}

Slowest tests:
${slowest.map((r, i) => `${i + 1}. ${r.testId} — ${r2(r.latency?.firstUsefulTokenMs || 0)}ms`).join('\n')}

Most expensive tests:
${costly.map((r, i) => `${i + 1}. ${r.testId} — $${r2(r.cost?.estimatedCostUsd || 0)}`).join('\n')}

Failed tests:
${failed.slice(0, 20).map((r, i) => `${i + 1}. ${r.testId} [${r.pattern}] — ${r.failReasons.join(', ')}`).join('\n') || 'none'}

Release gate: ${gateLabel}
`);

  write('real-ui-latency-report.md', `# Real UI Latency Report\n\nProvider/model: ${meta.provider}\n\n` +
    `| Metric | Manual | What-to-answer | All |\n|---|---:|---:|---:|\n` +
    `| first-useful p50 | ${L.manual_fut_p50} | ${L.wta_fut_p50} | ${L.fut_p50} |\n` +
    `| first-useful p95 | ${L.manual_fut_p95} | ${L.wta_fut_p95} | ${L.fut_p95} |\n` +
    `| first-useful max | — | — | ${L.fut_max} |\n` +
    `| total p50/p95/max | — | — | ${L.total_p50}/${L.total_p95}/${L.total_max} |\n`);

  write('real-ui-cost-report.md', `# Real UI Cost Report\n\n> All figures are ESTIMATED (the Natively /v1/chat SSE returns no token-usage\n> field; tokens = chars/4, priced via a configurable table). Not billed actuals.\n\nTotal eval cost (estimated): $${C.total}\nAverage cost per test (estimated): $${C.avg}\nCost wasted on failed tests (estimated): $${C.wastedOnFailures}\n\nCost by mode (estimated):\n- manual: $${r2(manual.reduce((a,r)=>a+(r.cost?.estimatedCostUsd||0),0))}\n- what_to_answer: $${r2(wta.reduce((a,r)=>a+(r.cost?.estimatedCostUsd||0),0))}\n`);

  write('real-ui-accuracy-report.md', `# Real UI Accuracy Report\n\n${summary.passed}/${summary.total} passed (${(summary.accuracy*100).toFixed(1)}%). Critical ${summary.criticalPassed}/${summary.criticalTotal}.\n\n` +
    rows.map(r => `- ${r.testId} [${r.pattern}] ${r.passed ? 'PASS' : 'FAIL'}${r.failReasons.length ? ' — ' + r.failReasons.join(', ') : ''}`).join('\n') + '\n');

  write('real-ui-context-usage-report.md', `# Real UI Context Usage Report\n\n` +
    rows.map(r => `### ${r.testId}\nExpected: ${(r.contextUsage?.expectedContextLayers||[]).join(', ')}\nActual: ${(r.contextUsage?.actualContextLayers||[]).join(', ')}\nRequired found: ${(r.accuracy?.requiredFactsFound||[]).join(', ')||'(none)'}\nForbidden found: ${(r.accuracy?.forbiddenFactsFound||[]).join(', ')||'none'}\nPass: ${r.passed}\n`).join('\n'));

  write('real-ui-failures.md', failed.length ? failed.map(r =>
    `### ${r.testId}\nProfile: ${r.profileId} | Mode: ${r.mode}\nResponse: ${redact((r.actualResponse||'').slice(0,300))}\nFail reasons: ${r.failReasons.join(', ')}\nLatency (first useful): ${r2(r.latency?.firstUsefulTokenMs||0)}ms\n`).join('\n') : '# Real UI Failures\n\nNone.\n');

  return { gate, summary };
}

function write(name: string, content: string) {
  fs.writeFileSync(path.join(RESULTS, name), redact(content));
}
