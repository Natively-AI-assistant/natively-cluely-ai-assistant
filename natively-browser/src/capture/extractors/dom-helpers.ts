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

/* ─────────────────────────── math / formula recovery ─────────────────────── */

/**
 * Attributes that carry a TeX/LaTeX source for a formula. Checked on the
 * formula element itself and on its (near) ancestors.
 */
const TEX_SOURCE_ATTRS = ['data-tex', 'data-latex', 'data-formula', 'data-math', 'alttext'];

/**
 * Substrings that mark a class or id as belonging to a formula renderer
 * (MathJax, KaTeX, MathML helpers). Deliberately excludes 'tex' — it matches
 * far too many innocent words ('context', 'text').
 */
const MATH_NAME_HINTS = ['math', 'katex', 'mathjax', 'mjx', 'formula', 'equation', 'latex'];

/**
 * Containers that hold a coding problem's own content on the common judges.
 * The math checks are scoped to these so page chrome (nav buttons, logos,
 * decorative icons) is never mistaken for a formula.
 */
const PROBLEM_CONTENT_SELECTORS = [
  '.problem-statement',
  '.challenge-body-html',
  '.challenge_constraints_body',
  '.problem-constraints',
  '.input-format',
  '.output-format',
  '.question-content',
  '.description__content',
  '.content__renderer',
  '.problem-description',
  '[class*="constraint"]',
  '[class*="problem-statement"]',
  '[id*="problem-statement"]',
];

/** Attribute read that never throws (hostile/broken DOM shims). */
function attr(el: Element | null | undefined, name: string): string {
  try {
    return (el?.getAttribute?.(name) || '').trim();
  } catch {
    return '';
  }
}

/** querySelectorAll that never throws and never returns null. */
function queryAll(root: ParentNode | null | undefined, selector: string): Element[] {
  try {
    return Array.from(root?.querySelectorAll?.(selector) || []);
  } catch {
    return [];
  }
}

/** Child elements of a node (never throws). */
function childElements(el: Element | null | undefined): Element[] {
  try {
    return Array.from((el as Element | undefined)?.children || []);
  } catch {
    return [];
  }
}

/** True when the element itself is marked as a formula. */
function isMathElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'math') return true;
  if (attr(el, 'role').toLowerCase() === 'math') return true;
  for (const a of TEX_SOURCE_ATTRS) if (attr(el, a)) return true;
  let hay = '';
  try {
    hay = `${attr(el, 'class')} ${attr(el, 'id')}`.trim().toLowerCase();
  } catch {
    /* no-op */
  }
  if (!hay) {
    try {
      hay = `${Array.from(el.classList || []).join(' ')} ${el.id || ''}`.trim().toLowerCase();
    } catch {
      /* no-op */
    }
  }
  return MATH_NAME_HINTS.some((h) => hay.includes(h));
}

/** True when the element or one of its near ancestors is marked as a formula. */
function nearMathElement(el: Element | null | undefined, maxDepth = 4): boolean {
  let node: unknown = el;
  let depth = 0;
  while (node && depth <= maxDepth) {
    const e = node as Element;
    if (typeof e.tagName === 'string' && isMathElement(e)) return true;
    node = (e as Element).parentNode;
    depth++;
  }
  return false;
}

/** True when the element sits inside an interactive control (a button/icon). */
function isInteractive(el: Element | null | undefined, maxDepth = 4): boolean {
  let node: unknown = el;
  let depth = 0;
  while (node && depth <= maxDepth) {
    const e = node as Element;
    if (typeof e.tagName === 'string') {
      const tag = (e.tagName || '').toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'select' || tag === 'summary') return true;
      const role = attr(e, 'role').toLowerCase();
      if (role === 'button' || role === 'link' || role === 'menuitem') return true;
    }
    node = (e as Element).parentNode;
    depth++;
  }
  return false;
}

/** True when the element is inside one of the given scope elements. */
function inScopes(el: Element | null | undefined, scopes: ParentNode[]): boolean {
  if (!scopes.length) return false;
  const set = new Set<unknown>(scopes as unknown as unknown[]);
  let node: unknown = el;
  let depth = 0;
  while (node && depth <= 40) {
    if (set.has(node)) return true;
    node = (node as Element).parentNode;
    depth++;
  }
  return false;
}

/** The TeX source carried by an element (attribute or TeX annotation), or ''. */
function texSourceOf(el: Element | null | undefined): string {
  if (!el) return '';
  for (const a of TEX_SOURCE_ATTRS) {
    const v = attr(el, a);
    if (v) return v;
  }
  for (const ann of queryAll(el, 'annotation, annotation-xml')) {
    const enc = attr(ann, 'encoding').toLowerCase();
    const txt = (ann.textContent || '').trim();
    if (txt && (!enc || enc.includes('tex'))) return txt;
  }
  return '';
}

