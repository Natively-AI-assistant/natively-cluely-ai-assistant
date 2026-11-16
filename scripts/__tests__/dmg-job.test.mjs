// Tests for scripts/lib/dmg-job.cjs — the early Apple Silicon DMG job that lets the
// arm64 DMG notarize while electron-builder packages the Intel app.
//
// Everything runs against injected fakes and temp dirs: no hdiutil, notarytool,
// network or macOS needed, and process.platform is never mutated (the platform
// under test is passed in), so both platform branches run on any CI host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const job = require('../lib/dmg-job.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-job-test-'));
const quiet = { log() {}, warn() {}, error() {} };

// ---------------------------------------------------------------------------
// shouldStartEarlyDmg
// ---------------------------------------------------------------------------

test('starts only for the arm64 updater zip of a darwin run with a run id', () => {
  const zip = path.join('release', 'Natively-3.2.0-arm64.zip');
  assert.equal(job.shouldStartEarlyDmg({ platform: 'darwin', file: zip, runId: 'r1' }), true);
});

test('never starts on Windows, even for an arm64-named zip', () => {
  const zip = path.join('release', 'Natively-3.2.0-arm64.zip');
  assert.equal(job.shouldStartEarlyDmg({ platform: 'win32', file: zip, runId: 'r1' }), false);
});

test('does not start for the Intel zip, a dmg, a blockmap, or without a run id', () => {
  const r = path.join('release');
  assert.equal(job.shouldStartEarlyDmg({ platform: 'darwin', file: path.join(r, 'Natively-3.2.0-x64.zip'), runId: 'r1' }), false);
  assert.equal(job.shouldStartEarlyDmg({ platform: 'darwin', file: path.join(r, 'Natively-3.2.0-arm64.dmg'), runId: 'r1' }), false);
  assert.equal(job.shouldStartEarlyDmg({ platform: 'darwin', file: path.join(r, 'Natively-3.2.0-arm64.zip.blockmap'), runId: 'r1' }), false);
  assert.equal(job.shouldStartEarlyDmg({ platform: 'darwin', file: path.join(r, 'Natively-3.2.0-arm64.zip'), runId: undefined }), false);
  assert.equal(job.shouldStartEarlyDmg({ platform: 'darwin', file: undefined, runId: 'r1' }), false);
});

// ---------------------------------------------------------------------------
// startEarlyDmgJob
// ---------------------------------------------------------------------------

const noExit = () => {};

test('start writes a running record for this run and spawns the runner detached, args as an array', () => {
  const dir = tmp();
  let spawned;
  const spawnImpl = (cmd, args, opts) => { spawned = { cmd, args, opts }; return { pid: 4242, on() {}, unref() {} }; };
  const rec = job.startEarlyDmgJob({ outDir: dir, runId: 'run-A', spawnImpl, execPath: 'node-bin', log: quiet, onExit: noExit });
  assert.deepEqual(rec, { runId: 'run-A', archDir: 'mac-arm64', pid: 4242 });
  const onDisk = job.readJob(job.jobFilePath(dir, 'mac-arm64'));
  // The parent never writes after the spawn: the runner records its own pid.
  assert.deepEqual({ status: onDisk.status, pid: onDisk.pid, runId: onDisk.runId }, { status: 'running', pid: null, runId: 'run-A' });
  assert.equal(spawned.cmd, 'node-bin');
  assert.deepEqual(spawned.args.slice(1), [dir, 'mac-arm64', '-arm64', 'run-A']);
  assert.equal(path.basename(spawned.args[0]), 'dmg-job-run.cjs');
  assert.equal(spawned.opts.shell, undefined);
  assert.equal(spawned.opts.detached, true, 'own process group, so the whole job can be stopped');
  assert.equal(spawned.opts.stdio[0], 'ignore', 'a background group must not read the terminal');
});

