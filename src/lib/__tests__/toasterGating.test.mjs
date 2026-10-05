// src/lib/__tests__/toasterGating.test.mjs
//
// Covers src/lib/toasterGating.ts — the legacy toaster display rules: one
// toaster per app start, then a per-toaster cooldown of 24 hours OR 5 app opens.
//
// The module reads three browser/Vite globals that plain Node does not have, so
// they are stubbed BEFORE the dynamic import and restored afterwards:
//   * localStorage / sessionStorage — in-memory fakes, reset before every test;
//   * import.meta.env.DEV — Vite injects this at build time. Under Node it is
//     undefined, so the two "blocked" branches would throw into the module's own
//     catch and report "allowed". A module load hook (node:module registerHooks)
//     defines import.meta.env for this one module, standing in for Vite's
//     define. Tests that need a blocked verdict are skipped on Node builds that
//     predate registerHooks.
// Date.now is mocked per test; no real clock or timers are involved.
//
// Run: node --experimental-strip-types --test src/lib/__tests__/toasterGating.test.mjs
import { describe, test, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = 1_750_000_000_000; // fixed "now" for every test

const OPENS_KEY = 'natively_app_opens_count';
const SESSION_TRACKED_KEY = 'natively_session_open_tracked';
const SESSION_SHOWN_KEY = 'natively_session_toaster_shown';

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

function makeBrokenStorage() {
  const boom = () => { throw new Error('storage unavailable'); };
  return { getItem: boom, setItem: boom };
}

// ---- global stubs (restored in after()) -------------------------------------
const savedLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const savedSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
const restoreGlobal = (name, desc) => {
  if (desc) Object.defineProperty(globalThis, name, desc);
  else delete globalThis[name];
};

const ENV_KEY = '__nativelyToasterGatingTestEnv';
const env = { DEV: false };
globalThis[ENV_KEY] = env;

const HAS_ENV = typeof nodeModule.registerHooks === 'function';
const needsEnv = HAS_ENV ? {} : { skip: 'needs node:module registerHooks to define import.meta.env' };
let hooks = null;
if (HAS_ENV) {
  hooks = nodeModule.registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.endsWith('/src/lib/toasterGating.ts')) return result;
      // Same line, so the module's line numbers are unchanged.
      return { ...result, source: `import.meta.env = globalThis.${ENV_KEY}; ${String(result.source)}` };
    },
  });
}

setGlobal('localStorage', makeStorage());
setGlobal('sessionStorage', makeStorage());
const { trackAppOpen, getAppOpensCount, isToasterAllowed, markToasterAsShown } = await import('../toasterGating.ts');
hooks?.deregister?.();

let logMock;
let warnMock;

