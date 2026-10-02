// Fenced-block scanner shared by every surface that shows an AI answer.
//
// One answer is Markdown that may hold prose, ordinary code fences and
// explicitly tagged visual fences (```mermaid, ```natively-chart,
// ```natively-diagram). The live overlay sees that text grow a
// provider chunk at a time, so a fence marker, its language tag or its closing
// fence can each be cut anywhere. This module answers, for any prefix of an
// answer: which blocks exist, which are complete, and what tail is still
// undecided — without ever guessing that untagged code is a diagram.
//
// Rules (CommonMark fenced code blocks, applied line by line):
//   - an opening fence is 3+ backticks or 3+ tildes after leading spaces; a
//     backtick fence's info string may not contain a backtick;
//   - a closing fence uses the same character, is at least as long as the
//     opening one, and is followed only by spaces/tabs;
//   - content keeps its bytes. Only the opening fence's own indentation is
//     removed from each content line, as CommonMark does.
//
// Deliberate departures, documented because the final Markdown renderer is a
// full CommonMark implementation and this is a line scanner:
//   - any amount of leading spaces opens a fence (answers put fences under
//     list items; a 4-space "indented code block" holding a literal fence line
//     does not occur in model output);
//   - a fence on a list item's own line ("1. ```bash") opens a block, as it
//     does in CommonMark. (It used to be read as prose — and then its CLOSING
//     fence was read as an opening one, which swallowed every block after it,
//     a diagram included.)
//   - a fence inside a blockquote ("> ```") is left as prose.
//
// A line only counts once it is complete (its newline has arrived) unless the
// caller says the text is final. That is what stops a half-arrived "```" from
// being read as a closing fence one token early.

/**
 * Language tags that mean "this fence is a visual artifact", and which kind.
 * Explicit tags only: an untagged or differently tagged block is ordinary code,
 * whatever it contains.
 *
 *   mermaid            Mermaid source (drawn by the bundled Mermaid)
 *   natively-chart     a chart payload (chartSpec.mjs)
 *   natively-diagram   a notation model: Chen ER, a formal automaton
 */
export const VISUAL_FENCE_LANGS = Object.freeze({ mermaid: 'mermaid', 'natively-chart': 'chart', 'natively-diagram': 'notation' });
/** Block kinds that are drawn as a card rather than shown as code. */
export const VISUAL_BLOCK_KINDS = Object.freeze(['mermaid', 'chart', 'notation']);
/** The tag a block of a given visual kind is written with. */
export const VISUAL_FENCE_TAG = Object.freeze({ mermaid: 'mermaid', chart: 'natively-chart', notation: 'natively-diagram' });

/** Is this parsed block a visual artifact (of any kind)? */
export function isVisualBlock(block) {
  return Boolean(block) && (block.kind === 'mermaid' || block.kind === 'chart' || block.kind === 'notation');
}

/** Cheap text check: does this text name any visual fence tag at all? */
export function mentionsVisualTag(text) {
  // Any case: the scanner lower-cases a fence's language, so "```Mermaid" is a
  // diagram to it and must be one to every gate in front of it.
  return typeof text === 'string' && VISUAL_TAG_ANYWHERE_RE.test(text);
}
const VISUAL_TAG_ANYWHERE_RE = /mermaid|natively-chart|natively-diagram/i;

// Leading spaces, then optionally one list marker ("- ", "1. ", "2) ").
const OPEN_RE = /^( *(?:(?:[-*+]|\d{1,9}[.)]) +)?)(`{3,}|~{3,})([^\n]*)$/;

function stripLineEnding(line) {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  // (A lone "\r" too: a final text that ends "```\r" has closed its block.)
  if (line.endsWith('\n') || line.endsWith('\r')) return line.slice(0, -1);
  return line;
}

function matchOpeningFence(lineBody) {
  const m = OPEN_RE.exec(lineBody);
  if (!m) return null;
  const marker = m[2];
  const info = m[3].trim();
  // CommonMark: a backtick fence's info string cannot contain backticks
  // (otherwise "```js```" on one line would open a block).
  if (marker[0] === '`' && info.includes('`')) return null;
  const lang = (info.split(/\s+/)[0] || '').toLowerCase();
  const listed = /\S/.test(m[1]);
  // On a list item's line a fence carries at most a language: "1. ```bash".
  // "- ``` opens a code block" is a sentence about fences, and read as an
  // opening fence it swallowed everything up to the next one.
  if (listed && /\s/.test(info)) return null;
  return { indent: m[1].length, char: marker[0], len: marker.length, info, lang, listed };
}

