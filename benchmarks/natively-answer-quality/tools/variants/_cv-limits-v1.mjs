// Replay only (on fix11). The list step files an honest LIMIT as an unsupported claim ("I can't confirm a credit on
// this call [promise]", "I can't confirm it as a freeze [past]", "We didn't measure anything about colonies [past]"),
// so the edit removes the draft's answer to a yes-or-no ask (DCC-036, DTEAM-006, DTEAM-026, SBSEM-006, SBSEM-007 — the
// last one fails its validator). Three narrow changes, no new step:
//  1. never-list gains "an honest limit" (not knowing / cannot confirm or promise yet) and what the request itself says;
//  2. "Never say you cannot speak to…" becomes "Never add…" (it is a rule for the edit, not for the draft);
//  3. Seminar: a study's scope is closed — "we did not measure X" is supported when the material describes the study
//     and X is not in it.
// Capability and policy limits ("I can't send a reset by text") stay listed: those were the invented restrictions.
import * as base from './_claimVerifier-fix11.mjs';
export * from './_claimVerifier-fix11.mjs';
const A1 = 'general knowledge; what the other person said; what the material states.';
const N1 = 'general knowledge; what the other person said or the request itself states; what the material states; an honest limit, that is saying they do not know something yet or cannot confirm or promise it yet ("I can\'t confirm a credit on this call", "I can\'t confirm that was agreed", "I don\'t know yet").';
const A2 = 'Never say you cannot speak to something, do not have it, or that it is not available;';
const N2 = 'Never add that you cannot speak to something, do not have it, or that it is not available;';
const A3 = 'A denial ("I haven\'t", "we don\'t") is a statement too.';
const N3 = A3 + ' The one exception is the scope of a study the material describes: that it did not measure, test or include something the material never mentions is supported, keep it.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  let p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  for (const a of [A1, A2, A3]) if (!p.includes(a)) throw new Error('anchor missing: ' + a.slice(0, 40));
  p = p.replace(A1, N1).replace(A2, N2);
  if (modeId === 'seminar') p = p.replace(A3, N3);
  return p;
}
