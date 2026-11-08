/**
 * Formulas with no text -> an image that goes with the page text (issue #645).
 *
 * HackerRank draws its formulas as bare SVG paths, so the page text can only
 * mark where they stood. The manual capture draws each of them, numbered, onto
 * a white sheet in the page itself, and sends the sheet with the text: the
 * answer has the formulas the moment the capture lands, off-screen ones
 * included, with no desktop screenshot to wait for. Only when the desktop has
 * said how many images it takes, and how large: a desktop that does not read
 * them gets `[formula not captured]` instead.
 *
 * serializeFormulaSvg runs on the formula's outer element (a detached clone)
 * and resolves `<use>` glyph references against the live document, so the
 * markup draws on its own. layoutFormulaSheets is pure; drawFormulaSheets
 * takes its image loader and canvas factory from the caller.
 */

/** Pixels per em a formula is drawn at; MathJax SVG units are 1/1000 em. */
const EM_PX = 44;
/** An `ex` is about half an em in the fonts formulas use. */
const EX_PX = EM_PX / 2;
/** "formula 1234" at 20px, and the gap before the formula. */
const LABEL_W = 130;
const PAD = 16;
const CELL_GAP = 40;
const ROW_GAP = 14;
const MIN_ROW_H = 32;
/** Wide enough to stay sharp at the vision path's 1536 px long edge. */
const SHEET_MAX_W = 1500;
const SHEET_MAX_H = 1500;
/**
 * Sizes tried in turn until every formula fits. The smallest still draws an
 * em at 28 px, so sub- and superscripts stay readable after the vision path
 * scales a full sheet to 1536 px.
 */
const SCALES = [1, 0.8, 0.64];

/** What the desktop takes (its `desktop-features` frame); no image without it. */
export interface FormulaImageLimits {
  maxImages: number;
  /** Per image, as a data URL. */
  maxImageChars: number;
  /** All images together, as data URLs. */
  maxTotalChars: number;
}

/** The limits in a `desktop-features` frame, or null when they are missing or unusable. */
export function formulaImageLimitsOf(raw: unknown): FormulaImageLimits | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const whole = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);
  const maxImages = whole(r.maxImages);
  const maxImageChars = whole(r.maxImageChars);
  const maxTotalChars = whole(r.maxTotalChars);
  if (!maxImages || !maxImageChars || !maxTotalChars) return null;
  return { maxImages, maxImageChars, maxTotalChars };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function lengthPx(value: string | null): number {
  const m = /^\s*([\d.]+)\s*(ex|em|px)?\s*$/.exec(value || '');
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return m[2] === 'ex' ? n * EX_PX : m[2] === 'em' ? n * EM_PX : n;
}

/**
 * Self-contained markup for the formula's SVG with an explicit pixel size, or
 * null when it has no SVG or no size to draw it at.
 */
export function serializeFormulaSvg(
  formula: Element,
  doc: Document,
  serialize: (node: Node) => string = (node) => new XMLSerializer().serializeToString(node),
): string | null {
  const source = formula.nodeName.toLowerCase() === 'svg' ? formula : formula.querySelector('svg');
  if (!source) return null;
  const svg = source.cloneNode(true) as Element;

  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let w = 0;
  let h = 0;
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    w = (viewBox[2] / 1000) * EM_PX;
    h = (viewBox[3] / 1000) * EM_PX;
  } else {
    w = lengthPx(svg.getAttribute('width'));
    h = lengthPx(svg.getAttribute('height'));
  }
  if (!w || !h) return null;

  // MathJax 2 can draw glyphs as <use href="#MJMAIN-31"> into one hidden
  // glyph cache; copy what is referenced so the markup draws on its own.
  const uses = Array.from(svg.querySelectorAll('use'));
  if (uses.length) {
    const defs = doc.createElementNS(SVG_NS, 'defs');
    const copied = new Set<string>();
    for (const use of uses) {
      const href = use.getAttribute('href') || use.getAttributeNS(XLINK_NS, 'href') || use.getAttribute('xlink:href') || '';
      const id = href.startsWith('#') ? href.slice(1) : '';
      if (!id || copied.has(id)) continue;
      const target = doc.getElementById(id);
      if (!target) return null;
      copied.add(id);
      defs.appendChild(target.cloneNode(true));
    }
    svg.insertBefore(defs, svg.firstChild);
  }

  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', XLINK_NS);
  svg.setAttribute('width', String(Math.ceil(w)));
  svg.setAttribute('height', String(Math.ceil(h)));
  // The glyphs fill with currentColor; the sheet is white.
  svg.setAttribute('style', 'color:#000');
  svg.removeAttribute('class');
  svg.removeAttribute('focusable');
  return serialize(svg);
}

