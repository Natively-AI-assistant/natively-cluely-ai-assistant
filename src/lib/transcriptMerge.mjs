/**
 * Overlap-aware merge for STT transcript chunks (voice-dictation "Answer Now"
 * flow). Pure helper, unit-tested — see src/lib/__tests__/DoubledQuestionMergeRace2026_07_24.test.mjs.
 */

function normalize(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

// Word-array prefix/suffix checks — deliberately NOT string startsWith/endsWith,
// which match on raw characters and can misfire across word boundaries (e.g.
// "category".startsWith("cat") or "chocolate".endsWith("late") would wrongly
// treat unrelated words as a transcript-correction overlap).
function arrayStartsWith(words, prefix) {
  if (prefix.length > words.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (words[i] !== prefix[i]) return false;
  }
  return true;
}

function arrayEndsWith(words, suffix) {
  if (suffix.length > words.length) return false;
  const offset = words.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (words[offset + i] !== suffix[i]) return false;
  }
  return true;
}

/**
 * Merge `addition` onto `base`, collapsing any overlap instead of
 * concatenating blindly. Handles three STT race shapes seen in production:
 *
 *  - `addition` is a corrected, more-complete re-transcription that starts
 *    the same way as `base` (an early VAD-triggered "final" for a
 *    sub-segment, followed by a second "final" for the whole utterance) —
 *    `addition` replaces `base` entirely.
 *  - `addition`'s content is already present at the end of `base` (a stale
 *    trailing partial fragment left over after a "final" already committed
 *    the same words) — `addition` is dropped.
 *  - a partial word-boundary overlap between the tail of `base` and the
 *    head of `addition` — the overlapping words are collapsed once instead
 *    of duplicated.
 *
 * Falls back to the original space-joined concatenation when none of the
 * above apply.
 */
export function mergeTranscriptChunks(base, addition) {
  const baseNorm = normalize(base);
  const addNorm = normalize(addition);

  if (!addNorm) return base ?? '';
  if (!baseNorm) return addition;

  const baseWords = baseNorm.split(' ');
  const addWords = addNorm.split(' ');
  const baseWordsLower = baseWords.map((w) => w.toLowerCase());
  const addWordsLower = addWords.map((w) => w.toLowerCase());

  if (arrayStartsWith(addWordsLower, baseWordsLower)) {
    return addition;
  }
  if (arrayEndsWith(baseWordsLower, addWordsLower)) {
    return base;
  }

  const maxOverlap = Math.min(baseWords.length, addWords.length);
  for (let n = maxOverlap; n >= 1; n--) {
    const baseTail = baseWords.slice(baseWords.length - n).join(' ').toLowerCase();
    const addHead = addWords.slice(0, n).join(' ').toLowerCase();
    if (baseTail === addHead) {
      return [...baseWords, ...addWords.slice(n)].join(' ');
    }
  }

  return baseNorm + ' ' + addNorm;
}
