// The per-request overflow guard for a model on this device.
//
// A local model has a small context, and a prompt that does not fit it is cut
// here rather than refused. The cut has always been "oldest lines first, never
// the system prompt", and that is still what it is for ordinary content. What
// it could not see was that two things in the user content are not lines:
//
//   - the design on the table (<active_design>): half a diagram's source is
//     worse than none. The model is asked to return the whole diagram with
//     every node kept, and what comes back replaces the one on the table.
//   - what was said in the meeting (<conversation_so_far>): cut from the top it
//     lost its opening tag and the sentence that says what it is, while the
//     contract in the system prompt still pointed at it by name.
//
// Pure: no model, no I/O, so both Ollama entry points share it and it is
// tested under plain Node.

const DESIGN_OPEN = /^\s*<active_design\b/;
const DESIGN_CLOSE = /<\/active_design>/;
const SPEECH_OPEN = /^\s*<conversation_so_far>\s*$/;
const SPEECH_CLOSE = /^\s*<\/conversation_so_far>\s*$/;

/** What takes the place of a design that did not fit. */
export const DESIGN_OMITTED_NOTE =
  '(The drawing on the table is too large for this model and is not shown here. Say that plainly, and do not redraw it from memory.)';

type Segment =
  | { kind: 'plain'; lines: string[] }
  | { kind: 'design'; lines: string[] }
  // head: the opening tag and the sentence under it; tail: the closing tag.
  | { kind: 'speech'; head: string[]; body: string[]; tail: string[] };

function segmentsOf(lines: string[]): Segment[] {
  const out: Segment[] = [];
  let plain: string[] = [];
  const flush = () => { if (plain.length) { out.push({ kind: 'plain', lines: plain }); plain = []; } };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const design = DESIGN_OPEN.test(line);
    const speech = !design && SPEECH_OPEN.test(line);
    if (design || speech) {
      const close = design ? DESIGN_CLOSE : SPEECH_CLOSE;
      let end = -1;
      for (let j = design ? i : i + 1; j < lines.length; j += 1) {
        if (close.test(lines[j])) { end = j; break; }
      }
      // An opening tag that is never closed is not a block: ordinary lines.
      if (end > i) {
        flush();
        const block = lines.slice(i, end + 1);
        if (design) out.push({ kind: 'design', lines: block });
        else out.push({ kind: 'speech', head: block.slice(0, Math.min(2, block.length - 1)), body: block.slice(Math.min(2, block.length - 1), -1), tail: block.slice(-1) });
        i = end;
        continue;
      }
    }
    plain.push(line);
  }
  flush();
  return out;
}

const linesOf = (segment: Segment): string[] =>
  segment.kind === 'speech' ? [...segment.head, ...segment.body, ...segment.tail] : segment.lines;

/**
 * `userContent` shortened until it is at most `maxChars` long.
 *
 * Order of what goes: the oldest ordinary lines; then the oldest lines of what
 * was said in the meeting (its wrapper and heading stay while any of it does);
 * then the design on the table, whole, with one line in its place; then, as
 * before, whatever is left from the top. One line always remains.
 */
export function trimUserContentToFit(userContent: string, maxChars: number): string {
  const text = String(userContent ?? '');
  if (!(maxChars >= 0) || text.length <= maxChars) return text;

  const segments = segmentsOf(text.split('\n'));
  // Joined length = every line's length + one newline between each pair.
  let length = text.length;
  const fits = () => length <= maxChars;
  const count = () => segments.reduce((n, s) => n + linesOf(s).length, 0);
  /** Remove the first line of `lines`; false when that would leave nothing at all. */
  const shift = (lines: string[]): boolean => {
    if (lines.length === 0 || count() <= 1) return false;
    length -= lines[0].length + 1;
    lines.shift();
    return true;
  };

  const last = segments.length - 1;

  // 1. Ordinary lines above the last segment (the question lives in the last).
  for (let i = 0; i < last && !fits(); i += 1) {
    const segment = segments[i];
    if (segment.kind !== 'plain') continue;
    while (!fits() && shift(segment.lines)) { /* oldest first */ }
  }

  // 2. The oldest of what was said; a block with nothing left in it goes whole.
  for (let i = 0; i < segments.length && !fits(); i += 1) {
    const segment = segments[i];
    if (segment.kind !== 'speech') continue;
    while (!fits() && shift(segment.body)) { /* oldest first */ }
    if (segment.body.length === 0) {
      while (segment.head.length && shift(segment.head)) { /* the wrapper with it */ }
      while (segment.tail.length && shift(segment.tail)) { /* … */ }
    }
  }

  // 3. The design, whole. Never a part of it.
  for (let i = 0; i < segments.length && !fits(); i += 1) {
    const segment = segments[i];
    if (segment.kind !== 'design') continue;
    const removed = segment.lines.reduce((n, line) => n + line.length + 1, 0);
    length += DESIGN_OMITTED_NOTE.length + 1 - removed;
    segments[i] = { kind: 'plain', lines: [DESIGN_OMITTED_NOTE] };
  }

  // 4. Still too long: from the top, as it always was.
  for (let i = 0; i < segments.length && !fits(); i += 1) {
    const segment = segments[i];
    if (segment.kind === 'plain') while (!fits() && shift(segment.lines)) { /* oldest first */ }
  }

  return segments.flatMap(linesOf).join('\n');
}

/**
 * The room the user content has in a model of `maxContextTokens`, in
 * characters: what the old loop tested line by line
 * (`estimateTokens(sys) + estimateTokens(user) + 2000 > max`, four characters
 * to a token, rounded up), solved for the user content.
 */
export function userContentRoomChars(maxContextTokens: number, systemPrompt: string, reserveTokens = 2000): number {
  const systemTokens = Math.ceil(String(systemPrompt ?? '').length / 4);
  return Math.max(0, (Math.floor(maxContextTokens) - reserveTokens - systemTokens) * 4);
}
