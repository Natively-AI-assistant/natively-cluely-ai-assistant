// Replay only (on fix12). v2 of the Looking-for-work fallback: v1's quoted example ("the way I'd handle that is…")
// was copied into 8 of 11 replies, also where it makes no sense ("The way I'd handle that is to lay out the
// timeline"). No template phrase; one case per kind of ask; a gap is named as a gap.
import * as base from './_claimVerifier-fix12.mjs';
export * from './_claimVerifier-fix12.mjs';
const OLD = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: the plain facts about it that are stated (the dates, the role, the project; for a question about a job, what that job is), said as their own facts, and nothing invented after it.';
export const LFW_RULE_4 = '4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back, do not promise to come back on it, and do not stop at a restatement of dates. Answer with what the material does give, in two moves. First, the stated facts closest to the question, said as their own facts: the dates, the role, the project, a problem the material documents and how it was fixed. Then ONE sentence that carries the answer forward and claims nothing about their past, their feelings or what they want. Which sentence depends on what was asked. A reason or a motive: how the documented work compares with what this role covers, naming a responsibility the job description states. A story, a habit, or how they handled something the material does not record: what they would do in that situation, worded as what they would do, never as what happened. A plan or an outlook: the next step that would follow from the documented work, worded as a possibility. A weakness: an area the material itself shows as limited. A gap between two jobs: say plainly that there is a gap, then the documented work since. Word that sentence freshly each time, without a set opening phrase. Only for pay, a start date, relocation or another preference nothing states: one short sentence that they will confirm it.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  if (modeId !== 'looking-for-work') return p;
  if (!p.includes(OLD)) throw new Error('anchor missing');
  return p.replace(OLD, LFW_RULE_4);
}
