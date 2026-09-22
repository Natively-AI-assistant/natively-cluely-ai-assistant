// electron/llm/__tests__/LeadingWhitespaceFirstChunk2026_09_22.test.mjs
//
// A first chunk of pure whitespace is not an empty stream.
//
// moondream (Ollama) streams its answer as "\n", "The", " image", ... The
// engine judged the stream on chunk #1 alone — `trim().length === 0` → throw
// 'empty-stream' — so it discarded a good answer three times and the user got
// "all vision models are unavailable". Reproduced live on 2026-09-22 with a
// cold screenshot, moondream:latest and only Ollama configured:
//
//   [Vision] Ollama (moondream:latest) attempt 1/3: unknown (empty-stream)
//   [Vision] Ollama (moondream:latest) attempt 2/3: unknown (empty-stream)
//   [Vision] Ollama (moondream:latest) attempt 3/3: unknown (empty-stream)
//
// while the same request sent straight to Ollama answered every time.
//
// The guard itself stays: a provider that yields only whitespace and ends, or
// never produces a real token before the TTFT budget, is still a failure.
// Leading whitespace is kept and delivered with the first real token, so the
// answer reaches the user byte-for-byte.
//
// Covers every path that judges a first chunk: the sequential engine (vision
// and text) and the hedged race.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm', f)).href;
const { runStreamingVisionFallback, openHedged, DEFAULT_VISION_FALLBACK_CONFIG } = await import(dist('visionStreamFallback.js'));
const { runStreamingTextFallback, DEFAULT_TEXT_FALLBACK_CONFIG } = await import(dist('textStreamFallback.js'));

function provider(id, tokens, opts = {}) {
  return {
    id, name: id, isLocal: false, priority: opts.priority ?? 0,
    ...(opts.ttftTimeoutMs !== undefined ? { ttftTimeoutMs: opts.ttftTimeoutMs } : {}),
    _calls: 0,
    open(signal) {
      this._calls++;
      return (async function* () {
        for (const t of tokens) {
          if (t === HANG) { await new Promise((r) => signal.addEventListener('abort', r, { once: true })); return; }
          yield t;
        }
      })();
    },
  };
}
const HANG = Symbol('hang');

async function collect(gen) { const out = []; for await (const c of gen) out.push(c); return out; }
const fastHooks = () => ({ now: () => 1_000_000, random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {} });
const realHooks = () => ({ now: () => Date.now(), random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {} });
const VCFG = DEFAULT_VISION_FALLBACK_CONFIG;

describe('vision chain: a leading newline is not an empty stream', () => {
  test('moondream shape ("\\n", "The", " image") commits on the FIRST attempt, full text delivered', async () => {
    const ollama = provider('ollama', ['\n', 'The', ' image', ' shows']);
    const backup = provider('openai', ['backup answer']);
    const out = await collect(runStreamingVisionFallback([ollama, backup], VCFG, new Map(), fastHooks()));
    assert.equal(out.join(''), '\nThe image shows', 'answer delivered byte-for-byte, leading newline included');
    assert.equal(ollama._calls, 1, 'no retries — the first attempt was a good answer');
    assert.equal(backup._calls, 0, 'must not fall past a provider that answered');
  });

  test('several whitespace-only chunks before the first word still commit', async () => {
    const p = provider('ollama', ['\n', '  ', '\n\n', 'Answer', '.']);
    const out = await collect(runStreamingVisionFallback([p], VCFG, new Map(), fastHooks()));
    assert.equal(out.join(''), '\n  \n\nAnswer.');
    assert.equal(p._calls, 1);
  });

  test('empty-string chunks before the first word are skipped too', async () => {
    const p = provider('ollama', ['', '', 'Hello']);
    const out = await collect(runStreamingVisionFallback([p], VCFG, new Map(), fastHooks()));
    assert.equal(out.join(''), 'Hello');
  });

  test('whitespace-only then END is still an empty stream → falls back', async () => {
    const blank = provider('ollama', ['\n', '  ', '\n']);
    const backup = provider('openai', ['real answer']);
    const out = await collect(runStreamingVisionFallback([blank, backup], VCFG, new Map(), fastHooks()));
    assert.deepEqual(out, ['real answer']);
    assert.ok(blank._calls >= 1);
  });

  test('whitespace then a hang is bounded by the TTFT budget → falls back', async () => {
    const stuck = provider('ollama', ['\n', HANG], { ttftTimeoutMs: 80 });
    const backup = provider('openai', ['real answer']);
    const t0 = Date.now();
    const out = await collect(runStreamingVisionFallback([stuck, backup], { ...VCFG, maxAttempts: 1 }, new Map(), realHooks()));
    assert.deepEqual(out, ['real answer']);
    assert.ok(Date.now() - t0 < 2000, 'a trickle of whitespace must not extend the first-token wait');
  });

  test('error prose after a leading newline is still a pre-commit failure', async () => {
    const failing = provider('custom', ['\n', 'Error: Custom Provider returned HTTP 500 upstream']);
    const backup = provider('openai', ['real answer']);
    const out = await collect(runStreamingVisionFallback([failing, backup], { ...VCFG, maxAttempts: 1 }, new Map(), fastHooks()));
    assert.deepEqual(out, ['real answer']);
  });
});

describe('hedged race: a leading newline is not an empty branch', () => {
  const hedgeCfg = { ...VCFG, hedgeEnabled: true, hedgeDelayDefaultMs: 60, hedgeDelayMinMs: 40, hedgeDelayMaxMs: 120, hedgeDelayEmaFactor: 0.6 };
  test('primary streaming "\\n" first wins solo; partner never launched', async () => {
    const partner = provider('gemini_flash_lite', ['lite']);
    const primary = provider('gemini_flash', ['\n', 'flash']);
    primary.hedgeWith = { id: partner.id, name: partner.id, open: (s, a) => partner.open(s, a) };
    const out = await collect(openHedged(primary, hedgeCfg, new Map(), realHooks(), new AbortController().signal, 1));
    assert.equal(out.join(''), '\nflash');
    assert.equal(partner._calls, 0);
  });
});

describe('text chain (same engine): a leading newline is not an empty stream', () => {
  test('commits to the primary instead of falling through', async () => {
    const primary = provider('natively', ['\n', 'Hi', ' there'], { priority: 0 });
    const fallback = provider('gemini', ['fallback'], { priority: 1 });
    const out = await collect(runStreamingTextFallback([primary, fallback], new Map(), DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.equal(out.join(''), '\nHi there');
    assert.equal(fallback._calls, 0);
  });
});
