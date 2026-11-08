/**
 * Pure DOM -> clean-text extraction.
 *
 * This is the single biggest quality lever for the whole feature: the desktop
 * read-and-clears `window.lastCapturedDOM` once per "What to say", so whatever
 * we send here is the entire browser context the model sees. We deliberately
 * do NOT send raw innerHTML (mostly markup noise that blows the 25k budget on
 * `<svg>`/`<script>`/inline-style cruft). Instead:
 *
 *   1. Mozilla Readability on a clone of the document -> clean article/job/doc text.
 *      On a known coding platform the registry's statement container wins
 *      instead: Readability keeps only the highest-scoring section there
 *      (HackerRank: Sample Input/Output), losing the statement and Constraints.
 *   2. Fallback to `body.innerText` (script/style/noscript excluded) for app-like
 *      pages where Readability returns null.
 *   3. Prepend page <title>, the user's current selection, and the visible
 *      <h1..h3> heading hierarchy.
 *   4. Cap at DOM_CONTEXT_MAX_CHARS, trimming the body from the END so the
 *      title + selection (the highest-signal front matter) always survive.
 *
 * Before 1 and 2, rendered formulas in the clone are replaced with their text
 * (math-text.ts). A formula drawn only as SVG paths becomes
 * `[formula N, see image]` and its SVG is returned in `formulas`, for the
 * content script to draw into an image (formula-sheet.ts) that goes with the
 * text; finishFormulaImages then turns the ones it could not draw into
 * `[formula not captured]`, counted in `unreadableFormulas`. The selection
 * gets the same treatment when it holds a formula.
 *
 * Everything here is dependency-injected (document, a Readability factory, a
 * selection getter) so it can be unit-tested under `node --test` with a tiny
 * fake DOM and no browser.
 */

import {
  containsFormula,
  countFormulaMarkers,
  countUnreadableFormulas,
  FORMULA_IN_IMAGE_RE,
  formulaInImage,
  FormulaTokens,
  FORMULAS_NOTE,
  inlineFormulas,
  TOKEN_RE,
  UNREADABLE_FORMULA,
  type InlineFormulasOptions,
} from './math-text';
import { DEFAULT_REGISTRY, findPlatform, normalizeHost } from './capture/registry/registry';
import { blockText, outermost } from './capture/extractors/dom-helpers';

// Mirror of DOM_CONTEXT_MAX_CHARS in electron/config/constants.ts and
// src/constants/domCapture.ts. This is a separate package so we cannot import
// the desktop constant; keep this value in sync with those two.
export const DOM_CONTEXT_MAX_CHARS = 25000;

/** Minimal structural view of a Readability result. */
export interface ReadabilityResult {
  title?: string | null;
  textContent?: string | null;
}

/** A Readability-like parser. The real one is `new Readability(doc).parse()`. */
export type ReadabilityFactory = (doc: Document) => { parse(): ReadabilityResult | null };

export interface ExtractDeps {
  /** The live document to read from. */
  document: Document;
  /**
   * Builds a Readability parser over a CLONE of the document. Cloning matters:
   * Readability mutates the DOM it parses, so we must never hand it the live one.
   */
  readabilityFactory?: ReadabilityFactory;
  /** Returns the user's current text selection, if any. */
  getSelection?: () => string;
  /**
   * A detached copy of the selection's markup, or null when nothing is
   * selected. Read instead of getSelection when it holds a formula, whose SVG
   * has no text in getSelection's string.
   */
  getSelectionFragment?: () => Node | null;
  /**
   * Self-contained SVG markup for a formula with no text (its outer element),
   * or null when it cannot be drawn. Without it, such formulas are sent as
   * UNREADABLE_FORMULA.
   */
  serializeFormula?: (formula: Element) => string | null;
}

export type PageType = 'coding' | 'article' | 'app';