/** The TeX source on the element or on one of its near ancestors, or ''. */
function texSourceNear(el: Element | null | undefined, maxDepth = 3): string {
  let node: unknown = el;
  let depth = 0;
  while (node && depth <= maxDepth) {
    const e = node as Element;
    if (typeof e.tagName === 'string') {
      const t = texSourceOf(e);
      if (t) return t;
    }
    node = (e as Element).parentNode;
    depth++;
  }
  return '';
}

/**
 * Accessible text of a graphic: <title>, <desc>, aria-label, or the TEXT of
 * the elements an aria-labelledby points at. A reference to a missing or empty
 * element is NOT readable text — the formula is still lost.
 */
function accessibleTextOf(el: Element, doc: ParentNode): string {
  const title = (queryAll(el, 'title')[0]?.textContent || '').trim();
  if (title) return title;
  const desc = (queryAll(el, 'desc')[0]?.textContent || '').trim();
  if (desc) return desc;
  const label = attr(el, 'aria-label');
  if (label) return label;
  const labelledBy = attr(el, 'aria-labelledby');
  if (!labelledBy) return '';
  for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
    let ref: Element | null = null;
    try {
      ref = (doc as Document).getElementById?.(id) ?? null;
    } catch {
      ref = null;
    }
    const txt = (ref?.textContent || '').trim();
    if (txt) return txt;
  }
  return '';
}

/** True for MathML annotation elements (they hold TeX, not structure). */
function isAnnotationElement(el: Element): boolean {
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'annotation' || tag === 'annotation-xml';
}

/** A single MathML operand, parenthesised when it is not atomic. */
function mathBase(el: Element | undefined): string {
  const s = el ? serializeMath(el) : '';
  if (!s) return '';
  return /[\s+\-*/^_=<>,;]/.test(s) ? `(${s})` : s;
}

/** A single MathML operand as written (no extra parentheses). */
function mathArg(el: Element | undefined): string {
  return el ? serializeMath(el) : '';
}

/**
 * Serialize a MathML subtree into readable, STRUCTURE-PRESERVING text.
 * `<msup><mi>n</mi><mn>2</mn></msup>` becomes `n^{2}` — NOT the flattened
 * `n2`, which would silently change the meaning of the formula.
 */
function serializeMath(el: Element): string {
  const tag = (el.tagName || '').toLowerCase();
  const kids = childElements(el).filter((k) => !isAnnotationElement(k));
  const self = (el.textContent || '').trim();
  switch (tag) {
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return self;
    case 'mspace':
      return ' ';
    case 'msup':
      return `${mathBase(kids[0])}^{${mathArg(kids[1])}}`;
    case 'msub':
      return `${mathBase(kids[0])}_{${mathArg(kids[1])}}`;
    case 'msubsup':
      return `${mathBase(kids[0])}_{${mathArg(kids[1])}}^{${mathArg(kids[2])}}`;
    case 'munder':
      return `${mathBase(kids[0])}_${mathArg(kids[1])}`;
    case 'mover':
      return `${mathBase(kids[0])}^${mathArg(kids[1])}`;
    case 'munderover':
      return `${mathBase(kids[0])}_{${mathArg(kids[1])}}^{${mathArg(kids[2])}}`;
    case 'mfrac':
      return `(${mathArg(kids[0])})/(${mathArg(kids[1])})`;
    case 'msqrt':
      return `sqrt(${mathArg(kids[0])})`;
    case 'mroot':
      return `root(${mathArg(kids[0])}, ${mathArg(kids[1])})`;
    case 'mtable':
      return kids.map((r) => serializeMath(r)).join(' ; ');
    case 'mtr':
      return kids.map((c) => serializeMath(c)).join(', ');
    case 'mtd':
      return kids.map((c) => serializeMath(c)).join(' ');
    case 'semantics':
      return kids.length ? serializeMath(kids[0]) : '';
    case 'annotation':
    case 'annotation-xml':
      return '';
    default:
      if (kids.length) return kids.map((c) => serializeMath(c)).join('');
      return self;
  }
}

/**
 * The structured text of a MathML element. Empty when the element carries no
 * readable structure.
 */
export function mathmlToText(el: Element): string {
  try {
    return collapseWhitespace(serializeMath(el));
  } catch {
    return '';
  }
}

/**
 * True when a MathML container hides a formula that we could otherwise read
 * (KaTeX keeps its MathML in a `.katex-mathml` sibling of the rendering).
 */
