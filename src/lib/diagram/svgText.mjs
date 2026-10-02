// Small SVG building blocks shared by the local visual adapters (charts, Chen
// ER). Pure string work: no DOM, so the same code draws in the renderer, in
// the main process (for the phone) and under plain Node in tests.
//
// Text is measured by estimate. The drawings are shown through an <img> with
// system fonts, so an exact metric is not available anywhere; the estimate is
// deliberately a little wide, and every box that holds text is sized from it.

export const SVG_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Escape text for an SVG text node or attribute value. */
/**
 * Text that is safe to put in an XML document and to hand to
 * `encodeURIComponent`: no lone surrogate (half an emoji left by a length cut,
 * or written by a model as "\ud83d"), no noncharacter, no control character.
 */
export function wellFormedText(value) {
  return String(value ?? '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

/** The first `max` characters of `value`, counted in code points so an emoji is never cut in half. */
export function clipText(value, max) {
  const clean = wellFormedText(value);
  if (clean.length <= max) return clean;
  return Array.from(clean).slice(0, max).join('');
}

export function escapeXml(value) {
  return wellFormedText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NARROW = new Set("iIl.,:;'|!()[]{}jtfr ".split(''));
const WIDE = new Set('mwMW@%&'.split(''));
const CYRILLIC_WIDE = new Set('жшщмюыфЖШЩМЮЫФДЪ'.split(''));
const HALF_WIDTH_KANA = /[\uff61-\uff9f]/;

/** Estimated rendered width of `text` at `fontSize` px in the system sans font. */
export function estimateTextWidth(text, fontSize = 12, weight = 400) {
  let units = 0;
  for (const ch of String(text ?? '')) {
    if (NARROW.has(ch)) units += 0.32;
    else if (WIDE.has(ch)) units += 0.88;
    else if (ch >= 'A' && ch <= 'Z') units += 0.68;
    else if (ch >= '0' && ch <= '9') units += 0.58;
    else if (ch.charCodeAt(0) > 0x2e7f) units += HALF_WIDTH_KANA.test(ch) ? 0.55 : 1; // CJK and other wide scripts
    // Cyrillic runs wider than Latin: counted as Latin it came out 6–30% short
    // (measured in Chromium, 2026-10-02: "Очередь сообщений" 90%, capitals
    // 74%, "жшщмюы" 70%), and a Russian label overran the box sized from it.
    else if (ch >= '\u0400' && ch <= '\u04ff') units += CYRILLIC_WIDE.has(ch) ? 0.86 : ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 0.74 : 0.62;
    else units += 0.55;
  }
  return units * fontSize * (weight >= 600 ? 1.06 : 1);
}

/** Cut `text` to fit `maxWidth`, ending in an ellipsis when it was cut. */
export function truncateToWidth(text, maxWidth, fontSize = 12, weight = 400) {
  const value = String(text ?? '');
  if (estimateTextWidth(value, fontSize, weight) <= maxWidth) return value;
  let out = '';
  for (const ch of value) {
    if (estimateTextWidth(`${out}${ch}…`, fontSize, weight) > maxWidth) break;
    out += ch;
  }
  return out ? `${out.trimEnd()}…` : '…';
}

/** Break `text` into at most `maxLines` lines no wider than `maxWidth`. */
export function wrapText(text, maxWidth, fontSize = 12, maxLines = 2) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (estimateTextWidth(next, fontSize) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines.map((l) => truncateToWidth(l, maxWidth, fontSize));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = truncateToWidth(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth, fontSize);
  return kept.map((l) => truncateToWidth(l, maxWidth, fontSize));
}

const round = (n) => Math.round(n * 100) / 100;

/** `<text>` element. `anchor`: start | middle | end. */
export function svgText(x, y, text, opts = {}) {
  const attrs = [
    `x="${round(x)}"`,
    `y="${round(y)}"`,
    `font-size="${opts.size ?? 12}"`,
    `fill="${opts.fill ?? '#000'}"`,
    opts.anchor && opts.anchor !== 'start' ? `text-anchor="${opts.anchor}"` : '',
    opts.weight ? `font-weight="${opts.weight}"` : '',
    opts.italic ? 'font-style="italic"' : '',
    opts.decoration ? `text-decoration="${opts.decoration}"` : '',
    opts.baseline ? `dominant-baseline="${opts.baseline}"` : '',
    opts.transform ? `transform="${opts.transform}"` : '',
    opts.cls ? `class="${opts.cls}"` : '',
  ].filter(Boolean).join(' ');
  return `<text ${attrs}>${escapeXml(text)}</text>`;
}

/** Wrap finished SVG body markup in a root element with an explicit pixel size. */
export function svgDocument(width, height, body, opts = {}) {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  // The title is a <title> element, never an attribute of the root tag: text
  // inside a tag is what the output check reads as markup, and "one = low"
  // in a title was refused as an `on…=` handler.
  const label = opts.title ? ' role="img"' : '';
  const kind = opts.kind ? ` data-visual="${escapeXml(opts.kind)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family='${SVG_FONT_FAMILY}'${label}${kind}>${opts.title ? `<title>${escapeXml(opts.title)}</title>` : ''}${body}</svg>`;
}

/** Number rounded for use in a path or attribute. */
export const svgNum = round;
