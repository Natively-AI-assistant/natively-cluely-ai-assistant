// The hidden calculation step (2026-09-30) — see electron/llm/calcScratch.ts.
//
// Replaying nine recorded quantitative benchmark prompts to the same model, six
// samples each: 23/54 right as prompted, 43/54 when the model first writes its
// working as named steps. The working must never reach any surface, and the
// model closed the block with `[/CALC]` in 10 of 54 samples — so the stripper is
// tolerant, sits at the one point every provider passes through, and never
// blanks an answer.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { StreamingCalcFilter, stripCalcScratch, verifyCalcScratch, evalCalcExpression } from '../../../dist-electron/electron/llm/calcScratch.js';
import { LLMHelper } from '../../../dist-electron/electron/LLMHelper.js';
import { calculationNotice, CALCULATION_NOTICE } from '../../../dist-electron/electron/context-intelligence/generation/prompt-composer.js';

const ANSWER = "Let's add it up. You're in for 124 and I'm in for 74, so 99 each. I owe you 25.";
const BLOCK = '[[CALC]]\nthem_paid = 84 + 40 = 124\nme_paid = 62 + 12 = 74\neach_share = (124 + 74) / 2 = 99\nme_owes_them = 99 - 74 = 25\n[[/CALC]]\n\n';

/** Feed `text` split at every boundary position (and char by char) and return what the user would see. */
function streamed(text, cuts) {
  const f = new StreamingCalcFilter();
  let out = ''; let last = 0;
  for (const c of [...cuts, text.length]) { out += f.feed(text.slice(last, c)); last = c; }
  return { out: out + f.finish(), scratch: f.scratch };
}

describe('the scratch block never reaches the user', () => {
  test('canonical tags, one chunk', () => {
    const r = stripCalcScratch(BLOCK + ANSWER);
    assert.equal(r.text, ANSWER);
    assert.match(r.scratch, /me_owes_them = 99 - 74 = 25/);
  });
  test('split at EVERY position, and one char at a time', () => {
    const text = BLOCK + ANSWER;
    for (let i = 1; i < text.length; i++) assert.equal(streamed(text, [i]).out, ANSWER, `cut at ${i}`);
    assert.equal(streamed(text, [...Array(text.length).keys()].slice(1)).out, ANSWER);
  });
  test('close-tag drift seen live: [/CALC], [[/CALC], [ / calc ]]', () => {
    for (const close of ['[/CALC]', '[[/CALC]', '[/CALC]]', '[ / calc ]]']) {
      const text = BLOCK.replace('[[/CALC]]', close) + ANSWER;
      assert.equal(stripCalcScratch(text).text, ANSWER, close);
      for (let i = 1; i < text.length; i += 7) assert.equal(streamed(text, [i]).out, ANSWER, `${close} cut ${i}`);
    }
  });
  test('open-tag drift: [CALC], leading whitespace', () => {
    assert.equal(stripCalcScratch(BLOCK.replace('[[CALC]]', '[CALC]') + ANSWER).text, ANSWER);
    assert.equal(stripCalcScratch('\n  ' + BLOCK + ANSWER).text, ANSWER);
  });
  test('an unclosed block ends at the first prose line after a blank line', () => {
    const text = BLOCK.replace('[[/CALC]]\n', '') + ANSWER;
    for (let i = 1; i < text.length; i += 5) assert.equal(streamed(text, [i]).out, ANSWER, `cut ${i}`);
  });
  test('a block that is all working and never closes stays hidden (no working shown)', () => {
    const r = stripCalcScratch('[[CALC]]\na = 1 + 1 = 2\n');
    assert.equal(r.text, '');
    assert.match(r.scratch, /a = 1 \+ 1 = 2/);
  });
});

describe('every other answer passes through untouched', () => {
  for (const t of [
    ANSWER,
    '[Link text](https://example.com) is where the docs are.',
    '[[GIST]] a gist-first answer',
    '[Note] something',
    '  Leading spaces then words.',
    'Cost is [[CALC]] mentioned mid-answer, which is not a leading block.',
    '```js\nconst a = [1, 2];\n```',
  ]) {
    test(JSON.stringify(t.slice(0, 40)), () => {
      assert.equal(stripCalcScratch(t).text, t);
      for (let i = 1; i < t.length; i += 3) assert.equal(streamed(t, [i]).out, t, `cut ${i}`);
    });
  }
  test('an unrelated leading "[" only waits until it cannot be a CALC tag', () => {
    const f = new StreamingCalcFilter();
    assert.equal(f.feed('['), '');
    assert.equal(f.feed('L'), '[L');
  });
});

