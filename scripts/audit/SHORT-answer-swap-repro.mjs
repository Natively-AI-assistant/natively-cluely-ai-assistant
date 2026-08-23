/**
 * User-reported symptom: "if the answer is short it doesn't display, and shows
 * something like 'let me come back in a moment'".
 *
 * Mechanism (live / what-to-answer path, IntelligenceEngine.ts):
 *   STREAMING_SAFE_PREFIX_CHARS = 160                                  (:2722)
 *   display only once the buffer reaches 160 chars                     (:2789)
 *   isUsefulYet = emittedStreamingToken || fullAnswer >= 160           (:2763)
 *   on first-useful timeout: if fullAnswer < 160 -> DISCARD, canned line (:2843)
 *
 * raceStreamWithDeadline returns 'done' the moment the stream CLOSES
 * (liveDeadlines.ts:299), so a short answer whose stream closes in time is
 * safe. The defect is narrower and worth stating precisely:
 *
 *   "useful" is defined by LENGTH (160 chars). A complete, correct SHORT answer
 *   therefore never marks the turn useful, so the first-useful deadline keeps
 *   running against an answer that already exists. If the stream has not closed
 *   by then, that real answer is thrown away and replaced.
 *
 * A long answer crosses 160 and is immune. Only short ones are exposed.
 */
const SAFE = 160;
const FIRST_USEFUL_MS = 7000;   // cloud budget

function liveTurn({ label, answer, firstTokenMs, streamClosesMs }) {
  let emitted = false, full = '';
  // Does the stream close before the deadline?
  const closesInTime = streamClosesMs <= FIRST_USEFUL_MS;
  if (firstTokenMs <= FIRST_USEFUL_MS) { full = answer; if (full.length >= SAFE) emitted = true; }
  const usefulYet = emitted || full.trim().length >= SAFE;

  if (closesInTime) return { label, chars: full.length, outcome: 'done', shown: full || '(empty)', discarded: false };
  if (usefulYet)   return { label, chars: full.length, outcome: 'stall_timeout', shown: full, discarded: false };
  const canned = "The model did not produce an answer in time, so I won't guess from your profile.";
  return { label, chars: full.length, outcome: 'first_useful_timeout', shown: canned, discarded: full.length > 0 };
}

const CASES = [
  { label: 'short answer, stream closes fast', answer: 'Yes — mention the AWS migration.', firstTokenMs: 900, streamClosesMs: 1200 },
  { label: 'short answer, stream lingers',     answer: 'Yes — mention the AWS migration.', firstTokenMs: 900, streamClosesMs: 9000 },
  { label: 'short answer, slow model',         answer: 'Use a hash map for O(1) lookups.', firstTokenMs: 7500, streamClosesMs: 7800 },
  { label: 'long answer, stream lingers',      answer: 'X'.repeat(400),                   firstTokenMs: 900, streamClosesMs: 9000 },
  { label: 'genuinely no answer',              answer: '',                                firstTokenMs: 9999, streamClosesMs: 9999 },
];

console.log(`STREAMING_SAFE_PREFIX_CHARS=${SAFE}  firstUsefulDeadline=${FIRST_USEFUL_MS}ms\n`);
console.log('case                             | chars | outcome              | real answer lost? | user sees');
console.log('---------------------------------|-------|----------------------|-------------------|----------');
let lost = 0;
for (const c of CASES) {
  const r = liveTurn(c);
  if (r.discarded) lost++;
  console.log(`${r.label.padEnd(32)} | ${String(r.chars).padEnd(5)} | ${r.outcome.padEnd(20)} | ${String(r.discarded).padEnd(17)} | ${r.shown.slice(0, 40)}${r.shown.length > 40 ? '…' : ''}`);
}
console.log(`\nturns where a REAL answer was discarded: ${lost}/${CASES.length}`);
console.log('\nThe long answer with the SAME lingering stream is unaffected — it crossed 160');
console.log('and was already displayed. Length, not latency, decides who is exposed.');
console.log('The empty case is the fallback working correctly: there was nothing to lose.');
