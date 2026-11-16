'use strict';
/**
 * Early Apple Silicon DMG job (macOS signed builds only).
 *
 * electron-builder builds one arch at a time: pack → sign → notarize (afterSign)
 * → zip. The styled DMGs used to be built, notarized and stapled one after the
 * other at the very end (scripts/afterAllArtifactBuild.cjs), ~9 minutes each.
 *
 * With arm64 built FIRST (electron-builder.signed.cjs lists it first), its DMG can
 * be made the moment its zip exists, while electron-builder moves on to x64. This
 * module starts that work as a background process (scripts/dmg-job-run.cjs) and
 * lets afterAllArtifactBuild collect the result.
 *
 * LIFETIME: the job lives and dies with the electron-builder process that started
 * it. It runs as its own process group (detached) so the whole group — the node
 * runner plus its create-dmg / hdiutil / notarytool / stapler children — can be
 * stopped at once, and the runner exits (killing its group) as soon as its parent
 * is gone: Ctrl-C, a failed build, SIGTERM or SIGKILL. A job never outlives its
 * build, so it can never write into the next build's release/ folder.
 *
 * The job reports through a status file in the output dir. Every record carries
 * the run id that scripts/package-app.js sets (NATIVELY_PACKAGE_RUN_ID), so a
 * status file left behind by an earlier build is never read as this build's
 * result. No run id (electron-builder invoked directly, e.g. CI) → no early job,
 * and afterAllArtifactBuild builds every DMG itself exactly as before.
 */
const fs = require('fs');
const path = require('path');

const RUN_ID_ENV = 'NATIVELY_PACKAGE_RUN_ID';
const EARLY_ARCH = Object.freeze({ archDir: 'mac-arm64', suffix: '-arm64' });

function jobFilePath(outDir, archDir) {
  return path.join(outDir, `.dmg-job-${archDir}.json`);
}

/** Atomic write (tmp + rename) so a reader never sees half a record. */
function writeJob(file, record, fsImpl = fs) {
  const tmp = `${file}.tmp-${process.pid}`;
  fsImpl.writeFileSync(tmp, JSON.stringify(record));
  fsImpl.renameSync(tmp, file);
}

function readJob(file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Is this single pid alive? (EPERM = exists, just not ours.) */
function isPidAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return !!e && e.code === 'EPERM';
  }
}

/**
 * Stop a job's whole process group (the runner is the group leader, so its group
 * id is its pid). SIGTERM, then SIGKILL for anything that ignores it. Safe to call
 * on a group that is already gone. `kill`/`sleepSync` are injectable for tests.
 */
function killJobGroup(pid, { kill = process.kill, sleepSync = defaultSleepSync, graceMs = 3000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const send = (sig) => { try { kill(-pid, sig); return true; } catch { return false; } };
  if (!send('SIGTERM')) return; // no such group
  for (let waited = 0; waited < graceMs; waited += 250) {
    sleepSync(250);
    if (!send(0)) return; // group gone
  }
  send('SIGKILL');
}

function defaultSleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Should this electron-builder artifact start the early DMG job?
 * Only the arm64 updater zip of a darwin build that package-app gave a run id.
 */
function shouldStartEarlyDmg({ platform, file, runId }) {
  if (platform !== 'darwin' || !runId || typeof file !== 'string') return false;
  return /-arm64\.zip$/.test(path.basename(file));
}

/**
 * Spawn scripts/dmg-job-run.cjs for the arm64 DMG. The parent writes ONLY the
 * initial 'running' record (before the spawn); from then on the job is the sole
 * writer of its record, so its result can never be overwritten by the parent.
 * Throws if the job could not be started; the caller treats that as "no early
 * job" and afterAllArtifactBuild builds the DMG itself.
 */
function startEarlyDmgJob({
  outDir,
  runId,
  spawnImpl,
  fsImpl = fs,
  execPath = process.execPath,
  log = console,
  kill = process.kill,
  onExit = (fn) => process.once('exit', fn),
}) {
  const spawn = spawnImpl || require('child_process').spawn;
  const { archDir, suffix } = EARLY_ARCH;
  const file = jobFilePath(outDir, archDir);

  // A job from an earlier, killed run that is somehow still alive must not keep
  // writing into this build's release/ folder.
  const previous = readJob(file, fsImpl);
  if (previous && previous.runId !== runId && previous.status === 'running' && isPidAlive(previous.pid, kill)) {
    log.warn(`[dmg-job] stopping a DMG job left over from an earlier build (pid ${previous.pid}).`);
    killJobGroup(previous.pid, { kill });
  }

  writeJob(file, { runId, archDir, status: 'running', pid: null, startedAt: new Date().toISOString() }, fsImpl);

  const runner = path.join(__dirname, '..', 'dmg-job-run.cjs');
  // detached: own process group, so killJobGroup stops the runner AND its
  // create-dmg / notarytool children together. stdin ignored (a background group
  // must never read the terminal); stdout/stderr go to the build's terminal.
  const child = spawn(execPath, [runner, outDir, archDir, suffix, runId], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
    detached: true,
  });
  if (child && typeof child.on === 'function') {
    child.on('error', (err) => {
      log.warn(`[dmg-job] background DMG process error: ${err && err.message}`);
    });
  }
  if (!child || !Number.isInteger(child.pid)) {
    throw new Error('could not start the background DMG process');
  }
  // Fast path for a normal or failed exit of this (electron-builder) process: stop
  // the job's group. Ctrl-C / SIGKILL skip 'exit' handlers; the runner's own
  // parent watchdog covers those.
  onExit(() => {
    const now = readJob(file, fsImpl);
    if (now && now.runId === runId && now.status === 'running') killJobGroup(child.pid, { kill, graceMs: 2000 });
  });
  if (typeof child.unref === 'function') child.unref();
  log.log(`[dmg-job] Apple Silicon DMG started in the background (pid ${child.pid}) while Intel builds.`);
  return { runId, archDir, pid: child.pid };
}

