// src/lib/funnel/__tests__/runEnd.test.mjs
//
// summarizeRunEnd: how the previous run ended, from the lifecycle marker it
// left (electron/utils/lifecycleTracker.ts), as app_run_ended reports it.
// Every result must pass the catalogue, or the server would refuse it.
//
// Run: node --test src/lib/funnel/__tests__/runEnd.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRunEnd } from '../runEnd.mjs'
import { checkFunnelProps, FUNNEL_CATALOG } from '../funnelCatalog.mjs'

const T0 = '2026-11-14T10:00:00.000Z'
const at = (min) => new Date(Date.parse(T0) + min * 60_000).toISOString()
const marker = (over = {}) => ({
  pid: 4242, startedAt: T0, lastEvent: 'app-start', lastEventAt: T0, quitReason: null,
  version: '3.2.0', crashes: { renderer: 0, gpu: 0, helper: 0, oom: 0 }, ...over,
})
const how = (m) => summarizeRunEnd(m, '3.2.0').props.how
const valid = (props) => checkFunnelProps('app_run_ended', { ...props, in_meeting: false })

test('a clean quit, with and without the user-quit reason still on the marker', () => {
  assert.equal(how(marker({ lastEvent: 'clean-exit', quitReason: null })), 'quit')
  assert.equal(how(marker({ lastEvent: 'clean-exit', quitReason: 'user-quit' })), 'quit')
  assert.equal(how(marker({ lastEvent: 'will-quit', quitReason: 'window-close' })), 'quit')
})

test('each quit reason maps to what it means', () => {
  assert.equal(how(marker({ quitReason: 'updater-quit-install' })), 'update')
  assert.equal(how(marker({ quitReason: 'manual-relaunch' })), 'update')
  assert.equal(how(marker({ quitReason: 'os-shutdown' })), 'os_shutdown')
  assert.equal(how(marker({ quitReason: 'os-signal' })), 'signal')
  assert.equal(how(marker({ quitReason: 'fatal-main-error' })), 'crash')
  assert.equal(how(marker({ quitReason: 'renderer-gone' })), 'crash', 'markers from builds before 2026-10-31')
  assert.equal(how(marker({ quitReason: 'unknown' })), 'vanished')
  assert.equal(how(marker({ quitReason: 'a-reason-from-the-future' })), 'vanished')
})

test('a run that ended without a word (no reason, no clean exit) vanished: the case this exists for', () => {
  assert.equal(how(marker({ lastEvent: 'app-start' })), 'vanished')
  assert.equal(how(marker({ lastEvent: 'render-process-gone', lastIncident: { event: 'render-process-gone', at: T0 } })), 'vanished')
})

test('minutes run to the last sign of life: the heartbeat or the last event, whichever is later', () => {
  assert.equal(summarizeRunEnd(marker({ lastEventAt: at(3), aliveAt: at(25) })).props.minutes, 25)
  assert.equal(summarizeRunEnd(marker({ lastEventAt: at(42), aliveAt: at(40) })).props.minutes, 42)
  assert.equal(summarizeRunEnd(marker({ lastEventAt: at(-5) })).props.minutes, 0, 'a clock that moved back is not negative')
})

test('crash counts and out-of-memory come from the marker', () => {
  const p = summarizeRunEnd(marker({ crashes: { renderer: 2, gpu: 1, helper: 3, oom: 1 } }), '3.2.0').props
  assert.deepEqual([p.renderer_crashes, p.gpu_crashes, p.helper_crashes, p.out_of_memory], [2, 1, 3, true])
  const q = summarizeRunEnd(marker(), '3.2.0').props
  assert.deepEqual([q.renderer_crashes, q.out_of_memory], [0, false])
})

