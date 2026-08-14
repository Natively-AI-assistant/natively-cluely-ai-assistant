import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const mainSource = readFileSync(mainPath, 'utf8');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

function extractClassMethod(src, methodName) {
  const methodRe = new RegExp(`private\\s+${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(src);
  assert.ok(match, `could not locate ${methodName}`);
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return src.slice(start, i - 1);
}

function extractRegionAround(src, needle, chars = 1_500) {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `could not locate ${needle}`);
  return src.slice(Math.max(0, idx - 300), idx + chars);
}

test('main routes global-shortcut events only to launcher and overlay surfaces', () => {
  const helperBody = extractClassMethod(mainSource, 'sendToMeetingSurfaces');
  assert.ok(/getLauncherWindow\s*\(\s*\)/.test(helperBody), 'BUG: meeting-surface sender must include launcher window.');
  assert.ok(/getOverlayWindow\s*\(\s*\)/.test(helperBody), 'BUG: meeting-surface sender must include overlay window.');
  assert.ok(/new\s+Set\s*<\s*number\s*>\s*\(/.test(helperBody), 'BUG: meeting-surface sender must dedupe launcher/overlay IDs.');

  const shortcutRegion = extractRegionAround(mainSource, "'chat:whatToAnswer'", 3_500);
  assert.ok(/this\.sendToMeetingSurfaces\s*\(\s*['"]global-shortcut['"]/.test(shortcutRegion), 'BUG: chat global shortcuts must use targeted meeting-surface dispatch.');
  assert.ok(!/BrowserWindow\.getAllWindows\s*\(\s*\)/.test(shortcutRegion), 'BUG: chat global shortcuts must not broadcast to every BrowserWindow.');

  const processRegion = extractRegionAround(mainSource, "'general:process-screenshots'", 1_000);
  const resetRegion = extractRegionAround(mainSource, "'general:reset-cancel'", 1_000);
  assert.ok(/this\.sendToMeetingSurfaces\s*\(\s*['"]global-shortcut['"]/.test(processRegion), 'BUG: process-screenshots shortcut must use targeted meeting-surface dispatch.');
  assert.ok(/this\.sendToMeetingSurfaces\s*\(\s*['"]global-shortcut['"]/.test(resetRegion), 'BUG: reset-cancel shortcut must use targeted meeting-surface dispatch.');
  assert.ok(!/BrowserWindow\.getAllWindows\s*\(\s*\)/.test(processRegion + resetRegion), 'BUG: general global shortcuts must not broadcast to every BrowserWindow.');
});

test('phone mirror action commands target launcher and overlay, not every BrowserWindow', () => {
  const phoneActionRegion = extractRegionAround(ipcSource, "cmd.type === 'action'", 1_200);
  assert.ok(/getWindowHelper\s*\(\s*\)/.test(phoneActionRegion), 'BUG: phone action dispatch must use WindowHelper surface references.');
  assert.ok(/getLauncherWindow\s*\(\s*\)/.test(phoneActionRegion), 'BUG: phone action dispatch must include launcher window.');
  assert.ok(/getOverlayWindow\s*\(\s*\)/.test(phoneActionRegion), 'BUG: phone action dispatch must include overlay window.');
  assert.ok(/new\s+Set\s*<\s*number\s*>\s*\(/.test(phoneActionRegion), 'BUG: phone action dispatch must dedupe launcher/overlay IDs.');
  assert.ok(/try\s*\{[\s\S]*webContents\.send\s*\([\s\S]*\}\s*catch\s*\{/.test(phoneActionRegion), 'BUG: phone action dispatch must catch per-window send failures so one stale window cannot block the other surface.');
  assert.ok(!/BrowserWindow\.getAllWindows\s*\(\s*\)/.test(phoneActionRegion), 'BUG: phone action dispatch must not broadcast to every BrowserWindow.');
});
