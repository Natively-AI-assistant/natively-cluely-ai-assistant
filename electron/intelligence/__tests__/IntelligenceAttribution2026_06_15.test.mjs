// electron/intelligence/__tests__/IntelligenceAttribution2026_06_15.test.mjs
//
// Phase 3 (task 2026-06-15): the per-answer attribution record. Proves the schema is
// complete, defaults are safe, privacy holds (no raw content — query HASH only), the
// honest Hindsight-mode classification is correct, and the bounded ring works.

import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';
import {
  buildAttribution,
  recordAttribution,
  recentAttributions,
  lastAttribution,
  resetAttributions,
  hindsightModeFor,
} from '../../../dist-electron/electron/intelligence/IntelligenceAttribution.js';

describe('buildAttribution — schema + safe defaults', () => {
  test('an empty input yields a complete record with safe defaults', () => {
    const a = buildAttribution({});
    // A representative spread of required fields exists with the right default types.
    assert.equal(typeof a.trace_id, 'string');
    assert.equal(a.query_hash, 'none');
    assert.equal(a.profile_tree_used, false);
    assert.equal(a.hybrid_rag_node_count, 0);
    assert.equal(a.context_router_mode, 'off');
    assert.equal(a.hindsight_mode, 'disabled');
    assert.equal(a.coding_explicit_contract, 'none');
  });

  test('counts and layer modes are sanitized', () => {
    const a = buildAttribution({ hybrid_rag_node_count: -5, conversation_memory_turns_used: 3.9, context_router_mode: 'bogus' });
    assert.equal(a.hybrid_rag_node_count, 0); // negative → 0
    assert.equal(a.conversation_memory_turns_used, 3); // floored
    assert.equal(a.context_router_mode, 'off'); // invalid enum → off
  });
});

describe('privacy — the raw question is hashed, never stored', () => {
  test('query_hash is a 12-char hex prefix and the raw text never appears anywhere', () => {
    const secret = 'My salary is 240k and my SSN is 123-45-6789';
    const a = buildAttribution({ question: secret });
    assert.match(a.query_hash, /^[0-9a-f]{12}$/);
    const blob = JSON.stringify(a);
    assert.doesNotMatch(blob, /salary|240k|123-45-6789/i);
  });

  test('same question → same hash (stable), different question → different hash', () => {
    const a = buildAttribution({ question: 'what is your name' }).query_hash;
    const b = buildAttribution({ question: 'what is your name' }).query_hash;
    const c = buildAttribution({ question: 'what are your skills' }).query_hash;
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe('hindsightModeFor — honest classification (hard rules 9-12)', () => {
  test('disabled when the memory flag is off', () => {
    assert.equal(hindsightModeFor({ memoryFlagOn: false, configured: true, available: true }), 'disabled');
  });
  test('not_configured when on but no server configured', () => {
    assert.equal(hindsightModeFor({ memoryFlagOn: true, configured: false }), 'not_configured');
  });
  test('noop when configured but unreachable', () => {
    assert.equal(hindsightModeFor({ memoryFlagOn: true, configured: true, available: false }), 'noop');
  });
  test('real only when configured AND available', () => {
    assert.equal(hindsightModeFor({ memoryFlagOn: true, configured: true, available: true }), 'real');
  });
  test('error short-circuits everything', () => {
    assert.equal(hindsightModeFor({ memoryFlagOn: true, configured: true, available: true, errored: true }), 'error');
  });
});

describe('recordAttribution — bounded ring', () => {
  beforeEach(() => resetAttributions());

  test('records are retrievable and ordered most-recent-last', () => {
    recordAttribution({ answer_type: 'identity_answer', profile_tree_fast_path_used: true });
    recordAttribution({ answer_type: 'dsa_question_answer', coding_explicit_contract: 'code_only' });
    const recent = recentAttributions(10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].answer_type, 'identity_answer');
    assert.equal(recent[1].coding_explicit_contract, 'code_only');
    assert.equal(lastAttribution().answer_type, 'dsa_question_answer');
  });

  test('the ring is bounded (does not grow without limit)', () => {
    for (let i = 0; i < 500; i++) recordAttribution({ answer_type: 'x' });
    assert.ok(recentAttributions(1000).length <= 200, 'ring bounded to <=200');
  });

  test('never throws on malformed input', () => {
    assert.doesNotThrow(() => recordAttribution(undefined));
    assert.doesNotThrow(() => recordAttribution({ hybrid_rag_node_count: NaN }));
  });
});
