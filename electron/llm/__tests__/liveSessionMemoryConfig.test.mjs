// electron/llm/__tests__/liveSessionMemoryConfig.test.mjs
//
// Unit tests for electron/llm/liveSessionMemoryConfig.ts — the feature flag and
// rollout decision for live SessionMemory: kill switch > env override >
// settings opt-in > internal context > percentage rollout > default ON, plus
// the deterministic session bucket and the max-items / debug readers.
//
// Every case runs with ALL of the module's env vars cleared and then set to
// exactly what the case needs, the module's cached env read reset, and the
// SettingsManager singleton slot (globalThis.__nativelySettingsManagerV1__)
// replaced by a plain stub; everything is restored afterwards.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/liveSessionMemoryConfig.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mod = require(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'liveSessionMemoryConfig.js'));
const {
  sessionBucket,
  resolveLiveSessionMemoryConfig,
  isLiveSessionMemoryEnabled,
  liveSessionMemoryMaxItems,
  liveSessionMemoryDebug,
  __resetLiveSessionMemoryCache,
} = mod;

const SLOT = '__nativelySettingsManagerV1__';
const E = {
  enable: 'NATIVELY_ENABLE_LIVE_SESSION_MEMORY',
  kill: 'NATIVELY_LIVE_SESSION_MEMORY_KILL_SWITCH',
  pct: 'NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT',
  max: 'NATIVELY_SESSION_MEMORY_MAX_ITEMS',
  debug: 'NATIVELY_SESSION_MEMORY_DEBUG',
  nodeEnv: 'NODE_ENV',
  bench: 'BENCHMARK_MODEL',
  internal: 'NATIVELY_INTERNAL',
  dev: 'NATIVELY_DEV',
};
const ALL_ENV = Object.values(E);

/**
 * Run `fn` in a clean production-like environment: every env var this module
 * reads is unset except those in `env`, and settings come from `settings`
 * (a key/value object, a `get` function, or null for no singleton).
 */
function withState({ env = {}, settings = {} } = {}, fn) {
  const saved = ALL_ENV.map((k) => [k, Object.prototype.hasOwnProperty.call(process.env, k), process.env[k]]);
  const hadSlot = Object.prototype.hasOwnProperty.call(globalThis, SLOT);
  const prevSlot = globalThis[SLOT];
  try {
    for (const k of ALL_ENV) delete process.env[k];
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    if (settings === null) delete globalThis[SLOT];
    else globalThis[SLOT] = { get: typeof settings === 'function' ? settings : (k) => settings[k] };
    __resetLiveSessionMemoryCache();
    return fn();
  } finally {
    for (const [k, had, v] of saved) { if (had) process.env[k] = v; else delete process.env[k]; }
    if (hadSlot) globalThis[SLOT] = prevSlot; else delete globalThis[SLOT];
    __resetLiveSessionMemoryCache();
  }
}

const resolve = (state, sessionId) => withState(state, () => resolveLiveSessionMemoryConfig(sessionId));

describe('sessionBucket', () => {
  test('matches FNV-1a (32-bit) mod 100 for published test vectors', () => {
    // FNV-1a 32: "a" -> 0xe40c292c, "foobar" -> 0xbf9cf968.
    assert.equal(sessionBucket('a'), 0xe40c292c % 100);
    assert.equal(sessionBucket('foobar'), 0xbf9cf968 % 100);
  });

  test('is stable for the same id and always an integer in 0..99', () => {
    for (let i = 0; i < 500; i++) {
      const id = `session-${i}`;
      const b = sessionBucket(id);
      assert.ok(Number.isInteger(b) && b >= 0 && b <= 99, `${id} -> ${b}`);
      assert.equal(sessionBucket(id), b);
    }
  });

  test('spreads ids over many buckets', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(sessionBucket(`session-${i}`));
    assert.ok(seen.size >= 90, `only ${seen.size} distinct buckets`);
  });

  test('null, undefined and empty id all share one consistent bucket', () => {
    const empty = sessionBucket('');
    assert.equal(sessionBucket(null), empty);
    assert.equal(sessionBucket(undefined), empty);
    assert.ok(Number.isInteger(empty) && empty >= 0 && empty <= 99);
  });

  test('non-string ids are stringified', () => {
    assert.equal(sessionBucket(12345), sessionBucket('12345'));
  });
});

