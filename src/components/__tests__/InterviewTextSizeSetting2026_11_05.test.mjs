// Settings › Overlay › Text size, and how the overlay applies it (#673:
// "Cmd +" zoomed the whole interview window and cut the bottom off). The
// value itself is covered by src/lib/__tests__/InterviewTextScale2026_11_05.test.mjs;
// the menu side by electron/services/__tests__/InterviewTextScale2026_11_05.test.mjs.
//
// Run with: node --experimental-strip-types --test src/components/__tests__/InterviewTextSizeSetting2026_11_05.test.mjs

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
  const start = src.indexOf('const TextSizeRow');
  const end = src.indexOf('const ScreenshotScreenRow', start);
  assert.ok(start > 0 && end > start, 'TextSizeRow found');
  return { src, block: src.slice(start, end) };
};

test('the row saves through the shared helper and follows changes from the overlay', () => {
  const { src, block } = rowBlock();
  assert.match(block, /setInterviewTextScale\(stepInterviewTextScale\(scale, step\)\)/);
  assert.match(block, /onInterviewTextScaleChanged\?\.\(/);
  assert.match(block, /removeEventListener\('storage', sync\)/);
  assert.equal((src.match(/<TextSizeRow \/>/g) || []).length, 1);
});

test('every string in the row is translated, and the table has no leftover rows', async () => {
  const { block } = rowBlock();
  const used = [...new Set([...block.matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)+)\1\)/g)].map((m) => m[2].replace(/\\'/g, "'")))];
  assert.ok(used.length >= 5, `found ${used.length} strings`);

  const table = await import(pathToFileURL(path.join(SRC, 'i18n.textSize.ts')).href);
  const rows = new Set(table.TEXT_SIZE_EN);
  for (const s of used) assert.ok(rows.has(s), `no translation row for: ${s}`);
  for (const r of rows) assert.ok(used.includes(r), `leftover row: ${r}`);
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) {
    const column = table[`TEXT_SIZE_${lang}`];
    for (const s of used) assert.ok(column[s] && column[s] !== s, `${lang} missing: ${s}`);
  }
  const i18n = read('i18n.tsx');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.match(i18n, new RegExp(`\\.\\.\\.TEXT_SIZE_${lang},`));
});

test('the overlay sets the variable and only message rows are zoomed', () => {
  const app = read('App.tsx');
  assert.match(app, /'--interview-text-scale' as '--interview-text-scale'\]: String\(interviewTextScale\)/);
  // The menu's Zoom In / Out reach only the overlay window's listener.
  assert.match(app, /isOverlayWindow\s*\?\s*window\.electronAPI\?\.onInterviewTextScaleStep/);

  const css = read('index.css');
  assert.match(css, /\[data-text-scale\]\s*\{\s*zoom:\s*var\(--interview-text-scale,\s*1\);\s*\}/);

  const ui = read('components/NativelyInterface.tsx');
  const row = ui.slice(ui.indexOf('const MessageRow'), ui.indexOf('const MessageRow') + 4000);
  assert.match(row, /className="w-full min-w-0" data-text-scale=""/);
  // Never on the scroller: its max-height is the window budget, and zooming
  // it would grow the budget too and cut the footer off again.
  const scroller = ui.slice(ui.indexOf('ref={scrollContainerRef}'), ui.indexOf('ref={scrollContainerRef}') + 400);
  assert.doesNotMatch(scroller, /data-text-scale/);
});
