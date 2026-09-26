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
