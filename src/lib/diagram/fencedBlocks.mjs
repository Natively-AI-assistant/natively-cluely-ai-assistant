// Fenced-block scanner shared by every surface that shows an AI answer.
//
// One answer is Markdown that may hold prose, ordinary code fences and
// explicitly tagged ```mermaid fences. The live overlay sees that text grow a
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
//   - a fence inside a blockquote ("> ```") is left as prose.
//
// A line only counts once it is complete (its newline has arrived) unless the
// caller says the text is final. That is what stops a half-arrived "```" from
// being read as a closing fence one token early.

/** Language tags that mean "this fence is a Mermaid diagram". Explicit only. */
const MERMAID_LANGS = new Set(['mermaid']);

const OPEN_RE = /^( *)(`{3,}|~{3,})([^\n]*)$/;

function stripLineEnding(line) {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\n')) return line.slice(0, -1);
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
  return { indent: m[1].length, char: marker[0], len: marker.length, info, lang };
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
  if (/^ *(`{3,}|~{3,})/.test(partial)) {
    const m = OPEN_RE.exec(partial);
    if (m && !(m[2][0] === '`' && m[3].includes('`'))) return 'opening-fence';
    return 'prose';
  }
  if (/^ *(`{1,2}|~{1,2})$/.test(partial)) return 'maybe-fence';
  return 'prose';
}

function removeIndent(content, indent) {
  if (!indent) return content;
  const re = new RegExp(`^ {1,${indent}}`, 'gm');
  return content.replace(re, '');
}

function kindForLang(lang) {
  return MERMAID_LANGS.has(lang) ? 'mermaid' : 'code';
}

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
    source: removeIndent(trimmed, fence.indent),
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
          diagramIndex: kind === 'mermaid' ? state.mermaidCount : -1,
        };
        state.fenceCount += 1;
        if (kind === 'mermaid') state.mermaidCount += 1;
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
          diagramIndex: kind === 'mermaid' ? state.mermaidCount : -1,
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
  const body = String(newSource).replace(/\s+$/, '');
  const replacement = `${fence}mermaid\n${body}\n${fence}\n`;
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
