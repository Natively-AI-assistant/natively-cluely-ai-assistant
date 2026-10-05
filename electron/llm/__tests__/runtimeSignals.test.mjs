// electron/llm/__tests__/runtimeSignals.test.mjs
//
// Unit tests for electron/llm/performance/runtimeSignals.ts — the per-process
// environmental facts (system resume, network switch) used to classify a
// latency sample, the cached network profile read, and the global accessor.
//
// The clock and the network reader are both injected, so nothing here touches
// Date.now(), real timers or os.networkInterfaces().
//
// Run: npm run build:electron && node --test electron/llm/__tests__/runtimeSignals.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
  RuntimeSignals,
  RESUME_QUARANTINE_MS,
  NETWORK_CACHE_MS,
  getRuntimeSignals,
  __setRuntimeSignals,
} = require(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'performance', 'runtimeSignals.js'));

const T0 = 1_000_000; // an arbitrary injected-clock origin, well away from 0
const net = (id, interfaceClass = 'wifi') => ({ id, interfaceClass, offline: false });

/** A RuntimeSignals wired to a hand-driven clock and a scripted network reader. */
function harness({ start = T0, network = net('home') } = {}) {
  const state = { t: start, network, reads: 0 };
  const signals = new RuntimeSignals({
    now: () => state.t,
    readNetwork: () => { state.reads++; return state.network; },
  });
  return { state, signals };
}

describe('constants', () => {
  test('quarantine is 20s and the network cache is 10s', () => {
    assert.equal(RESUME_QUARANTINE_MS, 20_000);
    assert.equal(NETWORK_CACHE_MS, 10_000);
  });
});

describe('RuntimeSignals.network: caching', () => {
  test('the first call reads the real network', () => {
    const { state, signals } = harness();
    assert.deepEqual(signals.network(), net('home'));
    assert.equal(state.reads, 1);
  });

  test('the first call reads even when the injected clock is at 0', () => {
    const { state, signals } = harness({ start: 0 });
    assert.equal(signals.network().id, 'home');
    assert.equal(state.reads, 1);
  });

  test('reads inside the cache window are served from cache', () => {
    const { state, signals } = harness();
    signals.network();
    state.network = net('hotspot');
    state.t = T0 + NETWORK_CACHE_MS - 1;
    assert.equal(signals.network().id, 'home');
    assert.equal(state.reads, 1);
  });

  test('the cache expires at exactly NETWORK_CACHE_MS', () => {
    const { state, signals } = harness();
    signals.network();
    state.network = net('hotspot');
    state.t = T0 + NETWORK_CACHE_MS;
    assert.equal(signals.network().id, 'hotspot');
    assert.equal(state.reads, 2);
  });

  test('the cache window restarts from the most recent real read', () => {
    const { state, signals } = harness();
    signals.network();
    state.t = T0 + NETWORK_CACHE_MS;
    signals.network();
    state.t = T0 + NETWORK_CACHE_MS + 5_000;
    signals.network();
    assert.equal(state.reads, 2);
  });

  test('a system resume forces a re-read on the next call', () => {
    const { state, signals } = harness();
    signals.network();
    state.t = T0 + 1_000;
    signals.noteSystemResumed();
    state.network = net('office');
    assert.equal(signals.network().id, 'office');
    assert.equal(state.reads, 2);
  });
});

describe('RuntimeSignals.contaminatedSince: clean', () => {
  test('nothing happened: a turn is not contaminated', () => {
    const { state, signals } = harness();
    state.t = T0 + 5_000;
    assert.equal(signals.contaminatedSince(T0), null);
  });

  test('reading the network for the first time is not a network switch', () => {
    const { state, signals } = harness();
    signals.network();
    state.t = T0 + 5_000;
    assert.equal(signals.contaminatedSince(T0 - 1_000), null);
  });

  test('re-reading the same network after the cache expires is not a switch', () => {
    const { state, signals } = harness();
    signals.network();
    state.t = T0 + NETWORK_CACHE_MS;
    signals.network();
    assert.equal(state.reads, 2);
    assert.equal(signals.contaminatedSince(T0), null);
  });
});

