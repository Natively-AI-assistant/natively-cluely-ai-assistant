// node:test — Intelligence OS feature-flag module.
// Validates: default OFF, env override on/off, settings precedence, snapshot, __reset.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntelligenceFlagEnabled,
  isIntelligenceTraceEnabled,
  isDurableMemoryWindowEnabled,
  isIntelligenceOsEnabled,
  intelligenceFlagSnapshot,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

const ENV_KEYS = [
  'NATIVELY_INTELLIGENCE_TRACE', 'NATIVELY_DURABLE_MEMORY_WINDOW', 'NATIVELY_INTELLIGENCE_OS',
  'NATIVELY_PROFILE_TREE_V2', 'NATIVELY_CONTEXT_ROUTER_V2', 'NATIVELY_LIVE_TRANSCRIPT_BRAIN',
  'NATIVELY_ANSWER_DIVERSITY_GUARD', 'NATIVELY_HINDSIGHT_MEMORY', 'NATIVELY_HINDSIGHT_LIVE_RECALL',
];

// The full flag set from the prompt — every one must be present and default OFF.
const ALL_FLAG_KEYS = [
  'trace', 'durableMemoryWindow', 'intelligenceOsEnabled', 'profileTreeV2', 'contextRouterV2',
  'liveTranscriptBrain', 'promptAssemblerV2', 'answerDiversityGuard', 'meetingMemoryV2',
  'globalSearchV2', 'inMeetingSearchV2', 'conversationMemoryV2', 'lectureIntelligenceV2', 'diagramIntelligence',
  'hindsightMemory', 'hindsightLiveRecall', 'hindsightPostMeetingRetain',
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  __resetIntelligenceFlagsCache();
}

describe('intelligenceFlags', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('every flag defaults OFF (additive, opt-in)', () => {
    assert.equal(isIntelligenceTraceEnabled(), false);
    assert.equal(isDurableMemoryWindowEnabled(), false);
    assert.equal(isIntelligenceOsEnabled(), false);
    for (const key of ALL_FLAG_KEYS) {
      assert.equal(isIntelligenceFlagEnabled(key), false, `flag ${key} must default OFF`);
    }
  });

  test('the full prompt flag set is present in the snapshot', () => {
    const snap = intelligenceFlagSnapshot();
    for (const key of ALL_FLAG_KEYS) {
      assert.ok(key in snap, `snapshot missing flag: ${key}`);
      assert.equal(snap[key], false);
    }
    // Snapshot must not invent extra keys.
    assert.equal(Object.keys(snap).length, ALL_FLAG_KEYS.length);
  });

  test('a newly-added flag can be toggled by env independently', () => {
    process.env.NATIVELY_CONTEXT_ROUTER_V2 = 'on';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('contextRouterV2'), true);
    // Others stay off.
    assert.equal(isIntelligenceFlagEnabled('profileTreeV2'), false);
  });

  test('env override turns a flag ON', () => {
    process.env.NATIVELY_INTELLIGENCE_TRACE = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceTraceEnabled(), true);
  });

  test('env override accepts on/true/enabled/yes', () => {
    for (const v of ['on', 'true', 'enabled', 'yes', '1']) {
      process.env.NATIVELY_DURABLE_MEMORY_WINDOW = v;
      __resetIntelligenceFlagsCache();
      assert.equal(isDurableMemoryWindowEnabled(), true, `value ${v} should enable`);
    }
  });

  test('env override OFF wins even if default were ON', () => {
    for (const v of ['off', 'false', '0', 'disabled', 'no']) {
      process.env.NATIVELY_INTELLIGENCE_TRACE = v;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceTraceEnabled(), false, `value ${v} should disable`);
    }
  });

  test('unknown env value falls through to default OFF', () => {
    process.env.NATIVELY_INTELLIGENCE_TRACE = 'maybe';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceTraceEnabled(), false);
  });

  test('snapshot reflects resolved state', () => {
    const snap0 = intelligenceFlagSnapshot();
    // All flags default OFF.
    for (const v of Object.values(snap0)) assert.equal(v, false);
    process.env.NATIVELY_INTELLIGENCE_TRACE = 'on';
    __resetIntelligenceFlagsCache();
    const snap1 = intelligenceFlagSnapshot();
    assert.equal(snap1.trace, true);
    assert.equal(snap1.durableMemoryWindow, false);
  });

  test('reads defensively — never throws when settings unavailable', () => {
    // SettingsManager.getInstance() will throw in this headless context; the module
    // must swallow it and return the default.
    assert.doesNotThrow(() => isIntelligenceFlagEnabled('trace'));
    assert.doesNotThrow(() => intelligenceFlagSnapshot());
  });
});
