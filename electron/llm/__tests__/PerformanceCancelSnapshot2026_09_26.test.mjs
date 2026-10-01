// "Did the user cancel?" must be read when the turn ENDS, not after cleanup.
//
// raceStreamWithDeadline runs the caller's onCleanup and THEN the observer
// (pinned in StreamObservation2026_09_08). Every caller's cleanup aborts its own
// controller — manual chat on every ending, Auto Answer on every deadline — so
// an isUserCancelled() read in the observer was always yes: every manual answer
// and every timeout in the app was filed as `user_cancelled`, and the
// performance profile (and the adaptive deadlines built on it) learned nothing
// from either. The observer now carries `beforeCleanup`, which the race runs
// just before onCleanup.
//
// Driven with the REAL race, the REAL performanceHooks and the REAL recorder;
// only the store is fake (it captures what would be recorded).
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/PerformanceCancelSnapshot2026_09_26.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-cancel-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};

const { raceStreamWithDeadline } = require(dist('llm/liveDeadlines.js'));
const { performanceHooks } = require(dist('llm/performance/wiring.js'));
const { __setProviderPerformanceStore } = require(dist('llm/performance/ProviderPerformanceStore.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const llmHelper = { performanceIdentity: () => ({ providerId: 'gemini', modelId: 'gemini-3.8-flash', route: 'default_provider', isOllama: false }) };

/** One turn wired like the named caller; returns the recorded sample class. */
async function fileTurn(wiring, kind) {
  const recorded = [];
  __setProviderPerformanceStore(new Proxy({}, { get: (_t, k) => (k === 'record' ? (s) => recorded.push(s) : k === 'currentGeneration' ? () => 0 : () => null) }));
  const ctl = new AbortController();
  const perf = performanceHooks({
    llmHelper, hasImages: false, inputTokens: 200,
    // The two real wirings: ipcHandlers manual chat and IntelligenceEngine WTA.
    isUserCancelled: () => ctl.signal.aborted,
  });
  // First tokens over the recorder's 25ms plausibility floor (MIN_PLAUSIBLE_REMOTE_TTFT_MS).
  async function* answers() { await sleep(60); yield 'A process is a running program.'; }
  async function* stalls() { await new Promise((r) => ctl.signal.addEventListener('abort', r)); }
  // The user presses Stop mid-answer: the provider sees the abort and the stream simply ends.
  async function* userStops() { await sleep(60); yield 'A process'; ctl.abort(); await sleep(5); }
  const t0 = Date.now();
  let useful = false;
  try {
    await raceStreamWithDeadline({
      stream: kind === 'stall' ? stalls() : kind === 'user-stops' ? userStops() : answers(),
      observe: perf.observe, firstUsefulDeadlineMs: kind === 'stall' ? 150 : 5000, interTokenStallMs: 8000,
      isUsefulYet: () => useful, onToken: () => { useful = true; },
      shouldAbort: () => kind === 'superseded' && Date.now() - t0 > 5,
      onCleanup: wiring === 'manual'
        ? () => { ctl.abort(); }                                           // aborts on EVERY ending
        : (reason) => { if (reason !== 'done' && !ctl.signal.aborted) ctl.abort(reason); }, // on deadlines
    });
    await sleep(5);
  } finally {
    __setProviderPerformanceStore(null);
  }
  return recorded[0]?.sampleClass ?? 'nothing';
}

describe('a turn is filed by how it ENDED, not by the caller\'s own cleanup', () => {
  for (const wiring of ['manual', 'wta']) {
    test(`${wiring}: an answered turn is a success`, async () => {
      assert.match(await fileTurn(wiring, 'answer'), /^(normal|cold_start)$/);
    });
    test(`${wiring}: a stalled turn is a timeout`, async () => {
      assert.equal(await fileTurn(wiring, 'stall'), 'timeout');
    });
    test(`${wiring}: a superseded turn is a user cancel`, async () => {
      assert.equal(await fileTurn(wiring, 'superseded'), 'user_cancelled');
    });
    test(`${wiring}: the user stopping mid-answer is a user cancel even though the stream just ends`, async () => {
      assert.equal(await fileTurn(wiring, 'user-stops'), 'user_cancelled');
    });
  }
});

test('the observer\'s beforeCleanup runs before onCleanup, and the observation still after it', async () => {
  const order = [];
  const observe = Object.assign(() => order.push('observe'), { beforeCleanup: () => order.push('beforeCleanup') });
  async function* one() { yield 'x'; }
  await raceStreamWithDeadline({
    stream: one(), firstUsefulDeadlineMs: 1000, interTokenStallMs: 1000, isUsefulYet: () => true, onToken: () => {},
    onCleanup: () => order.push('cleanup'), observe,
  });
  assert.deepEqual(order, ['beforeCleanup', 'cleanup', 'observe']);
});
