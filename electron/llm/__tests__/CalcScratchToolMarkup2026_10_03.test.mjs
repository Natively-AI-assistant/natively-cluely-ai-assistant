// The hidden working, written as tool-call markup (2026-10-03) — see electron/llm/calcScratch.ts.
//
// Seen once in 334 benchmark turns that carried the "# Calculation" notice (evidence-rich run, Sales, typed,
// deepseek-flash, no tools declared on the request): instead of [[CALC]] … [[/CALC]] the model opened its working
// with its own tool-call markup, `<｜｜DSML｜｜ calls>` + `<｜｜DSML｜｜ invoke name="calculation">`, wrote the
// working as prose, closed with `</calculation>` and then answered. The filter knew only the [[CALC]] form, so
// 1,100 characters of markup and working streamed to the user; cleanAnswerArtifacts does not remove it either, and
// the settled text was clean only because the claim pass happened to rewrite that turn. 24 replays of the recorded
// request did not reproduce it (6 used [[CALC]], 18 answered directly), so the model cannot be made to stop on
// demand: the block is recognised and hidden like the form that was asked for.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { StreamingCalcFilter, stripCalcScratch } from '../../../dist-electron/electron/llm/calcScratch.js';

const ANSWER = 'On the current price list, you can approve up to **10%** off list on your own. Anything above that, up to 18%, needs your Regional Sales Director.';
// The recorded shape: two opening tags, prose working with blank lines and no "=" lines, a close tag named after the invoke.
const WORKING = 'The question is about the user\'s own approval authority. Two price lists give different thresholds, and one is a draft.\n\nKestravane_Fleet_Price_List_v4.2.pdf (current, v4.2):\n- Up to 10%: Account Executive, no further approval\n- Above 10%, up to 18%: Regional Sales Director\n\nThe v4.2 is the current version, so 10% is the answer, with the conflict noted.';
const RECORDED = `<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="calculation">\n${WORKING}\n</calculation>\n\n${ANSWER}`;

function streamed(text, cuts) {
  const f = new StreamingCalcFilter();
  let out = ''; let last = 0;
  for (const c of [...cuts, text.length]) { out += f.feed(text.slice(last, c)); last = c; }
  return { out: out + f.finish(), scratch: f.scratch };
}

describe('working written as tool-call markup never reaches the user', () => {
  test('the recorded shape, one chunk: only the answer is shown, the working is kept as scratch', () => {
    const r = stripCalcScratch(RECORDED);
    assert.equal(r.text, ANSWER);
    assert.match(r.scratch, /10% is the answer/);
  });

  test('the recorded shape split at EVERY position, and one character at a time', () => {
    for (let i = 1; i < RECORDED.length; i++) assert.equal(streamed(RECORDED, [i]).out, ANSWER, `cut at ${i}`);
    assert.equal(streamed(RECORDED, [...Array(RECORDED.length).keys()].slice(1)).out, ANSWER);
  });

  test('nothing of the block is shown while it streams', () => {
    const f = new StreamingCalcFilter();
    let shown = '';
    const end = RECORDED.indexOf(ANSWER);
    for (let i = 0; i < end; i += 7) { shown += f.feed(RECORDED.slice(i, Math.min(i + 7, end))); assert.equal(shown, '', `leaked by ${i}: ${JSON.stringify(shown.slice(0, 40))}`); }
  });

  test('the forms the same markup takes: one bar or two, ASCII bars, function_calls, its own close tags', () => {
    const forms = [
      `<｜DSML｜function_calls>\n<｜DSML｜invoke name="calculation">\n${WORKING}\n</｜DSML｜invoke>\n</｜DSML｜function_calls>\n\n${ANSWER}`,
      `<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="calculation">\n${WORKING}\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>\n${ANSWER}`,
      `<|DSML|invoke name="calculation">\n${WORKING}\n</|DSML|invoke>\n\n${ANSWER}`,
      `<calculation>\n${WORKING}\n</calculation>\n\n${ANSWER}`,
      `\n<｜｜DSML｜｜ invoke name="calculation">${WORKING}</calculation>${ANSWER}`,
    ];
    for (const text of forms) {
      assert.equal(stripCalcScratch(text).text, ANSWER, JSON.stringify(text.slice(0, 50)));
      for (let i = 1; i < text.length; i += 3) assert.equal(streamed(text, [i]).out, ANSWER, `${JSON.stringify(text.slice(0, 30))} cut at ${i}`);
    }
  });

  test('a block that never closes is not shown as markup, and the answer is not blanked', () => {
    const text = `<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="calculation">\n${ANSWER}`;
    const r = stripCalcScratch(text);
    assert.doesNotMatch(r.text, /DSML|<|invoke/);
    assert.match(r.text, /Regional Sales Director/);
  });

  test('answers that only begin like markup pass untouched', () => {
    for (const text of ['<5 minutes is the target, and we hit it on 97% of calls.', '<div> is a block element; <span> is inline.', '< 10% needs no approval.', 'Use `<calculation>` only in the docs.', '<calculating the split now> is not something I would say; you each owe 60.']) {
      assert.equal(stripCalcScratch(text).text, text);
      for (let i = 1; i < text.length; i++) assert.equal(streamed(text, [i]).out, text, `cut at ${i}`);
    }
  });

  test('the [[CALC]] form is unchanged', () => {
    const block = '[[CALC]]\neach_share = (124 + 74) / 2 = 99\nme_owes_them = 99 - 74 = 25\n[[/CALC]]\n\n';
    assert.equal(stripCalcScratch(block + ANSWER).text, ANSWER);
  });
});
