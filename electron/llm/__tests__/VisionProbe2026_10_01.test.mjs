/**
 * The one-time image test's engine (2026-10-01), with every dependency
 * injected: no network, no disk, no clock.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { VisionProbe } = require(dist('llm/visionProbe.js'));

const SEL = { provider: 'fluxion', model: 'fluxion/glm-5.3' };

/** A probe whose model replies come from `replies` (strings, Errors, or functions of the number shown). */
function rig(replies, extra = {}) {
  const state = { asks: [], images: new Set(), removed: 0, saved: new Map(), clock: 1_000_000, numbers: ['7392', '4816', '2057', '6630'] };
  let n = 0;
  const probe = new VisionProbe({
    ask: async function* (selection, imagePath, signal) {
      const shown = state.numbers[state.asks.length % state.numbers.length];
      state.asks.push({ selection, imagePath, shown });
      assert.ok(state.images.has(imagePath), 'the image exists while the model is asked');
      const r = replies[Math.min(state.asks.length - 1, replies.length - 1)];
      const value = typeof r === 'function' ? r(shown, signal) : r;
      if (value instanceof Promise) { yield await value; return; }
      if (value instanceof Error) throw value;
      for (const piece of String(value).match(/.{1,5}/gs) ?? []) yield piece;
    },
    writeImage: () => { const p = `/img/${n++}.png`; state.images.add(p); return p; },
    removeImage: (p) => { state.images.delete(p); state.removed += 1; },
    recorded: (s) => state.saved.get(`${s.provider}|${s.model}`),
    record: (s, reads) => state.saved.set(`${s.provider}|${s.model}`, { reads, at: state.clock }),
    keyOf: (s) => `${s.provider}|${s.model}`,
    now: () => state.clock,
    random: (() => { let i = 0; return () => (Number(state.numbers[i++ % state.numbers.length]) - 1000) / 9000 + 1e-9; })(),
    timeoutMs: 50, retryMs: 600_000, staleMs: 30 * 86_400_000,
    ...extra,
  });
  return { probe, state };
}
const shownBack = (shown) => `The number is ${shown}.`;

describe('a definite answer', () => {
  test('the model reads the number back: yes, saved, one request, image removed', async () => {
    const { probe, state } = rig([shownBack]);
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.deepEqual(state.saved.get('fluxion|fluxion/glm-5.3'), { reads: true, at: 1_000_000 });
    assert.equal(state.asks.length, 1);
    assert.equal(state.images.size, 0, 'no image left behind');
  });
  test('a recognised image refusal is an immediate no', async () => {
    const { probe, state } = rig([new Error('404 No endpoints found that support image input')]);
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(state.asks.length, 1);
    assert.equal(state.saved.get('fluxion|fluxion/glm-5.3').reads, false);
  });
  test('a real reply without the number is a no only after a second miss with a different number', async () => {
    const { probe, state } = rig(["Images aren't supported in this chat.", 'I cannot see any image.']);
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(state.asks.length, 2);
    assert.notEqual(state.asks[0].shown, state.asks[1].shown);
    assert.equal(state.saved.get('fluxion|fluxion/glm-5.3').reads, false);
  });
  test('one misread followed by a correct read is a yes', async () => {
    const { probe, state } = rig(['The number is 7892.', shownBack]);
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.equal(state.asks.length, 2);
  });
});

describe('a transient failure is never an answer', () => {
  for (const [label, reply] of [
    ['an empty daily pool', new Error('402 Budget pool quota has been exhausted')],
    ['a rate limit', new Error('429 rate limit exceeded')],
    ['a server error', new Error('503 no available channel')],
    ['a content filter', new Error('400 content-blocked')],
    ['a bad key', new Error('401 unauthorized')],
    ['an empty reply', ''],
    ['a privacy block', new Error('Screenshots and current page data are disabled for cloud providers.')],
  ]) {
    test(`${label}: unknown, nothing saved`, async () => {
      const { probe, state } = rig([reply]);
      assert.equal(await probe.ensure(SEL), 'unknown');
      assert.equal(state.saved.size, 0);
      assert.equal(state.images.size, 0);
    });
  }
  test('a model that never answers times out as unknown, and the request is aborted', async () => {
    let aborted = false;
    const { probe, state } = rig([(_shown, signal) => new Promise((resolve) => { signal.addEventListener('abort', () => { aborted = true; resolve(''); }); })]);
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(aborted, true);
    assert.equal(state.saved.size, 0);
  });
  test('a miss followed by a transient failure stays unknown', async () => {
    const { probe, state } = rig(['I cannot see an image.', new Error('429 rate limit')]);
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(state.saved.size, 0);
  });
  test('after unknown, the next attempt waits for the backoff; force skips it', async () => {
    const { probe, state } = rig([new Error('429 rate limit'), shownBack]);
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(state.asks.length, 1, 'no second request inside the backoff');
    state.clock += 600_001;
    assert.equal(await probe.ensure(SEL), 'yes');
    const again = rig([new Error('429 rate limit'), shownBack]);
    await again.probe.ensure(SEL);
    assert.equal(await again.probe.ensure(SEL, { force: true }), 'yes');
  });
});

describe('once per model', () => {
  test('a fresh saved result is returned without asking', async () => {
    const { probe, state } = rig([shownBack]);
    state.saved.set('fluxion|fluxion/glm-5.3', { reads: false, at: state.clock - 1000 });
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(state.asks.length, 0);
  });
  test('a result older than 30 days is tested again; force also re-tests', async () => {
    const { probe, state } = rig([shownBack]);
    state.saved.set('fluxion|fluxion/glm-5.3', { reads: false, at: state.clock - 31 * 86_400_000 });
    assert.equal(await probe.ensure(SEL), 'yes');
    const forced = rig([shownBack]);
    forced.state.saved.set('fluxion|fluxion/glm-5.3', { reads: false, at: forced.state.clock });
    assert.equal(await forced.probe.ensure(SEL, { force: true }), 'yes');
  });
  test('concurrent callers share one test', async () => {
    const { probe, state } = rig([shownBack]);
    const [a, b] = await Promise.all([probe.ensure(SEL), probe.ensure(SEL)]);
    assert.deepEqual([a, b], ['yes', 'yes']);
    assert.equal(state.asks.length, 1);
  });
  test('different models are tested separately', async () => {
    const { probe, state } = rig([shownBack]);
    await Promise.all([probe.ensure(SEL), probe.ensure({ provider: 'fluxion', model: 'fluxion/other' })]);
    assert.equal(state.asks.length, 2);
  });
});
