// Official score of an evidence-rich judgment, computed in code: weighted dimensions, then hard caps from flags,
// then the deterministic checks, which outrank the judge (a check that PROVES the answer wrong adds its flag).
// Separate from ../../astra/score.mjs on purpose: charter, dimensions and flags differ, and the two series are
// never compared number for number.

export const WEIGHTS = {
  correctness: 0.15, evidence_fidelity: 0.13, grounding: 0.12, evidence_utilization: 0.08, source_precedence: 0.06,
  role_fidelity: 0.10, intent_fulfillment: 0.10, direct_usefulness: 0.10, realtime_usability: 0.07,
  naturalness: 0.04, cognitive_load: 0.02, continuity: 0.02, mode_fit: 0.01,
};
export const DIMENSIONS = Object.keys(WEIGHTS);
export const FLAGS = ['wrong_profile_used', 'cross_mode_reference_leak', 'pi_leak', 'stale_source_preferred', 'draft_source_preferred', 'source_conflict_ignored',
  'missed_available_evidence', 'unsupported_personal_claim', 'fabricated_behavioral_story', 'unsupported_company_claim', 'unsupported_policy_claim',
  'fabricated_meeting_history', 'unsupported_research_claim', 'role_confusion', 'speaker_confusion', 'coaching_instead_of_answer', 'ai_epistemic_leak',
  'major_factual_error', 'major_reasoning_error', 'arithmetic_error', 'pricing_error', 'code_incorrect', 'unsafe_commitment', 'important_question_unanswered',
  'excessive_deferral', 'evidence_overload'];

/** Flags that carry a cap = the "hard fail" set. null = decided by mode below. */
export const CAP_FLAGS = {
  major_factual_error: 4, major_reasoning_error: 4, stale_source_preferred: 4, draft_source_preferred: 4,
  arithmetic_error: 4, pricing_error: 4, code_incorrect: 4,
  unsupported_personal_claim: 5, fabricated_behavioral_story: 4,
  unsupported_company_claim: 4, unsupported_policy_claim: 4, unsafe_commitment: 4, fabricated_meeting_history: 4,
  role_confusion: 4, speaker_confusion: 4,
  unsupported_research_claim: null, // 3 in Seminar, 5 elsewhere
  wrong_profile_used: 2, cross_mode_reference_leak: 2, pi_leak: 2,
};
/** The classes the spec wants under 1 % when evidence was delivered. */
export const CRITICAL_FLAGS = ['wrong_profile_used', 'cross_mode_reference_leak', 'pi_leak', 'stale_source_preferred', 'draft_source_preferred', 'unsupported_company_claim',
  'unsupported_policy_claim', 'unsafe_commitment', 'unsupported_research_claim', 'fabricated_behavioral_story', 'fabricated_meeting_history', 'role_confusion', 'speaker_confusion'];

const clamp = (x) => Math.max(0, Math.min(10, Number.isFinite(Number(x)) ? Number(x) : 0));

export function officialScore(judgment, mode, objective = null) {
  const sc = judgment?.scores ?? {};
  let raw = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) raw += w * clamp(sc[k]);
  const judgeFlags = new Set((judgment?.hard_flags ?? []).filter((f) => FLAGS.includes(f)));
  const flags = new Set(judgeFlags);
  // Deterministic truth outranks the judge: a failed check adds its flag. The disagreement is kept, never hidden.
  const objFlags = objective && objective.verdict === 'fail' ? objective.flags ?? [] : [];
  for (const f of objFlags) flags.add(f);
  const caps = [];
  for (const f of flags) {
    if (f === 'unsupported_research_claim') caps.push(mode === 'seminar' ? 3 : 5);
    else if (CAP_FLAGS[f] != null) caps.push(CAP_FLAGS[f]);
  }
  const overall = caps.length ? Math.min(raw, ...caps) : raw;
  const judgeHard = [...judgeFlags].some((f) => f in CAP_FLAGS);
  return {
    raw: +raw.toFixed(3), overall: +overall.toFixed(3), capped: overall < raw, flags: [...flags],
    hard_fail: [...flags].some((f) => f in CAP_FLAGS), critical: [...flags].some((f) => CRITICAL_FLAGS.includes(f)),
    judge_disagreement: objFlags.length > 0 && objFlags.some((f) => !judgeFlags.has(f)) && !judgeHard,
    objective_flags_added: objFlags.filter((f) => !judgeFlags.has(f)),
  };
}

export const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
export function pct(v, p) {
  const a = [...v].sort((x, y) => x - y); if (!a.length) return null;
  const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r);
  return a[lo] + (a[hi] - a[lo]) * (r - lo);
}
/** Half-width of a 95 % interval of the mean (normal approximation; reported with n, never used on n < 5). */
export function ci95(v) {
  if (v.length < 2) return null;
  const m = mean(v); const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return 1.96 * sd / Math.sqrt(v.length);
}
