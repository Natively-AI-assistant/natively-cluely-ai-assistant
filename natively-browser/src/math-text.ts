/**
 * Rendered formulas -> text, for the manual page capture (extract.ts).
 *
 * Math renderers draw formulas in ways that plain text extraction cannot read:
 * MathJax SVG output is bare `<path>` outlines, MathJax 3 CommonHTML puts the
 * glyphs in CSS `content`, and KaTeX doubles every formula (MathML + HTML).
 * Readability's `textContent` then drops the formula, so "1 ≤ T ≤ 50" in a
 * Constraints list arrives as an empty bullet and the model guesses the bounds
 * (issue #645, HackerRank's server-rendered MathJax 2 SVG).
 *
 * `inlineFormulas` runs on a CLONE of the page before text extraction and
 * replaces each formula with the best text the page offers for it: the TeX
 * source, a TeX annotation or data-latex/data-tex attribute, MathML text, or
 * an accessible label. A formula with no text at all becomes
 * UNREADABLE_FORMULA, so the gap is visible to the model and countable by the
 * caller. The manual capture draws those formulas
 * into an image instead (formula-sheet.ts) and marks each one with
 * formulaInImage(n), its number in that image.
 *
 * The walk uses only childNodes / getAttribute / replaceChild so it runs on a
 * real DOM and on the small fake DOMs the unit tests build.
 */

/** Stands in for a formula that has no text equivalent on the page. */
export const UNREADABLE_FORMULA = '[formula not captured]';

/** Stands in for formula `n` of the image the capture attaches. */
export function formulaInImage(n: number): string {
  return `[formula ${n}, see image]`;
}

/** Matches formulaInImage markers; group 1 is the number. */
export const FORMULA_IN_IMAGE_RE = /\[formula (\d+), see image\]/g;

/** Front-matter line for a capture whose text has either formula marker. */
export const FORMULAS_NOTE =
  'FORMULAS: some formulas on this page are drawn as pictures with no text. ' +
  '"[formula N, see image]" is formula N of the attached formula image; ' +
  `${UNREADABLE_FORMULA} is one that could not be captured, so read it from an attached screenshot if there is one. ` +
  'Never guess their values.';

/** How many formulas in `text` could not be read. */
export function countUnreadableFormulas(text: string): number {
  if (!text) return 0;
  let n = 0;
  let i = text.indexOf(UNREADABLE_FORMULA);
  while (i !== -1) {
    n++;
    i = text.indexOf(UNREADABLE_FORMULA, i + UNREADABLE_FORMULA.length);
  }
  return n;
}

/** UNREADABLE_FORMULA and formulaInImage markers in `text`. */
export function countFormulaMarkers(text: string): number {
  if (!text) return 0;
  return countUnreadableFormulas(text) + (text.match(FORMULA_IN_IMAGE_RE) || []).length;
}

// Placeholder for a formula to draw, numbered once the text is final: several
// clones are extracted and only some of their text is sent.
export const TOKEN_RE = /\uE000(\d+)\uE001/g;
// What is left of a placeholder that a length cap cut through.
const STRAY_TOKEN_RE = /\uE000\d*|\uE001/g;

/** Whether `text` has a formula the page gave no text for, marked or still a placeholder. */
export function hasFormulaGap(text: string | undefined): boolean {
  return !!text && (text.includes(UNREADABLE_FORMULA) || /\uE000\d+\uE001/.test(text) || /\[formula \d+, see image\]/.test(text));
}

/**
 * Formulas with no text that `serialize` can draw, across every clone of one
 * extraction. `options()` goes to inlineFormulas, which puts a placeholder
 * where each such formula was; `number()` turns the placeholders of the text
 * that is sent into `[formula N, see image]`.
 */
export class FormulaTokens {
  readonly markup: string[] = [];
  private readonly numbered: string[] = [];
  private readonly numberOf = new Map<string, number>();

  constructor(private readonly serialize?: (formula: Element) => string | null) {}

  readonly options = (sources?: Node): InlineFormulasOptions => ({
    sources: sources as never,
    markerFor: (formula) => {
      if (!this.serialize) return null;
      let svg: string | null = null;
      try {
        svg = this.serialize(formula as unknown as Element);
      } catch {
        svg = null;
      }
      if (!svg) return null;
      this.markup.push(svg);
      return `\uE000${this.markup.length - 1}\uE001`;
    },
  });

