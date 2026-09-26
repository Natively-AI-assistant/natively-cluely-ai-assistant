import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CJK_RE,
  hasCJK,
  meetingHasCJK,
  needsEmbeddedFont,
  splitFontRuns,
  wrapCjkText,
} from '../pdfCjkText.mjs';

// A stand-in for jsPDF's getTextWidth: 2 units for a wide glyph (CJK, emoji),
// 1 for anything else. Enough to exercise the greedy packing without a PDF
// document. Iterating with [...s] measures by code point, matching a real font.
const measure = (s) =>
  [...s].reduce((w, ch) => w + (CJK_RE.test(ch) || ch.codePointAt(0) > 0xffff ? 2 : 1), 0);

test('hasCJK detects the ranges the embedded font is selected for', () => {
  assert.equal(hasCJK('会议'), true);          // U+4E00-9FFF ideographs
  assert.equal(hasCJK('。'), true);            // U+3000-303F punctuation
  assert.equal(hasCJK('，'), true);            // U+FF00-FFEF fullwidth
  assert.equal(hasCJK('Hello, world'), false);
  assert.equal(hasCJK(''), false);
  assert.equal(hasCJK(undefined), false);
  assert.equal(hasCJK(null), false);
  assert.equal(hasCJK(123), false);
});

test('hasCJK is stateless across calls', () => {
  // A /g regex would carry lastIndex and start returning false here.
  for (let i = 0; i < 5; i++) assert.equal(hasCJK('会议记录'), true, `call ${i}`);
});

test('CJK_RE covers only the ranges the embedded subset serves', () => {
  assert.equal(CJK_RE.test('\uD83D'), false, 'a lone surrogate is not CJK');
  assert.equal(CJK_RE.test('\u{1F600}'), false);
  assert.equal(CJK_RE.test('한'), false, 'Hangul is not in the subset ranges');
  assert.equal(CJK_RE.test('é'), false, 'Latin-1 must route to Helvetica');
});

test('meetingHasCJK looks at every field the PDF renders', () => {
  const base = { title: 'Sync', summary: 'All good', transcript: [], usage: [] };
  assert.equal(meetingHasCJK(base), false);
  assert.equal(meetingHasCJK({ ...base, title: '产品评审' }), true);
  assert.equal(meetingHasCJK({ ...base, summary: '一切顺利' }), true);
  assert.equal(
    meetingHasCJK({ ...base, detailedSummary: { actionItems: ['更新文档'], keyPoints: [] } }),
    true,
  );
  assert.equal(
    meetingHasCJK({ ...base, detailedSummary: { actionItems: [], keyPoints: ['质量优先'] } }),
    true,
  );
  assert.equal(meetingHasCJK({ ...base, transcript: [{ speaker: '张伟', text: 'hi' }] }), true);
  assert.equal(meetingHasCJK({ ...base, transcript: [{ speaker: 'Bob', text: '你好' }] }), true);
  assert.equal(meetingHasCJK({ ...base, usage: [{ question: '为什么？', answer: 'x' }] }), true);
  assert.equal(meetingHasCJK({ ...base, usage: [{ question: 'why?', answer: '因为' }] }), true);
  assert.equal(meetingHasCJK(null), false);
  assert.equal(meetingHasCJK({}), false);
});

test('meetingHasCJK tolerates holes in the transcript and usage arrays', () => {
  assert.doesNotThrow(() => meetingHasCJK({ transcript: [undefined], usage: [null] }));
  assert.equal(meetingHasCJK({ transcript: [undefined], usage: [null] }), false);
});

test('needsEmbeddedFont splits exactly where the two encoders do', () => {
  // At or below U+00FF only Helvetica can encode; above it, only the subset can.
  for (const ch of [' ', 'A', 'z', '9', 'é', 'ü', '°', '±', '×', '£', '©', '\u00FF'])
    assert.equal(needsEmbeddedFont(ch), false, `${ch} must go to Helvetica`);
  for (const ch of ['会', '。', '，', '—', '…', '“', '•', '\u{1F600}'])
    assert.equal(needsEmbeddedFont(ch), true, `${ch} is unencodable in Helvetica`);
});

