// Questions that ask the user to commit to something of their own (autopilot 2026-11-27): one pattern shared by the
// answer prompt's commitment notice and the claim verifier's Looking for work gate. Pure string work: no platform
// branches, same on macOS and Windows.

/**
 * A heard question that asks the user to COMMIT to something of their own: a preference, a plan, a number, a reason or
 * their job-search status ("what are your salary expectations?", "would you relocate?", "are you interviewing anywhere
 * else?", "why did you leave?"). Moved out of the composer (2026-11-27) so the answer prompt's commitment notice and
 * the claim verifier's gate share one pattern. "interviewing elsewhere" and "other offers" added the same day: the
 * autopilot baseline answered "Are you interviewing anywhere else right now?" with an invented status.
 */
export const COMMITMENT_QUESTION_RE = /\b(?:relocat\w*|mov(?:e|ing) (?:out )?(?:here|there|to)|commut\w*|in[- ]office|on-?site|hybrid|remote(?:ly)?|travel\w*|salary|base pay|compensation|pay(?:ing)? (?:range|expectations?)|in terms of (?:base|pay|salary|comp)|notice period|start date|when (?:can|could) you start|available to start|why (?:did|do|would) you (?:leave|want to leave)|why'?d you leave|why leave|reason for leaving|gap (?:in|on|before|after|between) (?:your|the) |(?:a |the |that |this )?gap (?:of|there)|what happened (?:there|then|during|in that|between)|time off|career break|between (?:jobs|roles)|why (?:the|a) (?:switch|change|move)|weakness|getting better at|(?:does|would) that work for you|are you (?:ok|okay|comfortable|open|willing) (?:with|to))\b/i;

/**
 * Job-search status, work authorisation, notice and current pay ("are you interviewing anywhere else?", "do you have other
 * offers?", "we can't sponsor visas", "current comp + notice"). Job modes only: in Sales "do
 * you have any other offers?" is about discounts, so this stays out of COMMITMENT_QUESTION_RE, which every mode's
 * commitment notice reads.
 */
export const JOB_SEARCH_STATUS_RE = /\b(?:interviewing (?:anywhere|elsewhere|with (?:other|anyone))|talking to (?:other|any other) (?:companies|teams)|other (?:interviews?|job offers?|offers?)|where else are you (?:interviewing|looking|applying)|authori[sz]ed to work|work(?:ing)? authori[sz]ation|right to work|(?:need|require|requiring)s? (?:visa )?sponsorship|sponsor (?:you|visas?|your visa)|(?:visa|immigration) (?:status|sponsorship)|(?:on|need) a (?:work )?visa|current (?:comp|compensation|salary|pay|base)|notice (?:period|time)|(?:your|my|giving|give|how much|weeks'?|weeks of) notice)\b/i;

/** Either shape, for the job modes (the claim verifier's Looking for work gate and the composer's job-mode notice). */
export function isCommitmentQuestion(question: string): boolean {
  const q = String(question ?? '');
  return COMMITMENT_QUESTION_RE.test(q) || JOB_SEARCH_STATUS_RE.test(q);
}
