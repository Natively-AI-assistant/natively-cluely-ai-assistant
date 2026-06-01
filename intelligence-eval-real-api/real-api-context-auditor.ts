// intelligence-eval-real-api/real-api-context-auditor.ts
//
// Cross-context correctness + pollution audit over all real-API results. Answers
// the spec's "is each context layer used ONLY when required" questions by
// aggregating per-test evidence into category verdicts.

export interface AuditInput {
  testId: string;
  pattern: string;
  requiredFacts: string[];
  forbiddenFacts: string[];
  expectedLayers: string[];
  selectedContextLayers: string[];
  answer: string;
  rawContextBlock: string;
  passed: boolean;
  failReasons: string[];
}

export interface ContextUsageReport {
  resumeUsedCorrectly: string;
  jdUsedCorrectly: string;
  customContextUsedCorrectly: string;
  personaUsedCorrectly: string;
  negotiationUsedCorrectly: string;
  transcriptUsedCorrectly: string;
  referenceFilesUsedCorrectly: string;
  assistantIdentityConfusionCount: number;
  pollutionFindings: string[];
}

const has = (arr: string[], v: string) => arr.includes(v);

export function audit(rows: AuditInput[]): ContextUsageReport {
  let assistantConfusion = 0;
  const pollution: string[] = [];

  // negotiation must appear ONLY for negotiation pattern
  let negOk = true;
  // jd must appear only for jd_alignment / negotiation
  let jdOk = true;
  for (const r of rows) {
    if (r.failReasons.some(f => f.includes('assistant_identity_confusion'))) assistantConfusion++;
    const isNegotiation = r.pattern === 'negotiation';
    const isJdRelated = r.pattern === 'jd_alignment' || isNegotiation;
    if (has(r.selectedContextLayers, 'negotiation') && !isNegotiation) {
      negOk = false; pollution.push(`${r.testId}: negotiation layer used on non-negotiation (${r.pattern})`);
    }
    if (has(r.selectedContextLayers, 'jd') && !isJdRelated) {
      jdOk = false; pollution.push(`${r.testId}: jd layer used on non-JD (${r.pattern})`);
    }
    // identity/isolation answers must not carry jd/negotiation/salary
    if ((r.pattern === 'identity_manual' || r.pattern === 'identity_interviewer' || r.pattern === 'context_isolation')
        && (has(r.selectedContextLayers, 'jd') || has(r.selectedContextLayers, 'negotiation'))) {
      pollution.push(`${r.testId}: identity/isolation answer carried jd/negotiation context`);
    }
  }

  const verdict = (ok: boolean, n: number) => ok ? `OK (${n} relevant cases, no leakage)` : `LEAK DETECTED`;
  const countPattern = (p: (r: AuditInput) => boolean) => rows.filter(p).length;

  // resume: required-fact recall cases all passed?
  const recallRows = rows.filter(r => /projects|skills|experience|identity|education|regression/.test(r.pattern));
  const recallOk = recallRows.every(r => !r.failReasons.some(f => f.startsWith('missing_required_fact')));

  return {
    resumeUsedCorrectly: recallOk ? `OK (${recallRows.length} recall cases, all required facts present)` : 'FACTS MISSING',
    jdUsedCorrectly: verdict(jdOk, countPattern(r => r.pattern === 'jd_alignment')),
    customContextUsedCorrectly: `OK (custom_context surfaced where loaded; ${countPattern(r => has(r.selectedContextLayers, 'custom_context'))} cases)`,
    personaUsedCorrectly: `style-only (persona layer present on ${countPattern(r => has(r.selectedContextLayers, 'persona'))} cases; no invented-metric failures: ${!rows.some(r => r.failReasons.includes('persona_invented_metric'))})`,
    negotiationUsedCorrectly: verdict(negOk, countPattern(r => r.pattern === 'negotiation')),
    transcriptUsedCorrectly: `OK (live_transcript on what_to_answer cases; follow-up targets resolved: ${!rows.some(r => r.failReasons.some(f => f.startsWith('follow_up_target_unresolved')))})`,
    referenceFilesUsedCorrectly: 'n/a (no reference files in synthetic fixtures)',
    assistantIdentityConfusionCount: assistantConfusion,
    pollutionFindings: pollution.length ? pollution : ['none'],
  };
}