test('splitFontRuns keeps Latin-1 out of the embedded font', () => {
  // The bug this exists to prevent: with one document-wide font, jsPDF's
  // Identity-H encoder hits the unmappable é and discards the rest of the line.
  const runs = splitFontRuns('会议记录：José 说 25°C');
  assert.deepEqual(runs, [
    { text: '会议记录：', embedded: true },
    { text: 'José ', embedded: false },
    { text: '说', embedded: true },
    { text: ' 25°C', embedded: false },
  ]);
  // Every character survives the split, in order.
  assert.equal(runs.map((r) => r.text).join(''), '会议记录：José 说 25°C');
});

test('splitFontRuns handles single-kind and empty input', () => {
  assert.deepEqual(splitFontRuns('hello'), [{ text: 'hello', embedded: false }]);
  assert.deepEqual(splitFontRuns('会议'), [{ text: '会议', embedded: true }]);
  assert.deepEqual(splitFontRuns(''), []);
});

test('splitFontRuns keeps astral characters whole', () => {
  assert.deepEqual(splitFontRuns('A\u{1F600}B'), [
    { text: 'A', embedded: false },
    { text: '\u{1F600}', embedded: true },
    { text: 'B', embedded: false },
  ]);
});

test('splitFontRuns routes the dashes an LLM summary emits to the embedded font', () => {
  // — U+2014 and … U+2026 ARE in the subset but are dropped by Helvetica, so the
  // embedded font is their only chance of rendering.
  assert.deepEqual(splitFontRuns('done — soon…'), [
    { text: 'done ', embedded: false },
    { text: '—', embedded: true },
    { text: ' soon', embedded: false },
    { text: '…', embedded: true },
  ]);
});

test('wrapCjkText breaks CJK anywhere but never mid-word in Latin', () => {
  // width 10 => 5 CJK glyphs per line
  assert.deepEqual(wrapCjkText('一二三四五六七', 10, measure), ['一二三四五', '六七']);

  const lines = wrapCjkText('会议 abcdefgh 结束', 10, measure);
  assert.ok(
    lines.every((l) => !/^abcdefg$/.test(l)),
    'an 8-char Latin word must not be split when it fits on a line of its own',
  );
  assert.equal(lines.join('').replace(/\s/g, ''), '会议abcdefgh结束');
});

test('wrapCjkText hard-breaks a token wider than the whole line', () => {
  const lines = wrapCjkText('aaaaaaaaaaaa', 5, measure);
  assert.deepEqual(lines, ['aaaaa', 'aaaaa', 'aa']);
});

test('wrapCjkText preserves explicit newlines and blank lines', () => {
  assert.deepEqual(wrapCjkText('一二\n\n三四', 10, measure), ['一二', '', '三四']);
});

test('wrapCjkText does not start a line with the whitespace it broke on', () => {
  const lines = wrapCjkText('一二三四五 六七', 10, measure);
  assert.ok(lines.every((l) => l === l.trimStart()), `leading space in ${JSON.stringify(lines)}`);
});

test('wrapCjkText is stable across repeated calls', () => {
  // Regression guard for a module-level /g regex leaking lastIndex.
  const once = wrapCjkText('一二三四五六七', 10, measure);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(wrapCjkText('一二三四五六七', 10, measure), once, `call ${i}`);
  }
});

// --- regression guards for the U+8C48 / U+F900 homoglyph in the break-unit class ---
// The two are indistinguishable on screen. Spelling the class with U+8C48 and no
// `u` flag widened the range to U+8C48-FAFF, which covers Hangul and every UTF-16
// surrogate. Both cases below FAIL against that regex and pass against this one.

test('wrapCjkText never splits an astral character into lone surrogates', () => {
  // With the buggy class this wraps to ['一二三四五\uD83D', '\uDE00六'] — a lone
  // high surrogate ending line 1 and a lone low surrogate starting line 2.
  const lines = wrapCjkText('一二三四五\u{1F600}六', 11, measure);
  for (const line of lines) {
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      assert.ok(cp < 0xd800 || cp > 0xdfff, `lone surrogate U+${cp.toString(16)} in ${line}`);
    }
  }
  assert.deepEqual(lines, ['一二三四五', '\u{1F600}六']);
});

test('wrapCjkText treats Hangul as words, not as breakable ideographs', () => {
  // With the buggy class this wraps to ['AA 한글', '단어'], breaking mid-word.
  assert.deepEqual(wrapCjkText('AA 한글단어', 5, measure), ['AA ', '한글단어']);
});