describe('RuntimeSignals.contaminatedSince: resume', () => {
  test('a turn started inside the quarantine after a resume is app_resumed', () => {
    const { state, signals } = harness();
    signals.noteSystemResumed();
    state.t = T0 + RESUME_QUARANTINE_MS - 1;
    assert.equal(signals.contaminatedSince(T0 + 5_000), 'app_resumed');
  });

  test('once the quarantine has passed, a turn started after the resume is clean', () => {
    const { state, signals } = harness();
    signals.noteSystemResumed();
    state.t = T0 + RESUME_QUARANTINE_MS; // boundary: exactly 20s is no longer quarantined
    assert.equal(signals.contaminatedSince(T0 + 1), null);
  });

  test('a resume DURING a turn contaminates it however long ago it was', () => {
    const { state, signals } = harness();
    const turnStart = T0;
    state.t = T0 + 5_000;
    signals.noteSystemResumed();
    state.t = T0 + 5_000 + RESUME_QUARANTINE_MS + 60_000;
    assert.equal(signals.contaminatedSince(turnStart), 'app_resumed');
  });

  test('a resume at the same instant the turn started counts as during it', () => {
    const { state, signals } = harness();
    signals.noteSystemResumed();
    state.t = T0 + RESUME_QUARANTINE_MS + 1;
    assert.equal(signals.contaminatedSince(T0), 'app_resumed');
  });

  test('the latest resume is the one that counts', () => {
    const { state, signals } = harness();
    signals.noteSystemResumed();
    state.t = T0 + 100_000;
    assert.equal(signals.contaminatedSince(T0 + 50_000), null);
    signals.noteSystemResumed();
    assert.equal(signals.contaminatedSince(T0 + 50_000), 'app_resumed');
  });
});

describe('RuntimeSignals.contaminatedSince: network switch', () => {
  /** home at T0, then hotspot observed at T0 + 30s. */
  function switched() {
    const h = harness();
    h.signals.network();
    h.state.network = net('hotspot', 'cellular');
    h.state.t = T0 + 30_000;
    h.signals.network();
    return h;
  }

  test('a switch observed during the turn is network_switch', () => {
    const { state, signals } = switched();
    state.t = T0 + 40_000;
    assert.equal(signals.contaminatedSince(T0 + 20_000), 'network_switch');
  });

  test('a turn started at the instant the switch was observed is contaminated', () => {
    const { signals } = switched();
    assert.equal(signals.contaminatedSince(T0 + 30_000), 'network_switch');
  });

  test('a turn started after the switch is clean', () => {
    const { state, signals } = switched();
    state.t = T0 + 60_000;
    assert.equal(signals.contaminatedSince(T0 + 30_001), null);
  });

  test('a switch is only seen when network() is actually re-read', () => {
    const { state, signals } = harness();
    signals.network();
    state.network = net('hotspot');
    state.t = T0 + 30_000; // changed underneath, but nobody has asked yet
    assert.equal(signals.contaminatedSince(T0 + 1_000), null);
    signals.network();
    assert.equal(signals.contaminatedSince(T0 + 1_000), 'network_switch');
  });

  test('going offline and coming back are both switches', () => {
    const { state, signals } = harness();
    signals.network();
    state.network = { id: 'offline', interfaceClass: 'other', offline: true };
    state.t = T0 + 20_000;
    signals.network();
    assert.equal(signals.contaminatedSince(T0 + 10_000), 'network_switch');
    state.network = net('home');
    state.t = T0 + 40_000;
    signals.network();
    assert.equal(signals.contaminatedSince(T0 + 35_000), 'network_switch');
  });

  test('a resume takes precedence over a network switch', () => {
    const { state, signals } = harness();
    signals.network();
    state.t = T0 + 30_000;
    signals.noteSystemResumed();
    state.network = net('office');
    signals.network(); // re-read forced by the resume; sees a different network
    state.t = T0 + 31_000;
    assert.equal(signals.contaminatedSince(T0 + 10_000), 'app_resumed');
    // Long after the quarantine, a turn that started after both events is clean.
    state.t = T0 + 90_000;
    assert.equal(signals.contaminatedSince(T0 + 30_001), null);
  });
});

describe('getRuntimeSignals / __setRuntimeSignals', () => {
  const KEY = '__nativelyRuntimeSignals__';

  /** Run with the process-wide slot saved and restored. */
  function isolated(fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, KEY);
    const prev = globalThis[KEY];
    try { return fn(); } finally {
      if (had) globalThis[KEY] = prev; else delete globalThis[KEY];
    }
  }

  test('creates one instance lazily and returns it every time', () => isolated(() => {
    __setRuntimeSignals(null);
    const a = getRuntimeSignals();
    assert.ok(a instanceof RuntimeSignals);
    assert.equal(getRuntimeSignals(), a);
  }));

  test('__setRuntimeSignals installs a specific instance', () => isolated(() => {
    const { signals } = harness();
    __setRuntimeSignals(signals);
    assert.equal(getRuntimeSignals(), signals);
  }));

  test('__setRuntimeSignals(null) clears it so the next get builds a fresh one', () => isolated(() => {
    const { signals } = harness();
    __setRuntimeSignals(signals);
    __setRuntimeSignals(null);
    assert.equal(Object.prototype.hasOwnProperty.call(globalThis, KEY), false);
    const fresh = getRuntimeSignals();
    assert.notEqual(fresh, signals);
    assert.ok(fresh instanceof RuntimeSignals);
  }));

  test('the default constructor needs no options', () => {
    assert.doesNotThrow(() => new RuntimeSignals());
    assert.doesNotThrow(() => new RuntimeSignals({}));
  });
});
