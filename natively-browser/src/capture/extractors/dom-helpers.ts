/**
 * Smart Browser Context v2 — shared pure DOM helpers for the extractors.
 *
 * Self-contained (does not import the gold extract.ts, so that file stays
 * byte-identical). All helpers are dependency-injected on a Document and never
 * touch globals, so they unit-test under `node --test` with a tiny fake DOM.
 *
 * SECURITY: no eval, no Function, no execution of page-provided script. Embedded
 * JSON is read with JSON.parse only. Nothing here runs page code.
 */

import { inlineFormulas, type InlineFormulasOptions } from '../../math-text';

/** Collapse whitespace but preserve paragraph breaks. */
export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Blocks set apart by a blank line, and blocks that only start a new line: a
// Codeforces sample test is a <pre> of one <div> per line, and a blank line
// between each would end its section after the first line (sliceSection).
const PARAGRAPH_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'section', 'article',
  'header', 'footer', 'dl',
]);
const LINE_TAGS = new Set(['div', 'li', 'pre', 'tr', 'dt', 'dd']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg']);
// Table cells sit side by side: keep a gap between them, or "N" and "10^5" in
// a constraints table read as "N10^5".
const CELL_TAGS = new Set(['td', 'th']);
// Where the page's own line breaks are the text's, as in a sample input.
const VERBATIM_TAGS = new Set(['pre', 'code', 'textarea']);
const LINE_BREAK = '\u0001';
const PARAGRAPH_BREAK = '\u0002';

/**
 * Text of a DETACHED node with line breaks at block boundaries. innerText
 * would do this on the live page, but a clone has no layout, and Chrome then
 * returns its textContent: "A. Theatre Square" ran into "time limit per test",
 * and "Constraints" into the sample input. Source line breaks outside
 * <pre>/<code> are spaces, as innerText makes them. A shim node without
 * childNodes is read as its textContent.
 */
export function blockText(root: Node): string {
  if (!root.childNodes) return collapseWhitespace(root.textContent || '');
  const out: string[] = [];
  const walk = (node: Node, verbatim: boolean) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3) {
        const data = (child as Text).data;
        out.push(verbatim ? data : data.replace(/\s+/g, ' '));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = (child.nodeName || '').toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === 'br') {
        out.push(LINE_BREAK);
        continue;
      }
      const brk = PARAGRAPH_TAGS.has(tag) ? PARAGRAPH_BREAK : LINE_TAGS.has(tag) ? LINE_BREAK : '';
      out.push(brk);
      if (tag === 'li') out.push('- ');
      walk(child, verbatim || VERBATIM_TAGS.has(tag));
      out.push(brk);
      if (CELL_TAGS.has(tag)) out.push(' ');
    }
  };
  walk(root, false);
  // Adjacent boundaries make one break, the widest of them. Whitespace around
  // a break is dropped, a <pre>'s own closing newline too.
  const text = out
    .join('')
    .replace(/[ \t\r\n]*[\u0001\u0002][\u0001\u0002 \t\r\n]*/g, (run) => (run.includes(PARAGRAPH_BREAK) ? '\n\n' : '\n'));
  return collapseWhitespace(text);
}

/**
 * Text of `el` with rendered formulas replaced by their text, or by the
 * UNREADABLE_FORMULA marker when the page has none (#645), and line breaks at
 * block boundaries (blockText). Reads a clone, so the live page is untouched.
 * Script/style text is dropped after the formulas are inlined: MathJax 2 keeps
 * each TeX source in a <script> beside the formula, which would otherwise
 * print every formula twice. `formulas` can mark the ones with no text for an
 * image instead (FormulaTokens).
 */
function textOf(el: Node | null | undefined, formulas?: InlineFormulasOptions): string {
  if (!el) return '';
  try {
    const clone = el.cloneNode(true);
    inlineFormulas(clone as never, formulas);
    try {
      (clone as ParentNode)
        .querySelectorAll?.('script, style, noscript, template')
        .forEach((n) => n.parentNode?.removeChild(n));
    } catch {
      /* shim without querySelectorAll */
    }
    return blockText(clone);
  } catch {
    return el.textContent || '';
  }
}

/**
 * `nodes` without the ones inside another of them. HackerRank nests one
 * `.problem-statement` in another, which read as the statement twice.
 */
export function outermost<T extends Node>(nodes: ArrayLike<T>): T[] {
  const list = Array.from(nodes);
  const set = new Set<Node>(list);
  return list.filter((n) => {
    for (let p = n.parentNode; p; p = p.parentNode) if (set.has(p)) return false;
    return true;
  });
}

/** Trimmed textContent of the first element matching any selector, or ''. */
export function firstText(doc: ParentNode, selectors: string[] | undefined, formulas?: InlineFormulasOptions): string {
  if (!selectors) return '';
  for (const sel of selectors) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(sel);
    } catch {
      continue;
    }
    const t = textOf(el, formulas).trim();
    if (t) return collapseWhitespace(t);
  }
  return '';
}

/** Concatenated text of every element matching any selector. */
export function allText(
  doc: ParentNode,
  selectors: string[] | undefined,
  cap = 8000,
  formulas?: InlineFormulasOptions,
): string {
  if (!selectors) return '';
  const parts: string[] = [];
  for (const sel of selectors) {
    let nodes: NodeListOf<Element> | null = null;
    try {
      nodes = doc.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const n of outermost(nodes ?? [])) {
      const t = textOf(n, formulas).trim();
      if (t) parts.push(t);
    }
    if (parts.length) break; // first selector that yields content wins
  }
  const joined = collapseWhitespace(parts.join('\n'));
  return joined.length > cap ? joined.slice(0, cap) : joined;
}

