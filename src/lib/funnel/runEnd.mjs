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

// What a fatal exit reports about itself (2026-11-16). 3.2.0's first day had
// 9 Mac runs end in 'crash' with nothing to say why: the marker kept the label
// of the path that killed the app, and nothing left the computer. These are
// fixed lists, so no message, path or name of the user's ever does.

/** The fatal path, from the `source` main.ts gives terminateAfterFatalError. */
const FATAL_SOURCE_BY_LABEL = Object.freeze({
  uncaughtException: 'uncaught_exception',
  'unhandledRejection-loop-giveup': 'rejection_loop',
  'render-process-gone-loop-giveup': 'window_crash_loop',
  'initializeApp-failed': 'startup_failed',
  'native-arch-gate': 'native_arch',
})
export const FATAL_SOURCES = Object.freeze([...Object.values(FATAL_SOURCE_BY_LABEL), 'other'])

/** Error classes worth telling apart, as the catalogue spells them. Node's system errors are plain Error with a code. */
const ERROR_NAME_BY_CLASS = Object.freeze({
  Error: 'error',
  TypeError: 'type_error',
  ReferenceError: 'reference_error',
  RangeError: 'range_error',
  SyntaxError: 'syntax_error',
  URIError: 'uri_error',
  EvalError: 'eval_error',
  AggregateError: 'aggregate_error',
  SqliteError: 'sqlite_error',
  AbortError: 'abort_error',
  SystemError: 'system_error',
})
export const ERROR_NAMES = Object.freeze([...Object.values(ERROR_NAME_BY_CLASS), 'not_an_error', 'other'])

/** Codes that point at a cause: the filesystem, a native module, the database, a pipe. Lower case, as the catalogue spells them. */
export const ERROR_CODES = Object.freeze([
  'enoent', 'eacces', 'eperm', 'enospc', 'emfile', 'enfile', 'ebusy', 'eexist', 'eisdir', 'enotdir', 'eio',
  'erofs', 'enomem', 'eagain', 'epipe', 'econnreset', 'econnrefused', 'etimedout', 'eaddrinuse',
  'err_dlopen_failed', 'module_not_found', 'err_module_not_found', 'err_require_esm', 'err_invalid_arg_type',
  'err_invalid_arg_value', 'err_stream_destroyed', 'err_stream_write_after_end', 'err_ipc_channel_closed',
  'err_socket_closed', 'sqlite_corrupt', 'sqlite_notadb', 'sqlite_busy', 'sqlite_locked', 'sqlite_cantopen',
  'sqlite_full', 'sqlite_ioerr', 'sqlite_readonly', 'sqlite_error', 'sqlite_misuse', 'sqlite_constraint',
  'other',
])

