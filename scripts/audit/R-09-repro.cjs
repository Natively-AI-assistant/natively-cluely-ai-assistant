#!/usr/bin/env node
/**
 * R-09 repro — F-302's first-useful character count drops interior whitespace.
 *
 * `fullResponse.trim().length + token.trim().length` trims each side
 * independently, so whitespace BETWEEN the accumulated text and the incoming
 * token vanishes from the count. Concatenating first and trimming once is the
 * only arithmetic that matches what the user actually sees.
 *
 * Under-counting delays manualFirstUseful, and manualFirstUseful is what
 * suppresses the deterministic fallback — so the stream looks content-free for
 * longer than it really is.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-09-repro.cjs
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(path.resolve(__dirname, '..', '..'), 'electron', 'ipcHandlers.ts');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-09] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

const oldCount = (full, tok) => full.trim().length + tok.trim().length;
const newCount = (full, tok) => (full + tok).trim().length;

// The user sees the concatenation, so that is ground truth.
const CASES = [
  ['a b',   ' c',    5],
  ['Yes',   ', ok',  7],
  ['  ',    'Hi',    2],
  ['Sure',  '',      4],
  ['A B C', ' D',    7],
];
for (const [full, tok, truth] of CASES) {
  const o = oldCount(full, tok), n = newCount(full, tok);
  const flag = o !== truth ? '  <-- old under-counts' : '';
  console.log(`[R-09]   ${JSON.stringify(full).padEnd(8)} + ${JSON.stringify(tok).padEnd(7)} truth=${truth} old=${o} new=${n}${flag}`);
  check(`  count for ${JSON.stringify(full)}+${JSON.stringify(tok)}`.padEnd(40), n, truth);
}

// The threshold consequence: a 5-char-visible stream must register as useful.
check('old MISSES the 5-char threshold   ', oldCount('a b', ' c') >= 5, false);
check('new MEETS the 5-char threshold    ', newCount('a b', ' c') >= 5, true);

const src = fs.readFileSync(SRC, 'utf8');
check('source uses the concat-then-trim  ', /\(fullResponse \+ token\)\.trim\(\)\.length >= 5/.test(src), true);
check('source drops the split-trim form  ', /fullResponse\.trim\(\)\.length \+ token\.trim\(\)\.length/.test(src), false);

if (failures) { console.error('[R-09] FAIL: the first-useful count disagrees with what the user sees.'); process.exit(1); }
console.log('[R-09] PASS: first-useful counts the concatenated, once-trimmed text.');
