import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('onboarding:get-flags IPC handler exists and maps to SettingsManager', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerBlock = sliceSafeHandleBlock(source, 'onboarding:get-flags');

  assert.ok(handlerBlock.length > 0, 'onboarding:get-flags handler should exist');
  assert.match(handlerBlock, /sm\.get\('seenStartup'\)/);
  assert.match(handlerBlock, /sm\.get\('seenProfileOnboarding'\)/);
  assert.match(handlerBlock, /sm\.get\('seenModesOnboarding'\)/);
  assert.match(handlerBlock, /sm\.get\('permsShown'\)/);
});

test('onboarding:set-flag IPC handler exists and validates keys', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerBlock = sliceSafeHandleBlock(source, 'onboarding:set-flag');

  assert.ok(handlerBlock.length > 0, 'onboarding:set-flag handler should exist');
  assert.match(handlerBlock, /seenStartup/);
  assert.match(handlerBlock, /seenProfileOnboarding/);
  assert.match(handlerBlock, /seenModesOnboarding/);
  assert.match(handlerBlock, /permsShown/);
  assert.match(handlerBlock, /SettingsManager\.getInstance\(\)\.set\(/);
});
