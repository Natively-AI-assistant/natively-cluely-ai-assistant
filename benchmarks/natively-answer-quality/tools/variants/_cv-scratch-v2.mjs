// I18 replay v2: the verifier lists what is unsupported BEFORE it rewrites (a hidden scratch line, stripped here).
import * as base from './_claimVerifier-bundle.mjs';
export * from './_claimVerifier-bundle.mjs';
const FORMAT = `
Work in two steps and output both.
Step 1, one line starting "UNSUPPORTED:" — every phrase of the draft that says something about them which the material does not state, quoted briefly and separated by " | ". Check each sentence: a yes or a no, an "it works for me" or "sounds manageable", a timing or availability, what they want, prefer or care about, why they did something, how they usually work, what happened. Write "UNSUPPORTED: none" when there is nothing.
Step 2, after a line containing only "---" — the revised reply, with each listed phrase handled by its kind:
- a way of working, strength or approach: say it in the conditional, as what they would do, never as what they did or always do;
- a preference, priority, goal, willingness or availability: do not assert it either way, not even softly; acknowledge what was said and ask the one thing about the other side that it depends on;
- a motive, cause or event in their own past (why they left, what happened in a gap, who reported to whom, what went wrong): drop it and do not replace it. Say plainly what the material records about that time and stop there. Do not ask the other person a question about it, and do not offer to explain later.
Never turn a question about their own past into a question for the other person.`;
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
