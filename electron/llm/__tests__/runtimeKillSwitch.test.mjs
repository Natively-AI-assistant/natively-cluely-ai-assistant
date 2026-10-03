// electron/llm/__tests__/runtimeKillSwitch.test.mjs
//
// Unit tests for electron/llm/runtimeKillSwitch.ts (isKillSwitchFlagEnabled) —
// the shared, UNCACHED reader for default-ON kill-switch flags: an off-token in
// the env var disables, a settings value of exactly `false` disables, anything
// else is ON.
//
// SettingsManager is reached through its process-wide singleton slot
// (globalThis.__nativelySettingsManagerV1__), the same seam the services tests
// use, so no Electron app is needed. Env vars and that slot are saved and
// restored around every case.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/runtimeKillSwitch.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { isKillSwitchFlagEnabled } = require(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'runtimeKillSwitch.js'));

const ENV = 'NATIVELY_TEST_KILL_SWITCH_FLAG_UNIT';
const KEY = 'testKillSwitchFlagUnit';
const SLOT = '__nativelySettingsManagerV1__';

/**
 * Run `fn` with the env var set to `envValue` (undefined = unset) and the
 * settings singleton replaced. `settings` is a plain key/value object, a
 * function used as `get`, or null for "no settings singleton at all".
 */
function withState(envValue, settings, fn) {
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, ENV);
  const prevEnv = process.env[ENV];
  const hadSlot = Object.prototype.hasOwnProperty.call(globalThis, SLOT);
  const prevSlot = globalThis[SLOT];
  try {
    if (envValue === undefined) delete process.env[ENV]; else process.env[ENV] = envValue;
    if (settings === null) delete globalThis[SLOT];
    else globalThis[SLOT] = { get: typeof settings === 'function' ? settings : (k) => settings[k] };
    return fn();
  } finally {
    if (hadEnv) process.env[ENV] = prevEnv; else delete process.env[ENV];
    if (hadSlot) globalThis[SLOT] = prevSlot; else delete globalThis[SLOT];
  }
}

const read = (envValue, settings = {}) => withState(envValue, settings, () => isKillSwitchFlagEnabled(ENV, KEY));

describe('isKillSwitchFlagEnabled: env var', () => {
  test('unset env and no setting is ON', () => {
    assert.equal(read(undefined), true);
  });

  test('each off-token disables', () => {
    for (const v of ['off', 'false', '0', 'disabled']) assert.equal(read(v), false, v);
  });

  test('off-tokens are trimmed and case-insensitive', () => {
    for (const v of ['OFF', ' False ', '\tDISABLED\n', ' 0 ']) assert.equal(read(v), false, JSON.stringify(v));
  });

  test('on-ish, empty and unknown tokens stay ON', () => {
    for (const v of ['on', 'true', '1', 'enabled', '', '   ', 'no', 'offline', '00']) assert.equal(read(v), true, JSON.stringify(v));
  });

  test('an env off-token wins even when settings say true', () => {
    assert.equal(read('off', { [KEY]: true }), false);
  });

  test('the env read is not cached: flipping the var flips the answer', () => {
    assert.equal(read('off'), false);
    assert.equal(read(undefined), true);
    assert.equal(read('0'), false);
  });
});

describe('isKillSwitchFlagEnabled: settings', () => {
  test('a settings value of exactly false disables', () => {
    assert.equal(read(undefined, { [KEY]: false }), false);
  });

  test('settings false still disables when the env var holds a non-off token', () => {
    assert.equal(read('on', { [KEY]: false }), false);
  });

  test('only strict false disables: true, undefined, null, 0 and "false" stay ON', () => {
    for (const v of [true, undefined, null, 0, '', 'false', 'off']) {
      assert.equal(read(undefined, { [KEY]: v }), true, JSON.stringify(v));
    }
  });

  test('the given setting key is the one consulted', () => {
    const asked = [];
    const result = read(undefined, (k) => { asked.push(k); return undefined; });
    assert.equal(result, true);
    assert.deepEqual(asked, [KEY]);
  });

  test('a different key being false does not disable this flag', () => {
    assert.equal(read(undefined, { someOtherFlag: false }), true);
  });

  test('a settings store that throws defaults ON', () => {
    assert.equal(read(undefined, () => { throw new Error('settings exploded'); }), true);
  });

  test('settings unavailable (no singleton, no Electron app) defaults ON', () => {
    assert.equal(read(undefined, null), true);
  });

  test('settings are not consulted when the env already disabled the flag', () => {
    let calls = 0;
    assert.equal(read('disabled', () => { calls++; return true; }), false);
    assert.equal(calls, 0);
  });
});

describe('isKillSwitchFlagEnabled: independent flags', () => {
  test('one env var being off does not affect a different flag', () => {
    const other = 'NATIVELY_TEST_KILL_SWITCH_OTHER_UNIT';
    const hadOther = Object.prototype.hasOwnProperty.call(process.env, other);
    const prevOther = process.env[other];
    try {
      delete process.env[other];
      withState('off', {}, () => {
        assert.equal(isKillSwitchFlagEnabled(ENV, KEY), false);
        assert.equal(isKillSwitchFlagEnabled(other, 'otherKey'), true);
      });
    } finally {
      if (hadOther) process.env[other] = prevOther; else delete process.env[other];
    }
  });
});
