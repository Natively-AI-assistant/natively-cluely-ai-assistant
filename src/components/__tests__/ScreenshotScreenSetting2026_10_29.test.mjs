// Settings › Overlay › Screenshot screen, and the area selector's click to
// capture a whole screen (customer report, three monitors, 2026-10-29). The
// main-process side is asserted in
// electron/services/__tests__/ScreenshotScreenChoice2026_10_29.test.mjs.
//
// Run with: node --experimental-strip-types --test src/components/__tests__/ScreenshotScreenSetting2026_10_29.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const rowBlock = () => {
  const src = read('components/settings/OverlaySettings.tsx');
  const start = src.indexOf('const ScreenshotScreenRow');
  const end = src.indexOf('export const OverlaySettings', start);
  assert.ok(start > 0 && end > start, 'ScreenshotScreenRow found');
  return { src, block: src.slice(start, end) };
};

test('the row reads and writes the setting, and shows only with more than one screen', () => {
  const { src, block } = rowBlock();
  assert.match(block, /getScreenshotDisplay\?\.\(\)/);
  assert.match(block, /setScreenshotDisplay\?\.\(value\)/);
  assert.match(block, /if \(displays\.length < 2\) return null;/);
  // A refused write puts the old choice back instead of showing one that did not save.
  assert.match(block, /if \(!res\?\.success\) setPreference\(previous\)/);
  // On both meeting surfaces.
  assert.equal((src.match(/<ScreenshotScreenRow \/>/g) || []).length, 2);
});

test('every string in the row is translated, and the table has no leftover rows', async () => {
  const { block } = rowBlock();
  const used = [...new Set([...block.matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)+)\1\)/g)].map((m) => m[2].replace(/\\'/g, "'")))];
  assert.ok(used.length >= 6, `found ${used.length} strings`);

  const table = await import(pathToFileURL(path.join(SRC, 'i18n.screenshotScreen.ts')).href);
  const rows = new Set(table.SCREENSHOT_SCREEN_EN);
  for (const s of used) assert.ok(rows.has(s), `no translation row for: ${s}`);
  for (const r of rows) assert.ok(used.includes(r), `leftover row: ${r}`);
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) {
    const column = table[`SCREENSHOT_SCREEN_${lang}`];
    for (const s of used) assert.ok(column[s] && column[s] !== s, `${lang} missing: ${s}`);
  }
  const i18n = read('i18n.tsx');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.match(i18n, new RegExp(`\\.\\.\\.SCREENSHOT_SCREEN_${lang},`));
});

test('the selector: a click picks the whole screen, a drag reports itself to main', () => {
  const src = read('components/Cropper.tsx');
  const commit = src.slice(src.indexOf('const commitSelection'), src.indexOf('// Reset handler'));
  assert.match(commit, /width > MIN_SELECTION_SIZE && height > MIN_SELECTION_SIZE\) \{\s*\(window as any\)\.electronAPI\.cropperConfirmed/);
  assert.match(commit, /width <= MIN_SELECTION_SIZE && height <= MIN_SELECTION_SIZE[\s\S]*cropperPickDisplay\(\)/);
  assert.match(commit, /cropperDrag\?\.\(false\)/);
  assert.match(src, /handleMouseDown[\s\S]{0,200}cropperDrag\?\.\(true\)/);
  // The window can move between screens while open: the canvas follows its size.
  assert.match(src, /window\.addEventListener\('resize', handleResize\)/);
  assert.match(src, /\}, \[startPos, currentPos, theme, viewport\]\);/);
  assert.match(src, /or click for the whole screen/);
});
