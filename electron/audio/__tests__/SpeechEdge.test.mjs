// Unit tests for electron/audio/speechEdge.ts — normalizeSpeechEdge(), the
// defensive normaliser for the native 'speech_edge' payload (must never throw
// on a malformed object).
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
// Run from the repo root:
//   node --test electron/audio/__tests__/SpeechEdge.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { normalizeSpeechEdge } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'speechEdge.js'),
);

const FIXED_NOW = 1_700_000_000_000;

/** A fully valid payload; override individual fields per test. */
function edge(overrides = {}) {
  return {
    channel: 'interviewer',
    speaking: true,
    joint: 'interviewer_speaking',
    atMs: 1234567,
    msSinceOtherEdge: 250,
    userEdgesVadBacked: true,
    ...overrides,
  };
}

describe('normalizeSpeechEdge — valid payloads', () => {
  test('a well-formed interviewer edge passes through unchanged', () => {
    assert.deepEqual(normalizeSpeechEdge(edge()), {
      channel: 'interviewer',
      speaking: true,
      joint: 'interviewer_speaking',
      atMs: 1234567,
      msSinceOtherEdge: 250,
      userEdgesVadBacked: true,
    });
  });

  test('a well-formed user edge passes through unchanged', () => {
    const raw = edge({
      channel: 'user', speaking: false, joint: 'neither', msSinceOtherEdge: -1, userEdgesVadBacked: false,
    });
    assert.deepEqual(normalizeSpeechEdge(raw), {
      channel: 'user',
      speaking: false,
      joint: 'neither',
      atMs: 1234567,
      msSinceOtherEdge: -1,
      userEdgesVadBacked: false,
    });
  });

  test('returns a new object with exactly the six known fields', () => {
    const raw = edge({ extra: 'dropped', nested: { a: 1 } });
    const out = normalizeSpeechEdge(raw);
    assert.notEqual(out, raw);
    assert.deepEqual(Object.keys(out).sort(), [
      'atMs', 'channel', 'joint', 'msSinceOtherEdge', 'speaking', 'userEdgesVadBacked',
    ]);
  });

  test('does not mutate the input', () => {
    const raw = edge({ joint: 'bogus', atMs: 'x' });
    const copy = { ...raw };
    normalizeSpeechEdge(raw);
    assert.deepEqual(raw, copy);
  });
});

describe('normalizeSpeechEdge — rejected payloads', () => {
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'interviewer'],
    ['a number', 42],
    ['zero', 0],
    ['a boolean', true],
    ['an empty object', {}],
    ['an array', ['user']],
    ['a function', () => {}],
  ]) {
    test(`${label} -> null`, () => {
      assert.equal(normalizeSpeechEdge(value), null);
    });
  }

  test('an unknown, missing or wrongly-typed channel -> null', () => {
    assert.equal(normalizeSpeechEdge(edge({ channel: 'system' })), null);
    assert.equal(normalizeSpeechEdge(edge({ channel: 'User' })), null);
    assert.equal(normalizeSpeechEdge(edge({ channel: '' })), null);
    assert.equal(normalizeSpeechEdge(edge({ channel: null })), null);
    assert.equal(normalizeSpeechEdge(edge({ channel: 1 })), null);
    const noChannel = edge();
    delete noChannel.channel;
    assert.equal(normalizeSpeechEdge(noChannel), null);
  });
});

describe('normalizeSpeechEdge — joint state', () => {
  for (const joint of ['neither', 'interviewer_speaking', 'user_speaking', 'both']) {
    test(`'${joint}' is kept`, () => {
      assert.equal(normalizeSpeechEdge(edge({ joint })).joint, joint);
    });
  }

  test("anything else falls back to 'neither'", () => {
    for (const joint of ['BOTH', 'speaking', '', null, undefined, 3, {}, true]) {
      assert.equal(normalizeSpeechEdge(edge({ joint })).joint, 'neither');
    }
    const noJoint = edge();
    delete noJoint.joint;
    assert.equal(normalizeSpeechEdge(noJoint).joint, 'neither');
  });
});

