// electron/services/__tests__/VisionRungHealthAndErrorAsAnswer2026_09_05.test.mjs
//
// The two defects left open by e079cd4a, both reproduced in a real Electron
// process against a local gateway before being fixed.
//
// A. A PROVIDER FAILURE READ AS AN ANSWER.
//    streamWithCustom answered an HTTP error, and any other exception, by
//    YIELDING error text. Every consumer of that generator decides "did this
//    provider work?" by whether a non-empty first chunk arrived, so a 500 was a
//    successful commit. Measured against a local 500:
//        [Vision] committed to Custom (OpenRouter) (attempt 1/1, ttft=11ms)
//    the healthy fallback rung behind it was never invoked, the provider was
//    recorded healthy, and the user's answer was the string
//        "Error: Custom Provider returned HTTP 500".
//
// B. NO FAILURE MEMORY IN THE SCREEN-UNDERSTANDING CHAIN.
//    runVisionFallback had none, so a rung that timed out every turn was still
//    tried FIRST every turn. Three consecutive screenshots against a dead
//    gateway cost 4001 / 4011 / 3959 ms of pre-pass — identical, forever.
//
// These are separate bugs with one shared consequence: the chain could not get
// past a broken provider to a working one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import fsSync from 'node:fs';
import Module, { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

const { runVisionFallback } = await import(
  pathToFileURL(path.join(screenDir, 'VisionProviderFallbackChain.js')).href
);

let fixturePath;
async function ensureFixture() {
  if (fixturePath) return fixturePath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-health-test-'));
  fixturePath = path.join(dir, 'tiny.png');
  await fs.writeFile(fixturePath, Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
    '53DE0000000C4944415478DA6364F800000200010001ACFCC8AF0000000049' +
    '454E44AE426082', 'hex',
  ));
  return fixturePath;
}

function rung(id, invoke, over = {}) {
  return {
    id, displayName: id, modelId: `${id}-model`,
    isLocal: false, isConfigured: true, supportsVision: true,
    scopeAllowsScreenshots: true, hint: 'openai', invoke, ...over,
  };
}

