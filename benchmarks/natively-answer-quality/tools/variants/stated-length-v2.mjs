// v2 of stated-length: DURATION only (the line-count form broke multi-part requests: "3 discovery questions, a one
// line …" went from 3 lines to 8), and with a hard ceiling — v1 said "not a longer one" and a 60-second ask came back
// at 232–272 words where 120–162 was wanted.
import { statedLength } from './stated-length-v1.mjs';
export { statedLength };
export function statedLengthNotice(question) {
  const s = statedLength(question); if (!s || s.kind !== 'seconds') return '';
  const lo = Math.round(s.seconds * 2), hi = Math.round(s.seconds * 2.7);
  return `<presentation_instruction note="Length the user asked for in this message. It replaces the app default.">\nLENGTH: the user asked for about ${s.seconds} seconds spoken — ${lo} to ${hi} words. Hard ceiling: never go past ${hi} words; if your draft runs longer, cut detail, keep the arc. Do not stop far short of ${lo} either.\n</presentation_instruction>`;
}
const DEFAULT_BLOCK_RE = /\n*<presentation_instruction note="App default for length[^"]*">[\s\S]*?<\/presentation_instruction>/;
export function transform({ system, user }) {
  const q = String(user).match(/# Question\n([^\n]*)/)?.[1] ?? '';
  const notice = statedLengthNotice(q); if (!notice) return { system, user };
  return { system, user: `${String(user).replace(DEFAULT_BLOCK_RE, '')}\n\n${notice}` };
}