test('a marker from an older build (no version, no counts) reports only what it knows', () => {
  const old = { pid: 7, startedAt: T0, lastEvent: 'clean-exit', lastEventAt: at(10), quitReason: 'updater-quit-install' }
  const r = summarizeRunEnd(old, '3.2.0')
  assert.deepEqual(r.props, { how: 'update', minutes: 10, last_event: 'clean_exit' }, 'older markers record their last event too')
  assert.equal(valid(r.props).ok, true)
})

test('updated says whether the run was another version', () => {
  assert.equal(summarizeRunEnd(marker({ version: '3.1.0' }), '3.2.0').props.updated, true)
  assert.equal(summarizeRunEnd(marker({ version: '3.2.0' }), '3.2.0').props.updated, false)
})

test('no marker, or a broken one, is no report', () => {
  assert.equal(summarizeRunEnd(null), null)
  assert.equal(summarizeRunEnd({}), null)
  assert.equal(summarizeRunEnd({ pid: 'x', startedAt: T0 }), null)
  assert.equal(summarizeRunEnd({ pid: 1, startedAt: 'not a date' }), null)
})

test('the key names the run, so the same run is reported once', () => {
  assert.equal(summarizeRunEnd(marker()).key, `4242:${T0}`)
})

test('every shape it produces passes the catalogue, with in_meeting added by the app', () => {
  assert.ok(FUNNEL_CATALOG.app_run_ended)
  const cases = [
    marker(), marker({ quitReason: 'os-shutdown', aliveAt: at(90) }),
    marker({ quitReason: 'fatal-main-error', crashes: { renderer: 5, gpu: 0, helper: 0, oom: 5 } }),
    { pid: 1, startedAt: T0, lastEvent: 'app-start', lastEventAt: T0, quitReason: null },
  ]
  for (const m of cases) {
    const r = summarizeRunEnd(m, '3.2.0')
    assert.equal(valid(r.props).ok, true, JSON.stringify(r.props))
  }
})

// ── Evidence from outside the marker (2026-11-14, second pass) ─────────────

const old = (over = {}) => ({ pid: 7, startedAt: T0, lastEvent: 'clean-exit', lastEventAt: at(60), quitReason: 'user-quit', ...over })
const tMs = (min) => Date.parse(T0) + min * 60_000

test('an older build\'s marker followed by a run that left none: the log says so, and that run vanished', () => {
  const r = summarizeRunEnd(old(), '3.2.0', { lastLogAt: tMs(60 + 45) })
  assert.equal(r.props.how, 'vanished')
  assert.equal(r.props.minutes, undefined, 'when that run started is not known')
  assert.equal(r.key, `log:${tMs(105)}`)
  assert.equal(valid(r.props).ok, true)
})

test('an older build\'s marker of a run that really quit: the log ends with it, so it reads as a quit', () => {
  const r = summarizeRunEnd(old(), '3.2.0', { lastLogAt: tMs(60) + 20_000 })
  assert.equal(r.props.how, 'quit')
  assert.equal(r.props.minutes, 60)
  assert.equal(r.key, `7:${T0}`)
})

test('a marker of this build is never called stale: the log only moves its last sign of life', () => {
  const m = marker({ aliveAt: at(30) })
  const r = summarizeRunEnd(m, '3.2.0', { lastLogAt: tMs(33) })
  assert.equal(r.props.how, 'vanished')
  assert.equal(r.props.minutes, 33, 'it died between heartbeats; the log saw it later than the marker')
  const later = summarizeRunEnd(m, '3.2.0', { lastLogAt: tMs(600) })
  assert.equal(later.key, `4242:${T0}`)
  assert.equal(later.props.minutes, 30, 'a write long after is another launch that failed before its marker, not this run')
  assert.equal(later.props.renderer_crashes, 0)
})

test('a log older than the run (truncated, or another run\'s) is ignored', () => {
  assert.equal(summarizeRunEnd(marker({ lastEventAt: at(10) }), '3.2.0', { lastLogAt: tMs(-30) }).props.minutes, 10)
})

