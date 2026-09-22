// Guards the scorer. Both of its bugs so far silently moved a model's score:
// an unscoped check matched the model's own answer numbering (inflated), and a
// line-anchored scope missed answers packed onto one line (deflated).
//
// Run: node --test harness/scoring.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { answerLine, checkOne, near, onLine } from './scoring.mjs'

test('multi-line numbered answers', () => {
  const t = '1. Approximately 155\n2. Wednesday\n3. Four days\n4. Approximately 205'
  assert.match(answerLine(t, 1), /155/)
  assert.match(answerLine(t, 3), /Four days/)
  assert.doesNotMatch(answerLine(t, 3), /155|205/)
})

test('answers packed onto ONE line are still separable', () => {
  const t = '(1) expressjs/express (2) Public (3) 107'
  assert.match(answerLine(t, 1), /expressjs\/express/)
  assert.match(answerLine(t, 2), /Public/)
  assert.match(answerLine(t, 3), /107/)
  assert.doesNotMatch(answerLine(t, 2), /107/)
})

test('a check cannot be satisfied by the answer numbering itself', () => {
  // "3." is the marker for answer 3, whose text is "Four days" — not a 3.
  const t = '1. Approximately 155\n2. Wednesday\n3. Four days\n4. Approximately 205'
  assert.equal(checkOne(onLine(3, /(^|[^0-9])3([^0-9]|$)|three/i), t), false)
  assert.equal(checkOne(/\b3\b/, t), true, 'unscoped check is exactly the bug: it matches the marker')
})

test('numeric tolerance reads the scoped span only', () => {
  const t = '1. 152\n2. Wednesday\n3. five\n4. 127'
  assert.equal(checkOne(onLine(1, near(155, 12)), t), true)
  assert.equal(checkOne(onLine(4, near(207, 22)), t), false)
})

test('continuation lines belong to their answer', () => {
  const t = '1. Grafana Play Home\n   (breadcrumb: Dashboards > Examples)\n2. No — a Sign in button is visible'
  assert.match(answerLine(t, 1), /breadcrumb/)
  assert.doesNotMatch(answerLine(t, 1), /Sign in/)
  assert.match(answerLine(t, 2), /Sign in/)
})

test('unnumbered answers fall back to positional lines', () => {
  const t = 'Grafana Play Home\nNo, not signed in\nDashboards'
  assert.match(answerLine(t, 2), /not signed in/)
})

test('a decimal or date is not mistaken for a marker', () => {
  const t = '1. revenue 466.8B and margin 27.6%\n2. October - September'
  assert.match(answerLine(t, 1), /466\.8B/)
  assert.match(answerLine(t, 2), /October/)
})
