// The toolbar icon follows Chrome's theme: black mark on light, white on dark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const modPath = path.resolve(root, 'dist-test/toolbar-icon.js');
const { toolbarIconFor, openThemeWatch, LIGHT_TOOLBAR_ICON, DARK_TOOLBAR_ICON, THEME_WATCH_PAGE } =
  await import(pathToFileURL(modPath).href);
const manifest = JSON.parse(fs.readFileSync(path.resolve(root, 'src/manifest.json'), 'utf8'));

test('light Chrome gets the black mark, dark Chrome the white one', () => {
  assert.equal(toolbarIconFor(false), LIGHT_TOOLBAR_ICON);
  assert.equal(toolbarIconFor(true), DARK_TOOLBAR_ICON);
  assert.match(LIGHT_TOOLBAR_ICON[16], /toolbar-light/);
  assert.match(DARK_TOOLBAR_ICON[16], /toolbar-dark/);
});

test('every toolbar icon file exists', () => {
  for (const icon of [LIGHT_TOOLBAR_ICON, DARK_TOOLBAR_ICON]) {
    for (const file of Object.values(icon)) assert.ok(fs.existsSync(path.resolve(root, file)), file);
  }
});

test('the manifest starts on the light icon and keeps the glass icon for the store', () => {
  assert.deepEqual(manifest.action.default_icon, LIGHT_TOOLBAR_ICON);
  assert.equal(manifest.icons['128'], 'icons/icon_128x128.png');
});

test('the theme page is declared: offscreen permission and the page itself', () => {
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(fs.existsSync(path.resolve(root, 'src', THEME_WATCH_PAGE)));
});

test('opens the theme page with the matchMedia reason', async () => {
  const calls = [];
  const ok = await openThemeWatch({ createDocument: async (p) => { calls.push(p); } });
  assert.equal(ok, true);
  assert.equal(calls[0].url, THEME_WATCH_PAGE);
  assert.deepEqual(calls[0].reasons, ['MATCH_MEDIA']);
});

test('a page already open, or no offscreen API, is not an error', async () => {
  const refused = await openThemeWatch({ createDocument: async () => { throw new Error('Only a single offscreen document may be created.'); } });
  assert.equal(refused, false);
  assert.equal(await openThemeWatch(undefined), false);
});
