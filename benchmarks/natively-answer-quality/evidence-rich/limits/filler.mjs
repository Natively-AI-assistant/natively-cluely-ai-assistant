export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
export const WORDS = 'the team reviewed rota staffing calendar vendor budget quarter backlog tooling migration dashboard alerting cadence onboarding handover review cycle forecast capacity rollout policy audit release report meeting notes agenda workstream priorities estimate risk dependency survey feedback archive template checklist process baseline target summary update draft schedule'.split(' ');
/** Varied filler prose (no two sentences equal, so no chunk is a duplicate), ~4.6 chars per word. */
export function filler(chars, seed) {
  const r = rng(seed); let out = ''; let n = 0;
  while (out.length < chars) { const len = 9 + Math.floor(r() * 9); const w = Array.from({ length: len }, () => WORDS[Math.floor(r() * WORDS.length)]); w[0] = w[0][0].toUpperCase() + w[0].slice(1); out += `${w.join(' ')} (item ${seed}-${++n}). `; if (n % 6 === 0) out += '\n\n'; }
  return out.slice(0, chars);
}
