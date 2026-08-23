// electron/services/__tests__/AnswerFragmentTitle2026_08_21.test.mjs
//
// RC-7 adjacent (live session C, 2026-08-21): the title generator returned
// ANSWERS, not names — cleanMeetingTitle clamped them to first-sentence
// fragments and they were saved as meeting titles. Live rows:
//   402 chars -> "Here's the C++ implementation"
//   294 chars -> "cpp"
//   185 chars -> "I'm sorry, but I don't have the full"
//    60 chars -> "Return [0, 1] for the two numbers that"
// isAnswerFragmentTitle rejects those shapes; MeetingPersistence keeps the
// default title instead (the structured V3 summary title updates it later,
// and a user rename outranks both via user_titled).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { isAnswerFragmentTitle, isAnswerShapedGeneration } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/meeting/MeetingSummaryV3.js')).href);

describe('answer-shaped generated titles are rejected', () => {
  for (const t of [
    "Here's the C++ implementation",
    'cpp',
    "I'm sorry, but I don't have the full",
    'Return [0, 1] for the two numbers that',
    'Sorry, I need the full question',
    "I don't have the actual question here",
    'Okay, so the main idea is',
    'The two-pointer approach solves this in O(n) time',
    // Session E live misses (2026-08-23): first-person answer speech, a
    // "<language> code …" description, a mid-word truncation fragment, and
    // Malayalam answer sentences (first/second-person pronouns) — none are
    // meeting names.
    "I'll switch the solution to C++",
    'Python code also uses the same backtracking approach',
    'ral backend for every keystroke',
    'ഞാൻ ഇംഗ്ലീഷിൽ സംസാരിക്കാൻ വന്നതാണ്, പക്ഷേ നിങ്ങൾ മലയാളത്തിൽ',
    'നിങ്ങൾ ചോദിക്കുന്നത് എന്താണെന്ന് വ്യക്തമല്ല',
  ]) {
    test(`rejected: "${t}"`, () => assert.equal(isAnswerFragmentTitle(t), true, t));
  }
});

describe('legitimate titles pass', () => {
  for (const t of [
    'Technical Interview — Round 2',
    'Standup',
    'Sync with Dr. Patel',
    'Rate Limiter Design Discussion',
    'Q3 Planning',
    'Tragic Kingdom Retro', // capitalized multi-word stays
    "Sam's 1:1",
    'iOS Migration Kickoff',
    'Backtracking Deep-Dive',
  ]) {
    test(`kept: "${t}"`, () => assert.equal(isAnswerFragmentTitle(t), false, t));
  }
});

describe('mixed-script titles are not judged by the Latin case rule (code-review 2026-08-23)', () => {
  test("'പ്രോജക്ട് sync review' is a legitimate title and is kept", () => {
    assert.equal(isAnswerFragmentTitle('പ്രോജക്ട് sync review'), false);
  });
});

describe('isAnswerShapedGeneration (source-shape catch-all, code-review 2026-08-23)', () => {
  test('a fence-wrapped 450-char answer is caught (the raw-first-line check measured "```" = 3 chars)', () => {
    const prose = 'The renderer talks to a neural backend for every keystroke and '.repeat(8);
    assert.equal(isAnswerShapedGeneration('```\n' + prose + '\n```'), true);
  });

  test('a bare long prose line is caught', () => {
    assert.equal(isAnswerShapedGeneration('x'.repeat(250)), true);
  });

  test('a short title with reasoning underneath passes', () => {
    assert.equal(isAnswerShapedGeneration('Rate Limiter Deep-Dive\n\nI chose this because the discussion centered on sliding windows and token buckets for most of the hour.'), false);
  });

  test('a [[GIST]]-tailed short title passes', () => {
    assert.equal(isAnswerShapedGeneration('Q3 Planning\n[[GIST]] quarterly goals'), false);
  });
});

describe('MeetingPersistence wires the rejection (drift pin)', () => {
  test('the call site consults isAnswerFragmentTitle before applying a generated title', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../MeetingPersistence.ts'), 'utf8');
    assert.match(src, /isAnswerFragmentTitle\(cleanedTitle\) \|\| isAnswerShapedGeneration\(generatedTitle\)/);
    assert.match(src, /Generated title rejected as answer fragment/);
  });
});
