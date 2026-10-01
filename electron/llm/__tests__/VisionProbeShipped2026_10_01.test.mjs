/**
 * The one-time image test AS IT SHIPS (2026-10-01).
 *
 * The test audit found that VisionProbe2026_10_01.test.mjs checks the 30-day,
 * 10-minute and 45-second rules only against thresholds the test itself passes
 * in, with a fake model that never looks at the image. Production passes no
 * thresholds, so the DEFAULTS are what ships — and nothing pinned them, the
 * picture's content, or the "different number on the second attempt" rule.
 * Every probe here is built the way LLMHelper builds it: no thresholds.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const { VisionProbe } = require(dist('llm/visionProbe.js'));
const { renderDigitsPng, newVisionTestNumber } = require(dist('llm/visionTestImage.js'));
const { VISION_TEST_FRESH_MS } = require(dist('llm/visionProbeOutcome.js'));

const SEL = { provider: 'fluxion', model: 'fluxion/glm-5.3' };
const DAY = 24 * 3600_000;
const MIN = 60_000;

/**
 * A probe with production's thresholds and a model that SEES: it is handed the
 * PNG bytes the probe wrote and answers with the number those bytes show
 * (found by rendering the candidates), or says it sees nothing it knows.
 */
function shipped({ randoms = [0.5], reply, clock = { t: 1_000_000_000_000 } } = {}) {
  const images = new Map(); const asked = []; const saved = new Map(); let n = 0; let r = 0;
  const candidates = [...new Set(randoms.flatMap((x) => { const a = newVisionTestNumber(() => x); return [a, String(1000 + ((Number(a) - 1000 + 4567) % 9000))]; }))];
  const read = (png) => candidates.find((c) => Buffer.compare(renderDigitsPng(c), png) === 0) ?? null;
  const probe = new VisionProbe({
    ask: async function* (selection, imagePath, signal) {
      const seen = read(images.get(imagePath));
      asked.push({ model: selection.model, seen });
      const out = reply ? reply(seen, signal, asked.length) : (seen ?? 'I see no number.');
      if (out instanceof Promise) { yield await out; return; }
      if (out instanceof Error) throw out;
      yield out;
    },
    writeImage: (png) => { const p = `/img/${n++}.png`; images.set(p, png); return p; },
    removeImage: (p) => { images.delete(p); },
    recorded: (s) => saved.get(s.model),
    record: (s, reads) => saved.set(s.model, { reads, at: clock.t }),
    keyOf: (s) => `${s.provider}|${s.model}`,
    now: () => clock.t,
    random: () => randoms[Math.min(r++, randoms.length - 1)],
  });
  return { probe, asked, saved, clock, images };
}

describe('the picture shows the number that is judged', () => {
  test('a model that reads the PNG it was handed passes: the bytes are that number\'s image', async () => {
    const { probe, asked, saved } = shipped({ randoms: [0.5] });
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.equal(asked[0].seen, newVisionTestNumber(() => 0.5), 'the model found the number in the image itself');
    assert.equal(saved.get(SEL.model).reads, true);
  });
  test('the confirmation attempt shows a DIFFERENT number, even when the generator repeats itself', async () => {
    // A blind model that always answers the same number would otherwise pass
    // the second attempt by luck when the generator handed out the same one.
    const { probe, asked, saved } = shipped({ randoms: [0.5, 0.5], reply: () => 'The number is 1111.' });
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(asked.length, 2);
    assert.ok(asked[0].seen && asked[1].seen, 'both images were readable numbers');
    assert.notEqual(asked[0].seen, asked[1].seen);
    assert.equal(saved.get(SEL.model).reads, false);
  });
});

describe('the thresholds production runs with', () => {
  test('a saved result answers for 30 days and is asked again after that', async () => {
    const { probe, asked, clock } = shipped();
    assert.equal(await probe.ensure(SEL), 'yes');
    clock.t += 30 * DAY - 1;
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.equal(asked.length, 1, 'still fresh: not asked');
    clock.t += 1;
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.equal(asked.length, 2, 'stale: asked again');
    assert.equal(VISION_TEST_FRESH_MS, 30 * DAY, 'the same 30 days the resolver stops trusting a saved result after');
  });
  test('an inconclusive test is not repeated for 10 minutes', async () => {
    const { probe, asked, clock } = shipped({ reply: () => new Error('503 upstream unavailable') });
    assert.equal(await probe.ensure(SEL), 'unknown');
    clock.t += 10 * MIN - 1;
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(asked.length, 1);
    clock.t += 1;
    await probe.ensure(SEL);
    assert.equal(asked.length, 2);
  });
  test('a model gets 45 seconds, not less', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { probe, saved } = shipped({ reply: () => new Promise(() => {}) });
      let outcome = 'pending';
      void probe.ensure(SEL).then((o) => { outcome = o; });
      const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      await settle();
      mock.timers.tick(44_999); await settle();
      assert.equal(outcome, 'pending', 'GPT-6 Astra takes 8–13 s to its first token; a short budget would call it unknown');
      mock.timers.tick(1); await settle();
      assert.equal(outcome, 'unknown');
      assert.equal(saved.size, 0, 'a timeout is never an answer');
    } finally { mock.timers.reset(); }
  });
});

describe('one test at a time per model', () => {
  test('a forced re-test while one is running joins it instead of starting a second', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { probe, asked } = shipped({ reply: (seen) => gate.then(() => seen) });
    const first = probe.ensure(SEL);
    assert.equal(probe.isRunning(SEL), true);
    const forced = probe.ensure(SEL, { force: true });
    release();
    assert.deepEqual(await Promise.all([first, forced]), ['yes', 'yes']);
    assert.equal(asked.length, 1);
    assert.equal(probe.isRunning(SEL), false);
  });
});
