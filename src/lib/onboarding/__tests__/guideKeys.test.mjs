// First-run guide keycaps: the user's real binding, drawn for their platform.
// Run: node --test src/lib/onboarding/__tests__/guideKeys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideKeys } from '../guideKeys.mjs';
import { acceleratorToKeys } from '../shortcutKeys.mjs';

const kb = [
  { id: 'chat:whatToAnswer', accelerator: 'CommandOrControl+1' },
  { id: 'general:selective-screenshot', accelerator: 'CommandOrControl+Shift+H' },
];

test('guideKeys uses binding and platform', () => {
  assert.deepEqual(guideKeys(kb, 'chat:whatToAnswer', 'darwin'), acceleratorToKeys('CommandOrControl+1', 'darwin'));
  assert.deepEqual(guideKeys(kb, 'chat:whatToAnswer', 'win32'), acceleratorToKeys('CommandOrControl+1', 'win32'));
  assert.notDeepEqual(guideKeys(kb, 'chat:whatToAnswer', 'darwin'), guideKeys(kb, 'chat:whatToAnswer', 'win32'));
  assert.deepEqual(guideKeys(kb, 'general:selective-screenshot', 'win32'), ['Ctrl', 'Shift', 'H']);
});

test('a rebound key wins over the default', () => {
  assert.deepEqual(guideKeys([{ id: 'chat:whatToAnswer', accelerator: 'Alt+Q' }], 'chat:whatToAnswer', 'win32'), acceleratorToKeys('Alt+Q', 'win32'));
});

test('missing or empty binding falls back to the KeybindManager default', () => {
  assert.deepEqual(guideKeys([], 'general:take-screenshot', 'darwin'), acceleratorToKeys('CommandOrControl+H', 'darwin'));
  assert.deepEqual(guideKeys(null, 'chat:whatToAnswer', 'win32'), ['Ctrl', '1']);
  assert.deepEqual(guideKeys([{ id: 'general:take-screenshot', accelerator: '' }], 'general:take-screenshot', 'win32'), ['Ctrl', 'H']);
  assert.deepEqual(guideKeys([], 'unknown:id', 'darwin'), []);
});
