// The credential-stores card is translated, and stays translated (2026-10-02).
//
// It was English-only, like the card it replaced. The table is checked against
// what the card can actually say: the sentences the wording module publishes
// plus every t('…') in the component. A sentence added to either without a row
// fails here instead of quietly showing English in a Japanese settings panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_STORES_PHRASES,
  compareCredentialStores,
  credentialStoreName,
  describeResolveFailure,
  formatSavedAt,
} from '../credentialStoresConflict.mjs';
import {
  CREDENTIAL_STORES_ES,
  CREDENTIAL_STORES_JA,
  CREDENTIAL_STORES_RU,
  CREDENTIAL_STORES_ZH,
} from '../../i18n.credentialStores.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TABLES = { ru: CREDENTIAL_STORES_RU, zh: CREDENTIAL_STORES_ZH, ja: CREDENTIAL_STORES_JA, es: CREDENTIAL_STORES_ES };
const slots = (text) => (text.match(/\{\w+\}/g) || []).sort();

// Every t('…') literal in the card itself.
function cardPhrases() {
  const src = fs.readFileSync(path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');
  const start = src.indexOf('const AmbiguousStoresCard: React.FC');
  const end = src.indexOf('export const AmbiguousCredentialStoresCard');
  assert.ok(start !== -1 && end > start, 'AmbiguousStoresCard not found');
  const found = [...src.slice(start, end).matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]);
  assert.ok(found.length >= 12, `expected the card's strings, found ${found.length}`);
  return found;
}
const SENTENCES = [...new Set([...CREDENTIAL_STORES_PHRASES, ...cardPhrases()])];

test('every sentence has a row in every language, and no row is left over', () => {
  for (const [lang, table] of Object.entries(TABLES)) {
    assert.deepEqual(Object.keys(table).sort(), [...SENTENCES].sort(), `${lang} covers exactly what the card can say`);
    for (const sentence of SENTENCES) {
      assert.ok(table[sentence].trim().length > 0, `${lang}: "${sentence}" is empty`);
      assert.notEqual(table[sentence], sentence, `${lang}: "${sentence}" was left in English`);
    }
  }
});

test('a translation keeps exactly the slots of its sentence', () => {
  for (const [lang, table] of Object.entries(TABLES)) {
    for (const sentence of SENTENCES) assert.deepEqual(slots(table[sentence]), slots(sentence), `${lang}: "${sentence}"`);
  }
});

test('the app dictionaries carry the rows', () => {
  const src = fs.readFileSync(path.join(root, 'src/i18n.tsx'), 'utf8');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.match(src, new RegExp(`\\.\\.\\.CREDENTIAL_STORES_${lang},`), `${lang} is spread into its dictionary`);
});

test('a translated refusal names the store in its own language, on both platforms, with nothing left unfilled', () => {
  const CODES = ['snapshot_failed', 'persist_failed', 'keyring_unreadable', 'fallback_unreadable', 'store_degraded', 'internal_error'];
  for (const [lang, table] of Object.entries(TABLES)) {
    const t = (text) => table[text] ?? text;
    for (const platform of ['darwin', 'win32', 'linux']) {
      const store = credentialStoreName('keyring', platform, t);
      for (const code of CODES) {
        const told = describeResolveFailure(code, 'keyring', platform, t);
        const text = `${told.headline} ${told.detail}`;
        assert.doesNotMatch(text, /\{\w+\}/, `${lang}/${platform}/${code}: an unfilled slot`);
        assert.doesNotMatch(text, /\b(?:nothing was changed|could not be|choose again|keep the)\b/i, `${lang}/${platform}/${code}: English left in "${text}"`);
        if (code === 'keyring_unreadable') assert.ok(told.headline.includes(store), `${lang}/${platform}: the headline names "${store}"`);
        if (code === 'fallback_unreadable') assert.ok(told.detail.includes(store), `${lang}/${platform}: the advice names "${store}"`);
      }
    }
  }
});

test('Windows never reads Mac words in any language', () => {
  const MAC = /macOS|keychain|Связк|связк|钥匙串|キーチェーン|llavero de macOS|tu llavero/i;
  for (const [lang, table] of Object.entries(TABLES)) {
    const t = (text) => table[text] ?? text;
    for (const code of ['keyring_unreadable', 'fallback_unreadable', 'store_degraded', 'persist_failed']) {
      const told = describeResolveFailure(code, 'keyring', 'win32', t);
      assert.doesNotMatch(`${told.headline} ${told.detail}`, MAC, `${lang}/${code} on Windows`);
    }
    assert.doesNotMatch(credentialStoreName('keyring', 'win32', t), MAC, `${lang}: the Windows store name`);
    assert.match(describeResolveFailure('keyring_unreadable', 'keyring', 'win32', t).detail, /Windows/, `${lang}: the Windows advice names Windows`);
  }
});

test('Chinese and Japanese sentences end the way those languages end a sentence', () => {
  for (const lang of ['zh', 'ja']) {
    const t = (text) => TABLES[lang][text] ?? text;
    const told = describeResolveFailure('snapshot_failed', 'keyring', 'darwin', t);
    assert.match(told.headline, /。$/, `${lang} headline`);
    assert.match(told.detail, /。$/, `${lang} detail`);
  }
});

test('described keys are worded per language and brand names are left alone', () => {
  const stores = {
    keyring: { mtimeIso: null, keys: [{ name: 'groqSttApiKey', last4: 'aaaa' }, { name: 'customEmbeddingApiKey', last4: 'bbbb' }, { name: 'geminiApiKey', last4: 'cccc' }] },
    fallback: { mtimeIso: null, keys: [] },
  };
  const ja = compareCredentialStores(stores, (text) => CREDENTIAL_STORES_JA[text] ?? text).rows.map((r) => r.label);
  assert.ok(ja.includes('Groq 音声') && ja.includes('カスタム埋め込み') && ja.includes('Gemini'), ja.join(' | '));
  const en = compareCredentialStores(stores).rows.map((r) => r.label);
  assert.ok(en.includes('Groq speech') && en.includes('Custom embeddings') && en.includes('Gemini'), en.join(' | '));
});

test('the saved time is written in the language it is given', () => {
  const at = Date.parse('2026-09-28T09:14:00.000Z');
  const now = Date.parse('2026-10-02T00:00:00Z');
  assert.match(formatSavedAt(at, { locale: 'ru', timeZone: 'UTC', now }), /сент/);
  assert.match(formatSavedAt(at, { locale: 'ja', timeZone: 'UTC', now }), /9月28日/);
  assert.match(formatSavedAt(at, { locale: 'es', timeZone: 'UTC', now }), /sept?/);
});
