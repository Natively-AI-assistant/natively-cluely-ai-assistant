// electron/llm/profileEvidenceValidator.ts
//
// Phase 6: deterministic, low-latency EVIDENCE validation for profile answers.
//
// Prompt rules ("never invent metrics") are not guarantees. This module inspects
// a generated profile answer against the EVIDENCE that grounded it (the resume/JD
// facts that were actually provided) and flags FABRICATED specifics the model
// added on its own:
//   - metrics it invented ("25% retention", "$2M revenue", "10x faster") that do
//     not appear in the evidence,
//   - companies it claimed to have worked at that are not in the evidence.
// It also COMPOSES the existing perspective / assistant-identity / false-refusal
// / salary-leak / profile-in-coding checks (ProfileOutputValidator) so callers
// have a single entry point.
//
// PERFORMANCE: pure regex + substring over the answer and evidence strings — tens
// of microseconds, no LLM, no I/O. Never logs raw profile content (callers log
// only the violation CODES). It runs only for profile answer types; technical /
// coding / sales / lecture answers (profileContextPolicy = forbidden) are NOT
// metric-checked (an O(n) or a 100ms benchmark in a coding answer is legitimate).

import type { AnswerType, OutputPerspective, VoicePerspective, ProfileContextPolicy, ContextLayer } from './AnswerPlanner';
import {
  validateProfileOutput,
  buildProfileRepairInstruction,
  type ProfileViolation,
  type ProfileViolationCode,
} from './ProfileOutputValidator';

export type EvidenceViolationCode = ProfileViolationCode | 'unsupported_metric' | 'unsupported_company';

export interface EvidenceViolation {
  code: EvidenceViolationCode;
  detail: string;
  severity: 'error' | 'warning';
}

export interface EvidenceValidationInput {
  answer: string;
  plan: {
    answerType: AnswerType;
    outputPerspective: OutputPerspective;
    voicePerspective?: VoicePerspective;
    profileContextPolicy?: ProfileContextPolicy;
    forbiddenContextLayers: ContextLayer[];
  };
  /** The grounding facts that were provided to the model (profile/JD block). */
  evidence: string;
  profileAvailable: boolean;
  candidateDirected: boolean;
}

export interface EvidenceValidationResult {
  ok: boolean;
  violations: EvidenceViolation[];
  errorCodes: EvidenceViolationCode[];
  /** Terse corrective instruction for a repair pass (content-free of profile data). */
  repairInstruction: string;
}

// HIGH-SIGNAL fabricated-metric shapes: percentages, currency amounts, k/m/b
// magnitudes, and multipliers. Deliberately EXCLUDES small bare integers and
// "N years/months" — those are legitimate inferences from dated experience and
// would false-positive. Each match is reduced to its digit run for evidence
// lookup so "25%" matches an evidence "25% boost".
const METRIC_RE = new RegExp(
  [
    '(?:\\$|₹|€|£)\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[kmb]?\\b', // $2M, ₹50,000, $150k
    '\\b\\d+(?:\\.\\d+)?\\s?%',                              // 25%, 3.5 %
    '\\b\\d+(?:\\.\\d+)?\\s?x\\b',                           // 10x
    '\\b\\d+(?:\\.\\d+)?\\s?(?:million|billion|m|b|k)\\b',   // 2 million, 500k
  ].join('|'),
  'gi',
);

// "I worked at X" / "at X" / "with X" / "for X" naming a proper-noun company.
// Conservative: only fires on an explicit employment verb + a capitalized name,
// so it won't flag generic "at scale" or "with React".
const COMPANY_RE = /\b(?:worked|interned|employed|was)\s+(?:at|for|with)\s+([A-Z][A-Za-z0-9&.]*(?:\s+[A-Z][A-Za-z0-9&.]*){0,3})/g;
const COMPANY_STOPWORDS = new Set(['I', 'The', 'A', 'An', 'My', 'Our', 'Scale', 'Least', 'Most', 'Times', 'Times,']);

// The metric's numeric token, normalised (commas stripped). "$2M"→"2", "25%"→"25".
const digitsOf = (s: string): string => (s.match(/\d[\d,]*(?:\.\d+)?/)?.[0] || '').replace(/,/g, '');

// Parse a string into the SET of distinct number tokens it contains, so we can
// test membership WITHOUT substring false-matches ("2" must not match "2024").
const numberTokens = (s: string): Set<string> =>
  new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(t => t.replace(/,/g, '')));

// Magnitude-aware candidate forms for a metric, so a value written one way in
// the answer matches the SAME value written differently in the evidence
// (code-review 2026-06-05, MEDIUM). "$2M" → {"2", "2000000"}; "150k" → {"150",
// "150000"}; "2 million" → {"2","2000000"}. Returns every form to test against
// the evidence token set — a hit on ANY form means the metric is grounded.
const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, million: 1e6, billion: 1e9, thousand: 1e3 };
const metricForms = (raw: string): string[] => {
  const num = digitsOf(raw);
  if (!num) return [];
  const forms = new Set<string>([num]);
  const suffix = (raw.toLowerCase().match(/(k|m|b|million|billion|thousand)\b/) || [])[1];
  if (suffix && MAGNITUDE[suffix]) {
    const expanded = Math.round(parseFloat(num) * MAGNITUDE[suffix]);
    if (Number.isFinite(expanded)) forms.add(String(expanded));
  }
  return [...forms];
};

