// The menu-bar / tray icon was a single 22 px image that showTray() shrank to
// 16 px with nativeImage.resize(): one representation, so on a Retina display
// macOS upscaled it and the icon drew blurry. Now iconTemplate.png is drawn at
// 16 px with an iconTemplate@2x.png (32 px) beside it, and the template path
// loads WITHOUT .resize() so createFromPath keeps both scale factors. Only the
// full-size fallback art (icon.png) is still resized.
//
// The helper has no platform branch (Windows loads the same file and gains the
// @2x rep at 200% scaling); these cases run identically on macOS and Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { resolveTrayIcon } = require(path.join(repoRoot, 'dist-electron/electron/utils/trayIcon.js'));

const RES = path.join(path.sep, 'res');
const APP = path.join(path.sep, 'app');

test('packaged: the shipped template loads as-is (no resize), as a template image', () => {
  const want = path.join(RES, 'assets', 'iconTemplate.png');
  const choice = resolveTrayIcon({ isPackaged: true, resourcesPath: RES, appPath: APP, exists: (p) => p === want });
  assert.deepEqual(choice, { path: want, template: true, resizeTo16: false });
});

test('dev: assets/iconTemplate.png under the app path, then the src/components copy', () => {
  const assetsTpl = path.join(APP, 'assets', 'iconTemplate.png');
  const devTpl = path.join(APP, 'src/components/iconTemplate.png');
  assert.equal(resolveTrayIcon({ isPackaged: false, resourcesPath: RES, appPath: APP, exists: (p) => p === assetsTpl || p === devTpl }).path, assetsTpl);
  const onlyDev = resolveTrayIcon({ isPackaged: false, resourcesPath: RES, appPath: APP, exists: (p) => p === devTpl });
  assert.deepEqual(onlyDev, { path: devTpl, template: true, resizeTo16: false });
});

test('no template anywhere: the full-size app icon is used and resized to 16', () => {
  assert.deepEqual(resolveTrayIcon({ isPackaged: true, resourcesPath: RES, appPath: APP, exists: () => false }),
    { path: path.join(RES, 'assets', 'icon.png'), template: false, resizeTo16: true });
  assert.deepEqual(resolveTrayIcon({ isPackaged: false, resourcesPath: RES, appPath: APP, exists: () => false }),
    { path: path.join(APP, 'src/components/icon.png'), template: false, resizeTo16: true });
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt32BE(0), 0x89504e47, `${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('every template ships at 16 px with a 32 px @2x pair (both copies)', () => {
  for (const dir of ['assets', 'src/components']) {
    assert.deepEqual(pngSize(path.join(repoRoot, dir, 'iconTemplate.png')), [16, 16], `${dir}/iconTemplate.png`);
    assert.deepEqual(pngSize(path.join(repoRoot, dir, 'iconTemplate@2x.png')), [32, 32], `${dir}/iconTemplate@2x.png`);
  }
});

test('showTray only resizes the non-template fallback', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const start = src.indexOf('public showTray(): void {');
  const body = src.slice(start, src.indexOf('public updateTrayMenu()', start));
  assert.ok(body.includes('resolveTrayIcon('), 'showTray no longer uses resolveTrayIcon');
  assert.ok(body.includes('choice.resizeTo16 ? loadedTrayIcon.resize({ width: 16, height: 16 }) : loadedTrayIcon'),
    'the template must load without .resize(), or its @2x representation is dropped');
  assert.ok(body.includes('setTemplateImage(choice.template)'));
});
