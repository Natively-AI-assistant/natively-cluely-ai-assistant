// An ADOPTED speculative answer is the answer the user actually sees on the most
// common Auto Answer path, and it was never recorded into the V3 conversation
// ring.
//
// recordLiveTurn has three call sites — the runWhatShouldISay, runAssistMode and
// runManualAnswer wrappers — and BOTH adoption branches in
// handleSuggestionTriggerInner `return` before reaching runWhatShouldISay. The
// wrapper's rationale ("a draft the user never saw is not part of the
// conversation") is true for a DISCARDED prefetch and false for an adopted one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'electron/IntelligenceEngine.ts'), 'utf8');

const reveal = (() => {
  const start = src.indexOf('private revealSpeculativeAnswer');
  return src.slice(start, src.indexOf('\n    }', start));
})();

test('the adopted answer is recorded where it becomes user-visible', () => {
  assert.match(reveal, /this\.recordLiveTurn\(text, undefined, finished\.question, 0\)/);
});

test('recording is gated on the same do_not_store decision as the session write', () => {
  // A turn the session declined to store must not reach the ring either.
  const guarded = reveal.slice(reveal.indexOf("finished.writeDecision?.policy !== 'do_not_store'"));
  const recordAt = guarded.indexOf('this.recordLiveTurn(');
  const elseAt = guarded.indexOf('} else {');
  assert.ok(recordAt >= 0 && recordAt < elseAt,
    'the record must sit inside the stored branch, not after the else');
});

test('revealSpeculativeAnswer is the ONLY place an adopted answer surfaces', () => {
  // If a third caller appears, this guard has to be re-derived — a new surface
  // would silently reintroduce the gap.
  const calls = (src.match(/this\.revealSpeculativeAnswer\(/g) ?? []).length;
  assert.equal(calls, 2, 'expected exactly the two adoption call sites');
});

test('the adoption branches still cannot reach recordLiveTurn on their own', () => {
  // Documents WHY the fix lives in reveal rather than in the trigger handler.
  const sites = [...src.matchAll(/this\.recordLiveTurn\(/g)].length;
  assert.equal(sites, 4, 'reveal + the three wrappers');
  for (const m of ['async runWhatShouldISay(', 'async runAssistMode(', 'async runManualAnswer(']) {
    assert.ok(src.includes(m), `${m} must still exist as the wrapper that records`);
  }
});
