// electron/services/__tests__/telemetrySinks.test.mjs
//
// Contract tests for buildTelemetrySinks() — the stealth gate on remote
// telemetry. The whole point: in undetectable mode the app is hiding from an
// OS-level proctor, so it must NOT open outbound connections to third-party
// analytics hosts (PostHog / Axiom / Sentry). Local JSONL always remains (it
// never leaves the machine).
//
// The module under test is dependency-free (no electron / SettingsManager
// imports), so it loads in bare `node --test`. We import the COMPILED output
// (dist-electron/...), which is why `npm run build:electron` runs first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { buildTelemetrySinks } = require(
  path.join(repoRoot, 'dist-electron/electron/services/telemetry/telemetrySinks.js'),
);

const names = (sinks) => sinks.map((s) => s.name);

// All three remote credentials present — the "fully configured" case.
const FULL_ENV = {
  POSTHOG_API_KEY: 'phc_test',
  SENTRY_DSN: 'https://pk@o123.ingest.sentry.io/456',
  AXIOM_TOKEN: 'ax_test',
  AXIOM_DATASET: 'desktop',
};

test('undetectable: remote sinks are dropped even when every credential is set', () => {
  const sinks = buildTelemetrySinks(true, { env: { ...FULL_ENV }, getVersion: () => '9.9.9' });
  assert.deepEqual(names(sinks), ['local-jsonl']);
});

test('undetectable: the lone sink is local-jsonl and enabled', () => {
  const sinks = buildTelemetrySinks(true, { env: { ...FULL_ENV } });
  assert.equal(sinks.length, 1);
  assert.equal(sinks[0].name, 'local-jsonl');
  assert.equal(sinks[0].enabled, true);
});

test('normal mode, no credentials: local-jsonl only (unset = silently local-only)', () => {
  const sinks = buildTelemetrySinks(false, { env: {} });
  assert.deepEqual(names(sinks), ['local-jsonl']);
});

test('normal mode, all credentials: local-jsonl + posthog + sentry + axiom', () => {
  const sinks = buildTelemetrySinks(false, { env: { ...FULL_ENV }, getVersion: () => '9.9.9' });
  assert.deepEqual(names(sinks), ['local-jsonl', 'posthog', 'sentry', 'axiom']);
});

test('normal mode, partial credentials: only the configured remote sinks are added', () => {
  // Only PostHog configured → no sentry/axiom.
  assert.deepEqual(
    names(buildTelemetrySinks(false, { env: { POSTHOG_API_KEY: 'phc_test' } })),
    ['local-jsonl', 'posthog'],
  );
  // Only Axiom (needs BOTH token and dataset) → token alone is not enough.
  assert.deepEqual(
    names(buildTelemetrySinks(false, { env: { AXIOM_TOKEN: 'ax_test' } })),
    ['local-jsonl'],
  );
  assert.deepEqual(
    names(buildTelemetrySinks(false, { env: { AXIOM_TOKEN: 'ax_test', AXIOM_DATASET: 'desktop' } })),
    ['local-jsonl', 'axiom'],
  );
});

test('normal mode: sentry sink carries the app release + environment', () => {
  const sinks = buildTelemetrySinks(false, {
    env: { SENTRY_DSN: FULL_ENV.SENTRY_DSN, NODE_ENV: 'development' },
    getVersion: () => '2.9.1',
  });
  const sentry = sinks.find((s) => s.name === 'sentry');
  assert.equal(sentry.dsn, FULL_ENV.SENTRY_DSN);
  assert.equal(sentry.release, '2.9.1');
  assert.equal(sentry.environment, 'development');
});

test('normal mode: release falls back to APP_VERSION, then "unknown"', () => {
  const withAppVersion = buildTelemetrySinks(false, {
    env: { SENTRY_DSN: FULL_ENV.SENTRY_DSN, APP_VERSION: '1.2.3' },
  });
  assert.equal(withAppVersion.find((s) => s.name === 'sentry').release, '1.2.3');

  const withNeither = buildTelemetrySinks(false, { env: { SENTRY_DSN: FULL_ENV.SENTRY_DSN } });
  assert.equal(withNeither.find((s) => s.name === 'sentry').release, 'unknown');
});

test('normal mode: a persisted telemetryInstallId is reused, not regenerated', () => {
  const existing = 'nd_deadbeefcafe0001';
  let setCalls = 0;
  const sinks = buildTelemetrySinks(false, {
    env: { POSTHOG_API_KEY: 'phc_test' },
    getSetting: (k) => (k === 'telemetryInstallId' ? existing : undefined),
    setSetting: () => { setCalls += 1; },
  });
  assert.equal(sinks.find((s) => s.name === 'posthog').distinctId, existing);
  assert.equal(setCalls, 0, 'must not overwrite an existing install id');
});

test('normal mode: a missing telemetryInstallId is generated and persisted once', () => {
  let stored;
  let setCalls = 0;
  const sinks = buildTelemetrySinks(false, {
    env: { POSTHOG_API_KEY: 'phc_test' },
    getSetting: (k) => (k === 'telemetryInstallId' ? stored : undefined),
    setSetting: (k, v) => { setCalls += 1; if (k === 'telemetryInstallId') stored = v; },
  });
  const distinctId = sinks.find((s) => s.name === 'posthog').distinctId;
  assert.match(distinctId, /^nd_[0-9a-f]{16}$/);
  assert.equal(setCalls, 1);
  assert.equal(stored, distinctId, 'the generated id is what gets persisted');
});

test('normal mode: settings accessors absent → distinctId stays undefined (no throw)', () => {
  const sinks = buildTelemetrySinks(false, { env: { POSTHOG_API_KEY: 'phc_test' } });
  const posthog = sinks.find((s) => s.name === 'posthog');
  assert.equal(posthog.distinctId, undefined);
});

test('defaults: with no deps at all it reads process.env and never throws', () => {
  // No env object → uses process.env. We don't know what the CI env has, so we
  // only assert the invariant that ALWAYS holds: local-jsonl is first, and the
  // result is a non-empty array of {name, enabled} shapes.
  const sinks = buildTelemetrySinks(true);
  assert.equal(sinks[0].name, 'local-jsonl');
  assert.ok(Array.isArray(sinks) && sinks.length >= 1);
});
