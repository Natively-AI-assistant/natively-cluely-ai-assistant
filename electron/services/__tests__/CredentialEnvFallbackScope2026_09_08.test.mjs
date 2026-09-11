// The env fallback exists because ProcessingHelper builds LLMHelper from
// process.env. That is a DEVELOPMENT mechanism, and it must not reach a
// packaged user.
//
// REPRODUCED before this scope was added: a user sets a Gemini key, clears it in
// Settings to stop sending data to that provider, and getGeminiApiKey() keeps
// returning process.env.GEMINI_API_KEY — invisible in the UI and unremovable,
// with anyVisionProviderConfigured() still reporting true. On Windows,
// user-level env vars reach GUI-launched apps, so another tool's OPENAI_API_KEY
// would silently become an active Natively credential.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'electron/services/CredentialsManager.ts'), 'utf8');

test('the env fallback is gated on a development build', () => {
  const fn = src.slice(src.indexOf('private storedOrEnv'), src.indexOf('public getGeminiApiKey'));
  // The stored value always wins, in every build.
  assert.match(fn, /const value = \(stored \?\? ''\)\.trim\(\);\s*\n\s*if \(value\) return value;/);
  // A packaged build never consults the environment at all.
  assert.match(fn, /if \(app\.isPackaged\) return undefined;/);
  // ...and that check comes BEFORE the env read, or the gate is decorative.
  assert.ok(
    fn.indexOf('app.isPackaged') < fn.indexOf('process.env[envKey]'),
    'the packaged gate must precede the env read',
  );
});

test('every env-backed getter goes through the gated helper', () => {
  // A getter that reads process.env directly would reopen the hole for that one
  // provider, which is exactly the shape of the original two-key-sources bug.
  for (const g of ['getGeminiApiKey', 'getGroqApiKey', 'getOpenaiApiKey',
                   'getClaudeApiKey', 'getDeepseekApiKey', 'getNvidiaNimApiKey']) {
    const body = src.slice(src.indexOf(`public ${g}(`), src.indexOf('}', src.indexOf(`public ${g}(`)));
    assert.match(body, /this\.storedOrEnv\(/, `${g} must use the gated helper`);
    assert.doesNotMatch(body, /process\.env/, `${g} must not read process.env directly`);
  }
});
