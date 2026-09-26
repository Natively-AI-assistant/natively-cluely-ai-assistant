// electron/llm/cannedOpener.ts
//
// Throw away a canned opener, keep the answer (2026-09-07, owner's direction:
// "it should throw away any messages like 'I couldn't find the retrieved
// chunk' and give the correct answer").
//
// MEASURED in a 1,000-turn live campaign: to "more detail please" the model
// streamed "Sorry, I don't have the specific story written down in front of
// me right now. If you're asking about a particular example I mentioned,
// could you clarify which aspect you'd like more detail on?" — and THEN gave
// two paragraphs of real, usable content about the story. The permanent rules
// already forbid asking to clarify; the model does it anyway about once in
// three hundred turns. Regenerating costs a full round trip; the substantive
// tail is already there. So the opener is dropped and the tail ships.
//
// Discipline (code-review 2026-07-18 on the sibling detector): a canned
// SENTENCE is only stripped when what remains is itself a substantive answer
// (>= MIN_TAIL_CHARS after the strip). A whole-answer refusal is left alone —
// the engine's sentinel/regeneration paths own that case — and an answer that
// merely CONTAINS one of these phrases mid-way is never touched.

const OPENER_SENTENCE_RE = new RegExp(
  '^\\s*(?:' + [
    "(?:i(?:'m| am)\\s+)?sorry,?\\s+(?:but\\s+)?i\\s+(?:don'?t|do\\s+not|can'?t|cannot)\\s+(?:have|see|find|locate)\\b[^.!?\\n]{0,120}[.!?]",
    "i\\s+(?:couldn'?t|could\\s+not|can'?t|cannot|don'?t)\\s+(?:find|locate|see)\\s+(?:that|it|this|the\\s+\\w+)\\b[^.!?\\n]{0,80}(?:retrieved|uploaded|material|section|chunk|notes|document|file|in\\s+front\\s+of\\s+me)[^.!?\\n]{0,60}[.!?]",
    "(?:could|can|would)\\s+you\\s+(?:please\\s+)?(?:clarify|specify|repeat|rephrase|say\\s+(?:that\\s+)?again)\\b[^.!?\\n]{0,100}\\?",
    "(?:if\\s+you(?:'re| are)\\s+asking\\s+about\\s+[^.!?\\n]{0,60},\\s*)?(?:could|can)\\s+you\\s+clarify\\s+which\\b[^.!?\\n]{0,100}\\?",
    "(?:i(?:'m| am)\\s+)?not\\s+(?:quite\\s+)?sure\\s+(?:what|which)\\s+you(?:'re| are)\\s+(?:asking|referring\\s+to)\\b[^.!?\\n]{0,80}[.!?]",
    "(?:i\\s+)?(?:didn'?t|did\\s+not|couldn'?t)\\s+(?:catch|get|hear)\\s+(?:that|the\\s+(?:question|last\\s+part))[^.!?\\n]{0,60}[.!?]",
    "what\\s+is\\s+your\\s+question\\?",
    "i\\s+need\\s+(?:a\\s+bit\\s+|a\\s+little\\s+|some\\s+)?more\\s+(?:context|information|info|details?)\\b[^.!?\\n]{0,80}[.!?]",
    "i\\s+need\\s+to\\s+know\\s+(?:which|what|whether|if)\\b[^.!?\\n]{0,100}[.!?]",
    "i\\s+(?:don'?t|do\\s+not)\\s+have\\s+(?:that|this|the)\\s+(?:information|info|detail|details|figure|number|data|context)(?:\\s+(?:here|on\\s+hand|in\\s+front\\s+of\\s+me|right\\s+now|yet))?[.!]",
  ].join('|') + ')\\s*',
  'i',
);
const MIN_TAIL_CHARS = 40;
const MAX_STRIPS = 2;

/** Returns the text with up to two leading canned sentences removed, or the
 *  text unchanged when nothing matches or the remainder would be too short
 *  to stand as an answer. */
export function stripCannedOpener(text: string): { text: string; stripped: string[] } {
  let t = text ?? '';
  const stripped: string[] = [];
  for (let i = 0; i < MAX_STRIPS; i++) {
    const m = t.match(OPENER_SENTENCE_RE);
    if (!m) break;
    const rest = t.slice(m[0].length).replace(/^\s+/, '');
    if (rest.replace(/\s+/g, ' ').trim().length < MIN_TAIL_CHARS) break;
    stripped.push(m[0].trim());
    t = rest;
  }
  return { text: t, stripped };
}

/** Streaming form: true while the buffer could still be the START of a canned
 *  opener, so a first-paint gate keeps holding instead of flashing it. Cheap. */
export function mayBeCannedOpenerPrefix(buffer: string): boolean {
  const b = (buffer ?? '').trimStart().toLowerCase();
  if (!b) return false;
  if (b.length > 160) return false;
  return /^(?:i(?:'m| am) )?sorry|^i (?:couldn|could not|can'?t|cannot|don'?t|didn)|^(?:could|can|would) you|^(?:i(?:'m| am) )?not (?:quite )?sure|^what is your question|^if you(?:'re| are) asking/.test(b);
}

/** First-paint gate: keep holding while the buffer is (or may still become) a
 *  canned opener whose substantive tail has not arrived yet. Bounded so a
 *  genuinely canned whole answer still paints at `maxHoldChars`. */
export function shouldHoldForCannedOpener(buffer: string, maxHoldChars = 420): boolean {
  const b = buffer ?? '';
  if (b.length >= maxHoldChars) return false;
  if (stripCannedOpener(b).stripped.length) return false;   // opener + enough tail: release, stripped
  if (mayBeCannedOpenerPrefix(b)) return true;
  return OPENER_SENTENCE_RE.test(b);                          // a full opener with a short tail so far
}

// A canned TAIL: the answer is complete and then asks "Could you clarify which
// one you mean?" (measured 2026-09-08: "…the register lists three, R-3, R-7 and
// R-9, so I'm not sure which one you mean as 'risks 2'. Could you clarify which
// I should use?"). The information is already there; the question is noise.
const TAIL_SENTENCE_RE = /(?:^|(?<=[.!?]["'”’)]?\s))(?:(?:so\s+)?(?:i(?:'m| am)\s+not\s+(?:quite\s+)?sure\s+which\s+(?:one\s+)?you\s+mean[^.!?]{0,60}[.!?]\s*)?(?:could|can|would)\s+you\s+(?:please\s+)?(?:clarify|specify|confirm|let\s+me\s+know)\s+(?:which|what|whether|if)\b[^.!?]{0,120}\?)\s*$/i;

export function stripCannedTail(text: string): { text: string; stripped: string | null } {
  const t = text ?? '';
  const m = t.match(TAIL_SENTENCE_RE);
  if (!m) return { text: t, stripped: null };
  const head = t.slice(0, m.index).replace(/\s+$/, '');
  if (head.replace(/\s+/g, ' ').trim().length < MIN_TAIL_CHARS) return { text: t, stripped: null };
  return { text: head, stripped: m[0].trim() };
}
