const STREAMING_CODE_UI_INTENTS = new Set(['what_to_answer', 'chat']);

export function shouldUseStreamingCodeUi(intent, token, previousText = '') {
  if (!STREAMING_CODE_UI_INTENTS.has(intent) || typeof token !== 'string') return false;
  const combined = `${typeof previousText === 'string' ? previousText : ''}${token}`;
  return combined.includes('```');
}

/**
 * Whether `part` — one element of
 * `msg.text.split(/(```[\s\S]*?(?:```|$))/g)` — is a fence block still open
 * at the live edge of arrival (opened by ``` but not yet closed by a later
 * one). Only the LAST element of that split can ever be in this state: every
 * earlier element's content is fixed the moment a later fence marker appears
 * after it, so this is safe to call per-render without memoizing.
 *
 * The `length < 6` guard covers the bare-marker states ("```", "```py") that
 * have no possible closing marker yet — `endsWith('```')` alone would wrongly
 * treat the literal 3-backtick opening marker as "closed" (it both starts AND
 * ends with the same 3 characters). Six is the shortest STRING that could
 * legitimately contain both an opening and a closing marker (e.g. an empty
 * fenced block written as six backticks with nothing between).
 */
export function isUnclosedCodeFencePart(part) {
  if (typeof part !== 'string' || !part.startsWith('```')) return false;
  return part.length < 6 || !part.endsWith('```');
}

/**
 * Split an in-progress code fence's raw code content (already stripped of
 * the leading ```lang\n marker) into:
 *   - completedLines: lines terminated by a newline that has already
 *     arrived — these will never change again, so they're safe to run
 *     through Prism and cache.
 *   - partialLine: whatever text follows the last newline (or the whole
 *     string, if no newline has arrived yet) — still growing character by
 *     character, so it must NOT be syntax-highlighted yet (an incomplete
 *     token — an unclosed string/comment/bracket — would tokenize wrong and
 *     then visibly recolor the instant it closes).
 *
 * Pure and clock-free, mirroring the rest of this module — called once per
 * render from the streaming code-block component, not from any RAF loop.
 */
export function splitStreamingCodeLines(code) {
  if (typeof code !== 'string' || code.length === 0) {
    return { completedLines: [], partialLine: '' };
  }
  const lastNewline = code.lastIndexOf('\n');
  if (lastNewline === -1) {
    return { completedLines: [], partialLine: code };
  }
  const completed = code.slice(0, lastNewline);
  const partial = code.slice(lastNewline + 1);
  return {
    completedLines: completed.length > 0 ? completed.split('\n') : [''],
    partialLine: partial,
  };
}
