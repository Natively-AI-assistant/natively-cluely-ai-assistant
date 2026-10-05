// CredentialsManager.revertNativelyAutoDefaults — the undo for a key the server
// turns out to refuse.
//
// setNativelyApiKey() promotes the default model (and STT) to 'natively' and
// SAVES before anything has checked the key works. In the 2026-08-27 win32
// report the server then refused the key, and the failure branch only logged —
// so the user sat on an endpoint that rejects every request, with no UI signal.
//
// Two properties this must have, and the reason for each:
//   1. It reverts on the CURRENT value, not a pre-call snapshot. Re-saving a key
//      that was already stored leaves the snapshot reading 'natively' too, so
//      restoring the snapshot would restore the broken state.
//   2. It touches ONLY 'natively'. A model the user picked deliberately is not
//      collateral — clobbering it would be the same class of bug the
//      AUTO_ASSIGNED_MODEL_IDS allowlist exists to prevent on the way in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const COMPILED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist-electron/electron/services/CredentialsManager.js',
);

function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-revert-'));
  const state = { userData };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test' },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(2).toString('utf8'),
      getSelectedStorageBackend: () => 'basic_text',
    },
  };
  return { state, fakeElectron, userData };
}

let CURRENT = null;
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    if (!CURRENT) throw new Error('no electron env active');
    return CURRENT.fakeElectron;
  }
  return origLoad.apply(this, arguments);
};

function freshManager(env) {
  CURRENT = env;
  delete require.cache[require.resolve(COMPILED)];
  const mod = require(COMPILED);
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  delete globalThis.__nativelyCredentialsManagerV1__;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return cm;
}

test('a refused key un-parks the default model from natively', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setDefaultModel('natively');

  const changed = cm.revertNativelyAutoDefaults('Natively key refused by server');

  assert.equal(cm.getDefaultModel(), 'gemini-3.1-flash-lite');
  assert.equal(
    changed.defaultModel,
    'gemini-3.1-flash-lite',
    'the caller re-syncs LLMHelper and the UI from this return value — a silent revert leaves the runtime on the dead model',
  );
});

test('reverting works when the model was ALREADY natively before the save', () => {
  // The re-save case. A snapshot-based revert would restore 'natively' here and
  // leave the user exactly as broken as before.
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setNativelyApiKey('natively_sk_whatever');
  assert.equal(cm.getDefaultModel(), 'natively', 'precondition: the key save auto-promoted the model');

  cm.revertNativelyAutoDefaults('Natively key refused by server');

  assert.equal(cm.getDefaultModel(), 'gemini-3.1-flash-lite');
});

test('an explicitly chosen model is NOT collateral', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setDefaultModel('gpt-5.4');

  const changed = cm.revertNativelyAutoDefaults('Natively key refused by server');

  assert.equal(cm.getDefaultModel(), 'gpt-5.4', "a deliberate model choice must survive someone else's key being refused");
  assert.equal(changed.defaultModel, undefined, 'nothing changed, so nothing may be reported as changed');
  assert.equal(changed.sttProvider, undefined);
});

test('a natively STT provider is reverted and reported (the caller must rebuild the pipeline)', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setSttProvider('natively');

  const changed = cm.revertNativelyAutoDefaults('Natively key refused by server');

  assert.equal(cm.getSttProvider(), 'none');
  assert.equal(changed.sttProvider, 'none', 'reconfigureSttProvider() is gated on this being reported');
});

test('a non-natively STT provider is left alone', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setSttProvider('deepgram');

  const changed = cm.revertNativelyAutoDefaults('Natively key refused by server');

  assert.equal(cm.getSttProvider(), 'deepgram');
  assert.equal(changed.sttProvider, undefined);
});

test('the revert is persisted, not just in-memory', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setDefaultModel('natively');
  cm.revertNativelyAutoDefaults('Natively key refused by server');

  // Cold restart against the same userData.
  const reopened = freshManager(env);
  assert.equal(
    reopened.getDefaultModel(),
    'gemini-3.1-flash-lite',
    'an unsaved revert would put the user back on the dead model at next launch',
  );
});

test('clearing the key still reverts (regression on the extracted helper)', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setNativelyApiKey('natively_sk_whatever');
  cm.setSttProvider('natively');

  cm.setNativelyApiKey('');

  assert.equal(cm.getDefaultModel(), 'gemini-3.1-flash-lite');
  assert.equal(cm.getSttProvider(), 'none');
});

// ---------------------------------------------------------------------------
// Handler wiring. Static, following this repo's ipcHandlers convention
// (ipcTestUtils + sliceSafeHandleBlock) — initializeIpcHandlers registers ~200
// handlers against a large appState surface, so the glue is pinned structurally
// rather than invoked. The two functions it glues are covered behaviorally above
// and in LicenseKeyRejectionVerdicts2026_08_27.test.mjs.
// ---------------------------------------------------------------------------
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const HANDLER_BLOCK = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ipcHandlers.ts'),
  'utf8',
);

test('set-natively-api-key undoes the auto-promotion when the key is REFUSED', () => {
  const block = sliceSafeHandleBlock(HANDLER_BLOCK, 'set-natively-api-key');
  assert.ok(block.length > 0, 'precondition: handler block not found — this test is vacuous without it');

  assert.match(
    block,
    /result\.keyRejected/,
    'the revert must be gated on keyRejected specifically, not on any activation failure',
  );
  assert.match(
    block,
    /revertNativelyAutoDefaults/,
    'a refused key leaves the user parked on the natively endpoint unless the promotion is undone',
  );
});

test('set-natively-api-key reports a refusal instead of returning unconditional success', () => {
  const block = sliceSafeHandleBlock(HANDLER_BLOCK, 'set-natively-api-key');
  assert.match(
    block,
    /return keyRejection[\s\S]{0,120}success:\s*false/,
    'the handler returned { success: true } even for a key that authenticates nowhere; the settings UI renders `error` only on a failed save',
  );
});

test('the no-Pro branch is separate from the refusal branch', () => {
  // A standard-plan key still authenticates against /v1/chat. If the two
  // branches ever collapse, a working standard user gets torn down.
  const block = sliceSafeHandleBlock(HANDLER_BLOCK, 'set-natively-api-key');
  const rejectedAt = block.indexOf('result.keyRejected');
  const noProAt = block.indexOf('Pro not activated');
  assert.ok(rejectedAt >= 0 && noProAt >= 0, 'both branches must exist');
  assert.ok(
    rejectedAt < noProAt,
    'the refusal branch must be its own arm, ahead of the generic no-Pro fallthrough',
  );
});
