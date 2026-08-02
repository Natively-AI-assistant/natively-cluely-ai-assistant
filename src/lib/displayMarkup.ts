// Teleprompter display markup — renderer-side twin of the helpers in
// electron/llm/promptSystemV2.ts (splitGistLine / stripDisplayMarkup).
// The renderer cannot import main-process modules, so the [[GIST]] split
// logic is duplicated here; keep the semantics in lockstep with the main
// process: the marker is honored ONLY when it starts the LAST non-empty
// line — anywhere else it is malformed output and stays visible.

export const GIST_MARKER = '[[GIST]]';

export interface GistSplit {
  body: string;
  gist: string | null;
}

/** Split a response into its speakable body and the optional bottom gist. */
export function splitGistLine(text: string): GistSplit {
  const t = (text || '').replace(/\s+$/, '');
  const idx = t.lastIndexOf(GIST_MARKER);
  if (idx < 0) return { body: t, gist: null };
  const tail = t.slice(idx);
  if (tail.includes('\n')) return { body: t, gist: null };
  const lineStart = t.lastIndexOf('\n', idx);
  if (t.slice(lineStart + 1, idx).trim() !== '') return { body: t, gist: null };
  return {
    body: t.slice(0, lineStart < 0 ? 0 : lineStart).replace(/\s+$/, ''),
    gist: tail.slice(GIST_MARKER.length).trim() || null,
  };
}

/**
 * Streaming-aware variant: while tokens stream in, the gist marker can be
 * mid-arrival ("[[", "[[GI", "[[GIST]] fir…"). A trailing line that is a
 * partial prefix of the marker is hidden so the marker never flashes as
 * literal text; once complete, the normal split applies (the gist text
 * itself streams into the chip).
 */
export function splitGistLineStreaming(text: string): GistSplit {
  const full = splitGistLine(text);
  if (full.gist !== null) return full;
  const t = text || '';
  const lineStart = t.lastIndexOf('\n');
  const lastLine = t.slice(lineStart + 1).trimStart();
  if (lastLine && GIST_MARKER.startsWith(lastLine)) {
    return { body: t.slice(0, lineStart < 0 ? 0 : lineStart).replace(/\s+$/, ''), gist: null };
  }
  return full;
}

/**
 * Remove the newlines `marked` emits BETWEEN block elements.
 *
 * The streaming bubble renders parsed HTML into a container that also carries
 * `whitespace-pre-wrap` (it has to: a plain-text answer's own line breaks are
 * meaningful and there is no <br> for them). But marked separates every block
 * with a literal "\n" — `</p>\n<pre>` — and under pre-wrap that newline paints
 * as a real blank line ON TOP of the 6px margin `.markdown-content p` already
 * applies. Result: every paragraph and code fence was separated by roughly two
 * line-heights instead of one.
 *
 * Three boundary shapes, because marked emits the newline in three places
 * (2026-08-02 — the first version handled only the first and every list
 * kept a stray blank line before its first item):
 *   1. after a CLOSING block tag        — `</p>\n<pre>`
 *   2. after an OPENING container tag   — `<ul>\n<li>`
 *   3. before an OPENING block tag      — `a\n<ul>` (loose list content)
 *
 * All three are safe against code fences: marked escapes `<` and `>` inside
 * code (`</p>` becomes `&lt;/p&gt;`), so a literal block tag can only be real
 * markup and a code sample's own newlines survive intact. Newlines inside
 * running paragraph text (soft breaks, e.g. `<p>line one\nline two</p>`) touch
 * no tag boundary and are untouched — pre-wrap still renders them.
 */
const AFTER_CLOSING_BLOCK_RE =
  /(<\/(?:p|pre|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tr|td|th|div)>|<hr\s*\/?>|<br\s*\/?>)\n+/g;
const AFTER_OPENING_CONTAINER_RE =
  /(<(?:ul|ol|blockquote|table|thead|tbody|tr)(?:\s[^>]*)?>)\n+/g;
const BEFORE_OPENING_BLOCK_RE =
  /\n+(?=<(?:p|pre|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tr|td|th|div|hr)[\s>/])/g;

export function collapseBlockGaps(html: string): string {
  return (html || '')
    .replace(AFTER_CLOSING_BLOCK_RE, '$1')
    .replace(AFTER_OPENING_CONTAINER_RE, '$1')
    .replace(BEFORE_OPENING_BLOCK_RE, '');
}

/** Pure spoken word-stream: hot-word marks removed, gist line removed. */
export function stripDisplayMarkup(text: string): string {
  const { body } = splitGistLine(text || '');
  return body.replace(/\*\*([^*\n]+)\*\*/g, '$1');
}
