// Replay only (on fix12). The conflict rule re-opens a discrepancy the draft had already resolved correctly: two résumé
// versions, one explicitly older ("last updated November 2022"); the draft reports the newer figure, the edit says the
// drop "is given two ways" (DJOB-031 10.0 -> 7.3, DJOB-032). When the material itself marks one of the two as older,
// superseded or out of date, the newer one is the answer and there is no conflict to surface.
import * as base from './_claimVerifier-fix12.mjs';
export * from './_claimVerifier-fix12.mjs';
const A = 'both in a few words; otherwise "CONFLICT: none".';
const N = 'both in a few words; otherwise "CONFLICT: none". Two versions of one document, where the material marks one as older, superseded or out of date, are not a conflict: the newer one is the answer, write "CONFLICT: none".';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (!p.includes(A)) throw new Error('anchor missing');
  return p.replace(A, N);
}
