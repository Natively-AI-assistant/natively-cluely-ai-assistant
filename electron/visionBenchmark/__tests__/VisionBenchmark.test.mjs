import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const core = require('../../../dist-electron/electron/visionBenchmark/core.js');
const { VisionBenchmarkRunner } = require('../../../dist-electron/electron/visionBenchmark/runner.js');
const { exportBenchmarkSession } = require('../../../dist-electron/electron/visionBenchmark/report.js');

test('mean, median, standard deviation and interpolated percentiles are deterministic', () => {
  assert.equal(core.mean([1, 2, 3, 4]), 2.5);
  assert.equal(core.median([4, 1, 3, 2]), 2.5);
  assert.equal(core.percentile([0, 10, 20, 30], 75), 22.5);
  assert.equal(core.standardDeviation([2, 2, 2]), 0);
});

test('speed calculations handle missing and zero durations', () => {
  assert.equal(core.ratePerSecond(10, 1000), 10);
  assert.equal(core.ratePerSecond(10, 0), undefined);
  assert.equal(core.ratePerSecond(undefined, 1000), undefined);
});

test('prompt hash includes both channels and is stable', () => {
  assert.equal(core.promptHash('system', 'user'), core.promptHash('system', 'user'));
  assert.notEqual(core.promptHash('system', 'user'), core.promptHash('system', 'other'));
});

test('randomized order keeps all models and can be deterministic', () => {
  assert.deepEqual(core.randomizedOrder([1, 2, 3], false), [1, 2, 3]);
  assert.deepEqual([...core.randomizedOrder([1, 2, 3], true, () => 0)].sort(), [1, 2, 3]);
});

test('secret redaction removes credentials and long base64 payloads', () => {
  const value = core.redactSecrets({
    authorization: 'Bearer hidden',
    apiKey: 'AIza' + 'x'.repeat(30),
    nested: 'Bearer definitely-secret',
    image: 'A'.repeat(700),
  });
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /definitely-secret|AIza|A{512}/);
  assert.match(serialized, /REDACTED|BINARY OMITTED/);
});

test('failed runs are excluded from distributions', () => {
  const model = { label: 'M', modelId: 'm', enabled: true, source: 'benchmark-config' };
  const base = {
    id: '1', model, runNumber: 1, warmup: false, executionOrder: 1, startedAtIso: '',
    promptHash: '', image: { processingDurationMs: 1, submittedBytes: 10 }, requestAssemblyMs: 1,
    endToEndLatencyMs: 1, usage: {}, response: '', reasoning: '', trace: [], checks: {},
  };
  const stats = core.calculateStatistics([model], [
    { ...base, success: true, requestTtftMs: 100 },
    { ...base, id: '2', success: false, requestTtftMs: 900 },
  ]);
  assert.equal(stats[0].metrics.requestTtftMs.count, 1);
  assert.equal(stats[0].metrics.requestTtftMs.median, 100);
});

test('image pipeline extracts metadata and encodes supported input in memory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-vision-test-'));
  const image = path.join(dir, 'screen.png');
  await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#ffffff' } }).png().toFile(image);
  const result = await core.processBenchmarkImage(image, 'high');
  assert.equal(result.metadata.sourceMimeType, 'image/png');
  assert.equal(result.metadata.submittedMimeType, 'image/jpeg');
  assert.equal(result.metadata.originalWidth, 1800);
  assert.equal(result.metadata.submittedWidth, 1536);
  assert.ok(result.metadata.submittedBytes > 0);
  await fs.rm(dir, { recursive: true });
});

function baseConfig(imagePath) {
  return {
    imagePath, modelIds: ['mock-model'], promptKind: 'general-vision', mode: 'general',
    question: 'Read the screen.', measuredRuns: 1, warmupRuns: 0, thinking: 'minimal',
    resolution: 'fast', temperature: 0, maxOutputTokens: 100, execution: 'sequential',
    connection: 'warm', randomizeModelOrder: false, timeoutMs: 2000, interRunDelayMs: 0,
    includeScreenshotInExport: false,
  };
}

test('mocked stream records provider, reasoning, and TTFT only on first non-empty visible delta', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-stream-test-'));
  const image = path.join(dir, 'screen.webp');
  await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ffffff' } }).webp().toFile(image);
  const client = {
    models: {
      async generateContentStream() {
        return (async function* () {
          yield { candidates: [{ content: { parts: [] } }] }; // metadata
          yield { candidates: [{ content: { parts: [{ text: '' }] } }] }; // empty visible
          yield { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] } }] };
          yield { candidates: [{ content: { parts: [{ text: 'Visible ' }] } }] };
          yield { candidates: [{ content: { parts: [{ text: 'answer' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 25 } };
        })();
      },
    },
  };
  let clock = 0;
  const runner = new VisionBenchmarkRunner({ apiKey: 'test-only', createClient: () => client, now: () => (clock += 10) });
  const model = { label: 'Mock', modelId: 'mock-model', enabled: true, source: 'benchmark-config' };
  const session = await runner.run(baseConfig(image), [model]);
  const run = session.runs[0];
  assert.equal(run.response, 'Visible answer');
  assert.equal(run.reasoning, 'thinking');
  assert.ok(run.providerEventLatencyMs < run.reasoningLatencyMs);
  assert.ok(run.reasoningLatencyMs < run.requestTtftMs);
  assert.equal(run.trace.filter((event) => event.type === 'answer').length, 1);
  assert.equal(run.usage.visibleOutputTokens, 3);
  await fs.rm(dir, { recursive: true });
});

