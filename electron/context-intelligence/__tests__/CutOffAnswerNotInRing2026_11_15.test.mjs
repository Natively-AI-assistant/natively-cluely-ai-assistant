// #743: a What to answer that the session declined to store (stall-guard
// cut-off, output-cap or repetition stop, canned timeout line) still reached
// the conversation ring. The runWhatShouldISay wrapper recorded whatever text
// the inner run returned, and the next press replayed the partial under
// "# Conversation so far" as a plain Assistant line.
//
// The inner run now reports its write decision through turnOut, and the
// wrapper skips the ring write on do_not_store, the same gate the Auto Answer
// reveal path already had.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/IntelligenceEngine.ts'), 'utf8');

const slice = (from, to) => {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `${from} must exist`);
  const end = src.indexOf(to, start + from.length);
  assert.ok(end > start, `end marker after ${from}`);
  return src.slice(start, end);
};

const wrapper = slice('async runWhatShouldISay(', 'private async runWhatShouldISayInner(');
const inner = slice('private async runWhatShouldISayInner(', "this.session.addAssistantMessage(finalWtaAnswer, wtaWriteDecision, 'what_to_answer');")
  + "this.session.addAssistantMessage(finalWtaAnswer, wtaWriteDecision, 'what_to_answer');";

test('the wrapper does not record a turn the session declined to store', () => {
  assert.match(wrapper, /const declined = turnOut\.writeDecision\?\.policy === 'do_not_store';/);
  const recordAt = wrapper.indexOf('this.recordLiveTurn(');
  assert.ok(recordAt > 0);
  const gate = wrapper.lastIndexOf('if (', recordAt);
  assert.match(wrapper.slice(gate, recordAt), /!declined/, 'recordLiveTurn must sit behind the !declined gate');
});

test('every decision-bearing session write in the inner run reports its decision to the wrapper', () => {
  const writes = [...inner.matchAll(/this\.session\.addAssistantMessage\((\w+), (\w+WriteDecision), 'what_to_answer'\);/g)];
  // stub fallback, transport error, tag leak, final answer
  assert.ok(writes.length >= 4, `expected the four decision-bearing writes, saw ${writes.length}`);
  for (const w of writes) {
    const before = inner.slice(Math.max(0, w.index - 200), w.index);
    assert.match(before, new RegExp(`options\\.turnOut\\.writeDecision = ${w[2]};\\s*$`),
      `${w[2]} must be handed to turnOut right before it is written`);
  }
});

test('stall cut-off, truncation and canned timeout all set do_not_store on the final decision', () => {
  for (const marker of ["criticalViolations: ['stream_truncated']", "criticalViolations: ['provider_timeout_no_answer']"]) {
    assert.ok(inner.includes(marker), `${marker} must still feed wtaWriteDecision`);
  }
});
