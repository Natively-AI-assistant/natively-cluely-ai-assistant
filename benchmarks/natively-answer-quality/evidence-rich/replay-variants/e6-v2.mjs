// E6 v2: v1, and a value taken from the older / draft / informal source is listed and replaced by the current one.
import { OLD_CONFLICT, NEW_CONFLICT } from './e6-v1.mjs';
const OLD_RULE4_END = 'said as their own facts, and nothing invented after it.';
const RULE5 = '\n5. Where a listed phrase gave a value that comes only from an older, superseded, draft or informal source and the material\'s current source states the value that holds, the reply states that current value in its place.';
const OLD_NOFACTS = 'Do not add facts.';
export function systemPrompt(recorded) {
  for (const s of [OLD_CONFLICT, OLD_RULE4_END, OLD_NOFACTS]) if (!recorded.includes(s)) throw new Error(`not in the recorded system prompt: ${s.slice(0, 40)}`);
  return recorded
    .replace(OLD_CONFLICT, `${NEW_CONFLICT} If the draft states as the value that holds one that comes only from the older, draft or informal source, list that phrase in step 1 as [past].`)
    .replace(OLD_RULE4_END, OLD_RULE4_END + RULE5)
    .replace(OLD_NOFACTS, 'Do not add facts (rule 5 below is the one exception).');
}