  /**
   * `text` with its placeholders numbered in reading order, continuing from
   * earlier calls: one number per distinct formula (a page repeats its
   * variables many times), the same number in every text of one capture.
   */
  number(text: string): string {
    return text
      .replace(TOKEN_RE, (_, id: string) => {
        const svg = this.markup[Number(id)];
        let n = this.numberOf.get(svg);
        if (n === undefined) {
          n = this.numbered.push(svg);
          this.numberOf.set(svg, n);
        }
        return formulaInImage(n);
      })
      .replace(STRAY_TOKEN_RE, '');
  }

  /** SVG markup of formula N at index N - 1, for each number given so far. */
  get formulas(): string[] {
    return [...this.numbered];
  }

  /** `text` numbered and kept within `limit`, with the formulas it still shows. */
  finish(text: string, limit: number): { text: string; formulas: string[] } {
    let out = this.number(text);
    const formulas = this.formulas;
    if (out.length > limit) {
      out = out.slice(0, limit);
      let last = 0;
      for (const m of out.matchAll(FORMULA_IN_IMAGE_RE)) last = Math.max(last, Number(m[1]));
      formulas.length = last;
    }
    return { text: out, formulas };
  }
}

// Outer elements of a rendered formula. MathJax 2 frames (SVG, HTML-CSS,
// CommonHTML, native MathML) carry one of the MathJax_* classes, MathJax 3
// uses <mjx-container>, KaTeX uses .katex, MediaWiki wraps MathML + a
// fallback image in .mwe-math-element.
const CONTAINER_CLASSES = new Set([
  'MathJax',
  'MathJax_SVG',
  'MathJax_CHTML',
  'MathJax_MathML',
  'katex',
  'mwe-math-element',
]);

interface MathNode {
  nodeType: number;
  nodeName?: string;
  childNodes?: ArrayLike<MathNode>;
  parentNode?: MathNode | null;
  textContent?: string | null;
  ownerDocument?: { createTextNode(data: string): unknown } | null;
  getAttribute?(name: string): string | null;
  replaceChild?(next: unknown, old: unknown): unknown;
  createTextNode?(data: string): unknown;
}

const ELEMENT = 1;

function attr(el: MathNode, name: string): string {
  try {
    return (el.getAttribute?.(name) || '').trim();
  } catch {
    return '';
  }
}

function tag(el: MathNode): string {
  return (el.nodeName || '').toLowerCase();
}

function children(el: MathNode): MathNode[] {
  return el.childNodes ? Array.from(el.childNodes) : [];
}

