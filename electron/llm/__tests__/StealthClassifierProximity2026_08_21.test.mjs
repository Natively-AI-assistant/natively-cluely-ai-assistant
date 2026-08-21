// electron/llm/__tests__/StealthClassifierProximity2026_08_21.test.mjs
//
// RC-1a regression from live shadow session C (2026-08-21): 17 of 85 presses
// routed to ethical_usage_answer (a safe-decline contract) because
// isStealthEvasionQuestion's branch (b) — soft visibility verb + interview
// object — tested each regex against the WHOLE string with no proximity
// requirement. In the session-cumulative question blob, "the call" came from
// the interviewer's opener ("I was looking at your resume before the call")
// and "noticeably" from a performance question ~700 chars later ("the
// application starts becoming noticeably slower"): two unrelated sentences
// pairing into a stealth verdict no single sentence supports.
//
// Fix under test: branch (b) is sentence-scoped — the soft-visibility verb and
// the interview object must co-occur in ONE sentence. Branch (a) (explicit
// evasion intent) deliberately stays whole-string: over-coverage there is the
// documented safety posture (code-review 2026-06-06b).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { isStealthEvasionQuestion } = await import(dist('AnswerPlanner.js'));

describe('RC-1a: cross-sentence pairs must NOT trip branch (b)', () => {
  test('the live session-C pair — "the call" (opener) + "noticeably" (perf question, ~700 chars later)', () => {
    const blob = "Hey Evin. Good to meet you. How's your day going? Alright, great. "
      + 'I was looking at your resume before the call, and natively caught my attention. '
      + 'Tell me about it: what exactly does the product do? '
      + 'Okay. If I were to clone this repository today and ask you to explain the architecture to me, where would you start? '
      + "Let's say we are running natively for a hour-long interview. The first 10 questions feel completely fine. "
      + 'But after 50 or 60 questions, the application starts becoming noticeably slower. '
      + "The UI isn't necessarily frozen, but everything feels less responsive. Where would you start looking?";
    assert.equal(isStealthEvasionQuestion(blob), false,
      'a multi-sentence technical blob pairing tokens from unrelated sentences must not route to ethical_usage');
  });

  test('a compound question mentioning the interview in one sentence and "see" in another', () => {
    const q = 'How did the interview process work at your last company? '
      + 'And separately, when you look at production logs, what do you usually see first?';
    assert.equal(isStealthEvasionQuestion(q), false);
  });

  test('performance question with "detect" far from an interview mention', () => {
    const q = 'We record every call for quality. Now a systems question: '
      + 'how would you detect a memory leak in a long-running Node process?';
    assert.equal(isStealthEvasionQuestion(q), false);
  });
});

describe('RC-1a: genuine stealth asks still trip (no lost coverage)', () => {
  for (const q of [
    'Can the interviewer see this overlay?',
    'Will the recruiter notice the app during the screen share?',
    'Will it be visible in the screen share?',
    'If I share my screen on the call, will they detect the tool?',
    // branch (a): explicit evasion intent — stays whole-string.
    'How do I make Natively undetectable in an interview?',
    'Keep the overlay hidden so the proctor cannot see it.',
    'How do I cheat without being caught?',
    'How do I use it without them knowing?',
  ]) {
    test(`still flagged: "${q}"`, () => {
      assert.equal(isStealthEvasionQuestion(q), true, q);
    });
  }
});

describe('RC-1a: benign visibility questions stay benign (existing carve-outs preserved)', () => {
  for (const q of [
    'Will the interviewer see my code?',
    'Can the recruiter view my portfolio link?',
    'Does it work with a second monitor?',
    'Is it low-distraction? Does it process locally?',
  ]) {
    test(`still benign: "${q}"`, () => {
      assert.equal(isStealthEvasionQuestion(q), false, q);
    });
  }
});