describe('resolveLiveSessionMemoryConfig: precedence', () => {
  test('default (nothing set) is ON with reason default_on', () => {
    assert.deepEqual(resolve({}), {
      maxItems: 200,
      debugMarkersOnly: false,
      killSwitch: false,
      enabled: true,
      reason: 'default_on',
      rolloutPercent: null,
      bucket: null,
    });
  });

  test('settings unavailable entirely still resolves to default ON', () => {
    const cfg = resolve({ settings: null });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.reason, 'default_on');
    assert.equal(cfg.killSwitch, false);
  });

  test('a settings store that throws is treated as unavailable', () => {
    const cfg = resolve({ settings: () => { throw new Error('boom'); } });
    assert.equal(cfg.reason, 'default_on');
    assert.equal(cfg.enabled, true);
  });

  test('env kill switch forces OFF over env-on, settings-on and internal context', () => {
    for (const v of ['1', 'true', 'on', 'enabled', ' ON ']) {
      const cfg = resolve({
        env: { [E.kill]: v, [E.enable]: 'on', [E.nodeEnv]: 'test', [E.pct]: '100' },
        settings: { enableLiveSessionMemory: true },
      }, 'abc');
      assert.equal(cfg.enabled, false, v);
      assert.equal(cfg.reason, 'kill_switch', v);
      assert.equal(cfg.killSwitch, true, v);
      assert.equal(cfg.rolloutPercent, null);
      assert.equal(cfg.bucket, null);
    }
  });

  test('settings kill switch (strict true) forces OFF', () => {
    const cfg = resolve({ env: { [E.enable]: 'on' }, settings: { liveSessionMemoryKillSwitch: true } });
    assert.equal(cfg.reason, 'kill_switch');
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.killSwitch, true);
  });

  test('kill switch values that are not "on" do not engage it', () => {
    for (const v of ['0', 'false', 'off', '', 'yes']) {
      assert.equal(resolve({ env: { [E.kill]: v } }).killSwitch, false, JSON.stringify(v));
    }
    assert.equal(resolve({ settings: { liveSessionMemoryKillSwitch: 'true' } }).killSwitch, false);
  });

  test('env override on: every on-token, beats settings false', () => {
    for (const v of ['1', 'true', 'on', 'enabled', ' Enabled ']) {
      const cfg = resolve({ env: { [E.enable]: v }, settings: { enableLiveSessionMemory: false } });
      assert.equal(cfg.enabled, true, v);
      assert.equal(cfg.reason, 'env_on', v);
    }
  });

  test('env override off: every off-token, beats settings true and internal context', () => {
    for (const v of ['0', 'false', 'off', 'disabled', ' OFF ']) {
      const cfg = resolve({ env: { [E.enable]: v, [E.nodeEnv]: 'test' }, settings: { enableLiveSessionMemory: true } });
      assert.equal(cfg.enabled, false, v);
      assert.equal(cfg.reason, 'env_off', v);
    }
  });

  test('an unrecognised env override value is no override', () => {
    assert.equal(resolve({ env: { [E.enable]: 'maybe' } }).reason, 'default_on');
  });

  test('settings opt-in true / false', () => {
    const on = resolve({ env: { [E.pct]: '0' }, settings: { enableLiveSessionMemory: true } });
    assert.equal(on.enabled, true);
    assert.equal(on.reason, 'settings_on');
    const off = resolve({ env: { [E.nodeEnv]: 'test' }, settings: { enableLiveSessionMemory: false } });
    assert.equal(off.enabled, false);
    assert.equal(off.reason, 'settings_off');
  });

  test('non-boolean settings values are ignored', () => {
    assert.equal(resolve({ settings: { enableLiveSessionMemory: 'false' } }).reason, 'default_on');
    assert.equal(resolve({ settings: { enableLiveSessionMemory: 0 } }).reason, 'default_on');
  });

  test('internal contexts are ON ahead of the rollout gate', () => {
    const contexts = [
      { [E.nodeEnv]: 'test' },
      { [E.nodeEnv]: 'development' },
      { [E.bench]: 'some-model' },
      { [E.internal]: '1' },
      { [E.dev]: '1' },
    ];
    for (const ctx of contexts) {
      const cfg = resolve({ env: { ...ctx, [E.pct]: '0' } });
      assert.equal(cfg.enabled, true, JSON.stringify(ctx));
      assert.equal(cfg.reason, 'internal_context', JSON.stringify(ctx));
      assert.equal(cfg.rolloutPercent, null);
    }
  });

  test('production NODE_ENV and non-"1" internal flags are not internal contexts', () => {
    const cfg = resolve({ env: { [E.nodeEnv]: 'production', [E.internal]: 'true', [E.dev]: '0', [E.pct]: '0' } });
    assert.equal(cfg.reason, 'rollout_out');
  });
});

