import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/CredentialsManager.js');

test('Antigravity credentials survive encrypted save/restart and checked failures preserve other providers', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-credentials-'));
  const originalLoad = Module._load;
  const previousSingleton = globalThis.__nativelyCredentialsManagerV1__;
  Module._load = function (request, ...args) {
    if (request === 'electron') return {
      app: { getPath: () => userData, isPackaged: false, getVersion: () => 'test' },
      safeStorage: { isEncryptionAvailable: () => false },
    };
    return originalLoad.call(this, request, ...args);
  };
  const fresh = () => {
    delete require.cache[require.resolve(compiled)];
    delete globalThis.__nativelyCredentialsManagerV1__;
    const cm = require(compiled).CredentialsManager.getInstance();
    cm.init();
    return cm;
  };
  try {
    let cm = fresh();
    cm.setGeminiApiKey('unrelated-gemini-key');
    const tokens = { accessToken: 'access-sentinel', refreshToken: 'refresh-sentinel', expiresAt: Date.now() + 3_600_000, projectId: 'account-project' };
    assert.equal(cm.setAntigravityOAuthTokens(tokens), true);
    const encrypted = fs.readFileSync(path.join(userData, 'credentials.fallback.enc'));
    assert.equal(encrypted.includes(Buffer.from(tokens.accessToken)), false);
    assert.equal(encrypted.includes(Buffer.from(tokens.refreshToken)), false);
    cm = fresh();
    assert.deepEqual(cm.getAntigravityOAuthTokens(), tokens);
    const copy = cm.getAntigravityOAuthTokens();
    copy.refreshToken = 'mutated';
    assert.equal(cm.getAntigravityOAuthTokens().refreshToken, tokens.refreshToken);

    const realSave = cm.saveCredentials;
    cm.saveCredentials = () => false;
    assert.equal(cm.setAntigravityOAuthTokens({ ...tokens, accessToken: 'rotated' }), false);
    assert.deepEqual(cm.getAntigravityOAuthTokens(), tokens);
    assert.equal(cm.clearAntigravityOAuthTokens(), false);
    assert.deepEqual(cm.getAntigravityOAuthTokens(), tokens);
    cm.saveCredentials = realSave;
    assert.equal(cm.clearAntigravityOAuthTokens(), true);
    cm = fresh();
    assert.equal(cm.getAntigravityOAuthTokens(), null);
    assert.equal(cm.getGeminiApiKey(), 'unrelated-gemini-key');
  } finally {
    Module._load = originalLoad;
    globalThis.__nativelyCredentialsManagerV1__ = previousSingleton;
    assert.equal(path.dirname(path.resolve(userData)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(userData).startsWith('antigravity-credentials-'));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
