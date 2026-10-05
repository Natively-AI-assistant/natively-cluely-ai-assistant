// electron/llm/__tests__/SteeringTail2026_08_23.test.mjs
//
// Live session D (2026-08-23), press 1: interviewer said "Hey Even, good to
// meet you." and the suggested reply ended "…Where would you like to start?"
// — a ChatGPT-style HOST closer. The other side runs an interview; greet or
// answer, then stop.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { isSmallTalkTurn, stripSteeringTail } = await import(dist('steeringTail.js'));

describe('isSmallTalkTurn', () => {
  for (const q of [
    'Hey Even, good to meet you.',      // the live turn (STT misheard the name)
    'Nice to meet you!',
    'Good morning.',
    "How's your day going?",
    'How was the commute?',
  ]) {
    test(`small talk: "${q}"`, () => assert.equal(isSmallTalkTurn(q), true, q));
  }

  for (const q of [
    "Okay. So what's a semaphore?",
    'Walk me through the RedisMart architecture end to end.',
    'Hey, before we start, can you explain how your audio capture pipeline handles device switching on macOS?', // >12 words: substantive despite the "Hey"
    '',
  ]) {
    test(`not small talk: "${q.slice(0, 50)}"`, () => assert.equal(isSmallTalkTurn(q), false, q));
  }
});

describe('stripSteeringTail', () => {
  test('the live D press-1 reply loses its closer and nothing else', () => {
    const r = stripSteeringTail('Hey, great to meet you too. Thanks for taking the time to chat today. Where would you like to start?');
    assert.equal(r.repaired, true);
    assert.equal(r.text, 'Hey, great to meet you too. Thanks for taking the time to chat today.');
  });

  for (const tail of [
    'What would you like to cover first?',
    'How can I help you today?',
    'Shall we dive in?',
    "So, what's on your agenda?",
    'Anything specific you would like me to start with?',
  ]) {
    test(`strips: "${tail}"`, () => {
      const r = stripSteeringTail(`Good to meet you too. ${tail}`);
      assert.equal(r.repaired, true);
      assert.equal(r.text, 'Good to meet you too.');
    });
  }

  test('a reply that IS only the steering question fails open', () => {
    const r = stripSteeringTail('Where would you like to start?');
    assert.equal(r.repaired, false);
  });

  test('a legitimate trailing question survives (not a steering shape)', () => {
    const r = stripSteeringTail("Doing well, thanks. And yourself — how's your week been?");
    assert.equal(r.repaired, false);
  });

  test('a trailing [[GIST]] line no longer shields the closer (code-review 2026-08-23)', () => {
    const r = stripSteeringTail('Hey, great to meet you too. Thanks for the time. Where would you like to start?\n[[GIST]] Greeting back');
    assert.equal(r.repaired, true);
    assert.doesNotMatch(r.text, /Where would you like to start\?/);
    // the gist is reattached on its OWN line so splitGistLine still honors it
    assert.match(r.text, /\n\[\[GIST\]\] Greeting back$/);
    assert.match(r.text, /^Hey, great to meet you too\. Thanks for the time\.\n/);
  });

  test('a gist-carrying reply with NO closer is returned untouched', () => {
    const original = 'Doing well, thanks for asking.\n[[GIST]] Doing well';
    const r = stripSteeringTail(original);
    assert.equal(r.repaired, false);
    assert.equal(r.text, original);
  });

  test('two stacked closers both go', () => {
    const r = stripSteeringTail('Great to meet you too. How can I help you today? Where would you like to start?');
    assert.equal(r.repaired, true);
    assert.equal(r.text, 'Great to meet you too.');
  });
});
