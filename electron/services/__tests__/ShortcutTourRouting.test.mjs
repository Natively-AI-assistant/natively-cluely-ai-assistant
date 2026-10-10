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
const actions = fs.readFileSync(path.resolve(here, '../shortcutTourActions.ts'), 'utf8');
const ipc = fs.readFileSync(path.resolve(here, '../../ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.resolve(here, '../../preload.ts'), 'utf8');

test('the tour intercepts its shortcuts before any real action runs', () => {
  const i = main.indexOf('keybindManager.onShortcutTriggered(');
  assert.notEqual(i, -1);
  const handler = main.slice(i, i + 900);
  const route = handler.indexOf("tour.send('onboarding:tour-shortcut', actionId)");
  const firstAction = handler.indexOf('this.toggleMainWindow(');
  assert.ok(route !== -1 && firstAction !== -1 && route < firstAction, 'routing must come before toggleMainWindow');
  assert.match(handler.slice(route, route + 120), /return;/, 'a routed press must not also run the real action');
});

test('only the three taught shortcuts are routed', () => {
  const m = actions.match(/SHORTCUT_TOUR_ACTIONS[^=]*= new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'SHORTCUT_TOUR_ACTIONS not found');
  assert.match(main, /import \{ SHORTCUT_TOUR_ACTIONS \} from '\.\/services\/shortcutTourActions'/);
  assert.ok(!main.includes("'chat:whatToAnswer'") || main.indexOf("'chat:whatToAnswer'") > main.indexOf('keybindManager.onShortcutTriggered('),
    'a second literal before the real dispatch would mislead GlobalShortcutTargeting.test.mjs');
  const ids = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
  assert.deepEqual(ids, ['chat:whatToAnswer', 'general:take-screenshot', 'general:toggle-visibility']);
});

test('routing clears itself if the tour renderer reloads or dies', () => {
  const i = main.indexOf('public setShortcutTour(');
  assert.notEqual(i, -1);
  const body = main.slice(i, i + 1600);
  for (const ev of ['did-start-loading', 'destroyed', 'render-process-gone']) {
    assert.ok(body.includes(`contents.on('${ev}', clear)`), `must clear on ${ev}`);
    assert.ok(body.includes(`contents.removeListener('${ev}', clear)`), `must detach the ${ev} listener with the routing`);
  }
});

test('re-arming replaces the previous routing instead of stacking listeners', () => {
  const i = main.indexOf('public setShortcutTour(');
  const body = main.slice(i, i + 1600);
  assert.ok(body.indexOf('this.clearShortcutTour();') < body.indexOf('this.shortcutTourContents = contents;'),
    'the old routing must be cleared before the new one is set');
});

test('the IPC is bound to its sender and exposed through the preload', () => {
  assert.match(ipc, /safeHandle\('onboarding:set-shortcut-tour', async \(event, active: boolean\) => \{\s*appState\.setShortcutTour\(active === true, event\.sender\);/);
  assert.ok(preload.includes("ipcRenderer.invoke('onboarding:set-shortcut-tour', active)"));
  assert.ok(preload.includes("ipcRenderer.on('onboarding:tour-shortcut', subscription)"));
});
