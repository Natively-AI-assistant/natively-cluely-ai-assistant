import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

test('main acquires the single-instance lock before native ABI recovery can rebuild or relaunch', () => {
  const lockIndex = mainSource.indexOf('app.requestSingleInstanceLock()');
  const guardIndex = mainSource.indexOf('ensureNativeModuleAbi();');
  const initIndex = mainSource.indexOf('async function initializeApp()');

  assert.ok(lockIndex >= 0, 'BUG: main.ts must request the single-instance lock during startup.');
  assert.ok(guardIndex >= 0, 'BUG: main.ts must run ensureNativeModuleAbi() during startup.');
  assert.ok(lockIndex < guardIndex, 'BUG: requestSingleInstanceLock() must run before ensureNativeModuleAbi() to prevent concurrent native rebuilds.');
  assert.ok(lockIndex < initIndex, 'BUG: requestSingleInstanceLock() must be top-level, not delayed until initializeApp().');

  const preGuardStartup = mainSource.slice(lockIndex, guardIndex);
  assert.ok(
    /if\s*\(\s*!gotSingleInstanceLock\s*\)[\s\S]*process\.exit\s*\(\s*0\s*\)/.test(preGuardStartup),
    'BUG: the lock-losing startup path must terminate synchronously before ensureNativeModuleAbi() can run.',
  );
});

test('initializeApp does not request a second single-instance lock', () => {
  const initIndex = mainSource.indexOf('async function initializeApp()');
  assert.ok(initIndex >= 0, 'could not locate initializeApp');
  const initBody = mainSource.slice(initIndex);

  assert.equal(
    (initBody.match(/requestSingleInstanceLock\s*\(/g) || []).length,
    0,
    'BUG: initializeApp should not request a second single-instance lock after the top-level startup lock.',
  );
});
