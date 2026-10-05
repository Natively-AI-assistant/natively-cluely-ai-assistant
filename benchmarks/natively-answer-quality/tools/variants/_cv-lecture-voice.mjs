// Replay only (on fix12). Lecture: the persona says "a quiet study partner, not the student or lecturer", yet when the
// lecturer addresses the room ("who here has worked with messy real-world data?") the draft answers AS the student
// ("I've run into messy data plenty of times"). Precise signal: the draft-personal pattern matches 1 of 40 dev and
// 2 of 30 holdout Lecture drafts, all judge-capped (4.2–5.0 vs ~9.0), none missed. The generic claim pass does not
// repair it (the claims survive 3 of 6 times), so the turn gets its own short rewrite instruction.
import * as base from './_claimVerifier-fix12.mjs';
export * from './_claimVerifier-fix12.mjs';
export function claimVerifierKind(input) {
  const k = base.claimVerifierKind(input);
  if (k) return k;
  const draft = String(input.draft ?? '');
  if (String(input.modeId ?? '') === 'lecture' && !/```/.test(draft) && base.DRAFT_PERSONAL_RE.test(draft)) return 'personal';
  return null;
}
export const LECTURE_VOICE_PROMPT = `You edit a note that a quiet study partner wrote privately for a student who is listening to a lecture. The note must never speak as the student or for the student: it states nothing about the student's own experience, habits, opinions or feelings ("I've run into that", "I have", "this lands for me", "the first thing I check").
Rewrite the note as a plain explanation of the point the lecturer is making, in the same length and tone. Keep every explanation of the subject the draft gives, word for word where you can. Where the lecturer asked the room a question about their experience, do not answer it: say in one clause why the lecturer is asking, then explain the point.
Add no facts that are not in the draft or the material. The revised note is in the language the draft is written in. Output only the revised note.`;
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  return modeId === 'lecture' ? LECTURE_VOICE_PROMPT : base.claimVerifierSystemPrompt(modeId, surface, opts);
}
