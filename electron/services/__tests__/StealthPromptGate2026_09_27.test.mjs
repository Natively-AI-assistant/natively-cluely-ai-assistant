// Native prompts are their own OS windows, outside the content protection
// Undetectable mode relies on, so they show up in screen shares. The two
// main-side consent prompts (extension install, LAN bind) are refused while
// the mode is on rather than moved into the renderer, and calendar reminders
// are skipped. See electron/services/stealthPromptGate.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readPersistedUndetectable,
  savedUndetectableOn,
  UNDETECTABLE_REFUSAL_ERROR,
  UNDETECTABLE_REFUSAL_MESSAGES,
  declineWhileUndetectable,
  nativePromptsBlocked,
} from '../stealthPromptGate.ts';

test('prompts are blocked only while Undetectable is on', () => {
  assert.equal(nativePromptsBlocked(() => true), true);
  assert.equal(nativePromptsBlocked(() => false), false);
});

test('a state check that throws fails closed', () => {
  assert.equal(nativePromptsBlocked(() => { throw new Error('app state not ready'); }), true);
});

test('Undetectable on: the prompt never opens and the answer is no', async () => {
  let shown = 0;
  const declined = [];
  const confirm = declineWhileUndetectable(() => true, async () => { shown++; return true; }, (p) => declined.push(p));
  assert.equal(await confirm({ name: 'Some Extension' }), false);
  assert.equal(shown, 0);
  assert.deepEqual(declined, [{ name: 'Some Extension' }]);
});

test('Undetectable off: the native prompt runs and its answer stands', async () => {
  let shown = 0;
  const yes = declineWhileUndetectable(() => false, async () => { shown++; return true; });
  const no = declineWhileUndetectable(() => false, async () => { shown++; return false; });
  assert.equal(await yes({}), true);
  assert.equal(await no({}), false);
  assert.equal(shown, 2);
});

test('the mode is read when the prompt would open, not when it was wrapped', async () => {
  let on = false;
  let shown = 0;
  const confirm = declineWhileUndetectable(() => on, async () => { shown++; return true; });
  on = true;
  assert.equal(await confirm({}), false);
  on = false;
  assert.equal(await confirm({}), true);
  assert.equal(shown, 1);
});

test('with no state source (tests, older callers) the prompt always shows', async () => {
  const confirm = declineWhileUndetectable(undefined, async () => true);
  assert.equal(await confirm({}), true);
});

test('refusals tell the user what to do', () => {
  assert.equal(UNDETECTABLE_REFUSAL_ERROR, 'undetectable_on');
  assert.match(UNDETECTABLE_REFUSAL_MESSAGES.extensionInstall, /^Turn off Undetectable to install extensions/);
  assert.match(UNDETECTABLE_REFUSAL_MESSAGES.lanAccess, /^Turn off Undetectable to allow LAN access/);
});

test('the saved flag is read without SettingsManager (native-arch gate runs first)', () => {
  assert.equal(readPersistedUndetectable(() => '{"isUndetectable":true}'), true);
  assert.equal(readPersistedUndetectable(() => '{"isUndetectable":false}'), false);
  assert.equal(readPersistedUndetectable(() => '{}'), false);
  assert.equal(readPersistedUndetectable(() => 'not json'), null);
  assert.equal(readPersistedUndetectable(() => { throw new Error('ENOENT'); }), null);
});

test('error boxes are skipped only when settings.json says Undetectable is on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively gate test '));
  try {
    assert.equal(savedUndetectableOn(dir), false, 'no settings file: show the box');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"isUndetectable":true}');
    assert.equal(savedUndetectableOn(dir), true);
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"isUndetectable":tru');
    assert.equal(savedUndetectableOn(dir), false, 'corrupt settings: show the box');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