const norm = (s: string): string => (s || '').toLowerCase();

// Answer types whose claims must be grounded (metrics/companies checked).
const GROUNDED_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer',
  // NOTE: negotiation_answer intentionally excluded — salary figures there come
  // from the negotiation strategy, not the resume evidence block.
]);

/**
 * Validate a profile answer against the evidence that grounded it. Composes the
 * perspective/identity/refusal/leak checks and adds fabricated-metric and
 * fabricated-company detection. Deterministic and fast.
 */
export function validateProfileEvidence(input: EvidenceValidationInput): EvidenceValidationResult {
  const { answer, plan, evidence, profileAvailable, candidateDirected } = input;
  const text = (answer || '').trim();

  // 1) Base perspective / identity / refusal / salary-leak / profile-in-coding.
  const base = validateProfileOutput({
    answer: text,
    plan: {
      answerType: plan.answerType,
      outputPerspective: plan.outputPerspective,
      forbiddenContextLayers: plan.forbiddenContextLayers,
    },
    profileAvailable,
    candidateDirected,
  });
  const violations: EvidenceViolation[] = base.violations.map((v: ProfileViolation) => ({ ...v }));

  // 2) Evidence checks — only for grounded profile answer types with a policy
  // that requires grounding. Technical/coding/sales/lecture (forbidden) skip
  // these: a number in a technical answer is legitimate, not a fabricated metric.
  const policy = plan.profileContextPolicy;
  const shouldCheckEvidence =
    GROUNDED_TYPES.has(plan.answerType) && policy !== 'forbidden' && text.length > 0;

  if (shouldCheckEvidence) {
    const ev = norm(evidence);
    const evNums = numberTokens(evidence);

    // 2a) Fabricated metrics — a specific %/$/×/magnitude in the answer whose
    // numeric token is absent from the evidence. Membership is magnitude-aware:
    // the metric is grounded if ANY of its forms ("2", "2000000" for "$2M")
    // appears in the evidence's number-token set, AND we also expand the evidence
    // magnitudes so an answer written as "2,000,000" matches an evidence "$2M".
    const evMetricForms = new Set<string>(evNums);
    for (const em of evidence.match(METRIC_RE) || []) for (const f of metricForms(em)) evMetricForms.add(f);
    const seenMetric = new Set<string>();
    for (const m of text.match(METRIC_RE) || []) {
      const d = digitsOf(m);
      if (!d || seenMetric.has(d)) continue;
      seenMetric.add(d);
      const grounded = metricForms(m).some(f => evMetricForms.has(f));
      if (!grounded) {
        violations.push({
          code: 'unsupported_metric',
          detail: `answer cited a specific metric ("${m.trim()}") absent from the grounded evidence`,
          severity: 'error',
        });
      }
    }

    // 2b) Fabricated employer — "worked at <Company>" not present in evidence.
    let cm: RegExpExecArray | null;
    COMPANY_RE.lastIndex = 0;
    const seenCo = new Set<string>();
    while ((cm = COMPANY_RE.exec(text)) !== null) {
      const co = cm[1].trim().replace(/[.,]$/, '');
      const first = co.split(/\s+/)[0];
      if (!co || COMPANY_STOPWORDS.has(co) || COMPANY_STOPWORDS.has(first)) continue;
      if (seenCo.has(co.toLowerCase())) continue;
      seenCo.add(co.toLowerCase());
      // Match if the full name OR its distinctive first token appears in evidence.
      if (!ev.includes(co.toLowerCase()) && !(first.length >= 4 && ev.includes(first.toLowerCase()))) {
        violations.push({
          code: 'unsupported_company',
          // employer claims are higher-stakes than a stray number, but the regex
          // can over-match casual phrasing → warning so it softens, not blocks.
          detail: `answer claimed employment at "${co}" which is not in the grounded evidence`,
          severity: 'warning',
        });
      }
    }
  }

  const errorCodes = violations.filter(v => v.severity === 'error').map(v => v.code);

  // Repair instruction: reuse the base builder, then add the metric/company line.
  const lines: string[] = [];
  const baseRepair = buildProfileRepairInstruction(base);
  if (baseRepair) lines.push(baseRepair.replace(/^Your previous answer.*?:\n/, ''));
  if (errorCodes.includes('unsupported_metric')) {
    lines.push('- Remove or soften any specific number, percentage, or dollar amount that is not in the provided profile facts. Use a qualitative phrase instead (e.g. "significantly improved").');
  }
  if (violations.some(v => v.code === 'unsupported_company')) {
    lines.push('- Only name companies that appear in the provided profile facts. Do not claim employment anywhere else.');
  }
  const repairInstruction = lines.length
    ? `Your previous answer broke these rules. Regenerate, fixing ONLY these:\n${lines.join('\n')}`
    : '';

  return { ok: errorCodes.length === 0, violations, errorCodes, repairInstruction };
}
