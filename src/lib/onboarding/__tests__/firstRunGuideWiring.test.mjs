// First-run guide: the main process stores the guide and tells every window.
// Source checks, like the other IPC wiring tests: the reducer itself is tested
// in firstRunGuide.test.mjs.
// Run: node --test src/lib/onboarding/__tests__/firstRunGuideWiring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('main handles guide:get and guide:dispatch and broadcasts guide:changed', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.ok(ipc.includes("safeHandle('guide:get'"));
  assert.ok(ipc.includes("safeHandle('guide:dispatch'"));
  assert.ok(ipc.includes("'guide:changed'"));
  assert.ok(ipc.includes('GUIDE_EVENT_TYPES'), 'events are validated against the reducer list');
  assert.ok(/sm\.set\('firstRunGuide'/.test(ipc), 'state is saved with the other onboarding state');
});

test('preload exposes guideGet, guideDispatch and onGuideChanged (types and implementation)', () => {
  const pre = read('electron/preload.ts');
  for (const name of ['guideGet', 'guideDispatch', 'onGuideChanged']) {
    const hits = pre.split(`${name}:`).length - 1;
    assert.ok(hits >= 2, `${name} declared and implemented (found ${hits})`);
  }
  assert.ok(pre.includes("ipcRenderer.invoke('guide:get')"));
  assert.ok(pre.includes("ipcRenderer.invoke('guide:dispatch'"));
  assert.ok(pre.includes("'guide:changed'"));
});

test('SettingsManager has a firstRunGuide slot', () => {
  assert.ok(read('electron/services/SettingsManager.ts').includes('firstRunGuide?:'));
});

test('the renderer ElectronAPI type declares the guide calls', () => {
  const d = read('src/types/electron.d.ts');
  for (const name of ['guideGet:', 'guideDispatch:', 'onGuideChanged:']) assert.ok(d.includes(name), name);
});
