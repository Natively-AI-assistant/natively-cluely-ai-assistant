// I18 replay v3: scratch-v1 + the verifier also runs on Team Meet and Recruiting turns.
import * as v1 from './_cv-scratch-v1.mjs';
export * from './_cv-scratch-v1.mjs';
const EXTRA = {
  'team-meet': ['a meeting participant is about to say aloud to colleagues', 'the speaker, their team, its past decisions, owners, dates, vendors or reasons'],
  recruiting: ['a recruiter or interviewer is about to say aloud to a candidate', 'the recruiter, the role, the team, the company or its terms'],
};
export function claimVerifierKind(input) {
  if (EXTRA[input.modeId] && !/```/.test(String(input.draft ?? ''))) return 'meeting';
  return v1.claimVerifierKind(input);
}
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  let p = v1.claimVerifierSystemPrompt(modeId, surface, opts);
  if (EXTRA[modeId]) p = p.replace('the user is about to say aloud', EXTRA[modeId][0]).replace('the speaker themselves', EXTRA[modeId][1]).replace('the user themselves', EXTRA[modeId][1]);
  return p;
}
