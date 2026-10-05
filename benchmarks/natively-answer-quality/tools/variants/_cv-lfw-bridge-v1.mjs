// Replay only (on fix12). Looking for work, a question the material cannot answer (why leave, a failure story, a
// weakness, the gap, the outlook). Rule 4 today yields a holding line or a bare restatement: "I'm weighing what comes
// next, and I'll come back to you on that" (6.2), "I finished at Cindervale in January and started at Hollowbrook in
// June." (8.1). The judge's expected behaviour on all 13 dev items of this class is the same recipe: the documented
// facts closest to the question, then ONE forward-looking or conditional sentence that claims nothing about their
// past or wishes ("connect the settlement work to this role's payments and ledger ownership", "describe it as an
// approach you would take — not as documented events", "a natural next step rather than an established ambition").
// I23 (charter v1) reframed the motive as a desire ("what draws me to this role") and was capped; this does not.
import * as base from './_claimVerifier-fix12.mjs';
export * from './_claimVerifier-fix12.mjs';
const OLD = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: the plain facts about it that are stated (the dates, the role, the project; for a question about a job, what that job is), said as their own facts, and nothing invented after it.';
export const LFW_RULE_4 = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back, do not promise to come back on it, and do not stop at a restatement of dates. Answer with what the material does give, in two moves. First, the stated facts closest to the question, said as their own facts: the dates, the role, the project, a problem the material documents and how it was fixed. Then ONE sentence that carries the answer forward and claims nothing about their past, their feelings or what they want: for a reason or a motive, how that documented work compares with what this role covers, using a responsibility the job description states; for a story or a habit the material does not hold, the approach they would take, said as conditional ("the way I\'d handle that is…"); for a plan or an outlook, the natural next step from the documented work, said as a possibility; for a weakness, an area the material itself shows as limited ("some TypeScript"). Only for pay, a start date, relocation or another preference nothing states: one short sentence that they will confirm it.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (modeId !== 'looking-for-work') return p;
  if (!p.includes(OLD)) throw new Error('anchor missing');
  return p.replace(OLD, LFW_RULE_4);
}
