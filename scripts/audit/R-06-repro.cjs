#!/usr/bin/env node
/**
 * R-06 repro — F-305 made the coding meta-retry acceptance WEAKER, not stronger.
 *
 * Baseline gate:  regenTrim.length >= 20 && /```lang\n...```/.test(regenTrim)
 * F-305 gate:     regenTrim.length >= 20 && checkCodeCompleteness(regenTrim).ok
 *
 * It REPLACED the closed-fence test instead of ADDING to it.
 * `extractFencedCodeBlocks` requires a CLOSING fence, so an answer with no
 * fences — or with an unterminated one — yields zero blocks and
 * checkCodeCompleteness returns ok:true VACUOUSLY. So the new gate accepts
 * things the old one rejected:
 *
 *   - another meta-reply with no code at all, violating the invariant stated
 *     directly above the gate ("never overwrite with another meta-reply") and
 *     emitting a bogus pi_coding_meta_retry_succeeded;
 *   - a regen truncated mid-code-block by shouldAbort, which now ends on a
 *     dangling fence. Raising CODING_REGEN_ABORT_CHARS 4000 -> 8000 in the same
 *     commit is what makes this reachable, and accepting it atomically REPLACES
 *     the streamed answer with one whose fence never closes.
 *
 * And the case F-305 was actually written for — a complete answer truncated in
 * PROSE after a closed fence — is accepted identically by both gates, so the
 * stated rationale was never addressed by the change.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-06-repro.cjs
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { checkCodeCompleteness } = require(path.join(REPO, 'dist-electron', 'electron', 'llm', 'CodeSanityCheck.js'));

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-06] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

// The gate as it now stands in source (pulled out so the harness tracks it).
const src = fs.readFileSync(path.join(REPO, 'electron', 'ipcHandlers.ts'), 'utf8');
const gateIdx = src.indexOf('const regenHasClosedFence =');
check('source: closed-fence bar restored  ', gateIdx >= 0, true);
const usesBoth = /regenTrim\.length >= 20 && regenHasClosedFence && checkCodeCompleteness\(regenTrim\)\.ok/.test(src);
check('source: gate requires BOTH bars    ', usesBoth, true);

const CLOSED_FENCE = /```[a-zA-Z0-9_+\-]*\n[\s\S]*?```/;
const oldGate = (t) => t.length >= 20 && CLOSED_FENCE.test(t);
const f305Gate = (t) => t.length >= 20 && checkCodeCompleteness(t).ok;
const newGate = (t) => t.length >= 20 && CLOSED_FENCE.test(t) && checkCodeCompleteness(t).ok;

const CASES = [
  {
    name: 'another meta-reply, no code',
    text: 'I notice your message got cut off. Could you please paste the full problem statement so I can help?',
    mustAccept: false,
  },
  {
    name: 'regen aborted mid-fence (unclosed)',
    text: '## Approach\nWe scan the array once.\n\n```python\ndef solve(nums):\n    total = 0\n    for n in nums:\n        total += n',
    mustAccept: false,
  },
  {
    name: 'complete answer, closed fence',
    text: '## Approach\nOne pass.\n\n```python\ndef solve(nums):\n    return sum(nums)\n```\n\n## Complexity\nO(n) time, O(1) space.',
    mustAccept: true,
  },
  {
    name: 'prose truncated AFTER a closed fence',
    text: '## Approach\nOne pass.\n\n```python\ndef solve(nums):\n    return sum(nums)\n```\n\n## Complexity\nThe time complexity is O(n) because we',
    mustAccept: true,   // both gates accept; F-305 did NOT address this case
  },
];

console.log('[R-06] gate comparison (old = baseline closed-fence, f305 = shipped, new = fixed):');
for (const c of CASES) {
  const o = oldGate(c.text), f = f305Gate(c.text), n = newGate(c.text);
  const flag = f !== o ? '  <-- F-305 CHANGED this' : '';
  console.log(`[R-06]   ${c.name.padEnd(36)} old=${String(o).padEnd(5)} f305=${String(f).padEnd(5)} new=${String(n)}${flag}`);
  check(`  accepts "${c.name}"`.padEnd(52), n, c.mustAccept);
}

// The two regressions must be regressions of F-305 specifically, not of baseline.
check('F-305 accepted the bare meta-reply ', f305Gate(CASES[0].text), true);
check('F-305 accepted the unclosed fence  ', f305Gate(CASES[1].text), true);
check('baseline rejected the meta-reply   ', oldGate(CASES[0].text), false);
check('baseline rejected the unclosed one ', oldGate(CASES[1].text), false);

if (failures) {
  console.error('[R-06] FAIL: the meta-retry gate accepts a regen it must reject.');
  process.exit(1);
}
console.log('[R-06] PASS: the gate requires a closed fence AND complete contents.');
