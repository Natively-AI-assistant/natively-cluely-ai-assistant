// The credential-stores card in Settings → AI Providers (2026-10-02).
//
// It used to list every saved text setting by its internal field name
// ("aiResponseLanguage (…····)"), call the OS store "System keychain" on
// Windows, and answer six different refusals with one sentence. This pins what
// it says now: provider names, a comparison of the two sets, the OS store named
// for the platform, and words for every reason main can refuse a choice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_KEY_LABELS,
  compareCredentialStores,
  credentialKeyLabel,
  credentialStoreName,
  describeResolveFailure,
  formatSavedAt,
} from '../credentialStoresConflict.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const manager = fs.readFileSync(path.join(root, 'electron/services/CredentialsManager.ts'), 'utf8');
const PLATFORMS = ['darwin', 'win32', 'linux'];

test('every key field main can store has a name written for display', () => {
  const start = manager.indexOf('export interface StoredCredentials');
  assert.notEqual(start, -1, 'StoredCredentials not found');
  const body = manager.slice(start, manager.indexOf('\n}', start));
  const fields = [...body.matchAll(/^\s*(\w+ApiKey)\??:/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 20, `expected the key fields, found ${fields.length}`);
  const missing = fields.filter((f) => !Object.hasOwn(CREDENTIAL_KEY_LABELS, f));
  assert.deepEqual(missing, [], 'a new key field needs a display name in CREDENTIAL_KEY_LABELS');
});

test('a field the table has not met is spelled out, never shown raw', () => {
  assert.equal(credentialKeyLabel('geminiApiKey'), 'Gemini');
  assert.equal(credentialKeyLabel('openAiSttApiKey'), 'OpenAI speech');
  assert.equal(credentialKeyLabel('someNewVendorApiKey'), 'Some New Vendor');
  assert.equal(credentialKeyLabel('toString'), 'To String');
});

const STORES = {
  keyring: {
    mtimeIso: '2026-09-28T09:14:00.000Z',
    keys: [
      { name: 'aiResponseLanguage', last4: '····' }, { name: 'deepgramApiKey', last4: '4c1e' },
      { name: 'defaultModel', last4: 'lash' }, { name: 'geminiApiKey', last4: 'x7Qa' },
      { name: 'openaiApiKey', last4: '9fTz' },
    ],
  },
  fallback: {
    mtimeIso: '2026-09-30T17:42:00.000Z',
    keys: [
      { name: 'aiResponseLanguage', last4: '····' }, { name: 'deepgramApiKey', last4: '4c1e' },
      { name: 'defaultModel', last4: 'lash' }, { name: 'geminiApiKey', last4: 'x7Qa' },
      { name: 'groqApiKey', last4: 'Lm3k' }, { name: 'groqPreferredModel', last4: '-27b' },
      { name: 'openaiApiKey', last4: 'p2Vd' },
    ],
  },
};

test('the two sets become one row per key, and only keys are listed', () => {
  const view = compareCredentialStores(STORES);
  assert.deepEqual(view.rows.map((r) => r.label), ['Deepgram', 'Gemini', 'Groq', 'OpenAI']);
  assert.deepEqual(view.rows.filter((r) => r.differs).map((r) => [r.label, r.keyring, r.fallback]), [
    ['Groq', null, 'Lm3k'],
    ['OpenAI', '9fTz', 'p2Vd'],
  ]);
  assert.deepEqual(view.keyring, { count: 3, others: 2, savedAt: Date.parse('2026-09-28T09:14:00.000Z') });
  assert.deepEqual(view.fallback, { count: 4, others: 3, savedAt: Date.parse('2026-09-30T17:42:00.000Z') });
  assert.equal(view.newer, 'fallback');
});

test('an unreadable set, a missing time and a missing answer do not throw', () => {
  const view = compareCredentialStores({ keyring: { keys: [], mtimeIso: null }, fallback: STORES.fallback });
  assert.equal(view.keyring.count, 0);
  assert.equal(view.newer, null, 'no "newer" claim when one time is unknown');
  assert.ok(view.rows.every((r) => r.differs && r.keyring === null));
  assert.deepEqual(compareCredentialStores(null).rows, []);
  assert.deepEqual(compareCredentialStores({ keyring: { keys: [null, { last4: 'x' }] } }).rows, []);
  const same = compareCredentialStores({ keyring: STORES.keyring, fallback: { ...STORES.fallback, mtimeIso: STORES.keyring.mtimeIso } });
  assert.equal(same.newer, null, 'equal times are not ordered');
});

test('the OS store is named for the platform; "keychain" is a Mac word', () => {
  assert.equal(credentialStoreName('keyring', 'darwin'), 'macOS Keychain');
  assert.equal(credentialStoreName('keyring', 'win32'), 'Windows account');
  assert.equal(credentialStoreName('keyring', 'linux'), 'System keyring');
  for (const p of PLATFORMS) assert.equal(credentialStoreName('fallback', p), 'App backup');
});

test('the saved time has no seconds, and a year only when it is not this one', () => {
  const at = Date.parse('2026-09-28T09:14:37.000Z');
  const o = { locale: 'en-GB', timeZone: 'UTC' };
  assert.equal(formatSavedAt(at, { ...o, now: Date.parse('2026-10-02T00:00:00Z') }), '28 Sept, 09:14');
  assert.match(formatSavedAt(at, { ...o, now: Date.parse('2027-01-05T00:00:00Z') }), /2026/);
  assert.equal(formatSavedAt(null), null);
  assert.equal(formatSavedAt(NaN), null);
});

// Every reason resolveAmbiguousStores can return, read from the source so a new
// one cannot be added without its words, plus the IPC handler's own.
function refusalCodes() {
  const start = manager.indexOf('public resolveAmbiguousStores(');
  assert.notEqual(start, -1, 'resolveAmbiguousStores not found');
  const body = manager.slice(start, manager.indexOf('\n    /**', start));
  return [...new Set([...body.matchAll(/error: '(\w+)'/g)].map((m) => m[1])), 'internal_error'];
}

test('every refusal main can send has its own words on both platforms', () => {
  const codes = refusalCodes();
  for (const expected of ['not_ambiguous', 'invalid_choice', 'store_degraded', 'keyring_unreadable', 'fallback_unreadable', 'snapshot_failed', 'persist_failed']) {
    assert.ok(codes.includes(expected), `${expected} not found in resolveAmbiguousStores`);
  }
  for (const platform of PLATFORMS) {
    for (const code of codes) {
      for (const choice of ['keyring', 'fallback', 'merge']) {
        const told = describeResolveFailure(code, choice, platform);
        if (code === 'not_ambiguous') { assert.deepEqual(told, { gone: true }); continue; }
        assert.ok(told.headline && told.detail, `${code} has no words`);
        assert.match(told.headline, /nothing was changed\.$/, `${code}: the headline says nothing was changed`);
        const text = `${told.headline} ${told.detail}`;
        assert.doesNotMatch(text, /[a-z]_[a-z]|\{|\}/, `${code}: a code or an unfilled slot is shown`);
      }
    }
  }
  const generic = describeResolveFailure(undefined, 'merge', 'darwin').headline;
  const specific = ['store_degraded', 'keyring_unreadable', 'fallback_unreadable', 'snapshot_failed', 'persist_failed'];
  for (const code of specific) {
    assert.notEqual(describeResolveFailure(code, 'keyring', 'darwin').headline, generic, `${code} fell through to the generic sentence`);
  }
});

test('Windows never reads Mac words, and the Mac never reads Windows words', () => {
  for (const code of refusalCodes().filter((c) => c !== 'not_ambiguous')) {
    const win = describeResolveFailure(code, 'keyring', 'win32');
    assert.doesNotMatch(`${win.headline} ${win.detail}`, /keychain|macOS|\bMac\b/i, `${code} on Windows`);
    const mac = describeResolveFailure(code, 'keyring', 'darwin');
    assert.doesNotMatch(`${mac.headline} ${mac.detail}`, /Windows/i, `${code} on macOS`);
  }
  assert.match(describeResolveFailure('keyring_unreadable', 'keyring', 'win32').detail, /Windows account/);
  assert.match(describeResolveFailure('keyring_unreadable', 'keyring', 'darwin').detail, /keychain/);
  assert.match(describeResolveFailure('fallback_unreadable', 'fallback', 'win32').detail, /Windows account set/);
});

test('wording goes through t before a name goes in', () => {
  const seen = [];
  const t = (text) => { seen.push(text); return text; };
  describeResolveFailure('keyring_unreadable', 'keyring', 'darwin', t);
  assert.ok(seen.includes('The {store} set could not be read, so nothing was changed.'));
  assert.ok(seen.includes('macOS Keychain'));
});
