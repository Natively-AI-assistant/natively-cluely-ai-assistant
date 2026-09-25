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
function hyphenSubTokens(base: string[], shortNumerics = false): string[] {
  // Set membership, not Array.includes: on one 546 kB table chunk (atomic, never
  // split) the includes-in-a-loop version took 3.1 s, and 6.9 s on 633 kB of
  // hyphenated ids — on the main process, inside retrieve() (review finding).
  const extra: string[] = [];
  const seen = new Set(base);
  for (const w of base) {
    if (!w.includes('-')) continue;
    for (const part of w.split('-')) {
      if ((shortNumerics ? keepToken(part) : part.length > 2) && !seen.has(part)) { seen.add(part); extra.push(part); }
    }
  }
  return extra;
}

// SHORT TOKENS THAT CARRY A DIGIT ARE IDENTIFIERS — measured defect
// (retrieval-scale campaign, 2026-09-19). The 1–2 character cut exists to drop
// "a", "of", "is"; it also dropped "13" from "Eyrie pod 13", "6" from "step 6",
// and "86" from "atlas-gateway-86" — the ONLY token separating the asked-for
// section from its siblings. On a 70k-token job description with 338
// same-shaped team sections, "Who leads the Eyrie pod 13?" ranked the section
// that answers it 101st of 397; every same-shaped lookup did likewise. A digit
// is never a stopword, so a short token survives when it has one ("13", "v2",
// "q3", "l5"); two-letter WORDS are still dropped.
//
// OPT-IN, and only where idf weighting exists. Turned on globally it broke two
// legacy-retriever tests the same day (ModeLongSession, ModePersonaScenarios):
// ModeContextRetriever's scorer has no idf, so every "2" and "3" in a chunk
// became a full-weight distinct term, inflated the length normalisation and
// pushed the right chunk under MIN_RELEVANCE_SCORE. With idf a numeral that is
// everywhere weighs ~0 and one that names a section weighs a lot — which is the
// entire point. `wordsOf(text)` is therefore byte-identical to what it was.
export function keepToken(word: string): boolean {
  return word.length > 2 || (word.length > 0 && /\d/.test(word));
}

export interface WordsOfOptions {
  /** Keep 1–2 character tokens that contain a digit. Use only under idf weighting. */
  shortNumerics?: boolean;
}

