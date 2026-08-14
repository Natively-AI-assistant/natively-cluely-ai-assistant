// electron/llm/__tests__/RolloutAndTelemetry2026_06_07c.test.mjs
//
// Release 2026-06-07c — rollout controls (percent gate + kill switch + deterministic
// bucketing) and marker-only telemetry (no raw sensitive content).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href);
const { resolveLiveSessionMemoryConfig, isLiveSessionMemoryEnabled, sessionBucket, __resetLiveSessionMemoryCache, piTelemetry, scrubTelemetry, ageBucket } = m;

// NOTE: deliberately does NOT mutate NODE_ENV or BENCHMARK_MODEL — those are read by
// other test files running concurrently (node:test parallelizes across files), so
// mutating them here would cause cross-file flakes. We use NATIVELY_INTERNAL/_DEV
// (read by nothing else) to exercise the internal-context tier.
const ENV_KEYS = [
  'NATIVELY_ENABLE_LIVE_SESSION_MEMORY', 'NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT',
  'NATIVELY_LIVE_SESSION_MEMORY_KILL_SWITCH', 'NATIVELY_INTERNAL', 'NATIVELY_DEV',
];
let saved = {};
beforeEach(() => { saved = {}; for (const k of ENV_KEYS) saved[k] = process.env[k]; for (const k of ENV_KEYS) delete process.env[k]; __resetLiveSessionMemoryCache(); });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } __resetLiveSessionMemoryCache(); });

describe('Rollout — production default ON (PI v3 W6d), overrides still win', () => {
  // PI v3 (W6d): the default flipped ON after live-replay validation
  // (50 sessions / 132 checks / 0 leaks). Kill switch + env + settings +
  // percentage overrides all still force OFF (covered below).
  test('production (no env, no internal markers) → ON by default', () => {
    const c = resolveLiveSessionMemoryConfig('session-1');
    assert.equal(c.enabled, true);
    assert.equal(c.reason, 'default_on');
  });
  // Use NATIVELY_INTERNAL (a flag no other concurrent test file reads) to exercise the
  // internal-context tier — mutating NODE_ENV/BENCHMARK_MODEL here would race with
  // other test files that read them (node:test parallelizes across files).
  test('NATIVELY_INTERNAL=1 → ON (internal_context)', () => {
    process.env.NATIVELY_INTERNAL = '1'; __resetLiveSessionMemoryCache();
    const c = resolveLiveSessionMemoryConfig('s');
    assert.equal(c.enabled, true);
    assert.equal(c.reason, 'internal_context');
  });
  test('NATIVELY_DEV=1 → ON', () => {
    process.env.NATIVELY_DEV = '1'; __resetLiveSessionMemoryCache();
    assert.equal(resolveLiveSessionMemoryConfig('s').enabled, true);
  });
});

describe('Rollout — env overrides', () => {
  test('env ON forces enabled', () => {
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = 'on'; __resetLiveSessionMemoryCache();
    const c = resolveLiveSessionMemoryConfig('s');
    assert.equal(c.enabled, true); assert.equal(c.reason, 'env_on');
  });
  test('env OFF forces disabled even in an internal context', () => {
    process.env.NATIVELY_INTERNAL = '1';
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = 'off'; __resetLiveSessionMemoryCache();
    const c = resolveLiveSessionMemoryConfig('s');
    assert.equal(c.enabled, false); assert.equal(c.reason, 'env_off');
  });
});

describe('Rollout — KILL SWITCH overrides everything', () => {
  test('kill switch disables even when env ON', () => {
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = 'on';
    process.env.NATIVELY_LIVE_SESSION_MEMORY_KILL_SWITCH = 'true'; __resetLiveSessionMemoryCache();
    const c = resolveLiveSessionMemoryConfig('s');
    assert.equal(c.enabled, false); assert.equal(c.reason, 'kill_switch'); assert.equal(c.killSwitch, true);
  });
  test('kill switch disables even in an internal context', () => {
    process.env.NATIVELY_INTERNAL = '1';
    process.env.NATIVELY_LIVE_SESSION_MEMORY_KILL_SWITCH = '1'; __resetLiveSessionMemoryCache();
    assert.equal(resolveLiveSessionMemoryConfig('s').enabled, false);
  });
});

