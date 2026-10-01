// Keeping a diagram intact while its answer is reworded.
//
// "Make it shorter", "rephrase that", "more casual": the user is asking for
// different WORDS. The follow-up model receives the whole previous answer,
// Mermaid block included, and is told to copy the block unchanged — but a
// model asked to shorten will often shorten the diagram too, or drop it. So the
// instruction is backed by a deterministic check on the finished text: every
// diagram of the previous answer must come back byte-identical, in order.
//
// Pure. The caller decides whether the request was about the design itself
// (refinementTouchesDesign) — in that case nothing is enforced.

import { parseFencedBlocks } from './fencedBlocks.mjs';

const DESIGN_WORDS_RE = /\b(?:diagram|design|architecture|flow ?chart|chart|mermaid|sequence|state machine|component|node|arrow|box)\b/i;

/** Does the refinement request ask to change the design, not just the wording? */
export function refinementTouchesDesign(request) {
  return DESIGN_WORDS_RE.test(String(request ?? ''));
}

/** The line appended to the follow-up system prompt when the previous answer holds a diagram. */
export const REFINE_DIAGRAM_RULE =
  'The answer being revised contains a diagram: a fenced `mermaid` block. The request is about the WORDING. Apply it to the prose only, and reproduce the mermaid block exactly as it is, character for character, in the same place. Do not shorten, simplify, rename or reorder anything inside it, and do not drop it.';

const norm = (v) => String(v ?? '').replace(/\r\n?/g, '\n').trim();

function closedDiagrams(text) {
  return parseFencedBlocks(text, { final: true }).blocks.filter((b) => b.kind === 'mermaid' && b.closed);
}

function renderBlock(block) {
  const fence = block.fenceChar.repeat(block.fenceLength);
  const info = block.info || 'mermaid';
  return `${fence}${info}\n${norm(block.source)}\n${fence}`;
}

/**
 * Make `refined` carry the same diagrams as `previous`.
 *
 * - a diagram the refinement changed is put back as it was;
 * - a diagram the refinement dropped is re-inserted (the first after the
 *   opening paragraph, later ones at the end);
 * - an extra diagram the refinement invented is left alone (harmless, and the
 *   caller did not ask us to delete model output).
 *
 * @returns {{ text: string, changed: boolean, restored: number }}
 */
export function preserveDiagramsInRefinement(previous, refined) {
  const original = closedDiagrams(String(previous ?? ''));
  const text = String(refined ?? '');
  if (original.length === 0 || !text.trim()) return { text, changed: false, restored: 0 };

  const parse = parseFencedBlocks(text, { final: true });
  const current = parse.blocks.filter((b) => b.kind === 'mermaid');
  let out = '';
  let restored = 0;
  let seen = 0;

  for (const block of parse.blocks) {
    if (block.kind !== 'mermaid') {
      out += text.slice(block.start, block.end);
      continue;
    }
    const want = original[seen];
    seen += 1;
    if (want && norm(block.source) !== norm(want.source)) {
      const tail = text.slice(block.end);
      out += renderBlock(want) + (tail && !tail.startsWith('\n') ? '\n' : block.closed && /\n$/.test(text.slice(block.start, block.end)) ? '\n' : '');
      restored += 1;
    } else {
      out += text.slice(block.start, block.end);
    }
  }

  // Diagrams that did not come back at all.
  const missing = original.slice(current.length);
  if (missing.length > 0) {
    const [first, ...rest] = missing;
    if (current.length === 0) {
      // Original shape: lead sentence(s) → diagram → explanation.
      const breakAt = out.search(/\n[ \t]*\n/);
      if (breakAt === -1) {
        out = `${out.replace(/\s+$/, '')}\n\n${renderBlock(first)}`;
      } else {
        out = `${out.slice(0, breakAt).replace(/\s+$/, '')}\n\n${renderBlock(first)}\n\n${out.slice(breakAt).replace(/^\s+/, '')}`;
      }
    } else {
      out = `${out.replace(/\s+$/, '')}\n\n${renderBlock(first)}`;
    }
    for (const block of rest) out = `${out.replace(/\s+$/, '')}\n\n${renderBlock(block)}`;
    restored += missing.length;
  }

  return { text: out, changed: restored > 0, restored };
}
