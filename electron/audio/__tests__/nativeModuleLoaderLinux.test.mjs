import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryNamePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/platform/nativeBinaryName.js',
);

async function loadNativeBinaryName() {
  return import(pathToFileURL(binaryNamePath).href);
}

describe('native binary name resolution for Linux packaging', () => {
  test('linux x64 resolves index.linux-x64-gnu.node', async () => {
    const { getNativeBinaryName } = await loadNativeBinaryName();
    assert.equal(getNativeBinaryName('linux', 'x64'), 'index.linux-x64-gnu.node');
  });

  test('linux arm64 resolves index.linux-arm64-gnu.node', async () => {
    const { getNativeBinaryName } = await loadNativeBinaryName();
    assert.equal(getNativeBinaryName('linux', 'arm64'), 'index.linux-arm64-gnu.node');
  });

  test('packaged search path includes app.asar.unpacked segment', async () => {
    const { getNativeModuleSearchPathSegments } = await loadNativeBinaryName();
    assert.deepEqual(getNativeModuleSearchPathSegments(), ['app.asar.unpacked', 'native-module']);
  });

  test('unknown platform/arch falls back to index.<platform>-<arch>.node', async () => {
    const { getNativeBinaryName } = await loadNativeBinaryName();
    assert.equal(getNativeBinaryName('freebsd', 'x64'), 'index.freebsd-x64.node');
  });
});
