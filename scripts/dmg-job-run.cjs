#!/usr/bin/env node
'use strict';
/**
 * Background job: build, notarize, staple and verify ONE arch's styled DMG.
 *
 *   node scripts/dmg-job-run.cjs <outDir> <archDir> <suffix> <runId>
 *
 * Started by scripts/lib/dmg-job.cjs (startEarlyDmgJob) from electron-builder's
 * artifactBuildCompleted hook as soon as the arm64 updater zip exists, so the
 * Apple Silicon DMG is notarized while electron-builder packages the Intel app.
 * afterAllArtifactBuild reads the result from the job file.
 *
 * It is its own process-group leader (spawned detached). A watchdog stops the
 * whole group the moment the electron-builder process that started it is gone, so
 * a cancelled or failed build never leaves a DMG job running behind it.
 *
 * macOS only; it is never started anywhere else.
 */
const path = require('path');
const { jobFilePath, readJob, writeJob, finishJob, isPidAlive } = require('./lib/dmg-job.cjs');

const [outDir, archDir, suffix = '', runId] = process.argv.slice(2);
if (!outDir || !archDir || !runId) {
  console.error('[dmg-job] usage: dmg-job-run.cjs <outDir> <archDir> <suffix> <runId>');
  process.exit(2);
}
const file = jobFilePath(outDir, archDir);

// Record our pid (the parent wrote 'running' with pid null before spawning us).
{
  const current = readJob(file);
  if (!current || current.runId !== runId) {
    console.error('[dmg-job] job record belongs to another build; not starting.');
    process.exit(1);
  }
  writeJob(file, { ...current, pid: process.pid });
}

// Leave nothing behind: on every exit, stop the rest of this process group
// (create-dmg / hdiutil / notarytool / stapler children) after writing the result.
let exiting = false;
function finishAndExit(code, fields) {
  if (exiting) return;
  exiting = true;
  if (fields) finishJob(file, runId, fields);
  process.on('SIGTERM', () => {}); // the group signal below also reaches us
  try { process.kill(-process.pid, 'SIGTERM'); } catch { /* group already empty */ }
  process.exit(code);
}

// Stopped by the build (its exit handler) or by a newer run: record why.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(sig, () => finishAndExit(1, { status: 'failed', error: `stopped (${sig}) before the DMG finished` }));
}

// Parent watchdog: electron-builder gone without stopping us (SIGKILL, crash) →
// stop the group. Checked every 2 s.
const parentPid = process.ppid;
const watchdog = setInterval(() => {
  if (process.ppid !== parentPid || !isPidAlive(parentPid)) {
    console.error('[dmg-job] the build that started this job is gone; stopping the Apple Silicon DMG job.');
    finishAndExit(1, { status: 'failed', error: 'build process ended before the DMG finished' });
  }
}, 2000);
watchdog.unref();

async function main() {
  try {
    const hook = require('./afterAllArtifactBuild.cjs');
    const creds = hook.notarytoolArgs();
    const identity = hook.resolveDeveloperIdIdentity();
    if (!creds || !identity) throw new Error('no notarization credentials or Developer ID identity');
    const version = require('../package.json').version;
    const dmg = await hook.produceDmgForArch({ outDir, archDir, suffix, identity, creds, version });
    if (!dmg) throw new Error(`no signed .app found in ${path.join(outDir, archDir)}`);
    console.log(`[dmg-job] ${path.basename(dmg)} built + notarized + stapled + verified ✅`);
    finishAndExit(0, { status: 'done', dmg });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error(`[dmg-job] ${archDir} DMG FAILED: ${msg}`);
    finishAndExit(1, { status: 'failed', error: msg.slice(0, 500) });
  }
}

main();
