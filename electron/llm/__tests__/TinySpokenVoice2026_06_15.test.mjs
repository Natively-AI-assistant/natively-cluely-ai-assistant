// electron/llm/__tests__/TinySpokenVoice2026_06_15.test.mjs
//
// Property tests for the tiny spoken-LENGTH rule (spoken-answer-quality sprint). The spoken
// tiny prompts must carry the length voice; structural tiny prompts must not; the
// confidential-pricing recency anchor and identity guard must still hold.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as tiny from '../../../dist-electron/electron/llm/tinyPrompts.js';

const LENGTH_MARK = /Output the EXACT words the user can say aloud/i;

describe('tiny spoken-length rule is in the spoken tiny prompts', () => {
  const SPOKEN = [
    'TINY_ANSWER_PROMPT', 'TINY_WHAT_TO_ANSWER_PROMPT', 'TINY_MODE_LOOKING_FOR_WORK_PROMPT',
    'TINY_MODE_TECHNICAL_INTERVIEW_PROMPT', 'TINY_MODE_SALES_PROMPT', 'TINY_FOLLOWUP_PROMPT',
  ];
  for (const name of SPOKEN) {
    test(`${name} carries the length rule`, () => {
      assert.match(tiny[name], LENGTH_MARK, `${name} must carry the spoken-length rule`);
    });
    test(`${name} states the 100-word ceiling + blunt no-tutorial rule`, () => {
      assert.match(tiny[name], /never over 100|under 85 words/i);
      // The blunt no-tutorial rule for generic tech concepts, synced from the full tier
      // 2026-06-16: a concept answer must not be documentation (no heading/bullet/code).
      assert.match(tiny[name], /not a tutorial|NOT documentation/i);
      assert.match(tiny[name], /heading|bullet|code block/i);
    });
    test(`${name} states the adaptive 15-30s band (not pinned to ~30s)`, () => {
      assert.match(tiny[name], /15 to 30 seconds/i);
      assert.match(tiny[name], /shortest|don'?t default to the max|~?15s/i);
    });
    test(`${name} allows a fuller answer (principle, not a fixed list)`, () => {
      // The tiny rule now also teaches the SPOKEN_FULL escape hatch: go fuller when a
      // short answer would be incomplete/misleading/unsafe.
      assert.match(tiny[name], /fuller|up to ~?180/i);
      assert.match(tiny[name], /incomplete|misleading|unsafe/i);
    });
  }
});

describe('structural tiny prompts do NOT carry the spoken length rule', () => {
  for (const name of ['TINY_RECAP_PROMPT', 'TINY_SUMMARY_JSON_PROMPT', 'TINY_MODE_LECTURE_PROMPT']) {
    test(`${name} has no spoken length rule`, () => {
      assert.doesNotMatch(tiny[name], LENGTH_MARK);
    });
  }
});

describe('protected invariants still hold', () => {
  test('identity guard intact in first-person spoken prompts', () => {
    for (const name of ['TINY_ANSWER_PROMPT', 'TINY_MODE_LOOKING_FOR_WORK_PROMPT', 'TINY_MODE_SALES_PROMPT']) {
      assert.ok(tiny[name].includes('IDENTITY GUARD'), `${name} lost the identity guard`);
    }
  });
  test('SALES confidential-pricing template stays near the end', () => {
    const p = tiny.TINY_MODE_SALES_PROMPT;
    const idx = p.indexOf('CONFIDENTIAL-PRICING TEMPLATE');
    assert.ok(idx > 0);
    assert.ok(p.length - idx < 900, `pricing template drifted: ${p.length - idx} chars from end`);
  });
  test('conditional coding format rule still present', () => {
    assert.match(tiny.TINY_ANSWER_PROMPT, /If the user says code only/i);
  });
});
