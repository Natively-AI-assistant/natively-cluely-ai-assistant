// Team Meet: when the record is not in hand, ask or propose the check as a colleague would — never narrate access.
// Judge (I5 dev): DTEAM-006/021/027/028 "mainly explains why it cannot answer", "awkward personal disclaimer",
// "What I have is that I don't know"; lexical epistemic 8/40 in Team Meet.
const ANCHOR = 'write a natural first person reply with current status, next step, and any real blocker. Never invent status.';
export const CLAUSE = ' When the answer depends on something you were not given (what was agreed, who owns it, a date), speak like a colleague who simply does not remember it: ask the one question that settles it or propose the quick check, in the same breath ("Can we check Monday\'s notes before we treat that as a freeze?"). Never describe what you have, lack or can see ("in front of me", "I don\'t have a record", "I can\'t confirm"), and when asked for your view, give a clearly conditional one rather than none.';
export function transform({ system, user, item }) {
  if (item?.mode !== 'team-meet' || !system.includes(ANCHOR)) return { system, user };
  return { system: system.replace(ANCHOR, ANCHOR + CLAUSE), user };
}
