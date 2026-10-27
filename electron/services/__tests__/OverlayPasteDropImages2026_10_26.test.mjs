// Issue #351: paste / drag-drop images into the overlay attachment tray.
// Source-shape coverage — the live Electron clipboard and Finder drop paths
// are exercised manually; this pins the IPC + renderer wiring so the feature
// cannot silently regress to screenshots-only.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// The source between two anchors, so a comment or a reformat inside the block
// never moves an assertion out of range.
const between = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return src.slice(from, to);
};

describe('overlay paste/drop image attach (issue #351)', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const main = read('electron/main.ts');
  const ui = read('src/components/NativelyInterface.tsx');

  test('main exposes clipboard and local-file attach helpers', () => {
    assert.match(main, /attachClipboardImage\s*\(/);
    assert.match(main, /attachLocalImageFile\s*\(/);
    assert.match(main, /OVERLAY_PASTE_IMAGE_PREFIX/);
    assert.match(main, /OVERLAY_DROP_IMAGE_PREFIX/);
  });

  test('ipcHandlers registers both attach channels next to screenshot capture', () => {
    assert.match(ipc, /safeHandle\('attach-clipboard-image'/);
    assert.match(ipc, /safeHandle\('attach-local-image'/);
    assert.match(ipc, /attachClipboardImage\(/);
    assert.match(ipc, /attachLocalImageFile\(/);
  });

  test('preload resolves the dropped File to its path with webUtils (File.path is gone since Electron 32)', () => {
    assert.match(preload, /import \{[^}]*\bwebUtils\b[^}]*\} from 'electron'/);
    assert.match(preload, /attachClipboardImage:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('attach-clipboard-image'\)/);
    assert.match(
      preload,
      /attachLocalImage:\s*\(file:\s*File\)\s*=>\s*ipcRenderer\.invoke\('attach-local-image',\s*webUtils\.getPathForFile\(file\)\)/,
    );
    assert.doesNotMatch(between(ui, 'onDrop={', 'onPaste={'), /\.path\b/, 'File.path is undefined since Electron 32');
  });

  test('main reads a dropped file only when it is a file under the cap, and trusts its bytes over its name', () => {
    const body = between(main, 'public async attachLocalImageFile(', '\n  }\n');
    assert.match(body, /stat\.isFile\(\)/);
    assert.match(body, /stat\.size > OVERLAY_ATTACH_IMAGE_MAX_BYTES/);
    assert.ok(body.indexOf('stat.size') < body.indexOf('readFile'), 'size is checked before the file is read');
    assert.match(body, /const ext = imageExtFromBytes\(data\)/);
    assert.match(body, /addExternalImage\(data, ext,/);
  });

  test('a pasted or dropped image reaches the trays but never a phone question', () => {
    for (const method of ['public async attachClipboardImage(', 'public async attachLocalImageFile(']) {
      const body = between(main, method, '\n  }\n');
      assert.match(body, /this\.sendAttachedImage\(imagePath\)/, method);
      assert.doesNotMatch(body, /attachImageToMeeting|phoneImages/, method);
    }
    const toMeeting = between(main, 'public async attachImageToMeeting(', '\n  }\n');
    assert.match(toMeeting, /this\.sendAttachedImage\(imagePath\)/);
    assert.match(toMeeting, /this\.phoneImages\.push/);
    assert.doesNotMatch(between(main, 'private async sendAttachedImage(', '\n  }\n'), /phoneImages/);
  });

  test('the overlay paste follows overlayPasteAction and falls back to copied files', () => {
    const onPaste = between(ui, 'onPaste={', 'onKeyDown={');
    assert.match(onPaste, /const action = overlayPasteAction\(e\.clipboardData\)/);
    assert.match(onPaste, /if \(action\.kind !== 'image' \|\| !attachClipboardImage\) return;\s*e\.preventDefault\(\);/);
    assert.ok(
      onPaste.indexOf('await attachClipboardImage()') < onPaste.indexOf('action.files.map'),
      'the clipboard picture is tried before the copied files',
    );
    assert.match(onPaste, /if \(result\?\.success\) return;/, 'only a successful picture paste skips the file fallback');
    const onDrop = between(ui, 'onDrop={', 'onPaste={');
    assert.match(onDrop, /imageFilesFromDrop\(e\.dataTransfer\.files\)/);
    assert.match(onDrop, /attachLocalImage\?\.\(file\)/);
    assert.match(onDrop, /!result\.success\) console\.warn/, 'a refused drop is reported, not dropped silently');
  });

  test('stealth Ctrl+V pastes clipboard text first and tries an image only without text', () => {
    const stealthV = between(ui, "editLetter === 'v'", 'if (editLetter) {');
    const read = stealthV.indexOf('electronAPI.stealthReadClipboard');
    const image = stealthV.indexOf('electronAPI.attachClipboardImage');
    assert.ok(read >= 0 && image > read, 'stealth Ctrl+V must read clipboard text before trying an image');
    assert.match(stealthV, /if \(!pastedText\(text\) && stealthTapActiveRef\.current && !escSuppressUntilNextActive\) \{/);
  });
});
