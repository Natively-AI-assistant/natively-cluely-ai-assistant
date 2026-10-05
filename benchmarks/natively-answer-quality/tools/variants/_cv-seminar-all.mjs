// I22 replay: the I18 verifier on EVERY Seminar turn, with the presenter's research as the subject.
import * as base from './_claimVerifier-i18.mjs';
export * from './_claimVerifier-i18.mjs';
const SUBJECT = 'the presenter, their research, its data, methods, results, numbers or prior work';
export function claimVerifierKind(input) {
  if (input.modeId === 'seminar' && !/```/.test(String(input.draft ?? ''))) return 'personal';
  return base.claimVerifierKind(input);
}
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  return modeId === 'seminar' ? p.replace('the speaker themselves', SUBJECT).replace('the user themselves', SUBJECT) : p;
}