function oneLine(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// TeX source some renderers and editors keep on the formula's element
// (data-latex, data-tex). data-math / data-formula are also flags on some
// sites ("true"), so they are read only on an element already known to be a
// formula, and never make one.
const TEX_SOURCE_ATTRS = ['data-latex', 'data-tex'];
const TEX_SOURCE_ATTRS_IN_FORMULA = [...TEX_SOURCE_ATTRS, 'data-math', 'data-formula'];

/** An attribute value that is TeX, not an on/off flag. */
function texSource(el: MathNode, names: string[]): string {
  for (const name of names) {
    const v = oneLine(attr(el, name));
    if (v && !/^(true|false|yes|no|on|off|[01])$/i.test(v)) return v;
  }
  return '';
}

function isContainer(el: MathNode): boolean {
  const t = tag(el);
  if (t === 'math' || t === 'mjx-container') return true;
  if (texSource(el, TEX_SOURCE_ATTRS)) return true;
  const cls = attr(el, 'class');
  if (!cls) return false;
  return cls.split(/\s+/).some((c) => CONTAINER_CLASSES.has(c));
}

/** Depth-first: the first descendant (or `el` itself) that `match` accepts. */
function find(el: MathNode, match: (n: MathNode) => boolean): MathNode | null {
  if (el.nodeType === ELEMENT && match(el)) return el;
  for (const c of children(el)) {
    const hit = find(c, match);
    if (hit) return hit;
  }
  return null;
}

/** MathJax 2 keeps each source in <script type="math/tex" id="MathJax-Element-N">. */
function collectSources(root: MathNode, out: Map<string, { type: string; text: string }>): void {
  if (root.nodeType === ELEMENT && tag(root) === 'script') {
    const type = attr(root, 'type').toLowerCase();
    const id = attr(root, 'id');
    if (id && type.startsWith('math/')) out.set(id, { type, text: root.textContent || '' });
    return;
  }
  for (const c of children(root)) collectSources(c, out);
}

/** A bare token, which needs no parentheses as an exponent, index or fraction part. */
function simple(s: string): boolean {
  return /^[\p{L}\p{N}.]+$/u.test(s) || [...s].length === 1;
}

function group(s: string): string {
  return simple(s) ? s : `(${s})`;
}

/**
 * MathML as one line of text that keeps its structure: 10^5, x_i, (a)/(b).
 * Its plain textContent runs the parts together, so 10^5 would read 105.
 */
function mathmlText(el: MathNode): string {
  if (el.nodeType !== ELEMENT) return el.nodeType === 3 ? oneLine(el.textContent) : '';
  const parts = children(el).filter((c) => c.nodeType === ELEMENT);
  const at = (i: number) => (parts[i] ? mathmlText(parts[i]) : '');
  switch (tag(el).replace(/^[a-z]+:/, '')) {
    case 'annotation':
    case 'annotation-xml':
    case 'mphantom':
    case 'mprescripts':
    case 'none':
      return '';
    case 'semantics':
      return at(0);
    case 'mi':
    case 'mn':
    case 'mo':
    case 'ms':
    case 'mtext':
      return oneLine(el.textContent);
    case 'mspace':
      return ' ';
    case 'msup':
      return `${at(0)}^${group(at(1))}`;
    case 'msub':
      return `${at(0)}_${group(at(1))}`;
    case 'msubsup':
      return `${at(0)}_${group(at(1))}^${group(at(2))}`;
    case 'munder':
      return attr(el, 'accentunder') === 'true' ? `${at(0)}${at(1)}` : `${at(0)}_${group(at(1))}`;
    case 'mover':
      return attr(el, 'accent') === 'true' ? `${at(0)}${at(1)}` : `${at(0)}^${group(at(1))}`;
    case 'munderover':
      return `${at(0)}_${group(at(1))}^${group(at(2))}`;
    case 'mfrac':
      return `${group(at(0))}/${group(at(1))}`;
    case 'msqrt':
      return `√${group(parts.map(mathmlText).join(''))}`;
    case 'mroot':
      return `${group(at(1))}√${group(at(0))}`;
    case 'mfenced': {
      const open = el.getAttribute?.('open') ?? '(';
      const close = el.getAttribute?.('close') ?? ')';
      const sep = (attr(el, 'separators') || ',').charAt(0);
      return `${open}${parts.map(mathmlText).join(sep)}${close}`;
    }
    case 'mtable':
      return parts.map(mathmlText).join('; ');
    case 'mtr':
    case 'mlabeledtr':
      return parts.map(mathmlText).join(', ');
    default:
      return children(el).map(mathmlText).join('');
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** MathML markup (a math/mml script, data-mathml) read the same way as the elements. */
function mathmlMarkupText(markup: string): string {
  const root: MathNode & { childNodes: MathNode[] } = { nodeType: ELEMENT, nodeName: 'mrow', childNodes: [] };
  const stack = [root];
  for (const m of markup.matchAll(/<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.childNodes.push({ nodeType: 3, textContent: decodeEntities(m[5]) });
      continue;
    }
    if (m[1]) {
      const name = m[2].toLowerCase();
      const i = stack.map((n) => n.nodeName).lastIndexOf(name);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? '';
    const node = {
      nodeType: ELEMENT,
      nodeName: m[2].toLowerCase(),
      childNodes: [] as MathNode[],
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      get textContent(): string {
        const text = (n: MathNode): string => (n.nodeType === 3 ? n.textContent || '' : children(n).map(text).join(''));
        return text(this);
      },
    };
    top.childNodes.push(node);
    if (!m[4]) stack.push(node);
  }
  return oneLine(mathmlText(root));
}

function tex(s: string): string {
  return `$${s}$`;
}

/** The best text the page holds for one formula, or '' when it holds none. */
function formulaText(el: MathNode, sources: Map<string, { type: string; text: string }>): string {
  // MathJax 2: the frame's id is the source script's id plus "-Frame".
  const id = attr(el, 'id');
  if (id.endsWith('-Frame')) {
    const src = sources.get(id.slice(0, -'-Frame'.length));
    if (src) {
      const body = src.type.startsWith('math/mml') ? mathmlMarkupText(src.text) : oneLine(src.text);
      if (body) return src.type.startsWith('math/mml') ? body : tex(body);
    }
  }

  const annotation = find(
    el,
    (n) => tag(n) === 'annotation' && attr(n, 'encoding').toLowerCase() === 'application/x-tex',
  );
  const annotated = oneLine(annotation?.textContent);
  if (annotated) return tex(annotated);

  const withSource = find(el, (n) => !!texSource(n, TEX_SOURCE_ATTRS_IN_FORMULA));
  if (withSource) return tex(texSource(withSource, TEX_SOURCE_ATTRS_IN_FORMULA));

  const alt = find(el, (n) => tag(n) === 'math' && !!attr(n, 'alttext'));
  if (alt) return tex(attr(alt, 'alttext'));

  const labelled = find(el, (n) => !!attr(n, 'aria-label'));
  if (labelled) return attr(labelled, 'aria-label');

  const title = find(el, (n) => tag(n) === 'title' && !!oneLine(n.textContent));
  if (title) return oneLine(title.textContent);

  const mathml = attr(el, 'data-mathml');
  if (mathml) {
    const text = mathmlMarkupText(mathml);
    if (text) return text;
  }

  // Assistive MathML (MathJax 2.7+/3) or a bare <math>: its text is readable.
  const math = find(el, (n) => tag(n) === 'math');
  const mathText = math ? oneLine(mathmlText(math)) : '';
  if (mathText) return mathText;

  const img = find(el, (n) => tag(n) === 'img' && !!attr(n, 'alt'));
  if (img) return attr(img, 'alt');

  // HTML renderers that draw glyphs as real text (MathJax 2 HTML-CSS / CHTML).
  return oneLine(el.textContent);
}

// Superscript text that is a mark, not an exponent: ordinals, trademarks.
const NOT_AN_EXPONENT = /^(st|nd|rd|th|tm|sm|®|©|™|\*+|†|‡)$/i;

/**
 * An HTML <sup>/<sub> as `^x` / `_x`. LeetCode writes 10^4 as
 * `10<sup>4</sup>`, whose textContent reads "104". '' for anything that is not
 * an exponent or index: footnote links, "[1]", ordinals, trademarks, or a
 * script long enough to be prose.
 */
function scriptText(el: MathNode): string {
  const t = tag(el);
  if (t !== 'sup' && t !== 'sub') return '';
  if (find(el, (n) => tag(n) === 'a')) return '';
  const text = oneLine(el.textContent);
  if (!text || text.length > 24 || /[[\]]/.test(text) || NOT_AN_EXPONENT.test(text)) return '';
  return `${t === 'sup' ? '^' : '_'}${group(text)}`;
}

/** The text node that took `el`'s place, or null when it could not be replaced. */
function replaceWithText(el: MathNode, text: string): { data: string } | null {
  const parent = el.parentNode;
  const doc = el.ownerDocument;
  if (!parent?.replaceChild || !doc?.createTextNode) return null;
  try {
    const node = doc.createTextNode(text) as { data: string };
    parent.replaceChild(node, el);
    return node;
  } catch {
    return null;
  }
}

/** Whether `root` holds a rendered formula. */
export function containsFormula(root: MathNode): boolean {
  return !!find(root, isContainer);
}

export interface InlineFormulasOptions {
  /**
   * Where to look for MathJax 2 source scripts, when `root` may not hold them
   * (a selection's contents: the script sits after the formula it belongs to).
   */
  sources?: MathNode;
  /**
   * The marker for a formula with no text, or null for UNREADABLE_FORMULA.
   * Receives the formula's outer element, already detached from `root`.
   */
  markerFor?: (formula: MathNode) => string | null;
}

/**
 * Replace every rendered formula under `root` with text, in place. `root`
 * must be a clone: this mutates it. Returns how many formulas were found and
 * how many had no text equivalent.
 */
export function inlineFormulas(
  root: MathNode,
  opts: InlineFormulasOptions = {},
): { found: number; unreadable: number } {
  const counts = { found: 0, unreadable: 0 };
  const sources = new Map<string, { type: string; text: string }>();
  collectSources(root, sources);
  if (opts.sources && opts.sources !== root) collectSources(opts.sources, sources);

  const visit = (node: MathNode) => {
    for (const child of children(node)) {
      if (child.nodeType !== ELEMENT) continue;
      if (isContainer(child)) {
        const text = formulaText(child, sources);
        const node = replaceWithText(child, text || UNREADABLE_FORMULA);
        if (node) {
          counts.found++;
          if (!text) {
            counts.unreadable++;
            const marker = opts.markerFor?.(child);
            if (marker) node.data = marker;
          }
        }
        continue;
      }
      // Not counted: an HTML exponent always has its text.
      const script = scriptText(child);
      if (script && replaceWithText(child, script)) continue;
      visit(child);
    }
  };
  visit(root);
  return counts;
}