function mathmlNear(el: Element | null | undefined, maxDepth = 3): boolean {
  let node: unknown = (el as Element | undefined)?.parentNode;
  let depth = 0;
  while (node && depth < maxDepth) {
    const e = node as Element;
    if (typeof e.tagName === 'string' && isMathElement(e) && queryAll(e, 'math').length) return true;
    node = (e as Element).parentNode;
    depth++;
  }
  return false;
}

/**
 * True when an SVG is a rendered FORMULA rather than page chrome.
 *
 * A formula is either marked as math (tag/role/class/id/attribute, on the SVG
 * or a near ancestor) or is an image-role graphic embedded in the captured
 * problem — judges such as HackerRank render constraints as `svg[role="img"]`
 * with no text at all. Icons outside the problem are never formulas.
 */
function isFormulaSvg(svg: Element, scopes: ParentNode[]): boolean {
  if (nearMathElement(svg)) return true;
  if (attr(svg, 'role').toLowerCase() !== 'img') return false;
  if (!inScopes(svg, scopes)) return false;
  return !isInteractive(svg);
}

/**
 * The containers that hold a coding problem's own content: the platform's own
 * statement selectors plus the well-known judge containers. The math checks
 * are scoped to these so that page chrome is never read as a formula.
 */
export function problemScopes(doc: ParentNode, hintSelectors?: string[]): ParentNode[] {
  const scopes: ParentNode[] = [];
  const selectors = [...(hintSelectors || []), ...PROBLEM_CONTENT_SELECTORS];
  for (const sel of selectors) {
    for (const el of queryAll(doc, sel)) {
      if (!scopes.includes(el)) scopes.push(el);
    }
  }
  return scopes;
}

/** What the capture could recover of the page's formulas. */
export interface MathRecovery {
  /** Formulas recovered as text (TeX source or structured MathML), de-duplicated. */
  text: string;
  /** True when a formula could NOT be recovered — the capture is incomplete. */
  inaccessible: boolean;
}

/**
 * Recover the textual equivalents of the page's formulas.
 *
 * Sources, in order of fidelity: a TeX source carried by the markup
 * (data-tex / data-latex / alttext / a TeX annotation), the STRUCTURE of a
 * MathML tree, and the accessible label of a labelled SVG. A formula that
 * exists only as SVG paths has no text equivalent — that is reported as
 * `inaccessible` so the capture can ask for a screenshot instead of silently
 * presenting the flattened page text as complete.
 */
export function recoverMath(doc: ParentNode, scopes: ParentNode[] = [], cap = 2000): MathRecovery {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const v = collapseWhitespace(raw);
    if (!v || seen.has(v)) return;
    seen.add(v);
    parts.push(v);
  };
  let inaccessible = false;

  // 1. TeX sources carried by the markup itself.
  for (const el of queryAll(doc, '[data-tex], [data-latex], [data-formula], [data-math], [alttext]')) {
    push(texSourceOf(el));
  }

  // 2. MathML: prefer the TeX annotation, else keep the structure.
  for (const el of queryAll(doc, 'math')) {
    const tex = texSourceOf(el);
    if (tex) {
      push(tex);
      continue;
    }
    push(mathmlToText(el));
  }

  // 3. Rendered math containers (KaTeX/MathJax). A renderer that exposes no
  //    source at all would give us only a flattened rendering, which is not an
  //    equivalent — so it counts as a formula we could not read. A container
  //    that is plain text (role="math" around literal text) is read as-is.
  for (const el of queryAll(doc, '.katex, .katex-display, mjx-container, .MathJax')) {
    if (texSourceOf(el)) continue;
    if (queryAll(el, 'math').length) continue; // already recovered as MathML
    inaccessible = true;
  }
  for (const el of queryAll(doc, '[role="math"]')) {
    if (texSourceOf(el)) continue;
    if (queryAll(el, 'math').length) continue; // already recovered as MathML
    const text = (el.textContent || '').trim();
    if (text) push(text);
  }

  // 4. SVG formulas.
  for (const svg of queryAll(doc, 'svg')) {
    if (!isFormulaSvg(svg, scopes)) continue;
    const tex = texSourceNear(svg);
    if (tex) {
      push(tex);
      continue;
    }
    const label = accessibleTextOf(svg, doc);
    if (label) {
      push(label);
      continue;
    }
    if (mathmlNear(svg)) continue; // already recovered as MathML
    if (!queryAll(svg, 'path').length) continue; // not a drawing — nothing was lost
    inaccessible = true;
  }

  const joined = parts.join(' ; ');
  return {
    text: joined.length > cap ? joined.slice(0, cap) : joined,
    inaccessible,
  };
}
