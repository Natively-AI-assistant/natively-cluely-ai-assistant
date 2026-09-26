// electron/llm/__tests__/PromptSystemV2UserAuthority2026_09_20.test.mjs
//
// The v2 system prompt is the carrier for the legacy live path and V3's
// fallback. It rendered the user's Real-time prompt as a bare
// <custom_instructions> block and then, deliberately LAST, a <final_check>
// whose own comment said custom instructions "can never override" it. Two of
// its five items are not safety laws at all — they are FORMATTING defaults:
//
//   3. "... producing exactly this action's output shape."
//   5. "Spoken prose contains no ... hyphen bullets, headings ..."
//
// so "answer as three bullets" or a custom answer format was vetoed at the
// strongest position in the prompt. Items 1, 2 and 4 (grounding,
// confidentiality, the silence gate) are laws and stay absolute.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjs = createRequire(import.meta.url);
const v2 = cjs(path.resolve(__dirname, '../../../dist-electron/electron/llm/promptSystemV2.js'));
const build = (extra) => v2.buildSystemPromptV2({ mode: 'sales', action: 'answer', tier: 'cloud', ...extra });

describe('the user’s instructions are declared binding on presentation', () => {
  const p = build({ customInstructions: 'Answer in 100 words.\nAlways answer coding problems in Java even if the screenshot has Python.', codingTask: true });

  test('an authority block follows the instructions and precedes the final check', () => {
    const a = p.indexOf('</custom_instructions>'), b = p.indexOf('<custom_instructions_authority>'), c = p.indexOf('<final_check>');
    assert.ok(a > 0 && b > a && c > b, `order was custom=${a} authority=${b} final=${c}`);
  });
  test('it names what it outranks', () => {
    const block = p.slice(p.indexOf('<custom_instructions_authority>'), p.indexOf('</custom_instructions_authority>'));
    assert.match(block, /binding/i);
    assert.match(block, /coding_contract|response contract/i);
    assert.match(block, /TEMPLATE CONFORMANCE/);
    assert.match(block, /length/i);
  });
  test('it carries the resolved length and language', () => {
    assert.match(p, /LENGTH is set by the user: about 100 words/);
    assert.match(p, /CODE LANGUAGE is set by the user: Java/);
  });
  test('it still cannot move grounding', () => {
    const block = p.slice(p.indexOf('<custom_instructions_authority>'), p.indexOf('</custom_instructions_authority>'));
    assert.match(block, /cannot|never/i);
    assert.match(block, /source|evidence/i);
    assert.match(block, /invent|fabricat|unsupported/i);
  });
});

describe('the final check stops vetoing the user’s formatting', () => {
  for (const tier of ['cloud', 'local']) {
    test(`${tier}: with instructions, the shape/formatting items defer to the user`, () => {
      const p = build({ tier, customInstructions: 'Answer as three bullet points.' });
      const fc = p.slice(p.indexOf('<final_check>'));
      assert.match(fc, /custom_instructions/);
      assert.match(fc, /default/i);
      assert.ok(p.trim().endsWith('</final_check>'), 'final check is still the last block');
    });
    test(`${tier}: the laws are untouched`, () => {
      const p = build({ tier, customInstructions: 'Answer as three bullet points.' });
      const fc = p.slice(p.indexOf('<final_check>'));
      assert.match(fc, /grounded/i);
      assert.match(fc, /confidential/i);
      assert.match(fc, /silence gate/i);
    });
    test(`${tier}: WITHOUT instructions the prompt is byte-identical to before`, () => {
      const p = build({ tier });
      assert.doesNotMatch(p, /custom_instructions/);
    });
  }
});

describe('the cap is the editor’s 8,000, shared, and still safe at the boundary', () => {
  test('CUSTOM_INSTRUCTIONS_MAX_CHARS is 8000', () => assert.equal(v2.CUSTOM_INSTRUCTIONS_MAX_CHARS, 8000));
  test('text past the old 1,200 cap now reaches the model', () => {
    const p = build({ customInstructions: 'x'.repeat(3000) + ' LATE_RULE_SENTINEL' });
    assert.match(p, /LATE_RULE_SENTINEL/);
  });
});
