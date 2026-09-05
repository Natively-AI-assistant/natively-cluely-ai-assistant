// scripts/intent-benchmark/lib/sttRealism.mjs
//
// Measure whether generated `input` strings actually look like streaming STT
// output, rather than clean prose with the capitals stripped.
//
// This exists because that failure is invisible by inspection at scale and
// fatal to the whole corpus. If the inputs are tidy, every candidate in Phase 4
// is scored on a distribution that does not occur in production and the winner
// is whichever model prefers well-formed text. Labelling cannot repair it.
//
// Pure functions, no I/O, so the generator can gate a batch on them and a test
// can assert them.

const FILLERS = [
  'um', 'uh', 'erm', 'like', 'you know', 'i mean', 'sort of', 'kind of',
  'basically', 'actually', 'well', 'so yeah', 'right',
];

/** "the the", "we could uh we could", "i think i think" */
const REPAIR_RE = /\b(\w+)\s+\1\b|\b(\w{2,})\s+(?:uh|um)\s+\2\b/i;

const PUNCT_RE = /[.,!?;:'"()\[\]{}‘’“”]/;
const UPPER_RE = /[A-Z]/;

export function analyzeInput(s) {
  const text = String(s ?? '');
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  return {
    length: words.length,
    hasPunctuation: PUNCT_RE.test(text),
    hasUppercase: UPPER_RE.test(text),
    hasFiller: FILLERS.some((f) => new RegExp(`(^|\\s)${f}(\\s|$)`).test(lower)),
    hasRepair: REPAIR_RE.test(text),
  };
}

/**
 * Aggregate a batch. Returns rates plus a `problems` array naming any rate that
 * misses its target, so a caller can reject the batch with a reason.
 *
 * Targets are deliberately asymmetric. Punctuation and casing are HARD failures
 * because the local STT models emit neither, so any occurrence is a generator
 * that ignored the instruction. Filler and repair rates are SOFT floors because
 * natural speech varies and over-specifying them would produce a caricature.
 */
/**
 * Per-category expectations.
 *
 * A single global target is wrong, and the first smoke run proved it: a
 * multi-intent turn ("find the bug and give me the fixed implementation") is
 * NEVER five words, so demanding that 15% of that category be short rejects
 * correct output. Backchannels are the opposite: almost all of them are short,
 * and a batch of them with no short lines is the suspicious one.
 *
 * `minShortRate: null` means the check does not apply to that category.
 */
export const CATEGORY_PROFILES = {
  // 0.30, derived from the category's own composition rather than guessed.
  // The no_response brief asks for six kinds of event and only two of them are
  // inherently short: backchannels, and half-captured noise fragments. The
  // other four (thinking aloud, two people talking to each other, meeting
  // admin, crosstalk) are ordinary-length speech. So roughly a third short is
  // the CORRECT shape for this category, and the first tuned floor of 0.45 was
  // rejecting output that matched the spec. Measured runs came in at 33% and
  // 42%, straddling that bad floor.
  no_response:    { minShortRate: 0.30, minFillerRate: 0.12, minRepairRate: 0.03 },
  normal_request: { minShortRate: null, minFillerRate: 0.20, minRepairRate: 0.08 },
  fragment:       { minShortRate: 0.55, minFillerRate: 0.10, minRepairRate: 0.03 },
  ambiguous:      { minShortRate: 0.25, minFillerRate: 0.15, minRepairRate: 0.05 },
  multi_intent:   { minShortRate: null, minFillerRate: 0.20, minRepairRate: 0.08 },
  // The duplicate ceiling is raised for this category alone, because surface
  // similarity is what the category IS. The brief asks for pairs whose wording
  // is near-identical and whose labels differ, so the two members of a pair
  // collide on the normalised input by construction. Measured on the v2 corpus:
  // of 54 colliding input strings, 13 carried different labels and all 13 were
  // separable from the mode, channel and history that buildText puts in front
  // of the model, so they are learnable rather than noise. The remaining 41
  // were same-label repeats, which is the laziness the default ceiling exists
  // to catch, so that check moves to a label-aware form in the generator rather
  // than being dropped. The ceiling is 0.20 rather than the 0.02 default and
  // not higher: those 13 legitimate collisions were 0.6% of the v2 corpus, so a
  // cell that comes back a third identical is the model taking a shortcut, and
  // the retry with the critique attached is the correct response to it.
  trap:           { minShortRate: null, minFillerRate: 0.15, minRepairRate: 0.05, maxDuplicateRate: 0.20 },
};

/**
 * Sample size below which the RATE checks are not evaluated.
 *
 * Rates on a batch of one or two are noise: a single row can only ever be 0% or
 * 100% short. The first smoke run rejected 19 of 24 cells almost entirely on
 * this, which was a defect in the gate rather than in the generated text. Below
 * this threshold only the HARD per-row checks run, because those are properties
 * of an individual string and do not need a sample: any punctuation at all, any
 * capital letter at all, and exact duplicates.
 *
 * The rate checks still bite, at the level where they are meaningful. The
 * generator re-runs this over each mode's full output, where n is in the
 * hundreds.
 */
export const MIN_SAMPLE_FOR_RATES = 8;

export function analyzeBatch(inputs, {
  category = null,
  maxPunctuationRate = 0.02,
  maxUppercaseRate = 0.02,
  minFillerRate = 0.18,
  minRepairRate = 0.05,
  minShortRate = 0.15,
  maxDuplicateRate = 0.02,
  shortWordCount = 5,
  minSampleForRates = MIN_SAMPLE_FOR_RATES,
} = {}) {
  if (category && CATEGORY_PROFILES[category]) {
    const prof = CATEGORY_PROFILES[category];
    if (prof.minShortRate !== undefined) minShortRate = prof.minShortRate;
    if (prof.minFillerRate !== undefined) minFillerRate = prof.minFillerRate;
    if (prof.minRepairRate !== undefined) minRepairRate = prof.minRepairRate;
    if (prof.maxDuplicateRate !== undefined) maxDuplicateRate = prof.maxDuplicateRate;
  }
  const n = inputs.length;
  if (n === 0) return { n: 0, problems: ['empty batch'] };

  const stats = inputs.map(analyzeInput);
  const rate = (pred) => stats.filter(pred).length / n;

  const punctuationRate = rate((s) => s.hasPunctuation);
  const uppercaseRate = rate((s) => s.hasUppercase);
  const fillerRate = rate((s) => s.hasFiller);
  const repairRate = rate((s) => s.hasRepair);
  const shortRate = rate((s) => s.length <= shortWordCount);
  const medianLength = [...stats.map((s) => s.length)].sort((a, b) => a - b)[Math.floor(n / 2)];

  // Near-duplicate detection on the normalised string. A generator asked for 40
  // varied rows will happily emit "yeah exactly" eleven times.
  const seen = new Map();
  for (const i of inputs) {
    const k = String(i).toLowerCase().replace(/\s+/g, ' ').trim();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const duplicates = [...seen.values()].reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
  const duplicateRate = duplicates / n;

  const problems = [];
  // HARD checks: per-row properties, valid at any n.
  if (punctuationRate > maxPunctuationRate) problems.push(`punctuation in ${(punctuationRate * 100).toFixed(1)}% of inputs (max ${maxPunctuationRate * 100}%) — the local STT models emit none`);
  if (uppercaseRate > maxUppercaseRate) problems.push(`uppercase in ${(uppercaseRate * 100).toFixed(1)}% of inputs (max ${maxUppercaseRate * 100}%)`);
  if (duplicateRate > maxDuplicateRate) problems.push(`${(duplicateRate * 100).toFixed(1)}% duplicate inputs (max ${maxDuplicateRate * 100}%)`);

  // SOFT checks: distribution properties, meaningless on a tiny sample.
  const ratesEvaluated = n >= minSampleForRates;
  if (ratesEvaluated) {
    if (fillerRate < minFillerRate) problems.push(`fillers in only ${(fillerRate * 100).toFixed(1)}% of inputs (min ${(minFillerRate * 100).toFixed(0)}%) — reads as written prose`);
    if (repairRate < minRepairRate) problems.push(`repairs/restarts in only ${(repairRate * 100).toFixed(1)}% of inputs (min ${(minRepairRate * 100).toFixed(0)}%)`);
    if (minShortRate !== null && shortRate < minShortRate) problems.push(`only ${(shortRate * 100).toFixed(1)}% of inputs are <=${shortWordCount} words (min ${(minShortRate * 100).toFixed(0)}%) — real turns are often very short`);
  }

  return {
    n,
    punctuationRate, uppercaseRate, fillerRate, repairRate, shortRate,
    duplicateRate, medianLength, ratesEvaluated, category,
    problems,
  };
}

export function formatBatchReport(r) {
  if (!r || r.n === 0) return '  (empty)';
  const p = (x) => `${(x * 100).toFixed(1)}%`.padStart(6);
  return [
    `  n=${r.n}  medianWords=${r.medianLength}`,
    `  punctuation ${p(r.punctuationRate)}   uppercase ${p(r.uppercaseRate)}   duplicates ${p(r.duplicateRate)}`,
    `  fillers     ${p(r.fillerRate)}   repairs   ${p(r.repairRate)}   short(<=5w) ${p(r.shortRate)}`,
    ...(r.problems.length ? ['  PROBLEMS:', ...r.problems.map((x) => `    - ${x}`)] : ['  looks like STT']),
  ].join('\n');
}

/**
 * Same-label collisions inside a trap batch.
 *
 * The realism gate raises its duplicate ceiling for `trap`, because the two
 * members of an adversarial pair are meant to collide on wording. What must
 * never collide is the LABEL: a pair whose wording and labels both match is a
 * repeat, not a trap, and it teaches nothing. That distinction needs the labels,
 * which the text-only realism analyzer does not have, so it is checked here
 * where the generated rows are still whole.
 *
 * Returns the number of rows that are redundant in this sense.
 */
export function redundantTrapPairs(rows) {
  const byInput = new Map();
  for (const r of rows) {
    const k = String(r.input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!byInput.has(k)) byInput.set(k, []);
    byInput.get(k).push(r);
  }
  let redundant = 0;
  for (const group of byInput.values()) {
    if (group.length < 2) continue;
    const signatures = new Set(group.map((r) => JSON.stringify([
      r.labels?.needs_response, r.labels?.dialogue_act, r.labels?.task,
    ])));
    // Every distinct signature earns one row; the rest of the group is repeat.
    redundant += group.length - signatures.size;
  }
  return redundant;
}
