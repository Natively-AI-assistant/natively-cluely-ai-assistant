// electron/services/modes/lexicalTokens.ts
//
// THE lexical tokenizer for hybrid retrieval. One implementation, imported by
// both ModeContextRetriever and ModeHybridRetriever.
//
// It previously existed as two copies carrying the warning "Keep this in
// lock-step with ModeContextRetriever.wordsOf — divergence breaks hybrid score
// fusion." They had already drifted in comments; a functional drift would have
// silently mis-fused FTS and vector scores, which is exactly the class of bug a
// comment cannot prevent. Sharing the code removes the hazard.
//
// NUMERAL EQUIVALENCE — measured defect
// A user asking "How fast did Natively reach ten thousand users?" retrieved
// NOTHING from a résumé that says "scaled Natively to 10k users in the first 90
// days". Measured on corpus question A-03:
//
//   query "…reach ten thousand users?"  ->  résumé fts 0.000  ·  NOT retrieved
//   query "…reach 10k users?"           ->  résumé fts 0.152  ·  retrieved
//
// The vector score alone (0.196) could not clear MIN_COMBINED_SCORE, so the
// lexical arm contributing zero decided the turn. Spelled-out numbers, compact
// magnitudes and comma-grouped digits are the same quantity and must produce the
// same token.

/** Word forms below twenty. */
const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Multipliers. `hundred` multiplies the pending value; the rest close a group. */
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000,
};

/** Compact magnitude suffixes, as written in résumés and decks. */
const SUFFIXES: Record<string, number> = {
  k: 1000, m: 1_000_000, mm: 1_000_000, b: 1_000_000_000, bn: 1_000_000_000,
};

const isNumberWord = (w: string) => w in SMALL || w in TENS || w in SCALES;

/**
 * Canonical digit strings for every quantity named in the text.
 *
 * Returned as EXTRA tokens rather than replacements: existing matches must keep
 * working, so "10k" still yields `10k` and additionally yields `10000`.
 */
export function numeralTokens(lowercased: string): string[] {
  const out: string[] = [];

  // "1,250,000" -> 1250000. The tokenizer strips commas to spaces, which would
  // otherwise split one quantity into "250" and "000".
  let text = lowercased;
  for (let i = 0; i < 4; i++) text = text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');

  // "10k", "1.5m", "2bn"
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(mm|bn|[kmb])\b/g)) {
    const v = Number(m[1]) * SUFFIXES[m[2]];
    if (Number.isFinite(v)) out.push(String(Math.round(v)));
  }

  // Bare grouped digits, so "10,000" and "10000" agree.
  for (const m of text.matchAll(/\b\d{4,}\b/g)) out.push(m[0]);

  // Spelled-out runs: "ten thousand", "two hundred fifty", "1.5 million".
  const words = text.replace(/[^a-z0-9.\s-]/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawAny = false;

  const flush = () => {
    if (sawAny) {
      const v = total + current;
      if (v > 0) out.push(String(v));
    }
    total = 0; current = 0; sawAny = false;
  };

  for (const w of words) {
    if (w === 'and' && sawAny) continue;            // "two hundred and fifty"
    if (isNumberWord(w)) {
      sawAny = true;
      if (w in SMALL) current += SMALL[w];
      else if (w in TENS) current += TENS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else { total += (current || 1) * SCALES[w]; current = 0; }
      continue;
    }
    // A digit immediately before a scale word: "1.5 million".
    if (/^\d+(?:\.\d+)?$/.test(w)) { flush(); sawAny = true; current = Number(w); continue; }
    flush();
  }
  flush();

  return out;
}

/**
 * Tokenize for FTS scoring.
 *
 * The transformation chain below is unchanged from the two copies it replaces —
 * possessive `'s` collapsed as a unit, remaining apostrophes dropped so
 * contractions stay one token, non-alphanumerics to spaces, tokens of 1–2
 * characters discarded.
 */
// HYPHENATED IDENTIFIERS — measured defect (deep-test D2, 2026-08-01)
// The keep-set on line ~121 preserves hyphens, so `TECH-SMALL-CANARY-524`
// tokenizes to ONE opaque token. Asking "What is the small technical canary?"
// then shares ZERO tokens with the line that answers it — fts is exactly
// 0.0000 before any threshold runs, and no floor tuning can recover a chunk
// the tokenizer made invisible. Underscored identifiers never had this
// problem (`WORKER_BATCH_SIZE` splits on `_` into worker/batch/size), which is
// why snake_case facts retrieved and hyphenated ones did not.
//
// Same pattern as numeralTokens: the parts are EXTRA tokens, never
// replacements, so retrieval BY the full identifier keeps working.
function hyphenSubTokens(base: string[]): string[] {
  const extra: string[] = [];
  for (const w of base) {
    if (!w.includes('-')) continue;
    for (const part of w.split('-')) {
      if (part.length > 2 && !base.includes(part) && !extra.includes(part)) extra.push(part);
    }
  }
  return extra;
}

export function wordsOf(text: string): string[] {
  const lower = text.toLowerCase();
  const base = lower
    // English possessive: collapse "Green's" → "green", "interviewer's" →
    // "interviewer", symmetrically on query and chunk.
    .replace(/['’]s\b/g, '')
    // Remaining in-word apostrophes (contractions): drop them so the word stays
    // one token ("dont", "cant") rather than splitting into a dropped fragment.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const hyphenExtra = hyphenSubTokens(base);
  const withHyphens = hyphenExtra.length ? base.concat(hyphenExtra) : base;

  // Only pay for the numeral pass when the text actually contains a quantity.
  if (!/\d/.test(lower) && !/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/.test(lower)) {
    return withHyphens;
  }
  const extra = numeralTokens(lower).filter((t) => t.length > 2 && !withHyphens.includes(t));
  return extra.length ? withHyphens.concat(extra) : withHyphens;
}
