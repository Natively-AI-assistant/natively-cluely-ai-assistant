// E24: with the job posting as the only document, the story notice says whose record it is.
// The gate reads the packed evidence's own `authority`: a posting is in the evidence and no evidence item may
// establish a fact about the user (no USER_* authority). On those turns the notice is swapped; every other prompt is
// returned unchanged.
export const STORY = '# A story from the evidence\nTell it only with what the evidence states: the people, conflicts, events, numbers '
  + 'and outcomes. Do not add a stakeholder, a disagreement, a colleague, a reaction or a result the evidence does not '
  + 'name. If the evidence holds no story of the kind asked, say how the user handles that kind of situation, and '
  + 'mention a real project only for what the evidence says about it.';
export const POSTING_ONLY = '# The job posting is not the user\'s history\nThe only document above is the posting for the role they are applying '
  + 'to. It says what that job involves; it records nothing the user does or has done. Do not give the posting\'s duties, team, '
  + 'stack, systems or numbers as the user\'s own work, and invent no employer, title, project, colleague or figure for them. '
  + 'What the posting says about the role, the team or the process can be stated as what the posting says. Asked about their own '
  + 'role, background or a past project, give words that stay true without a record of it: an opening they complete with their '
  + 'real history, shaped toward what this role asks for, or how they approach that kind of work.';

export function inGate(user) {
  const tags = [...user.matchAll(/<evidence\b[^>]*>/g)].map((m) => m[0]);
  return user.includes(STORY) && tags.some((t) => /source_type="JOB_DESCRIPTION"/.test(t)) && !tags.some((t) => /authority="[^"]*USER_/.test(t));
}
export function transform({ system, user }) {
  return inGate(user) ? { system, user: user.replace(STORY, POSTING_ONLY) } : { system, user };
}
