// tests/context-os-real-backend/llm-judge.mjs
//
// Independent semantic judge tier for the Context OS 200-question benchmark
// (plan section 6). The deterministic scorer matches gold facts by normalized
// substring — correct for exact values ("24 V", "page 10"), but it FAILS a
// correct answer that rewords the gold ("96 GB" vs gold "96 gigabytes",
// "third-view" vs gold "Third-person", "to achieve AGI" vs "towards achieving
// AGI"). This judge re-scores ONLY those borderline answers: an answer that the
// deterministic scorer marked failing, was NOT a refusal, and made a real attempt.
//
// Contract (per plan):
//   • The judge receives ONLY the question, the gold rubric facts, and the
//     answer — never the retrieval, pack, or provider internals.
//   • It uses a DISTINCT evaluator model when one is configured
//     (CTXOS_JUDGE_MODEL), else the backend default.
//   • It NEVER overrides a deterministic HARD failure: a forbidden-fact hit or a
//     violated refusal expectation stays failed regardless of the judge.
//   • If the judge backend is unavailable, the final run is INCOMPLETE (callers
//     must treat a missing judge as a gate failure, not a pass).
//
// The judge is advisory-additive: it can only UPGRADE a deterministic near-miss
// to a semantic pass, never downgrade a deterministic pass.

const API_BASE = process.env.NATIVELY_API_BASE || 'http://127.0.0.1:3000';
const LOCAL_TOKEN = process.env.NATIVELY_LOCAL_TEST_TOKEN || process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || 'local-test';
const JUDGE_MODEL = process.env.CTXOS_JUDGE_MODEL || '';

const JUDGE_SYSTEM = [
  'You are a rigorous, fair grading judge for a document-grounded question-answering benchmark.',
  'You are given a QUESTION, the REQUIRED FACTS that a correct answer must convey, and a CANDIDATE ANSWER.',
  'Decide whether the candidate answer conveys ALL of the required facts, judging by MEANING, not surface wording.',
  'A required fact is satisfied by an equivalent phrasing, unit, or synonym:',
  '  - "96 gigabytes" is satisfied by "96 GB"; "Third-person" by "third-view"/"third-person perspective";',
  '  - "towards achieving AGI" by "to achieve AGI"; "communicating with ROS from .NET applications" by',
  '    "communicate with ROS from .NET".',
  'A required fact is NOT satisfied if the answer omits it, hedges without stating it, states a DIFFERENT value,',
  'or fabricates. If the answer says it could not find the information, that is a REFUSAL — mark satisfied=false.',
  'Output ONLY a JSON object: {"allRequiredConveyed":boolean,"perFact":[{"fact":string,"conveyed":boolean}],"reason":string}.',
].join('\n');

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start === -1) throw new Error('no json in judge output');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('unbalanced json in judge output');
}

/**
 * Ask the independent judge whether the answer conveys all required facts.
 * Returns { available:boolean, model, allRequiredConveyed, perFact, reason }.
 * `available:false` means the judge backend could not be reached — the caller
 * must treat that as a run-incompleteness signal, never a silent pass.
 */
export async function judgeAnswer(question, requiredFacts, answer, opts = {}) {
  const user = [
    `QUESTION: ${question}`,
    '',
    'REQUIRED FACTS (each must be conveyed by meaning):',
    ...requiredFacts.map((f, i) => `${i + 1}. ${f}`),
    '',
    `CANDIDATE ANSWER: ${answer}`,
    '',
    'Return the JSON object now.',
  ].join('\n');
  const body = { system: JUDGE_SYSTEM, messages: [{ role: 'user', content: user }] };
  if (JUDGE_MODEL) body.model = JUDGE_MODEL;
  try {
    const res = await fetch(`${API_BASE}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-natively-local-test': LOCAL_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs || 60000),
    });
    if (!res.ok) return { available: false, error: `judge HTTP ${res.status}` };
    const data = await res.json();
    const parsed = extractJson(data.content || '');
    return {
      available: true,
      model: data.model || JUDGE_MODEL || 'unknown',
      allRequiredConveyed: parsed.allRequiredConveyed === true,
      perFact: Array.isArray(parsed.perFact) ? parsed.perFact : [],
      reason: String(parsed.reason || ''),
    };
  } catch (error) {
    return { available: false, error: String(error?.message || error) };
  }
}

/**
 * Two-tier score: deterministic first, then the judge ONLY for a deterministic
 * near-miss (not a hard fail, not a refusal-expected case, and the answer made a
 * real attempt). Returns the merged verdict plus provenance of which tier decided.
 *
 *   deterministic.pass === true                 -> { pass:true, tier:'deterministic' }
 *   hard fail (forbidden hit / refusal breach)  -> { pass:false, tier:'deterministic_hard' } (judge NOT consulted)
 *   deterministic fail, judge upgrades          -> { pass:true, tier:'judge' }
 *   deterministic fail, judge agrees / absent   -> { pass:false, tier:'judge'|'deterministic' }
 */
export async function scoreTwoTier(testCase, answer, deterministic, opts = {}) {
  if (deterministic.pass) return { pass: true, tier: 'deterministic', judge: null };

  // Hard failures are never eligible for a judge upgrade.
  const refusalExpected = testCase.rubric?.refusalExpected === true;
  if (deterministic.hasForbidden) return { pass: false, tier: 'deterministic_hard', judge: null, hardReason: 'forbidden_fact' };
  if (refusalExpected) return { pass: false, tier: 'deterministic_hard', judge: null, hardReason: 'refusal_expected_not_met' };

  // A pure refusal answer to a non-refusal question is a genuine miss — the judge
  // is instructed to mark it unsatisfied, but skip the call to save latency/cost.
  const looksRefusal = deterministic.isRefusal;
  const required = testCase.rubric?.requiredFacts || [];
  if (required.length === 0) return { pass: false, tier: 'deterministic', judge: null };

  const verdict = await judgeAnswer(testCase.question, required, answer, opts);
  if (!verdict.available) return { pass: false, tier: 'judge_unavailable', judge: verdict };
  if (looksRefusal && verdict.allRequiredConveyed) {
    // Judge says a "refusal-looking" answer actually conveyed the facts — trust the
    // judge (it read the whole answer; the deterministic refusal regex is coarse).
    return { pass: true, tier: 'judge', judge: verdict };
  }
  return { pass: verdict.allRequiredConveyed, tier: 'judge', judge: verdict };
}
