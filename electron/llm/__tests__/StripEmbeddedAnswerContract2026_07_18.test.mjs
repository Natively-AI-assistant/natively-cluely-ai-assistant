// electron/llm/__tests__/StripEmbeddedAnswerContract2026_07_18.test.mjs
//
// Tests for stripEmbeddedAnswerContract (grounding campaign H4, 2026-07-18).
// Defense-in-depth helper — no live bug injects <answer_contract> into `message`
// today, but the stripper pins the contract for future regressions and the
// surface area is small enough that unit tests are cheap.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { stripEmbeddedAnswerContract } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/stripEmbeddedAnswerContract.js')).href
);

describe('stripEmbeddedAnswerContract — balanced block in middle of message', () => {
  test('strips a balanced block, keeps surrounding paragraph breaks', () => {
    const input = 'write the code for two sum\n\n<answer_contract>answerType: coding\n## Approach\n...</answer_contract>\n\nin python';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, 'write the code for two sum\n\nin python');
  });

  test('handles extra whitespace around the block as a paragraph separator', () => {
    const input = 'hi   <answer_contract>\n\nanswerType: coding\n</answer_contract>   bye';
    const out = stripEmbeddedAnswerContract(input);
    // When BOTH sides have whitespace, collapse to a single paragraph break
    assert.equal(out, 'hi\n\nbye');
  });

  test('is case-insensitive on the tag', () => {
    const input = 'q <ANSWER_CONTRACT>x</ANSWER_CONTRACT> q';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, 'q\n\nq');
  });
});

describe('stripEmbeddedAnswerContract — entire message is the block', () => {
  test('returns the body without the XML tags', () => {
    const input = '<answer_contract>answerType: coding\n## Approach\nUse a hash map.</answer_contract>';
    const out = stripEmbeddedAnswerContract(input);
    // Body preserved, tags dropped, trimmed
    assert.ok(out.includes('answerType: coding'));
    assert.ok(out.includes('Use a hash map.'));
    assert.doesNotMatch(out, /<\/?answer_contract>/i);
  });

  test('block with only whitespace body returns empty after tag-strip fallback', () => {
    const input = '<answer_contract>   </answer_contract>';
    const out = stripEmbeddedAnswerContract(input);
    // Body is whitespace-only after trim → stripped branch yields empty,
    // bodyOnly path yields empty too, final fallback is the empty `stripped`
    assert.equal(out, '');
  });
});

describe('stripEmbeddedAnswerContract — partial / unbalanced tags are NOT stripped', () => {
  test('partial open tag is preserved verbatim', () => {
    const input = 'write the code for odd/even <answe';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, input);
  });

  test('bare inline mention is preserved verbatim', () => {
    const input = 'How do I write an <answer_contract> tag in a Markdown prompt?';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, input);
  });

  test('open tag with body but no close tag is preserved verbatim', () => {
    const input = '<answer_contract>answerType: coding\n## Approach\n...';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, input);
  });

  test('close tag with no open tag is preserved verbatim', () => {
    const input = 'this is the end</answer_contract> of the message';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, input);
  });
});

describe('stripEmbeddedAnswerContract — non-string and empty inputs', () => {
  test('non-string returns the value unchanged (the function type-asserts but does not coerce)', () => {
    assert.equal(stripEmbeddedAnswerContract(null), null);
    assert.equal(stripEmbeddedAnswerContract(undefined), undefined);
    assert.equal(stripEmbeddedAnswerContract(42), 42);
    // Object passes through the typeof guard and is returned as-is
    const obj = { a: 1 };
    assert.strictEqual(stripEmbeddedAnswerContract(obj), obj);
  });

  test('empty string returns empty string', () => {
    assert.equal(stripEmbeddedAnswerContract(''), '');
  });

  test('plain text with no tags is unchanged', () => {
    assert.equal(stripEmbeddedAnswerContract('hello world'), 'hello world');
  });
});

describe('stripEmbeddedAnswerContract — multiple blocks', () => {
  test('strips every balanced block, not just the first', () => {
    const input = '<answer_contract>a</answer_contract> middle <answer_contract>b</answer_contract>';
    const out = stripEmbeddedAnswerContract(input);
    assert.equal(out, 'middle');
  });
});
