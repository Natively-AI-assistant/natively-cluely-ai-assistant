// electron/llm/__tests__/HumanizedInterviewVoice2026_06_15.test.mjs
//
// Property tests for the HUMAN_SPOKEN_ANSWER_CONTRACT (task Phase 2 + 9): the spoken
// candidate/seller mode prompts must carry the human-voice contract (corporate-filler
// ban + spoken shape), and the non-spoken surfaces must NOT (so lecture notes / recaps /
// code-only / JSON / diagrams keep their structure).
//
// These assert STRUCTURAL properties of the prompt strings (which contract is composed
// where), never an exact answer — anti-hardcoding compliant.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as prompts from '../../../dist-electron/electron/llm/prompts.js';

const CONTRACT_MARK = '<human_spoken_answer_contract>';

// The corporate phrases the contract must explicitly name as banned.
const BANNED_NAMED = [
  'unique blend', 'technical rigor', 'data-driven mindset', 'actionable insights',
  'business objectives', 'proven track record', 'move the needle', 'bridge the gap',
];

describe('HUMAN_SPOKEN_ANSWER_CONTRACT — content', () => {
  test('exists and names the banned corporate phrases', () => {
    const c = prompts.HUMAN_SPOKEN_ANSWER_CONTRACT;
    assert.ok(typeof c === 'string' && c.length > 200);
    for (const phrase of BANNED_NAMED) {
      assert.ok(c.toLowerCase().includes(phrase), `contract must name "${phrase}"`);
    }
  });

  test('mandates first person + plain speech + no source narration', () => {
    const c = prompts.HUMAN_SPOKEN_ANSWER_CONTRACT.toLowerCase();
    assert.ok(c.includes('first person'));
    assert.ok(c.includes('2-4 sentences') || c.includes('2-4'));
    assert.ok(c.includes('based on my resume') || c.includes('according to the jd') || c.includes('the candidate'));
  });

  test('gives plain-speech rewrites, not question→answer maps (style-only)', () => {
    const c = prompts.HUMAN_SPOKEN_ANSWER_CONTRACT;
    assert.ok(c.includes('what the team is trying to improve')); // business objectives →
    // It must NOT encode any profile fact, company, or role.
    assert.doesNotMatch(c, /\bEvin\b|\bNatively\b.*built with|resume says/i);
  });
});

describe('spoken candidate/seller modes COMPOSE the contract', () => {
  const SPOKEN = [
    'MODE_LOOKING_FOR_WORK_PROMPT',
    'WHAT_TO_ANSWER_PROMPT',
    'ANSWER_MODE_PROMPT',
    'MODE_SALES_PROMPT',
    'MODE_TECHNICAL_INTERVIEW_PROMPT',
    'GROQ_SYSTEM_PROMPT',
    'GROQ_WHAT_TO_ANSWER_PROMPT',
    'CUSTOM_SYSTEM_PROMPT',
    'CUSTOM_WHAT_TO_ANSWER_PROMPT',
  ];
  for (const name of SPOKEN) {
    test(`${name} includes the contract`, () => {
      const p = prompts[name];
      assert.ok(p, `expected export ${name}`);
      assert.ok(p.includes(CONTRACT_MARK), `${name} must compose HUMAN_SPOKEN_ANSWER_CONTRACT`);
    });
  }
});

describe('non-spoken / structured surfaces do NOT compose the contract', () => {
  // Lecture, recap, summary-JSON, follow-up-questions, and email surfaces must keep
  // their own structure and must not inherit the spoken-voice ban.
  const NON_SPOKEN = [
    'MODE_LECTURE_PROMPT',
    'MODE_RECRUITING_PROMPT',     // third-person observer, not the candidate's voice
    'MODE_TEAM_MEET_PROMPT',      // capture format
    'FOLLOW_UP_QUESTIONS_MODE_PROMPT',
    'GROQ_RECAP_PROMPT',
    'GROQ_SUMMARY_JSON_PROMPT',
    'UNIVERSAL_RECAP_PROMPT',
  ];
  for (const name of NON_SPOKEN) {
    test(`${name} does NOT include the contract`, () => {
      const p = prompts[name];
      assert.ok(p, `expected export ${name}`);
      assert.ok(!p.includes(CONTRACT_MARK), `${name} must NOT carry the spoken contract`);
    });
  }
});

describe('mode-prefix dedup invariant is preserved (no token-doubling regression)', () => {
  // The contract was injected AFTER the shared prefix, so the dedup startsWith() check
  // must still hold for every mode template.
  const COMPOSED = {
    'looking-for-work': prompts.MODE_LOOKING_FOR_WORK_PROMPT,
    sales: prompts.MODE_SALES_PROMPT,
    'technical-interview': prompts.MODE_TECHNICAL_INTERVIEW_PROMPT,
  };
  for (const [mode, p] of Object.entries(COMPOSED)) {
    test(`${mode} still starts with a shared prefix`, () => {
      assert.ok(
        p.startsWith(prompts.SHARED_MODE_PREFIX) || p.startsWith(prompts.SHARED_MODE_PREFIX_SHORT),
        `${mode} must still begin with a shared prefix so token dedup works`,
      );
    });
    test(`${mode} carries the contract exactly once`, () => {
      assert.equal((p.match(/<human_spoken_answer_contract>/g) || []).length, 1);
    });
  }
});
