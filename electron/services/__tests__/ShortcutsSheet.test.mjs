// electron/services/__tests__/ShortcutsSheet.test.mjs
//
// Tier-0: curated catalog + display-live resolver + sheet passthrough policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/shortcutsSheet.js'
);

async function load() {
  return import(pathToFileURL(modulePath).href);
}

const DEFAULT_MAP = {
  'general:process-screenshots': 'CommandOrControl+Enter',
  'general:take-screenshot': 'CommandOrControl+H',
  'chat:answer': 'CommandOrControl+5',
  'general:reset-cancel': 'CommandOrControl+R',
  'general:toggle-visibility': 'CommandOrControl+B',
  'general:toggle-mouse-passthrough': 'CommandOrControl+Shift+B',
  'chat:scrollUp': 'CommandOrControl+Up',
  'chat:scrollDown': 'CommandOrControl+Down',
  'chat:scrollLeft': 'CommandOrControl+Alt+Left',
  'chat:scrollRight': 'CommandOrControl+Alt+Right',
  'window:move-up': 'CommandOrControl+Shift+Up',
  'window:move-down': 'CommandOrControl+Shift+Down',
  'window:move-left': 'CommandOrControl+Shift+Left',
  'window:move-right': 'CommandOrControl+Shift+Right',
};

test('catalog has Cluely-parity curated row count and order', async () => {
  const { SHORTCUTS_SHEET_CATALOG } = await load();
  assert.equal(SHORTCUTS_SHEET_CATALOG.length, 9);
  assert.deepEqual(
    SHORTCUTS_SHEET_CATALOG.map((r) => r.id),
    [
      'generate',
      'screenshot',
      'recording',
      'reset',
      'visibility',
      'passthrough',
      'scroll-chat',
      'scroll-content',
      'move-window',
    ]
  );
});

test('resolver maps catalog titles to live default accelerators', async () => {
  const { resolveShortcutsSheetRows } = await load();
  const rows = resolveShortcutsSheetRows(DEFAULT_MAP);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  assert.equal(byId.generate.title, 'Generate Solution');
  assert.deepEqual(byId.generate.keybindIds, ['general:process-screenshots']);
  assert.deepEqual(byId.generate.accelerators, ['CommandOrControl+Enter']);

  assert.equal(byId.recording.title, 'Start/Stop Recording');
  assert.deepEqual(byId.recording.keybindIds, ['chat:answer']);
  assert.deepEqual(byId.recording.accelerators, ['CommandOrControl+5']);

  assert.equal(byId.reset.title, 'Reset Context');
  assert.deepEqual(byId.reset.accelerators, ['CommandOrControl+R']);

  assert.deepEqual(byId['move-window'].accelerators, [
    'CommandOrControl+Shift+Up',
    'CommandOrControl+Shift+Down',
    'CommandOrControl+Shift+Left',
    'CommandOrControl+Shift+Right',
  ]);
});

test('resolver reflects rebound accelerators (display-live)', async () => {
  const { resolveShortcutsSheetRows } = await load();
  const rebound = {
    ...DEFAULT_MAP,
    'general:process-screenshots': 'CommandOrControl+Shift+G',
    'chat:answer': 'CommandOrControl+L',
  };
  const rows = resolveShortcutsSheetRows(rebound);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(byId.generate.accelerators, ['CommandOrControl+Shift+G']);
  assert.deepEqual(byId.recording.accelerators, ['CommandOrControl+L']);
});

test('resolver treats missing/empty accelerators as unbound empty strings', async () => {
  const { resolveShortcutsSheetRows } = await load();
  const rows = resolveShortcutsSheetRows({
    'general:take-screenshot': 'CommandOrControl+H',
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(byId.generate.accelerators, ['']);
  assert.deepEqual(byId.screenshot.accelerators, ['CommandOrControl+H']);
});

test('sheet open forces interactive and remembers user passthrough', async () => {
  const { decideSheetOpenPassthrough } = await load();
  assert.deepEqual(decideSheetOpenPassthrough(true), {
    rememberedUserPassthrough: true,
    passthroughWhileOpen: false,
  });
  assert.deepEqual(decideSheetOpenPassthrough(false), {
    rememberedUserPassthrough: false,
    passthroughWhileOpen: false,
  });
});

test('sheet close restores remembered passthrough', async () => {
  const { decideSheetClosePassthrough } = await load();
  assert.deepEqual(decideSheetClosePassthrough(true), { passthroughToRestore: true });
  assert.deepEqual(decideSheetClosePassthrough(false), { passthroughToRestore: false });
});

test('sheet visibility toggle flips open state', async () => {
  const { decideSheetVisibilityToggle } = await load();
  assert.deepEqual(decideSheetVisibilityToggle(false), { nextOpen: true });
  assert.deepEqual(decideSheetVisibilityToggle(true), { nextOpen: false });
});
