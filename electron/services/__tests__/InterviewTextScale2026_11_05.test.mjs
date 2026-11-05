// View › Zoom In / Zoom Out / Actual Size (#673): text size in the meeting
// overlay, page zoom everywhere else, on both macOS and Windows menus.
// Platform is passed in; process.platform is never changed.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/InterviewTextScale2026_11_05.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const m = await import(pathToFileURL(path.resolve(root, 'dist-electron/electron/services/interviewTextScaleMenu.js')).href);

const fakeTarget = (isOverlay, zoomLevel = 0) => {
  const sent = [];
  return { isOverlay, sent, webContents: { zoomLevel, send: (...args) => sent.push(args) } };
};

describe('applyZoomMenuCommand', () => {
  test('in the overlay, asks for a text-size step and leaves page zoom alone', () => {
    for (const step of ['increase', 'decrease', 'reset']) {
      const t = fakeTarget(true);
      assert.equal(m.applyZoomMenuCommand(step, t), 'text-scale');
      assert.deepEqual(t.sent, [[m.INTERVIEW_TEXT_SCALE_STEP_CHANNEL, step]]);
      assert.equal(t.webContents.zoomLevel, 0);
    }
  });

  test('in any other window, zooms the page the way the old roles did', () => {
    const t = fakeTarget(false, 1);
    assert.equal(m.applyZoomMenuCommand('increase', t), 'page-zoom');
    assert.equal(t.webContents.zoomLevel, 1.5);
    m.applyZoomMenuCommand('decrease', t);
    m.applyZoomMenuCommand('decrease', t);
    assert.equal(t.webContents.zoomLevel, 0.5);
    m.applyZoomMenuCommand('reset', t);
    assert.equal(t.webContents.zoomLevel, 0);
    assert.equal(t.sent.length, 0);
  });

  test('no focused window does nothing', () => {
    assert.equal(m.applyZoomMenuCommand('increase', null), 'none');
  });
});

describe('buildZoomMenuItems', () => {
  for (const platform of ['darwin', 'win32']) {
    test(`${platform}: CommandOrControl accelerators that route through the resolver`, () => {
      const seen = [];
      const overlay = fakeTarget(true);
      const items = m.buildZoomMenuItems(platform, (win) => { seen.push(win); return overlay; });
      const visible = items.filter((i) => i.visible !== false);
      assert.deepEqual(visible.map((i) => i.accelerator), ['CommandOrControl+0', 'CommandOrControl+Plus', 'CommandOrControl+-']);
      assert.ok(items.every((i) => !i.role), 'no built-in zoom roles');
      for (const i of items) i.click({}, 'win-marker', {});
      assert.deepEqual(seen, items.map(() => 'win-marker'));
      assert.deepEqual(overlay.sent.map((s) => s[1]), items.map((_, idx) => ['reset', 'increase', 'decrease', 'increase'][idx]));
    });
  }

  test('darwin adds a hidden Cmd+= alias; win32 does not', () => {
    const mac = m.buildZoomMenuItems('darwin', () => null);
    const win = m.buildZoomMenuItems('win32', () => null);
    const alias = mac.find((i) => i.accelerator === 'CommandOrControl+=');
    assert.ok(alias && alias.visible === false && alias.acceleratorWorksWhenHidden === true);
    assert.equal(win.find((i) => i.accelerator === 'CommandOrControl+='), undefined);
    assert.equal(win.length, 3);
  });
});

test('main passes on only a number in range, rounded to the step', () => {
  assert.equal(m.sanitizeInterviewTextScale(1.24), 1.2);
  assert.equal(m.sanitizeInterviewTextScale(0), 0.8);
  assert.equal(m.sanitizeInterviewTextScale(10), 1.6);
  for (const bad of ['1.2', NaN, null, undefined, {}]) assert.equal(m.sanitizeInterviewTextScale(bad), null);
});

test('range matches the renderer, and both menus use the shared items', () => {
  const lib = fs.readFileSync(path.join(root, 'src/lib/interviewTextScale.ts'), 'utf8');
  assert.match(lib, new RegExp(`INTERVIEW_TEXT_SCALE_MIN = ${m.INTERVIEW_TEXT_SCALE_MIN};`));
  assert.match(lib, new RegExp(`INTERVIEW_TEXT_SCALE_MAX = ${m.INTERVIEW_TEXT_SCALE_MAX};`));

  const kb = fs.readFileSync(path.join(root, 'electron/services/KeybindManager.ts'), 'utf8');
  assert.doesNotMatch(kb, /role: '(zoomIn|zoomOut|resetZoom)'/);
  assert.equal((kb.match(/\.\.\.this\.zoomMenuItems\(\)/g) || []).length, 2);

  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  for (const ch of [m.INTERVIEW_TEXT_SCALE_SET_CHANNEL, m.INTERVIEW_TEXT_SCALE_CHANGED_CHANNEL, m.INTERVIEW_TEXT_SCALE_STEP_CHANNEL]) {
    assert.ok(preload.includes(`'${ch}'`), `preload uses ${ch}`);
  }
});