export interface ExtractResult {
  /** The final, capped text to POST as `{ dom: ... }`. */
  text: string;
  /** Which body path produced the content — useful for the popup status. */
  source: 'readability' | 'statement' | 'innertext' | 'selection' | 'empty';
  /** Page title, post-trim, for telemetry/popup. */
  title: string;
  /** Detected page class, biasing extraction + shown in the desktop chip. */
  pageType: PageType;
  /** First non-empty content line, for the desktop preview chip. */
  firstLine: string;
  /**
   * Formulas in the sent text that had no text equivalent on the page (drawn
   * only as SVG paths) and show as UNREADABLE_FORMULA. Above 0, the text alone
   * is missing part of the page.
   */
  unreadableFormulas: number;
  /** SVG markup of formula N at index N - 1, for each `[formula N, see image]` in `text`. */
  formulas: string[];
}

/** Formula markers of every kind, placeholders included. */
function formulaGaps(text: string): number {
  return countFormulaMarkers(text) + (text.match(TOKEN_RE) || []).length;
}

/**
 * The capture after the content script tried to draw its formulas: each
 * `[formula N, see image]` whose N is not in `drawn` becomes UNREADABLE_FORMULA.
 */
export function finishFormulaImages(result: ExtractResult, drawn: ReadonlySet<number>): ExtractResult {
  if (!result.formulas.length) return result;
  // A formula that repeats has one number: missing, it counts once.
  const missing = new Set<number>();
  const text = result.text.replace(FORMULA_IN_IMAGE_RE, (marker, n: string) => {
    if (drawn.has(Number(n))) return marker;
    missing.add(Number(n));
    return UNREADABLE_FORMULA;
  });
  return {
    ...result,
    text,
    firstLine: firstContentLine(text),
    unreadableFormulas: countUnreadableFormulas(result.text.replace(FORMULAS_NOTE, '')) + missing.size,
    formulas: result.formulas.map((svg, i) => (drawn.has(i + 1) ? svg : '')),
  };
}

function collapseWhitespace(s: string): string {
  // Collapse runs of whitespace but PRESERVE paragraph breaks (double newline)
  // so the model still sees document structure.
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `body.innerText` with script/style/noscript subtrees removed first. */
function innerTextFallback(doc: Document, formulas: InlineFormulasOptions): string {
  const body = doc.body;
  if (!body) return '';
  // Clone so we can strip non-content nodes without touching the live page.
  const clone = body.cloneNode(true) as HTMLElement;
  // Formulas first: MathJax 2 keeps each TeX source in a <script> dropped below.
  inlineFormulas(clone as never, formulas);
  const drop = clone.querySelectorAll('script, style, noscript, template');
  drop.forEach((n) => n.parentNode?.removeChild(n));
  // A detached clone's innerText is its textContent in Chrome (no layout), so
  // a real node is read block by block; innerText only for a shim without one.
  const text = clone.childNodes
    ? blockText(clone)
    : ((clone as { innerText?: string }).innerText ?? clone.textContent ?? '');
  return collapseWhitespace(text);
}

/**
 * The problem statement of a known coding platform, read from the registry's
 * statement selectors on a clone with formulas inlined. '' when the page is
 * not a known platform or the selectors match nothing.
 */
function platformStatement(doc: Document, formulas: InlineFormulasOptions): string {
  let host = '';
  let url = '';
  try {
    host = (doc as any).location?.hostname || '';
    url = (doc as any).location?.href || '';
  } catch { /* no location in tests */ }
  if (!host) return '';
  const rule = findPlatform(DEFAULT_REGISTRY, normalizeHost(host), url);
  const selectors = rule?.platformHints?.statementSelectors;
  if (!selectors?.length) return '';
  for (const sel of selectors) {
    let nodes: Element[] = [];
    try {
      nodes = outermost(doc.querySelectorAll(sel));
    } catch {
      continue;
    }
    const parts: string[] = [];
    for (const el of nodes) {
      const clone = el.cloneNode(true) as Element;
      inlineFormulas(clone as never, { ...formulas, sources: doc as never });
      const t = blockText(clone);
      if (t) parts.push(t);
    }
    if (parts.length) return parts.join('\n\n'); // first selector with content wins
  }
  return '';
}

/** Visible <h1..h3> headings, in document order, as a hierarchy outline. */
function headingOutline(doc: Document): string {
  const nodes = doc.querySelectorAll('h1, h2, h3');
  const lines: string[] = [];
  nodes.forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const depth = el.tagName === 'H1' ? '' : el.tagName === 'H2' ? '  ' : '    ';
    lines.push(`${depth}${t}`);
  });
  // De-dup consecutive identical headings (common in sticky/duplicated headers).
  const out: string[] = [];
  for (const l of lines) {
    if (out[out.length - 1] !== l) out.push(l);
  }
  return out.join('\n');
}

