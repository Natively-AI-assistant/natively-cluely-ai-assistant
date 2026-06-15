import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizeDefaultModel, sanitizeSttProvider, SAFE_DEFAULT_MODEL, SAFE_STT_PROVIDER } from '../legacyStateMigration.js';

test('sanitizeDefaultModel maps legacy natively defaultModel to a safe default', () => {
  assert.equal(sanitizeDefaultModel('natively'), SAFE_DEFAULT_MODEL);
  assert.equal(sanitizeDefaultModel(undefined), SAFE_DEFAULT_MODEL);
  assert.equal(sanitizeDefaultModel('gemini-3.5-flash'), 'gemini-3.5-flash');
});

test('sanitizeSttProvider maps legacy natively sttProvider to none', () => {
  assert.equal(sanitizeSttProvider('natively'), SAFE_STT_PROVIDER);
  assert.equal(sanitizeSttProvider(undefined), SAFE_STT_PROVIDER);
  assert.equal(sanitizeSttProvider('groq'), 'groq');
});