export function wordsOf(text: string, options: WordsOfOptions = {}): string[] {
  const shortNumerics = options.shortNumerics === true;
  const lower = text.toLowerCase();
  const base = lower
    // English possessive: collapse "Green's" → "green", "interviewer's" →
    // "interviewer", symmetrically on query and chunk.
    .replace(/['’]s\b/g, '')
    // Remaining in-word apostrophes (contractions): drop them so the word stays
    // one token ("dont", "cant") rather than splitting into a dropped fragment.
    .replace(/['’]/g, '')
    // Keep letters, combining marks and digits of EVERY script (2026-09-22).
    // This was `[^a-z0-9\s-]`, which turned a pure Hindi or Malayalam question
    // into zero tokens, so ModeHybridRetriever.retrieve() short-circuited to its
    // fallback before the (multilingual) embedder ever saw the query. Marks
    // (\p{M}) must stay: Devanagari vowel signs and virama are combining marks,
    // and dropping them splits a word mid-syllable. ASCII input is unchanged.
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(shortNumerics ? keepToken : (word) => word.length > 2);

  const hyphenExtra = hyphenSubTokens(base, shortNumerics);
  const withHyphens = hyphenExtra.length ? base.concat(hyphenExtra) : base;

  // Only pay for the numeral pass when the text actually contains a quantity.
  if (!/\d/.test(lower) && !/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/.test(lower)) {
    return withHyphens;
  }
  const present = new Set(withHyphens);
  // "pod seven" → "7": the digit form of a SPOKEN number is an identifier too, and it was
  // dropped by the length cut even on the path that keeps "13" and "v2" typed as digits.
  const extra = numeralTokens(lower).filter((t) => (shortNumerics ? keepToken(t) : t.length > 2) && !present.has(t));
  return extra.length ? withHyphens.concat(extra) : withHyphens;
}

// ── Corpus-weighted lexical scoring ─────────────────────────────────────────
//
// The shipped lexical score is distinct-term overlap, matches / sqrt(|Q|·|C|),
// with every term worth the same. That holds up on a five-chunk file. On a
// long document it collapses: "the", "what" and "pod" match every chunk and
// count exactly as much as the one name that identifies the section, so
// hundreds of sibling chunks tie and the answer-bearing one is wherever the
// tie-break leaves it (measured 2026-09-19: needle either in the top 6 or
// ranked 50th–350th, nothing in between — a wider rerank pool cannot reach
// rank 300).
//
// The weighted form is the SAME formula with each term worth its inverse
// document frequency over the pool being ranked:
//
//     Σ w(t∈Q∩C) / sqrt( Σ w(t∈Q) · Σ w(t∈C) )
//
// It stays in [0, 1], is invariant to the scale of w, and reduces exactly to
// the legacy score when every weight is equal — so the thresholds calibrated
// against the legacy scale (MIN_LEXICAL_SCORE, the combined floor) keep their
// meaning. Below IDF_MIN_POOL chunks document frequencies are noise, and the
// legacy score is used unchanged.

export const IDF_MIN_POOL = 12;

export interface LexicalStats {
  /** Pool size the frequencies were counted over. */
  n: number;
  idf: Map<string, number>;
  /** Distinct tokens per pool entry, index-aligned with the input texts. */
  sets: Array<Set<string>>;
  /** Σ idf over each entry's distinct tokens, index-aligned. */
  norms: number[];
}

export function buildLexicalStats(texts: string[]): LexicalStats | null {
  if (texts.length < IDF_MIN_POOL) return null;
  const sets = texts.map((t) => new Set(wordsOf(t, { shortNumerics: true })));
  const df = new Map<string, number>();
  for (const set of sets) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const n = texts.length;
  const idf = new Map<string, number>();
  // BM25's smoothed idf: always positive, ~0 for a term in every chunk.
  for (const [w, d] of df) idf.set(w, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  const norms = sets.map((set) => { let sum = 0; for (const w of set) sum += idf.get(w) ?? 0; return sum; });
  return { n, idf, sets, norms };
}

/**
 * Weights for one query. A query term the pool has never seen cannot tell one
 * chunk from another; it gets the mean weight of the terms the pool HAS seen,
 * which is what the legacy score gave it (every term equal) — the maximum idf
 * would deflate every chunk's score and push a paraphrased question under the
 * admission floor for one out-of-vocabulary word.
 */
export function queryWeights(queryWords: Set<string>, stats: LexicalStats): { weights: Map<string, number>; total: number } {
  const weights = new Map<string, number>();
  let seenSum = 0;
  let seen = 0;
  for (const w of queryWords) {
    const v = stats.idf.get(w);
    if (v !== undefined) { weights.set(w, v); seenSum += v; seen++; }
  }
  const unseen = seen > 0 ? seenSum / seen : 1;
  let total = seenSum;
  for (const w of queryWords) if (!weights.has(w)) { weights.set(w, unseen); total += unseen; }
  return { weights, total };
}

export function weightedOverlapScore(
  query: { weights: Map<string, number>; total: number },
  chunkSet: Set<string>,
  chunkNorm: number,
): number {
  if (query.total <= 0 || chunkNorm <= 0) return 0;
  let hit = 0;
  for (const [w, v] of query.weights) if (chunkSet.has(w)) hit += v;
  if (hit === 0) return 0;
  return Math.min(1, hit / Math.sqrt(query.total * chunkNorm));
}

// ── Anchor coverage ─────────────────────────────────────────────────────────
//
// An entity-anchored lookup ("who leads the Eyrie pod 13", "the SLO for
// atlas-gateway-86", "step 6 of the failover runbook") names its section with
// one or two terms that are RARE in the pool. Those terms are the strongest
// retrieval signal there is, and a linear blend lets the weakest one outvote
// them: measured 2026-09-19 on three 70k-token files, the section that matched
// BOTH rare terms had the top lexical score (0.203 vs 0.155) and still ranked
// 57th, because cosine similarity between a question and 338 same-shaped
// sections is noise (0.20–0.33) carrying 0.6 of the weight.
//
// Coverage is the idf-weighted share of the query's anchor terms a chunk holds,
// in [0, 1]. A question whose words match nothing distinctive (a paraphrase)
// gives every chunk a low coverage, and the squared boost vanishes.
//
// WHICH TERMS ANCHOR — corrected the same day. The first cut was "a term at
// most 3% of the pool has". That passed on the 70k-token fixtures (3% of 340+
// chunks is a generous ceiling) and silently did nothing on a 61-chunk document
// — the size of an ordinary 5k–10k-token file — where the ceiling is 3 chunks:
// "10" (8 chunks) and "Eyrie" (12) both missed it, though together they name
// exactly one section. Sections are identified by a CONJUNCTION of moderately
// rare terms, so there is no per-term rarity cutoff; a term anchors when most
// of the pool lacks it (idf ≥ ln 2), and the idf weighting decides how much
// each one counts. Caught by a unit test whose first version passed vacuously
// (the vector arm it claimed to defeat was never live).

/** A term anchors when fewer than about half the pool's chunks contain it. */
export const ANCHOR_MIN_IDF = Math.log(2);

export function anchorTerms(queryWords: Set<string>, stats: LexicalStats): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const w of queryWords) {
    const v = stats.idf.get(w);
    if (v !== undefined && v >= ANCHOR_MIN_IDF) anchors.set(w, v);
  }
  return anchors;
}

export function anchorCoverage(anchors: Map<string, number>, chunkSet: Set<string>): number {
  if (anchors.size === 0) return 0;
  let total = 0;
  let hit = 0;
  for (const [w, v] of anchors) { total += v; if (chunkSet.has(w)) hit += v; }
  return total > 0 ? hit / total : 0;
}

// ── Corpus arbitration ──────────────────────────────────────────────────────
//
// Whether a question is ABOUT the attached material used to be decided by
// grammar alone, and the classifier carries a dozen dated rules of the form
// "measured live: <question> took the FAST path with the file attached and the
// model invented the answer". Every one of them is a guess about vocabulary the
// classifier cannot see. The corpus can: "What is
// ledger.compaction.window_minutes set to?" and "What is step 6 of the regional
// failover runbook?" (both measured unrouted 2026-09-19, at every file size)
// name terms that sit TOGETHER in one chunk of the handbook, while "what is the
// difference between TCP and UDP" names terms the handbook does not have.
//
// Anchored means: some single chunk holds at least two of the question's
// anchor terms, and those carry most of the question's content weight. A term
// the corpus has never seen counts AGAINST the question at full weight — it is
// the question's most distinctive word and the material lacks it — so one
// incidental shared word cannot pull a general question into retrieval.

const PROBE_FUNCTION_WORDS = new Set(('what whats which who whom whose when where why how does did doing done '
  + 'are was were been being have has had having the and for with from into onto about that this these those '
  + 'there their they them then than can could should would will shall may might must not but you your yours '
  + 'our ours his her its any some all each every tell give show say said says please just like also get got '
  + 'set out off over under again more most very much many '
  // SPEECH-TO-TEXT (2026-09-21). Nine of fifteen misses on a HELD-OUT question set
  // were never routed to retrieval at all, every one spoken-style: "whats the
  // timeout on ledgerline store two in milliseconds", "isthmus pod seven whats the
  // nice to have stuff they want". A word the corpus has never seen counts AGAINST
  // the question at full weight — right for "TCP" and "UDP", wrong for a
  // contraction that lost its apostrophe, a filler, or a number SPOKEN as a word
  // (the document says "store-2"; wordsOf already adds the digit form, which still
  // counts as content).
  + 'whats whos hows wheres whens thats theres heres ive im id ill youre youve youd theyre theyve weve were hes shes its lets '
  + 'dont doesnt didnt isnt arent wasnt werent cant couldnt wouldnt shouldnt wont havent hasnt hadnt '
  + 'uh um er hmm okay ok so like yeah yep right well actually basically kinda sorta gonna wanna gotta '
  + 'thing things stuff bit lot kind sort there here now then just really '
  + 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen '
  + 'twenty thirty forty fifty sixty seventy eighty ninety hundred thousand oh').split(' ').filter(Boolean));

/** Is this a question word / auxiliary / pronoun that no document chunk can meaningfully 'contain'? */
export function isProbeFunctionWord(word: string): boolean { return PROBE_FUNCTION_WORDS.has(word); }

export const PROBE_MIN_ANCHORS = 2;
export const PROBE_MIN_COVERAGE = 0.6;
/** idf above which a term is DISTINCTIVE: it appears in under about a fifth of the chunks (ln 5 ≈ 1.6). */
export const PROBE_DISTINCTIVE_IDF = 1.5;

export function corpusAnchorsQuestion(question: string, stats: LexicalStats): boolean {
  return anchoringChunkIndexes(question, stats, 1).length > 0;
}

/** Indexes (into the texts the stats were built from) of the chunks that anchor the question. */
/**
 * The question's CONTENT words — what anchors may be drawn from. Function words
 * must go first: "how" is absent from most résumés, so by document frequency it
 * is the most "distinctive" word of "How many engineers did you work with on
 * Project Cinder-115?" (idf 4.77, the same as "cinder-115" itself), and a chunk
 * can never contain it.
 */
export function questionContentWords(question: string): Set<string> {
  return new Set(wordsOf(question, { shortNumerics: true }).filter((w) => !PROBE_FUNCTION_WORDS.has(w)));
}

export function anchoringChunkIndexes(question: string, stats: LexicalStats, limit = Number.POSITIVE_INFINITY): number[] {
  const words = questionContentWords(question);
  if (words.size < PROBE_MIN_ANCHORS) return [];
  const unseenWeight = Math.log(1 + (stats.n + 0.5) / 0.5);
  const anchors = new Map<string, number>();
  let total = 0;
  for (const w of words) {
    const v = stats.idf.get(w);
    if (v === undefined) { total += unseenWeight; continue; }
    total += v;
    if (v >= ANCHOR_MIN_IDF) anchors.set(w, v);
  }
  if (anchors.size < PROBE_MIN_ANCHORS || total <= 0) return [];
  // SECOND ROUTE (2026-09-21, held-out questions). Coverage charges every word the
  // corpus has never seen at the weight of its rarest word — right for "TCP vs
  // UDP", but one inflection or synonym sinks a question that otherwise names the
  // section exactly: "whats the timeout on ledgerline store two in milliseconds"
  // (the file says timeout_ms) covered 0.39; "regional failover after ive drained
  // the write queue whats the next step" (the file says "Drain", "steps") failed
  // with FOUR rare terms sitting together in one chunk. Nine of fifteen held-out
  // misses were never routed for this reason. Two DISTINCTIVE terms (each in under
  // ~a fifth of the chunks) co-occurring in one chunk anchor the question too, as
  // long as unseen words are not the majority of what was asked.
  let unseen = 0;
  for (const w of words) if (!stats.idf.has(w)) unseen++;
  const distinctive = [...anchors].filter(([, v]) => v >= PROBE_DISTINCTIVE_IDF).map(([w]) => w);
  const coOccurrenceAllowed = distinctive.length >= PROBE_MIN_ANCHORS && unseen * 2 < words.size;
  const out: number[] = [];
  for (let i = 0; i < stats.sets.length && out.length < limit; i++) {
    const set = stats.sets[i];
    let hit = 0;
    let count = 0;
    for (const [w, v] of anchors) if (set.has(w)) { hit += v; count++; }
    if (count >= PROBE_MIN_ANCHORS && hit / total >= PROBE_MIN_COVERAGE) { out.push(i); continue; }
    if (coOccurrenceAllowed && distinctive.filter((w) => set.has(w)).length >= PROBE_MIN_ANCHORS) out.push(i);
  }
  return out;
}