describe('resolveLiveSessionMemoryConfig: env override caching', () => {
  test('the env override is cached until __resetLiveSessionMemoryCache()', () => {
    withState({ env: { [E.enable]: 'off' } }, () => {
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'env_off');
      process.env[E.enable] = 'on';
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'env_off', 'stale until reset');
      __resetLiveSessionMemoryCache();
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'env_on');
    });
  });

  test('"no override" is cached too', () => {
    withState({}, () => {
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'default_on');
      process.env[E.enable] = 'off';
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'default_on');
      __resetLiveSessionMemoryCache();
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'env_off');
    });
  });

  test('the kill switch is NOT cached', () => {
    withState({}, () => {
      assert.equal(resolveLiveSessionMemoryConfig().enabled, true);
      process.env[E.kill] = '1';
      assert.equal(resolveLiveSessionMemoryConfig().reason, 'kill_switch');
      delete process.env[E.kill];
      assert.equal(resolveLiveSessionMemoryConfig().enabled, true);
    });
  });
});

describe('resolveLiveSessionMemoryConfig: percentage rollout', () => {
  // sessionBucket('a') === 20 (FNV-1a vector above).
  const ID = 'a';
  const BUCKET = 0xe40c292c % 100;

  test('0% is OFF for everyone, with no bucket computed', () => {
    const cfg = resolve({ env: { [E.pct]: '0' } }, ID);
    assert.deepEqual(
      { enabled: cfg.enabled, reason: cfg.reason, rolloutPercent: cfg.rolloutPercent, bucket: cfg.bucket },
      { enabled: false, reason: 'rollout_out', rolloutPercent: 0, bucket: null },
    );
  });

  test('100% is ON for everyone, even without a session id', () => {
    const cfg = resolve({ env: { [E.pct]: '100' } });
    assert.deepEqual(
      { enabled: cfg.enabled, reason: cfg.reason, rolloutPercent: cfg.rolloutPercent, bucket: cfg.bucket },
      { enabled: true, reason: 'rollout_in', rolloutPercent: 100, bucket: null },
    );
  });

  test('out-of-range percents are clamped', () => {
    assert.equal(resolve({ env: { [E.pct]: '250' } }).rolloutPercent, 100);
    assert.equal(resolve({ env: { [E.pct]: '250' } }).enabled, true);
    assert.equal(resolve({ env: { [E.pct]: '-5' } }).rolloutPercent, 0);
    assert.equal(resolve({ env: { [E.pct]: '-5' } }).enabled, false);
  });

  test('a partial rollout without a usable session id is OFF', () => {
    for (const id of [undefined, '', '   ']) {
      const cfg = resolve({ env: { [E.pct]: '50' } }, id);
      assert.equal(cfg.enabled, false, JSON.stringify(id));
      assert.equal(cfg.reason, 'rollout_out');
      assert.equal(cfg.rolloutPercent, 50);
      assert.equal(cfg.bucket, null);
    }
  });

  test('a session is in the rollout exactly when its bucket is below the percent', () => {
    const inCfg = resolve({ env: { [E.pct]: String(BUCKET + 1) } }, ID);
    assert.deepEqual(
      { enabled: inCfg.enabled, reason: inCfg.reason, rolloutPercent: inCfg.rolloutPercent, bucket: inCfg.bucket },
      { enabled: true, reason: 'rollout_in', rolloutPercent: BUCKET + 1, bucket: BUCKET },
    );
    const outCfg = resolve({ env: { [E.pct]: String(BUCKET) } }, ID);
    assert.deepEqual(
      { enabled: outCfg.enabled, reason: outCfg.reason, rolloutPercent: outCfg.rolloutPercent, bucket: outCfg.bucket },
      { enabled: false, reason: 'rollout_out', rolloutPercent: BUCKET, bucket: BUCKET },
    );
  });

  test('the decision is stable for a session and agrees with sessionBucket for many ids', () => {
    withState({ env: { [E.pct]: '37' } }, () => {
      for (let i = 0; i < 200; i++) {
        const id = `sess-${i}`;
        const cfg = resolveLiveSessionMemoryConfig(id);
        assert.equal(cfg.bucket, sessionBucket(id));
        assert.equal(cfg.enabled, sessionBucket(id) < 37);
        assert.equal(resolveLiveSessionMemoryConfig(id).enabled, cfg.enabled);
      }
    });
  });

  test('an unparseable env percent means no percentage gating', () => {
    const cfg = resolve({ env: { [E.pct]: 'lots' } }, ID);
    assert.equal(cfg.reason, 'default_on');
    assert.equal(cfg.rolloutPercent, null);
  });

  test('with the env unset or blank, the settings percent is used (floored, clamped)', () => {
    assert.equal(resolve({ settings: { liveSessionMemoryRolloutPercent: 0 } }, ID).reason, 'rollout_out');
    assert.equal(resolve({ settings: { liveSessionMemoryRolloutPercent: 33.9 } }, ID).rolloutPercent, 33);
    assert.equal(resolve({ settings: { liveSessionMemoryRolloutPercent: 400 } }).rolloutPercent, 100);
    assert.equal(resolve({ settings: { liveSessionMemoryRolloutPercent: -1 } }).rolloutPercent, 0);
    assert.equal(resolve({ env: { [E.pct]: '  ' }, settings: { liveSessionMemoryRolloutPercent: 0 } }).reason, 'rollout_out');
  });

  test('the env percent takes priority over the settings percent', () => {
    const cfg = resolve({ env: { [E.pct]: '100' }, settings: { liveSessionMemoryRolloutPercent: 0 } });
    assert.equal(cfg.reason, 'rollout_in');
    assert.equal(cfg.rolloutPercent, 100);
  });

  test('a non-numeric or non-finite settings percent is ignored', () => {
    for (const v of ['50', NaN, Infinity, null, undefined]) {
      assert.equal(resolve({ settings: { liveSessionMemoryRolloutPercent: v } }).reason, 'default_on', String(v));
    }
  });
});