test('computer_restarted: the computer started after the run\'s last sign of life', () => {
  const m = marker({ aliveAt: at(40) })
  assert.equal(summarizeRunEnd(m, '3.2.0', { bootAt: tMs(50) }).props.computer_restarted, true)
  assert.equal(summarizeRunEnd(m, '3.2.0', { bootAt: tMs(-600) }).props.computer_restarted, false)
  assert.equal(summarizeRunEnd(m, '3.2.0').props.computer_restarted, undefined, 'unknown boot time: left out')
  assert.equal(summarizeRunEnd(old(), '3.2.0', { lastLogAt: tMs(200), bootAt: tMs(300) }).props.computer_restarted, true)
  assert.equal(valid(summarizeRunEnd(m, '3.2.0', { bootAt: tMs(50) }).props).ok, true)
})

test('a run whose end was recorded keeps its own end: the log never stretches it', () => {
  const r = summarizeRunEnd(marker({ lastEvent: 'clean-exit', quitReason: 'user-quit', lastEventAt: at(20) }), '3.2.0', { lastLogAt: tMs(24) })
  assert.deepEqual([r.props.how, r.props.minutes], ['quit', 20])
})

test('a restart reads as a restart', () => {
  assert.equal(how(marker({ quitReason: 'app-restart' })), 'restart')
  assert.equal(valid(summarizeRunEnd(marker({ quitReason: 'app-restart' }), '3.2.0').props).ok, true)
})

// ── 2026-11-16: a crash says where and what ─────────────────────────────────
import { fatalErrorFacts, FATAL_SOURCES, ERROR_NAMES, ERROR_CODES } from '../runEnd.mjs'

const crash = (quitMeta, over = {}) => summarizeRunEnd(marker({ quitReason: 'fatal-main-error', quitMeta, ...over }), '3.2.1').props

test('fatalErrorFacts keeps the class and the code, never the message', () => {
  const e = Object.assign(new Error('/Users/someone/secret path sk-abc'), { code: 'ENOENT' })
  const { name, code, where } = fatalErrorFacts(e)
  assert.deepEqual({ name, code }, { name: 'Error', code: 'ENOENT' })
  assert.ok(typeof where === 'string', 'a real error has a stack to place')
  assert.ok(!/someone|secret/.test(JSON.stringify(fatalErrorFacts(e))))
  assert.equal(fatalErrorFacts(new TypeError('x')).name, 'TypeError')
  assert.deepEqual(fatalErrorFacts('a string'), { name: 'not_an_error' })
  assert.deepEqual(fatalErrorFacts(null), { name: 'not_an_error' })
  assert.deepEqual(fatalErrorFacts({ name: 'has spaces <b>', code: 'x'.repeat(65) }), {})
  const hostile = { get name() { throw new Error('no') } }
  assert.deepEqual(fatalErrorFacts(hostile), {})
})

test('an uncaught error during startup: where, what and that startup never finished', () => {
  const p = crash({ source: 'uncaughtException', name: 'Error', code: 'ERR_DLOPEN_FAILED', message: 'cannot open /Users/someone/a.node' }, { startedUp: false })
  assert.equal(p.how, 'crash')
  assert.equal(p.fatal_source, 'uncaught_exception')
  assert.equal(p.error_name, 'error')
  assert.equal(p.error_code, 'err_dlopen_failed')
  assert.equal(p.started_up, false)
  assert.ok(!/someone|cannot open/.test(JSON.stringify(p)), 'no message leaves')
  assert.deepEqual(valid(p).ok, true)
})

test('each fatal path maps to its source; an unknown one is other', () => {
  assert.equal(crash({ source: 'unhandledRejection-loop-giveup' }).fatal_source, 'rejection_loop')
  assert.equal(crash({ source: 'render-process-gone-loop-giveup' }).fatal_source, 'window_crash_loop')
  assert.equal(crash({ source: 'initializeApp-failed' }).fatal_source, 'startup_failed')
  assert.equal(crash({ source: 'native-arch-gate', message: 'x' }).fatal_source, 'native_arch')
  assert.equal(crash({ source: 'something-new' }).fatal_source, 'other')
  assert.equal(crash({ name: 'TypeError', message: 'm' }).fatal_source, 'uncaught_exception', "the tracker's own handler writes no source")
})

