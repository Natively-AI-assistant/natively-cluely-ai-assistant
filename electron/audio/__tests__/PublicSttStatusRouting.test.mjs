import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

test('public build does not retain NativelyProSTT-specific status wiring', () => {
  assert.doesNotMatch(mainSource, /\bNativelyProSTT\b/);
  assert.match(mainSource, /state:\s*'awaiting-audio'/);
  assert.match(mainSource, /state:\s*'connected'/);
  assert.match(mainSource, /state:\s*'reconnecting'/);
});
