// Split an answer into "render as Markdown" and "render as a diagram" pieces.
//
// For surfaces that already own a Markdown renderer (saved meeting usage, the
// meeting chat): they keep rendering everything exactly as they do today, and
// hand only explicitly tagged Mermaid blocks to the shared diagram card.
//
// The Mermaid source never passes through a surface's prose clean-up (math
// normalisation, bold-spacing fixes, glued-line splitting): it is cut out
// first, byte for byte, and everything between diagrams is passed on as one
// untouched Markdown chunk — so a list or a code block that spans the chunk
// keeps its numbering and structure.

import { parseFencedBlocks } from './fencedBlocks.mjs';
import { isMermaidOpeningTail, describeDiagramFromLead, mayHoldMermaidFence } from './diagramStreamUi.mjs';

/**
 * @param {string} text
 * @param {{ streaming?: boolean }} [options]
 * @returns {Array<
 *   | { type: 'markdown', key: string, text: string }
 *   | { type: 'diagram', key: string, diagramIndex: number, source: string, info: string, complete: boolean, description: string }
 * >}
 */
export function splitAnswerForDiagrams(text, options = {}) {
  const body = typeof text === 'string' ? text : '';
  if (!body) return [];
  const streaming = options.streaming === true;
  // Fast path: no Mermaid anywhere — and, while streaming, no fence line at the
  // very end that could still be turning into one ("```m", "```merm").
  if (!mayHoldMermaidFence(body, streaming)) {
    return [{ type: 'markdown', key: 'm0', text: body }];
  }

  const parse = parseFencedBlocks(body, { final: !streaming });
  const hasDiagram = parse.blocks.some((b) => b.kind === 'mermaid');
  const hiddenTail = streaming && isMermaidOpeningTail(parse.tail);
  if (!hasDiagram && !hiddenTail) return [{ type: 'markdown', key: 'm0', text: body }];

  /** @type {ReturnType<typeof splitAnswerForDiagrams>} */
  const out = [];
  let chunkStart = -1;
  let chunkEnd = -1;
  let lastProse = '';
  let markdownCount = 0;
  const flush = () => {
    if (chunkStart === -1) return;
    const chunk = body.slice(chunkStart, chunkEnd);
    if (chunk.trim()) {
      out.push({ type: 'markdown', key: `m${markdownCount}`, text: chunk });
      markdownCount += 1;
    }
    chunkStart = -1;
    chunkEnd = -1;
  };

  for (const block of parse.blocks) {
    if (block.kind === 'mermaid') {
      flush();
      out.push({
        type: 'diagram',
        key: `d${block.diagramIndex}`,
        diagramIndex: block.diagramIndex,
        source: block.source,
        info: block.info,
        complete: block.closed,
        description: describeDiagramFromLead(lastProse),
      });
      continue;
    }
    if (block.kind === 'prose' && block.text.trim()) lastProse = block.text;
    if (chunkStart === -1) chunkStart = block.start;
    chunkEnd = block.end;
  }
  // The unsettled tail of a streaming answer belongs to the Markdown after the
  // last block — unless it is a fence line turning into ```mermaid, which
  // stays hidden until it is a block.
  if (streaming && parse.tail.kind !== 'none' && !hiddenTail) {
    if (chunkStart === -1) chunkStart = body.length - parse.tail.text.length;
    chunkEnd = body.length;
  }
  flush();
  return out;
}
