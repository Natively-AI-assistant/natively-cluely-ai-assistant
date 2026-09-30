// Replay transform: conflicts WITHIN one document count (mirrors the promptSystemV2 wording change).
const PAIRS = [
  ['When sources conflict, name the conflict briefly; never silently choose one.',
   'When sources conflict, or two parts of one document give different values for the same thing (a summary and its table, a rule and its worked example, a draft and a decision), name the conflict briefly and say which you would stand behind and why; never silently choose one.'],
  ['Name conflicts instead of resolving them silently.',
   'Name conflicts, including two different values for the same thing within one document, instead of resolving them silently.'],
];
export function transform({ system, user }) {
  let s = system; let n = 0;
  for (const [a, b] of PAIRS) if (s.includes(a)) { s = s.replace(a, b); n++; }
  if (!n) throw new Error('no conflict anchor found');
  return { system: s, user };
}
