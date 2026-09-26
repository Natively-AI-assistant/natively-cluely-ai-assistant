// electron/services/__tests__/ReviewService.test.mjs
// Pure-function unit tests for the desktop-side prompt eligibility logic.
// We can't easily spin up Electron + safeStorage in a test, so we only test
// the pure helpers we extracted from ReviewService (shouldShowPromptLocal).
//
// This is intentionally narrow: the wiring (IPC handlers, preload bridges,
// Modal UI) is exercised by hand-testing the app, not by these tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldShowPromptLocal } from '../ReviewPromptLogic.ts'

// ─── shouldShowPromptLocal ──────────────────────────────────────────────

test('returns false when has_reviewed', () => {
  assert.equal(shouldShowPromptLocal({ has_reviewed: true }).eligible, false)
})

test('returns false when dont_show_again', () => {
  assert.equal(shouldShowPromptLocal({ dont_show_again: true }).eligible, false)
})

test('first-time threshold: 3 sessions is eligible', () => {
  const r = shouldShowPromptLocal({ session_count: 3 })
  assert.equal(r.eligible, true)
  assert.equal(r.reason, 'first_time_threshold_met')
})

test('first-time threshold: 30 min usage is eligible', () => {
  const r = shouldShowPromptLocal({ total_usage_ms: 30 * 60 * 1000 })
  assert.equal(r.eligible, true)
})

test('first-time threshold: 2 sessions + 10 min is NOT eligible', () => {
  const r = shouldShowPromptLocal({ session_count: 2, total_usage_ms: 10 * 60 * 1000 })
  assert.equal(r.eligible, false)
  assert.equal(r.reason, 'first_time_threshold_not_met')
})

test('after dismissal: 7 days later is eligible', () => {
  const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 + 1000)).toISOString()
  const r = shouldShowPromptLocal({
    session_count: 5,
    dismissed_count: 1,
    last_prompted_at: sevenDaysAgo,
  })
  assert.equal(r.eligible, true)
  assert.equal(r.reason, 'redisplay_delay_met')
})

test('after dismissal: 3 more sessions is eligible', () => {
  const r = shouldShowPromptLocal({
    session_count: 6,  // 3 first + 3 redisplay
    dismissed_count: 1,
    last_prompted_at: new Date().toISOString(),
  })
  assert.equal(r.eligible, true)
  assert.equal(r.reason, 'redisplay_sessions_met')
})

test('cooldown: next_eligible_at in the future → not eligible', () => {
  const r = shouldShowPromptLocal({
    session_count: 99,
    next_eligible_at: new Date(Date.now() + 60_000).toISOString(),
  })
  assert.equal(r.eligible, false)
  assert.equal(r.reason, 'cooldown')
})

test('no state → not eligible', () => {
  assert.equal(shouldShowPromptLocal(null).eligible, false)
  assert.equal(shouldShowPromptLocal(undefined).eligible, false)
})

test('after dismissal: still inside both windows → not eligible', () => {
  const justNow = new Date().toISOString()
  const r = shouldShowPromptLocal({
    session_count: 4,
    dismissed_count: 1,
    last_prompted_at: justNow,
    next_eligible_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
  assert.equal(r.eligible, false)
  assert.equal(r.reason, 'cooldown')
})

// Audit HIGH #4 fix: 7-day clock anchored to last_dismissed_at
test('HIGH #4: 7-day clock anchored to last_dismissed_at, not last_prompted_at', () => {
  // last_dismissed_at = 8 days ago → redisplay_delay_met should fire.
  // session_count = 0 so redisplay_sessions_met does NOT fire.
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const r = shouldShowPromptLocal({
    session_count: 0,
    dismissed_count: 1,
    last_dismissed_at: eightDaysAgo,
    last_prompted_at: new Date().toISOString(),  // fresh, but should be ignored
  })
  assert.equal(r.eligible, true)
  assert.equal(r.reason, 'redisplay_delay_met')
})

test('HIGH #4: backwards compat — state without last_dismissed_at falls back to last_prompted_at', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const r = shouldShowPromptLocal({
    session_count: 0,
    dismissed_count: 1,
    last_prompted_at: eightDaysAgo,
  })
  assert.equal(r.eligible, true)
  assert.equal(r.reason, 'redisplay_delay_met')
})