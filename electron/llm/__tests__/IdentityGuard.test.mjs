// electron/llm/__tests__/IdentityGuard.test.mjs
//
// Regression tests for S454 sub-issue 2: creator-identity leakage in voice
// modes (model outputs "I'm Evin John..." as the speaker's self-introduction).
//
// The guard lives in two places:
//   1. tinyPrompts.ts → TINY_CORE (composed into every tiny mode)
//   2. prompts.ts     → SHARED CORE_IDENTITY block (cloud-tier system prompt)
//
// Both must carry the explicit "names describe the assistant, NOT the speaker"
// rule. If either drops it, voice modes can borrow the assistant's name as
// the candidate's / seller's / participant's name — the exact failure mode
// the 45-scenario baseline eval kept surfacing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tinyPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/tinyPrompts.js');
const fullPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
const tiny = await import(pathToFileURL(tinyPath).href);
const full = await import(pathToFileURL(fullPath).href);

const GUARD_MARKERS = [
  'IDENTITY GUARD',
  '"Natively"',
  '"Evin John"',
  'NEVER',
];

const FIRST_PERSON_TINY_PROMPTS = [
  'TINY_ANSWER_PROMPT',
  'TINY_WHAT_TO_ANSWER_PROMPT',
  'TINY_MODE_LOOKING_FOR_WORK_PROMPT',
  'TINY_MODE_SALES_PROMPT',
  'TINY_MODE_TEAM_MEET_PROMPT',
  'TINY_MODE_TECHNICAL_INTERVIEW_PROMPT',
  'TINY_MODE_GENERAL_PROMPT',
];

describe('IdentityGuard — TINY_CORE carries the name-claim guard', () => {
  for (const marker of GUARD_MARKERS) {
    test(`TINY_CORE contains marker: ${marker}`, () => {
      assert.ok(
        tiny.TINY_CORE.includes(marker),
        `TINY_CORE is missing required guard marker "${marker}". Voice modes will leak creator identity.`,
      );
    });
  }

  test('TINY_CORE explicitly forbids "I\'m Evin John" / "I\'m Natively"', () => {
    assert.ok(
      /I'm Evin John/i.test(tiny.TINY_CORE),
      'TINY_CORE must call out the literal "I\'m Evin John" anti-pattern',
    );
    assert.ok(
      /I'm Natively/i.test(tiny.TINY_CORE),
      'TINY_CORE must call out the literal "I\'m Natively" anti-pattern',
    );
  });
});

describe('IdentityGuard — every first-person tiny prompt inherits the guard', () => {
  for (const name of FIRST_PERSON_TINY_PROMPTS) {
    test(`${name} includes the IDENTITY GUARD block`, () => {
      const prompt = tiny[name];
      assert.ok(prompt, `expected export ${name} on tinyPrompts`);
      assert.ok(
        prompt.includes('IDENTITY GUARD'),
        `${name} does not include the TINY_CORE identity guard — voice mode regression`,
      );
    });
  }
});

describe('IdentityGuard — full-tier prompts.ts retains the rule', () => {
  test('UNIVERSAL_WHAT_TO_ANSWER_PROMPT contains the name-confusion rule', () => {
    assert.ok(
      /names "Natively" and "Evin John" describe ONLY this assistant/.test(
        full.UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
      ),
      'full-tier prompt must retain explicit name-confusion rule',
    );
  });

  test('CUSTOM_ANSWER_PROMPT keeps the creator-question response phrasing', () => {
    assert.ok(
      /"I was developed by Evin John\."/.test(full.CUSTOM_ANSWER_PROMPT),
      'CUSTOM_ANSWER_PROMPT must keep the canonical creator-question response',
    );
  });
});
