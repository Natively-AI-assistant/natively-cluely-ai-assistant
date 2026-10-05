// How a drawing arrives: its parts come in the order a reader takes them —
// the boxes as they were written, then what joins them; a chart's bars rise
// from the axis, its line is drawn left to right, its values land last.
//
// Display only. The motion is a <style> block added to the copy of the SVG the
// card shows, the first time a drawing arrives in a live answer. The stored
// SVG, and so every export, the Source tab and the phone, never carries it: a
// PNG made from an image whose parts start at opacity 0 would be empty.
//
// App-owned text only (nothing here comes from a model), no script, no url(),
// nothing loaded. It runs inside an <img>, where a document's styles cannot
// reach, which is why it has to travel in the SVG.
//
// Budget: everything has started by 240 ms and is still by about 500 ms. An
// answer is read while it is spoken; the drawing must not be late.

export const ARRIVAL_STEP_MS = 40;
export const ARRIVAL_TOTAL_MS = 500;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const IN = '250ms ease-out backwards';

// Selectors below are the class names Mermaid 11 and this app's own chart and
// notation renderers write (see tests/diagram/mermaid-render.check.mjs for the
// structure). A selector that matches nothing costs nothing: the drawing just
// appears with the card's own fade.
const FIRST = [
  'g.nodes > g.node',
  'g.clusters > g',
  'g.subgraphs > g',
  'rect.actor',
  'text.actor',
  'line.actor-line',
  'g.taskWrapper',
  '.chen-entity',
  '.chen-relationship',
  '.chart-slice',
  '.chart-swatch',
  '.chart-legend',
];
const THEN = [
  'g.edgePaths > path',
  'g.edgeLabels > g.edgeLabel',
  'g.edgeTerminals > g',
  '.messageLine0',
  '.messageLine1',
  '.messageText',
  '.loopLine',
  '.loopText',
  '.labelBox',
  '.labelText',
  '.sectionTitle',
  'g.eventWrapper',
  'g.lineWrapper',
  '.chen-attribute',
  '.chen-attribute-link',
  '.chen-link',
  '.chen-cardinality',
  '.chen-role',
  '.chen-key-underline',
  '.chen-partial-key-underline',
  '.chart-point',
  '.chart-band',
  '.chart-marker',
  '.chart-marker-label',
  '.chart-total',
  '.chart-total-unit',
];

const steps = (selector, from, count) =>
  Array.from({ length: count }, (_v, i) => `${selector}:nth-of-type(${i + 2}){animation-delay:${from + (i + 1) * ARRIVAL_STEP_MS}ms}`).join('')
  + `${selector}:nth-of-type(n+${count + 2}){animation-delay:${from + (count + 1) * ARRIVAL_STEP_MS}ms}`;

export const ARRIVAL_CSS = [
  '@keyframes nd-in{from{opacity:0}}',
  '@keyframes nd-rise{from{transform:scaleY(0)}}',
  '@keyframes nd-run{from{transform:scaleX(0)}}',
  // Pixels above and below, never a percentage: a level line has no height to take a percentage of.
  '@keyframes nd-draw{from{clip-path:inset(-24px 100% -24px -24px)}to{clip-path:inset(-24px -24px -24px -24px)}}',
  `${FIRST.join(',')}{animation:nd-in ${IN}}`,
  // Boxes in the order they were written; from the seventh on, together.
  steps('g.nodes > g.node', 0, 5),
  steps('.chart-slice', 0, 5),
  `${THEN.join(',')}{animation:nd-in ${IN};animation-delay:200ms}`,
  `.chart-bar{transform-box:fill-box;transform-origin:50% 100%;animation:nd-rise 400ms ${EASE} backwards}`,
  `.chart-stage{transform-origin:0 50%;animation-name:nd-run}`,
  steps('.chart-stage', 0, 5),
  `.chart-line{animation:nd-draw 450ms ${EASE} backwards}`,
  `.chart-value{animation:nd-in ${IN};animation-delay:240ms}`,
  '@media (prefers-reduced-motion: reduce){*{animation:none!important}}',
].join('');

const MARK = '<style data-arrival="1">';

/** The SVG with its arrival motion added. Anything that is not an SVG document comes back unchanged. */
export function withArrivalMotion(svg) {
  if (typeof svg !== 'string' || svg.includes(MARK)) return svg;
  const close = svg.lastIndexOf('</svg>');
  if (close < 0) return svg;
  // Last in the document, so it follows Mermaid's own <style>.
  return `${svg.slice(0, close)}${MARK}${ARRIVAL_CSS}</style>${svg.slice(close)}`;
}
