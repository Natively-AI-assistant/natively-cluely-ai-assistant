// A protected inline-code span must always be restored (2026-09-07).
//
// MEASURED live: the answer to an exhaustive "find every latency number"
// question rendered "**Source:** <SOH>INL0<SOH>, Section DEBUG-201" — the
// streaming dash reducer had stashed `03_debugging_scenarios.md` behind a
// space-padded placeholder, the em-dash rule (`\s*[—–]\s*` → ", ") ate the
// trailing pad, and the exact-string restore no longer matched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { StreamingDashReducer, reduceDashes } = require(path.join(process.cwd(), 'dist-electron/electron/llm/postProcessor.js'));

const clean = (s) => !/\x01|INL\d|MATH\d/.test(s);

describe('StreamingDashReducer restores every placeholder', () => {
  test('inline code followed by an em dash (the measured leak)', () => {
    const out = new StreamingDashReducer().reduce('* **Source:** `03_debugging_scenarios.md` — Section **DEBUG-201**');
    assert.ok(clean(out), out);
    assert.ok(out.includes('`03_debugging_scenarios.md`'), out);
    assert.ok(!out.includes('  `'), `the added pad must not survive as a double space: ${JSON.stringify(out)}`);
  });
  test('inline code followed by an en dash, and math followed by a dash', () => {
    for (const s of ['see `rl:aurora:tenant-42` – the key', 'so $x - 1$ — half']) {
      const out = new StreamingDashReducer().reduce(s);
      assert.ok(clean(out), out);
    }
    assert.ok(new StreamingDashReducer().reduce('so $x - 1$ — half').includes('$x - 1$'));
  });
  test('inline code with ordinary neighbours keeps its original spacing', () => {
    const out = new StreamingDashReducer().reduce('Use `rerank(query, candidates)` next.');
    assert.equal(out, 'Use `rerank(query, candidates)` next.');
  });
  test('several spans in one chunk, restored in order', () => {
    const out = new StreamingDashReducer().reduce('`a` — `b` — `c`');
    assert.equal(out, '`a`, `b`, `c`');
  });
  test('the non-streaming reducer is unchanged and clean', () => {
    const out = reduceDashes('**Source:** `03_debugging_scenarios.md` — Section');
    assert.ok(clean(out), out);
    assert.ok(out.includes('`03_debugging_scenarios.md`'));
  });
});
