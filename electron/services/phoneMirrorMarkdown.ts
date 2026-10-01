// Answer markdown → HTML for the Phone Mirror page.
//
// Rendered HERE, on the desktop, with the overlay's own pieces so the phone
// shows what the overlay shows:
//   - marked (the overlay's streaming renderer) with the same math extensions
//     (STREAMING_MATH_EXTENSIONS: the same $…$ / $$…$$ / \[…\] and currency rules)
//   - GFM tables, strikethrough, task lists, nested lists (marked defaults)
//   - the overlay's [[GIST]] split (src/lib/displayMarkup.ts), streaming-aware
// KaTeX output carries MathML, which phones render natively; the page hides
// KaTeX's HTML half, which would need KaTeX's CSS and fonts.
//
// Safe by construction, because the phone has no DOMPurify: raw HTML in a
// model's answer renders as text, links are http(s)/mailto only, and images
// become links (the page's CSP blocks remote images anyway). KaTeX runs with
// trust off (its default), so \href and friends are not honoured.

import { Marked, type Tokens } from 'marked';
import { STREAMING_MATH_EXTENSIONS } from '../../src/lib/streamingMarkdown';
import { splitGistLine, splitGistLineStreaming } from '../../src/lib/displayMarkup';
import { extractMermaidBlocks } from '../../src/lib/diagram/fencedBlocks.mjs';
import { checkDiagramSource, diagramSourceKey, diagramCardLabel } from '../../src/lib/diagram/diagramPolicy.mjs';

/**
 * Where a diagram's picture comes from. The main process cannot run Mermaid
 * (no DOM), so main.ts registers a provider backed by PhoneDiagramBroker: it
 * returns an already-drawn image for a diagram, or is asked to get one drawn.
 * Without a provider — or with diagrams switched off — a Mermaid block is an
 * ordinary code block, exactly as before.
 */
export interface PhoneDiagramProvider {
  enabled(): boolean;
  /** An <img>-ready data URL for this diagram key, when one has been drawn. */
  lookup(key: string): string | undefined;
  /** True when drawing this diagram failed recently. */
  failed(key: string): boolean;
  /** Ask for the diagram to be drawn (asynchronous; a later render picks it up). */
  request(key: string, source: string): void;
}

let diagramProvider: PhoneDiagramProvider | null = null;

export function setPhoneDiagramProvider(provider: PhoneDiagramProvider | null): void {
  diagramProvider = provider;
}

/** Sources of the Mermaid blocks that are COMPLETE in the answer being rendered. */
let completeDiagramSources: Set<string> | null = null;
const normSource = (v: string): string => String(v ?? '').replace(/\r\n?/g, '\n').trim();

