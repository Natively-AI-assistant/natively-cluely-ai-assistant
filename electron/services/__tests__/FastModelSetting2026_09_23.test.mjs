// The Fast Model setting's storage contract.
//
// Two things must hold, and both have bitten this repo before:
//  - unset MUST resolve to null, not to a default model id. A default here would
//    silently override the measured judge ladder for every user who never opened
//    the picker.
//  - the setter MUST return the persistence boolean. A void setter is how a
//    refused write gets reported as success and the setting vanishes on restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('getFastModel returns null when unset — unset must mean "behave as today"', () => {
  const src = read('electron/services/CredentialsManager.ts');
  const m = src.match(/public getFastModel\(\)[\s\S]{0,300}?\n    \}/);
  assert.ok(m, 'getFastModel must exist');
  assert.match(m[0], /\|\|\s*null/, 'must fall back to null, never to a default model id');
  assert.doesNotMatch(m[0], /'gemini|'gpt-|'deepseek/, 'must not hardcode a default fast model');
});

test('setFastModel returns the persistence boolean, like setSttProvider', () => {
  const src = read('electron/services/CredentialsManager.ts');
  const m = src.match(/public setFastModel\([\s\S]{0,400}?\n    \}/);
  assert.ok(m, 'setFastModel must exist');
  assert.match(m[0], /\)\s*:\s*boolean/, 'must be typed boolean — void hides a refused write');
  assert.match(m[0], /refuseWriteWhileDegraded/, 'must refuse while the store is degraded');
  assert.match(m[0], /const persisted = this\.saveCredentials\(\)/);
  assert.match(m[0], /return persisted/);
});

test('the set-fast-model IPC handler reports a refused write instead of success', () => {
  const src = read('electron/ipcHandlers.ts');
  const i = src.indexOf("safeHandle('set-fast-model'");
  assert.ok(i > -1, 'set-fast-model handler must exist');
  const body = src.slice(i, i + 600);
  assert.match(body, /if \(!.*setFastModel\(/, 'the boolean must control the response');
  assert.match(body, /success: false/, 'a refused write must return success:false');
});
