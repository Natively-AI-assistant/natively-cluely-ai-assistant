// How a Mermaid block behaves inside the overlay's STREAMING answer path.
//
// The overlay paces the reveal of arrived text (about 400 chars/s) so prose
// reads smoothly. That pacing is wrong for a diagram's source: nobody reads
// Mermaid at reading speed, and holding a finished diagram back behind a slow
// reveal of its own source is exactly the delay to avoid. Three decisions live
// here, pure and tested, so the component only wires them:
//
//   1. shouldUseStreamingDiagramUi — any intent's stream switches to the
//      React-owned render path once a Mermaid fence is opening, because the
//      diagram card is a React component. (The code card's own switch is
//      limited to two intents; a diagram can arrive on any route.)
//
//   2. fastForwardDiagramReveal — THE artifact fast-forward. Once the paced
//      reveal reaches a Mermaid block, it jumps to the end of what has arrived
//      of that block. Order is preserved: text before the block is still
//      revealed first, and the reveal continues at its normal pace after the
//      block. Nothing after the block is revealed early.
//
//   3. previousVersionFor — while an UPDATE is being written, the last valid
//      version stays visible. Decided from content (shared component names),
//      so a fresh, unrelated design never shows the old one as "updating".

import { designOverlap, SAME_DESIGN_OVERLAP } from './activeDesign.mjs';
import { designVocabulary } from './diagramRequest.mjs';

// An opening fence line that already reads "mermaid" (the newline may not have
// arrived yet). Backtick or tilde, any indentation.
const MERMAID_OPENING_RE = /(?:^|\n) *(?:`{3,}|~{3,})mermaid\b/i;
// A fence line still being typed whose tag so far is a prefix of "mermaid".
const MERMAID_PREFIX_TAIL_RE = /^ *(?:`{3,}|~{3,})(m|me|mer|merm|merma|mermai|mermaid)$/i;

/** Has a Mermaid fence started opening in this (arrived) text? */
export function hasOpeningMermaidFence(text) {
  return typeof text === 'string' && text.length >= 10 && MERMAID_OPENING_RE.test(text);
}

// A fence line at the very end of a streaming text that could still be turning
// into "```mermaid" ("```m", "```merm").
const MERMAID_TAIL_RE = /(?:^|\n) *(?:`{3,}|~{3,})m[a-z]*$/i;

/**
 * Cheap pre-check before running the fence scanner: could this answer hold a
 * Mermaid block — or, while streaming, be about to open one?
 */
export function mayHoldMermaidFence(text, streaming = false) {
  if (typeof text !== 'string' || !text) return false;
  if (text.indexOf('mermaid') !== -1) return true;
  return streaming === true && MERMAID_TAIL_RE.test(text.slice(-48));
}

/**
 * Should this stream render through React (so a diagram card can mount)?
 * Intent-independent on purpose: content decides, not the action's name.
 */
export function shouldUseStreamingDiagramUi(token, previousText = '') {
  if (typeof token !== 'string') return false;
  const prev = typeof previousText === 'string' ? previousText : '';
  // Only the tail can newly complete the pattern; avoid rescanning the answer.
  const tail = prev.length > 24 ? prev.slice(prev.lastIndexOf('\n', prev.length - 24) + 1 || -24) : prev;
  return hasOpeningMermaidFence(tail + token) || hasOpeningMermaidFence(prev.slice(-24) + token);
}

/**
 * Is this unsettled tail a fence line that is turning into "```mermaid"? Such
 * a tail is not shown at all, so the card does not appear first as an empty
 * code block and then change into a diagram.
 */
export function isMermaidOpeningTail(tail) {
  return Boolean(tail && tail.kind === 'opening-fence' && MERMAID_PREFIX_TAIL_RE.test(tail.text));
}

/**
 * The artifact fast-forward.
 *
 * @param {ReadonlyArray<{ kind: string, start: number, end: number }>} blocks  blocks of the ARRIVED text
 * @param {number} revealedLen   how much the paced reveal has shown
 * @param {number} arrivedLen    how much text has arrived
 * @returns {number} the reveal position to use (never less than revealedLen)
 */
export function fastForwardDiagramReveal(blocks, revealedLen, arrivedLen) {
  if (!Array.isArray(blocks) || !Number.isFinite(revealedLen) || !Number.isFinite(arrivedLen)) return revealedLen;
  for (const block of blocks) {
    if (block.kind !== 'mermaid') continue;
    if (revealedLen >= block.start && revealedLen < block.end) {
      return Math.max(revealedLen, Math.min(block.end, arrivedLen));
    }
  }
  return revealedLen;
}

/** Offsets of the Mermaid blocks whose closing fence has arrived. */
export function completedDiagramCount(blocks) {
  if (!Array.isArray(blocks)) return 0;
  let n = 0;
  for (const b of blocks) if (b.kind === 'mermaid' && b.closed) n += 1;
  return n;
}

/**
 * The version to keep on screen while a new diagram is still arriving, or
 * undefined. Needs a few component names from the new block before it will
 * call it "the same design".
 */
export function previousVersionFor(partialSource, previousSource) {
  if (!previousSource || !partialSource) return undefined;
  if (designVocabulary(partialSource).size < 2) return undefined;
  return designOverlap(partialSource, previousSource) >= SAME_DESIGN_OVERLAP ? previousSource : undefined;
}

/**
 * A short plain-text description of what a diagram shows, taken from the
 * answer's own words just before the block. Used as the accessible
 * description. Markdown markers are dropped; length is bounded.
 */
export function describeDiagramFromLead(leadProse) {
  const text = String(leadProse ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= 280) return text;
  const cut = text.slice(0, 280);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}
