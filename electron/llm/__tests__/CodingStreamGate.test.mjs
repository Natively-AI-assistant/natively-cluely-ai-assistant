// electron/llm/__tests__/CodingStreamGate.test.mjs
//
// The gate that restores LIVE streaming for coding answers (regression fix):
// hold tokens only until "## " is confirmed (never code-first), then stream live.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { CodingStreamGate } from '../../../dist-electron/electron/llm/codingStreamGate.js';

// Feed a full answer token-by-token; return the concatenation of everything the
// gate emitted (live), plus the finish() tail.
function streamThrough(text, chunkSize = 3) {
  const gate = new CodingStreamGate();
  let emitted = '';
  let firstEmitAfter = -1; // chars consumed before the FIRST emit (gate-open latency)
  let consumed = 0;
  for (let i = 0; i < text.length; i += chunkSize) {
    const tok = text.slice(i, i + chunkSize);
    consumed += tok.length;
    const out = gate.push(tok);
    if (out) {
      if (firstEmitAfter < 0) firstEmitAfter = consumed;
      emitted += out;
    }
  }
  emitted += gate.finish();
  return { emitted, firstEmitAfter, gate };
}

describe('CodingStreamGate', () => {
  test('opens on the first "## " heading and streams the rest live', () => {
    const answer = '## Approach\nUse a hash map.\n## Code\n```py\nx=1\n```\n';
    const { emitted, firstEmitAfter } = streamThrough(answer, 4);
    assert.equal(emitted, answer, 'all content is emitted, nothing dropped');
    // Gate should open very early (within the first heading), not after the whole answer.
    assert.ok(firstEmitAfter <= 16, `gate opened late (after ${firstEmitAfter} chars)`);
  });

  test('once open, every subsequent token passes through verbatim', () => {
    const gate = new CodingStreamGate();
    gate.push('## Approach\n'); // opens
    assert.equal(gate.isOpen, true);
    assert.equal(gate.push('hello'), 'hello');
    assert.equal(gate.push(' world'), ' world');
  });

  test('emits the full prefix as the first chunk when it opens', () => {
    const gate = new CodingStreamGate();
    // leading newline then heading — common from models
    assert.equal(gate.push('\n'), '', 'newline alone does not open');
    const out = gate.push('## Approach');
    assert.equal(out, '\n## Approach', 'flushes the whole buffered prefix at open');
  });

  test('leading whitespace/newlines do not delay the gate (trimStart)', () => {
    const { emitted, firstEmitAfter } = streamThrough('\n\n   ## Approach\nbody\n', 2);
    assert.match(emitted, /## Approach/);
    assert.ok(firstEmitAfter <= 18);
  });

  test('code-first answer keeps the gate CLOSED (no flash) until finish()', () => {
    const gate = new CodingStreamGate();
    // Model disobeys: emits a code fence first.
    assert.equal(gate.push('```py'), '', 'code fence does not open the gate');
    assert.equal(gate.push('thon\n'), '', 'still gating');
    assert.equal(gate.isOpen, false, 'gate stays closed on code-first (under cap)');
    // finish() flushes so nothing is dropped (caller validates/repairs after).
    const tail = gate.finish();
    assert.match(tail, /```py/);
  });

  test('hard cap force-opens after MAX_GATE_CHARS even without a heading', () => {
    const gate = new CodingStreamGate();
    const long = 'x'.repeat(CodingStreamGate.MAX_GATE_CHARS + 5);
    const out = gate.push(long);
    assert.ok(out.length > 0, 'force-flush at the cap');
    assert.equal(gate.isOpen, true);
  });

  test('short answer that never crosses the heading flushes on finish()', () => {
    const gate = new CodingStreamGate();
    assert.equal(gate.push('ok'), '', 'buffered');
    assert.equal(gate.finish(), 'ok', 'flushed at end');
    assert.equal(gate.finish(), '', 'idempotent — second finish empty');
  });

  test('a lone "#" does not open until the space arrives', () => {
    const gate = new CodingStreamGate();
    assert.equal(gate.push('#'), '', 'bare # waits');
    const out = gate.push('# Approach\n');
    assert.match(out, /## Approach/, 'opens once the heading is real');
  });

  test('hasEmitted reflects whether any chunk was emitted', () => {
    const gate = new CodingStreamGate();
    assert.equal(gate.hasEmitted(), false);
    gate.push('## Code\n');
    assert.equal(gate.hasEmitted(), true);
  });

  test('reconstructs a realistic multi-section answer exactly', () => {
    const answer = [
      '## Approach', 'Check remainder mod 2.',
      '## Technique / Data Structure / Algorithm Used', 'Modulo.',
      '## Code', '```python\ndef f(n):\n    return n % 2 == 0\n```',
      '## Dry Run', 'f(4) -> True',
      '## Complexity', 'Time: O(1). Space: O(1).',
      '## Interviewer Follow-up Points', '- negatives',
    ].join('\n\n');
    const { emitted } = streamThrough(answer, 5);
    assert.equal(emitted, answer, 'lossless live reconstruction');
  });
});
