// Replay only (on fix11): ONLY the Seminar study-scope clause of I25, without the general "honest limit" exemption and
// without the "Never add" rewording. The judge read of I25 on the 44 limit-stating drafts was −0.02 (±0.24): keeping
// the hedges is not rewarded; the one objective defect (SBSEM-007's validator) is a Seminar matter.
import * as base from './_claimVerifier-fix11.mjs';
export * from './_claimVerifier-fix11.mjs';
const A3 = 'A denial ("I haven\'t", "we don\'t") is a statement too.';
const N3 = A3 + ' The one exception is the scope of a study the material describes: that it did not measure, test or include something the material never mentions is supported, keep it.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (modeId !== 'seminar') return p;
  if (!p.includes(A3)) throw new Error('anchor missing');
  return p.replace(A3, N3);
}
