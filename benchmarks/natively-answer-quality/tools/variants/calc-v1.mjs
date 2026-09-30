// Replay transform: the composer's calculation notice, exactly as built (dist), inserted where the composer puts it
// (after the evidence, before presentation instructions). Trigger = calculationNotice(question, whole user message).
import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const dist = pathToFileURL(path.resolve(HERE, '..', '..', '..', '..', 'dist-electron', 'electron', 'context-intelligence', 'generation', 'prompt-composer.js')).href;
const { calculationNotice, CALCULATION_NOTICE } = await import(dist);
export const NOTE = process.env.CALC_NOTE_OVERRIDE || CALCULATION_NOTICE;
export function transform({ system, user, item }) {
  const fires = calculationNotice(item?.question ?? '', user);
  if (!fires) return { system, user };
  const i = user.lastIndexOf('<presentation_instruction');
  const u = i > 0 ? `${user.slice(0, i)}${NOTE}\n\n${user.slice(i)}` : `${user}\n\n${NOTE}`;
  return { system, user: u };
}