/** 'initializeApp:start' → 'initialize_app_start', 'SIGTERM' → 'sigterm'. */
export function toSnake(label) {
  return String(label)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

/** main.ts logStartupPhase(), in order. A test keeps this in step with main.ts. */
export const STARTUP_PHASES = Object.freeze([
  'single_instance_lock', 'initialize_app_start', 'before_app_when_ready', 'after_app_when_ready',
  'telemetry_configure_start', 'telemetry_configure_complete', 'credentials_init_start',
  'credentials_init_complete', 'app_state_get_instance_start', 'app_state_get_instance_complete',
  'create_window_start', 'create_window_complete', 'initialize_app_complete', 'other',
])

/** What the marker last recorded (lifecycleTracker.ts). Says what a silent end was in the middle of. */
export const LAST_EVENTS = Object.freeze([
  'app_start', 'before_quit', 'will_quit', 'window_all_closed', 'clean_exit', 'quit_reason_set',
  'render_process_gone', 'child_process_gone', 'gpu_process_crashed',
  'query_session_end', 'session_end', 'power_shutdown', 'session_end_cancelled', 'session_end_cancelled_by_quit',
  'uncaught_exception', 'unhandled_rejection', 'sigterm', 'sigint', 'sighup', 'other',
])

/** Where the error's first stack frame is. */
export const CRASH_WHERE = Object.freeze(['app', 'dependency', 'node_internal', 'electron_internal', 'unknown'])
/** Which of the app's built files its first own frame is in. The bundle is one main.js, so line and column say the rest. */
export const CRASH_FILES = Object.freeze(['main', 'preload', 'premium', 'app_other'])
export const ARCHES = Object.freeze(['arm64', 'x64', 'ia32', 'other'])

const oneOf = (list, v) => (list.includes(v) ? v : 'other')

/** A stack frame's location, slashes made forward: { path, line, col } or null. */
function frameLocation(frame) {
  const m = /\(?((?:[A-Za-z]:)?[^()\s]+?):(\d+):(\d+)\)?\s*$/.exec(frame)
  if (!m) return null
  return { path: m[1].replace(/\\/g, '/'), line: Number(m[2]), col: Number(m[3]) }
}

function frameKind(path) {
  if (/\/node_modules\//.test(path) && !/\/dist-electron\//.test(path)) return 'dependency'
  if (/\/dist-electron\//.test(path)) return 'app'
  if (/^node:electron|electron\/js2c|electron\.asar|^electron:/.test(path)) return 'electron_internal'
  if (/^node:|^internal\//.test(path)) return 'node_internal'
  return 'unknown'
}

function appFile(path) {
  const rel = path.slice(path.lastIndexOf('/dist-electron/') + '/dist-electron/'.length)
  if (rel === 'electron/main.js') return 'main'
  if (rel === 'electron/preload.js') return 'preload'
  if (rel.startsWith('premium/')) return 'premium'
  return 'app_other'
}

/**
 * Where in the stack an error was thrown: the kind of its first frame, and the
 * first frame in the app's own built code (file, line, column). Only those: a
 * path is never kept (it holds the user's home folder).
 * @param {unknown} stack
 */
export function stackFacts(stack) {
  if (typeof stack !== 'string') return {}
  const frames = stack.split('\n').filter((l) => /^\s*at\s/.test(l)).slice(0, 40)
  const out = {}
  for (const f of frames) {
    const loc = frameLocation(f)
    if (!loc) continue
    const kind = frameKind(loc.path)
    if (!out.where) out.where = kind
    if (kind === 'app') {
      out.file = appFile(loc.path)
      out.line = loc.line
      out.col = loc.col
      break
    }
  }
  return out
}

const NAME_RE = /^[A-Za-z_$][\w$]{0,63}$/
const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * The parts of a thrown value the marker keeps for the crash report: its class
 * and its code, bounded. Never the message (it can hold paths, names, keys).
 * @param {unknown} err
 * @returns {{ name?: string, code?: string }}
 */
export function fatalErrorFacts(err) {
  if (err === null || (typeof err !== 'object' && typeof err !== 'function')) return { name: 'not_an_error' }
  const out = {}
  try {
    const name = err.name
    if (typeof name === 'string' && NAME_RE.test(name)) out.name = name
    const code = err.code
    if (typeof code === 'string' && CODE_RE.test(code)) out.code = code
    Object.assign(out, stackFacts(err.stack))
  } catch { /* a throwing getter: nothing to keep */ }
  return out
}

/** SQLite's extended codes (SQLITE_IOERR_SHORT_READ) report as their base. */
function errorCodeOf(code) {
  if (typeof code !== 'string') return null
  const c = code.toLowerCase()
  if (ERROR_CODES.includes(c)) return c
  const base = ERROR_CODES.find((b) => b.startsWith('sqlite_') && c.startsWith(`${b}_`))
  return base || 'other'
}

function errorNameOf(name) {
  if (name === 'not_an_error') return name
  return Object.prototype.hasOwnProperty.call(ERROR_NAME_BY_CLASS, name) ? ERROR_NAME_BY_CLASS[name] : 'other'
}

/** The crash-only props, from a fatal marker's quitMeta. */
function fatalProps(meta, startedUp) {
  const out = {}
  const m = meta && typeof meta === 'object' ? meta : {}
  const label = typeof m.source === 'string' ? m.source : null
  // The tracker's own uncaughtException handler writes the error without a source.
  if (label) out.fatal_source = Object.prototype.hasOwnProperty.call(FATAL_SOURCE_BY_LABEL, label) ? FATAL_SOURCE_BY_LABEL[label] : 'other'
  else if (typeof m.name === 'string') out.fatal_source = 'uncaught_exception'
  if (typeof m.name === 'string') out.error_name = errorNameOf(m.name)
  const code = errorCodeOf(m.code)
  if (code) out.error_code = code
  if (typeof startedUp === 'boolean') out.started_up = startedUp
  if (typeof m.where === 'string') out.crash_where = oneOf(CRASH_WHERE, m.where)
  if (typeof m.file === 'string' && isLineCol(m.line) && isLineCol(m.col)) {
    out.crash_file = oneOf(CRASH_FILES, m.file) === 'other' ? 'app_other' : m.file
    out.crash_line = m.line
    out.crash_col = m.col
  }
  return out
}

const isLineCol = (v) => Number.isInteger(v) && v >= 0 && v <= 10_000_000

/** Every run: what it last recorded, how far startup got, and the machine it ran on. */
function contextProps(marker) {
  const out = {}
  if (typeof marker.lastEvent === 'string') {
    out.last_event = marker.lastEvent.startsWith('quit-reason:') ? 'quit_reason_set' : oneOf(LAST_EVENTS, toSnake(marker.lastEvent))
  }
  if (marker.startedUp === false && typeof marker.startupPhase === 'string') {
    out.startup_phase = oneOf(STARTUP_PHASES, toSnake(marker.startupPhase))
  }
  const env = marker.env && typeof marker.env === 'object' ? marker.env : null
  if (env) {
    if (typeof env.arch === 'string') out.arch = oneOf(ARCHES, env.arch)
    if (typeof env.translated === 'boolean') out.translated = env.translated
    // macOS: the Darwin major (25 = macOS 26). Windows: the build (26100 = 24H2).
    const parts = typeof env.osRelease === 'string' ? env.osRelease.split('.').map((n) => parseInt(n, 10)) : []
    const v = env.platform === 'win32' ? parts[2] : parts[0]
    if (isLineCol(v)) out.os_version = v
  }
  return out
}

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
  if (reason === 'fatal-main-error') Object.assign(props, fatalProps(marker.quitMeta, marker.startedUp))
  Object.assign(props, contextProps(marker))

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
