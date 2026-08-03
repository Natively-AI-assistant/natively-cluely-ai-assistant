// Vision-first fallback chain — unit tests with deterministic fake providers.
// Proves the chain honors:
//   - first-success-wins ordering
//   - skip-on-not-configured / no-vision / scope-blocked / privacy-blocked
//   - per-provider timeout and abort signal propagation
//   - failure-reason resolution when nothing succeeded
//   - that OCR modules are NEVER imported by this code path

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

async function loadChain() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'VisionProviderFallbackChain.js')).href);
  return mod.runVisionFallback;
}

async function loadOptimizer() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'ImageOptimizer.js')).href);
  return mod.ImageOptimizer;
}

// Create a tiny PNG fixture once per test file (Sharp can read it; chain treats
// it as a valid source even if the fake provider ignores the bytes).
let fixturePath;
async function ensureFixture() {
  if (fixturePath) return fixturePath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-chain-test-'));
  fixturePath = path.join(dir, 'tiny.png');
  // Minimal valid PNG: 1x1 white pixel.
  const png = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
    '53DE0000000C4944415478DA6364F800000200010001ACFCC8AF0000000049' +
    '454E44AE426082',
    'hex',
  );
  await fs.writeFile(fixturePath, png);
  return fixturePath;
}

function makeFakeProvider(overrides = {}) {
  return {
    id: 'fake-' + Math.random().toString(36).substring(2, 8),
    displayName: 'Fake',
    modelId: 'fake-model',
    isLocal: false,
    isConfigured: true,
    supportsVision: true,
    scopeAllowsScreenshots: true,
    hint: 'generic',
    invoke: async () => 'fake output',
    ...overrides,
  };
}

test('first provider succeeds → chain returns immediately, second never invoked', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  let secondInvoked = false;
  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'p1', invoke: async () => 'answer from p1' }),
      makeFakeProvider({ id: 'p2', invoke: async () => { secondInvoked = true; return 'p2'; } }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerUsed, 'p1');
  assert.equal(result.outputText, 'answer from p1');
  assert.equal(secondInvoked, false, 'second provider must not be invoked after first success');
  await optimizer.cleanupAll();
});

test('first provider fails → chain falls back to second and succeeds', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'p1', invoke: async () => { throw new Error('500 server error'); } }),
      makeFakeProvider({ id: 'p2', invoke: async () => 'recovered by p2' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerUsed, 'p2');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[0].errorClass, 'provider_error');
  assert.equal(result.attempts[1].ok, true);
  await optimizer.cleanupAll();
});

test('all providers fail → ok=false with failureReason=all_vision_failed', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'p1', invoke: async () => { throw new Error('429 rate limit'); } }),
      makeFakeProvider({ id: 'p2', invoke: async () => { throw new Error('500'); } }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'all_vision_failed');
  assert.equal(result.attempts[0].errorClass, 'rate_limited');
  assert.equal(result.attempts[1].errorClass, 'provider_error');
  await optimizer.cleanupAll();
});

test('no providers configured → ok=false with failureReason=no_vision_provider', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'p1', isConfigured: false }),
      makeFakeProvider({ id: 'p2', isConfigured: false }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'no_vision_provider');
  assert.equal(result.attempts[0].skipped, true);
  assert.equal(result.attempts[0].skipReason, 'not_configured');
  await optimizer.cleanupAll();
});

test('private_vision skips every non-local provider with privacy_blocked', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'private_vision',
    providers: [
      makeFakeProvider({ id: 'openai', isLocal: false, invoke: async () => 'should not run' }),
      makeFakeProvider({ id: 'claude', isLocal: false, invoke: async () => 'should not run' }),
      makeFakeProvider({ id: 'ollama', isLocal: true, invoke: async () => 'local answer' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerUsed, 'ollama');
  const openaiAttempt = result.attempts.find(a => a.provider === 'openai');
  assert.equal(openaiAttempt?.skipReason, 'privacy_blocked');
  await optimizer.cleanupAll();
});

test('private_vision with no local provider → failureReason=privacy_blocked', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'private_vision',
    providers: [
      makeFakeProvider({ id: 'openai', isLocal: false }),
      makeFakeProvider({ id: 'claude', isLocal: false }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'privacy_blocked');
  await optimizer.cleanupAll();
});

test('custom provider with scope_blocked is skipped with scope_blocked reason', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'custom', scopeAllowsScreenshots: false, invoke: async () => 'unreachable' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'scope_blocked');
  assert.equal(result.attempts[0].skipped, true);
  assert.equal(result.attempts[0].skipReason, 'scope_blocked');
  await optimizer.cleanupAll();
});