function isClosingFence(lineBody, fence) {
  let i = 0;
  while (i < lineBody.length && lineBody[i] === ' ') i += 1;
  if (i > fence.indent + 3) return false;
  let run = 0;
  while (i < lineBody.length && lineBody[i] === fence.char) {
    run += 1;
    i += 1;
  }
  if (run < fence.len) return false;
  for (; i < lineBody.length; i += 1) {
    if (lineBody[i] !== ' ' && lineBody[i] !== '\t') return false;
  }
  return true;
}

/** Could this partial last line still grow into the closing fence? */
function couldBecomeClosingFence(partial, fence) {
  let i = 0;
  while (i < partial.length && partial[i] === ' ') i += 1;
  if (i > fence.indent + 3) return false;
  let run = 0;
  while (i < partial.length && partial[i] === fence.char) {
    run += 1;
    i += 1;
  }
  if (i === partial.length) return true; // spaces + fence chars only so far
  if (run < fence.len) return false;
  for (; i < partial.length; i += 1) {
    if (partial[i] !== ' ' && partial[i] !== '\t' && partial[i] !== '\r') return false;
  }
  return true;
}

/**
 * Classify a partial last line seen outside any fence.
 *  - 'opening-fence': 3+ fence characters are already there; only the info
 *    string (the language tag) is still arriving.
 *  - 'maybe-fence': spaces and one or two fence characters — may become a
 *    fence, may become inline code. Hold it back rather than paint it.
 *  - 'prose': ordinary text.
 */
function classifyPartialOutside(partial) {
  if (/^ *(?:(?:[-*+]|\d{1,9}[.)]) +)?(`{3,}|~{3,})/.test(partial)) {
    const m = OPEN_RE.exec(partial);
    if (m && !(m[2][0] === '`' && m[3].includes('`'))) return 'opening-fence';
    return 'prose';
  }
  if (/^ *(`{1,2}|~{1,2})$/.test(partial)) return 'maybe-fence';
  return 'prose';
}

function removeIndent(content, indent, listed = false) {
  if (!indent) return content;
  if (listed) {
    // Under a list marker the content may be indented to the item's text or
    // not at all. Only what EVERY line shares is the item's indentation; the
    // rest is the block's own (a mind map is nothing but indentation).
    let shared = indent;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      shared = Math.min(shared, line.length - line.trimStart().length);
      if (shared === 0) return content;
    }
    return content.replace(new RegExp(`^ {${shared}}`, 'gm'), '');
  }
  const re = new RegExp(`^ {1,${indent}}`, 'gm');
  return content.replace(re, '');
}

function kindForLang(lang) {
  return Object.prototype.hasOwnProperty.call(VISUAL_FENCE_LANGS, lang) ? VISUAL_FENCE_LANGS[lang] : 'code';
}

const isVisualKind = (kind) => kind === 'mermaid' || kind === 'chart' || kind === 'notation';

function newState() {
  return {
    text: '',
    /** Offset of the first line not yet settled. */
    offset: 0,
    /** Settled blocks (prose + closed fences), in document order. */
    blocks: [],
    /** Start offset of the prose run currently being accumulated. */
    proseStart: 0,
    /** The fence we are inside, if any. */
    fence: null,
    fenceCount: 0,
    mermaidCount: 0,
  };
}

function pushProse(state, end) {
  if (end > state.proseStart) {
    state.blocks.push({
      kind: 'prose',
      start: state.proseStart,
      end,
      text: state.text.slice(state.proseStart, end),
    });
  }
}

function fenceBlock(state, fence, contentEnd, end, closed) {
  const raw = state.text.slice(fence.contentStart, contentEnd);
  // The newline before the closing fence belongs to the fence line, not the
  // content.
  const trimmed = raw.endsWith('\r\n') ? raw.slice(0, -2) : raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  return {
    kind: fence.kind,
    lang: fence.lang,
    info: fence.info,
    fenceChar: fence.char,
    fenceLength: fence.len,
    start: fence.start,
    end,
    contentStart: fence.contentStart,
    source: removeIndent(trimmed, fence.indent, fence.listed === true),
    closed,
    fenceIndex: fence.fenceIndex,
    diagramIndex: fence.diagramIndex,
  };
}

