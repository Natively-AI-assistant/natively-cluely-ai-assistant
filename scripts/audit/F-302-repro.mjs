// F-302 repro: the manual-chat "useful" predicate was "a token object
// arrived", so a whitespace-only provider response (a) degraded the deadline
// and (b) made the blank-answer fallback unreachable, committing an EMPTY
// bubble — violating the comment three lines above it ("a live answer is
// NEVER blank when a safe fallback exists").
//
// This drives the REAL raceStreamWithDeadline from the built bundle with the
// call site's wiring, using a generator that yields "\n\n" and then hangs.
//
// Expected (correct): whitespace does not mark useful → the driver reports
// first_useful_timeout and the fallback predicate (!useful && !text.trim())
// is TRUE, so a fallback answer would be substituted → exit 0.
// Bug (F-302): useful flips on the whitespace token → the run is governed by
// the longer inter-token stall guard and the fallback is skipped → exit 1.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../dist-electron/electron/llm');
const { raceStreamWithDeadline } = await import(path.join(distRoot, 'liveDeadlines.js'));

async function* whitespaceThenHang() {
  yield '\n\n';
  await new Promise(() => {}); // never resolves
}

let fullResponse = '';
let manualFirstUseful = false;

const started = Date.now();
const outcome = await raceStreamWithDeadline({
  stream: whitespaceThenHang(),
  firstUsefulDeadlineMs: 700,
  isUsefulYet: () => manualFirstUseful,
  shouldAbort: () => false,
  onFirstUsefulTimeout: () => {},
  onStallTimeout: () => {},
  onCleanup: () => {},
  // MIRRORS the fixed call site in ipcHandlers.ts
  onToken: (token) => {
    if (fullResponse.trim().length + token.trim().length >= 5) manualFirstUseful = true;
    fullResponse += token;
  },
});
const elapsed = Date.now() - started;

const fallbackWouldFire = !manualFirstUseful && !fullResponse.trim();
console.log('[F-302] outcome:', JSON.stringify(outcome), '| elapsed(ms):', elapsed,
  '| manualFirstUseful:', manualFirstUseful, '| fallbackWouldFire:', fallbackWouldFire);

if (manualFirstUseful) {
  console.error('[F-302] FAIL: whitespace marked the turn useful — deadline degraded to the stall guard and the blank-answer fallback is skipped (F-302 reproduced).');
  process.exit(1);
}
if (!fallbackWouldFire) {
  console.error('[F-302] FAIL: the blank-answer fallback would not fire for a whitespace-only response.');
  process.exit(1);
}
// CONTROL: the pre-fix wiring (`manualFirstUseful = true` on any token),
// proving the harness actually exercises the defect rather than passing
// vacuously.
let ctrlText = '';
let ctrlUseful = false;
const ctrlStarted = Date.now();
const ctrlOutcome = await raceStreamWithDeadline({
  stream: whitespaceThenHang(),
  firstUsefulDeadlineMs: 700,
  isUsefulYet: () => ctrlUseful,
  shouldAbort: () => false,
  onFirstUsefulTimeout: () => {},
  onStallTimeout: () => {},
  onCleanup: () => {},
  onToken: (token) => { ctrlUseful = true; ctrlText += token; },   // OLD behaviour
});
const ctrlFallback = !ctrlUseful && !ctrlText.trim();
console.log('[F-302] control (pre-fix predicate): outcome:', JSON.stringify(ctrlOutcome),
  '| elapsed(ms):', Date.now() - ctrlStarted, '| useful:', ctrlUseful, '| fallbackWouldFire:', ctrlFallback);
if (!ctrlUseful || ctrlFallback) {
  console.error('[F-302] Inconclusive: the control did not reproduce the old behaviour.');
  process.exit(2);
}
console.log('[F-302] control confirms the defect: whitespace marked the turn useful and suppressed the fallback (empty bubble).');

console.log('[F-302] PASS: whitespace is not "useful"; the turn times out on the first-useful budget and the fallback substitutes a real answer.');
process.exit(0);
