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
  'NATIVELY_PROMPT_ASSEMBLER_V2', 'NATIVELY_ANSWER_DIVERSITY_GUARD', 'NATIVELY_MEETING_MEMORY_V2',
  'NATIVELY_MEETING_SUMMARY_V3', 'NATIVELY_MEETING_MODE_AUTODETECT', 'NATIVELY_FOLLOWUP_DRAFT_V2',
  'NATIVELY_SPEAKER_LABELS_V1', 'NATIVELY_MEETING_NOTES_STRUCTURED_OUTPUT',
  'NATIVELY_MEETING_SUMMARY_LLM_POLISH', 'NATIVELY_SPEAKER_DIARIZATION_V1',
  'NATIVELY_GLOBAL_SEARCH_V2', 'NATIVELY_IN_MEETING_SEARCH_V2', 'NATIVELY_CONVERSATION_MEMORY_V2',
  'NATIVELY_LECTURE_INTELLIGENCE_V2', 'NATIVELY_DIAGRAM_INTELLIGENCE', 'NATIVELY_HINDSIGHT_MEMORY',
  'NATIVELY_HINDSIGHT_LIVE_RECALL', 'NATIVELY_HINDSIGHT_POST_MEETING_RETAIN',
  'NATIVELY_RAG_CONFIDENCE_GATE', 'NATIVELY_RAG_LOCAL_RERANK', 'NATIVELY_RAG_RRF_FUSION', 'NATIVELY_RAG_SPECULATIVE_RERANK',
  'NATIVELY_OKF_KNOWLEDGE_PACKS', 'NATIVELY_OKF_MARKDOWN_EXPORT', 'NATIVELY_OKF_HYBRID_RETRIEVAL',
  'NATIVELY_OKF_GRAPH_EXPANSION', 'NATIVELY_OKF_KNOWLEDGE_UI', 'NATIVELY_OKF_USER_EDITABLE_CARDS',
  'NATIVELY_OKF_PROFILE_PACKS', 'NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL', 'NATIVELY_OKF_PROFILE_MARKDOWN_EXPORT',
  'NATIVELY_OKF_PROFILE_GRAPH_EXPANSION', 'NATIVELY_OKF_PROFILE_KNOWLEDGE_UI',
  'NATIVELY_DOC_GROUNDED_STRICT_ISOLATION', 'NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT',
  'NATIVELY_DOC_GROUNDED_FALSE_REFUSAL_REPAIR', 'NATIVELY_JIT_FINAL_ANSWER_ENFORCED',
  'NATIVELY_CONTEXT_OS', 'NATIVELY_CONTEXT_OS_MANUAL_CHAT', 'NATIVELY_CONTEXT_OS_WTA',
  'NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP', 'NATIVELY_CONTEXT_OS_EVIDENCE_PACK',
  'NATIVELY_CONTEXT_OS_MEMORY_SAFETY', 'NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES',
  'NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION', 'NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE',
  // Pre-existing gap closed 2026-07-25 (found while adding NATIVELY_TURN_IDENTITY_V2
  // below): NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE was added to intelligenceFlags.ts's
  // FLAGS registry but never added here, so this test's own length-parity assertion
  // was already red at HEAD (53 !== 52, confirmed via git stash) before this change.
  'NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE',
  'NATIVELY_TURN_IDENTITY_V2',
  'NATIVELY_PROMPT_COMPOSER_V2',
  'NATIVELY_CANONICAL_TURN_MANUAL_CHAT',
  'NATIVELY_ATOMIC_JD_PROFILE_PACK',
  'NATIVELY_ASSISTANT_CLAIMS_ENFORCEMENT',
  'NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION',
  'NATIVELY_MODE_POLICY_SHADOW_OBSERVATION',
];

