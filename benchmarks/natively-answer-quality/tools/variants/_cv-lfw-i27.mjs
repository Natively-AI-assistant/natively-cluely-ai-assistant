// Replay only (on fix12). Looking for work: the v2 fallback for a reply the removals leave unanswered (I27c), and NO
// conflict step. The conflict step exists for a sheet that gives two prices or a policy that gives two rules. In this
// mode the material about the speaker is their own record, sometimes in an older and a current version, and the
// generator already follows the current one; the step re-opened it aloud — "the drop is given two ways, to 14.2%
// across 6 clinics in one version… I'd confirm which" (DJOB-031 9.6 → 5.1, DJOB-032 8.9 → 5.6, Fable judge). A
// candidate does not say that about their own résumé. A wording that tried to teach "older version" to the model
// broke genuine conflicts in other modes (rejected 2026-10-01); this changes one mode's prompt and nothing else.
import * as v2 from './_cv-lfw-bridge-v2.mjs';
export * from './_cv-lfw-bridge-v2.mjs';
const CONFLICT_STEP = 'Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".';
export const LFW_NO_CONFLICT_STEP = 'Then the line "CONFLICT: none". Their own record in an older and a newer version is not a conflict to raise aloud: the reply keeps the figure the draft uses.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = v2.claimVerifierSystemPrompt(modeId, surface, opts);
  if (modeId !== 'looking-for-work') return p;
  if (!p.includes(CONFLICT_STEP)) throw new Error('anchor missing');
  return p.replace(CONFLICT_STEP, LFW_NO_CONFLICT_STEP);
}