export interface SheetCell {
  /** The formula's number in the text: `[formula N, see image]`. */
  n: number;
  /** Where the formula is drawn; its label sits LABEL_W to the left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  cells: SheetCell[];
}

/**
 * Numbered formulas side by side in rows, on at most `maxSheets` sheets.
 * `sizes[i]` is formula i + 1, or null when it could not be loaded. Each
 * formula is drawn at `scale`, or smaller when it is too wide or tall for a
 * sheet; one that does not fit on the last sheet is left out.
 */
export function layoutFormulaSheets(
  sizes: Array<{ w: number; h: number } | null>,
  opts: { scale?: number; maxSheets?: number } = {},
): SheetLayout[] {
  const scale = opts.scale ?? 1;
  const maxSheets = opts.maxSheets ?? 3;
  const maxW = SHEET_MAX_W - LABEL_W - PAD * 2;
  const maxH = SHEET_MAX_H - PAD * 2;

  const rows: Array<{ cells: SheetCell[]; w: number; h: number }> = [];
  let row: { cells: SheetCell[]; w: number; h: number } | null = null;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    if (!size || !(size.w > 0) || !(size.h > 0)) continue;
    const s = Math.min(scale, maxW / size.w, maxH / size.h);
    const w = Math.max(1, Math.round(size.w * s));
    const h = Math.max(1, Math.round(size.h * s));
    if (!row || (row.cells.length && PAD + row.w + CELL_GAP + LABEL_W + w + PAD > SHEET_MAX_W)) {
      row = { cells: [], w: 0, h: MIN_ROW_H };
      rows.push(row);
    }
    const x = PAD + (row.cells.length ? row.w + CELL_GAP : 0) + LABEL_W;
    row.cells.push({ n: i + 1, x, y: 0, w, h });
    row.w = x + w - PAD;
    row.h = Math.max(row.h, h);
  }

  const sheets: SheetLayout[] = [];
  let sheet: SheetLayout | null = null;
  for (const r of rows) {
    if (!sheet || sheet.height + r.h + PAD > SHEET_MAX_H) {
      if (sheets.length === maxSheets) break;
      sheet = { width: 0, height: PAD, cells: [] };
      sheets.push(sheet);
    }
    for (const cell of r.cells) sheet.cells.push({ ...cell, y: sheet.height + (r.h - cell.h) / 2 });
    sheet.height += r.h + ROW_GAP;
    sheet.width = Math.max(sheet.width, PAD + r.w + PAD);
  }
  for (const s of sheets) s.height = Math.ceil(s.height - ROW_GAP + PAD);
  return sheets;
}

export interface SheetCanvas {
  getContext(type: '2d'): CanvasRenderingContext2D | null;
  toDataURL(type?: string, quality?: number): string;
}

export interface FormulaSheetEnv {
  /** Loads an image, or resolves null when it does not load. */
  loadImage(url: string): Promise<LoadedImage | null>;
  createCanvas(width: number, height: number): SheetCanvas;
  /** Milliseconds, on the clock `deadline` is given in. */
  now(): number;
}

