/**
 * ADR 0002 / ticket 01 — trial backend hard-disable.
 * Source-contract style matches TrialIpcRedaction.test.mjs (prior art).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function handlerSlice(source, channel, nextChannel) {
  const start = source.search(new RegExp(`safeHandle\\(['"]${channel}['"]`));
  assert.ok(start >= 0, `${channel} handler should exist`);
  const end = nextChannel
    ? source.search(new RegExp(`safeHandle\\(['"]${nextChannel}['"]`), start + 1)
    : source.length;
  assert.ok(end > start, `next channel after ${channel} should exist`);
  return source.slice(start, end);
}

test('trial:start does not phone home or install trial sentinel', () => {
  const source = read('electron/ipcHandlers.ts');
  const body = handlerSlice(source, 'trial:start', 'trial:status');

  assert.doesNotMatch(body, /api\.natively\.software\/v1\/trial\/start/);
  assert.doesNotMatch(body, /setTrialToken\s*\(/);
  assert.doesNotMatch(body, /TRIAL_SENTINEL_KEY/);
  assert.doesNotMatch(body, /setNativelyApiKey\s*\(/);
  assert.match(body, /trial_disabled|disabled|unavailable|not_available/i);
});

test('trial:status and trial:get-local report inactive without network', () => {
  const source = read('electron/ipcHandlers.ts');
  const status = handlerSlice(source, 'trial:status', 'trial:get-local');
  const local = handlerSlice(source, 'trial:get-local', 'trial:convert');

  assert.doesNotMatch(status, /api\.natively\.software\/v1\/trial\/status/);
  assert.doesNotMatch(status, /x-trial-token/);
  assert.match(status, /ok:\s*false|hasToken:\s*false|trial_disabled|disabled|inactive/i);

  assert.doesNotMatch(local, /api\.natively\.software/);
  assert.match(local, /hasToken:\s*false/);
});

test('trial:convert does not phone home', () => {
  const source = read('electron/ipcHandlers.ts');
  // convert sits before review handlers in current tree; allow either neighbor
  const start = source.search(/safeHandle\(['"]trial:convert['"]/);
  assert.ok(start >= 0);
  const end = source.search(/safeHandle\(['"](?:review:get-prompt-state|trial:end-byok)['"]/, start + 1);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /api\.natively\.software\/v1\/trial\/convert/);
});

test('trial:end-byok and trial:wipe-profile-data cannot wipe Pro profile data', () => {
  const source = read('electron/ipcHandlers.ts');
  const endByok = handlerSlice(source, 'trial:end-byok', 'trial:wipe-profile-data');
  const wipe = handlerSlice(source, 'trial:wipe-profile-data', 'get-custom-providers');

  for (const [name, body] of [
    ['trial:end-byok', endByok],
    ['trial:wipe-profile-data', wipe],
  ]) {
    assert.doesNotMatch(body, /DELETE FROM company_dossiers/, `${name} must not wipe SQLite dossiers`);
    assert.doesNotMatch(body, /DELETE FROM user_profile/, `${name} must not wipe user_profile`);
    assert.doesNotMatch(body, /deleteAllProfilePacks/, `${name} must not wipe profile OKF packs`);
    assert.doesNotMatch(body, /deleteDocumentsByType/, `${name} must not wipe orchestrator docs`);
    assert.doesNotMatch(body, /api\.natively\.software\/v1\/trial\/convert/, `${name} must not convert remotely`);
  }
});

test('LLMHelper and NativelyProSTT do not treat TRIAL_SENTINEL_KEY as live trial auth', () => {
  const llm = read('electron/LLMHelper.ts');
  const stt = read('electron/audio/NativelyProSTT.ts');

  // Live trial auth looks like: key === TRIAL_SENTINEL_KEY then getTrialToken / x-trial-token.
  // After hard-disable those branches must not remain as active auth paths.
  assert.doesNotMatch(
    llm,
    /nativelyKey === TRIAL_SENTINEL_KEY[\s\S]{0,200}getTrialToken/,
    'LLMHelper must not swap to trial token auth via sentinel',
  );
  assert.doesNotMatch(
    stt,
    /apiKey === TRIAL_SENTINEL_KEY[\s\S]{0,200}getTrialToken/,
    'NativelyProSTT must not auth with trial token via sentinel',
  );
});

test('license bypass remains unconditional for Pro unlock', () => {
  const source = read('electron/ipcHandlers.ts');
  const gate = source.slice(
    source.indexOf('const isProOrTrialActive'),
    source.indexOf('const isProOrTrialActive') + 280,
  );
  assert.match(gate, /return true/);
});