describe('B — a rung that just failed is not tried again immediately', () => {
  test('the second turn skips the dead rung and reaches the one behind it', async () => {
    const imagePath = await ensureFixture();
    const health = new Map();
    let now = 1_000_000;
    const clock = () => now;
    let deadCalls = 0;
    let goodCalls = 0;

    const providers = [
      rung('dead', (p) => new Promise((_r, reject) => {
        deadCalls++;
        p.signal.addEventListener('abort', () => reject(new Error('per-provider-timeout')), { once: true });
      })),
      rung('good', async () => { goodCalls++; return 'a description of the screen'; }),
    ];
    const run = () => runVisionFallback({
      imagePath, mode: 'vision_first', systemPrompt: 's', userPrompt: 'u',
      perProviderTimeoutMs: 150, providers, health, now: clock,
    });

    const first = await run();
    assert.equal(deadCalls, 1);
    assert.equal(first.ok, true, 'first turn still falls through to the good rung');

    // Second turn, inside the cooldown: the dead rung must not be attempted.
    now += 1000;
    const second = await run();
    assert.equal(deadCalls, 1, 'the dead rung was retried inside its cooldown');
    assert.equal(goodCalls, 2, 'the good rung must still serve the turn');
    assert.equal(second.ok, true);
    assert.ok(
      second.attempts.some((a) => a.provider === 'dead' && a.skipReason === 'circuit_open'),
      `expected a circuit_open skip, got ${JSON.stringify(second.attempts)}`,
    );
  });

  test('the cooldown EXPIRES — a recovered provider gets another chance', async () => {
    // Failure memory must not become a permanent ban; a 503 usually passes.
    const imagePath = await ensureFixture();
    const health = new Map();
    let now = 1_000_000;
    let attempts = 0;
    const providers = [rung('flaky', async () => {
      attempts++;
      if (attempts === 1) throw new Error('Custom Provider HTTP 503');
      return 'recovered';
    })];
    const run = () => runVisionFallback({
      imagePath, mode: 'vision_first', systemPrompt: 's', userPrompt: 'u',
      providers, health, now: () => now,
    });

    assert.equal((await run()).ok, false);
    now += 5_000;
    assert.equal((await run()).ok, false, 'still cooling down at +5s');
    now += 60_000;
    const third = await run();
    assert.equal(third.ok, true, 'after the cooldown the provider must be retried');
    assert.equal(third.outputText, 'recovered');
  });

  test('a bad key cools down far longer than a timeout', async () => {
    // A revoked key does not fix itself in 30s; a 503 often does. Same
    // magnitudes as visionStreamFallback so the two chains cannot disagree
    // about the same provider.
    const imagePath = await ensureFixture();
    const mk = async (message) => {
      const health = new Map();
      await runVisionFallback({
        imagePath, mode: 'vision_first', systemPrompt: 's', userPrompt: 'u',
        providers: [rung('p', async () => { throw new Error(message); })],
        health, now: () => 0,
      });
      return health.get('p').openUntil;
    };
    const authCooldown = await mk('Custom Provider HTTP 401 unauthorized');
    const transientCooldown = await mk('Custom Provider HTTP 503');
    assert.ok(authCooldown > transientCooldown,
      `auth ${authCooldown}ms should outlast transient ${transientCooldown}ms`);
  });

  test('everything cooling down reports all_vision_failed, NOT "no provider configured"', async () => {
    // The skip flags resolve failureReason. Folding circuit_open in with
    // not_configured would tell a user who HAS a provider that they have none.
    const imagePath = await ensureFixture();
    const health = new Map([['only', { openUntil: 9_999_999 }]]);
    const res = await runVisionFallback({
      imagePath, mode: 'vision_first', systemPrompt: 's', userPrompt: 'u',
      providers: [rung('only', async () => 'never reached')],
      health, now: () => 1000,
    });
    assert.equal(res.ok, false);
    assert.equal(res.failureReason, 'all_vision_failed');
    assert.notEqual(res.failureReason, 'no_vision_provider');
  });

  test('a request-shaped failure is NOT cooled down', async () => {
    // invalid_payload / no_vision describe THIS image or THIS model, not the
    // provider's health — the next screenshot deserves a fresh attempt.
    const imagePath = await ensureFixture();
    const health = new Map();
    await runVisionFallback({
      imagePath, mode: 'vision_first', systemPrompt: 's', userPrompt: 'u',
      providers: [rung('p', async () => { throw new Error('image payload too large'); })],
      health, now: () => 0,
    });
    assert.equal(health.has('p'), false, 'a payload error must not open the circuit');
  });

  test('omitting the health map keeps the previous memoryless behaviour', async () => {
    const imagePath = await ensureFixture();
    let calls = 0;
    const providers = [rung('p', async () => { calls++; throw new Error('boom'); })];
    const run = () => runVisionFallback({
      imagePath, mode: 'vision_first', systemPrompt: 's', userPrompt: 'u', providers,
    });
    await run(); await run();
    assert.equal(calls, 2, 'without a health map every turn retries, as before');
  });
});