type LoadedImage = CanvasImageSource & { naturalWidth: number; naturalHeight: number };

export interface FormulaSheets {
  images: string[];
  /** Per image: the first and last formula number on it. */
  ranges: Array<[number, number]>;
  drawn: Set<number>;
}

/**
 * Draw `svgs` (formula N at index N - 1; '' for none) onto sheets within
 * `limits`, at the largest of SCALES that shows them all. Returns the PNG or
 * JPEG data URLs, the first and last formula number each shows, and the
 * numbers of the formulas they show. Never throws: a formula or sheet that
 * fails is left out.
 *
 * By `deadline` it stops: a formula not loaded by then is left out, and no
 * further size is tried once something is drawn. The capture it belongs to
 * has a deadline of its own on the desktop.
 */
export async function drawFormulaSheets(
  svgs: string[],
  env: FormulaSheetEnv,
  limits: FormulaImageLimits,
  deadline = Infinity,
): Promise<FormulaSheets> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = Number.isFinite(deadline)
    ? new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - env.now())); })
    : null;
  const loaded = await Promise.all(
    svgs.map(async (svg) => {
      if (!svg) return null;
      try {
        const load = env.loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        return await (late ? Promise.race([load, late]) : load);
      } catch {
        return null;
      }
    }),
  );
  clearTimeout(timer);
  const sizes = loaded.map((img) =>
    img && img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null,
  );
  const wanted = sizes.filter(Boolean).length;
  let best: FormulaSheets = { images: [], ranges: [], drawn: new Set() };
  if (!wanted || limits.maxImages < 1) return best;
  for (let i = 0; i < SCALES.length; i++) {
    if (best.drawn.size && Number.isFinite(deadline) && env.now() > deadline) break;
    const sheets = layoutFormulaSheets(sizes, { scale: SCALES[i], maxSheets: limits.maxImages });
    const placed = sheets.reduce((sum, s) => sum + s.cells.length, 0);
    if (placed < wanted && i < SCALES.length - 1) continue;
    const result = renderSheets(sheets, loaded, env, limits);
    if (result.drawn.size > best.drawn.size) best = result;
    if (best.drawn.size === wanted) break;
  }
  return best;
}

function renderSheets(
  sheets: SheetLayout[],
  loaded: Array<LoadedImage | null>,
  env: FormulaSheetEnv,
  limits: FormulaImageLimits,
): FormulaSheets {
  const drawn = new Set<number>();
  const images: string[] = [];
  const ranges: Array<[number, number]> = [];
  let total = 0;
  const fits = (url: string) =>
    url.startsWith('data:image/') && url.length <= limits.maxImageChars && total + url.length <= limits.maxTotalChars;
  for (const sheet of sheets) {
    try {
      const canvas = env.createCanvas(sheet.width, sheet.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = '#000';
      ctx.font = '20px sans-serif';
      ctx.textBaseline = 'middle';
      for (const cell of sheet.cells) {
        ctx.fillText(`formula ${cell.n}`, cell.x - LABEL_W, cell.y + cell.h / 2);
        ctx.drawImage(loaded[cell.n - 1]!, cell.x, cell.y, cell.w, cell.h);
      }
      let url = canvas.toDataURL('image/png');
      if (!fits(url)) url = canvas.toDataURL('image/jpeg', 0.9);
      if (!fits(url)) continue;
      total += url.length;
      images.push(url);
      ranges.push([sheet.cells[0].n, sheet.cells[sheet.cells.length - 1].n]);
      for (const cell of sheet.cells) drawn.add(cell.n);
    } catch {
      // A tainted or oversized canvas: these formulas stay not captured.
    }
  }
  return { images, ranges, drawn };
}

/** The browser's own image loader and canvas, for the content script. */
export function browserSheetEnv(doc: Document): FormulaSheetEnv {
  return {
    loadImage: (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    createCanvas: (width, height) => {
      const canvas = doc.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    now: () => performance.now(),
  };
}
