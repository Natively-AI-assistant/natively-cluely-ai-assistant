// F-305 repro: the coding meta-retry accepted a HARD-TRUNCATED regen as the
// user's final answer.
//
// The retry aborts at `regen.length > 4000`, but liveDeadlines sizes the exact
// artifact the retry prompt asks for — a six-section coding answer — at ~8000.
// So a correct answer whose fenced block closes early (## Approach, fenced
// code, then ## Complexity / ## Edge cases) is routinely cut mid-sentence
// AFTER the fence. Acceptance only required length >= 20 plus ANY closed code
// fence, which such a truncation satisfies — and the accepted text then
// atomically REPLACES the streamed row, so the user's final answer ends
// mid-word. The sibling regen ~80 lines below already guards with
// checkCodeCompleteness.
//
// Drives the REAL checkCodeCompleteness against a realistic truncation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const { checkCodeCompleteness, CODING_REGEN_ABORT_CHARS, MAX_STREAM_OUTPUT_CHARS } =
  await import(path.join(root, 'dist-electron/electron/llm/index.js'));

const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const metaIdx = src.indexOf('pi_coding_meta_retry_succeeded');
const accept = src.slice(Math.max(0, metaIdx - 1400), metaIdx);

// A six-section answer cut mid-sentence after a CLOSED fence — the shape the
// 4000-char abort produces.
const truncated = [
  '## Approach',
  'We keep a sliding window and shrink it whenever the constraint breaks.',
  '```python',
  'def solve(nums, k):',
  '    left = 0',
  '    for right, v in enumerate(nums):',
  '        pass',
  '    return left',
  '```',
  '## Complexity',
  'Time is O(n) because each index enters and leaves the window at most once, and space is O(1) since we only ke',
].join('\n');

const whole = truncated + 'ep two pointers.\n\n## Edge cases\nEmpty input returns 0.\n';

const oldTest = (t) => t.trim().length >= 20 && /```[a-zA-Z0-9_+\-]*\n[\s\S]*?```/.test(t.trim());
const newTest = (t) => t.trim().length >= 20 && checkCodeCompleteness(t.trim()).ok;

let bad = false;

// (1) ROOT CAUSE: the abort ceiling must not be smaller than the artifact the
// retry prompt asks for. liveDeadlines sizes a six-section coding answer at
// ~8000; the regens aborted at 4000, so a CORRECT answer was cut mid-sentence.
console.log('[F-305] regen abort ceiling:', CODING_REGEN_ABORT_CHARS, '| runaway bound:', MAX_STREAM_OUTPUT_CHARS);
if (!(CODING_REGEN_ABORT_CHARS >= 8000)) {
  console.error(`[F-305] the regen abort ceiling is ${CODING_REGEN_ABORT_CHARS}, below the ~8000 this pipeline measures for a six-section coding answer — correct answers are truncated (F-305 reproduced)`);
  bad = true;
}
if (!(CODING_REGEN_ABORT_CHARS <= MAX_STREAM_OUTPUT_CHARS)) {
  console.error('[F-305] the regen ceiling must stay under the runaway bound'); bad = true;
}
if (/regen\.length > 4000/.test(src)) {
  console.error('[F-305] a hardcoded 4000 regen abort still exists'); bad = true;
}

// (2) ACCEPTANCE: a bare "some closed fence" test also accepted truncated CODE.
console.log('[F-305] acceptance — truncated-code:', newTest(truncated), '| whole:', newTest(whole));
if (!/checkCodeCompleteness\(regenTrim\)\.ok/.test(accept)) {
  console.error('[F-305] the meta-retry still accepts on a bare code-fence regex (F-305 reproduced)'); bad = true;
}
if (!newTest(whole)) { console.error('[F-305] a COMPLETE regen is now rejected — the fix over-reached'); bad = true; }

if (bad) { console.error('[F-305] FAIL'); process.exit(1); }
console.log('[F-305] PASS: the regen ceiling matches the artifact it asks for, and acceptance uses the completeness check rather than a bare fence regex.');
process.exit(0);
