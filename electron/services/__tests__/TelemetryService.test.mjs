import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const telemetryPath = path.resolve(process.cwd(), 'dist-electron/electron/services/telemetry/TelemetryService.js');
const { TelemetryService, sanitizeTelemetryProperties } = await import(pathToFileURL(telemetryPath).href);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'natively-telemetry-test-'));
}

function readRecords(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.trimEnd().split('\n').map(line => JSON.parse(line));
}

test('event append writes JSONL locally when enabled', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'telemetry.jsonl');
  const service = new TelemetryService({ enabled: true, logFilePath: filePath });

  service.track({ name: 'app_start', sessionId: 'session-1', properties: { version: '2.6.0' } });

  const records = readRecords(filePath);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'app_start');
  assert.equal(records[0].sessionId, 'session-1');
  assert.equal(records[0].properties.version, '2.6.0');
  assert.match(records[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('disabled service does not write', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'telemetry.jsonl');
  const service = new TelemetryService({ enabled: false, logFilePath: filePath });

  service.track({ name: 'meeting_start', properties: { safe: true } });

  assert.equal(fs.existsSync(filePath), false);
});

test('API keys and tokens are redacted from properties', () => {
  const sanitized = sanitizeTelemetryProperties({
    apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz1234567890',
    nested: {
      token: 'natively_sk_supersecretvalue',
      message: 'failed with gsk_abcdefghijklmnopqrstuvwxyz123456',
    },
  });

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(serialized, /Bearer abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(serialized, /natively_sk_supersecretvalue/);
  assert.doesNotMatch(serialized, /gsk_abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('transcript, reference, prompt, and screenshot-like fields are removed or replaced', () => {
  const sanitized = sanitizeTelemetryProperties({
    transcript: 'raw transcript should not persist',
    rawPrompt: 'reference and prompt should not persist',
    referenceContent: 'customer private docs',
    screenshotPath: '/Users/example/Desktop/private-shot.png',
    safeCount: 3,
  });

  assert.equal(sanitized.transcript, '[REMOVED]');
  assert.equal(sanitized.rawPrompt, '[REMOVED]');
  assert.equal(sanitized.referenceContent, '[REMOVED]');
  assert.equal(sanitized.screenshotPath, '[REMOVED]');
  assert.equal(sanitized.safeCount, 3);
  assert.doesNotMatch(JSON.stringify(sanitized), /raw transcript|customer private|private-shot/);
});

test('dynamic action lifecycle event payload contains no evidence text', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'telemetry.jsonl');
  const service = new TelemetryService({ logFilePath: filePath });

  service.track({
    name: 'dynamic_action_detected',
    sessionId: 'meeting-1',
    modeId: 'sales',
    status: 'shown',
    properties: {
      actionId: 'answer-objection',
      actionType: 'objection-help',
      evidenceText: 'customer said secret contract details',
    },
  });

  const [record] = readRecords(filePath);
  assert.equal(record.name, 'dynamic_action_detected');
  assert.equal(record.properties.actionType, 'objection-help');
  assert.equal(record.properties.evidenceText, '[REMOVED]');
  assert.doesNotMatch(JSON.stringify(record), /secret contract/);
});

test('provider fallback and error events retain safe metadata but no raw body', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'telemetry.jsonl');
  const service = new TelemetryService({ logFilePath: filePath });

  service.track({
    name: 'provider_error',
    provider: 'openai',
    status: '429',
    durationMs: 321,
    properties: {
      fallbackProvider: 'groq',
      errorBody: '{"error":"contains raw request and sk-abcdefghijklmnopqrstuvwxyz123456"}',
      httpStatus: 429,
    },
  });

  const [record] = readRecords(filePath);
  assert.equal(record.provider, 'openai');
  assert.equal(record.status, '429');
  assert.equal(record.durationMs, 321);
  assert.equal(record.properties.fallbackProvider, 'groq');
  assert.equal(record.properties.httpStatus, 429);
  assert.equal(record.properties.errorBody, '[REMOVED]');
  assert.doesNotMatch(JSON.stringify(record), /contains raw request|sk-abcdefghijklmnopqrstuvwxyz123456/);
});

test('invalid and unserializable properties do not crash', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'telemetry.jsonl');
  const service = new TelemetryService({ logFilePath: filePath });
  const circular = { safe: 'ok' };
  circular.self = circular;
  circular.fn = () => 'not serializable';
  circular.symbol = Symbol('private');

  assert.doesNotThrow(() => service.track({ name: 'stt_error', properties: circular }));
  const [record] = readRecords(filePath);
  assert.equal(record.properties.safe, 'ok');
  assert.equal(record.properties.self, '[Circular]');
  assert.equal('fn' in record.properties, false);
  assert.equal('symbol' in record.properties, false);
});

test('JSONL records are one event per line', () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, 'telemetry.jsonl');
  const service = new TelemetryService({ logFilePath: filePath });

  service.track({ name: 'llm_request_started', provider: 'anthropic' });
  service.track({ name: 'llm_completed', provider: 'anthropic', durationMs: 42 });

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
    assert.doesNotMatch(line, /\n/);
  }
});