/**
 * Extract code VERBATIM from the page — the single most important thing for
 * coding sites (LeetCode, HackerRank, online judges). Readability and innerText
 * mangle or drop starter code: `<pre>`/`<code>` lose their newlines under
 * whitespace-collapse, and Monaco/CodeMirror editors render to virtualized DOM
 * whose innerText is empty or scrambled. If we don't capture the exact function
 * signature / starter structure here, the model reconstructs it from memory and
 * hallucinates variable names and the wrong skeleton.
 *
 * We pull, in order: <pre> (problem examples / I-O), real <code> blocks, and the
 * live editor text from Monaco (.view-lines) and CodeMirror (.cm-content / .CodeMirror-code).
 * Whitespace is PRESERVED (these are code).
 */
function extractCodeBlocks(doc: Document): string {
  const seen = new Set<string>();
  const chunks: string[] = [];
  const push = (raw: string | null | undefined) => {
    const t = (raw || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    // Keep only multi-char, non-duplicate blocks that look like code/IO (newlines
    // or code-ish punctuation), to avoid pulling prose styled as <code>.
    if (t.length < 2 || seen.has(t)) return;
    if (t.length > 40 || /[\n;{}()\[\]=:]/.test(t)) {
      seen.add(t);
      chunks.push(t);
    }
  };

  // A <sup>/<sub> inside code is an exponent or index, never a code character:
  // LeetCode's `10<sup>4</sup>` would otherwise read "104". Only those blocks
  // are read from a clone; the rest stay verbatim.
  const codeText = (el: Element): string | null => {
    try {
      if (!el.querySelector?.('sup, sub')) return el.textContent;
      const clone = el.cloneNode(true);
      inlineFormulas(clone as never);
      return clone.textContent;
    } catch {
      return el.textContent;
    }
  };

  // <pre> and standalone <code> (skip <code> nested in <pre> — already captured).
  doc.querySelectorAll('pre').forEach((el) => push(codeText(el)));
  doc.querySelectorAll('code').forEach((el) => {
    if (!el.closest('pre')) push(codeText(el));
  });

  // Live editors. Monaco renders each line in .view-line; join with newlines.
  doc.querySelectorAll('.monaco-editor .view-lines, .monaco-editor').forEach((ed) => {
    const lines = ed.querySelectorAll('.view-line');
    if (lines.length) {
      push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    }
  });
  // CodeMirror 6 (.cm-content / .cm-line) and CM5 (.CodeMirror-code / .CodeMirror-line).
  doc.querySelectorAll('.cm-content, .CodeMirror-code').forEach((ed) => {
    const lines = ed.querySelectorAll('.cm-line, .CodeMirror-line');
    if (lines.length) {
      push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    } else {
      push(ed.textContent);
    }
  });

  // Cap so a giant file can't dominate the budget — keep the first ~8000 chars of code.
  const joined = chunks.join('\n\n');
  return joined.length > 8000 ? joined.slice(0, 8000) + '\n…(code truncated)' : joined;
}

/** Hostnames that are coding/judge sites even if the editor isn't detected. */
const CODING_HOST_RE =
  /(^|\.)(leetcode\.com|hackerrank\.com|codeforces\.com|codechef\.com|spoj\.com|codesignal\.com|codewars\.com|hackerearth\.com|atcoder\.jp|topcoder\.com|geeksforgeeks\.org|onlinegdb\.com|replit\.com)$/i;

/**
 * Classify the page so extraction can bias what it sends:
 *   coding  — a code editor is present OR the host is a known judge → code-first.
 *   article — Readability found substantial prose → readability-first.
 *   app     — neither → innerText fallback.
 * Selection-first (in extractPageContent) overrides this.
 */
function classifyPage(doc: Document, readableLen: number, hasCode: boolean): PageType {
  // Use querySelectorAll (not querySelector) — broader DOM-shim compatibility.
  let hasEditor = false;
  try {
    hasEditor = doc.querySelectorAll('.monaco-editor, .cm-content, .CodeMirror-code').length > 0;
  } catch { /* shim without querySelectorAll — treat as no editor */ }
  let host = '';
  try {
    // `doc.location` may be absent in jsdom/test; guard it.
    host = (doc as any).location?.hostname || '';
  } catch { /* ignore */ }
  if (hasEditor || (host && CODING_HOST_RE.test(host)) || (hasCode && readableLen < 800)) {
    return 'coding';
  }
  if (readableLen >= 500) return 'article';
  return 'app';
}

/** First non-empty, non-label line of the assembled text — for the chip preview. */
function firstContentLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Skip our own front-matter labels.
    if (/^(TITLE|SELECTED TEXT|CODE ON PAGE|HEADINGS|FORMULAS)\b/.test(line)) continue;
    if (line === '---') continue;
    return line.slice(0, 160);
  }
  return '';
}

