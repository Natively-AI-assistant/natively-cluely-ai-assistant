// A stuck answer is stopped by its repetition, not by its length (2026-10-04).
//
// The live output cap (MAX_STREAM_OUTPUT_CHARS) was 16,000 chars: the only stop
// for a model that loops (one real runaway reached 22,871 chars). Measured in
// the real app, it also cut a legitimate 900-line list at entry 689, mid-line.
// Owner's decision: raise the cap to 48,000 and stop a loop by detecting it.
// `isRepeatingTail` is that detector: the text ends in one block of varied text
// repeated over and over, at any alignment.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/llm');
const { isRepeatingTail, RepetitionGuard } = await import(pathToFileURL(path.join(base, 'repetitionGuard.js')).href);
const { MAX_STREAM_OUTPUT_CHARS } = await import(pathToFileURL(path.join(base, 'liveDeadlines.js')).href);

const prose = (n) => Array.from({ length: n }, (_, i) => `Point ${i + 1}: the rollout for region ${i * 7 % 13} needs sign-off from team ${i % 5}.`).join('\n');
const LOOP = 'The answer is that the policy covers travel within the quarter, as stated. ';

describe('isRepeatingTail', () => {
  test('a block repeated many times at the end is a loop', () => {
    assert.equal(isRepeatingTail(prose(40) + '\n' + LOOP.repeat(8)), true);
  });
  test('the loop is found when the text stops mid-block', () => {
    assert.equal(isRepeatingTail(prose(40) + '\n' + LOOP.repeat(8) + LOOP.slice(0, 23)), true);
  });
  test('a long numbered list is not a loop', () => {
    const list = Array.from({ length: 900 }, (_, i) => `${i + 1}. R${String(i + 1).padStart(4, '0')} ${['amber', 'cobalt', 'violet', 'olive', 'coral'][i % 5]} crate`).join('\n');
    assert.equal(isRepeatingTail(list), false);
  });
  test('a rule line or a run of one character is not a loop', () => {
    assert.equal(isRepeatingTail(prose(40) + '\n' + '='.repeat(600)), false);
    assert.equal(isRepeatingTail(prose(40) + '\n' + '-'.repeat(2000)), false);
  });
  test('a line said a few times is not a loop', () => {
    assert.equal(isRepeatingTail(prose(40) + '\n' + LOOP.repeat(3)), false);
  });
  test('a markdown table with similar rows is not a loop', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `| ${i + 1} | Item ${i + 1} | ${(i * 3.7).toFixed(1)} | open |`).join('\n');
    assert.equal(isRepeatingTail(`| # | Name | Value | Status |\n|---|---|---|---|\n${rows}`), false);
  });
});

describe('RepetitionGuard (streamed)', () => {
  test('short answers are never checked', () => {
    const g = new RepetitionGuard();
    assert.equal(g.feed(LOOP.repeat(10)), false, 'under the minimum length nothing is judged');
  });
  test('a looping stream trips the guard soon after the loop starts', () => {
    const g = new RepetitionGuard();
    let tripped = -1; let total = 0;
    const text = prose(60) + '\n' + LOOP.repeat(200);
    for (let i = 0; i < text.length; i += 37) { total += Math.min(37, text.length - i); if (g.feed(text.slice(i, i + 37))) { tripped = total; break; } }
    assert.ok(tripped > 0, 'the guard tripped');
    assert.ok(tripped < prose(60).length + LOOP.length * 20, `tripped at ${tripped}, too late after the loop began`);
  });
  test('a long legitimate stream never trips', () => {
    const g = new RepetitionGuard(); const text = prose(600);
    for (let i = 0; i < text.length; i += 41) assert.equal(g.feed(text.slice(i, i + 41)), false);
  });
});

describe('the live cap', () => {
  test('is 48,000 chars: room for a long list or long code', () => {
    assert.equal(MAX_STREAM_OUTPUT_CHARS, 48000);
  });
});
