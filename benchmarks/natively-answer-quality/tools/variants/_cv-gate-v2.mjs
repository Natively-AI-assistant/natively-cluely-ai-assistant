// Replay only (on fix12). Two gate gaps, read off the charter-v2 dev judgments of UNGATED turns that still carried an
// unsupported claim about the user:
//  - Lecture is never verified, yet a draft that speaks in the first person about the user's own past ("I've run into
//    messy data plenty of times") is capped every time: the draft-personal pattern matches 1 of 40 dev and 2 of 30
//    holdout Lecture drafts, every match is judge-flagged, no flagged one is missed. Lecture is verified ONLY then.
//  - Technical interview: "tell me honestly how much Go you've written in production" matched neither pattern.
import * as base from './_claimVerifier-fix12.mjs';
export * from './_claimVerifier-fix12.mjs';
export const TI_EXPERIENCE_RE = /\b(?:how (?:much|many|long|often) [^.?!]{0,40}\b(?:have you|you(?:'ve| have))\b|you(?:'ve| have) (?:actually |personally )?(?:written|used|built|run|shipped|worked|operated|done)\b)/i;
export function claimVerifierKind(input) {
  const k = base.claimVerifierKind(input);
  if (k) return k;
  const mode = String(input.modeId ?? ''); const draft = String(input.draft ?? '');
  if (/```/.test(draft)) return null;
  if (mode === 'lecture' && base.DRAFT_PERSONAL_RE.test(draft)) return 'personal';
  if (mode === 'technical-interview' && TI_EXPERIENCE_RE.test(String(input.question ?? ''))) return 'personal';
  return null;
}
