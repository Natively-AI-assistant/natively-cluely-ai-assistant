/**
 * Detect screenshots that captured a browser/dev-server error page instead of
 * the user's actual problem (LeetCode, docs, IDE, etc.).
 *
 * Common in local Electron+Vite runs: ⌘⇧Enter hides the overlay, exposing a
 * background tab still pointed at http://localhost:5180 that shows
 * ERR_CONNECTION_REFUSED. Vision then "correctly" says there's nothing to answer.
 */

const UNUSABLE_SCREEN_PATTERNS: RegExp[] = [
  /ERR_CONNECTION_REFUSED/i,
  /ERR_CONNECTION_RESET/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_EMPTY_RESPONSE/i,
  /ERR_TIMED_OUT/i,
  /ERR_ADDRESS_UNREACHABLE/i,
  /\bConnection Failed\b/i,
  /\bThis site can'?t be reached\b/i,
  /\bThis page isn'?t working\b/i,
  /\bUnable to connect\b/i,
  /\bRestart Browser\b/i,
  /localhost:\d{2,5}/i,
];

export function isUnusableScreenCaptureText(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 12) return false;
  // Require a strong transport-error signal — bare "localhost" alone is too
  // common in real coding problems / stack traces.
  const strong = UNUSABLE_SCREEN_PATTERNS.filter((re) => {
    const src = re.source;
    return /ERR_|Connection Failed|can'?t be reached|isn'?t working|Unable to connect|Restart Browser/i.test(
      src,
    );
  });
  return strong.some((re) => re.test(t));
}

export const UNUSABLE_SCREEN_CAPTURE_USER_MESSAGE =
  'The screenshot captured a browser error page (connection failed), not your problem. Bring the coding or interview page to the front, close any localhost error tabs, then press ⌘⇧Enter again.';

/** Short model refusals that falsely deny an attached screenshot. */
export function looksLikeEmptyScreenClaim(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.length > 280) return false;
  return (
    /^there'?s\s+nothing\s+to\s+answer\s+yet\s+because\s+the\s+question\s+is\s+empty\.?$/i.test(t) ||
    /^it\s+looks\s+like\s+the\s+question\s+came\s+through\s+empty\b/i.test(t) ||
    /^i\s+don'?t\s+see\s+any\s+attached\s+screen\s+or\s+image\b/i.test(t) ||
    /^i\s+can'?t\s+see\s+the\s+attached\s+screen\b/i.test(t) ||
    /^i\s+don'?t\s+see\s+any\s+screen\s+content\b/i.test(t)
  );
}
