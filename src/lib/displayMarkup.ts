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
  /** True when the marker was recovered from a malformed shape (the model broke
   *  the line after the marker). The chip renders normally; the lint still
   *  reports it so prompt drift stays visible. Absent on clean output.
   *  No renderer consumer reads this — it exists so the main-process twin's
   *  spokenFormatViolations() has a field to key off and the two copies stay
   *  literally identical. Do not delete it as unused. */
  recovered?: boolean;
}

/**
 * Split a response into its speakable body and the optional bottom gist.
 *
 * The marker is honored only when it STARTS a line — mid-line it is prose.
 * A marker that starts its line is display chrome either way: even with no
 * essence after it, the marker itself never reaches the body (it would be
 * rendered AND spoken by every stripDisplayMarkup consumer).
 *
 * Canonically the essence follows on that same line. Models break that line
 * often enough that the marker used to leak to screen as literal `[[GIST]]`
 * text (2026-08-12), so a marker alone on its line is recovered when exactly
 * one short non-empty line follows. Two rejections keep the recovery from
 * eating real prose: more than one following line, and a following line
 * longer than a gist can contractually be (the prompt asks for five to eight
 * words; past RECOVERY_MAX_WORDS it is likelier a real closing sentence the
 * model wrote under a misplaced marker, and losing it would silently drop a
 * spoken sentence). Rejected shapes keep the marker visible and lint-flagged.
 */
const RECOVERY_MAX_WORDS = 10;

export function splitGistLine(text: string): GistSplit {
  const t = (text || '').replace(/\s+$/, '');
  const idx = t.lastIndexOf(GIST_MARKER);
  if (idx < 0) return { body: t, gist: null };
  const lineStart = t.lastIndexOf('\n', idx);
  if (t.slice(lineStart + 1, idx).trim() !== '') return { body: t, gist: null };
  const body = t.slice(0, lineStart < 0 ? 0 : lineStart).replace(/\s+$/, '');
  const tail = t.slice(idx + GIST_MARKER.length);
  if (!tail.includes('\n')) return { body, gist: tail.trim() || null };
  const rest = tail.split('\n').map((l) => l.trim()).filter(Boolean);
  if (rest.length !== 1) return { body: t, gist: null };
  if (rest[0].split(/\s+/).length > RECOVERY_MAX_WORDS) return { body: t, gist: null };
  return { body, gist: rest[0], recovered: true };
}

/**
 * Streaming-aware variant: while tokens stream in, the gist marker can be
 * mid-arrival ("[[", "[[GI", "[[GIST]] fir…"). A trailing line that is a
 * partial prefix of the marker is hidden so the marker never flashes as
 * literal text; once complete, the normal split applies (the gist text
 * itself streams into the chip).
 *
 * The prefix test runs on the END-TRIMMED text on purpose: after a COMPLETE
 * marker followed by a newline the raw last line is empty, and testing that
 * raw line let the frame between "[[GIST]]\n" and the first essence token
 * paint the marker as literal text.
 */
export function splitGistLineStreaming(text: string): GistSplit {
  const full = splitGistLine(text);
  if (full.gist !== null) return full;
  const t = (text || '').replace(/\s+$/, '');
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
