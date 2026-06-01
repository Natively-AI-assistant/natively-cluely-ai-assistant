// intelligence-eval-real-api/write-real-api-reports.ts
// Generates the four markdown reports from the run summary. Never emits the key
// (the summary already carries only a fingerprint and redacted responses).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { percentile } from './real-api-latency-recorder.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.resolve(__dirname, 'results');

export function writeReports(s: any): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  const L = s.latency;
  const ca = s.contextAudit;
  const gate = !s.dryRun && s.realApiCalls + s.deterministicFastPathResponses === s.total && s.passed >= 99 && s.criticalFailed.length === 0 && ca.assistantIdentityConfusionCount === 0;

  // ── real-api-summary.md ────────────────────────────────────────────────────
  fs.writeFileSync(path.join(resultsDir, 'real-api-summary.md'), `# Real API Natively Intelligence E2E Report

${s.dryRun ? '> ⚠️ DRY RUN — no provider calls were made. This is harness validation, NOT a production proof.\n' : ''}
Endpoint: \`${s.endpoint}\`
API key: ${s.apiKeyFingerprint} (redacted)

Total tests: ${s.total}
Passed: ${s.passed}
Failed: ${s.failed}
Overall accuracy: ${(s.accuracy * 100).toFixed(1)}%

Real API usage:
- Real API sessions created: ${s.realApiSessionsCreated}
- Real streaming responses: ${s.realApiCalls}
- Provider-backed responses: ${s.providerBackedResponses}
- Deterministic fast-path responses: ${s.deterministicFastPathResponses}
- Mock/stub responses detected: ${s.mockResponsesDetected}

Critical tests: ${s.criticalPassed}/${s.criticalTotal}${s.criticalFailed.length ? ` (failed: ${s.criticalFailed.join(', ')})` : ''}

Latency (real, ms):
- Manual factual p50/p95 first useful token: ${L.manual_factual_first_useful_p50}/${L.manual_factual_first_useful_p95}
- Manual LLM p50/p95 first useful token: ${L.manual_llm_first_useful_p50}/${L.manual_llm_first_useful_p95}
- What-to-answer p50/p95 first useful token: ${L.wta_first_useful_p50}/${L.wta_first_useful_p95}
- What-to-answer extraction p95: ${L.wta_extraction_p95}
- Total response p50/p95: ${L.total_response_p50}/${L.total_response_p95}

Top failures:
${s.failures.slice(0, 5).map((f: any, i: number) => `${i + 1}. ${f.testId} [${f.pattern}] — ${f.reasons.join(', ')}${f.error ? ` (error: ${f.error})` : ''}`).join('\n') || 'none'}

Context pollution findings:
${ca.pollutionFindings.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}

Provider/network bottlenecks:
${s.dryRun ? '1. (dry run — no provider timing)' : `1. First-useful-token is dominated by provider prefill (model: ${s.results.find((r:any)=>r.providerName)?.providerName || 'n/a'})\n2. Network RTT to ${s.endpoint}\n3. n/a`}

Release gate: ${gate ? 'PASS' : 'FAIL'}${s.dryRun ? ' (dry-run cannot pass by design)' : ''}
`);

  // ── real-api-latency-report.md ─────────────────────────────────────────────
  const categories: Record<string, (r: any) => boolean> = {
    manual_identity: r => r.mode === 'manual_input' && /identity/.test(r.pattern),
    manual_projects: r => r.mode === 'manual_input' && /projects|regression/.test(r.pattern),
    manual_skills: r => r.mode === 'manual_input' && /skill/.test(r.pattern),
    manual_jd_fit: r => r.mode === 'manual_input' && r.pattern === 'jd_alignment',
    manual_negotiation: r => r.mode === 'manual_input' && /negotiation|persona/.test(r.pattern),
    what_to_answer_identity: r => r.mode === 'what_to_answer' && /identity|intro/.test(r.pattern),
    what_to_answer_projects: r => r.mode === 'what_to_answer' && /projects/.test(r.pattern),
    what_to_answer_followup: r => r.mode === 'what_to_answer' && /follow/.test(r.pattern),
    what_to_answer_jd_fit: r => r.mode === 'what_to_answer' && r.pattern === 'jd_alignment',
    what_to_answer_negotiation: r => r.mode === 'what_to_answer' && r.pattern === 'negotiation',
  };
  let latMd = `# Real API Latency Report\n\n${s.dryRun ? '> DRY RUN — provider timing is zero; this validates plumbing only.\n\n' : ''}Endpoint: \`${s.endpoint}\`\n\n`;
  for (const [name, pred] of Object.entries(categories)) {
    const rows = s.results.filter(pred);
    if (!rows.length) { latMd += `## ${name}\n(no cases)\n\n`; continue; }
    const f = (field: string, q: number) => percentile(rows.map((r: any) => r[field]).filter((n: number) => n >= 0), q);
    const slowest = [...rows].sort((a, b) => b.firstUsefulTokenMs - a.firstUsefulTokenMs).slice(0, 5);
    latMd += `## ${name}\ncount: ${rows.length}\n`
      + `p50/p95 first byte: ${f('firstByteMs', 0.5)}/${f('firstByteMs', 0.95)}ms\n`
      + `p50/p95 first token: ${f('firstTokenMs', 0.5)}/${f('firstTokenMs', 0.95)}ms\n`
      + `p50/p95 first useful token: ${f('firstUsefulTokenMs', 0.5)}/${f('firstUsefulTokenMs', 0.95)}ms\n`
      + `p50/p95 total: ${f('totalResponseMs', 0.5)}/${f('totalResponseMs', 0.95)}ms\n`
      + `slowest 5: ${slowest.map((r: any) => `${r.testId}=${r.firstUsefulTokenMs}ms`).join(', ')}\n`
      + `likely bottleneck: ${s.dryRun ? 'n/a (dry run)' : rows.some((r: any) => r.responsePath === 'provider_streaming') ? 'provider prefill + network' : 'deterministic (no provider)'}\n\n`;
  }
  fs.writeFileSync(path.join(resultsDir, 'real-api-latency-report.md'), latMd);

  // ── real-api-context-usage-report.md ───────────────────────────────────────
  let ctxMd = `# Real API Context Usage Report\n\n`;
  for (const r of s.results) {
    ctxMd += `### ${r.testId} (${r.pattern})\n`
      + `Mode: ${r.mode} | path: ${r.responsePath} | intent: ${r.detectedIntent} | speaker: ${r.detectedSpeaker}\n`
      + `Selected context: ${r.selectedContextLayers.join(', ') || '(none)'}\n`
      + `Required facts found: ${r.requiredFactsFound.join(', ') || '(none required)'}\n`
      + `Missing facts: ${r.missingRequiredFacts.join(', ') || 'none'}\n`
      + `Forbidden facts present: ${r.forbiddenFactsFound.join(', ') || 'none'}\n`
      + `Context pollution: ${r.contextPollutionFlags.join(', ') || 'none'}\n`
      + `Pass: ${r.passed}\n\n`;
  }
  ctxMd += `## Summary\n`
    + `Resume used correctly: ${ca.resumeUsedCorrectly}\n`
    + `JD used correctly: ${ca.jdUsedCorrectly}\n`
    + `Custom context used correctly: ${ca.customContextUsedCorrectly}\n`
    + `Persona used correctly: ${ca.personaUsedCorrectly}\n`
    + `Negotiation used correctly: ${ca.negotiationUsedCorrectly}\n`
    + `Transcript used correctly: ${ca.transcriptUsedCorrectly}\n`
    + `Reference files used correctly: ${ca.referenceFilesUsedCorrectly}\n`
    + `Assistant identity confusion count: ${ca.assistantIdentityConfusionCount}\n`;
  fs.writeFileSync(path.join(resultsDir, 'real-api-context-usage-report.md'), ctxMd);

  // ── real-api-failures.md ───────────────────────────────────────────────────
  let failMd = `# Real API Failures\n\n`;
  if (!s.failures.length) failMd += 'No failures.\n';
  for (const f of s.failures) {
    const r = s.results.find((x: any) => x.testId === f.testId);
    failMd += `### ${f.testId}\n`
      + `Profile: ${r?.profileId} | Mode: ${r?.mode} | Pattern: ${f.pattern}\n`
      + `Actual response: ${(r?.rawResponse || '').slice(0, 300)}\n`
      + `Required facts missing: ${r?.missingRequiredFacts.join(', ') || 'none'}\n`
      + `Forbidden facts present: ${r?.forbiddenFactsFound.join(', ') || 'none'}\n`
      + `Detected context layers: ${r?.selectedContextLayers.join(', ')}\n`
      + `Latency (first useful): ${r?.firstUsefulTokenMs}ms\n`
      + `Fail reasons: ${f.reasons.join(', ')}\n`
      + `Root cause guess: ${rootCause(f.reasons)}\n\n`;
  }
  fs.writeFileSync(path.join(resultsDir, 'real-api-failures.md'), failMd);
}

function rootCause(reasons: string[]): string {
  if (reasons.includes('assistant_identity_confusion')) return 'Model answered as the assistant instead of the candidate — system prompt / identity guard issue.';
  if (reasons.some(r => r.startsWith('missing_required_fact'))) return 'Grounded context did not reach the model or model omitted the fact — check orchestrator routing for this intent.';
  if (reasons.some(r => r.startsWith('forbidden_fact'))) return 'Context pollution — an irrelevant layer leaked into grounding/answer.';
  if (reasons.includes('dry_run_no_provider_answer')) return 'Dry run: provider answer not generated (run with a real key).';
  if (reasons.some(r => r.startsWith('latency'))) return 'Provider/network latency exceeded budget.';
  return 'See fail reasons.';
}
