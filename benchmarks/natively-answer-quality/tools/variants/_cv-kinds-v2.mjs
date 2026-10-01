// fix10 replay v2: kinds-v1 with a mechanical Step 2 (listed phrases gone; unlisted text untouched; a conflict is
// never asserted either way; an emptied answer gets a holding line, not a question back).
import * as base from './_claimVerifier-fix9.mjs';
export * from './_claimVerifier-fix9.mjs';
const START = '\nWork in two steps and output both.';
const HANDBACK = 'Only when removing claims leaves nothing that answers the question, say what stays true and hand it back with one short, practical question about their side. When the reply still answers, add no question.\n';
export const KINDS = `
Work in two steps and output both.
Step 1, one line starting "UNSUPPORTED:" — only the phrases of the draft that state AS FACT something the material does not state, each followed by its kind in square brackets, separated by " | ":
[past] something that already happened or is already true and that only a record can establish: what they did, led, built, measured or agreed, a number, a price, a policy, a procedure, a capability, a customer, a result;
[self] a fact about who they already are: an existing preference, habit, motive, feeling, strength or weakness, or when they are available;
[promise] a promise with consequences: money, a refund or credit, a price or discount, a contract term, a delivery date or deadline, a guarantee, what the product or the company will do.
Never list these, they are not claims that need a record: a decision or choice they make now ("let's do the pads today", "I can take this", "I'd go with REST here"); taking a task or offering to; a recommendation or professional judgment ("I'd shift the plan rather than re-plan it"); an ordinary small commitment ("I'll send that today", "I'll check and come back to you", "I'll stay on this with you"); general knowledge; what the other person said; what the material states.
Write "UNSUPPORTED: none" when there is nothing to list.
Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".
Step 2, after a line containing only "---" — the revised reply, built by these rules in order:
1. Every phrase you listed is gone: none of them appears, in any wording.
2. Everything you did not list stays word for word, decisions, ownership, recommendations and small commitments included.
3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says the material gives both, names them, and says it needs confirming before anyone relies on it.
4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: what the material does record about it (the dates, the role, the project, and for a question about a job what the job description says that job is), stated plainly, and nothing invented after it.
If nothing was listed and there is no conflict, the revised reply is the draft unchanged.`;
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  const i = p.indexOf(START);
  if (i < 0 || !p.includes(HANDBACK)) throw new Error('anchor missing');
  return (p.slice(0, i) + KINDS).replace(HANDBACK, '');
}
