import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderPath = path.join(__dirname, '..', 'nativeModuleLoader.ts');
const preflightPath = path.join(__dirname, '..', '..', 'services', 'LocalFallbackPreflight.ts');

const { getNativeBinaryName } = await import(pathToFileURL(loaderPath).href);

test('Linux arm resolves to index.linux-arm-gnueabihf.node to match build artifact', () => {
  assert.equal(getNativeBinaryName('linux', 'arm'), 'index.linux-arm-gnueabihf.node');
});

test('existing Linux x64 and arm64 resolutions are preserved', () => {
  assert.equal(getNativeBinaryName('linux', 'x64'), 'index.linux-x64-gnu.node');
  assert.equal(getNativeBinaryName('linux', 'arm64'), 'index.linux-arm64-gnu.node');
});

test('LocalFallbackPreflight.ts maps linux arm to index.linux-arm-gnueabihf.node', () => {
  const src = readFileSync(preflightPath, 'utf8');
  assert.match(src, /linux:\s*\{[^}]*arm:\s*'index\.linux-arm-gnueabihf\.node'/);
});
