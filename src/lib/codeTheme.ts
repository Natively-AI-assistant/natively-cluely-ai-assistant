import type React from 'react';

// Custom vivid-on-black Prism theme for code blocks, replacing vscDarkPlus in
// the default (non-modern, non-glass) dark meeting overlay + the recap page's
// CodeHero. Same object shape as react-syntax-highlighter's built-in
// vsc-dark-plus.js (see node_modules/react-syntax-highlighter/src/styles/prism/vsc-dark-plus.js)
// so it's a drop-in `style` prop replacement.
//
// Four accent hues, each used for exactly one semantic role everywhere so the
// palette stays legible across languages instead of accumulating one-off
// per-language colors:
//   pink   #ff5fa8 — keywords / control-flow / tags / selectors / at-rules
//   orange #ffb454 — numeric literals / booleans / units (never anything else)
//   cyan   #5ccfe6 — operators / entities / escapes
//   green  #95e6a0 — strings / chars / attr values / regex
// Everything identifier-shaped (functions, class names, variables, params,
// properties, builtins, attr names) stays base white (#e7e7ea) — confirmed
// against the reference screenshot, where `hammingWeight` (function) and
// `Solution` (class-name) render as plain text, not a 5th accent color.
//
// Deliberately OMITTED vs. vsc-dark-plus: the per-language base-color
// overrides (`pre/code[class*="language-javascript|jsx|typescript|tsx|css"]`)
// — those override the base foreground only for those languages (e.g. JS/TS
// get a light-blue base), which would contradict "identifiers are plain
// everywhere" the moment a JS block sat next to a Java block.
const PINK = '#ff5fa8';
const ORANGE = '#ffb454';
const CYAN = '#5ccfe6';
const GREEN = '#95e6a0';
const WHITE = '#e7e7ea';
const DIM_GRAY = '#c8c9cc';
const COMMENT_GRAY = '#6b7280';
const RED = '#ff6b6b';
const SELECTION_BG = 'rgba(92, 207, 230, 0.25)';

const baseTokenStyle = {
  color: WHITE,
  fontSize: '13px',
  textShadow: 'none',
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace',
  direction: 'ltr' as const,
  textAlign: 'left' as const,
  whiteSpace: 'pre' as const,
  wordSpacing: 'normal',
  wordBreak: 'normal' as const,
  lineHeight: '1.5',
  MozTabSize: '4',
  OTabSize: '4',
  tabSize: '4',
  WebkitHyphens: 'none' as const,
  MozHyphens: 'none' as const,
  msHyphens: 'none' as const,
  hyphens: 'none' as const,
};

export const vividDarkCodeTheme: Record<string, React.CSSProperties> = {
  'pre[class*="language-"]': {
    ...baseTokenStyle,
    padding: '1em',
    margin: '.5em 0',
    overflow: 'auto',
    background: 'transparent',
  },
  'code[class*="language-"]': baseTokenStyle,
  'pre[class*="language-"]::selection': { textShadow: 'none', background: SELECTION_BG },
  'code[class*="language-"]::selection': { textShadow: 'none', background: SELECTION_BG },
  'pre[class*="language-"] *::selection': { textShadow: 'none', background: SELECTION_BG },
  'code[class*="language-"] *::selection': { textShadow: 'none', background: SELECTION_BG },
  ':not(pre) > code[class*="language-"]': {
    padding: '.1em .3em',
    borderRadius: '.3em',
    color: WHITE,
    background: 'transparent',
  },
  '.namespace': { opacity: '.7' },
  'doctype.name': { color: WHITE },
  comment: { color: COMMENT_GRAY, fontStyle: 'italic' },
  prolog: { color: COMMENT_GRAY, fontStyle: 'italic' },
  cdata: { color: COMMENT_GRAY, fontStyle: 'italic' },
  punctuation: { color: DIM_GRAY },
  'tag.punctuation': { color: DIM_GRAY },
  'attr-value.punctuation.attr-equals': { color: DIM_GRAY },
  property: { color: WHITE },
  tag: { color: PINK },
  boolean: { color: ORANGE },
  number: { color: ORANGE },
  unit: { color: ORANGE },
  constant: { color: WHITE },
  symbol: { color: WHITE },
  inserted: { color: GREEN },
  deleted: { color: RED },
  selector: { color: PINK },
  'attr-name': { color: WHITE },
  string: { color: GREEN },
  char: { color: GREEN },
  builtin: { color: WHITE },
  '.language-css .token.string.url': { textDecoration: 'underline' },
  operator: { color: CYAN },
  'operator.arrow': { color: CYAN },
  entity: { color: CYAN },
  escape: { color: CYAN },
  'punctuation.interpolation-punctuation': { color: CYAN },
  atrule: { color: PINK },
  keyword: { color: PINK },
  'keyword.module': { color: PINK },
  'keyword.control-flow': { color: PINK },
  important: { color: PINK },
  function: { color: WHITE },
  'function.maybe-class-name': { color: WHITE },
  regex: { color: GREEN },
  italic: { fontStyle: 'italic' },
  'class-name': { color: WHITE },
  'maybe-class-name': { color: WHITE },
  console: { color: WHITE },
  parameter: { color: WHITE },
  interpolation: { color: WHITE },
  variable: { color: WHITE },
  'imports.maybe-class-name': { color: WHITE },
  'exports.maybe-class-name': { color: WHITE },
  namespace: { color: WHITE },
  'attr-value': { color: GREEN },
  'attr-value.punctuation': { color: GREEN },
  'pre[class*="language-"] > code[class*="language-"]': { position: 'relative', zIndex: '1' },
};

/** Gutter/line-number color tuned for vividDarkCodeTheme's near-black card background. */
export const VIVID_DARK_LINE_NUMBER_COLOR = 'rgba(255,255,255,0.34)';

/** Card background (near-pure black with a whisper of the app's cool-neutral hue) — see overlayAppearance.ts codeBlockStyle dark branch. */
export const VIVID_DARK_CODE_BG_RGB = '10, 10, 13';
