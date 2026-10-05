// Replay transform: a past event/reason of the user's own (why they left, what happened in a gap) gets its own
// notice instead of the preference one ("open or conditional" has no meaning for a past fact).
const OLD = '(This asks for the user\'s own preference, commitment or reason. Unless something above states the user\'s own answer, do not decide it for them: no yes or no, no reason, no number of their own. Answer so it stays true either way, open or conditional, naming what they would weigh or asking the next practical question. What the other side stated, such as a band, a schedule or relocation support, may be acknowledged.)';
export const PAST_RE = /\b(?:why (?:did|do|would) you (?:leave|want to leave)|why'?d you leave|why leave|reason for leaving|what made you (?:leave|decide to leave|move on)|gap (?:in|on|before|after|between) (?:your|the) |(?:a |the |that |this )?gap (?:of|there)|what happened (?:there|then|during|in that|between)|time off|career break|between (?:jobs|roles)|why (?:the|a) (?:switch|change|move)|what were you doing)\b/i;
export const NEW = '(This asks about the user\'s own past — what they did, why, or what happened. Unless something above records it, do not supply any of it: no reason, activity, circumstance or characterisation ("deliberate", "family", "freelance", "burnout", "a layoff"), and do not say it is missing. Say only what the evidence does record, as the user\'s own memory; if it records nothing, give one short natural line the user can say to begin in their own words, such as "Sure, happy to walk you through that period.", and stop.)';
export function transform({ system, user, item }) {
  if (!user.includes(OLD) || !PAST_RE.test(item?.question ?? '')) return { system, user };
  return { system, user: user.replace(OLD, NEW) };
}
