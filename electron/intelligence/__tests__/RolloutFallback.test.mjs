// PHASE 19 — Rollout + backward compatibility. Verifies every feature flag defaults
// OFF (old behavior preserved), can be enabled independently, and the memory provider
// falls back to Noop when its flag is off — the app works in both states.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntelligenceFlagEnabled,
  intelligenceFlagSnapshot,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { LongTermMemoryService } from '../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js';

const DEFAULT_ON_KEYS = new Set([
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingSummaryLlmPolish',
  // Safety isolation gates default ON. okf*/okfProfile* dev/test-default flags
  // resolve to isInternalDevTestContext() = FALSE under this bare node harness.
  'docGroundedStrictIsolation',
  'docGroundedFalseRefusalRepair',
  // Full-JIT final-answer law — unconditionally `true` everywhere (the intended
  // production policy, not a dev/test-only experiment), restored 2026-07-14
  // after the 2026-07-09 stability rollback was resolved.
  'jitFinalAnswerEnforced',
]);

const expectedDefault = (key) => DEFAULT_ON_KEYS.has(key) ? true : false;

const FLAG_ENV = {
  intelligenceOsEnabled: 'NATIVELY_INTELLIGENCE_OS',
  profileTreeV2: 'NATIVELY_PROFILE_TREE_V2',
  contextRouterV2: 'NATIVELY_CONTEXT_ROUTER_V2',
  liveTranscriptBrain: 'NATIVELY_LIVE_TRANSCRIPT_BRAIN',
  promptAssemblerV2: 'NATIVELY_PROMPT_ASSEMBLER_V2',
  answerDiversityGuard: 'NATIVELY_ANSWER_DIVERSITY_GUARD',
  meetingMemoryV2: 'NATIVELY_MEETING_MEMORY_V2',
  globalSearchV2: 'NATIVELY_GLOBAL_SEARCH_V2',
  inMeetingSearchV2: 'NATIVELY_IN_MEETING_SEARCH_V2',
  lectureIntelligenceV2: 'NATIVELY_LECTURE_INTELLIGENCE_V2',
  diagramIntelligence: 'NATIVELY_DIAGRAM_INTELLIGENCE',
  hindsightMemory: 'NATIVELY_HINDSIGHT_MEMORY',
  hindsightLiveRecall: 'NATIVELY_HINDSIGHT_LIVE_RECALL',
  hindsightPostMeetingRetain: 'NATIVELY_HINDSIGHT_POST_MEETING_RETAIN',
  trace: 'NATIVELY_INTELLIGENCE_TRACE',
  durableMemoryWindow: 'NATIVELY_DURABLE_MEMORY_WINDOW',
};

const EXTRA_FLAG_ENV = [
  'NATIVELY_MEETING_SUMMARY_V3',
  'NATIVELY_MEETING_MODE_AUTODETECT',
  'NATIVELY_FOLLOWUP_DRAFT_V2',
  'NATIVELY_SPEAKER_LABELS_V1',
  'NATIVELY_MEETING_NOTES_STRUCTURED_OUTPUT',
  'NATIVELY_MEETING_SUMMARY_LLM_POLISH',
  'NATIVELY_SPEAKER_DIARIZATION_V1',
  'NATIVELY_RAG_CONFIDENCE_GATE', 'NATIVELY_RAG_LOCAL_RERANK', 'NATIVELY_RAG_RRF_FUSION', 'NATIVELY_RAG_SPECULATIVE_RERANK',
  'NATIVELY_OKF_KNOWLEDGE_PACKS', 'NATIVELY_OKF_MARKDOWN_EXPORT', 'NATIVELY_OKF_HYBRID_RETRIEVAL',
  'NATIVELY_OKF_GRAPH_EXPANSION', 'NATIVELY_OKF_KNOWLEDGE_UI', 'NATIVELY_OKF_USER_EDITABLE_CARDS',
  'NATIVELY_OKF_PROFILE_PACKS', 'NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL', 'NATIVELY_OKF_PROFILE_MARKDOWN_EXPORT',
  'NATIVELY_OKF_PROFILE_GRAPH_EXPANSION', 'NATIVELY_OKF_PROFILE_KNOWLEDGE_UI',
  'NATIVELY_DOC_GROUNDED_STRICT_ISOLATION', 'NATIVELY_DOC_GROUNDED_FALSE_REFUSAL_REPAIR',
  'NATIVELY_JIT_FINAL_ANSWER_ENFORCED',
];

function clearAll() {
  for (const env of [...Object.values(FLAG_ENV), ...EXTRA_FLAG_ENV]) delete process.env[env];
  __resetIntelligenceFlagsCache();
}

describe('Rollout — disabled mode (default = old behavior)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test('all rollout flags resolve to their documented defaults', () => {
    const snap = intelligenceFlagSnapshot();
    for (const [key, val] of Object.entries(snap)) {
      assert.equal(val, expectedDefault(key), `flag ${key} default mismatch`);
    }
  });

  test('LongTermMemoryService.fromFlags is Noop when hindsight_memory is OFF', () => {
    const svc = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: 'http://localhost:8888' } });
    assert.equal(svc.enabled, false);
    assert.equal(svc.providerName, 'noop');
  });
});

describe('Rollout — enabled mode (per-flag, independent)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test('each flag can be enabled independently via env without affecting others', () => {
    for (const [key, env] of Object.entries(FLAG_ENV)) {
      clearAll();
      process.env[env] = 'on';
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceFlagEnabled(key), true, `${key} should enable via ${env}`);
      // No sibling leaked on.
      const others = Object.keys(FLAG_ENV).filter((k) => k !== key);
      for (const o of others) assert.equal(isIntelligenceFlagEnabled(o), false, `${o} leaked on when only ${key} set`);
    }
  });

  test('the recommended rollout order is all independently gated (no hard coupling)', () => {
    // Enable the first few in the spec's recommended order; later ones stay off.
    process.env.NATIVELY_INTELLIGENCE_TRACE = 'on';
    process.env.NATIVELY_PROFILE_TREE_V2 = 'on';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('trace'), true);
    assert.equal(isIntelligenceFlagEnabled('profileTreeV2'), true);
    assert.equal(isIntelligenceFlagEnabled('hindsightLiveRecall'), false, 'last-to-enable stays off');
  });
});

describe('Rollout — instant rollback', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test('an explicit OFF overrides everything (instant kill)', () => {
    process.env.NATIVELY_DIAGRAM_INTELLIGENCE = 'off';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('diagramIntelligence'), false);
  });
});