/** Consume every complete line from state.offset onward. */
function settleCompleteLines(state) {
  const text = state.text;
  while (state.offset < text.length) {
    const nl = text.indexOf('\n', state.offset);
    if (nl === -1) break;
    const lineStart = state.offset;
    const lineEnd = nl + 1;
    const body = stripLineEnding(text.slice(lineStart, lineEnd));
    if (state.fence) {
      if (isClosingFence(body, state.fence)) {
        state.blocks.push(fenceBlock(state, state.fence, lineStart, lineEnd, true));
        state.fence = null;
        state.proseStart = lineEnd;
      }
    } else {
      const open = matchOpeningFence(body);
      if (open) {
        pushProse(state, lineStart);
        const kind = kindForLang(open.lang);
        state.fence = {
          ...open,
          kind,
          start: lineStart,
          contentStart: lineEnd,
          fenceIndex: state.fenceCount,
          // The ordinal among the answer's visual blocks, of every kind.
          diagramIndex: isVisualKind(kind) ? state.mermaidCount : -1,
        };
        state.fenceCount += 1;
        if (isVisualKind(kind)) state.mermaidCount += 1;
      }
    }
    state.offset = lineEnd;
  }
}

/**
 * Build the caller-facing view: settled blocks plus whatever the unsettled
 * tail currently is. Never mutates the settled state, so it can be called for
 * every token.
 */
function snapshot(state, final) {
  const text = state.text;
  const blocks = state.blocks.slice();
  const partial = text.slice(state.offset);
  let tail = { kind: 'none', text: '' };

  if (state.fence) {
    const fence = state.fence;
    if (final) {
      // End of the answer inside a fence. A last line that is a valid closing
      // fence without its newline still closes the block; anything else means
      // the block was cut off.
      if (partial && isClosingFence(stripLineEnding(partial), fence)) {
        blocks.push(fenceBlock(state, fence, state.offset, text.length, true));
      } else {
        blocks.push(fenceBlock(state, fence, text.length, text.length, false));
      }
    } else {
      const held = partial && couldBecomeClosingFence(partial, fence);
      const contentEnd = held ? state.offset : text.length;
      blocks.push(fenceBlock(state, fence, contentEnd, text.length, false));
      tail = held ? { kind: 'maybe-closing-fence', text: partial } : { kind: 'none', text: '' };
    }
  } else if (final) {
    if (partial) {
      const open = matchOpeningFence(partial);
      if (open) {
        // The answer ended on an opening fence line: an empty, unclosed block.
        if (state.offset > state.proseStart) {
          blocks.push({
            kind: 'prose',
            start: state.proseStart,
            end: state.offset,
            text: text.slice(state.proseStart, state.offset),
          });
        }
        const kind = kindForLang(open.lang);
        blocks.push({
          kind,
          lang: open.lang,
          info: open.info,
          fenceChar: open.char,
          fenceLength: open.len,
          start: state.offset,
          end: text.length,
          contentStart: text.length,
          source: '',
          closed: false,
          fenceIndex: state.fenceCount,
          diagramIndex: isVisualKind(kind) ? state.mermaidCount : -1,
        });
        return { blocks, tail, final: true };
      }
    }
    if (text.length > state.proseStart) {
      blocks.push({
        kind: 'prose',
        start: state.proseStart,
        end: text.length,
        text: text.slice(state.proseStart),
      });
    }
  } else {
    const cls = partial ? classifyPartialOutside(partial) : 'prose';
    const proseEnd = cls === 'prose' ? text.length : state.offset;
    if (proseEnd > state.proseStart) {
      blocks.push({
        kind: 'prose',
        start: state.proseStart,
        end: proseEnd,
        text: text.slice(state.proseStart, proseEnd),
      });
    }
    if (cls !== 'prose') tail = { kind: cls, text: partial };
  }
  return { blocks, tail, final: Boolean(final) };
}

