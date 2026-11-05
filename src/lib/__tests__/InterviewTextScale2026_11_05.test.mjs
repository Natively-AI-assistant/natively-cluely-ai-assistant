// Interview text size (#673): the value, its range and how it is saved.
//
// Run with: node --experimental-strip-types --test src/lib/__tests__/InterviewTextScale2026_11_05.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const sent = [];
let storageEvents = 0;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
};
globalThis.window = {
  dispatchEvent: (e) => { if (e.type === 'storage') storageEvents += 1; },
  electronAPI: { setInterviewTextScale: (v) => sent.push(v) },
};

const m = await import('../interviewTextScale.ts');

beforeEach(() => { store.clear(); sent.length = 0; storageEvents = 0; });

test('clamps to 0.8–1.6 and rounds to the 0.1 step', () => {
  assert.equal(m.clampInterviewTextScale(1), 1);
  assert.equal(m.clampInterviewTextScale(0.2), 0.8);
  assert.equal(m.clampInterviewTextScale(9), 1.6);
  assert.equal(m.clampInterviewTextScale(1.24), 1.2);
  assert.equal(m.clampInterviewTextScale('1.3'), 1.3);
});

test('unusable input falls back to 100%', () => {
  for (const v of [NaN, Infinity, undefined, null, 'big', {}]) {
    assert.equal(m.clampInterviewTextScale(v), m.INTERVIEW_TEXT_SCALE_DEFAULT);
  }
});

test('steps by 0.1 without floating-point drift and stops at the ends', () => {
  let s = 1;
  for (let i = 0; i < 3; i++) s = m.stepInterviewTextScale(s, 'increase');
  assert.equal(s, 1.3);
  for (let i = 0; i < 20; i++) s = m.stepInterviewTextScale(s, 'increase');
  assert.equal(s, m.INTERVIEW_TEXT_SCALE_MAX);
  for (let i = 0; i < 20; i++) s = m.stepInterviewTextScale(s, 'decrease');
  assert.equal(s, m.INTERVIEW_TEXT_SCALE_MIN);
  assert.equal(m.stepInterviewTextScale(1.5, 'reset'), 1);
});

test('formats as a percentage', () => {
  assert.equal(m.formatInterviewTextScale(1), '100%');
  assert.equal(m.formatInterviewTextScale(1.2), '120%');
  assert.equal(m.formatInterviewTextScale(0.8), '80%');
});

test('nothing saved reads as 100%; a bad saved value is clamped', () => {
  assert.equal(m.getInterviewTextScale(), 1);
  store.set('natively_interview_text_scale', 'junk');
  assert.equal(m.getInterviewTextScale(), 1);
  store.set('natively_interview_text_scale', '5');
  assert.equal(m.getInterviewTextScale(), 1.6);
});

test('saving clamps, persists, notifies this window and tells main', () => {
  assert.equal(m.setInterviewTextScale(1.44), 1.4);
  assert.equal(store.get('natively_interview_text_scale'), '1.4');
  assert.equal(storageEvents, 1);
  assert.deepEqual(sent, [1.4]);
  assert.equal(m.getInterviewTextScale(), 1.4);
});