// The full flag set — Meeting Notes V3 product flags intentionally ship default ON;
// the rest remain additive/opt-in default OFF.
const ALL_FLAG_KEYS = [
  'trace', 'durableMemoryWindow', 'intelligenceOsEnabled', 'profileTreeV2', 'contextRouterV2',
  'liveTranscriptBrain', 'promptAssemblerV2', 'answerDiversityGuard', 'meetingMemoryV2',
  'meetingSummaryV3', 'meetingModeAutoDetect', 'followUpDraftV2', 'speakerLabelsV1',
  'meetingNotesStructuredOutput', 'meetingSummaryLlmPolish', 'speakerDiarizationV1',
  'globalSearchV2', 'inMeetingSearchV2', 'conversationMemoryV2', 'lectureIntelligenceV2', 'diagramIntelligence',
  'hindsightMemory', 'hindsightLiveRecall', 'hindsightPostMeetingRetain',
  'ragConfidenceGate', 'ragLocalRerank', 'ragRrfFusion', 'ragSpeculativeRerank',
  'okfKnowledgePacks', 'okfMarkdownExport', 'okfHybridRetrieval', 'okfGraphExpansion',
  'okfKnowledgeUi', 'okfUserEditableCards',
  'okfProfilePacks', 'okfProfileHybridRetrieval', 'okfProfileMarkdownExport',
  'okfProfileGraphExpansion', 'okfProfileKnowledgeUi',
  'docGroundedStrictIsolation', 'customModeSourceEnforcement', 'docGroundedFalseRefusalRepair',
  'jitFinalAnswerEnforced',
  // Context OS / Source Authority Kernel (2026-07-10). The first six were
  // promoted from isInternalDevTestContext() to unconditional `true`
  // (2026-07-18, grounding campaign — see DEFAULT_ON_KEYS below); the
  // remaining enforcement/property-validation/multi-family flags still
  // default to isInternalDevTestContext() (FALSE under this bare node harness).
  'contextOsEnabled', 'contextOsManualChatEnabled', 'contextOsWtaEnabled',
  'contextOsRecapFollowupEnabled', 'contextOsEvidencePackEnabled', 'contextOsMemorySafetyEnabled',
  'contextOsEnforceSourceCapabilities', 'contextOsPropertyValidation',
  'contextOsMultiFamilyEvidenceEnabled',
  // Pre-existing gap closed 2026-07-25 (see the matching ENV_KEYS comment above).
  'answerRelevanceGuardLive',
  // Phase 6 Slice 1 (context-rebuild, 2026-07-25) — dev/test-only like the
  // ragConfidenceGate/okfKnowledgePacks precedent above; resolves to
  // isInternalDevTestContext() = FALSE under this bare node harness.
  'turnIdentityV2',
  // Phase 6 Slice 2 (context-rebuild, 2026-07-25) — dev/test-only, same pattern.
  'promptComposerV2',
  // Phase 6 Slice 3 (context-rebuild, 2026-07-25) — dev/test-only, same pattern.
  'canonicalTurnManualChat',
  // Phase 6 Slice 5 (context-rebuild, 2026-07-25) — dev/test-only, same pattern.
  'atomicJdProfilePackGeneration',
  // Phase 6 Slice 7 (context-rebuild, 2026-07-25) — dev/test-only, same pattern.
  'assistantClaimsEnforcement',
  // Phase 6 Slice 4 item 2 follow-up (context-rebuild, 2026-07-26) — dev/test-only, same pattern.
  'pronounRegexShadowObservation',
  // Phase 6 Slice 7 follow-up (context-rebuild, 2026-07-26) — dev/test-only, same pattern.
  'modePolicyShadowObservation',
];

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
  // Context OS core pipeline — promoted from dev/test-only to unconditional
  // production default-ON (2026-07-18, grounding campaign) after live
  // verification (H4/NEW-3/THESIS-091/C8 traces, real MiniMax-M3, real
  // documents). contextOsEnforceSourceCapabilities/contextOsPropertyValidation/
  // contextOsMultiFamilyEvidenceEnabled are SEPARATE stricter flags not
  // covered by this promotion — they stay dev/test-only (isInternalDevTestContext).
  'contextOsEnabled',
  'contextOsManualChatEnabled',
  'contextOsWtaEnabled',
  'contextOsRecapFollowupEnabled',
  'contextOsEvidencePackEnabled',
  'contextOsMemorySafetyEnabled',
]);

const expectedDefault = (key) => DEFAULT_ON_KEYS.has(key) ? true : false;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  __resetIntelligenceFlagsCache();
}

describe('intelligenceFlags', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('every flag resolves to its documented default', () => {
    assert.equal(isIntelligenceTraceEnabled(), false);
    assert.equal(isDurableMemoryWindowEnabled(), false);
    assert.equal(isIntelligenceOsEnabled(), false);
    for (const key of ALL_FLAG_KEYS) {
      assert.equal(isIntelligenceFlagEnabled(key), expectedDefault(key), `flag ${key} default mismatch`);
    }
  });

  test('the full prompt flag set is present in the snapshot', () => {
    const snap = intelligenceFlagSnapshot();
    for (const key of ALL_FLAG_KEYS) {
      assert.ok(key in snap, `snapshot missing flag: ${key}`);
      assert.equal(snap[key], expectedDefault(key));
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
    for (const [key, val] of Object.entries(snap0)) assert.equal(val, expectedDefault(key));
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
