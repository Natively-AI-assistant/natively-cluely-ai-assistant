// fix10 replay: the verifier tags what it lists by KIND and leaves current decisions, ownership, recommendations and
// small commitments alone; a conflict inside the material is surfaced, not resolved.
import * as base from './_claimVerifier-fix9.mjs';
export * from './_claimVerifier-fix9.mjs';
const START = '\nWork in two steps and output both.';
export const KINDS = `
Work in two steps and output both.
Step 1, one line starting "UNSUPPORTED:" — only the phrases of the draft that state AS FACT something the material does not state, each followed by its kind in square brackets, separated by " | ":
[past] something that already happened or is already true and that only a record can establish: what they did, led, built, measured or agreed, a number, a price, a policy, a procedure, a capability, a customer, a result;
[self] a fact about who they already are: an existing preference, habit, motive, feeling, strength or weakness, or when they are available;
[promise] a promise with consequences: money, a refund or credit, a price or discount, a contract term, a delivery date or deadline, a guarantee, what the product or the company will do.
Never list these, they are not claims that need a record: a decision or choice they make now ("let's do the pads today", "I can take this", "I'd go with REST here"); taking a task or offering to; a recommendation or professional judgment ("I'd shift the plan rather than re-plan it"); an ordinary small commitment ("I'll send that today", "I'll check and come back to you", "I'll stay on this with you"); general knowledge; what the other person said; what the material states.
Write "UNSUPPORTED: none" when there is nothing to list.
Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".
Step 2, after a line containing only "---" — the revised reply. Only the listed phrases change; every other sentence stays word for word, decisions, ownership and recommendations included. A [past] or [promise] phrase is removed, or said as something to confirm. A [self] phrase is removed and the reply goes on with what is true; it is replaced by a question only when nothing else would be left to say. When CONFLICT names two values, the reply says the material gives both and that it needs confirming, and does not assert either one.`;
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  const i = p.indexOf(START);
  if (i < 0) throw new Error('anchor missing');
  return p.slice(0, i) + KINDS;
}
