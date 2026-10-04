// Two coding-contract misroutes found by the external judge (2026-09-30).
//
// 1. In Recruiting the user runs the interview, so a heard turn is the
//    candidate talking. "I haven't written much production code lately" (bare
//    `code`) and a retry-storm story ending in "queue depth" (bare `queue`)
//    both planned as coding/DSA; the answers came back as advice to the
//    recruiter and were judged 7.0 and 7.5.
// 2. A bare `check if` was a coding-problem pattern, so a Call Center caller's
//    "can you check if my dog's okay?" took the coding contract.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { planAnswer, isCodingAnswerType } from '../../../dist-electron/electron/llm/AnswerPlanner.js';

const mode = (templateType) => ({ id: `m-${templateType}`, templateType, name: templateType, isCustom: false });
const live = (q, m) => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer', activeMode: mode(m) }).answerType;
const typed = (q, m) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user', activeMode: mode(m) }).answerType;

describe('a heard Recruiting turn is never a coding task', () => {
  const HEARD = [
    "I'll be upfront, I've been managing for the last two years and I haven't written much production code lately. Is that going to be an issue for this role?",
    "For the retry storm, the fix had three parts. Exponential backoff with jitter on the client, a per-carrier circuit breaker, and a cap on in-flight retries per merchant. The next time a carrier went down, our queue depth stayed flat and nobody got paged.",
  ];
  for (const q of HEARD) {
    test(q.slice(0, 60), () => {
      const t = live(q, 'recruiting');
      assert.equal(isCodingAnswerType(t), false, t);
      assert.equal(t, 'general_meeting_answer');
    });
  }
  test('an explicit coding ask heard aloud keeps its routing (W1-5 invariant)', () => {
    assert.equal(live('solve two sum in python', 'recruiting'), 'dsa_question_answer');
    assert.equal(isCodingAnswerType(live('write a function to reverse a linked list', 'recruiting')), true);
  });
  test('the same words keep their coding routing in the Technical interview', () => {
    assert.equal(isCodingAnswerType(live('Reverse a linked list in place.', 'technical-interview')), true);
    assert.equal(isCodingAnswerType(live('Can you write code to check if a number is odd or even?', 'technical-interview')), true);
  });
});

describe('"check if" is a coding problem only with a data object in reach', () => {
  test('a caller asking to check on their dog is not a coding task', () => {
    assert.equal(isCodingAnswerType(live("Can you log into my camera and check if my dog's okay? I'm stuck at work.", 'call-center')), false);
  });
  for (const q of ['check if a string is a palindrome', 'check if the array has a duplicate', 'check if two strings are anagrams', 'Can you write code to check if a number is odd or even?']) {
    test(`still coding: ${q}`, () => assert.equal(isCodingAnswerType(live(q, 'technical-interview')), true));
  }
});

describe('typed Recruiting requests are untouched by the live rule', () => {
  test('manual input routes as before', () => {
    assert.equal(typed('Give me a coding question to ask about linked lists', 'recruiting'), 'general_meeting_answer');
  });
});
