/**
 * Pure helpers for overlay typed-submit deduplication (unit-tested).
 */

/** Normalize question text for duplicate comparison. */
export function normalizeSubmitText(text) {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Returns true when the same normalized text was submitted within windowMs.
 */
export function shouldDedupeManualSubmit({
  text,
  lastText,
  lastAtMs,
  nowMs,
  windowMs = 5000,
}) {
  const norm = normalizeSubmitText(text);
  if (!norm) return false;
  if (lastText == null || lastAtMs == null) return false;
  if (nowMs - lastAtMs > windowMs) return false;
  return normalizeSubmitText(lastText) === norm;
}