test('names and codes outside the lists report as other; SQLite extended codes as their base', () => {
  assert.equal(crash({ source: 'uncaughtException', name: 'TypeError' }).error_name, 'type_error')
  assert.equal(crash({ source: 'uncaughtException', name: 'not_an_error' }).error_name, 'not_an_error')
  assert.equal(crash({ source: 'uncaughtException', code: 'EACCES' }).error_code, 'eacces')
  assert.equal(crash({ source: 'uncaughtException', name: 'MyCustomError' }).error_name, 'other')
  assert.equal(crash({ source: 'uncaughtException', code: 'SQLITE_IOERR_SHORT_READ' }).error_code, 'sqlite_ioerr')
  assert.equal(crash({ source: 'uncaughtException', code: 'E_SOMETHING' }).error_code, 'other')
})

test('3.2.0 markers (source only, no startedUp) report the source alone', () => {
  const p = crash({ source: 'uncaughtException' })
  assert.equal(p.fatal_source, 'uncaught_exception')
  assert.equal('error_name' in p || 'error_code' in p || 'started_up' in p, false)
  assert.equal(valid(p).ok, true)
})

test('only a crash carries crash details', () => {
  const p = summarizeRunEnd(marker({ quitReason: 'user-quit', lastEvent: 'clean-exit', quitMeta: { source: 'uncaughtException', name: 'Error' }, startedUp: true }), '3.2.1').props
  assert.equal('fatal_source' in p || 'error_name' in p || 'started_up' in p, false)
})

test('the catalogue lists are exactly runEnd.mjs lists, so every value passes', () => {
  const spec = FUNNEL_CATALOG.app_run_ended
  assert.deepEqual([...spec.fatal_source], [...FATAL_SOURCES])
  assert.deepEqual([...spec.error_name], [...ERROR_NAMES])
  assert.deepEqual([...spec.error_code], [...ERROR_CODES])
  for (const fatal_source of FATAL_SOURCES) for (const error_name of ERROR_NAMES) {
    assert.equal(valid({ how: 'crash', fatal_source, error_name, error_code: 'other', started_up: true }).ok, true)
  }
})

// ── 2026-11-16: where in the code, how far startup got, the machine ─────────
import { stackFacts, toSnake, STARTUP_PHASES, LAST_EVENTS } from '../runEnd.mjs'
import fs from 'node:fs'

const MAC = '/Applications/Natively.app/Contents/Resources/app.asar'
const WIN = 'C:\\Users\\someone\\AppData\\Local\\Programs\\Natively\\resources\\app.asar'

test('the first app frame gives file, line and column; no path is kept, on either platform', () => {
  for (const root of [MAC, WIN]) {
    const sep = root === WIN ? '\\' : '/'
    const p = (...xs) => [root, ...xs].join(sep)
    const stack = `TypeError: boom\n    at Database.prepare (${p('node_modules', 'better-sqlite3', 'lib', 'database.js')}:65:21)\n` +
      `    at Store.load (${p('dist-electron', 'electron', 'main.js')}:204811:33)\n    at ${p('dist-electron', 'electron', 'main.js')}:1:1`
    const f = stackFacts(stack)
    assert.deepEqual(f, { where: 'dependency', file: 'main', line: 204811, col: 33 })
    assert.ok(!/someone|Applications/.test(JSON.stringify(f)))
  }
  assert.deepEqual(stackFacts(`Error\n    at x (${MAC}/dist-electron/premium/electron/autoAnswer/a.js:9:2)`), { where: 'app', file: 'premium', line: 9, col: 2 })
  assert.deepEqual(stackFacts('Error\n    at node:internal/modules/cjs/loader:1:2'), { where: 'node_internal' })
  assert.deepEqual(stackFacts(undefined), {})
})