function tryReadability(
  doc: Document,
  factory: ReadabilityFactory | undefined,
  formulas: InlineFormulasOptions,
): ReadabilityResult | null {
  if (!factory) return null;
  try {
    // Readability mutates its input — always parse a clone.
    const clone = doc.cloneNode(true) as Document;
    inlineFormulas(clone as never, formulas);
    const result = factory(clone).parse();
    if (result && typeof result.textContent === 'string' && result.textContent.trim().length > 0) {
      return result;
    }
  } catch {
    /* fall through to innerText */
  }
  return null;
}

/**
 * Build the final capped payload from front matter + body.
 *
 * Front matter (title, selection, headings) is NEVER trimmed; only the body is
 * trimmed from its end. If front matter alone exceeds the budget, it is hard-cut
 * (degenerate case — a 25k <title> is not a real page).
 */
function assemble(
  title: string,
  selection: string,
  outline: string,
  code: string,
  body: string,
  limit: number,
  /** Optional hard cap on the body portion (coding pages demote prose body). */
  bodyCap?: number,
  /** Front-matter line saying some formulas could not be read. */
  formulasNote = '',
): { text: string; body: string } {
  const parts: string[] = [];
  if (title) parts.push(`TITLE: ${title}`);
  if (selection) parts.push(`SELECTED TEXT:\n${selection}`);
  // Code goes in front matter (never trimmed) and is explicitly marked verbatim so
  // the model uses the EXACT signature/structure instead of inventing one.
  if (code) parts.push(`CODE ON PAGE (verbatim — use this exact structure, names, and signature):\n${code}`);
  if (formulasNote) parts.push(formulasNote);
  if (outline) parts.push(`HEADINGS:\n${outline}`);
  const frontMatter = parts.join('\n\n');

  const cappedBody = bodyCap != null && body.length > bodyCap ? body.slice(0, bodyCap) : body;

  if (!cappedBody) return { text: frontMatter.slice(0, limit), body: '' };
  if (!frontMatter) {
    const only = cappedBody.slice(0, limit);
    return { text: only, body: only };
  }

  const separator = '\n\n---\n\n';
  const reserved = frontMatter.length + separator.length;
  if (reserved >= limit) {
    // Front matter alone fills the budget — keep as much of it as fits.
    return { text: frontMatter.slice(0, limit), body: '' };
  }
  const bodyBudget = limit - reserved;
  const trimmedBody = cappedBody.length > bodyBudget ? cappedBody.slice(0, bodyBudget) : cappedBody;
  return { text: `${frontMatter}${separator}${trimmedBody}`, body: trimmedBody };
}

/**
 * Extract clean, capped text from a document. Pure relative to its injected
 * dependencies — no global access beyond what's passed in `deps`.
 */
// A user selection of at least this many chars is treated as the PRIMARY signal —
// they highlighted the thing they care about, so don't drown it in page noise.
const SELECTION_PRIMARY_MIN = 40;
// On coding pages the prose body is demoted hard so the verbatim code dominates.
const CODING_BODY_CAP = 4000;

