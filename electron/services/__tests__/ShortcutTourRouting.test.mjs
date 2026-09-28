// First-launch shortcut tour: while it is up, the shortcuts it teaches are
// practice presses routed to its renderer, not real actions. Toggle Visibility
// would otherwise hide the very launcher the tour is drawn in. This pins the
// main-process contract (source-level: it cannot boot Electron here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.resolve(here, '../../main.ts'), 'utf8');
const ipc = fs.readFileSync(path.resolve(here, '../../ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.resolve(here, '../../preload.ts'), 'utf8');

test('the tour intercepts its shortcuts before any real action runs', () => {
  const i = main.indexOf('keybindManager.onShortcutTriggered(');
  assert.notEqual(i, -1);
  const handler = main.slice(i, i + 900);
  const route = handler.indexOf("tour.send('onboarding:tour-shortcut', actionId)");
  const firstAction = handler.indexOf('this.toggleMainWindow()');
  assert.ok(route !== -1 && firstAction !== -1 && route < firstAction, 'routing must come before toggleMainWindow');
  assert.match(handler.slice(route, route + 120), /return;/, 'a routed press must not also run the real action');
});

test('only the three taught shortcuts are routed', () => {
  const m = main.match(/SHORTCUT_TOUR_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'SHORTCUT_TOUR_ACTIONS not found');
  const ids = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
  assert.deepEqual(ids, ['chat:whatToAnswer', 'general:take-screenshot', 'general:toggle-visibility']);
});

test('routing clears itself if the tour renderer reloads or dies', () => {
  const i = main.indexOf('public setShortcutTour(');
  assert.notEqual(i, -1);
  const body = main.slice(i, i + 700);
  for (const ev of ['did-start-loading', 'destroyed', 'render-process-gone']) {
    assert.ok(body.includes(`contents.once('${ev}', clear)`), `must clear on ${ev}`);
  }
});

test('the IPC is bound to its sender and exposed through the preload', () => {
  assert.match(ipc, /safeHandle\('onboarding:set-shortcut-tour', async \(event, active: boolean\) => \{\s*appState\.setShortcutTour\(active === true, event\.sender\);/);
  assert.ok(preload.includes("ipcRenderer.invoke('onboarding:set-shortcut-tour', active)"));
  assert.ok(preload.includes("ipcRenderer.on('onboarding:tour-shortcut', subscription)"));
});
