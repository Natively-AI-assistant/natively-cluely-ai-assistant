// src/lib/funnel/runEnd.mjs
//
// How the previous run of the app ended, as the `app_run_ended` funnel event
// says it (added 2026-11-14). Read from the lifecycle marker that run left in
// userData (electron/utils/lifecycleTracker.ts). Pure, so every case can be
// tested with plain values.
//
// Why: meeting_cut_off could not tell a crash from a force quit or a power cut,
// and no crash ever reached the server. This is the server's first look at how
// often the app crashes, on which platform and version.

/** Quit reasons on the marker, by what they mean for the run. */
const HOW_BY_REASON = Object.freeze({
  'user-quit': 'quit',
  'window-close': 'quit',
  'second-instance': 'quit',
  'updater-quit-install': 'update',
  'manual-relaunch': 'update',
  'app-restart': 'restart',
  'os-shutdown': 'os_shutdown',
  'os-signal': 'signal',
  'fatal-main-error': 'crash',
  // Written by builds before 2026-10-31, when a dying renderer, helper or GPU
  // process set the quit reason. The run may have quit normally afterwards;
  // there is no telling, so it reads as the crash it was logged as.
  'renderer-gone': 'crash',
  'child-process-gone': 'crash',
  'gpu-process-crashed': 'crash',
  unknown: 'vanished',
})

const isCount = (v) => Number.isInteger(v) && v >= 0
const ms = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

/**
 * A marker from a build before 2026-11-14 whose run ended this long before the
 * debug log was last written is stale: another run came after it, left no
 * marker (older builds wrote nothing until they quit or a process died) and
 * ended without a word.
 */
export const STALE_MARKER_MS = 3 * 60_000

/** How far past a marker's last sign of life the log may still be that run: a heartbeat, and a minute. */
export const LOG_REACH_MS = 6 * 60_000

/**
 * @param {object|null|undefined} marker the previous run's lifecycle marker
 * @param {string} [currentVersion] this run's app version
 * @param {{ lastLogAt?: number|null, bootAt?: number|null }} [evidence]
 *   lastLogAt: when the debug log was last written before this run wrote to it
 *   (ms; every build writes it). bootAt: when the computer last started (ms).
 * @returns {{ key: string, props: Record<string, string|number|boolean> } | null}
 *   null when there is no previous run to speak of. `key` identifies the run,
 *   so it is reported once.
 */
export function summarizeRunEnd(marker, currentVersion, evidence = {}) {
  if (!marker || typeof marker !== 'object') return null
  const started = ms(marker.startedAt)
  if (!Number.isFinite(started) || !Number.isInteger(marker.pid)) return null
  const logAt = Number.isFinite(evidence?.lastLogAt) ? evidence.lastLogAt : NaN
  const bootAt = Number.isFinite(evidence?.bootAt) ? evidence.bootAt : NaN
  const markerLast = Math.max(ms(marker.lastEventAt) || 0, ms(marker.aliveAt) || 0, started)
  const fromThisBuild = typeof marker.version === 'string' && marker.version.length > 0

  // An older build's marker, followed by a run that left none.
  if (!fromThisBuild && logAt > markerLast + STALE_MARKER_MS) {
    const props = { how: 'vanished' }
    if (Number.isFinite(bootAt)) props.computer_restarted = bootAt > logAt
    return { key: `log:${Math.floor(logAt)}`, props }
  }

  let how
  const reason = typeof marker.quitReason === 'string' ? marker.quitReason : null
  if (reason && Object.prototype.hasOwnProperty.call(HOW_BY_REASON, reason)) how = HOW_BY_REASON[reason]
  else if (reason) how = 'vanished'
  // No reason: a run that reached the end of a clean shutdown, or one that
  // ended without a word (a native crash, a force quit, a power cut, the OS
  // killing it).
  else how = marker.lastEvent === 'clean-exit' ? 'quit' : 'vanished'

  // The last sign of life: the marker's last event or heartbeat, or a later
  // line in the log, but only for a run whose end was not recorded (it can
  // die up to a heartbeat after its last one), and only within a heartbeat of
  // the marker: a later write is another launch that failed before it wrote a
  // marker (the native-module guard exits that early), not this run.
  const recordedEnd = how !== 'vanished'
  const last = !recordedEnd && logAt >= started && logAt <= markerLast + LOG_REACH_MS
    ? Math.max(markerLast, logAt)
    : markerLast
  const props = {
    how,
    minutes: Math.max(0, Math.min(10_000_000, Math.floor((last - started) / 60_000) || 0)),
  }

  const c = marker.crashes
  if (c && typeof c === 'object' && isCount(c.renderer) && isCount(c.gpu) && isCount(c.helper)) {
    props.renderer_crashes = c.renderer
    props.gpu_crashes = c.gpu
    props.helper_crashes = c.helper
    props.out_of_memory = isCount(c.oom) && c.oom > 0
  }
  // Only known for markers that carry their version (2026-11-14 on).
  if (fromThisBuild && typeof currentVersion === 'string' && currentVersion) {
    props.updated = marker.version !== currentVersion
  }
  // The computer has started since the run's last sign of life: it went down
  // with the computer (a shutdown it did not hear, a power cut, a system crash)
  // or died first and the computer was restarted later. When false, the
  // computer stayed up: a run that vanished was the app dying (a crash or a
  // force quit). Windows Fast Startup does not reset the boot time, so a
  // Windows shutdown can read false; the app hears those (query-session-end).
  if (Number.isFinite(bootAt)) props.computer_restarted = bootAt > last

  return { key: `${marker.pid}:${marker.startedAt}`, props }
}
