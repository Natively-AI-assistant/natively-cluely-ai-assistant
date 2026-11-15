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
  assert.deepEqual(r.props, { how: 'update', minutes: 10 })
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