test('text-only provider (supportsVision=false) is skipped with no_vision reason', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'text-only', supportsVision: false, invoke: async () => { throw new Error('should not invoke'); } }),
      makeFakeProvider({ id: 'vision-ok', invoke: async () => 'ok' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerUsed, 'vision-ok');
  assert.equal(result.attempts[0].skipReason, 'no_vision');
  await optimizer.cleanupAll();
});

test('per-provider timeout triggers errorClass=timeout and falls back', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({
        id: 'slow',
        timeoutMs: 50,
        invoke: ({ signal }) => new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      }),
      makeFakeProvider({ id: 'fast', invoke: async () => 'fast answer' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerUsed, 'fast');
  assert.equal(result.attempts[0].errorClass, 'timeout');
  await optimizer.cleanupAll();
});

test('empty string output is treated as provider error, chain continues', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();

  const result = await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'empty', invoke: async () => '   ' }),
      makeFakeProvider({ id: 'good', invoke: async () => 'real answer' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerUsed, 'good');
  assert.equal(result.attempts[0].errorClass, 'provider_error');
  await optimizer.cleanupAll();
});

test('telemetry callback fires for attempt, success, fallback, failed, skipped', async () => {
  const runVisionFallback = await loadChain();
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const img = await ensureFixture();
  const events = [];

  await runVisionFallback({
    imagePath: img,
    mode: 'vision_first',
    providers: [
      makeFakeProvider({ id: 'unconfigured', isConfigured: false }),
      makeFakeProvider({ id: 'broken', invoke: async () => { throw new Error('500'); } }),
      makeFakeProvider({ id: 'works', invoke: async () => 'ok' }),
    ],
    systemPrompt: 'sys',
    userPrompt: 'user',
    optimizer,
    telemetry: (e) => events.push(e),
  });

  const types = events.map(e => e.type);
  assert.ok(types.includes('vision_skipped'), 'expected vision_skipped event');
  assert.ok(types.includes('vision_attempt'), 'expected vision_attempt event');
  assert.ok(types.includes('vision_failed'), 'expected vision_failed event');
  assert.ok(types.includes('vision_fallback'), 'expected vision_fallback event');
  assert.ok(types.includes('vision_success'), 'expected vision_success event');
  // Critical: no event should leak image path, base64, or prompt text.
  for (const e of events) {
    const json = JSON.stringify(e);
    assert.ok(!json.includes('user'), `event leaked prompt body: ${json}`);
    assert.ok(!json.includes(img), `event leaked image path: ${json}`);
    assert.ok(!json.includes('base64'), `event leaked base64 marker: ${json}`);
  }
  await optimizer.cleanupAll();
});

test('OCR modules are not imported by the vision fallback chain source', async () => {
  // ESM has no require.cache; verify at the source-import level instead — the
  // chain file must not statically import any OCR module.
  const chainSource = await fs.readFile(path.join(screenDir, 'VisionProviderFallbackChain.js'), 'utf8');
  assert.ok(!/OcrProvider/.test(chainSource), 'VisionProviderFallbackChain.js must not reference OcrProvider');
  assert.ok(!/OcrProviderManager/.test(chainSource), 'VisionProviderFallbackChain.js must not reference OcrProviderManager');
  assert.ok(!/tesseract/i.test(chainSource), 'VisionProviderFallbackChain.js must not reference tesseract');

  const registrySource = await fs.readFile(path.join(screenDir, 'VisionProviderRegistry.js'), 'utf8');
  assert.ok(!/OcrProvider/.test(registrySource), 'VisionProviderRegistry.js must not reference OcrProvider');
  assert.ok(!/tesseract/i.test(registrySource), 'VisionProviderRegistry.js must not reference tesseract');

  const susSource = await fs.readFile(path.join(screenDir, 'ScreenUnderstandingService.js'), 'utf8');
  assert.ok(!/OcrProvider/.test(susSource), 'ScreenUnderstandingService.js must not reference OcrProvider');
  assert.ok(!/tesseract/i.test(susSource), 'ScreenUnderstandingService.js must not reference tesseract');
});
