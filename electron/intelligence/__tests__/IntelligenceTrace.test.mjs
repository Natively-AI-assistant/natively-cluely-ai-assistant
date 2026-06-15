// node:test — IntelligenceTrace (observe-only structured per-answer record).
// Validates: zero-cost no-op when off; structured record + inclusion report when on;
// privacy (no raw query stored); never throws.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginTrace,
  commitTrace,
  recentTraces,
  __resetTraceRing,
} from '../../../dist-electron/electron/intelligence/IntelligenceTrace.js';
import { __resetIntelligenceFlagsCache } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

function enableTrace(on) {
  if (on) process.env.NATIVELY_INTELLIGENCE_TRACE = '1';
  else delete process.env.NATIVELY_INTELLIGENCE_TRACE;
  __resetIntelligenceFlagsCache();
}

describe('IntelligenceTrace', () => {
  beforeEach(() => { __resetTraceRing(); });
  afterEach(() => { enableTrace(false); __resetTraceRing(); });

  test('returns a zero-cost NO-OP when the flag is OFF', () => {
    enableTrace(false);
    const t = beginTrace('what is my name?');
    assert.equal(t.enabled, false);
    // No-op methods are chainable and record nothing.
    t.setRouting({ answerType: 'identity_answer' }).noteContext({ source: 'profile_tree', requested: true, retrieved: true, included: true });
    assert.equal(t.toRecord(), null);
    commitTrace(t);
    assert.equal(recentTraces().length, 0);
  });

  test('records a structured per-answer record when ON', () => {
    enableTrace(true);
    const t = beginTrace('introduce yourself');
    assert.equal(t.enabled, true);
    t.setRouting({ mode: 'technical-interview', source: 'manual_input', answerType: 'identity_answer', answerContract: 'interview_short', routerDecision: { useProfileTree: true, useHybridRag: false, maxLatencyMs: 1200 } });
    t.noteContext({ source: 'profile_tree', trustLevel: 'high', requested: true, retrieved: true, included: true, reason: 'identity', tokenEstimate: 40 });
    t.noteContext({ source: 'hybrid_rag', trustLevel: 'medium', requested: false, retrieved: false, included: false, reason: 'not_needed' });
    t.stage('routing', 2).setProvider({ provider: 'gemini', model: 'flash-lite' }).setLatency({ firstUsefulMs: 550, totalMs: 1100 });
    const rec = t.toRecord();
    assert.ok(rec);
    assert.equal(rec.answerType, 'identity_answer');
    assert.equal(rec.answerContract, 'interview_short');
    assert.equal(rec.mode, 'technical-interview');
    assert.equal(rec.contextInclusion.length, 2);
    assert.equal(rec.contextInclusion[0].source, 'profile_tree');
    assert.equal(rec.contextInclusion[0].included, true);
    assert.equal(rec.contextInclusion[1].included, false);
    assert.equal(rec.firstUsefulMs, 550);
    assert.equal(rec.provider, 'gemini');
    assert.equal(rec.routerDecision.useProfileTree, true);
  });

  test('records profile-routing diagnostic markers (Phase 3 bug-prevention fields)', () => {
    enableTrace(true);
    const t = beginTrace('what is my name?');
    t.setRouting({
      answerType: 'identity_answer',
      deterministicFastPathUsed: true,
      profileFactsReady: true,
      promptContainsProfileContext: true,
    });
    const rec = t.toRecord();
    assert.equal(rec.deterministicFastPathUsed, true);
    assert.equal(rec.profileFactsReady, true);
    assert.equal(rec.promptContainsProfileContext, true);
  });

  test('privacy: stores a query HASH, never the raw query text', () => {
    enableTrace(true);
    const secret = 'my salary is 250000 and my SSN is 123-45-6789';
    const t = beginTrace(secret);
    const rec = t.toRecord();
    const serialized = JSON.stringify(rec);
    assert.ok(!serialized.includes('250000'), 'must not store raw salary');
    assert.ok(!serialized.includes('123-45-6789'), 'must not store raw SSN');
    assert.equal(rec.queryHash.length, 12);
    assert.equal(rec.queryLength, secret.length);
  });

  test('commit buffers records for dev inspection; ring is bounded', () => {
    enableTrace(true);
    for (let i = 0; i < 5; i++) {
      const t = beginTrace(`q${i}`);
      t.setRouting({ answerType: 'general_meeting_answer' });
      commitTrace(t);
    }
    assert.equal(recentTraces().length, 5);
    assert.equal(recentTraces(2).length, 2);
  });

  test('never throws on malformed input', () => {
    enableTrace(true);
    const t = beginTrace(undefined);
    assert.doesNotThrow(() => {
      t.setRouting({ routerDecision: { nested: { bad: 1 } } });
      t.noteContext({ source: '<<<bad label>>>', requested: true, retrieved: true, included: true });
      t.stage('', NaN);
      t.noteFallback('x'.repeat(200));
      t.toRecord();
    });
  });
});
