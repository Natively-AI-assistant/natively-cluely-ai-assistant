// PHASE 7 — Live Transcript Brain latency budget characterization.
// The prompt's Phase 7 budgets: transcript/summary lookup < 30ms, live context
// assembly < 250ms (excluding optional RAG). The brain is pure in-memory work, so it
// must clear these by a wide margin even on a large (1000-turn) transcript. These
// thresholds are generous (10x headroom) to stay non-flaky in CI while still catching
// any accidental O(n^2)/IO regression.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTranscriptBrain } from '../../../dist-electron/electron/intelligence/LiveTranscriptBrain.js';
import { extractLatestQuestion } from '../../../dist-electron/electron/llm/index.js';

// A large fake session: 1000 finalized turns spanning ~33 minutes.
function bigSession() {
  const items = [];
  const base = 1_000_000_000_000; // fixed epoch (no Date.now in pure logic under test)
  for (let i = 0; i < 1000; i++) {
    const role = i % 3 === 0 ? 'interviewer' : 'user';
    items.push({ role, text: `Turn ${i} about Kafka and PostgreSQL scaling considerations.`, timestamp: base + i * 2000 });
  }
  const now = base + 1000 * 2000;
  return {
    _now: now,
    getContext(s = 120) { const c = this._now - s * 1000; return items.filter(i => i.timestamp >= c); },
    getContextWithInterim(s = 120) { return this.getContext(s); },
    getDurableContext(s = 7200) { const c = Number.isFinite(s) ? this._now - s * 1000 : -Infinity; return items.filter(i => i.timestamp >= c); },
    getLastInterviewerTurn() { for (let i = items.length - 1; i >= 0; i--) if (items[i].role === 'interviewer') return items[i].text; return null; },
  };
}

// Median of N runs to avoid first-call JIT noise.
function medianMs(fn, runs = 9) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe('PHASE7 — LiveTranscriptBrain latency budgets', () => {
  const brain = new LiveTranscriptBrain(bigSession(), extractLatestQuestion);

  test('getLiveWindow lookup well under budget (<30ms target, 300ms ceiling)', () => {
    const ms = medianMs(() => brain.getLiveWindow(180));
    assert.ok(ms < 300, `getLiveWindow median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getRollingSummary lookup well under budget', () => {
    const ms = medianMs(() => brain.getRollingSummary(180));
    assert.ok(ms < 300, `getRollingSummary median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getCurrentQuestion extraction under budget', () => {
    const ms = medianMs(() => brain.getCurrentQuestion(180));
    assert.ok(ms < 300, `getCurrentQuestion median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getLiveAnswerContext full assembly under the 250ms live budget (1000ms ceiling)', () => {
    const ms = medianMs(() => brain.getLiveAnswerContext(180));
    assert.ok(ms < 1000, `getLiveAnswerContext median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getDurableWindow over the whole session stays bounded', () => {
    const ms = medianMs(() => brain.getDurableWindow(7200));
    assert.ok(ms < 500, `getDurableWindow median ${ms.toFixed(2)}ms exceeded ceiling`);
  });
});
