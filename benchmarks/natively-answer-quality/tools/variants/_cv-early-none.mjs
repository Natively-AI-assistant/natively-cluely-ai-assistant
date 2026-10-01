// I24 replay: when nothing is unsupported the verifier writes only "UNSUPPORTED: none" and stops (no rewrite).
import * as base from './_claimVerifier-i18.mjs';
export * from './_claimVerifier-i18.mjs';
const A = 'Write "UNSUPPORTED: none" when there is nothing.';
const B = 'When there is nothing, write only "UNSUPPORTED: none" and stop there: no second step.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (!p.includes(A)) throw new Error('anchor missing');
  return p.replace(A, B);
}
export function acceptVerifiedAnswer({ original, edited, material }) {
  const r = base.acceptVerifiedAnswer({ original, edited, material });
  return r.reason === 'empty' && /^\s*UNSUPPORTED\s*:\s*none\b/i.test(String(edited)) ? { accepted: true, changed: false, reason: 'unchanged', text: original } : r;
}
