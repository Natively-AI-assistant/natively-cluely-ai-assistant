// E6 v1: the CONFLICT line fires only for two sources of equal standing.
export const OLD_CONFLICT = 'Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".';
export const NEW_CONFLICT = 'Then one line starting "CONFLICT:" — only if two sources of equal standing in the material give different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none". It is not a conflict when the material shows which source holds: a current, final, signed or later-dated version against an older, superseded or expired one, against a draft or a proposal, or against an informal note, message or estimate. The one that holds is then simply what the material states: write "CONFLICT: none".';
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD_CONFLICT)) throw new Error('the CONFLICT sentence is not in the recorded system prompt');
  return recorded.replace(OLD_CONFLICT, NEW_CONFLICT);
}
