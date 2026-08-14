import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioHealthClassifier } from '../systemAudioHealthClassifier.mjs';

function zeroChunk(bytes = 1920) {
  return Buffer.alloc(bytes);
}

function rampChunk(samples = 960) {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = i % 2 === 0 ? -1000 : 1000;
    chunk.writeInt16LE(value, i * 2);
  }
  return chunk;
}

function assertNoUserWarning(decision) {
  assert.notEqual(decision.type, 'warn-user', `expected no user warning, got ${JSON.stringify(decision)}`);
}

test('no chunks after watchdog tick is log-only and never a user warning', () => {
  const health = new SystemAudioHealthClassifier({ watchdogMs: 12_000 });
  assertNoUserWarning(health.handle({ kind: 'capture-started', nowMs: 0 }));

  const decision = health.handle({ kind: 'watchdog-tick', nowMs: 12_000 });

  assert.equal(decision.type, 'log');
  assert.equal(decision.reason, 'initial-silence-no-chunks');
});

test('sustained zero-valued chunks are treated as silence, not permission failure', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decisions = [];
  for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
    const decision = health.handle({ kind: 'chunk', nowMs, chunk: zeroChunk() });
    assertNoUserWarning(decision);
    decisions.push(decision);
  }

  const silenceLog = decisions.find((decision) => decision.reason === 'sustained-zero-valued-silence');
  assert.equal(silenceLog?.type, 'log');
});

test('transcript absence cannot influence system-audio health classification', () => {
  const health = new SystemAudioHealthClassifier();
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decision = health.handle({ kind: 'watchdog-tick', nowMs: 45_000 });

  assertNoUserWarning(decision);
  assert.equal(
    SystemAudioHealthClassifier.supportedEventKinds.includes('transcript-missing'),
    false,
    'classifier API must not accept transcript absence as a system-audio failure signal',
  );
});

test('same-device route conflict emits one actionable user warning', () => {
  const health = new SystemAudioHealthClassifier();

  const first = health.handle({
    kind: 'same-device-route-detected',
    nowMs: 12_000,
    device: "Evin's AirPods Pro",
  });
  const duplicate = health.handle({
    kind: 'same-device-route-detected',
    nowMs: 13_000,
    device: "Evin's AirPods Pro",
  });

  assert.deepEqual(first, {
    type: 'warn-user',
    reason: 'same-device-input-output',
    device: "Evin's AirPods Pro",
    terminal: false,
    stuck: true,
  });
  assert.equal(duplicate.type, 'none');
});

test('inter-chunk gaps are diagnostics only', () => {
  const health = new SystemAudioHealthClassifier({ interChunkGapLogMs: 2_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });
  assertNoUserWarning(health.handle({ kind: 'chunk', nowMs: 0, chunk: rampChunk() }));

  const decision = health.handle({ kind: 'chunk', nowMs: 3_000, chunk: rampChunk() });

  assert.equal(decision.type, 'log');
  assert.equal(decision.reason, 'inter-chunk-gap');
});
