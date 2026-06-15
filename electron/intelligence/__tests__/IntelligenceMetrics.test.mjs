// PHASE 17 — Intelligence metrics registry: timers, counters, rates, gauges, snapshot.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { intelligenceMetrics, timed } from '../../../dist-electron/electron/intelligence/IntelligenceMetrics.js';

describe('IntelligenceMetrics', () => {
  beforeEach(() => intelligenceMetrics.reset());

  test('timers compute count/min/max/p50/p95', () => {
    for (let i = 1; i <= 100; i++) intelligenceMetrics.timing('answer_total_ms', i);
    const s = intelligenceMetrics.timer('answer_total_ms');
    assert.equal(s.count, 100);
    assert.equal(s.min, 1);
    assert.equal(s.max, 100);
    assert.ok(s.p50 >= 49 && s.p50 <= 52);
    assert.ok(s.p95 >= 94 && s.p95 <= 96);
  });

  test('counters increment', () => {
    intelligenceMetrics.count('cross_user_leakage_detected_count');
    intelligenceMetrics.count('cross_user_leakage_detected_count', 2);
    assert.equal(intelligenceMetrics.counter('cross_user_leakage_detected_count'), 3);
  });

  test('rates track hit/total', () => {
    intelligenceMetrics.rate('identity_fast_path_hit_rate', true);
    intelligenceMetrics.rate('identity_fast_path_hit_rate', true);
    intelligenceMetrics.rate('identity_fast_path_hit_rate', false);
    const r = intelligenceMetrics.rateOf('identity_fast_path_hit_rate');
    assert.equal(r.hits, 2);
    assert.equal(r.total, 3);
    assert.ok(Math.abs(r.rate - 2 / 3) < 1e-9);
  });

  test('gauges hold the latest value', () => {
    intelligenceMetrics.gauge('hindsight_retain_queue_depth', 5);
    intelligenceMetrics.gauge('hindsight_retain_queue_depth', 2);
    assert.equal(intelligenceMetrics.gaugeOf('hindsight_retain_queue_depth'), 2);
  });

  test('snapshot includes all metric families with no raw content', () => {
    intelligenceMetrics.timing('prompt_assembly_ms', 10);
    intelligenceMetrics.count('context_blocks_dropped_count');
    intelligenceMetrics.rate('rag_empty_result_rate', false);
    intelligenceMetrics.gauge('background_queue_depth', 3);
    const snap = intelligenceMetrics.snapshot();
    assert.ok('timers' in snap && 'counters' in snap && 'rates' in snap && 'gauges' in snap);
    // numbers only — serialized snapshot must contain no obvious PII
    const str = JSON.stringify(snap);
    assert.doesNotMatch(str, /@|resume|salary/i);
  });

  test('timed() records and returns the fn result', () => {
    const r = timed('diagram_generation_ms', () => 42);
    assert.equal(r, 42);
    assert.equal(intelligenceMetrics.timer('diagram_generation_ms').count, 1);
  });

  test('never throws on bad input', () => {
    assert.doesNotThrow(() => {
      intelligenceMetrics.timing('answer_total_ms', NaN);
      intelligenceMetrics.gauge('background_queue_depth', Infinity);
    });
  });
});
