import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const providerSource = readFileSync(path.join(root, 'electron/audio/GigaSTTStreamingSTT.ts'), 'utf8');
const mainSource = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const credentialsSource = readFileSync(path.join(root, 'electron/services/CredentialsManager.ts'), 'utf8');
const settingsSource = readFileSync(path.join(root, 'src/components/SettingsOverlay.tsx'), 'utf8');

test('GigaSTT provider uses the local WebSocket endpoint and emits final transcripts', () => {
  assert.match(providerSource, /ws:\/\/127\.0\.0\.1:9876\/v1\/ws/);
  assert.match(providerSource, /new WebSocket\(this\.url\)/);
  assert.match(providerSource, /msg\.type === 'ready'/);
  assert.match(providerSource, /msg\.type === 'final'/);
  assert.match(providerSource, /this\.emit\('transcript'/);
});

test('GigaSTT waits for server readiness and configures the actual stream sample rate before audio', () => {
  assert.match(providerSource, /WebSocket opened; waiting for server ready/);
  assert.match(providerSource, /this\.sendConfigure\(\);\s*this\.flushBuffer\(\);/s);
  assert.match(providerSource, /type: 'configure'/);
  assert.match(providerSource, /sample_rate: effectiveSampleRate/);
  assert.match(providerSource, /DEFAULT_GIGASTT_SAMPLE_RATE = 16_000/);
  assert.doesNotMatch(providerSource, /GIGASTT_EXPECTED_SAMPLE_RATE/);
});

test('GigaSTT provider auto-starts the local server with enough pool capacity for mic and system channels', () => {
  assert.match(providerSource, /ensureManagedGigaSTTServer/);
  assert.match(providerSource, /'serve', '--pool-size', MANAGED_GIGASTT_POOL_SIZE/);
  assert.match(providerSource, /MANAGED_GIGASTT_POOL_SIZE = '2'/);
  assert.match(providerSource, /\/opt\/homebrew\/bin\/gigastt/);
  assert.match(providerSource, /ECONNREFUSED/);
  assert.match(providerSource, /waitForGigaSTTReady/);
});

test('GigaSTT refuses known CoreML-broken runtime versions before auto-starting', () => {
  assert.match(providerSource, /MIN_RELIABLE_GIGASTT_VERSION = '2\.0\.14'/);
  assert.match(providerSource, /getGigaSTTBinaryStatus/);
  assert.match(providerSource, /binary\.meetsMinimum/);
  assert.match(providerSource, /too old for stable Russian STT/);
  assert.match(providerSource, /--version/);
});

test('GigaSTT recovers an unhealthy local server that closes WebSocket before ready', () => {
  assert.match(providerSource, /DEFAULT_GIGASTT_PORT = 9876/);
  assert.match(providerSource, /recoverUnhealthyGigaSTTServer/);
  assert.match(providerSource, /getGigaSTTListenerPids/);
  assert.match(providerSource, /isGigaSTTServeProcess/);
  assert.match(providerSource, /closedBeforeReady[\s\S]*code === 1006/);
  assert.match(providerSource, /WebSocket closed before ready; restarting unhealthy GigaSTT server/);
  assert.match(providerSource, /process\.kill\(pid, 'SIGTERM'\)/);
  assert.match(providerSource, /await ensureManagedGigaSTTServer\(\)/);
});

test('GigaSTT is wired into the main STT provider factory', () => {
  assert.match(mainSource, /import \{ GigaSTTStreamingSTT \}/);
  assert.match(mainSource, /sttProvider === 'gigastt'/);
  assert.match(mainSource, /new GigaSTTStreamingSTT/);
});

test('GigaSTT is persisted as a valid credential provider without API key UI', () => {
  assert.match(credentialsSource, /'gigastt'/);
  assert.match(settingsSource, /\{ id: 'gigastt', label: 'GigaSTT'/);
  assert.match(settingsSource, /sttProvider !== 'gigastt'/);
  assert.match(settingsSource, /sttProvider === 'gigastt'\) return/);
});
