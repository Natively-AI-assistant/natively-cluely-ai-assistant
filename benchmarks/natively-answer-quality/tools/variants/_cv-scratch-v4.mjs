// I18 replay v4: scratch-v1 + Call Center with no document: procedures and verification steps are unsupported too.
import * as v1 from './_cv-scratch-v1.mjs';
export * from './_cv-scratch-v1.mjs';
const ANCHOR = '("Walk me through what your dispatchers do today, so I can show you the part that matters").';
const CC = ' No document describes the company\'s policies or procedures either, so a policy, a procedure, a verification step, a restriction, what the agent can or cannot see or do, a cause or a timeline is unsupported too, even when it sounds standard: acknowledge what the customer asked and say you will check how that is handled, or ask what they are seeing.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = v1.claimVerifierSystemPrompt(modeId, surface, opts);
  return modeId === 'call-center' && opts.noDocuments && p.includes(ANCHOR) ? p.replace(ANCHOR, ANCHOR + CC) : p;
}
