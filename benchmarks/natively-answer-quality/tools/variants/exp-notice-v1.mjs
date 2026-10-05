// Replay transform: the composer's EXISTING experience notice, now also triggered by an asserted-experience
// question ("You did a payments migration at your last company, right?"), inserted where the composer puts it.
import { transform as ownLife } from './own-life-v2.mjs';
export const EXP_NOTICE = '(This asks whether the user has done something. Claim it only if the evidence above shows it. Otherwise do not say they have or have not: answer the substance, and name only the closest experience the evidence does show.)';
export const ASSERTED_RE = /\byou (?:did|led|ran|built|shipped|worked on|managed|handled|migrated|owned|launched)\b[^?]{0,90}\b(?:right|didn'?t you|correct|yeah|no)\s*\?|\bdidn'?t you (?:do|lead|run|build|work|ship|manage|handle|own)\b|\bat your (?:last|previous|old|former) (?:company|job|place|role|team|employer)\b/i;
export function transform(x) {
  const a = ownLife(x);
  if (!ASSERTED_RE.test(x.item?.question ?? '') || a.user.includes(EXP_NOTICE)) return a;
  const i = a.user.lastIndexOf('<presentation_instruction');
  return { system: a.system, user: i > 0 ? `${a.user.slice(0, i)}${EXP_NOTICE}\n\n${a.user.slice(i)}` : `${a.user}\n\n${EXP_NOTICE}` };
}
