// #741: an interviewer stated a design problem over five finals and closed with
// "So where would you start?". Recency made the closer alone the question, so
// the turn routed general_meeting_answer (40-60 words, 75-word ceiling) and
// never got the design route or its diagram contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { extractLatestQuestion, planAnswer } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href);

const at = (turns) => turns.map(([role, text, t]) => ({ role, text, timestamp: t }));
const DESIGN = [
  ['interviewer', "So I'd like you to design the notification delivery service, the part that takes those requests and gets them to people's phones and inboxes.", 0],
  ['interviewer', 'It needs to send push, SMS and email, and users can set preferences per channel.', 9_000],
  ['interviewer', "We're talking about fifty million notifications a day, with big marketing campaigns on top.", 18_000],
  ['interviewer', 'And a password reset has to arrive within a few seconds.', 27_000],
  ['interviewer', 'So where would you start?', 35_320],
];

describe('a generic closer is joined to the stated ask', () => {
  test('the sim p22 turn: the whole ask becomes the question and routes to system design', () => {
    const r = extractLatestQuestion(at([['user', 'Sure, I would cache it.', -20_000], ...DESIGN]));
    assert.match(r.latestQuestion, /^So I'd like you to design the notification delivery service/);
    assert.match(r.latestQuestion, /password reset/);
    assert.match(r.latestQuestion, /So where would you start\?$/);
    const plan = planAnswer({ question: r.latestQuestion, source: 'transcript', speakerPerspective: 'interviewer' });
    assert.equal(plan.answerType, 'system_design_answer');
  });

  for (const closer of ['How would you approach this?', 'Thoughts?', 'Okay, where do we begin?', "What's your first step?", 'so how would you go about it']) {
    test(`closer "${closer}" joins an imperative ask`, () => {
      const r = extractLatestQuestion(at([
        ['interviewer', 'Design a rate limiter for our public API.', 0],
        ['interviewer', 'It has to work across twenty regions.', 6_000],
        ['interviewer', closer, 10_000],
      ]));
      assert.match(r.latestQuestion, /rate limiter/);
      assert.match(r.latestQuestion, /twenty regions/);
    });
  }
});

describe('nothing else is joined', () => {
  test('a candidate turn in between ends the run', () => {
    const r = extractLatestQuestion(at([
      DESIGN[0],
      ['user', 'Okay, so push, SMS and email?', 5_000],
      ['interviewer', 'So where would you start?', 9_000],
    ]));
    assert.equal(r.latestQuestion, 'So where would you start?');
  });

  test('an ask more than 60s before the closer is not joined', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Design a URL shortener.', 0],
      ['interviewer', 'So where would you start?', 75_000],
    ]));
    assert.equal(r.latestQuestion, 'So where would you start?');
  });

  test('a closer after statements with no ask stays on its own', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Our team builds payment infrastructure at scale.', 0],
      ['interviewer', 'We mostly use Go and Postgres.', 5_000],
      ['interviewer', 'So where would you start?', 9_000],
    ]));
    assert.equal(r.latestQuestion, 'So where would you start?');
  });

  test('a question with its own subject is never a closer', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Design a URL shortener.', 0],
      ['interviewer', 'How would you store the mappings?', 8_000],
    ]));
    assert.equal(r.latestQuestion, 'How would you store the mappings?');
  });
});
