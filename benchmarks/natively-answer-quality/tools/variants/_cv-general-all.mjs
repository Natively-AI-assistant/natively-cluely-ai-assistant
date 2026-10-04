// I21 replay: the I18 verifier on EVERY General turn (not only when the question or draft looks personal).
import * as base from './_claimVerifier-i18.mjs';
export * from './_claimVerifier-i18.mjs';
export function claimVerifierKind(input) {
  if (input.modeId === 'general' && !/```/.test(String(input.draft ?? ''))) return 'life';
  return base.claimVerifierKind(input);
}