test('a crash reports the location; the catalogue takes it', () => {
  const p = crash({ source: 'uncaughtException', name: 'TypeError', where: 'app', file: 'main', line: 204811, col: 33 })
  assert.equal(p.crash_where, 'app')
  assert.equal(p.crash_file, 'main')
  assert.equal(p.crash_line, 204811)
  assert.equal(p.crash_col, 33)
  assert.equal(valid(p).ok, true)
})

test('every run says what it last recorded; a run that never finished starting says how far it got', () => {
  const vanished = summarizeRunEnd(marker({ lastEvent: 'render-process-gone', startedUp: false, startupPhase: 'create-window:start' }), '3.2.1').props
  assert.equal(vanished.how, 'vanished')
  assert.equal(vanished.last_event, 'render_process_gone')
  assert.equal(vanished.startup_phase, 'create_window_start')
  assert.equal(valid(vanished).ok, true)
  const later = summarizeRunEnd(marker({ lastEvent: 'clean-exit', startedUp: true, startupPhase: 'initializeApp:complete' }), '3.2.1').props
  assert.equal(later.last_event, 'clean_exit')
  assert.equal('startup_phase' in later, false, 'only for a run that never finished starting')
  assert.equal(summarizeRunEnd(marker({ lastEvent: 'quit-reason:fatal-main-error' }), '3.2.1').props.last_event, 'quit_reason_set')
  assert.equal(summarizeRunEnd(marker({ lastEvent: 'something-new' }), '3.2.1').props.last_event, 'other')
})

test('the machine: arch, Rosetta and the OS version, on both platforms', () => {
  const mac = summarizeRunEnd(marker({ env: { platform: 'darwin', arch: 'x64', translated: true, osRelease: '25.1.0' } }), '3.2.1').props
  assert.deepEqual([mac.arch, mac.translated, mac.os_version], ['x64', true, 25])
  const win = summarizeRunEnd(marker({ env: { platform: 'win32', arch: 'x64', translated: false, osRelease: '10.0.26100' } }), '3.2.1').props
  assert.deepEqual([win.arch, win.translated, win.os_version], ['x64', false, 26100])
  assert.equal(valid(mac).ok && valid(win).ok, true)
  const old = summarizeRunEnd(marker(), '3.2.1').props
  assert.equal('arch' in old || 'os_version' in old, false, '3.2.0 markers carry no env')
})

test('every startup phase main.ts logs has its own value, so none reads as other', () => {
  const src = fs.readFileSync(new URL('../../../../electron/main.ts', import.meta.url), 'utf8')
  const phases = [...src.matchAll(/logStartupPhase\('([^']+)'/g)].map((m) => m[1])
  assert.ok(phases.length >= 10)
  for (const ph of phases) assert.ok(STARTUP_PHASES.includes(toSnake(ph)), `${ph} → ${toSnake(ph)} is missing from STARTUP_PHASES`)
})

test('every event the tracker records has its own last_event value', () => {
  const src = fs.readFileSync(new URL('../../../../electron/utils/lifecycleTracker.ts', import.meta.url), 'utf8')
  const names = new Set(['app-start', 'clean-exit', 'unhandledRejection'])
  for (const m of src.matchAll(/(?:record|noteIncident|osShutdown|takeBackPendingShutdown)\(\s*'([^']+)'/g)) names.add(m[1])
  for (const n of names) assert.ok(LAST_EVENTS.includes(toSnake(n)), `${n} → ${toSnake(n)} is missing from LAST_EVENTS`)
})

test('the catalogue lists are runEnd.mjs lists', () => {
  const spec = FUNNEL_CATALOG.app_run_ended
  assert.deepEqual([...spec.last_event], [...LAST_EVENTS])
  assert.deepEqual([...spec.startup_phase], [...STARTUP_PHASES])
})