const IMG_DATA_URL = /^data:image\/svg\+xml;charset=utf-8,[A-Za-z0-9%._~!*'()-]+$/;

function codeBlockHtml(language: string, text: string): string {
  return `<div class="codeblock" data-lang="${escapeHtml(language)}">`
    + `<div class="codeblock-head"><span>${language ? escapeHtml(language) : 'code'}</span>`
    + `<button type="button" class="codeblock-copy">Copy</button></div>`
    + `<pre><code>${escapeHtml(text)}</code></pre></div>`;
}

/**
 * A Mermaid block as the phone shows it: the picture when one has been drawn,
 * a short status otherwise, and always the source underneath (collapsed) — the
 * readable fallback for a diagram this device cannot be given.
 */
function diagramHtml(text: string, info: string): string | null {
  const provider = diagramProvider;
  if (!provider || !provider.enabled()) return null;
  // "mermaid source": the user asked for the text, not a drawing.
  if (/\bsource\b/i.test(info.replace(/^\s*\S+/, ''))) return null;
  const source = normSource(text);
  const complete = completeDiagramSources?.has(source) === true;
  const sourceBlock = codeBlockHtml('mermaid', text);
  if (!complete) {
    // Still arriving: no key, no request. Nothing is drawn from a partial block.
    return `<figure class="diagram is-pending"><div class="diagram-view"><div class="diagram-note">Generating diagram…</div></div>`
      + `<details class="diagram-source"><summary>Mermaid source</summary>${sourceBlock}</details></figure>`;
  }
  const policy = checkDiagramSource(source);
  if (!policy.ok) {
    return `<figure class="diagram is-failed"><div class="diagram-view"><div class="diagram-note">${escapeHtml(policy.message || 'This diagram could not be drawn.')}</div></div>`
      + `<details class="diagram-source" open><summary>Mermaid source</summary>${sourceBlock}</details></figure>`;
  }
  const key = diagramSourceKey(source);
  const label = escapeHtml(diagramCardLabel(policy.view));
  const image = provider.lookup(key);
  let view: string;
  let state = 'is-pending';
  let open = '';
  if (image && IMG_DATA_URL.test(image)) {
    // The only place a drawing enters the page: as an image, which cannot run
    // script or load anything. The URL is percent-encoded, so it carries no quote.
    view = `<img class="diagram-img" alt="${label}" src="${image}" />`;
    state = 'is-ready';
  } else if (provider.failed(key)) {
    view = `<div class="diagram-note">This diagram could not be drawn here. Its source is below.</div>`;
    state = 'is-failed';
    open = ' open';
  } else {
    provider.request(key, source);
    view = `<div class="diagram-note">Drawing diagram…</div>`;
  }
  return `<figure class="diagram ${state}" data-diagram="${escapeHtml(key)}" data-label="${label}">`
    + `<div class="diagram-view">${view}</div>`
    + `<details class="diagram-source"${open}><summary>Mermaid source</summary>${sourceBlock}</details></figure>`;
}

export interface PhoneRenderedAnswer {
  html: string;
  gist: string | null;
}

const SAFE_HREF = /^(https?:|mailto:)/i;

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const phoneMarked = new Marked({
  extensions: STREAMING_MATH_EXTENSIONS,
  renderer: {
    // A model's raw HTML is shown as text, never parsed as markup.
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link(this: any, { href, tokens }: Tokens.Link): string {
      const label = this.parser.parseInline(tokens);
      const url = String(href || '').trim();
      if (!SAFE_HREF.test(url)) return label;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ href, text }: Tokens.Image): string {
      const alt = escapeHtml(text || 'image');
      const url = String(href || '').trim();
      if (!SAFE_HREF.test(url)) return alt;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${alt}</a>`;
    },
    // The page's code block: language label, Copy button, highlighted on the
    // phone (its highlighter reads data-lang and the code text).
    code({ text, lang }: Tokens.Code): string {
      const info = String(lang || '').trim();
      const language = info.split(/\s+/)[0].toLowerCase();
      if (language === 'mermaid') {
        const diagram = diagramHtml(text, info);
        if (diagram) return diagram;
      }
      return codeBlockHtml(language, text);
    },
  },
});

/**
 * Render one answer. `streaming` hides a gist marker that is still arriving
 * (the overlay's splitGistLineStreaming), so it never flashes as text.
 */
export function renderPhoneAnswer(markdown: string, opts: { streaming?: boolean } = {}): PhoneRenderedAnswer {
  const split = opts.streaming ? splitGistLineStreaming(markdown || '') : splitGistLine(markdown || '');
  // Which Mermaid blocks are complete: only those are ever drawn. Decided by
  // the shared fence scanner, so a closing fence that has not fully arrived is
  // not mistaken for one (marked alone treats an open fence as a finished block).
  let body: string;
  try {
    completeDiagramSources = split.body.includes('mermaid')
      ? new Set(extractMermaidBlocks(split.body, { final: !opts.streaming }).filter((b) => b.closed).map((b) => normSource(b.source)))
      : null;
    body = phoneMarked.parse(split.body, { async: false }) as string;
  } finally {
    completeDiagramSources = null;
  }
  // Wide tables scroll sideways inside the card instead of widening the page.
  // Safe to match on the tag: raw HTML was escaped, so <table> is marked's own.
  const html = body
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, gist: split.gist };
}
