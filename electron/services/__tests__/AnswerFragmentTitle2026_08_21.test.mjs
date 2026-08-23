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
const { isAnswerFragmentTitle } = await import(pathToFileURL(
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
  ]) {
    test(`kept: "${t}"`, () => assert.equal(isAnswerFragmentTitle(t), false, t));
  }
});

describe('MeetingPersistence wires the rejection (drift pin)', () => {
  test('the call site consults isAnswerFragmentTitle before applying a generated title', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../MeetingPersistence.ts'), 'utf8');
    assert.match(src, /isAnswerFragmentTitle\(cleanedTitle\)/);
    assert.match(src, /Generated title rejected as answer fragment/);
  });
});
