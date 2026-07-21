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
 *   2. Fallback to `body.innerText` (script/style/noscript excluded) for app-like
 *      pages where Readability returns null.
 *   3. Prepend page <title>, the user's current selection, and the visible
 *      <h1..h3> heading hierarchy.
 *   4. Cap at DOM_CONTEXT_MAX_CHARS, trimming the body from the END so the
 *      title + selection (the highest-signal front matter) always survive.
 *
 * Everything here is dependency-injected (document, a Readability factory, a
 * selection getter) so it can be unit-tested under `node --test` with a tiny
 * fake DOM and no browser.
 */

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
}

export type PageType = 'coding' | 'article' | 'app';

export interface ExtractResult {
  /** The final, capped text to POST as `{ dom: ... }`. */
  text: string;
  /** Which body path produced the content — useful for the popup status. */
  source: 'readability' | 'innertext' | 'selection' | 'empty';
  /** Page title, post-trim, for telemetry/popup. */
  title: string;
  /** Detected page class, biasing extraction + shown in the desktop chip. */
  pageType: PageType;
  /** First non-empty content line, for the desktop preview chip. */
  firstLine: string;
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
function innerTextFallback(doc: Document): string {
  const body = doc.body;
  if (!body) return '';
  // Clone so we can strip non-content nodes without touching the live page.
  const clone = body.cloneNode(true) as HTMLElement;
  const drop = clone.querySelectorAll('script, style, noscript, template');
  drop.forEach((n) => n.parentNode?.removeChild(n));
  // innerText respects visibility/line-breaks; textContent does not. Prefer
  // innerText when available (jsdom/real browser), else fall back to textContent.
  const text = (clone as { innerText?: string }).innerText ?? clone.textContent ?? '';
  return collapseWhitespace(text);
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

  // <pre> and standalone <code> (skip <code> nested in <pre> — already captured).
  doc.querySelectorAll('pre').forEach((el) => push(el.textContent));
  doc.querySelectorAll('code').forEach((el) => {
    if (!el.closest('pre')) push(el.textContent);
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
    if (/^(TITLE|SELECTED TEXT|CODE ON PAGE|HEADINGS)\b/.test(line)) continue;
    if (line === '---') continue;
    return line.slice(0, 160);
  }
  return '';
}

function tryReadability(
  doc: Document,
  factory: ReadabilityFactory | undefined,
): ReadabilityResult | null {
  if (!factory) return null;
  try {
    // Readability mutates its input — always parse a clone.
    const clone = doc.cloneNode(true) as Document;
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
): string {
  const parts: string[] = [];
  if (title) parts.push(`TITLE: ${title}`);
  if (selection) parts.push(`SELECTED TEXT:\n${selection}`);
  // Code goes in front matter (never trimmed) and is explicitly marked verbatim so
  // the model uses the EXACT signature/structure instead of inventing one.
  if (code) parts.push(`CODE ON PAGE (verbatim — use this exact structure, names, and signature):\n${code}`);
  if (outline) parts.push(`HEADINGS:\n${outline}`);
  const frontMatter = parts.join('\n\n');

  const cappedBody = bodyCap != null && body.length > bodyCap ? body.slice(0, bodyCap) : body;

  if (!cappedBody) return frontMatter.slice(0, limit);
  if (!frontMatter) return cappedBody.slice(0, limit);

  const separator = '\n\n---\n\n';
  const reserved = frontMatter.length + separator.length;
  if (reserved >= limit) {
    // Front matter alone fills the budget — keep as much of it as fits.
    return frontMatter.slice(0, limit);
  }
  const bodyBudget = limit - reserved;
  const trimmedBody = cappedBody.length > bodyBudget ? cappedBody.slice(0, bodyBudget) : cappedBody;
  return `${frontMatter}${separator}${trimmedBody}`;
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
  // Selection: don't collapse internal newlines for the primary-selection case so
  // highlighted code keeps its structure; light-trim only.
  const selectionRaw = (deps.getSelection ? deps.getSelection() : '') || '';
  const selection = selectionRaw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const outline = headingOutline(doc);
  // Capture code BEFORE Readability runs (it mutates a clone, but we read the live
  // doc here so editor DOM is intact).
  const code = extractCodeBlocks(doc);

  const readable = tryReadability(doc, deps.readabilityFactory);
  const readableLen = readable?.textContent ? readable.textContent.trim().length : 0;
  const pageType = classifyPage(doc, readableLen, code.length > 0);

  // Readability often recovers a cleaner title than document.title.
  const title = (readable?.title || rawTitle || '').replace(/\s+/g, ' ').trim();

  // SELECTION-FIRST: if the user highlighted something substantial, that IS the
  // question. Make it the body and drop the noisy page body (keep title + code +
  // headings as thin grounding context).
  if (selection.length >= SELECTION_PRIMARY_MIN) {
    const text = assemble(
      title,
      `(answer about THIS highlighted text)\n${selection}`,
      outline,
      code,
      '', // no page body — the selection is the signal
      limit,
    );
    return { text, source: text ? 'selection' : 'empty', title, pageType, firstLine: firstContentLine(text) };
  }

  let body = '';
  let source: ExtractResult['source'] = 'empty';
  if (readable && readable.textContent) {
    body = collapseWhitespace(readable.textContent);
    source = 'readability';
  } else {
    body = innerTextFallback(doc);
    if (body) source = 'innertext';
  }

  // Coding pages: cap the prose body so the verbatim code/signature dominates.
  const bodyCap = pageType === 'coding' ? CODING_BODY_CAP : undefined;
  const text = assemble(title, selection, outline, code, body, limit, bodyCap);
  return { text, source: text ? source : 'empty', title, pageType, firstLine: firstContentLine(text) };
}
