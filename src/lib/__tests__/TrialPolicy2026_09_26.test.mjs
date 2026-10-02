// What to do with an EXPIRED trial token (2026-09-26, toaster policy Phase 0).
//
// The lock-in this exists to prevent: a user whose trial expired and who then
// paid (a licence), saved a real Natively key, or saved their own AI key kept
// the dead token. Every launch then wiped their résumé/JD data and opened the
// "Trial ended" card, which has no close button and whose only exit ("Use my
// own API keys") deactivates the licence.
//
// Rule: the token is superseded by a licence, a real Natively key or an own AI
// key — clear it and never show the card. The profile wipe belongs to users
// who are not licensed for Pro, and runs once per trial.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasOwnAiKey, resolveExpiredTrial } from '../trialPolicy.mjs';

const base = { hasToken: true, expired: true, licensed: false, hasRealNativelyKey: false, hasOwnAiKey: false, wipedForThisTrial: false };
const CASES = [
  ['no token',                     { hasToken: false },                            { showEndedCard: false, wipe: false, clearToken: false }],
  ['live trial',                   { expired: false },                             { showEndedCard: false, wipe: false, clearToken: false }],
  ['live trial + licence',         { expired: false, licensed: true },             { showEndedCard: false, wipe: false, clearToken: false }],
  ['expired, nothing else',        {},                                             { showEndedCard: true,  wipe: true,  clearToken: false }],
  ['expired, already wiped',       { wipedForThisTrial: true },                    { showEndedCard: true,  wipe: false, clearToken: false }],
  ['expired + licence',            { licensed: true },                             { showEndedCard: false, wipe: false, clearToken: true }],
  ['expired + real Natively key',  { hasRealNativelyKey: true },                   { showEndedCard: false, wipe: true,  clearToken: true }],
  ['expired + own AI key',         { hasOwnAiKey: true },                          { showEndedCard: false, wipe: true,  clearToken: true }],
  ['expired + key, already wiped', { hasOwnAiKey: true, wipedForThisTrial: true }, { showEndedCard: false, wipe: false, clearToken: true }],
];
for (const [name, patch, want] of CASES) {
  test(`resolveExpiredTrial: ${name}`, () => {
    assert.deepEqual(resolveExpiredTrial({ ...base, ...patch }), want);
  });
}

test('resolveExpiredTrial: a missing state is a no-op', () => {
  assert.deepEqual(resolveExpiredTrial(undefined), { showEndedCard: false, wipe: false, clearToken: false });
});

test('hasOwnAiKey: any LLM key, base URL or custom provider counts', () => {
  for (const f of ['geminiApiKey', 'groqApiKey', 'openaiApiKey', 'claudeApiKey', 'deepseekApiKey', 'nvidiaNimApiKey',
    'openrouterApiKey', 'fluxionApiKey', 'ninerouterApiKey', 'litellmBaseURL']) {
    assert.equal(hasOwnAiKey({ [f]: 'x' }), true, f);
  }
  assert.equal(hasOwnAiKey({ customProviders: [{ id: 'a' }] }), true);
  assert.equal(hasOwnAiKey({ curlProviders: [{ id: 'a' }] }), true);
});

test('hasOwnAiKey: blank values, STT-only keys and the Natively key do not count', () => {
  assert.equal(hasOwnAiKey({}), false);
  assert.equal(hasOwnAiKey(null), false);
  assert.equal(hasOwnAiKey({ geminiApiKey: '   ' }), false);
  assert.equal(hasOwnAiKey({ deepgramApiKey: 'x', groqSttApiKey: 'x', nativelyApiKey: 'x' }), false);
  assert.equal(hasOwnAiKey({ customProviders: [], curlProviders: [] }), false);
});

// Toaster policy Phase 3 (Phase 0 deferred minor): sign-in routes are AI
// routes of the user's own too. A ChatGPT (Codex) or Antigravity sign-in, or a
// keyless 9Router base URL, used to read as "no keys": the Trial ended wall
// went up and the key-less cards were offered to someone who is set up.
test('hasOwnAiKey: a ChatGPT or Antigravity sign-in, or a keyless 9Router, counts', () => {
  const oauth = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 };
  assert.equal(hasOwnAiKey({ codexOAuthTokens: oauth }), true, 'ChatGPT (Codex) sign-in');
  assert.equal(hasOwnAiKey({ antigravityOAuthTokens: { ...oauth, projectId: 'p-1' } }), true, 'Antigravity sign-in');
  assert.equal(hasOwnAiKey({ ninerouterBaseURL: 'http://localhost:20128/v1' }), true, 'keyless 9Router');
});

test('hasOwnAiKey: an empty sign-in or a default local URL is not a route', () => {
  assert.equal(hasOwnAiKey({ codexOAuthTokens: { accessToken: '', refreshToken: '' } }), false);
  assert.equal(hasOwnAiKey({ antigravityOAuthTokens: undefined }), false);
  assert.equal(hasOwnAiKey({ ninerouterBaseURL: '   ' }), false);
  // Ollama has a default URL and no opt-in field: its presence says nothing.
  assert.equal(hasOwnAiKey({ ollamaBaseUrl: 'http://localhost:11434' }), false);
});

// Final review I3: the Codex CLI's own `codex login` stores nothing in
// Natively's credentials, yet the model router answers through it when Codex
// is enabled (getCodexAuthStatus().signedIn, source 'codex-cli'). Main knows
// that route; it passes it in.
test('hasOwnAiKey: a ready Codex route (incl. the Codex CLI login) counts', () => {
  assert.equal(hasOwnAiKey({}, { codexReady: true }), true);
  assert.equal(hasOwnAiKey({}, { codexReady: false }), false);
  assert.equal(hasOwnAiKey({}), false, 'no routes passed: nothing assumed');
});

test('main tells the rule about the Codex route in both places it asks', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ipc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../electron/ipcHandlers.ts'), 'utf8');
  assert.ok(ipc.includes('const codexRouteReady = (): boolean => {'));
  const occurrences = (ipc.match(/hasOwnAiKey\(.*?, \{ codexReady: codexRouteReady\(\) \}\)/g) || []).length;
  assert.ok(occurrences >= 2, 'settleExpiredTrial, get-stored-credentials, and route checks');
});
