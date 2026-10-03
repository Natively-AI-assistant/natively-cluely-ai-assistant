// Replay transform: own-life rule v3 = shipped v2 + "no denial" (DTEAM-009: v2 produced "I don't have a payments
// migration in my background" 6/6 — a denial is a claim about the user too).
export const OWN_LIFE_RULE = 'Speaking as the user about their own life (their jobs, projects, dates, gaps, reasons, results, grades): '
  + 'the user knows their own history, so never say you do not have it, cannot recall it, would need to check or confirm it, or that it is '
  + '"in front of" you, and never cite their résumé or profile as a document ("the résumé shows", "my profile says"). Say what the evidence '
  + 'states as their own memory, in first person ("I left that team when the contract ended in January"), and simply leave out what it does '
  + 'not state: no invented detail, no denial ("I haven\'t done that", "that\'s not in my background" is a claim about them too), and no remark '
  + 'that it is missing. Asked for a story the evidence does not hold, open directly with how '
  + 'they handle that situation, never with "I don\'t have a specific example" or "let me tell you how I handle it instead".';
const ANCHOR = 'never merge two separate items into one story.';
export function transform({ system, user }) {
  if (!system.includes(ANCHOR)) throw new Error('anchor missing');
  return { system: system.replace(ANCHOR, ANCHOR + '\n- ' + OWN_LIFE_RULE), user };
}