test('a job that finishes before start() returns keeps its result', () => {
  const dir = tmp();
  const file = job.jobFilePath(dir, 'mac-arm64');
  const spawnImpl = () => {
    job.writeJob(file, { runId: 'run-A', archDir: 'mac-arm64', status: 'failed', error: 'no credentials', pid: 7 });
    return { pid: 7, on() {}, unref() {} };
  };
  job.startEarlyDmgJob({ outDir: dir, runId: 'run-A', spawnImpl, log: quiet, onExit: noExit });
  assert.deepEqual({ status: job.readJob(file).status, error: job.readJob(file).error }, { status: 'failed', error: 'no credentials' });
});

test('a spawn without a pid throws (the hook then lets afterAllArtifactBuild build it), and spawn errors are listened for', () => {
  const dir = tmp();
  let errorListener = false;
  const spawnImpl = () => ({ pid: undefined, on(ev) { if (ev === 'error') errorListener = true; }, unref() {} });
  assert.throws(() => job.startEarlyDmgJob({ outDir: dir, runId: 'r', spawnImpl, log: quiet, onExit: noExit }), /could not start/);
  assert.equal(errorListener, true, "an async 'error' event must never crash electron-builder");
});

test('a still-alive job from an EARLIER run is stopped (whole group) before a new one starts', () => {
  const dir = tmp();
  job.writeJob(job.jobFilePath(dir, 'mac-arm64'), { runId: 'old', status: 'running', pid: 900 });
  const signals = [];
  let groupAlive = true;
  const kill = (pid, sig) => {
    signals.push([pid, sig]);
    if (pid === 900 && sig === 0) return true; // the old runner is alive
    if (pid === -900 && sig === 'SIGTERM') { groupAlive = false; return true; }
    if (pid === -900 && sig === 0) { if (groupAlive) return true; throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); }
    return true;
  };
  const spawnImpl = () => ({ pid: 901, on() {}, unref() {} });
  job.startEarlyDmgJob({ outDir: dir, runId: 'new', spawnImpl, log: quiet, kill, onExit: noExit });
  assert.ok(signals.some(([p, s]) => p === -900 && s === 'SIGTERM'), 'old job group got SIGTERM');
  assert.equal(job.readJob(job.jobFilePath(dir, 'mac-arm64')).runId, 'new');
});

test('when the build process exits with the job still running, the job group is stopped', () => {
  const dir = tmp();
  let exitHandler;
  const signals = [];
  const kill = (pid, sig) => { signals.push([pid, sig]); if (sig === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); return true; };
  job.startEarlyDmgJob({
    outDir: dir, runId: 'r', log: quiet, kill,
    spawnImpl: () => ({ pid: 555, on() {}, unref() {} }),
    onExit: (fn) => { exitHandler = fn; },
  });
  exitHandler();
  assert.deepEqual(signals[0], [-555, 'SIGTERM']);
});

test('on exit after the job finished, nothing is killed', () => {
  const dir = tmp();
  let exitHandler;
  const signals = [];
  job.startEarlyDmgJob({
    outDir: dir, runId: 'r', log: quiet, kill: (p, s) => { signals.push([p, s]); return true; },
    spawnImpl: () => ({ pid: 555, on() {}, unref() {} }),
    onExit: (fn) => { exitHandler = fn; },
  });
  job.writeJob(job.jobFilePath(dir, 'mac-arm64'), { runId: 'r', status: 'done', dmg: '/a.dmg', pid: 555 });
  exitHandler();
  assert.deepEqual(signals, []);
});

// ---------------------------------------------------------------------------
// killJobGroup
// ---------------------------------------------------------------------------

test('killJobGroup: SIGTERM to the group, SIGKILL only if it outlives the grace period', () => {
  const sent = [];
  job.killJobGroup(77, { kill: (p, s) => { sent.push([p, s]); return true; }, sleepSync() {}, graceMs: 500 });
  assert.deepEqual(sent[0], [-77, 'SIGTERM']);
  assert.deepEqual(sent[sent.length - 1], [-77, 'SIGKILL']);
  assert.ok(sent.every(([p]) => p === -77), 'always the group, never a single pid');

  const sent2 = [];
  let gone = false;
  job.killJobGroup(78, {
    kill: (p, s) => { sent2.push(s); if (s === 'SIGTERM') { gone = true; return true; } if (gone) throw new Error('ESRCH'); return true; },
    sleepSync() {}, graceMs: 500,
  });
  assert.ok(!sent2.includes('SIGKILL'), 'no SIGKILL once the group is gone');

  const sent3 = [];
  job.killJobGroup(79, { kill: (p, s) => { sent3.push(s); throw new Error('ESRCH'); }, sleepSync() {} });
  assert.deepEqual(sent3, ['SIGTERM'], 'missing group: one attempt, no error');
  assert.doesNotThrow(() => job.killJobGroup(null));
});