export function extractPageContent(deps: ExtractDeps): ExtractResult {
  const doc = deps.document;
  const limit = DOM_CONTEXT_MAX_CHARS;

  const rawTitle = (doc.title || '').replace(/\s+/g, ' ').trim();
  const tokens = new FormulaTokens(deps.serializeFormula);
  // Selection: don't collapse internal newlines for the primary-selection case so
  // highlighted code keeps its structure; light-trim only.
  const selectionRaw = selectionText(deps, tokens.options(doc));
  const selection = selectionRaw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const outline = headingOutline(doc);
  // Capture code BEFORE Readability runs (it mutates a clone, but we read the live
  // doc here so editor DOM is intact).
  const code = extractCodeBlocks(doc);

  const readable = tryReadability(doc, deps.readabilityFactory, tokens.options());
  const readableLen = readable?.textContent ? readable.textContent.trim().length : 0;
  const pageType = classifyPage(doc, readableLen, code.length > 0);

  // Readability often recovers a cleaner title than document.title.
  const title = (readable?.title || rawTitle || '').replace(/\s+/g, ' ').trim();

  // SELECTION-FIRST: if the user highlighted something substantial, that IS the
  // question. Make it the body and drop the noisy page body (keep title + code +
  // headings as thin grounding context).
  // Measured as sent: a placeholder is shorter than the marker that replaces it.
  if (selection.replace(TOKEN_RE, formulaInImage(1)).length >= SELECTION_PRIMARY_MIN) {
    const assembled = assemble(
      title,
      `(answer about THIS highlighted text)\n${selection}`,
      outline,
      code,
      '', // no page body — the selection is the signal
      limit,
      undefined,
      formulaGaps(selection) > 0 ? FORMULAS_NOTE : '',
    );
    return finishText(assembled.text, assembled.text ? 'selection' : 'empty', title, pageType, tokens, limit);
  }

  let body = '';
  let source: ExtractResult['source'] = 'empty';
  const statement = pageType === 'coding' ? platformStatement(doc, tokens.options()) : '';
  if (statement) {
    body = statement;
    source = 'statement';
  } else if (readable && readable.textContent) {
    body = collapseWhitespace(readable.textContent);
    source = 'readability';
  } else {
    body = innerTextFallback(doc, tokens.options());
    if (body) source = 'innertext';
  }

  // Coding pages: cap the prose body so the verbatim code/signature dominates.
  const bodyCap = pageType === 'coding' ? CODING_BODY_CAP : undefined;
  const cappedLen = bodyCap != null ? Math.min(body.length, bodyCap) : body.length;
  const note = formulaGaps(selection) + formulaGaps(body.slice(0, cappedLen)) > 0 ? FORMULAS_NOTE : '';
  let assembled = assemble(title, selection, outline, code, body, limit, bodyCap, note);
  // The note's own length can push every marker out of the body budget; then
  // nothing is missing from what is sent, and no image will be asked for.
  if (note && formulaGaps(selection) + formulaGaps(assembled.body) === 0) {
    assembled = assemble(title, selection, outline, code, body, limit, bodyCap);
  }
  return finishText(assembled.text, assembled.text ? source : 'empty', title, pageType, tokens, limit);
}

function finishText(
  assembled: string,
  source: ExtractResult['source'],
  title: string,
  pageType: PageType,
  tokens: FormulaTokens,
  limit: number,
): ExtractResult {
  const { text, formulas } = tokens.finish(assembled, limit);
  return {
    text,
    source,
    title,
    pageType,
    firstLine: firstContentLine(text),
    // The note names the marker; only the ones standing for a formula count.
    unreadableFormulas: countUnreadableFormulas(text.replace(FORMULAS_NOTE, '')),
    formulas,
  };
}

/**
 * The selection's text. A formula in it is drawn as SVG, which the selection
 * string leaves out, so then its markup is read instead, formulas inlined.
 */
function selectionText(deps: ExtractDeps, formulas: InlineFormulasOptions): string {
  const raw = (deps.getSelection ? deps.getSelection() : '') || '';
  let fragment: Node | null = null;
  try {
    fragment = deps.getSelectionFragment?.() ?? null;
  } catch {
    fragment = null;
  }
  if (!fragment || !containsFormula(fragment as never)) return raw;
  inlineFormulas(fragment as never, formulas);
  return blockText(fragment) || raw;
}