/**
 * Extract verbatim editor code from Monaco / CodeMirror / Ace / textarea.
 * Whitespace is PRESERVED (this is code). Returns '' if no editor is found.
 */
export function extractEditorCode(doc: ParentNode, extraSelectors?: string[], cap = 8000): string {
  const chunks: string[] = [];
  // Keyed without whitespace: the same code read once per line and once as a
  // run-together textContent ("class Solution {public:") is one chunk.
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = (raw || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    const key = t.replace(/\s+/g, '');
    if (t.length < 2 || seen.has(key)) return;
    seen.add(key);
    chunks.push(t);
  };
  /** An editor's lines joined by newlines, or its textContent when it has no line elements. */
  const editorText = (el: Element): string | null => {
    const lines = el.querySelectorAll('.view-line, .cm-line, .CodeMirror-line, .ace_line');
    return lines.length ? Array.from(lines).map((l) => l.textContent || '').join('\n') : el.textContent;
  };

  const safeQuery = (sel: string): Element[] => {
    try {
      return Array.from(doc.querySelectorAll(sel));
    } catch {
      return [];
    }
  };

  // Monaco: each line in .view-line.
  for (const ed of safeQuery('.monaco-editor .view-lines, .monaco-editor')) {
    const lines = ed.querySelectorAll('.view-line');
    if (lines.length) push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
  }
  // CodeMirror 6 (.cm-content/.cm-line) and CM5 (.CodeMirror-code/.CodeMirror-line).
  for (const ed of safeQuery('.cm-content, .CodeMirror-code')) {
    const lines = ed.querySelectorAll('.cm-line, .CodeMirror-line');
    if (lines.length) push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    else push(ed.textContent);
  }
  // Ace editor (.ace_content / .ace_line).
  for (const ed of safeQuery('.ace_content')) {
    const lines = ed.querySelectorAll('.ace_line');
    if (lines.length) push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    else push(ed.textContent);
  }
  // Plain <textarea> editors.
  for (const ta of safeQuery('textarea')) {
    const v = (ta as HTMLTextAreaElement).value || ta.textContent;
    if (v) push(v);
  }
  // Any platform-specific code selectors.
  if (extraSelectors) {
    for (const sel of extraSelectors) {
      for (const el of safeQuery(sel)) push(editorText(el));
    }
  }

  const joined = chunks.join('\n\n');
  return joined.length > cap ? joined.slice(0, cap) + '\n…(code truncated)' : joined;
}

/** Capture <pre> blocks (problem examples / I-O), preserving whitespace. */
export function extractPreBlocks(doc: ParentNode, cap = 4000): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let nodes: NodeListOf<Element> | null = null;
  try {
    nodes = doc.querySelectorAll('pre');
  } catch {
    return '';
  }
  nodes?.forEach((el) => {
    const t = (el.textContent || '').replace(/\r\n?/g, '\n').trim();
    if (t.length >= 2 && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  });
  const joined = parts.join('\n\n');
  return joined.length > cap ? joined.slice(0, cap) : joined;
}

/**
 * Find a substring of `body` that begins at a signal keyword (e.g. "Constraints")
 * and runs to the next blank line / next signal. Best-effort, returns '' if not
 * found. Used to slice constraints/examples/IO sections out of the problem text.
 */
export function sliceSection(body: string, signals: string[] | undefined, maxLen = 1200): string {
  if (!signals || !body) return '';
  const from = (idx: number, sig: string): string => {
    const tail = body.slice(idx, idx + maxLen);
    // Stop at a double-newline boundary if there is one well past the heading.
    const end = tail.indexOf('\n\n', sig.length + 4);
    return (end > 0 ? tail.slice(0, end) : tail).trim();
  };
  // A heading first: the signal at the start of a line, in its own case.
  // Codeforces' header row reads "input / standard input" above the "Input"
  // section, and "For example" comes mid-sentence before the "Example" heading.
  for (const sig of signals) {
    for (let idx = body.indexOf(sig); idx !== -1; idx = body.indexOf(sig, idx + 1)) {
      if (idx === 0 || body[idx - 1] === '\n') return from(idx, sig);
    }
  }
  const lower = body.toLowerCase();
  for (const sig of signals) {
    const idx = lower.indexOf(sig.toLowerCase());
    if (idx !== -1) return from(idx, sig);
  }
  return '';
}

/** `body.innerText`-style fallback with script/style removed. */
export function bodyInnerText(doc: Document, cap = 12000, formulas?: InlineFormulasOptions): string {
  const body = doc.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  // Formulas first: MathJax 2 keeps each TeX source in a <script> dropped below.
  inlineFormulas(clone as never, formulas);
  try {
    clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.parentNode?.removeChild(n));
  } catch {
    /* shim without querySelectorAll */
  }
  // A detached clone's innerText is its textContent in Chrome (no layout), so
  // a real node is read block by block; innerText only for a shim without one.
  const text = clone.childNodes
    ? blockText(clone)
    : ((clone as { innerText?: string }).innerText ?? clone.textContent ?? '');
  const out = collapseWhitespace(text);
  return out.length > cap ? out.slice(0, cap) : out;
}

/**
 * Safely read embedded JSON page state by id (e.g. __NEXT_DATA__). JSON.parse
 * ONLY — never eval. Returns null on any problem.
 */
export function readEmbeddedJson(doc: Document, ids: string[]): unknown {
  for (const id of ids) {
    let el: Element | null = null;
    try {
      el = doc.getElementById?.(id) ?? doc.querySelector(`#${id}`);
    } catch {
      continue;
    }
    const raw = el?.textContent;
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      /* not valid JSON — skip */
    }
  }
  return null;
}
