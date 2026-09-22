// scripts/intent-benchmark/lib/codeSwitch.mjs
//
// Does a row actually code-switch, or is it English wearing a language tag?
//
// The founder's hand check flagged four rows tagged hinglish or manglish that
// contain no non-English words at all — "hows the export feature coming along
// i mean is it done" is plain English. Measuring the whole corpus found the
// same thing in 19% of hinglish rows and 27% of manglish ones.
//
// That matters more than it looks. A slice that is a quarter English does not
// measure what it claims to: a candidate scoring well on it may simply be
// scoring well on the English rows inside it, and the multilingual number would
// look reassuring while meaning nothing.
//
// The marker lists are deliberately small and high-frequency. They are a
// PRESENCE test, not a language identifier: the question is only "did any
// switch happen", and a short list of very common function words answers that
// without pretending to detect the language properly.

export const HINGLISH_MARKERS = new Set([
  'toh', 'matlab', 'haan', 'nahi', 'nahin', 'thoda', 'abhi', 'kya', 'bas',
  'acha', 'achha', 'theek', 'teek', 'yaar', 'diya', 'gaya', 'karna', 'chahiye',
  'lagta', 'pata', 'hai', 'hain', 'wo', 'woh', 'ye', 'yeh', 'mera', 'tera',
  'uska', 'kuch', 'sab', 'bhi', 'phir', 'aur', 'ek', 'kar', 'ho', 'ki', 'ka',
  // characteristic mis-transcriptions the brief asks the generator to produce
  'mutlub', 'archa', 'han', 'hun',
]);

export const MANGLISH_MARKERS = new Set([
  'enthaa', 'entha', 'alle', 'aanu', 'anu', 'illa', 'und', 'pinne', 'ippo',
  'sheri', 'shari', 'athu', 'ithu', 'cheyyam', 'cheyyanam', 'cheyanam',
  'venam', 'ariyilla', 'nokkam', 'mathi', 'kittiyo', 'parayu', 'paraya',
  'parayam', 'njan', 'ente', 'ninte', 'oru', 'randu', 'ellam', 'ennu',
  'ennaa', 'ari', 'mo',
]);

const MARKERS = { hinglish: HINGLISH_MARKERS, manglish: MANGLISH_MARKERS };

/** True when the text carries at least one marker for the claimed language. */
export function codeSwitches(text, language) {
  const markers = MARKERS[language];
  if (!markers) return true;   // 'en' and anything unknown are not checked
  const words = String(text ?? '').toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((w) => markers.has(w));
}

/**
 * Retag rows whose claimed language shows no switching at all.
 *
 * Retag rather than delete: the row is a perfectly good English row, and the
 * input was generated, reviewed and restored like any other. Only the language
 * claim was wrong.
 */
export function retagMonolingual(rows) {
  let retagged = 0;
  for (const r of rows) {
    if (r.language === 'en') continue;
    if (!codeSwitches(r.input, r.language)) { r.language = 'en'; retagged++; }
  }
  return retagged;
}
