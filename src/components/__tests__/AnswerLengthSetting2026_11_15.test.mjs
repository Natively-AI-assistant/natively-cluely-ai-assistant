// Settings › Overlay › Answer length: every string translated (2026-11-15).
// The row shipped in 3.2.0 with none of its eight strings in any table, so
// Russian, Chinese, Japanese and Spanish showed it in English. The option
// labels and descriptions reach t() through a variable, so they are read from
// ANSWER_LENGTHS, not only from t('...') literals.
//
// Run with: node --experimental-strip-types --test src/components/__tests__/AnswerLengthSetting2026_11_15.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('every Answer length string is translated, and the table has no leftover rows', async () => {
  const src = read('components/settings/OverlaySettings.tsx');
  const start = src.indexOf('type AnswerLength');
  const end = src.indexOf('type ScreenshotDisplay', start);
  assert.ok(start > 0 && end > start, 'AnswerLengthRow found');
  const block = src.slice(start, end);

  const literals = [...block.matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)+)\1\)/g)].map((m) => m[2].replace(/\\'/g, "'"));
  const options = [...block.matchAll(/\b(?:label|description): '([^']+)'/g)].map((m) => m[1]);
  assert.match(block, /t\(o\.label\)/, 'option labels go through t()');
  assert.match(block, /t\(ANSWER_LENGTHS\[index\]\.description\)/, 'option descriptions go through t()');
  // Lines held in a constant and passed to t() by name (#794: set by the Real-time prompt).
  const constants = [...block.matchAll(/^const ([A-Z_]+_LINE) = "([^"]+)";/gm)];
  for (const [, name] of constants) assert.match(block, new RegExp(`t\\(${name}\\)`), `${name} goes through t()`);
  const used = [...new Set([...literals, ...options, ...constants.map((m) => m[2])])];
  assert.ok(used.length >= 8, `found ${used.length} strings`);

  const table = await import(pathToFileURL(path.join(SRC, 'i18n.answerLength.ts')).href);
  const rows = new Set(table.ANSWER_LENGTH_EN);
  for (const s of used) assert.ok(rows.has(s), `no translation row for: ${s}`);
  for (const r of rows) assert.ok(used.includes(r), `leftover row: ${r}`);
  const i18n = read('i18n.tsx');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) {
    const column = table[`ANSWER_LENGTH_${lang}`];
    for (const s of used) assert.ok(column[s] && column[s] !== s, `${lang} missing: ${s}`);
    assert.match(i18n, new RegExp(`\\.\\.\\.ANSWER_LENGTH_${lang},`));
  }
});
