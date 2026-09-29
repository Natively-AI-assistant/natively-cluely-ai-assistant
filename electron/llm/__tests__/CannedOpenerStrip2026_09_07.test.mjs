// A canned opener is thrown away; the answer behind it ships (2026-09-07).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { stripCannedOpener, mayBeCannedOpenerPrefix } = require(path.join(process.cwd(), 'dist-electron/electron/llm/cannedOpener.js'));

const LIVE = "Sorry, I don't have the specific story written down in front of me right now. If you're asking about a particular example I mentioned, could you clarify which aspect you'd like more detail on?\n\nThe key thing I want to make sure lands with you is the measurable outcome. So whatever story we're discussing, I'd want to anchor it in something concrete: a before and after, a number, or the scope of what we touched.";

describe('stripCannedOpener', () => {
  test('the measured live opener (two canned sentences) is removed and the content ships', () => {
    const r = stripCannedOpener(LIVE);
    assert.equal(r.stripped.length, 2, JSON.stringify(r.stripped));
    assert.match(r.text, /^The key thing I want to make sure lands/);
  });
  test('"What is your question?" opener is dropped', () => {
    const r = stripCannedOpener("What is your question? I'm asking this one plainly because the field doesn't point to anything an ISBN would identify. An ISBN is a book identifier, and it doesn't apply to a sales pipeline field.");
    assert.equal(r.stripped.length, 1);
    assert.match(r.text, /^I'm asking this one plainly/);
  });
  test('"I couldn\'t find that in the retrieved sections." followed by an answer', () => {
    const r = stripCannedOpener("I couldn't find that in the retrieved sections of the document. The migration locked writes for 27 minutes during peak hour and was rolled back.");
    assert.equal(r.stripped.length, 1);
    assert.match(r.text, /^The migration locked writes/);
  });
  test('a WHOLE-answer refusal is left alone (the sentinel paths own it)', () => {
    const s = "Sorry, I don't have that in front of me. Could you repeat the question?";
    assert.equal(stripCannedOpener(s).text, s);
  });
  test('a real answer that merely contains such a phrase later is untouched', () => {
    const s = "The floor is 17 percent. If they push, say you can't go below it without VP sign-off. Sorry, I don't have the exact renewal date in front of me.";
    assert.equal(stripCannedOpener(s).text, s);
  });
  test('"I don\'t have a specific question right now, but I\'d love to hear…" is a real closing answer and is untouched', () => {
    const s = "I don't have a specific question right now, but I'd love to hear more about how success is measured in the first ninety days and what the team's biggest challenge is.";
    assert.equal(stripCannedOpener(s).text, s);
  });
  test('code and headings are never stripped', () => {
    const s = '## Approach\n- Sorry is not the word here.\n```js\nconst x = 1;\n```';
    assert.equal(stripCannedOpener(s).text, s);
  });
});

describe('mayBeCannedOpenerPrefix', () => {
  test('holds on a possible opener, releases on ordinary text', () => {
    assert.equal(mayBeCannedOpenerPrefix("Sorry, I don't"), true);
    assert.equal(mayBeCannedOpenerPrefix('Could you cl'), true);
    assert.equal(mayBeCannedOpenerPrefix('The migration locked writes for 27 minutes'), false);
    assert.equal(mayBeCannedOpenerPrefix(''), false);
  });
});

describe('stripCannedTail (2026-09-08)', () => {
  const { stripCannedTail } = require(path.join(process.cwd(), 'dist-electron/electron/llm/cannedOpener.js'));
  test('a complete answer followed by "could you clarify which…?" loses the question', () => {
    const r = stripCannedTail("Honestly, I don't have a second risk titled in my notes, the register I have lists three, but they're IDs R-3, R-7, and R-9, so I'm not sure which one you mean as \"risks 2.\" Could you clarify which I should use?");
    assert.ok(r.stripped, 'tail must be stripped');
    assert.ok(/R-9/.test(r.text) && !/clarify/i.test(r.text), r.text);
  });
  test('a real closing question survives', () => {
    const s = 'The floor is 17 percent. Do you want the multi-year uplift too?';
    assert.equal(stripCannedTail(s).text, s);
  });
  test('a clarify-only answer is left for the misfire path', () => {
    const s = 'Could you clarify which risk you mean?';
    assert.equal(stripCannedTail(s).text, s);
  });
});

describe('measured 2026-09-08: "I don\'t have that information." opener and "clarify what" tail', () => {
  const { stripCannedOpener: so, stripCannedTail: st } = require(path.join(process.cwd(), 'dist-electron/electron/llm/cannedOpener.js'));
  test('both ends stripped, the middle ships', () => {
    const a = "I don't have that information. The \"Output\" isn't defined anywhere in the materials provided, so there's no postal code I can give you. Could you clarify what \"Output\" refers to here?";
    const o = so(a); assert.equal(o.stripped.length, 1, JSON.stringify(o));
    const t = st(o.text); assert.ok(t.stripped, 'tail');
    assert.match(t.text, /^The "Output" isn't defined/); assert.ok(!/clarify/.test(t.text));
  });
});

describe('measured 2026-09-08: "I need more context" and "I need to know which" openers', () => {
  const { stripCannedOpener: so } = require(path.join(process.cwd(), 'dist-electron/electron/llm/cannedOpener.js'));
  test('both are dropped when content follows', () => {
    for (const a of [
      'I need to know which question number you mean before I can repeat it. The material lists several: for 2024, question 2a (Green function, 12 marks) and 4b (method of characteristics, 8 marks).',
      'I need more context to answer your question accurately. For the 2021 paper, question 2a is the Green function question and carries 12 marks.',
    ]) { const r = so(a); assert.equal(r.stripped.length, 1, a); assert.ok(!/^I need/.test(r.text)); }
  });
});
