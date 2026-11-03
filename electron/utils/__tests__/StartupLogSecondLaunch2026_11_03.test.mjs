/**
 * A second launch must not wipe the running app's debug log (2026-11-03).
 *
 * User export (Windows 3.0.0) sent to show transcription reconnecting after
 * 10-15 s held 10 lines: "log opened (prior=truncated) … Another instance is
 * already running. Exiting this instance." The second process's first write —
 * its single-instance-lock report — reset the shared natively_debug.log before
 * it exited. Shared code on macOS and Windows; the policy is pure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const { startupLogAction, startupLogMarker } = await import(
  pathToFileURL(path.join(repo, 'dist-electron/electron/utils/startupLogPolicy.js')).href
);
const mainTs = readFileSync(path.join(repo, 'electron/main.ts'), 'utf8');

test('a process that lost the single-instance lock only appends, and never asks about the prior session', () => {
  let asked = 0;
  const clean = () => { asked++; return true; };
  assert.equal(startupLogAction('lost', clean), 'append');
  assert.equal(asked, 0, 'LifecycleTracker belongs to the running app');
});

test('the app itself keeps the old reset: truncate after a clean session, rotate after a crash', () => {
  assert.equal(startupLogAction('held', () => true), 'truncate');
  assert.equal(startupLogAction('held', () => false), 'rotate');
});

test('the marker says what happened to the prior log', () => {
  const facts = { isoTime: '2026-11-03T09:21:37.116Z', pid: 12996, version: '3.0.0', platform: 'win32', arch: 'x64' };
  assert.equal(startupLogMarker('truncate', facts),
    '2026-11-03T09:21:37.116Z [STARTUP] log opened (prior=truncated) pid=12996 version=3.0.0 platform=win32 arch=x64\n');
  assert.match(startupLogMarker('rotate', facts), /\(prior=rotated-to-prev\)/);
  assert.match(startupLogMarker('append', facts), /\(second launch, running session log kept\) pid=12996/);
});

test('main records the lock before its first log write, and the reset waits for it', () => {
  const request = mainTs.indexOf('const gotSingleInstanceLock = agentUserData ? true : app.requestSingleInstanceLock();');
  const record = mainTs.indexOf("_startupLogLock = gotSingleInstanceLock ? 'held' : 'lost';", request);
  const report = mainTs.indexOf("logStartupPhase('single-instance-lock'", request);
  assert.ok(request > 0 && record > request && report > record, 'the lock must be recorded before it is logged');
  const reset = mainTs.indexOf('function resetStartupLog(): void {');
  const body = mainTs.slice(reset, mainTs.indexOf('\nfunction logToFile', reset));
  assert.match(body, /if \(_startupLogLock === 'unknown'\) return;/, 'no reset before the lock is known');
  assert.match(body, /startupLogAction\(_startupLogLock, shouldTruncatePriorLog\)/);
  assert.match(body, /if \(action !== 'append' && fs\.existsSync\(logFile\)\)/, 'append must not truncate or rotate');
});
