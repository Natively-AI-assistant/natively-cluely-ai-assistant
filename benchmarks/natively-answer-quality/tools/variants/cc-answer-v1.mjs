// Call Center: answer the gated ask with the rule that applies, then ask for the verification needed to act on it.
// Judge (I5 dev): DCC-018/027/028/029 repeated the verification checklist and never said what the refund, credit or
// goodwill rule is ("repeats verification without explaining the $20 limit").
const ANCHOR = 'Identity checks, refunds, credits, resets and escalation follow only the procedure the context states; without one, say you will check the right process rather than describing a typical one.';
export const CLAUSE = ' When the customer asks for something the procedure gates behind verification or approval (a refund, a credit, an account change), answer the ask in the same reply: say what the context\'s rule for it is in general terms (the window, the limit, the condition, who must approve), then ask for exactly what the procedure needs to act on it. Asking to verify again without saying the rule leaves the customer without an answer; stating the rule is not a promise that it applies to them.';
export function transform({ system, user, item }) {
  if (item?.mode !== 'call-center' || !system.includes(ANCHOR)) return { system, user };
  return { system: system.replace(ANCHOR, ANCHOR + CLAUSE), user };
}