/**
 * Parse a whole answer (or a prefix of one).
 *
 * @param {string} text
 * @param {{ final?: boolean }} [options] final=true (default) means no more
 *   text is coming; final=false means `text` is a streaming prefix.
 */
export function parseFencedBlocks(text, options = {}) {
  const final = options.final !== false;
  const state = newState();
  state.text = typeof text === 'string' ? text : '';
  settleCompleteLines(state);
  return snapshot(state, final);
}

/**
 * Incremental tracker for a growing answer. `update(fullText)` resumes from
 * the last settled line when the new text extends the old one, and starts
 * over when it does not (an authoritative final text replacing the stream).
 */
export function createFencedBlockTracker() {
  let state = newState();
  return {
    update(fullText, options = {}) {
      const text = typeof fullText === 'string' ? fullText : '';
      if (!text.startsWith(state.text)) state = newState();
      state.text = text;
      settleCompleteLines(state);
      return snapshot(state, options.final === true);
    },
    reset() {
      state = newState();
    },
  };
}

/** True when the text holds (or is in the middle of opening) a Mermaid fence. */
export function hasMermaidFence(text, options = {}) {
  if (typeof text !== 'string' || text.indexOf('mermaid') === -1) return false;
  return parseFencedBlocks(text, options).blocks.some((b) => b.kind === 'mermaid');
}

/** The Mermaid blocks of an answer, in order. */
export function extractMermaidBlocks(text, options = {}) {
  return parseFencedBlocks(text, options).blocks.filter((b) => b.kind === 'mermaid');
}

/** True when the text holds (or is in the middle of opening) a visual block of any kind. */
export function hasVisualFence(text, options = {}) {
  if (!mentionsVisualTag(text)) return false;
  return parseFencedBlocks(text, options).blocks.some(isVisualBlock);
}

/** The visual blocks of an answer (Mermaid, chart, notation), in order. */
export function extractVisualBlocks(text, options = {}) {
  if (!mentionsVisualTag(text)) return [];
  return parseFencedBlocks(text, options).blocks.filter(isVisualBlock);
}

/** The answer with every Mermaid fence removed (prose and ordinary code kept). */
export function stripMermaidBlocks(text) {
  const { blocks } = parseFencedBlocks(text, { final: true });
  let out = '';
  for (const b of blocks) {
    if (b.kind === 'mermaid') continue;
    out += text.slice(b.start, b.end);
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Replace the n-th Mermaid block's source, keeping everything else byte for
 * byte. Used when a repaired diagram replaces a broken one in the same answer.
 */
export function replaceMermaidBlock(text, diagramIndex, newSource) {
  const { blocks } = parseFencedBlocks(text, { final: true });
  const target = blocks.find((b) => b.kind === 'mermaid' && b.diagramIndex === diagramIndex);
  if (!target) return text;
  const fence = target.fenceChar.repeat(target.fenceLength);
  // The opening line is kept exactly as written — its indentation (a block
  // under a list item stays under it) and its info words ("mermaid source").
  const opening = text.slice(target.start, target.contentStart);
  const indent = /^[ \t]*/.exec(opening)[0];
  const openLine = /\n$/.test(opening) ? opening : `${opening}\n`;
  const body = String(newSource)
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
  const replacement = `${openLine}${body}\n${indent}${fence}\n`;
  const after = text.slice(target.end);
  return text.slice(0, target.start) + (after ? replacement : replacement.replace(/\n$/, '')) + after;
}

/**
 * Replace the Mermaid block whose source is exactly `originalSource` with
 * `newSource`. Exact match only (after newline normalisation and trimming), so
 * a repair can never land in a different diagram or a different answer.
 * Returns the text unchanged when no block matches.
 */
export function replaceMermaidSource(text, originalSource, newSource) {
  if (typeof text !== 'string' || text.indexOf('mermaid') === -1) return text;
  const norm = (v) => String(v ?? '').replace(/\r\n?/g, '\n').trim();
  const wanted = norm(originalSource);
  if (!wanted) return text;
  const target = parseFencedBlocks(text, { final: true }).blocks.find((b) => b.kind === 'mermaid' && norm(b.source) === wanted);
  return target ? replaceMermaidBlock(text, target.diagramIndex, newSource) : text;
}
