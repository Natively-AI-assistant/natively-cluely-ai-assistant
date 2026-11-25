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

/** Body of the `safeHandle('<channel>', async (...) => { ... })` that `needle` starts. */
function handlerBody(needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return extractMethod(ipcSource, new RegExp(`${escaped},\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{`), needle);
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

  // Anchored on the handler registration: the bare channel name also appears in
  // the doc comment of the trial runtime-sync helper above it, whose window
  // holds broadcastCredentialsChanged() (an intentional all-window send) and
  // the words 'model-changed', which read as a broadcast of model-changed.
  for (const needle of ["safeHandle('set-natively-api-key'", "safeHandle('set-model'", "safeHandle('set-default-model'"]) {
    // The whole handler, not a fixed window after it: set-natively-api-key kept
    // growing (pack keys, 2026-11-17 to 11-19) and pushed its model sync past
    // a 2,000- and then a 2,400-character window.
    const region = handlerBody(needle);
    assert.ok(/appState\.sendModelChanged\s*\(/.test(region), `BUG: ${needle} must use targeted model-changed dispatch.`);
    // Each model change in the handler tells the UI with that same model, before
    // the next change. A pass over the whole body alone would let one sync stand
    // in for another (set-natively-api-key also syncs on its revert path).
    const changes = [...region.matchAll(/llmHelper\.setModel\(\s*([\w.]+)/g)];
    assert.ok(changes.length > 0, `${needle}: no llmHelper.setModel( found`);
    changes.forEach((change, n) => {
      const until = changes[n + 1]?.index ?? region.length;
      const after = region.slice(change.index, until);
      assert.ok(
        after.includes(`appState.sendModelChanged(${change[1]})`),
        `BUG: ${needle} changes the model to ${change[1]} without appState.sendModelChanged(${change[1]}).`,
      );
    });
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
