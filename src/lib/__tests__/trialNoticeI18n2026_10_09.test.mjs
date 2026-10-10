// The overlay's free-trial notice is translated, and stays translated
// (2026-10-09). The table is checked against the strings the component passes
// to t(), so a sentence added there without a row fails here instead of
// quietly showing English in a Japanese overlay, and a row nothing uses any
// more is not left behind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIAL_NOTICE_EN, TRIAL_NOTICE_ES, TRIAL_NOTICE_JA, TRIAL_NOTICE_RU, TRIAL_NOTICE_ZH } from '../../i18n.trial.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
// Both places the trial speaks: the meeting overlay's notice and the
// launcher's small card with the clock and the two allowances (2026-10-10).
const component = ['components/overlay/TrialNotice.tsx', 'components/trial/TrialMeterToaster.tsx']
  .map((file) => fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n');
const TABLES = { ru: TRIAL_NOTICE_RU, zh: TRIAL_NOTICE_ZH, ja: TRIAL_NOTICE_JA, es: TRIAL_NOTICE_ES };
const slots = (text) => (text.match(/\{\w+\}/g) || []).sort();

// Every string literal handed to t(): t('…') and t("…").
const used = [...component.matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*\)/g)]
  .map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'"));
// "Dismiss" is the overlay's existing word for a banner's close, with rows of its own.
const own = [...new Set(used)].filter((s) => s !== 'Dismiss');
// Written the same way in these languages, so "left in English" does not apply.
const SAME_WORD = { AI: ['zh', 'ja'] };

test('the component passes every visible string through t()', () => {
  assert.ok(own.length >= 14, `found only ${own.length} strings: the scan is broken`);
  // A JSX text node or a string prop that skipped t() would show English everywhere.
  for (const prop of ['title', 'message', 'dismissLabel']) {
    assert.ok(!new RegExp(`${prop}="[A-Za-z]`).test(component), `${prop} is a bare string`);
  }
});

test('every string has a row in every language, and no row is left over', () => {
  assert.deepEqual([...TRIAL_NOTICE_EN].sort(), [...own].sort());
  for (const [lang, table] of Object.entries(TABLES)) {
    assert.deepEqual(Object.keys(table).sort(), [...own].sort(), `${lang} covers exactly what the notice says`);
    for (const sentence of own) {
      assert.ok(table[sentence].trim().length > 0, `${lang}: "${sentence}" is empty`);
      if (SAME_WORD[sentence]?.includes(lang)) continue;
      assert.notEqual(table[sentence], sentence, `${lang}: "${sentence}" was left in English`);
    }
  }
});

test('a translation keeps the placeholders of its sentence, and the product name', () => {
  for (const [lang, table] of Object.entries(TABLES)) {
    for (const sentence of own) {
      assert.deepEqual(slots(table[sentence]), slots(sentence), `${lang}: "${sentence}"`);
      if (sentence.includes('Natively')) assert.ok(table[sentence].includes('Natively'), `${lang}: "${sentence}" lost the name`);
    }
  }
});

test('the launcher card adds its two labels and shares the rest', () => {
  const card = fs.readFileSync(path.join(SRC, 'components/trial/TrialMeterToaster.tsx'), 'utf8');
  for (const word of ['Free trial', 'Voice', 'AI', 'See plans', 'Dismiss']) {
    assert.ok(card.includes(`t('${word}')`), `the card says "${word}" through t()`);
  }
});

test('the tables are part of the app dictionary', () => {
  const dict = fs.readFileSync(path.join(SRC, 'i18n.tsx'), 'utf8');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.ok(dict.includes(`...TRIAL_NOTICE_${lang},`), lang);
});
