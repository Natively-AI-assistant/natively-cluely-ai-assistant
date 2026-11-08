// When the native audio module fails to load, the mic and system audio are both
// gone; the dlopen reason ("Symbol not found", "The specified module could not
// be found") is the only clue in a user's log. nativeModuleLoader.ts now always
// logs it, one line per candidate path, with the home directory shown as ~.
//
// Run: ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/NativeModuleLoadFailureLog2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderPath = path.join(__dirname, '..', 'nativeModuleLoader.ts');
const { describeLoadFailure } = await import(pathToFileURL(loaderPath).href);

test('macOS: keeps dlopen reason, drops the Require stack, redacts the home directory', () => {
  const line = describeLoadFailure(
    '/Users/jane/Applications/Natively.app/Contents/Resources/app.asar.unpacked/native-module/index.darwin-arm64.node',
    "dlopen(/Users/jane/Applications/Natively.app/x.node, 0x0001): Symbol not found: _AudioHardwareCreateProcessTap\n" +
      'Require stack:\n- /Users/jane/Applications/Natively.app/Contents/Resources/app.asar/dist-electron/main.js',
    '/Users/jane',
  );
  assert.equal(line.includes('\n'), false);
  assert.equal(line.includes('jane'), false);
  assert.match(line, /^~\/Applications\/Natively\.app\/.*index\.darwin-arm64\.node: dlopen\(~\/Applications/);
  assert.match(line, /Symbol not found: _AudioHardwareCreateProcessTap$/);
});

test('Windows: keeps the module-not-found reason with a backslash home directory', () => {
  const line = describeLoadFailure(
    'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Natively\\resources\\app.asar.unpacked\\native-module\\index.win32-x64-msvc.node',
    '\\\\?\\C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Natively\\x.node is not a valid Win32 application.\r\nRequire stack:\r\n- C:\\x',
    'C:\\Users\\Jane Doe',
  );
  assert.equal(line.includes('Jane'), false);
  assert.equal(line.includes('Require stack'), false);
  assert.match(line, /^~\\AppData\\Local\\Programs\\Natively\\.*index\.win32-x64-msvc\.node: /);
  assert.match(line, /is not a valid Win32 application\.$/);
});

test('the failure log is not gated on verboseLogging and names the OS', () => {
  const src = readFileSync(loaderPath, 'utf8');
  const tail = src.slice(src.indexOf('const failures: string[] = [];'));
  assert.match(tail, /failures\.push\(describeLoadFailure\(filePath, msg\)\)/);
  const finalLog = tail.slice(tail.indexOf('// Every reason, always'));
  assert.match(finalLog, /process\.platform/);
  assert.match(finalLog, /failures\.join/);
  assert.equal(/if \(verboseLogging\)/.test(finalLog.split('cached = null')[0]), false);
});
