import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('trial IPC handlers stay registered but never return raw trial tokens', () => {
  const source = read('electron/ipcHandlers.ts');
  assert.match(source, /safeHandle\(['"]trial:start['"]/);
  assert.match(source, /safeHandle\(['"]trial:get-local['"]/);
  assert.match(source, /trial_disabled/);

  const preload = read('electron/preload.ts');
  const electronTypes = read('src/types/electron.d.ts');
  const combined = `${preload}\n${electronTypes}`;

  assert.doesNotMatch(combined, /startTrial:[^\n]*trial_token\?/);
  assert.doesNotMatch(combined, /getLocalTrial:[^\n]*trialToken\?/);
  assert.match(combined, /startTrial:[^\n]*hasToken\?/);
  assert.match(combined, /getLocalTrial:[^\n]*hasToken: boolean/);
});