// ---------------------------------------------------------------------------
// waitForDmgJob
// ---------------------------------------------------------------------------

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('no job file, or no run id → null (afterAllArtifactBuild builds the DMG itself)', async () => {
  const dir = tmp();
  assert.equal(await job.waitForDmgJob({ outDir: dir, archDir: 'mac-arm64', runId: 'r1', log: quiet }), null);
  assert.equal(await job.waitForDmgJob({ outDir: dir, archDir: 'mac-arm64', runId: undefined, log: quiet }), null);
});

test('a job file from an EARLIER run is ignored, even if it says done', async () => {
  const dir = tmp();
  job.writeJob(job.jobFilePath(dir, 'mac-arm64'), { runId: 'old-run', status: 'done', dmg: '/old.dmg' });
  assert.equal(await job.waitForDmgJob({ outDir: dir, archDir: 'mac-arm64', runId: 'new-run', log: quiet }), null);
});

test('waits while running, then returns the done result', async () => {
  const states = [
    { runId: 'r', status: 'running', pid: 11 },
    { runId: 'r', status: 'running', pid: 11 },
    { runId: 'r', status: 'done', dmg: '/release/Natively-3.2.0-arm64.dmg' },
  ];
  let i = 0;
  const res = await job.waitForDmgJob({
    outDir: '/x', archDir: 'mac-arm64', runId: 'r',
    read: () => states[Math.min(i++, states.length - 1)],
    isAlive: () => true, killGroup: () => assert.fail('must not kill a job that finished'), ...fakeClock(), log: quiet,
  });
  assert.deepEqual(res, { status: 'done', dmg: '/release/Natively-3.2.0-arm64.dmg' });
});

test('returns failed with the job error', async () => {
  const res = await job.waitForDmgJob({
    outDir: '/x', archDir: 'mac-arm64', runId: 'r',
    read: () => ({ runId: 'r', status: 'failed', error: 'notarization Invalid' }), log: quiet,
  });
  assert.deepEqual(res, { status: 'failed', error: 'notarization Invalid' });
});