beforeEach(() => {
  setGlobal('localStorage', makeStorage());
  setGlobal('sessionStorage', makeStorage());
  env.DEV = false;
  mock.method(Date, 'now', () => T0);
  logMock = mock.method(console, 'log', () => {});
  warnMock = mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

after(() => {
  restoreGlobal('localStorage', savedLocal);
  restoreGlobal('sessionStorage', savedSession);
  delete globalThis[ENV_KEY];
});

/** Simulates quitting and relaunching the app: session storage is wiped. */
const newSession = () => setGlobal('sessionStorage', makeStorage());

describe('trackAppOpen', () => {
  test('first ever open counts as 1 and is persisted', () => {
    assert.equal(trackAppOpen(), 1);
    assert.equal(localStorage.getItem(OPENS_KEY), '1');
    assert.equal(sessionStorage.getItem(SESSION_TRACKED_KEY), 'true');
  });

  test('calling it again in the same session does not double count', () => {
    assert.equal(trackAppOpen(), 1);
    assert.equal(trackAppOpen(), 1);
    assert.equal(trackAppOpen(), 1);
    assert.equal(localStorage.getItem(OPENS_KEY), '1');
  });

  test('each new session increments the persisted count', () => {
    assert.equal(trackAppOpen(), 1);
    newSession();
    assert.equal(trackAppOpen(), 2);
    newSession();
    assert.equal(trackAppOpen(), 3);
    assert.equal(localStorage.getItem(OPENS_KEY), '3');
  });

  test('continues from an existing stored count', () => {
    localStorage.setItem(OPENS_KEY, '41');
    assert.equal(trackAppOpen(), 42);
  });

  test('an already-tracked session returns the stored count unchanged', () => {
    localStorage.setItem(OPENS_KEY, '7');
    sessionStorage.setItem(SESSION_TRACKED_KEY, 'true');
    assert.equal(trackAppOpen(), 7);
    assert.equal(localStorage.getItem(OPENS_KEY), '7');
  });

  test('returns 0 and warns instead of throwing when storage is broken', () => {
    setGlobal('localStorage', makeBrokenStorage());
    setGlobal('sessionStorage', makeBrokenStorage());
    assert.equal(trackAppOpen(), 0);
    assert.equal(warnMock.mock.callCount(), 1);
  });
});

describe('getAppOpensCount', () => {
  test('is 0 before anything was tracked', () => {
    assert.equal(getAppOpensCount(), 0);
  });

  test('reflects the tracked opens', () => {
    trackAppOpen();
    newSession();
    trackAppOpen();
    assert.equal(getAppOpensCount(), 2);
  });

  test('parses the stored value as an integer', () => {
    localStorage.setItem(OPENS_KEY, '12');
    assert.equal(getAppOpensCount(), 12);
  });

  test('returns 0 when storage is broken', () => {
    setGlobal('localStorage', makeBrokenStorage());
    assert.equal(getAppOpensCount(), 0);
  });
});

describe('markToasterAsShown', () => {
  test('records the session flag, the time and the open count for that toaster', () => {
    localStorage.setItem(OPENS_KEY, '3');
    markToasterAsShown('support');
    assert.equal(sessionStorage.getItem(SESSION_SHOWN_KEY), 'true');
    assert.equal(localStorage.getItem('last_shown_time_support'), String(T0));
    assert.equal(localStorage.getItem('last_shown_opens_support'), '3');
  });

  test('keeps a separate record per toaster id', () => {
    markToasterAsShown('a');
    assert.equal(localStorage.getItem('last_shown_time_a'), String(T0));
    assert.equal(localStorage.getItem('last_shown_time_b'), null);
    assert.equal(localStorage.getItem('last_shown_opens_b'), null);
  });

  test('does not throw when storage is broken', () => {
    setGlobal('localStorage', makeBrokenStorage());
    setGlobal('sessionStorage', makeBrokenStorage());
    assert.doesNotThrow(() => markToasterAsShown('support'));
    assert.equal(warnMock.mock.callCount(), 1);
  });
});

describe('isToasterAllowed — nothing shown yet', () => {
  test('a never-shown toaster is allowed', () => {
    assert.equal(isToasterAllowed('trial_promo'), true);
  });

  test('checking does not write anything', () => {
    isToasterAllowed('trial_promo');
    assert.equal(localStorage.map.size, 0);
    assert.equal(sessionStorage.map.size, 0);
  });

  test('fails open (allowed) and warns when storage is broken', () => {
    setGlobal('localStorage', makeBrokenStorage());
    setGlobal('sessionStorage', makeBrokenStorage());
    assert.equal(isToasterAllowed('trial_promo'), true);
    assert.equal(warnMock.mock.callCount(), 1);
  });
});

describe('isToasterAllowed — session gate (one toaster per app start)', () => {
  test('after one toaster is shown, the same toaster is blocked this session', needsEnv, () => {
    markToasterAsShown('a');
    assert.equal(isToasterAllowed('a'), false);
  });

  test('after one toaster is shown, every OTHER toaster is blocked this session too', needsEnv, () => {
    markToasterAsShown('a');
    assert.equal(isToasterAllowed('b'), false);
    assert.equal(isToasterAllowed('permissions'), false);
  });

  test('the session gate wins even when the cooldown has long expired', needsEnv, () => {
    localStorage.setItem('last_shown_time_a', String(T0 - 30 * DAY));
    sessionStorage.setItem(SESSION_SHOWN_KEY, 'true');
    assert.equal(isToasterAllowed('a'), false);
  });

  test('a session flag other than the string "true" does not gate', () => {
    sessionStorage.setItem(SESSION_SHOWN_KEY, 'false');
    assert.equal(isToasterAllowed('a'), true);
  });

  test('a different toaster is allowed again in the next session', () => {
    markToasterAsShown('a');
    newSession();
    assert.equal(isToasterAllowed('b'), true);
  });
});

describe('isToasterAllowed — cooldown (24 hours OR 5 app opens)', () => {
  /** Toaster "a" was shown at T0 on open #10; we are now in a later session. */
  const shownAt = (opens = 10) => {
    localStorage.setItem(OPENS_KEY, String(opens));
    markToasterAsShown('a');
    newSession();
  };

  test('blocked in the next session when neither condition is met', needsEnv, () => {
    shownAt();
    localStorage.setItem(OPENS_KEY, '11');
    Date.now.mock.mockImplementation(() => T0 + HOUR);
    assert.equal(isToasterAllowed('a'), false);
  });

  test('blocked one millisecond before 24 hours with 4 opens elapsed', needsEnv, () => {
    shownAt();
    localStorage.setItem(OPENS_KEY, '14');
    Date.now.mock.mockImplementation(() => T0 + DAY - 1);
    assert.equal(isToasterAllowed('a'), false);
  });

  test('allowed at exactly 24 hours even with no new opens', () => {
    shownAt();
    Date.now.mock.mockImplementation(() => T0 + DAY);
    assert.equal(isToasterAllowed('a'), true);
  });

  test('allowed after more than 24 hours', () => {
    shownAt();
    Date.now.mock.mockImplementation(() => T0 + 3 * DAY);
    assert.equal(isToasterAllowed('a'), true);
  });

  test('allowed at exactly 5 opens elapsed even with no time passed', () => {
    shownAt();
    localStorage.setItem(OPENS_KEY, '15');
    assert.equal(isToasterAllowed('a'), true);
  });

  test('allowed after more than 5 opens', () => {
    shownAt();
    localStorage.setItem(OPENS_KEY, '40');
    Date.now.mock.mockImplementation(() => T0 + HOUR);
    assert.equal(isToasterAllowed('a'), true);
  });

  test('the cooldown is per toaster: another id is unaffected', needsEnv, () => {
    shownAt();
    localStorage.setItem(OPENS_KEY, '11');
    assert.equal(isToasterAllowed('a'), false);
    assert.equal(isToasterAllowed('b'), true);
  });

  test('a missing opens record is treated as shown at open #0', needsEnv, () => {
    localStorage.setItem('last_shown_time_a', String(T0));
    localStorage.setItem(OPENS_KEY, '4');
    assert.equal(isToasterAllowed('a'), false);
    localStorage.setItem(OPENS_KEY, '5');
    assert.equal(isToasterAllowed('a'), true);
  });

  test('end to end: shown, blocked for 4 further opens, allowed on the 5th', needsEnv, () => {
    assert.equal(trackAppOpen(), 1);
    assert.equal(isToasterAllowed('a'), true);
    markToasterAsShown('a');
    for (let open = 2; open <= 5; open++) {
      newSession();
      assert.equal(trackAppOpen(), open);
      assert.equal(isToasterAllowed('a'), false, `open #${open}`);
    }
    newSession();
    assert.equal(trackAppOpen(), 6);
    assert.equal(isToasterAllowed('a'), true);
  });
});

describe('isToasterAllowed — DEV logging', () => {
  test('a blocked verdict is silent outside DEV', needsEnv, () => {
    markToasterAsShown('a');
    const before = logMock.mock.callCount();
    assert.equal(isToasterAllowed('a'), false);
    assert.equal(logMock.mock.callCount(), before);
  });

  test('in DEV the session gate explains itself and still blocks', needsEnv, () => {
    env.DEV = true;
    markToasterAsShown('a');
    const before = logMock.mock.callCount();
    assert.equal(isToasterAllowed('b'), false);
    assert.equal(logMock.mock.callCount(), before + 1);
    assert.match(String(logMock.mock.calls.at(-1).arguments[0]), /'b'.*already shown in this session/);
  });

  test('in DEV the cooldown reports the hours and opens remaining', needsEnv, () => {
    env.DEV = true;
    localStorage.setItem(OPENS_KEY, '10');
    markToasterAsShown('a');
    newSession();
    localStorage.setItem(OPENS_KEY, '12');
    Date.now.mock.mockImplementation(() => T0 + 6 * HOUR);
    assert.equal(isToasterAllowed('a'), false);
    assert.match(
      String(logMock.mock.calls.at(-1).arguments[0]),
      /Cooldown active\. Needs 18\.0h more or 3 more app opens\./,
    );
  });
});