describe('Rollout — percentage gate (production gradual rollout)', () => {
  test('percent 0 → OFF', () => {
    process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT = '0'; __resetLiveSessionMemoryCache();
    const c = resolveLiveSessionMemoryConfig('s'); assert.equal(c.enabled, false); assert.equal(c.reason, 'rollout_out');
  });
  test('percent 100 → ON', () => {
    process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT = '100'; __resetLiveSessionMemoryCache();
    const c = resolveLiveSessionMemoryConfig('s'); assert.equal(c.enabled, true); assert.equal(c.reason, 'rollout_in');
  });
  test('percent 50 → roughly half of sessions in, deterministically', () => {
    process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT = '50'; __resetLiveSessionMemoryCache();
    let inCount = 0; const N = 1000;
    for (let i = 0; i < N; i++) if (resolveLiveSessionMemoryConfig('user-' + i).enabled) inCount++;
    // FNV bucketing should land near 50% (allow a wide band).
    assert.ok(inCount > N * 0.40 && inCount < N * 0.60, `got ${inCount}/${N} in rollout`);
  });
  test('deterministic bucketing: same session id is stable across calls', () => {
    process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT = '37'; __resetLiveSessionMemoryCache();
    const a = resolveLiveSessionMemoryConfig('stable-session-xyz').enabled;
    const b = resolveLiveSessionMemoryConfig('stable-session-xyz').enabled;
    const c = resolveLiveSessionMemoryConfig('stable-session-xyz').enabled;
    assert.equal(a, b); assert.equal(b, c);
  });
  test('partial percent with NO sessionId → OFF (test-engineer gap: id-less sessions not lumped in)', () => {
    process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT = '90'; __resetLiveSessionMemoryCache();
    assert.equal(resolveLiveSessionMemoryConfig(undefined).enabled, false);
    assert.equal(resolveLiveSessionMemoryConfig('').enabled, false);
    assert.equal(resolveLiveSessionMemoryConfig('').reason, 'rollout_out');
  });
  test('sessionBucket is in [0,99] and stable', () => {
    const x = sessionBucket('abc'); assert.ok(x >= 0 && x < 100);
    assert.equal(sessionBucket('abc'), sessionBucket('abc'));
  });
});

describe('Rollout — flag OFF/ON helper parity', () => {
  test('isLiveSessionMemoryEnabled mirrors resolveLiveSessionMemoryConfig.enabled', () => {
    process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT = '63'; __resetLiveSessionMemoryCache();
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      assert.equal(isLiveSessionMemoryEnabled(id), resolveLiveSessionMemoryConfig(id).enabled);
    }
  });
});

