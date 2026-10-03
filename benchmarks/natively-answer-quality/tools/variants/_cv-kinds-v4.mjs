// fix11 replay: fix10's verifier with Step 2 rules 3-4 reworded so the reply never names "the material", and a rail
// that refuses an edit which introduces a source word the draft did not use.
import * as base from './_claimVerifier-fix10.mjs';
export * from './_claimVerifier-fix10.mjs';
const R3 = '3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says the material gives both, names them, and says it needs confirming before anyone relies on it.';
const R4 = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: what the material does record about it (the dates, the role, the project, and for a question about a job what the job description says that job is), stated plainly, and nothing invented after it.';
const N3 = '3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it.';
const N4 = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: the plain facts about it that are stated (the dates, the role, the project; for a question about a job, what that job is), said as their own facts, and then stop: no reason invented, no promise to come back, no question.\nThe reply is spoken by them: it never says "the material", "the record", "my résumé says" or where a fact comes from.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (!p.includes(R3) || !p.includes(R4)) throw new Error('anchor missing');
  return p.replace(R3, N3).replace(R4, N4);
}
export const SOURCE_WORD_RE = /\b(?:the material|material (?:I have|gives|says|records|states)|(?:the|my) (?:r[eé]sum[eé]|profile|job description) (?:says|lists|shows|records|states|has)|on record|the record (?:shows|says))\b/i;
export function acceptVerifiedAnswer({ original, edited, material }) {
  const r = base.acceptVerifiedAnswer({ original, edited, material });
  if (r.reason === 'edited' && SOURCE_WORD_RE.test(r.text) && !SOURCE_WORD_RE.test(original)) return { accepted: false, changed: false, reason: 'source_exposed', text: original };
  return r;
}
