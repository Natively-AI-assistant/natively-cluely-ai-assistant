// Replay only (on fix11). Call Center without a document: the no-policy clause also took away the agent's own honest
// answer to a yes-or-no ask ("I can't confirm a credit on this call") and a refusal to hand over another person's
// details, leaving the customer's question unanswered (DCC-036, DCC-013). Those are not invented policy.
import * as base from './_claimVerifier-fix11.mjs';
export * from './_claimVerifier-fix11.mjs';
const OLD = 'acknowledge what the customer asked and say you will check how that is handled, or ask what they are seeing.';
const NEW = OLD + ' Two things the draft may already say are not invented policy and stay word for word: that the agent cannot confirm or promise something on this call (it is the honest answer to "will I get it or not"), and that the agent will not hand over another person\'s name or details.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (modeId !== 'call-center' || !opts.noDocuments) return p;
  if (!p.includes(OLD)) throw new Error('anchor missing');
  return p.replace(OLD, NEW);
}