describe('normalizeSpeechEdge — speaking', () => {
  test('is coerced to a strict boolean', () => {
    assert.equal(normalizeSpeechEdge(edge({ speaking: true })).speaking, true);
    assert.equal(normalizeSpeechEdge(edge({ speaking: false })).speaking, false);
    assert.equal(normalizeSpeechEdge(edge({ speaking: 1 })).speaking, true);
    assert.equal(normalizeSpeechEdge(edge({ speaking: 0 })).speaking, false);
    assert.equal(normalizeSpeechEdge(edge({ speaking: null })).speaking, false);
    assert.equal(normalizeSpeechEdge(edge({ speaking: undefined })).speaking, false);
  });
});

describe('normalizeSpeechEdge — atMs', () => {
  test('finite numbers are kept, including 0 and fractions', () => {
    assert.equal(normalizeSpeechEdge(edge({ atMs: 0 })).atMs, 0);
    assert.equal(normalizeSpeechEdge(edge({ atMs: 1700000000123 })).atMs, 1700000000123);
    assert.equal(normalizeSpeechEdge(edge({ atMs: 12.5 })).atMs, 12.5);
  });

  test('missing or non-finite values fall back to Date.now()', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW);
    for (const atMs of [undefined, null, NaN, Infinity, -Infinity, '1234', {}, true]) {
      assert.equal(normalizeSpeechEdge(edge({ atMs })).atMs, FIXED_NOW, `atMs=${String(atMs)}`);
    }
    const noAt = edge();
    delete noAt.atMs;
    assert.equal(normalizeSpeechEdge(noAt).atMs, FIXED_NOW);
  });
});

describe('normalizeSpeechEdge — msSinceOtherEdge', () => {
  test('finite numbers are kept, including 0 and the -1 sentinel', () => {
    assert.equal(normalizeSpeechEdge(edge({ msSinceOtherEdge: 0 })).msSinceOtherEdge, 0);
    assert.equal(normalizeSpeechEdge(edge({ msSinceOtherEdge: -1 })).msSinceOtherEdge, -1);
    assert.equal(normalizeSpeechEdge(edge({ msSinceOtherEdge: 987.5 })).msSinceOtherEdge, 987.5);
  });

  test('missing or non-finite values fall back to -1', () => {
    for (const msSinceOtherEdge of [undefined, null, NaN, Infinity, '250', {}, false]) {
      assert.equal(normalizeSpeechEdge(edge({ msSinceOtherEdge })).msSinceOtherEdge, -1);
    }
    const missing = edge();
    delete missing.msSinceOtherEdge;
    assert.equal(normalizeSpeechEdge(missing).msSinceOtherEdge, -1);
  });
});

describe('normalizeSpeechEdge — userEdgesVadBacked', () => {
  test('only an explicit false disables it', () => {
    assert.equal(normalizeSpeechEdge(edge({ userEdgesVadBacked: false })).userEdgesVadBacked, false);
    assert.equal(normalizeSpeechEdge(edge({ userEdgesVadBacked: true })).userEdgesVadBacked, true);
    for (const v of [undefined, null, 0, '', 'false']) {
      assert.equal(normalizeSpeechEdge(edge({ userEdgesVadBacked: v })).userEdgesVadBacked, true);
    }
    const missing = edge();
    delete missing.userEdgesVadBacked;
    assert.equal(normalizeSpeechEdge(missing).userEdgesVadBacked, true);
  });
});

describe('normalizeSpeechEdge — minimal payload', () => {
  test('only a valid channel is required; everything else gets a safe default', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW);
    assert.deepEqual(normalizeSpeechEdge({ channel: 'user' }), {
      channel: 'user',
      speaking: false,
      joint: 'neither',
      atMs: FIXED_NOW,
      msSinceOtherEdge: -1,
      userEdgesVadBacked: true,
    });
  });

  test('accepts a null-prototype object', () => {
    const raw = Object.assign(Object.create(null), edge({ channel: 'user' }));
    assert.equal(normalizeSpeechEdge(raw).channel, 'user');
  });
});
