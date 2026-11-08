// The assist features' words are translated (2026-10-15). The table
// (src/i18n.assist.ts) is checked against the strings the components pass to
// t(), so a sentence added without a row fails here instead of showing English
// in a Japanese launcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSIST_EN, ASSIST_ES, ASSIST_JA, ASSIST_RU, ASSIST_ZH } from '../../i18n.assist.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');
const launcher = read('components/assist/AssistToday.tsx');
// The overlay's buttons are labelled from one table (2026-10-20, Settings ›
// Overlay), passed through t() where they are drawn.
const overlayButtons = read('components/overlay/overlayButtons.ts');
const tStrings = (text) => [...text.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)].map((m) => m[1].replace(/\\'/g, "'"));
// Words that already had rows elsewhere in the app.
const EXISTING = new Set(['Dismiss', 'Close', 'Copy', 'Meeting']);

const used = new Set([
  ...tStrings(launcher),
  ...['What did I miss?', 'Define', 'Sound smart'].filter((s) => overlayButtons.includes(`label: '${s}'`)),
].filter((s) => !EXISTING.has(s)));

test('every string the assist components show has a row, and no row is left over', () => {
  assert.ok(used.size >= 10, `found only ${used.size} strings: the scan is broken`);
  assert.deepEqual([...ASSIST_EN].sort(), [...used].sort());
});

test('the launcher no longer shows Coming up today, Catch up or Yours to do (2026-11-01)', () => {
  for (const gone of ['Coming up today', 'Catch up', 'Yours to do', 'Brief me', 'Decided']) {
    assert.ok(!used.has(gone), `still shown: ${gone}`);
  }
  assert.doesNotMatch(launcher, /assistGetCatchUp|assistGetDailyBrief|assistGetMeetingBrief/);
  assert.doesNotMatch(read('components/settings/CalendarSettings.tsx'), /Catch up after back-to-back meetings/);
});

test('every language has every row, translated', () => {
  for (const [lang, table] of Object.entries({ ru: ASSIST_RU, zh: ASSIST_ZH, ja: ASSIST_JA, es: ASSIST_ES })) {
    for (const en of ASSIST_EN) {
      assert.ok(typeof table[en] === 'string' && table[en].trim(), `${lang}: ${en}`);
      if (en.length > 4 && lang !== 'es') assert.notEqual(table[en], en, `${lang} left in English: ${en}`);
    }
  }
});