/**
 * Wait for this run's job on `archDir`.
 *   → null                      no job for THIS run (absent, or another run's file)
 *   → { status: 'done', dmg }   finished, notarized, stapled, verified
 *   → { status: 'failed', error }
 *
 * Never returns while the job is still alive: on timeout, or when the runner died
 * leaving children behind, the whole job group is stopped FIRST, so the caller can
 * safely build the same DMG itself without two writers on one file.
 */
async function waitForDmgJob({
  outDir,
  archDir,
  runId,
  read = (f) => readJob(f),
  isAlive = (pid) => isPidAlive(pid),
  killGroup = (pid) => killJobGroup(pid),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = 10_000,
  timeoutMs = 75 * 60 * 1000,
  startupGraceMs = 60_000,
  log = console,
  now = () => Date.now(),
}) {
  if (!runId) return null;
  const file = jobFilePath(outDir, archDir);
  const started = now();
  let lastLog = started;
  for (;;) {
    const job = read(file);
    if (!job || job.runId !== runId) return null;
    if (job.status === 'done') return { status: 'done', dmg: job.dmg };
    if (job.status === 'failed') return { status: 'failed', error: job.error || 'unknown error' };

    if (job.pid == null) {
      // The runner records its own pid when it starts; give it a moment.
      const age = now() - Date.parse(job.startedAt || 0);
      if (!(age < startupGraceMs)) return { status: 'failed', error: 'background DMG process never started' };
    } else if (!isAlive(job.pid)) {
      // Runner gone. It may have written its result just now; otherwise stop any
      // children it left behind before reporting, so nothing still writes the DMG.
      const again = read(file);
      if (again && again.runId === runId && again.status === 'done') return { status: 'done', dmg: again.dmg };
      if (again && again.runId === runId && again.status === 'failed') return { status: 'failed', error: again.error || 'unknown error' };
      killGroup(job.pid);
      return { status: 'failed', error: `background DMG process ${job.pid} exited without a result` };
    }

    if (now() - started > timeoutMs) {
      if (job.pid != null) killGroup(job.pid);
      return { status: 'failed', error: `background DMG job still running after ${Math.round(timeoutMs / 60000)} min (stopped)` };
    }
    if (now() - lastLog >= 60_000) {
      log.log(`[dmg-job] waiting for the Apple Silicon DMG (pid ${job.pid})…`);
      lastLog = now();
    }
    await sleep(pollMs);
  }
}

/**
 * What afterAllArtifactBuild does with the early job's result:
 *   'use'   — the job's DMG is done and on disk
 *   'build' — no job, it failed, or its DMG is missing: build the DMG inline
 */
function earlyDmgDecision(early, exists = (p) => fs.existsSync(p)) {
  if (early && early.status === 'done' && early.dmg && exists(early.dmg)) return 'use';
  return 'build';
}

/**
 * The job's final write. Refuses to touch a record that belongs to a NEWER run
 * (a later build already started its own job on the same file).
 */
function finishJob(file, runId, fields, { fsImpl = fs, pid = process.pid } = {}) {
  const current = readJob(file, fsImpl);
  if (current && current.runId !== runId) return false;
  writeJob(file, {
    runId,
    archDir: current && current.archDir,
    pid,
    startedAt: current && current.startedAt,
    finishedAt: new Date().toISOString(),
    ...fields,
  }, fsImpl);
  return true;
}

/**
 * Is an existing DMG at least as new as the signed app it should contain?
 * A DMG older than the app is from an EARLIER build and must be rebuilt, even if
 * it is stapled and valid: reusing it would ship a stale app next to fresh zips.
 */
function dmgIsNewerThanApp(dmgMtimeMs, appSignedMtimeMs) {
  return Number.isFinite(dmgMtimeMs) && Number.isFinite(appSignedMtimeMs) && dmgMtimeMs >= appSignedMtimeMs;
}

/** mtime of the app's code signature (written when electron-builder signs it). */
function appSignedMtimeMs(appPath, fsImpl = fs) {
  for (const rel of [['Contents', '_CodeSignature', 'CodeResources'], ['Contents', 'Info.plist']]) {
    try {
      return fsImpl.statSync(path.join(appPath, ...rel)).mtimeMs;
    } catch { /* try the next */ }
  }
  return NaN;
}

module.exports = {
  RUN_ID_ENV,
  EARLY_ARCH,
  jobFilePath,
  writeJob,
  readJob,
  isPidAlive,
  killJobGroup,
  shouldStartEarlyDmg,
  startEarlyDmgJob,
  waitForDmgJob,
  earlyDmgDecision,
  finishJob,
  dmgIsNewerThanApp,
  appSignedMtimeMs,
};
