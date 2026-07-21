// Client TelemetryService remote sinks (PostHog / Axiom / Sentry) — the live
// dispatch that was previously a no-op placeholder. Drives the COMPILED service
// with a fake globalThis.fetch (no network). Proves:
//   • PostHog: /capture/ POST with api_key + hashed distinct_id + event name
//   • Axiom: ingest POST with Bearer token + _time + kind
//   • Sentry: ONLY error-ish events ship an envelope; analytics events skipped
//   • unconfigured sink (no credential) → silently skipped
//   • a sink dispatch failure never throws / never breaks track()
//   • secrets never appear in the local JSONL record

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const telemetryPath = path.resolve(process.cwd(), 'dist-electron/electron/services/telemetry/TelemetryService.js');
const { TelemetryService, parseClientSentryDsn } = await import(pathToFileURL(telemetryPath).href);

function withFakeFetch(fn) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); };
  try { return fn(calls); } finally { globalThis.fetch = orig; }
}

function tmpLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tel-')), 'events.jsonl');
}

test('PostHog sink: /capture/ POST with api_key + distinct_id + event', () => {
  withFakeFetch((calls) => {
    const svc = new TelemetryService({
      enabled: true, localEnabled: false, logFilePath: tmpLog(),
      sinks: [{ name: 'posthog', enabled: true, apiKey: 'phk_test', endpoint: 'https://us.posthog.com/', distinctId: 'nd_abc' }],
    });
    svc.track({ name: 'relay_connected', properties: { region: 'us' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://us.posthog.com/capture/');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.api_key, 'phk_test');
    assert.equal(body.event, 'relay_connected');
    assert.equal(body.distinct_id, 'nd_abc');
    assert.equal(body.properties.region, 'us');
  });
});

test('Axiom sink: ingest POST with Bearer token + _time + kind', () => {
  withFakeFetch((calls) => {
    const svc = new TelemetryService({
      enabled: true, localEnabled: false, logFilePath: tmpLog(),
      sinks: [{ name: 'axiom', enabled: true, apiKey: 'axm_tok', dataset: 'natively-desktop' }],
    });
    svc.track({ name: 'meeting_start', properties: { mode: 'interview' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.axiom.co/v1/datasets/natively-desktop/ingest');
    assert.match(calls[0].opts.headers.Authorization, /^Bearer axm_tok$/);
    const arr = JSON.parse(calls[0].opts.body);
    assert.equal(arr[0].kind, 'meeting_start');
    assert.equal(arr[0].source, 'desktop');
    assert.ok(arr[0]._time, 'has _time');
  });
});

test('Sentry sink: error-ish events ship an envelope; analytics events are skipped', () => {
  withFakeFetch((calls) => {
    const svc = new TelemetryService({
      enabled: true, localEnabled: false, logFilePath: tmpLog(),
      sinks: [{ name: 'sentry', enabled: true, dsn: 'https://pub@o1.ingest.sentry.io/9', release: 'v2', environment: 'production' }],
    });
    // analytics event → skipped
    svc.track({ name: 'meeting_start' });
    assert.equal(calls.length, 0, 'non-error events do not go to Sentry');
    // error event by status → shipped
    svc.track({ name: 'provider_error', status: 'error', properties: { provider: 'deepgram' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://o1.ingest.sentry.io/api/9/envelope/');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/x-sentry-envelope');
    const lines = calls[0].opts.body.trim().split('\n');
    assert.equal(lines.length, 3, 'header + itemHeader + event');
    const ev = JSON.parse(lines[2]);
    assert.equal(ev.level, 'error');
    assert.equal(ev.release, 'v2');
    assert.equal(ev.tags.event, 'provider_error');
  });
});

test('unconfigured sink (no credential) is silently skipped', () => {
  withFakeFetch((calls) => {
    const svc = new TelemetryService({
      enabled: true, localEnabled: false, logFilePath: tmpLog(),
      sinks: [{ name: 'posthog', enabled: true /* no apiKey */ }, { name: 'sentry', enabled: true /* no dsn */ }],
    });
    svc.track({ name: 'app_start' });
    svc.track({ name: 'provider_error', status: 'error' });
    assert.equal(calls.length, 0, 'no credential → no send');
  });
});

test('a sink dispatch failure never throws and never breaks track()', () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('sync boom'); };
  try {
    const logFile = tmpLog();
    const svc = new TelemetryService({
      enabled: true, localEnabled: true, logFilePath: logFile,
      sinks: [{ name: 'posthog', enabled: true, apiKey: 'k' }],
    });
    assert.doesNotThrow(() => svc.track({ name: 'meeting_start' }));
    // local sink still wrote despite the remote failure
    assert.ok(fs.readFileSync(logFile, 'utf8').includes('meeting_start'), 'local JSONL unaffected');
  } finally { globalThis.fetch = orig; }
});

test('local JSONL record never contains a sink credential', () => {
  const logFile = tmpLog();
  const svc = new TelemetryService({
    enabled: true, localEnabled: true, logFilePath: logFile,
    sinks: [{ name: 'posthog', enabled: true, apiKey: 'phk_super_secret' }, { name: 'sentry', enabled: true, dsn: 'https://secretpub@o1.ingest.sentry.io/9' }],
  });
  svc.track({ name: 'app_start', properties: { platform: 'mac' } });
  const written = fs.readFileSync(logFile, 'utf8');
  assert.ok(!written.includes('phk_super_secret'), 'posthog key never in local record');
  assert.ok(!written.includes('secretpub'), 'sentry dsn never in local record');
});

test('parseClientSentryDsn parses valid DSNs and rejects junk', () => {
  const ok = parseClientSentryDsn('https://abc@o5.ingest.sentry.io/77');
  assert.ok(ok);
  assert.equal(ok.envelopeUrl, 'https://o5.ingest.sentry.io/api/77/envelope/');
  assert.equal(parseClientSentryDsn(''), null);
  assert.equal(parseClientSentryDsn('garbage'), null);
});
