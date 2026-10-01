// I18 replay: the verifier lists what is unsupported BEFORE it rewrites (a hidden scratch line, stripped here).
import * as base from './_claimVerifier-bundle.mjs';
export * from './_claimVerifier-bundle.mjs';
const FORMAT = `
Work in two steps and output both.
Step 1, one line starting "UNSUPPORTED:" — every phrase of the draft that says something about them which the material does not state, quoted briefly and separated by " | ". Check each sentence: a yes or a no, an "it works for me" or "sounds manageable", a timing or availability, what they want, prefer or care about, why they did something, how they usually work, what happened. Write "UNSUPPORTED: none" when there is nothing.
Step 2, after a line containing only "---" — the revised reply, with each listed phrase removed or made conditional. A way of working becomes what they would do. A preference, willingness or availability is not asserted either way: acknowledge and ask the one thing about the other side it depends on. A motive or event is dropped, not replaced.`;
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = base.claimVerifierSystemPrompt(modeId, surface, opts);
  return p.replace('Change as little as possible. Output only the revised reply. If nothing needs changing, output it unchanged.',
    'Change as little as possible. If nothing needs changing, the revised reply is the draft unchanged.' + FORMAT);
}
export function splitScratch(text) {
  const t = String(text ?? '');
  const m = t.match(/^[\s\S]*?\n\s*---\s*\n([\s\S]*)$/);
  return { scratch: m ? t.slice(0, t.length - m[1].length) : '', reply: (m ? m[1] : t.replace(/^UNSUPPORTED:[^\n]*\n?/, '')).trim() };
}
export function acceptVerifiedAnswer({ original, edited, material }) {
  return base.acceptVerifiedAnswer({ original, edited: splitScratch(edited).reply, material });
}
