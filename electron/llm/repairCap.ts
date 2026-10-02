// How long a post-answer repair or regeneration may run before it is cut off.
//
// Each repair site has a size its PROSE should stay under (900–2,000
// characters). Counting a fenced block towards that size cut regenerated
// answers in the middle of a diagram, a chart payload or a code listing: the
// stream was stopped at the cap and the half-written block replaced a complete
// answer. A block is not prose, so it is not counted — and a stream is never
// stopped inside one. A hard ceiling still bounds a model that never closes
// its fence.
//
// A fence is read the way the shared scanner reads one (src/lib/diagram/
// fencedBlocks.mjs): three or more backticks or tildes at the start of a line,
// after any indentation and an optional list marker; a backtick fence's info
// string holds no backtick ("```npm i``` to install." is inline code, not an
// opening fence); under a list marker the info is at most one word.
//
// Pure: no I/O, no imports.

/** Room for a drawing on top of the prose cap: one full diagram or chart payload. */
export const REPAIR_BLOCK_ALLOWANCE_CHARS = 8000;
/** Room for any other fenced block (a code listing). */
export const REPAIR_CODE_ALLOWANCE_CHARS = 3000;

const OPEN_RE = /^( *(?:(?:[-*+]|\d{1,9}[.)]) +)?)(`{3,}|~{3,})([^\n]*)$/;
const VISUAL_TAG_RE = /^(?:mermaid|natively-chart|natively-diagram)$/i;

interface OpenFence { char: string; len: number; indent: number; visual: boolean }

function openingFence(line: string): OpenFence | null {
  const m = OPEN_RE.exec(line);
  if (!m) return null;
  const info = m[3].trim();
  if (m[2][0] === '`' && info.includes('`')) return null;
  if (/\S/.test(m[1]) && /\s/.test(info)) return null;
  return { char: m[2][0], len: m[2].length, indent: m[1].length, visual: VISUAL_TAG_RE.test(info.split(/\s+/)[0] || '') };
}

function closesFence(line: string, fence: OpenFence): boolean {
  let i = 0;
  while (i < line.length && line[i] === ' ') i += 1;
  if (i > fence.indent + 3) return false;
  let run = 0;
  while (i < line.length && line[i] === fence.char) {
    run += 1;
    i += 1;
  }
  return run >= fence.len && line.slice(i).trim() === '';
}

/** Characters outside fenced blocks, whether the text ends inside one, and whether it holds a drawing. */
export function proseOutsideFences(text: string): { proseChars: number; insideFence: boolean; hasVisual: boolean } {
  let proseChars = 0;
  let open: OpenFence | null = null;
  let hasVisual = false;
  let start = 0;
  const value = String(text ?? '').replace(/\r\n?/g, '\n');
  while (start <= value.length) {
    const nl = value.indexOf('\n', start);
    const end = nl === -1 ? value.length : nl;
    const line = value.slice(start, end);
    if (open) {
      if (closesFence(line, open)) open = null;
    } else {
      const fence = openingFence(line);
      if (fence) {
        open = fence;
        if (fence.visual) hasVisual = true;
      } else {
        proseChars += line.length + 1;
      }
    }
    if (nl === -1) break;
    start = nl + 1;
  }
  return { proseChars, insideFence: open !== null, hasVisual };
}

/**
 * True when a repair stream should be stopped: its prose passed `proseCap` and
 * it is not in the middle of a block, or it passed the hard ceiling (the cap
 * plus room for one drawing — or, with no drawing in it, for one listing).
 */
export function repairCapReached(text: string, proseCap: number): boolean {
  const value = String(text ?? '');
  if (value.length <= proseCap) return false; // the common case, no scan
  if (value.length > proseCap + REPAIR_BLOCK_ALLOWANCE_CHARS) return true;
  const { proseChars, insideFence, hasVisual } = proseOutsideFences(value);
  if (!hasVisual && value.length > proseCap + REPAIR_CODE_ALLOWANCE_CHARS) return true;
  return !insideFence && proseChars > proseCap;
}

/**
 * A repaired answer that ends inside a block it never closed is not an
 * improvement on a complete answer: half a diagram cannot be drawn and half a
 * listing cannot be run.
 */
export function endsInsideFence(text: string): boolean {
  return proseOutsideFences(text).insideFence;
}
