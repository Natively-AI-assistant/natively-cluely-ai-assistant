/**
 * minimax-think-stripper.test.mjs — regression tests for the global <think> stripper
 * in minimax-provider.mjs.
 *
 * BACKGROUND: the 7000-row MiniMax-M2.7 run (2026-06-14) surfaced at scale
 * (looking-for-work_0447, a multi-criterion gap_analysis_answer) that MiniMax-M2.7
 * emits INTERLEAVED <think> blocks MID-ANSWER, not just a single leading one. The
 * original stripper (leading-only — mirrored from natively-api/lib/minimaxProvider.js)
 * let the interleaved blocks LEAK into the visible answer (a critical
 * visible_reasoning_leak). The fix: strip ALL <think>…</think> blocks globally
 * (whole-string + incremental-streaming forms). These tests lock that in.
 *
 * Run: node --test tests/intelligence/e2e/minimax-think-stripper.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLeadingThink, makeThinkStripper } from './minimax-provider.mjs';

const feed = (s) => { const st = makeThinkStripper(); let out = ''; for (const ch of s) out += st.push(ch); out += st.flush(); return out; };
const noThinkTag = (s) => assert.ok(!/<\/?think/i.test(s), `leaked a <think> tag: ${JSON.stringify(s)}`);

test('whole-string: leading block stripped', () => {
  assert.equal(stripLeadingThink('<think>reasoning here</think>\n\nThe answer.'), 'The answer.');
});

test('whole-string: INTERLEAVED blocks all stripped (the 0447 class)', () => {
  const raw = 'Match analysis:\n<think>checking criterion 3: they have Python, SQL but R not mentioned</think>\nYou are strong on Python and SQL.<think>criterion 4: analytical</think> Overall a good fit.';
  const out = stripLeadingThink(raw);
  noThinkTag(out);
  assert.ok(out.includes('strong on Python and SQL'));
  assert.ok(out.includes('Overall a good fit'));
});

test('whole-string: multiple interleaved blocks', () => {
  assert.equal(stripLeadingThink('<think>a</think>One.<think>b</think>Two.<think>c</think>Three.'), 'One.Two.Three.');
});

test('whole-string: unclosed trailing <think> dropped (truncated reasoning)', () => {
  assert.equal(stripLeadingThink('Real answer here.<think>truncated reasoning...'), 'Real answer here.');
});

test('whole-string: pure reasoning yields empty', () => {
  assert.equal(stripLeadingThink('<think>all reasoning, no answer</think>'), '');
});

test('whole-string: no think returned unchanged', () => {
  assert.equal(stripLeadingThink('Just a normal answer with a < b comparison.'), 'Just a normal answer with a < b comparison.');
});

test('incremental: leading block stripped + leading WS trimmed', () => {
  assert.equal(feed('<think>r</think>\n\nAnswer.'), 'Answer.');
});

test('incremental: INTERLEAVED blocks stripped (the 0447 class, char-by-char deltas)', () => {
  const out = feed('Match:\n<think>R not mentioned</think>\nStrong on Python.<think>analytical</think> Good fit.');
  noThinkTag(out);
  assert.ok(out.includes('Strong on Python'));
  assert.ok(out.includes('Good fit'));
});

test('incremental: tags split across arbitrary delta boundaries', () => {
  assert.equal(feed('A<th' + 'ink>x</thi' + 'nk>B'), 'AB');
});

test('incremental: multiple interleaved', () => {
  assert.equal(feed('<think>1</think>X<think>2</think>Y'), 'XY');
});

test('incremental: unclosed trailing think dropped', () => {
  assert.equal(feed('Answer.<think>cut off'), 'Answer.');
});

test('incremental: a lone "<" in answer text is not mistaken for a think tag', () => {
  assert.equal(feed('a < b and c > d'), 'a < b and c > d');
});

test('NO <think> tag EVER survives either form across a battery of shapes', () => {
  const shapes = [
    '<think>x</think>ans',
    'pre<think>x</think>post',
    '<think>a</think><think>b</think>done',
    'mid<think>only</think>',
    '<think>unclosed at end',
    'clean answer no think',
    'a<think>1</think>b<think>2</think>c<think>3</think>d',
  ];
  for (const s of shapes) { noThinkTag(stripLeadingThink(s)); noThinkTag(feed(s)); }
});
