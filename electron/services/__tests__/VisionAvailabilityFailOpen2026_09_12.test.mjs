// 2026-09-12: LLMHelper.anyVisionProviderAvailable is documented "Live,
// fail-OPEN: a credential-store failure must not start refusing turns", but the
// Antigravity probe added on 2026-09-05 sat OUTSIDE its try. Antigravity's
// status reads its tokens from the credential store, so a store that threw
// escaped the probe and failed every image turn with "I couldn't analyze the
// screen right now (...getAntigravityOAuthTokens is not a function)". It broke
// 24 tests across four suites, hidden in CI behind an unrelated renderer-build
// failure.
//
// The contract pinned here: an Antigravity failure means ANTIGRAVITY is
// unusable. It must neither throw nor fail open on its own. The credential
// check that follows decides, and that check is the one that fails open.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// `electron` is an esbuild external and CredentialsManager touches app at
// module scope; the store under test is the stub in CRED_SLOT below.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));

const CRED_SLOT = '__nativelyCredentialsManagerV1__';
const ANTIGRAVITY_SLOT = '__nativelyAntigravityServiceV1__';
let credBefore;

beforeEach(() => {
  credBefore = globalThis[CRED_SLOT];
  // A fresh service each test: getStatus reads cachedTokens before the store.
  delete globalThis[ANTIGRAVITY_SLOT];
});
afterEach(() => {
  if (credBefore === undefined) delete globalThis[CRED_SLOT]; else globalThis[CRED_SLOT] = credBefore;
  delete globalThis[ANTIGRAVITY_SLOT];
});

const TOKENS = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, projectId: 'p' };
const boom = () => { throw new Error('keychain is locked'); };

const available = (store) => {
  globalThis[CRED_SLOT] = { getDisabledProviders: () => [], ...store };
  const h = Object.create(LLMHelper.prototype);
  return LLMHelper.prototype.anyVisionProviderAvailable.call(h);
};

describe('anyVisionProviderAvailable: an Antigravity failure is not a turn failure', () => {
  test('BASELINE: a signed-in Antigravity counts as a vision provider on its own', () => {
    assert.equal(available({ getAntigravityOAuthTokens: () => TOKENS, anyVisionProviderConfigured: () => false }), true);
  });

  test('BASELINE: a disabled Antigravity does not count, even signed in', () => {
    assert.equal(available({
      getDisabledProviders: () => ['antigravity'],
      getAntigravityOAuthTokens: () => TOKENS,
      anyVisionProviderConfigured: () => false,
    }), false);
  });

  test('a store without the Antigravity getter still answers from the other providers', () => {
    // The shape that failed: every older credential stub, and any store
    // predating the Antigravity field.
    assert.doesNotThrow(() => available({ anyVisionProviderConfigured: () => true }));
    assert.equal(available({ anyVisionProviderConfigured: () => true }), true);
  });

  test('an Antigravity read that throws does NOT fail open past a working store', () => {
    // vision_only must still refuse by name when nothing is configured.
    // Returning true here would skip the check that says so.
    assert.equal(available({ getAntigravityOAuthTokens: boom, anyVisionProviderConfigured: () => false }), false);
  });

  test('a store that throws everywhere fails OPEN, as documented', () => {
    assert.equal(available({ getAntigravityOAuthTokens: boom, anyVisionProviderConfigured: boom }), true);
  });
});