describe('the transport strips it for every consumer and reports it', () => {
  const run = async (chunks) => {
    const self = Object.create(LLMHelper.prototype);
    self._streamChatInner = async function* () { for (const c of chunks) yield c; };
    const { stream, outcome } = self.streamChatWithOutcome('q');
    let out = '';
    for await (const c of stream) out += c;
    return { out, outcome };
  };
  test('streamChatWithOutcome: user sees the answer, outcome carries the working', async () => {
    const text = BLOCK + ANSWER;
    const chunks = text.match(/[\s\S]{1,9}/g);
    const { out, outcome } = await run(chunks);
    assert.equal(out.trim(), ANSWER);
    assert.match(outcome.calcScratch, /each_share = \(124 \+ 74\) \/ 2 = 99/);
  });
  test('a reasoning block THEN a scratch block: both removed', async () => {
    const { out } = await run(['<think>hmm</think>\n', BLOCK, ANSWER]);
    assert.equal(out.trim(), ANSWER);
  });
  test('no scratch: outcome.calcScratch stays undefined', async () => {
    const { out, outcome } = await run([ANSWER]);
    assert.equal(out, ANSWER);
    assert.equal(outcome.calcScratch, undefined);
  });
});

describe('the working is checked deterministically (observe-only)', () => {
  test('correct steps, names reused, functions', () => {
    const v = verifyCalcScratch('sensors = 320\ngateways = ceil(sensors / 60) = 6\ngateway_cost = gateways * 340 = 2040\nx = max(3, 4) = 4');
    assert.equal(v.mismatches, 0);
    assert.equal(v.checked, 3);
  });
  test('a wrong result is a mismatch', () => {
    const v = verifyCalcScratch('gap = 124 - 74 = 50\nowed = gap / 2 = 50');
    assert.equal(v.mismatches, 1);
    assert.equal(v.lines.find((l) => l.ok === false).computed, 25);
  });
  test('anything that is not arithmetic is skipped, never evaluated', () => {
    for (const bad of ['process.exit(1)', 'require("fs")', 'constructor.constructor("return 1")()', 'a;b', '1 + [2]']) {
      assert.throws(() => evalCalcExpression(bad), bad);
    }
    const v = verifyCalcScratch('x = process.exit(1) = 0\ny = 2 + 2 = 4');
    assert.equal(v.checked, 1);
    assert.equal(v.lines[0].ok, null);
  });
  test('percent and spoken multiplication signs', () => {
    assert.equal(evalCalcExpression('30% * 14200'), 4260);
    assert.equal(evalCalcExpression('11 × 520'), 5720);
    assert.equal(evalCalcExpression('11 x 520'), 5720);
    assert.equal(evalCalcExpression('$1,200 + 600'), 1800);
  });
});

describe('the composer asks for it only on arithmetic turns', () => {
  const tx = 'THEM: I paid $84 for the campsite and $40 for gas.\nME: I got groceries, about sixty two, and firewood, twelve.';
  test('a settle-up question with figures in the conversation', () => {
    assert.equal(calculationNotice('Alright, so who owes who and how much?', tx), CALCULATION_NOTICE);
  });
  test('a quoted price question with a price sheet in evidence', () => {
    assert.ok(calculationNotice('Ballpark, what would year one run us for 320 sensors?', '<evidence>HL-T3 sensor: $89 each. Gateway $340.</evidence>'));
  });
  test('not for code or complexity questions', () => {
    assert.equal(calculationNotice('What is the time complexity of this function for n = 10 and 20?', ''), '');
  });
  test('not when fewer than two figures are in play', () => {
    assert.equal(calculationNotice('How much does it cost?', 'The plan is great.'), '');
  });
  test('not for non-quantity questions', () => {
    assert.equal(calculationNotice('Tell me about yourself', tx), '');
  });
  test('the note tells the model to skip the block for a one-figure lookup and hides it', () => {
    assert.match(CALCULATION_NOTICE, /Skip it for a direct lookup/);
    assert.match(CALCULATION_NOTICE, /\[\[CALC\]\] and \[\[\/CALC\]\]/);
    // Neutral examples only — never a benchmark scenario's figures.
    assert.doesNotMatch(CALCULATION_NOTICE, /124|\b74\b|\b99\b|\b25\b|trip/);
  });
});
