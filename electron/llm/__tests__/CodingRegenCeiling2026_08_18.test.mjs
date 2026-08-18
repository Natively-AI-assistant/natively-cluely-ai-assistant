// F-305 regression test (audit/autopilot-2026-08-18).
//
// The coding regens (meta-reply retry and completeness retry) aborted at a
// hardcoded 4000 chars, while liveDeadlines' own sizing note measures the very
// artifact their prompt asks for — "a six-section coding answer with multiple
// code blocks" — at ~8000. A correct answer was therefore cut mid-sentence,
// and the meta-retry accepted on nothing more than "length >= 20 plus some
// closed code fence", so that truncation was accepted and atomically REPLACED
// the streamed row: the user's final answer ended mid-word.
//
// Honest scope: checkCodeCompleteness validates the FENCED CODE, not trailing
// prose, so it catches a truncated code block but not a cut-off "## Complexity"
// paragraph. The abort-ceiling raise is what prevents that case; the acceptance
// change closes the truncated-code case and matches the sibling regen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { CODING_REGEN_ABORT_CHARS, MAX_STREAM_OUTPUT_CHARS } =
  await import(path.join(root, 'dist-electron/electron/llm/index.js'));
const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('the regen ceiling is at least the size of the artifact it requests', () => {
  assert.ok(CODING_REGEN_ABORT_CHARS >= 8000,
    'liveDeadlines sizes a six-section coding answer at ~8000; aborting below that truncates correct answers (F-305)');
  assert.ok(CODING_REGEN_ABORT_CHARS <= MAX_STREAM_OUTPUT_CHARS,
    'the regen ceiling must stay under the runaway bound');
});

test('no hardcoded 4000-char regen abort remains', () => {
  assert.ok(!/regen\.length > 4000/.test(src),
    'both regens must use the shared, documented ceiling (F-305)');
  const n = (src.match(/regen\.length > CODING_REGEN_ABORT_CHARS/g) ?? []).length;
  assert.equal(n, 2, 'both the meta-reply retry and the completeness retry must use it');
});

test('the meta-retry requires a CLOSED FENCE and completeness, not either alone', () => {
  // R-06: F-305 originally asserted only the completeness bar here, because it
  // REPLACED the closed-fence regex rather than adding to it. That made the gate
  // strictly weaker: extractFencedCodeBlocks needs a closing fence, so a regen
  // with no fence — or an unterminated one — yields zero blocks and
  // checkCodeCompleteness returns ok:true vacuously. Both bars are required.
  const i = src.indexOf('const regenHasClosedFence =');
  assert.notEqual(i, -1, 'the meta-retry must re-establish the closed-fence bar');
  const accept = src.slice(i, i + 600);
  assert.ok(/regenTrim\.length >= 20 && regenHasClosedFence && checkCodeCompleteness\(regenTrim\)\.ok/.test(accept),
    'the meta-retry gate must require length, a closed fence, AND completeness');
});
