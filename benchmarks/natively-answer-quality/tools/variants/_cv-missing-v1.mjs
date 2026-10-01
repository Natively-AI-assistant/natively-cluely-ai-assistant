// I20 replay: on turns that HAVE documents, the verifier also lists what the material holds that answers the
// question and the draft left out, and the rewrite adds it.
import * as base from './_claimVerifier-i18.mjs';
export * from './_claimVerifier-i18.mjs';
const STEP2 = 'Step 2, after a line containing only "---"';
const MISSING = `Step 1b, one line starting "MISSING:" — each fact the material states that directly answers what was just asked and the draft leaves out or gets wrong: the exact figure, date, limit, condition, name or step. A few words each, separated by " | ". Only what the question needs; write "MISSING: none" when the draft already has it.
`;
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (opts.noDocuments || !p.includes(STEP2)) return p;
  return p.replace(STEP2, MISSING + STEP2).replace('A motive or event is dropped, not replaced.', 'A motive or event is dropped, not replaced. Each missing fact is worked into the reply in a clause, in the material\'s own figures, without making the reply longer than it needs to be.');
}
