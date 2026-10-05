// Replay only (on fix12). Call Center with NO policy document. The capped answers still carry an invented procedure
// the pass left in — "Before I do anything, I need to verify the account…", "Can I get your account number so I can
// pull that up?" — or drop the honest answer to a yes-or-no ask. The judge's expected behaviour on these (dev, 7 of 7
// hard fails without a document) is one shape: name what was asked, say plainly what cannot be confirmed yet, say
// exactly what will be checked — "I can't confirm a refund for today yet. I'll check whether a refund or credit is
// available for this issue." — and no verification step, team, time or access claim the material does not state.
import * as base from './_claimVerifier-fix12.mjs';
export * from './_claimVerifier-fix12.mjs';
const OLD = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: the plain facts about it that are stated (the dates, the role, the project; for a question about a job, what that job is), said as their own facts, and nothing invented after it.';
export const CC_RULE_4 = '4. No document gives this company\'s policies, so the revised reply has only these parts, in this order. One clause that names what the customer asked for or is upset about, in their own terms (both demands if there are two; the amounts if they gave them). If they asked whether or when something will happen, a plain statement that it cannot be confirmed yet. Then what will be checked, named specifically ("whether a refund or credit is available for today", "whether that can be done on this call"). The reply does not ask for an account number, a name, a date of birth or any other verification detail, does not name a team, a form or a step, does not promise a time or an outcome, and does not say what staff can or cannot see or do, unless the material states it. A question that helps diagnose the fault itself ("which light is it showing?") may stay.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (modeId !== 'call-center' || !opts.noDocuments) return p;
  if (!p.includes(OLD)) throw new Error('anchor missing');
  return p.replace(OLD, CC_RULE_4);
}
