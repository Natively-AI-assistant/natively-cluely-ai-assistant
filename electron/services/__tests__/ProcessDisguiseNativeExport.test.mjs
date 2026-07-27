// electron/services/__tests__/ProcessDisguiseNativeExport.test.mjs
//
// #307: Activity Monitor live-rename depends on the native module exporting
// set_process_display_name / setProcessDisplayName. The Rust source existed for
// a while without being wired into lib.rs — pin that contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

describe('Process Disguise native export (#307)', () => {
  test('lib.rs includes process_name module on macOS', () => {
    const lib = fs.readFileSync(path.join(root, 'native-module/src/lib.rs'), 'utf8');
    assert.match(lib, /#\[cfg\(target_os = "macos"\)\]\s*pub mod process_name/);
  });

  test('process_name.rs exports set_process_display_name', () => {
    const src = fs.readFileSync(path.join(root, 'native-module/src/process_name.rs'), 'utf8');
    assert.match(src, /#\[napi\]\s*pub fn set_process_display_name/);
    assert.match(src, /_LSSetApplicationInformationItem/);
  });

  test('main.ts calls setProcessDisplayName from _applyDisguise', () => {
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    assert.match(main, /setProcessDisplayName/);
    assert.match(main, /#307/);
  });

  test('nativeModuleLoader types expose optional setProcessDisplayName', () => {
    const loader = fs.readFileSync(
      path.join(root, 'electron/audio/nativeModuleLoader.ts'),
      'utf8',
    );
    assert.match(loader, /setProcessDisplayName\?:/);
  });
});
