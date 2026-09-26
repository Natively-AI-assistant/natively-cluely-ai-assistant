import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Import the PURE language module. main.js and CredentialsManager both touch
// app.getPath() at load and throw outside an Electron runtime, which node:test
// counts as one passing file — a vacuous green hiding every assertion below.
// That is also why this function lives with the language data, not with
// credentials: it is pure, and it should be testable without an app.
const { normalizeSttLanguageKey } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/config/languages.js')).href
);
assert.equal(typeof normalizeSttLanguageKey, 'function', 'the normalizer must actually be exported');

// getSttLanguage() is the single source both readers pull from — main.ts feeds
// it to the provider, ipcHandlers hands it to Settings — so normalising here is
// what stops the two disagreeing. Live symptom before this: Settings said
// `"english" isn't available in Apple Speech` and left Accent/Region empty,
// while the provider was transcribing en-US perfectly.
test('a legacy bare "english" resolves to the English family default', () => {
  assert.equal(normalizeSttLanguageKey('english'), 'english-us');
});

test('group matching is case-insensitive and picks the declared primary', () => {
  assert.equal(normalizeSttLanguageKey('English'), 'english-us');
  assert.equal(normalizeSttLanguageKey('ENGLISH'), 'english-us');
});

test('keys that already exist are returned untouched', () => {
  for (const key of ['auto', 'english-au', 'spanish', 'japanese', 'chinese']) {
    assert.equal(normalizeSttLanguageKey(key), key);
  }
});

test('empty or missing becomes auto, matching the documented default', () => {
  assert.equal(normalizeSttLanguageKey(undefined), 'auto');
  assert.equal(normalizeSttLanguageKey(null), 'auto');
  assert.equal(normalizeSttLanguageKey('   '), 'auto');
});

test('an unrecognised key is preserved, never silently switched to auto', () => {
  // Forcing 'auto' here would change someone's language behind their back on a
  // value this function simply does not understand.
  assert.equal(normalizeSttLanguageKey('klingon'), 'klingon');
});
