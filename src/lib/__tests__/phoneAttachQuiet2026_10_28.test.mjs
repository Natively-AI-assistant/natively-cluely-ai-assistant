// Tapping Screenshot (or sending a photo) on the phone popped the overlay up
// on the desktop: every `screenshot-attached` made the overlay expand, which
// shows its window. The phone is the screen in use, so its images now arrive
// `quiet`: they join the tray (which the phone shows) and the overlay stays as
// it was. A capture taken on the desktop still shows the overlay, as before.
//
// The decision is executed here; the main → renderer wiring is React state and
// an AppState method, so it is pinned by its call sites. Platform-agnostic:
// no platform branch is involved, the same path runs on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { revealsOverlay, addAttachment } from '../attachmentTray.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing: ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `missing end after: ${start}`);
  return src.slice(i, j);
};

describe('revealsOverlay', () => {
  test('a desktop capture shows the overlay; a phone one does not', () => {
    assert.equal(revealsOverlay({}), true);
    assert.equal(revealsOverlay({ quiet: false }), true);
    assert.equal(revealsOverlay({ quiet: undefined }), true);
    assert.equal(revealsOverlay({ quiet: true }), false);
  });

  test('a quiet image still joins the tray', () => {
    const tray = addAttachment([], { path: '/s/phone-1.jpg', preview: '' });
    assert.deepEqual(tray.map((s) => s.path), ['/s/phone-1.jpg']);
  });
});

describe('wiring', () => {
  const main = read('electron/main.ts');

  test('the phone path (attachImageToMeeting) sends its images quiet', () => {
    const body = between(main, 'public async attachImageToMeeting(', '\n  }\n');
    assert.match(body, /sendAttachedImage\(imagePath, \{ quiet: true \}\)/);
  });

  test('only the phone uses attachImageToMeeting: its screenshot command and its photos', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const phoneShot = between(ipc, "} else if (cmd.type === 'screenshot') {", "} else if (cmd.type === 'detach') {");
    assert.match(phoneShot, /appState\.attachImageToMeeting\(capturedPath\)/);
    const photo = between(main, 'public async receivePhoneImage(', '\n  }\n');
    assert.match(photo, /this\.attachImageToMeeting\(imagePath\)/);
    const callers = [...ipc.matchAll(/attachImageToMeeting\(/g)].length
      + [...main.matchAll(/attachImageToMeeting\(/g)].length;
    // The declaration, receivePhoneImage, and the phone screenshot command.
    assert.equal(callers, 3);
  });

  test('desktop pastes and drops stay loud', () => {
    for (const fn of ['public async attachClipboardImage(', 'public async attachLocalImageFile(']) {
      const body = between(main, fn, '\n  }\n');
      assert.match(body, /sendAttachedImage\(imagePath\)/);
    }
  });

  test('sendAttachedImage adds quiet to the payload only when asked', () => {
    const body = between(main, 'private async sendAttachedImage(', '\n  }\n');
    assert.match(body, /opts\.quiet \? \{ path: imagePath, preview, quiet: true \} : \{ path: imagePath, preview \}/);
  });

  test('the overlay expands only when revealsOverlay says so, and keeps quiet out of the tray', () => {
    const ui = read('src/components/NativelyInterface.tsx');
    const handler = between(ui, 'const handleScreenshotAttach = (', '\n  };\n');
    assert.match(handler, /const \{ quiet, \.\.\.item \} = data;/);
    assert.match(handler, /if \(revealsOverlay\(\{ quiet \}\)\) setIsExpanded\(true\);/);
    assert.match(handler, /addAttachment\(prev, item\)/);
    assert.doesNotMatch(handler, /^\s*setIsExpanded\(true\);/m);
  });
});
