// electron/llm/__tests__/TemporalContextBuilder.test.mjs
//
// Unit tests for electron/llm/TemporalContextBuilder.ts — the temporal context
// used by "What should I say?" (transcript window, previous responses for
// anti-repetition, role context, tone signals) and its prompt formatter.
//
// buildTemporalContext reads Date.now() internally, so the Date clock is pinned
// with node:test mock timers; nothing here depends on the real time or zone.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/TemporalContextBuilder.test.mjs

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { buildTemporalContext, formatTemporalContextForPrompt } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'TemporalContextBuilder.js'),
);

const NOW = 1_750_000_000_000;
const ago = (seconds) => NOW - seconds * 1000;
const item = (role, text, secondsAgo = 10) => ({ role, text, timestamp: ago(secondsAgo) });
const resp = (text, secondsAgo = 10) => ({ text, timestamp: ago(secondsAgo), questionContext: 'q' });

beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: NOW }); });
afterEach(() => { mock.timers.reset(); });

describe('buildTemporalContext: empty input', () => {
  test('no items and no history yields an empty, general context', () => {
    assert.deepEqual(buildTemporalContext([], []), {
      recentTranscript: '',
      previousResponses: [],
      roleContext: 'general',
      toneSignals: [],
      hasRecentResponses: false,
    });
  });
});

describe('buildTemporalContext: time window', () => {
  test('default window is 180s and the cutoff is inclusive', () => {
    const ctx = buildTemporalContext(
      [item('user', 'too old', 181), item('user', 'on the edge', 180), item('user', 'fresh', 1)],
      [resp('old answer', 181), resp('edge answer', 180)],
    );
    assert.equal(ctx.recentTranscript, '[ME]: on the edge\n[ME]: fresh');
    assert.deepEqual(ctx.previousResponses, ['edge answer']);
    assert.equal(ctx.hasRecentResponses, true);
  });

  test('a custom window narrows what is kept', () => {
    const ctx = buildTemporalContext(
      [item('interviewer', 'earlier', 60), item('interviewer', 'latest', 5)],
      [resp('earlier answer', 60)],
      30,
    );
    assert.equal(ctx.recentTranscript, '[INTERVIEWER – IMPORTANT]: latest');
    assert.deepEqual(ctx.previousResponses, []);
    assert.equal(ctx.hasRecentResponses, false);
  });

  test('a zero-second window keeps only items stamped at (or after) now', () => {
    const ctx = buildTemporalContext([item('user', 'now', 0), item('user', 'a second ago', 1)], [], 0);
    assert.equal(ctx.recentTranscript, '[ME]: now');
  });

  test('everything outside the window means general role and no history', () => {
    const ctx = buildTemporalContext([item('interviewer', 'stale', 500)], [resp('stale', 500)]);
    assert.equal(ctx.recentTranscript, '');
    assert.equal(ctx.roleContext, 'general');
    assert.equal(ctx.hasRecentResponses, false);
    assert.deepEqual(ctx.toneSignals, []);
  });
});

describe('buildTemporalContext: transcript formatting', () => {
  test('labels each role and joins turns with newlines, in input order', () => {
    const ctx = buildTemporalContext(
      [item('interviewer', 'Why us?', 30), item('assistant', 'Say X.', 20), item('user', 'Because X.', 10)],
      [],
    );
    assert.equal(
      ctx.recentTranscript,
      '[INTERVIEWER – IMPORTANT]: Why us?\n[ASSISTANT (MY PREVIOUS RESPONSE)]: Say X.\n[ME]: Because X.',
    );
  });
});

describe('buildTemporalContext: role context', () => {
  test('last non-assistant speaker is the interviewer', () => {
    const ctx = buildTemporalContext([item('user', 'a', 30), item('interviewer', 'b', 20), item('assistant', 'c', 10)], []);
    assert.equal(ctx.roleContext, 'responding_to_interviewer');
  });

  test('last non-assistant speaker is the user', () => {
    const ctx = buildTemporalContext([item('interviewer', 'a', 30), item('user', 'b', 20), item('assistant', 'c', 10)], []);
    assert.equal(ctx.roleContext, 'responding_to_user');
  });

  test('only assistant turns in the window is general', () => {
    assert.equal(buildTemporalContext([item('assistant', 'a')], []).roleContext, 'general');
  });

  test('only the last five items are considered', () => {
    const items = [item('interviewer', 'q', 60), ...[50, 40, 30, 20, 10].map((s) => item('assistant', 'a', s))];
    assert.equal(buildTemporalContext(items, []).roleContext, 'general');
    // With four assistant turns after it the interviewer is still inside the last five.
    assert.equal(buildTemporalContext(items.slice(0, 5), []).roleContext, 'responding_to_interviewer');
  });
});

describe('buildTemporalContext: previous responses', () => {
  test('keeps only the three most recent, oldest first', () => {
    const ctx = buildTemporalContext([], [resp('one', 40), resp('two', 30), resp('three', 20), resp('four', 10)]);
    assert.deepEqual(ctx.previousResponses, ['two', 'three', 'four']);
  });

  test('truncates past 200 chars with an ellipsis; exactly 200 is untouched', () => {
    const exact = 'a'.repeat(200);
    const long = 'b'.repeat(201);
    const ctx = buildTemporalContext([], [resp(exact), resp(long)]);
    assert.deepEqual(ctx.previousResponses, [exact, 'b'.repeat(200) + '...']);
  });
});

