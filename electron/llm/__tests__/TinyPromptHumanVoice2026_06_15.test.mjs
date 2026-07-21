// electron/llm/__tests__/TinyPromptHumanVoice2026_06_15.test.mjs
//
// Property tests for the tiny-prompt humanization (task Phase 5/8 + 9): the spoken tiny
// prompts must carry the compact human-voice rule and the conditional coding-format
// rule; structural tiny prompts (recap / summary / code-hint code section / lecture)
// must NOT get the spoken-voice ban; and the protected invariants (identity guard,
// sales confidential-pricing recency anchor, the six-heading coding contract constant)
// must still hold.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as tiny from '../../../dist-electron/electron/llm/tinyPrompts.js';
import { CODING_CONTRACT_TINY } from '../../../dist-electron/electron/llm/codingContract.js';

const HUMAN_MARK = /Sound like a real person speaking/i;
const CODING_RULE_MARK = /If the user says code only/i;

describe('tiny human-voice rule is in the SPOKEN tiny prompts', () => {
  const SPOKEN = [
    'TINY_ANSWER_PROMPT',
    'TINY_WHAT_TO_ANSWER_PROMPT',
    'TINY_MODE_LOOKING_FOR_WORK_PROMPT',
    'TINY_MODE_TECHNICAL_INTERVIEW_PROMPT',
    'TINY_MODE_SALES_PROMPT',
    'TINY_FOLLOWUP_PROMPT',
  ];
  for (const name of SPOKEN) {
    test(`${name} carries the human-voice rule`, () => {
      const p = tiny[name];
      assert.ok(p, `expected ${name}`);
      assert.match(p, HUMAN_MARK, `${name} must include the compact human-voice rule`);
    });
    test(`${name} names corporate filler as banned`, () => {
      const p = tiny[name].toLowerCase();
      assert.ok(p.includes('corporate filler'));
      assert.ok(p.includes('unique blend'));
      assert.ok(p.includes('business objectives'));
    });
  }
});

describe('structural tiny prompts do NOT carry the spoken-voice ban', () => {
  const STRUCTURAL = [
    'TINY_RECAP_PROMPT',
    'TINY_SUMMARY_JSON_PROMPT',
    'TINY_FOLLOWUP_EMAIL_PROMPT',
    'TINY_MODE_LECTURE_PROMPT',
    'TINY_MODE_RECRUITING_PROMPT',
  ];
  for (const name of STRUCTURAL) {
    test(`${name} has no human-voice block`, () => {
      const p = tiny[name];
      assert.ok(p, `expected ${name}`);
      assert.doesNotMatch(p, HUMAN_MARK, `${name} must not get the spoken human-voice rule`);
    });
  }
});

describe('conditional coding-format rule replaced the unconditional headings line', () => {
  const CODING_MODES = [
    'TINY_ANSWER_PROMPT',
    'TINY_MODE_LOOKING_FOR_WORK_PROMPT',
    'TINY_MODE_TECHNICAL_INTERVIEW_PROMPT',
    'TINY_MODE_GENERAL_PROMPT',
  ];
  for (const name of CODING_MODES) {
    test(`${name} states the code-only / complexity-only / dry-run-only / explain-only rule`, () => {
      const p = tiny[name];
      assert.match(p, CODING_RULE_MARK, `${name} must carry the conditional coding rule`);
      assert.match(p, /complexity only/i);
      assert.match(p, /dry run/i);
      assert.match(p, /explain without code|without code/i);
      // still offers the six headings for a FULL problem
      assert.match(p, /## Approach/);
    });
  }
});

describe('protected invariants still hold after the tiny edits', () => {
  test('CODING_CONTRACT_TINY constant still names every section heading', () => {
    for (const h of ['## Approach', '## Code', '## Complexity', '## Interviewer Follow-up Points']) {
      assert.ok(CODING_CONTRACT_TINY.includes(h), `tiny contract missing ${h}`);
    }
  });

  test('TINY_CORE identity guard is intact in every first-person spoken prompt', () => {
    for (const name of ['TINY_ANSWER_PROMPT', 'TINY_MODE_LOOKING_FOR_WORK_PROMPT', 'TINY_MODE_SALES_PROMPT', 'TINY_MODE_TECHNICAL_INTERVIEW_PROMPT']) {
      assert.ok(tiny[name].includes('IDENTITY GUARD'), `${name} lost the identity guard`);
    }
  });

  test('SALES confidential-pricing template is still the recency-anchored last rule', () => {
    const p = tiny.TINY_MODE_SALES_PROMPT;
    const idx = p.indexOf('CONFIDENTIAL-PRICING TEMPLATE');
    assert.ok(idx > 0, 'confidential-pricing template must be present');
    assert.ok(p.length - idx < 800, `pricing template must stay near the end (now ${p.length - idx} chars from end)`);
  });

  test('the human-voice rule fragment does not encode any profile fact (style-only)', () => {
    // Isolate the injected human-voice block (between its opening line and the next
    // blank line) so we are testing OUR addition, not TINY_CORE's legitimate creator
    // mention. The rule must be pure style with no profile/question content.
    for (const name of ['TINY_ANSWER_PROMPT', 'TINY_MODE_LOOKING_FOR_WORK_PROMPT']) {
      const m = tiny[name].match(/Sound like a real person speaking[\s\S]*?plain speech\./);
      assert.ok(m, `${name} should contain the human-voice block`);
      const block = m[0];
      assert.doesNotMatch(block, /\bEvin\b|\bNatively\b|resume says|Two Sum|hire me because|two sum/i);
    }
  });
});
