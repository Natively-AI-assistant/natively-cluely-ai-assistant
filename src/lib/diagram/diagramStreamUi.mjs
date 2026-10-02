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

import { designOverlap, SAME_DESIGN_OVERLAP, artifactVocabulary } from './activeDesign.mjs';
import { isVisualBlock, mentionsVisualTag, VISUAL_FENCE_LANGS } from './fencedBlocks.mjs';

// "Mermaid" in the names below is historical: every function here treats the
// three visual fence tags alike (mermaid, natively-chart, natively-diagram).
const VISUAL_TAGS = Object.keys(VISUAL_FENCE_LANGS);

// An opening fence line that already reads a visual tag (the newline may not
// have arrived yet). Backtick or tilde, any indentation.
//
// Every gate here reads a fence line the way the scanner does (fencedBlocks:
// leading spaces, an optional list marker, spaces before the tag, any case).
// They used to be stricter than it, each in its own way: "``` mermaid" was a
// diagram to the scanner with no live card, "```Mermaid" got the wide row and
// no card, and "```mermaid " showed an empty code card first.
const FENCE_LEAD = String.raw` *(?:(?:[-*+]|\d{1,9}[.)]) +)?(?:\`{3,}|~{3,})[ \t\u00a0]*`;
const MERMAID_OPENING_RE = new RegExp(String.raw`(?:^|\n)${FENCE_LEAD}(?:mermaid|natively-chart|natively-diagram)(?![\w-])`, 'i');
// A fence line still being typed: its tag so far, and whatever follows it.
const FENCE_TAIL_TAG_RE = new RegExp(String.raw`^${FENCE_LEAD}([a-z-]+)([^\n]*)$`, 'i');

const isVisualTagPrefix = (tag) => {
  const t = String(tag || '').toLowerCase();
  return t.length > 0 && VISUAL_TAGS.some((full) => full.startsWith(t));
};

/** Has a Mermaid fence started opening in this (arrived) text? */
export function hasOpeningMermaidFence(text) {
  return typeof text === 'string' && text.length >= 10 && MERMAID_OPENING_RE.test(text);
}

// A fence line at the very end of a streaming text that could still be turning
// into a visual tag ("```m", "```merm", "```nativ").
const MERMAID_TAIL_RE = new RegExp(String.raw`(?:^|\n)${FENCE_LEAD}([a-z-]+)$`, 'i');

/**
 * Cheap pre-check before running the fence scanner: could this answer hold a
 * Mermaid block — or, while streaming, be about to open one?
 */
export function mayHoldMermaidFence(text, streaming = false) {
  if (typeof text !== 'string' || !text) return false;
  if (mentionsVisualTag(text)) return true;
  if (streaming !== true) return false;
  const tail = MERMAID_TAIL_RE.exec(text.slice(-48));
  return Boolean(tail) && isVisualTagPrefix(tail[1]);
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
  if (!tail || tail.kind !== 'opening-fence') return false;
  const m = FENCE_TAIL_TAG_RE.exec(tail.text);
  if (!m) return false;
  // Still typing the tag: hidden while it could become a visual one.
  if (m[2] === '') return isVisualTagPrefix(m[1]);
  // The tag is finished and the line is not ("```mermaid ", "```mermaid\r",
  // "```mermaid title"): hidden when the tag IS a visual one.
  return /^\s/.test(m[2]) && VISUAL_TAGS.includes(m[1].toLowerCase());
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
    if (!isVisualBlock(block)) continue;
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
  for (const b of blocks) if (isVisualBlock(b) && b.closed) n += 1;
  return n;
}

/**
 * The version to keep on screen while a new diagram is still arriving, or
 * undefined. Needs a few component names from the new block before it will
 * call it "the same design".
 */
export function previousVersionFor(partialSource, previousSource) {
  if (!previousSource || !partialSource) return undefined;
  if (artifactVocabulary(partialSource).size < 2) return undefined;
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
