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
      const language = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
      return `<div class="codeblock" data-lang="${escapeHtml(language)}">`
        + `<div class="codeblock-head"><span>${language ? escapeHtml(language) : 'code'}</span>`
        + `<button type="button" class="codeblock-copy">Copy</button></div>`
        + `<pre><code>${escapeHtml(text)}</code></pre></div>`;
    },
  },
});

/**
 * Render one answer. `streaming` hides a gist marker that is still arriving
 * (the overlay's splitGistLineStreaming), so it never flashes as text.
 */
export function renderPhoneAnswer(markdown: string, opts: { streaming?: boolean } = {}): PhoneRenderedAnswer {
  const split = opts.streaming ? splitGistLineStreaming(markdown || '') : splitGistLine(markdown || '');
  const body = phoneMarked.parse(split.body, { async: false }) as string;
  // Wide tables scroll sideways inside the card instead of widening the page.
  // Safe to match on the tag: raw HTML was escaped, so <table> is marked's own.
  const html = body
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, gist: split.gist };
}