describe('Telemetry — marker only, no sensitive content', () => {
  beforeEach(() => piTelemetry.reset());
  test('scrubTelemetry is an ALLOWLIST — keeps markers, drops everything else', () => {
    const out = scrubTelemetry({
      answerType: 'project_answer', mode: 'technical-interview',
      resume: 'John Doe, 10 years...', transcript: 'long convo', salary: '250k',
      answerText: 'the full answer body', apiKey: 'AQ.secret', prompt: 'system prompt',
      recalledValue: 'Natively', entityValue: 'Natively',
    });
    assert.equal(out.answerType, 'project_answer');
    assert.equal(out.mode, 'technical-interview');
    for (const k of ['resume', 'transcript', 'salary', 'answerText', 'apiKey', 'prompt', 'recalledValue', 'entityValue']) {
      assert.ok(!(k in out), `${k} must be dropped`);
    }
  });
  test('scrubTelemetry drops the code-review HIGH leak vectors (recalledEntity/entity/jdText/bare-number/PII)', () => {
    const out = scrubTelemetry({
      answerType: 'project_answer',
      recalledEntity: 'Project Phoenix', entity: 'Acme Corp acquisition',
      jdText: 'we need a senior engineer', comp2: '120000', note: 'wants 95000 base',
      label: 'John Smith SSN 123-45-6789', city: '42 Baker Street', question: 'what is my SSN?',
    });
    assert.equal(out.answerType, 'project_answer');
    for (const k of ['recalledEntity', 'entity', 'jdText', 'comp2', 'note', 'label', 'city', 'question']) {
      assert.ok(!(k in out), `${k} (leak vector) must be dropped by the allowlist`);
    }
  });
  test('an allowed key with a free-text / number value is still dropped (value backstop)', () => {
    const out = scrubTelemetry({ reason: 'recalled the Natively project from minute 1 of the conversation', mode: 'sales' });
    assert.ok(!('reason' in out), 'long free-text value rejected even under an allowed key');
    assert.equal(out.mode, 'sales');
  });
  test('scrubTelemetry drops salary-looking string values', () => {
    const out = scrubTelemetry({ note: 'targeting 250k base', kind: 'comp' });
    assert.ok(!('note' in out), 'salary-looking value dropped');
    assert.equal(out.kind, 'comp');
  });
  test('scrubTelemetry drops long free-text under an allowed key, keeps short marker', () => {
    const out = scrubTelemetry({ reason: 'x'.repeat(200), mode: 'sales' });
    assert.ok(!('reason' in out), 'long value dropped');
    assert.equal(out.mode, 'sales');
  });
  test('emit stores a scrubbed record', () => {
    piTelemetry.emit('session_memory_recall_succeeded', { recalledKind: 'project', ageBucket: '60min+', recalledValue: 'Natively' });
    const recent = piTelemetry.recent(5);
    const rec = recent[recent.length - 1];
    assert.equal(rec.event, 'session_memory_recall_succeeded');
    assert.equal(rec.data.recalledKind, 'project');
    assert.ok(!('recalledValue' in rec.data), 'value must never be stored');
  });
  test('ageBucket maps seconds to a coarse marker, never the raw value', () => {
    assert.equal(ageBucket(30), 'immediate');
    assert.equal(ageBucket(3 * 60), '1-5min');
    assert.equal(ageBucket(45 * 60), '30-60min');
    assert.equal(ageBucket(3700), '60min+');
    assert.equal(ageBucket(null), 'none');
  });

  // ── Fix D: speakabilityClass is allow-listed but still value-gated ───────────
  test('speakabilityClass marker is KEPT (allow-listed + marker-shaped value)', () => {
    for (const cls of ['exempt', 'over_budget', 'over_soft', 'standard']) {
      const out = scrubTelemetry({ speakabilityClass: cls, answerType: 'experience_answer' });
      assert.equal(out.speakabilityClass, cls, `${cls} must survive the allowlist`);
    }
  });
  test('speakabilityClass with a SENSITIVE value is DROPPED (privacy backstop holds)', () => {
    const out = scrubTelemetry({ speakabilityClass: '$120k secret', answerType: 'experience_answer' });
    assert.ok(!('speakabilityClass' in out), 'a salary/PII-shaped value must be dropped even under an allowed key');
    assert.equal(out.answerType, 'experience_answer');
  });
  test('speakabilityClass with free-text is DROPPED (marker-shape backstop holds)', () => {
    const out = scrubTelemetry({ speakabilityClass: 'this answer was way too long to say aloud in an interview', mode: 'sales' });
    assert.ok(!('speakabilityClass' in out), 'long free-text rejected even under an allowed key');
    assert.equal(out.mode, 'sales');
  });
  test('emit("pi_context_policy_applied", {via, speakabilityClass}) stores a scrubbed marker', () => {
    piTelemetry.emit('pi_context_policy_applied', { answerType: 'experience_answer', via: 'speakability_measured', speakabilityClass: 'over_budget', markerCount: 130 });
    const recent = piTelemetry.recent(5);
    const rec = recent[recent.length - 1];
    assert.equal(rec.event, 'pi_context_policy_applied');
    assert.equal(rec.data.via, 'speakability_measured');
    assert.equal(rec.data.speakabilityClass, 'over_budget');
    assert.equal(rec.data.markerCount, 130);
  });
});
