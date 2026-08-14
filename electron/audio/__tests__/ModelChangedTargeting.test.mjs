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

function extractMethod(src, signaturePattern, label) {
  const match = signaturePattern.exec(src);
  assert.ok(match, `could not locate ${label}`);
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${label}`);
  return src.slice(start, i - 1);
}

function extractRegion(src, needle, chars = 1_500) {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `could not locate ${needle}`);
  return src.slice(Math.max(0, idx - 300), idx + chars);
}

test('AppState sends model-changed only to current model listeners', () => {
  const helperBody = extractMethod(mainSource, /public\s+sendModelChanged\s*\([^)]*\)[^{]*\{/, 'sendModelChanged');

  assert.ok(/new\s+Set\s*<\s*number\s*>\s*\(/.test(helperBody), 'BUG: sendModelChanged must dedupe target windows.');
  assert.ok(/getOverlayWindow\s*\(\s*\)/.test(helperBody), 'BUG: sendModelChanged must target the overlay, where NativelyInterface listens.');
  assert.ok(/modelSelectorWindowHelper\.getWindow\s*\(\s*\)/.test(helperBody), 'BUG: sendModelChanged must target the model selector window.');
  assert.ok(/sendToWindow\s*\(\s*win\s*,\s*['"]model-changed['"]\s*,\s*modelId\s*\)/.test(helperBody), 'BUG: sendModelChanged must use safe window sends.');
  assert.ok(!/BrowserWindow\.getAllWindows\s*\(\s*\)/.test(helperBody), 'BUG: sendModelChanged must not broadcast to every BrowserWindow.');
});

test('model-changed call sites use the targeted helper', () => {
  const meetingStopRegion = extractRegion(mainSource, 'Reverting model to default', 1_000);
  assert.ok(/this\.sendModelChanged\s*\(\s*defaultModel\s*\)/.test(meetingStopRegion), 'BUG: meeting-stop default model revert must use targeted model-changed dispatch.');
  assert.ok(!/BrowserWindow\.getAllWindows\s*\(\s*\)[\s\S]*model-changed/.test(meetingStopRegion), 'BUG: meeting-stop model-changed must not broadcast to every BrowserWindow.');

  for (const needle of ['set-natively-api-key', "safeHandle('set-model'", "safeHandle('set-default-model'"]) {
    const region = extractRegion(ipcSource, needle, 2_000);
    assert.ok(/appState\.sendModelChanged\s*\(/.test(region), `BUG: ${needle} must use targeted model-changed dispatch.`);
    assert.ok(!/BrowserWindow\.getAllWindows\s*\(\s*\)[\s\S]*model-changed/.test(region), `BUG: ${needle} must not broadcast model-changed to every BrowserWindow.`);
  }

  for (const needle of ["safeHandle('set-model'", "safeHandle('set-default-model'"]) {
    const region = extractRegion(ipcSource, needle, 1_200);
    assert.ok(
      region.indexOf('appState.sendModelChanged(modelId)') < region.indexOf('appState.modelSelectorWindowHelper.hideWindow()'),
      `BUG: ${needle} must notify the model selector before hiding it.`,
    );
  }
});
