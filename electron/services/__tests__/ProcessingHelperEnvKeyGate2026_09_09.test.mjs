// ProcessingHelper builds LLMHelper directly from process.env in its
// constructor — a DEVELOPMENT mechanism (populates from a repo .env). This is
// the second, independent read path CredentialEnvFallbackScope2026_09_08's
// own comment named but did not fix: CredentialsManager.storedOrEnv() already
// gates its process.env fallback on app.isPackaged, but ProcessingHelper's
// constructor read the same env vars unconditionally, so a packaged build
// with a stray *_API_KEY in the OS environment (e.g. a Windows user-level env
// var inherited by GUI-launched apps) silently got an active LLM credential
// that never appeared in — and could not be cleared from — Settings.
//
// REPRODUCED live before this fix: a packaged (ad-hoc signed, app.isPackaged
// === true) build, launched with an isolated/empty userData dir (no key ever
// stored in Settings — CredentialsManager logged "No stored credentials
// found") and only GEMINI_API_KEY set in the OS environment, answered a real
// submitManualQuestion() call via a live Gemini API round-trip. Post-fix, the
// identical launch logs "Gemini client not initialized" and
// submitManualQuestion() returns an empty answer, while a build with the key
// entered through Settings (setGeminiApiKey) continues to work, and an
// unpackaged dev launch (NODE_ENV=development) continues to pick up the env
// var as intended.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'electron/ProcessingHelper.ts'), 'utf8');

const constructorBody = src.slice(
  src.indexOf('constructor(appState: AppState)'),
  src.indexOf('public loadStoredCredentials'),
);

test('the constructor env-key reads are gated on app.isPackaged', () => {
  for (const envVar of [
    'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY',
    'CLAUDE_API_KEY', 'DEEPSEEK_API_KEY', 'NVIDIA_NIM_API_KEY',
  ]) {
    // Every one of these must be read via a ternary/guard that checks
    // app.isPackaged first, not `process.env.<VAR>` bare.
    const re = new RegExp(
      `app\\.isPackaged\\s*\\?\\s*undefined\\s*:\\s*process\\.env\\.${envVar}`,
    );
    assert.match(constructorBody, re,
      `${envVar} must be read as "app.isPackaged ? undefined : process.env.${envVar}"`);
  }
});

test('the Ollama env toggle is also gated on app.isPackaged', () => {
  assert.match(constructorBody, /!app\.isPackaged\s*&&\s*process\.env\.USE_OLLAMA/,
    'USE_OLLAMA must not be honored in a packaged build');
});

test('dotenv itself stays dev-only (unchanged baseline)', () => {
  const top = src.slice(0, src.indexOf('export class ProcessingHelper'));
  assert.match(top, /if \(!app\.isPackaged\)\s*\{\s*\n\s*require\("dotenv"\)\.config\(\)/);
});