test('configuration validation rejects zero measured runs before provider use', async () => {
  const runner = new VisionBenchmarkRunner({ apiKey: 'test-only', createClient: () => ({ models: {} }) });
  const model = { label: 'Mock', modelId: 'mock-model', enabled: true, source: 'benchmark-config' };
  await assert.rejects(runner.run({ ...baseConfig('/tmp/nope.png'), measuredRuns: 0 }, [model]), /Measured runs/);
});

test('cancellation preserves a cancelled session and prevents later runs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-cancel-test-'));
  const image = path.join(dir, 'screen.jpg');
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toFile(image);
  const client = { models: { generateContentStream: ({ config }) => new Promise((_, reject) => config.abortSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })) } };
  const runner = new VisionBenchmarkRunner({ apiKey: 'test-only', createClient: () => client });
  const model = { label: 'Mock', modelId: 'mock-model', enabled: true, source: 'benchmark-config' };
  const session = await runner.run({ ...baseConfig(image), measuredRuns: 3 }, [model], { onRunStarted: () => setTimeout(() => runner.cancel(), 20) });
  assert.equal(session.status, 'cancelled');
  assert.equal(session.runs.length, 1);
  assert.equal(session.runs[0].error.code, 'cancelled');
  await fs.rm(dir, { recursive: true });
});

test('timeout is classified without retrying', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-timeout-test-'));
  const image = path.join(dir, 'screen.jpg');
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toFile(image);
  let attempts = 0;
  const client = { models: { generateContentStream: ({ config }) => { attempts++; return new Promise((_, reject) => config.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } } };
  const runner = new VisionBenchmarkRunner({ apiKey: 'test-only', createClient: () => client });
  const model = { label: 'Mock', modelId: 'mock-model', enabled: true, source: 'benchmark-config' };
  const session = await runner.run({ ...baseConfig(image), timeoutMs: 1000 }, [model]);
  assert.equal(session.runs[0].error.code, 'timeout');
  assert.equal(attempts, 1);
  await fs.rm(dir, { recursive: true });
});

test('report generation exports expected files without binary request data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-report-test-'));
  const image = path.join(dir, 'screen.png');
  await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toFile(image);
  const model = { label: 'Mock', modelId: 'mock-model', enabled: true, source: 'benchmark-config' };
  const session = {
    id: 'session', status: 'completed', initiatedAtIso: '2026-01-01T00:00:00.000Z',
    config: { ...baseConfig(image), outputRoot: path.join(dir, 'out') }, models: [model],
    prompt: { selectedMode: 'general', builder: 'GENERAL', systemPrompt: 'safe', userMessage: 'safe', systemPromptCharacters: 4, userMessageCharacters: 4, screenshotAttached: true, promptHash: 'hash' },
    runs: [], statistics: [], executionOrder: [], balancedWeights: { latency: .45, quality: .45, reliability: .1 },
  };
  const output = await exportBenchmarkSession(session, path.resolve('.'));
  for (const file of ['summary.md','summary.csv','runs.csv','results.json','config.json','environment.json']) await fs.access(path.join(output, file));
  const results = await fs.readFile(path.join(output, 'results.json'), 'utf8');
  assert.doesNotMatch(results, /data:image|[A-Za-z0-9+/]{512}/);
  assert.doesNotMatch(results, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await fs.rm(dir, { recursive: true });
});

test('benchmark stays CLI-only and exposes no app-facing IPC surface', async () => {
  const files = await fs.readdir(path.resolve('electron/visionBenchmark'));
  assert.ok(!files.includes('ipc.ts'), 'the in-app benchmark surface was removed; do not reintroduce it');
  for (const file of files.filter((name) => name.endsWith('.ts'))) {
    const source = await fs.readFile(path.resolve('electron/visionBenchmark', file), 'utf8');
    assert.doesNotMatch(source, /ipcMain|safeHandle/, `${file} must not register IPC handlers`);
  }
});

test('benchmark credentials use GEMINI_API_KEY_1 exclusively', async () => {
  const cliSource = await fs.readFile(path.resolve('electron/visionBenchmark/cli.ts'), 'utf8');
  assert.match(cliSource, /process\.env\.GEMINI_API_KEY_1/);
  assert.doesNotMatch(cliSource, /getGeminiApiKey|process\.env\.GEMINI_API_KEY(?!_1)|process\.env\.GOOGLE_API_KEY/);
});