describe('isLiveSessionMemoryEnabled', () => {
  test('mirrors the resolved decision', () => {
    assert.equal(withState({}, () => isLiveSessionMemoryEnabled()), true);
    assert.equal(withState({ env: { [E.enable]: 'off' } }, () => isLiveSessionMemoryEnabled('a')), false);
    assert.equal(withState({ env: { [E.kill]: '1' } }, () => isLiveSessionMemoryEnabled('a')), false);
    assert.equal(withState({ env: { [E.pct]: '21' } }, () => isLiveSessionMemoryEnabled('a')), true);
    assert.equal(withState({ env: { [E.pct]: '20' } }, () => isLiveSessionMemoryEnabled('a')), false);
  });
});

describe('liveSessionMemoryMaxItems', () => {
  const max = (v) => withState({ env: v === undefined ? {} : { [E.max]: v } }, () => liveSessionMemoryMaxItems());

  test('defaults to 200', () => {
    assert.equal(max(undefined), 200);
    assert.equal(max(''), 200);
  });

  test('accepts values in 20..2000 inclusive', () => {
    assert.equal(max('20'), 20);
    assert.equal(max('500'), 500);
    assert.equal(max('2000'), 2000);
  });

  test('out-of-range or unparseable values fall back to 200', () => {
    for (const v of ['19', '2001', '0', '-50', 'abc']) assert.equal(max(v), 200, v);
  });

  test('is carried on the resolved config', () => {
    assert.equal(resolve({ env: { [E.max]: '64' } }).maxItems, 64);
    assert.equal(resolve({ env: { [E.max]: '64', [E.kill]: '1' } }).maxItems, 64);
  });
});

describe('liveSessionMemoryDebug', () => {
  const debug = (v) => withState({ env: v === undefined ? {} : { [E.debug]: v } }, () => liveSessionMemoryDebug());

  test('only the literal "true" (trimmed, any case) enables it', () => {
    assert.equal(debug('true'), true);
    assert.equal(debug(' TRUE '), true);
    for (const v of [undefined, '', '1', 'on', 'yes', 'false']) assert.equal(debug(v), false, String(v));
  });

  test('is carried on the resolved config', () => {
    assert.equal(resolve({ env: { [E.debug]: 'true' } }).debugMarkersOnly, true);
    assert.equal(resolve({}).debugMarkersOnly, false);
  });
});