describe('buildTemporalContext: tone signals', () => {
  const tones = (...texts) => buildTemporalContext([], texts.map((t) => resp(t))).toneSignals;

  test('neutral text produces no signals', () => {
    assert.deepEqual(tones('The weather was fine and we went home.'), []);
  });

  test('technical needs more than two matches; confidence is matches/5', () => {
    assert.deepEqual(tones('The api talks to the database.'), []);
    assert.deepEqual(tones('The API calls a function that hits the database.'), [{ type: 'technical', confidence: 0.6 }]);
  });

  test('technical confidence is capped at 1', () => {
    assert.deepEqual(
      tones('implement architecture api function component module database algorithm'),
      [{ type: 'technical', confidence: 1 }],
    );
  });

  test('a fenced code block counts as a technical match', () => {
    assert.deepEqual(tones('Use the api function like ```x = 1```'), [{ type: 'technical', confidence: 0.6 }]);
  });

  test('formal needs more than one match; confidence is matches/3', () => {
    assert.deepEqual(tones('Therefore we shipped.'), []);
    assert.deepEqual(tones('Therefore we shipped. I would recommend caution.'), [{ type: 'formal', confidence: 2 / 3 }]);
  });

  test('casual needs more than one match', () => {
    assert.deepEqual(tones('Honestly it was fine.'), []);
    assert.deepEqual(tones('Honestly, it was pretty much done, you know.'), [{ type: 'casual', confidence: 1 }]);
  });

  test('conversational needs more than one match', () => {
    assert.deepEqual(tones('Good question.'), []);
    assert.deepEqual(tones("Good question. I think it depends."), [{ type: 'conversational', confidence: 2 / 3 }]);
  });

  test('matches are counted across all recent responses, in a fixed type order', () => {
    const signals = tones('The API and the database.', 'Honestly an algorithm.', 'Actually, I think so; let me explain.');
    assert.deepEqual(signals, [
      { type: 'technical', confidence: 0.6 },
      { type: 'casual', confidence: 2 / 3 },
      { type: 'conversational', confidence: 2 / 3 },
    ]);
  });

  test('responses outside the window do not contribute tone', () => {
    const ctx = buildTemporalContext([], [resp('api function database algorithm module', 600)]);
    assert.deepEqual(ctx.toneSignals, []);
  });
});

describe('formatTemporalContextForPrompt', () => {
  const empty = () => ({ recentTranscript: '', previousResponses: [], roleContext: 'general', toneSignals: [], hasRecentResponses: false });

  test('nothing to say yields an empty string', () => {
    assert.equal(formatTemporalContextForPrompt(empty()), '');
  });

  test('numbers previous responses inside their wrapper tag', () => {
    const out = formatTemporalContextForPrompt({ ...empty(), previousResponses: ['first', 'second'] });
    assert.equal(
      out,
      '<previous_responses_to_avoid_repeating>\nResponse 1: "first"\nResponse 2: "second"\n</previous_responses_to_avoid_repeating>',
    );
  });

  test('tone guidance names the highest-confidence signal', () => {
    const out = formatTemporalContextForPrompt({
      ...empty(),
      toneSignals: [{ type: 'casual', confidence: 0.4 }, { type: 'technical', confidence: 0.9 }, { type: 'formal', confidence: 0.7 }],
    });
    assert.equal(out, '<tone_guidance>Maintain technical tone to stay consistent with your previous responses.</tone_guidance>');
  });

  test('role context: interviewer and user wording, general omitted', () => {
    assert.equal(
      formatTemporalContextForPrompt({ ...empty(), roleContext: 'responding_to_interviewer' }),
      "<role_context>You are responding to the interviewer's question.</role_context>",
    );
    assert.equal(
      formatTemporalContextForPrompt({ ...empty(), roleContext: 'responding_to_user' }),
      '<role_context>You are helping the user formulate their response.</role_context>',
    );
  });

  test('sections appear in order: previous responses, tone, role', () => {
    const lines = formatTemporalContextForPrompt({
      ...empty(),
      previousResponses: ['x'],
      toneSignals: [{ type: 'formal', confidence: 1 }],
      roleContext: 'responding_to_user',
    }).split('\n');
    assert.equal(lines.length, 5);
    assert.equal(lines[0], '<previous_responses_to_avoid_repeating>');
    assert.equal(lines[2], '</previous_responses_to_avoid_repeating>');
    assert.match(lines[3], /^<tone_guidance>Maintain formal tone/);
    assert.match(lines[4], /^<role_context>/);
  });

  test('end to end: a built context formats into all three sections', () => {
    const ctx = buildTemporalContext(
      [item('interviewer', 'How would you design it?', 20)],
      [resp('I would put an API in front of the database and add a caching module.', 15)],
    );
    const out = formatTemporalContextForPrompt(ctx);
    assert.match(out, /Response 1: "I would put an API in front of the database and add a caching module\."/);
    assert.match(out, /Maintain technical tone/);
    assert.match(out, /responding to the interviewer/);
  });
});
