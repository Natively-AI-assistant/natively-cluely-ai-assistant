// "Bought a key but no email?" (Plans & Billing) is translated, and stays
// translated (2026-11-12). The table is checked against the strings the
// component passes to t(), so a sentence added there without a row fails here
// instead of quietly showing English in a Japanese Settings panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY_RESEND_EN, KEY_RESEND_ES, KEY_RESEND_JA, KEY_RESEND_RU, KEY_RESEND_ZH } from '../../i18n.keyResend.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const component = fs.readFileSync(path.join(SRC, 'components/settings/KeyResendHelp.tsx'), 'utf8');
const TABLES = { ru: KEY_RESEND_RU, zh: KEY_RESEND_ZH, ja: KEY_RESEND_JA, es: KEY_RESEND_ES };

const used = [...new Set([...component.matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*\)/g)]
  .map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'")))];

test('the component passes its visible strings through t()', () => {
  assert.ok(used.length >= 9, `found only ${used.length} strings: the scan is broken`);
  assert.ok(!/placeholder="[A-Za-z]/.test(component), 'placeholder is a bare string');
});

test('every string has a row in every language, and no row is left over', () => {
  assert.deepEqual([...KEY_RESEND_EN].sort(), [...used].sort());
  for (const [lang, table] of Object.entries(TABLES)) {
    assert.deepEqual(Object.keys(table).sort(), [...used].sort(), lang);
    for (const s of used) {
      assert.ok(table[s].trim().length > 0, `${lang}: "${s}" is empty`);
      assert.notEqual(table[s], s, `${lang}: "${s}" was left in English`);
      if (s.includes('Natively')) assert.ok(table[s].includes('Natively'), `${lang}: "${s}" lost the name`);
    }
  }
});

test('the tables are part of the app dictionary', () => {
  const dict = fs.readFileSync(path.join(SRC, 'i18n.tsx'), 'utf8');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.ok(dict.includes(`...KEY_RESEND_${lang},`), lang);
});
