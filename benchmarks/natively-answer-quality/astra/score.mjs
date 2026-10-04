// Official score for an external judgment (spec §30-§31), computed in code.
// Weighted dimensions, then hard caps from flags, then deterministic-validator overrides (§24):
// a validator that PROVES the answer wrong caps it at 4 whatever the judge said.

export const WEIGHTS = {
  correctness: 0.17, grounding: 0.18, role_fidelity: 0.12, intent_fulfillment: 0.12, direct_usefulness: 0.12,
  realtime_usability: 0.10, naturalness: 0.05, cognitive_load: 0.04, information_density: 0.04, continuity: 0.03, mode_fit: 0.03,
};
export const DIMENSIONS = Object.keys(WEIGHTS);
export const FLAGS = ['major_factual_error', 'major_reasoning_error', 'arithmetic_error', 'pricing_error', 'code_incorrect',
  'unsupported_personal_claim', 'fabricated_behavioral_story', 'unsupported_company_claim', 'unsupported_policy_claim',
  'fabricated_meeting_history', 'unsupported_research_claim', 'missed_available_evidence', 'role_confusion', 'speaker_confusion',
  'coaching_instead_of_answer', 'visible_internal_reasoning', 'ai_epistemic_leak', 'reference_conflict_ignored', 'pi_leak',
  'cross_mode_context_leak', 'unsafe_commitment', 'important_question_unanswered', 'excessive_verbosity', 'insufficient_answer'];

/** Flags that carry a hard cap = the "hard fail" set used by every metric here. */
export const CAP_FLAGS = {
  major_factual_error: 4, major_reasoning_error: 4, arithmetic_error: 4, pricing_error: 4, code_incorrect: 4,
  unsupported_personal_claim: 5, fabricated_behavioral_story: 4,
  unsupported_company_claim: 4, unsupported_policy_claim: 4, unsafe_commitment: 4,
  role_confusion: 4, speaker_confusion: 4,
  unsupported_research_claim: null, // 3 in Seminar, else treated as a factual claim (5)
  pi_leak: 2, cross_mode_context_leak: 2,
  fabricated_meeting_history: 4,
};
/** Critical classes the spec wants at ~0 (§43). */
export const CRITICAL_FLAGS = ['unsupported_company_claim', 'unsupported_policy_claim', 'unsafe_commitment', 'pi_leak', 'cross_mode_context_leak', 'unsupported_research_claim', 'role_confusion', 'speaker_confusion'];

const clamp = (x) => Math.max(0, Math.min(10, Number.isFinite(Number(x)) ? Number(x) : 0));

export function officialScore(judgment, mode, validator = null) {
  const sc = judgment?.scores ?? {};
  let raw = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) raw += w * clamp(sc[k]);
  const flags = new Set((judgment?.hard_flags ?? []).filter((f) => FLAGS.includes(f)));
  // Deterministic truth outranks the judge (§24): a failed validator adds its flag.
  if (validator && validator.verdict === 'fail') for (const f of validator.flags ?? ['major_reasoning_error']) flags.add(f);
  const caps = [];
  for (const f of flags) {
    if (f === 'unsupported_research_claim') caps.push(mode === 'seminar' ? 3 : 5);
    else if (CAP_FLAGS[f] != null) caps.push(CAP_FLAGS[f]);
  }
  const overall = caps.length ? Math.min(raw, ...caps) : raw;
  return { raw: +raw.toFixed(3), overall: +overall.toFixed(3), capped: overall < raw, flags: [...flags], hard_fail: [...flags].some((f) => f in CAP_FLAGS) };
}

// ---- aggregate helpers ----
export const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
export function pct(v, p) {
  const a = [...v].sort((x, y) => x - y); if (!a.length) return null;
  const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r);
  return a[lo] + (a[hi] - a[lo]) * (r - lo);
}
export const median = (v) => pct(v, 50);