test('a dead runner with no result: its leftover group is stopped BEFORE failed is returned', async () => {
  const killed = [];
  const res = await job.waitForDmgJob({
    outDir: '/x', archDir: 'mac-arm64', runId: 'r',
    read: () => ({ runId: 'r', status: 'running', pid: 99 }),
    isAlive: () => false, killGroup: (pid) => killed.push(pid), ...fakeClock(), log: quiet,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.error, /exited without a result/);
  assert.deepEqual(killed, [99]);
});

test('a job that finished just as its process exited is still reported done', async () => {
  let reads = 0;
  const res = await job.waitForDmgJob({
    outDir: '/x', archDir: 'mac-arm64', runId: 'r',
    read: () => (reads++ === 0 ? { runId: 'r', status: 'running', pid: 5 } : { runId: 'r', status: 'done', dmg: '/a.dmg' }),
    isAlive: () => false, killGroup: () => assert.fail('no kill'), ...fakeClock(), log: quiet,
  });
  assert.deepEqual(res, { status: 'done', dmg: '/a.dmg' });
});

test('timeout: the still-running job is stopped BEFORE failed is returned (no two writers on one DMG)', async () => {
  const killed = [];
  const res = await job.waitForDmgJob({
    outDir: '/x', archDir: 'mac-arm64', runId: 'r',
    read: () => ({ runId: 'r', status: 'running', pid: 5 }),
    isAlive: () => true, killGroup: (pid) => killed.push(pid),
    timeoutMs: 60_000, pollMs: 10_000, ...fakeClock(), log: quiet,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.error, /still running after .* \(stopped\)/);
  assert.deepEqual(killed, [5]);
});

test('runner not started yet (pid null): waits during the grace period, then reports failed', async () => {
  const clock = fakeClock();
  const startedAt = new Date(clock.now()).toISOString();
  let reads = 0;
  const res = await job.waitForDmgJob({
    outDir: '/x', archDir: 'mac-arm64', runId: 'r',
    read: () => { reads++; return { runId: 'r', status: 'running', pid: null, startedAt }; },
    isAlive: () => assert.fail('no pid to check'), startupGraceMs: 30_000, pollMs: 10_000, ...clock, log: quiet,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.error, /never started/);
  assert.ok(reads >= 3, 'it waited before giving up');
});

// ---------------------------------------------------------------------------
// earlyDmgDecision + finishJob
// ---------------------------------------------------------------------------

test('use the early DMG only when it is done AND on disk; otherwise build inline', () => {
  const exists = (p) => p === '/release/a-arm64.dmg';
  assert.equal(job.earlyDmgDecision({ status: 'done', dmg: '/release/a-arm64.dmg' }, exists), 'use');
  assert.equal(job.earlyDmgDecision({ status: 'done', dmg: '/release/gone.dmg' }, exists), 'build');
  assert.equal(job.earlyDmgDecision({ status: 'done' }, exists), 'build');
  assert.equal(job.earlyDmgDecision({ status: 'failed', error: 'x' }, exists), 'build');
  assert.equal(job.earlyDmgDecision(null, exists), 'build');
});

test('finishJob writes this run\'s result but never overwrites a NEWER run\'s record', () => {
  const dir = tmp();
  const file = job.jobFilePath(dir, 'mac-arm64');
  job.writeJob(file, { runId: 'r1', archDir: 'mac-arm64', status: 'running', pid: 3, startedAt: 's' });
  assert.equal(job.finishJob(file, 'r1', { status: 'done', dmg: '/a.dmg' }, { pid: 3 }), true);
  const rec = job.readJob(file);
  assert.deepEqual({ runId: rec.runId, status: rec.status, dmg: rec.dmg, startedAt: rec.startedAt }, { runId: 'r1', status: 'done', dmg: '/a.dmg', startedAt: 's' });

  job.writeJob(file, { runId: 'r2', status: 'running', pid: 4 });
  assert.equal(job.finishJob(file, 'r1', { status: 'failed', error: 'late' }), false);
  assert.equal(job.readJob(file).runId, 'r2');
  assert.equal(job.readJob(file).status, 'running');
});

// ---------------------------------------------------------------------------
// Stale DMG guard
// ---------------------------------------------------------------------------

test('a DMG older than the signed app is stale; same age or newer is fresh', () => {
  assert.equal(job.dmgIsNewerThanApp(1000, 2000), false);
  assert.equal(job.dmgIsNewerThanApp(2000, 2000), true);
  assert.equal(job.dmgIsNewerThanApp(3000, 2000), true);
  // Unknown app time → never reuse.
  assert.equal(job.dmgIsNewerThanApp(3000, NaN), false);
});

test('app signed time comes from the code signature, falling back to Info.plist', () => {
  const dir = tmp();
  const app = path.join(dir, 'Natively.app');
  fs.mkdirSync(path.join(app, 'Contents', '_CodeSignature'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), 'p');
  const plistTime = fs.statSync(path.join(app, 'Contents', 'Info.plist')).mtimeMs;
  assert.equal(job.appSignedMtimeMs(app), plistTime);
  fs.writeFileSync(path.join(app, 'Contents', '_CodeSignature', 'CodeResources'), 'c');
  const sigTime = fs.statSync(path.join(app, 'Contents', '_CodeSignature', 'CodeResources')).mtimeMs;
  assert.equal(job.appSignedMtimeMs(app), sigTime);
  assert.ok(Number.isNaN(job.appSignedMtimeMs(path.join(dir, 'missing.app'))));
});
