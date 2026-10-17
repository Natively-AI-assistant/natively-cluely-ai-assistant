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

/** Collapse whitespace but preserve paragraph breaks. */
export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trimmed textContent of the first element matching any selector, or ''. */
export function firstText(doc: ParentNode, selectors: string[] | undefined): string {
  if (!selectors) return '';
  for (const sel of selectors) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(sel);
    } catch {
      continue;
    }
    const t = (el?.textContent || '').trim();
    if (t) return collapseWhitespace(t);
  }
  return '';
}

/** Concatenated text of every element matching any selector. */
export function allText(doc: ParentNode, selectors: string[] | undefined, cap = 8000): string {
  if (!selectors) return '';
  const parts: string[] = [];
  for (const sel of selectors) {
    let nodes: NodeListOf<Element> | null = null;
    try {
      nodes = doc.querySelectorAll(sel);
    } catch {
      continue;
    }
    nodes?.forEach((n) => {
      const t = (n.textContent || '').trim();
      if (t) parts.push(t);
    });
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
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = (raw || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    if (t.length < 2 || seen.has(t)) return;
    seen.add(t);
    chunks.push(t);
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
      for (const el of safeQuery(sel)) push(el.textContent);
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
  const lower = body.toLowerCase();
  for (const sig of signals) {
    const idx = lower.indexOf(sig.toLowerCase());
    if (idx === -1) continue;
    const tail = body.slice(idx, idx + maxLen);
    // Stop at a double-newline boundary if there is one well past the heading.
    const end = tail.indexOf('\n\n', sig.length + 4);
    return (end > 0 ? tail.slice(0, end) : tail).trim();
  }
  return '';
}

/** `body.innerText`-style fallback with script/style removed. */
export function bodyInnerText(doc: Document, cap = 12000): string {
  const body = doc.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  try {
    clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.parentNode?.removeChild(n));
  } catch {
    /* shim without querySelectorAll */
  }
  const text = (clone as { innerText?: string }).innerText ?? clone.textContent ?? '';
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

/**
 * Collect textual equivalents of mathematical expressions rendered on the page.
 * Looks for MathML, TeX/LaTeX annotations, and accessible labels on SVGs or
 * math containers. Returns a de-duplicated, whitespace-collapsed string (or '').
 */
export function extractMathText(doc: ParentNode, cap = 2000): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const v = collapseWhitespace(raw);
    if (v && !seen.has(v)) {
      seen.add(v);
      parts.push(v);
    }
  };

  const safeQuery = (sel: string): Element[] => {
    try {
      return Array.from(doc.querySelectorAll(sel));
    } catch {
      return [];
    }
  };

  // MathML content.
  for (const el of safeQuery('math, [data-math], [data-tex], [data-latex]')) {
    push(el.textContent);
    try { push(el.getAttribute('data-tex') || el.getAttribute('data-latex') || el.getAttribute('data-math')); } catch { /* no-op */ }
  }
  // TeX annotations embedded in MathML.
  for (const el of safeQuery('annotation, annotation-xml')) {
    const enc = (el.getAttribute?.('encoding') || '').toLowerCase();
    if (!enc || enc.includes('tex') || enc.includes('mathml')) push(el.textContent);
  }
  // SVGs that carry an accessible label or title/desc.
  for (const svg of safeQuery('svg')) {
    try {
      push(svg.querySelector('title')?.textContent);
      push(svg.querySelector('desc')?.textContent);
      push(svg.getAttribute('aria-label'));
      const labelledBy = svg.getAttribute('aria-labelledby');
      if (labelledBy) {
        for (const id of labelledBy.split(/\s+/)) {
          try {
            const ref = (doc as Document).getElementById?.(id);
            if (ref) push(ref.textContent);
          } catch { /* no-op */ }
        }
      }
    } catch { /* no-op */ }
  }
  // Rendered math containers (KaTeX/MathJax) often expose the source via aria-label.
  for (const el of safeQuery('.katex, .MathJax, .math, [role="math"]')) {
    try {
      push(el.getAttribute('aria-label'));
      // KaTeX keeps the TeX source in a .katex-mathml sibling; textContent covers it.
      push(el.textContent);
    } catch { /* no-op */ }
  }

  const joined = parts.join(' ; ');
  return joined.length > cap ? joined.slice(0, cap) : joined;
}

/**
 * True when the page contains SVG graphics that look like math (paths) but carry
 * no accessible text equivalent — i.e. the capture cannot recover the formula.
 */
export function hasInaccessibleMath(doc: ParentNode): boolean {
  let svgs: Element[] = [];
  try {
    svgs = Array.from(doc.querySelectorAll('svg'));
  } catch {
    return false;
  }
  for (const svg of svgs) {
    let hasPath = false;
    try { hasPath = !!svg.querySelector('path'); } catch { hasPath = false; }
    if (!hasPath) continue;
    let hasText = false;
    try {
      hasText = !!(
        svg.querySelector('title')?.textContent?.trim() ||
        svg.querySelector('desc')?.textContent?.trim() ||
        svg.getAttribute('aria-label')?.trim() ||
        svg.getAttribute('aria-labelledby')?.trim()
      );
    } catch { hasText = false; }
    if (!hasText) return true;
  }
  return false;
}
