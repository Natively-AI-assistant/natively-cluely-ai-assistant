// electron/services/__tests__/AttachableImageImport.test.mjs
//
// #351: paste/drop image attach — extension allowlist + IPC wiring contract.
//
// Run: ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/AttachableImageImport.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('attachable image import (#351)', () => {
  test('ScreenshotHelper exports allowlist helpers and import methods', async () => {
    const dist = path.resolve(__dirname, '../../../dist-electron/electron/ScreenshotHelper.js');
    if (fs.existsSync(dist)) {
      const mod = await import(pathToFileURL(dist).href);
      assert.equal(typeof mod.isAttachableImagePath, 'function');
      assert.ok(mod.ATTACHABLE_IMAGE_EXTENSIONS.has('.png'));
      assert.ok(mod.ATTACHABLE_IMAGE_EXTENSIONS.has('.jpeg'));
      assert.equal(mod.MAX_ATTACHABLE_IMAGE_BYTES, 25 * 1024 * 1024);
      assert.equal(mod.isAttachableImagePath('/tmp/diagram.PNG'), true);
      assert.equal(mod.isAttachableImagePath('/tmp/notes.txt'), false);
      assert.equal(mod.isAttachableImagePath('/tmp/noext'), false);
      return;
    }

    const src = fs.readFileSync(
      path.resolve(__dirname, '../../ScreenshotHelper.ts'),
      'utf8',
    );
    assert.match(src, /export const ATTACHABLE_IMAGE_EXTENSIONS/);
    assert.match(src, /export const MAX_ATTACHABLE_IMAGE_BYTES = 25 \* 1024 \* 1024/);
    assert.match(src, /export function isAttachableImagePath/);
    assert.match(src, /importImageFromClipboard/);
    assert.match(src, /importImageFromPath/);
    assert.match(src, /importImageFromPngBuffer/);
  });

  test('IPC + preload expose attach-image handlers', () => {
    const ipc = fs.readFileSync(
      path.resolve(__dirname, '../../ipcHandlers.ts'),
      'utf8',
    );
    const preload = fs.readFileSync(
      path.resolve(__dirname, '../../preload.ts'),
      'utf8',
    );
    assert.match(ipc, /safeHandle\('attach-image-from-clipboard'/);
    assert.match(ipc, /safeHandle\('attach-image-from-path'/);
    assert.match(preload, /attachImageFromClipboard:/);
    assert.match(preload, /attachImageFromPath:/);
  });
});
