import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

test('mic zero-fill detector uses peak-to-peak instead of abs-peak', () => {
  const start = main.indexOf('let zerofillLatched = false');
  assert.ok(start >= 0, 'mic zero-fill detector should exist');
  const block = main.slice(start, start + 8000);
  assert.match(block, /const\s+peakToPeak\s*=\s*maxS\s*-\s*minS/);
  assert.match(block, /peakToPeak\s*>\s*100/);
  assert.doesNotMatch(block.replace(/\/\/.*$/gm, ''), /Math\.abs\s*\(/);
});

test('system audio silence delegates ambiguous stuck state to SystemAudioHealthClassifier', () => {
  assert.match(main, /new SystemAudioHealthClassifier/);
  assert.match(main, /systemAudioHealth\.handle\(\{\s*kind:\s*'watchdog-tick'/);
  assert.match(main, /systemAudioHealth\.handle\(\{\s*kind:\s*'chunk'/);
});