describe('A — a provider failure reaches the caller AS a failure', () => {
  const cjs = createRequire(path.join(root, 'package.json'));
  const tmpUserData = fsSync.mkdtempSync(path.join(os.tmpdir(), 'custom-throw-'));
  const stub = new Module('electron');
  stub.exports = {
    app: { isReady: () => true, getPath: (n) => (n === 'userData' ? tmpUserData : os.tmpdir()), getName: () => 't', getVersion: () => '0', isPackaged: false },
    shell: { openPath: async () => '' }, safeStorage: { isEncryptionAvailable: () => false },
    ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
    BrowserWindow: { getAllWindows: () => [] },
  };
  stub.loaded = true;
  cjs.cache[cjs.resolve('electron')] = stub;
  const { LLMHelper } = cjs(path.join(root, 'dist-electron/electron/LLMHelper.js'));

  /** A helper whose active custom provider points at `url`. */
  function helperFor(url) {
    const h = new LLMHelper(undefined, false);
    h.setModel('cp', [{
      id: 'cp', name: 'OpenRouter', model: 'm',
      curlCommand: `curl -X POST ${url} -H "Content-Type: application/json" -d '{"model":"m","messages":[{"role":"user","content":"{{TEXT}}"}],"stream":true}'`,
    }]);
    return h;
  }

  async function withServer(handler, fn) {
    const server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try { return await fn(`http://127.0.0.1:${server.address().port}/`); }
    finally { server.close(); }
  }

  test('an HTTP 500 THROWS instead of yielding itself as the answer', async () => {
    await withServer((_q, res) => { res.writeHead(500); res.end('{"error":"overloaded"}'); }, async (url) => {
      const h = helperFor(url);
      const out = [];
      let thrown = null;
      try { for await (const c of h.streamWithCustom('q', undefined, undefined, 's')) out.push(c); }
      catch (e) { thrown = e; }
      assert.ok(thrown, 'a 500 must throw, not yield');
      // Message shape matches executeCustomProvider's, so both chains classify
      // the streaming and non-streaming twins identically.
      assert.match(thrown.message, /Custom Provider HTTP 500/);
      assert.equal(thrown.status, 500);
      assert.deepEqual(out, [], 'nothing may be yielded — a yielded chunk reads as a committed answer');
    });
  });

  test('a transport failure THROWS instead of yielding "Error streaming from custom provider."', async () => {
    // Nothing is listening on this port.
    const h = helperFor('http://127.0.0.1:1/');
    const out = [];
    let thrown = null;
    try { for await (const c of h.streamWithCustom('q', undefined, undefined, 's')) out.push(c); }
    catch (e) { thrown = e; }
    assert.ok(thrown, 'a transport error must throw');
    assert.deepEqual(out, []);
  });

  test('a CALLER ABORT still yields nothing and throws nothing', async () => {
    // Regression guard for the previous fix: a cancelled generator has nothing
    // to say, and must not look like an error either.
    await withServer(() => { /* hold the socket open */ }, async (url) => {
      const h = helperFor(url);
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 100);
      const out = [];
      let thrown = null;
      try { for await (const c of h.streamWithCustom('q', undefined, undefined, 's', ctrl.signal)) out.push(c); }
      catch (e) { thrown = e; }
      assert.equal(thrown, null, `a caller abort must not throw, got ${thrown?.message}`);
      assert.deepEqual(out, []);
    });
  });

  test('the vision chain can now FALL BACK past a failing custom provider', async () => {
    const { runStreamingVisionFallback, DEFAULT_VISION_FALLBACK_CONFIG } =
      cjs(path.join(root, 'dist-electron/electron/llm/visionStreamFallback.js'));
    await withServer((_q, res) => { res.writeHead(500); res.end('{}'); }, async (url) => {
      const h = helperFor(url);
      let backupReached = false;
      const stream = runStreamingVisionFallback(
        [
          { id: 'custom', name: 'Custom (OpenRouter)', isLocal: false, priority: 1,
            open: (sig) => h.streamWithCustom('q', undefined, undefined, 's', sig) },
          { id: 'backup', name: 'Backup', isLocal: false, priority: 2,
            open: async function* () { backupReached = true; yield 'A real answer.'; } },
        ],
        { ...DEFAULT_VISION_FALLBACK_CONFIG, maxAttempts: 1 },
        new Map(), {}, new AbortController().signal,
      );
      let answer = '';
      for await (const c of stream) answer += c;
      assert.equal(backupReached, true, 'the fallback rung was never reached');
      assert.equal(answer, 'A real answer.');
      assert.doesNotMatch(answer, /Error/, 'the user must never read the provider error as their answer');
    });
  });
});
