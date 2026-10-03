// Number normalisation for spoken answers: "twenty-five" → 25, "three hundred and twenty" → 320,
// "$38,280" → 38280, "1.2k" → 1200, "sixty two" → 62, "ninety-nine point nine" → 99.9.
// Deterministic and dependency-free; good enough for validator checks, not a general NLP parser.

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };
const WORD = new RegExp(`\\b(?:${[...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES), 'a', 'and', 'point'].join('|')})(?:[\\s-]+(?:${[...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES), 'and', 'point'].join('|')}))*\\b`, 'gi');

function wordsToNumber(phrase) {
  const toks = phrase.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (!toks.some((t) => t in UNITS || t in TENS)) return null; // "a hundred" alone is rare; skip bare scales/"and"
  let total = 0, cur = 0, decimals = null;
  for (const t of toks) {
    if (decimals !== null) { if (t in UNITS) decimals += String(UNITS[t]); continue; }
    if (t === 'and' || t === 'a') continue;
    if (t === 'point') { decimals = ''; continue; }
    if (t in UNITS) cur += UNITS[t];
    else if (t in TENS) cur += TENS[t];
    else if (t === 'hundred') cur = (cur || 1) * 100;
    else if (t in SCALES) { total += (cur || 1) * SCALES[t]; cur = 0; }
  }
  const n = total + cur;
  return decimals ? Number(`${n}.${decimals}`) : n;
}

/** Replace spelled-out numbers with digits and strip thousands separators / currency glue. */
export function normaliseNumbers(text) {
  let s = String(text ?? '').replace(/[‘’]/g, "'").replace(/−/g, '-');
  s = s.replace(WORD, (m) => {
    const lead = m.match(/^\s*/)[0];
    const core = m.trim();
    if (/^(?:a|and|point)$/i.test(core)) return m;
    const n = wordsToNumber(core);
    return n == null ? m : `${lead}${n}`;
  });
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*[kK]\b/g, (_, n) => String(Number(n) * 1000));
  // Digits followed by a scale word ("2 million", "1.5 billion", "3 thousand"): the spoken form models use for
  // large counts. Without this, "the hidden cases go up to 2 million windows" read as 2 (DTECH-023, 2026-09-30).
  s = s.replace(/\b(\d+(?:\.\d+)?)\s+(thousand|million|billion)\b/gi, (_, n, sc) => String(Math.round(Number(n) * SCALES[sc.toLowerCase()])));
  return s;
}

/** Every number in a normalised text (currency and % signs ignored). */
export function numbersIn(norm) {
  return [...String(norm).matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter(Number.isFinite);
}
