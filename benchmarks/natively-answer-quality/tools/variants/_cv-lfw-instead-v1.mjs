// I23 replay: Looking for work — what the rewrite says INSTEAD when the reason, story or weakness is unsupported.
import * as base from './_claimVerifier-i18.mjs';
export * from './_claimVerifier-i18.mjs';
const ANCHOR = 'A motive or event is dropped, not replaced.';
const INSTEAD = ` What takes its place comes from the material, never from invention:
- asked why (why leave, why this role, why now): what the job description offers that their documented work leads to, said as what draws them to it; no dissatisfaction, no reason for leaving;
- asked for a weakness or something to improve: a skill the material shows they have used little or not at all, and how they would build it;
- asked for a story the material does not hold (a conflict, a failure, pushback): how they would handle it, in the conditional; a documented project may be named for its facts only;
- asked about a period, a gap or who reported to whom, when the material only gives dates or titles: those dates or titles, plainly, and nothing after them. No question back.`;
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  return modeId === 'looking-for-work' && p.includes(ANCHOR) ? p.replace(ANCHOR, ANCHOR + INSTEAD) : p;
}
