// E15: the typed-question perspective note, inserted where the composer would put it (end of the # Question section).
const ROLES = {
  recruiting: { speaker: 'the candidate', user: 'the recruiter (interviewer) you are helping' },
  sales: { speaker: 'the prospect', user: 'the seller you are helping' },
  'call-center': { speaker: 'the customer', user: 'the support agent you are helping' },
  'looking-for-work': { speaker: 'the interviewer', user: 'the candidate you are answering for' },
  'technical-interview': { speaker: 'the interviewer', user: 'the candidate you are answering for' },
  seminar: { speaker: 'an examiner or audience member', user: 'the presenter you are answering for' },
  'team-meet': { speaker: 'a colleague in the meeting', user: 'the user you are answering for' },
  lecture: { speaker: 'the lecturer', user: 'the student you are helping' },
};
export function typedQuestionPerspective(modeId) {
  const r = ROLES[modeId];
  if (!r) return '\n(Typed to you privately by the user. Answer the user directly: "you" means the user. Do not phrase the reply as a line addressed to someone else unless the user asks for words to say.)';
  return `\n(Typed to you privately by ${r.user}; ${r.speaker} cannot see or hear it. Answer the user: "you" means the user, and ${r.speaker} is spoken about, never spoken to. If the user needs words to say, give the fact first and then the line, marked as what to say.)`;
}
export function transform({ system, user, item }) {
  const at = user.indexOf('# Question\n'); if (at < 0) return { system, user };
  const end = user.indexOf('\n\n', at); const cut = end < 0 ? user.length : end;
  return { system, user: user.slice(0, cut) + typedQuestionPerspective(item.mode) + user.slice(cut) };
}
