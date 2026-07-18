// node:test — Phase 14 live-wiring verification: the Intelligence-OS feature-flag
// settings contract (intelligenceFlagKeys / intelligenceFlagMeta / setIntelligenceFlag)
// that backs the dev/experimental flag toggle IPC (`intelligence-flags:get|set`).
// Meeting Notes V3 flags intentionally ship with product defaults ON; all other
// Intelligence OS rollout flags keep their conservative default-OFF posture.
//
// WHAT PHASE 14 SHIPS: a backend contract so a flag can be toggled by PERSISTING its
// SettingsManager key — no env edit / redeploy needed. The flags already resolve in the
// precedence: env override (NATIVELY_*) → SettingsManager.get(<settingKey>) → default(false).
// This test pins the parts of that contract that are EXECUTABLE headless (under plain
// node:test, no Electron) and is explicit about the one part that is NOT.
//
// ───────────────────────────────────────────────────────────────────────────────────
// EXECUTABLE HEADLESS (proven by this test against the REAL compiled module):
//   • intelligenceFlagKeys()  — returns the full, expected key set.
//   • intelligenceFlagMeta()  — returns {setting, env, default:false} per flag.
//   • setIntelligenceFlag()   — DEFENSIVE: returns false (never throws) when
//                               SettingsManager is unavailable (headless), because its
//                               constructor calls Electron's app.isReady().
//   • the ENV-OVERRIDE resolution chain — set NATIVELY_*=1 → enabled true; unset → false.
//     This is the PRIMARY mechanism the resolution chain shares with the settings path.
//
// READ-VERIFIED ONLY (NOT executable here — documented, not asserted):
//   • The SettingsManager PERSISTENCE precedence (set('intelligenceTraceEnabled', true)
//     → get(...) === true → isIntelligenceFlagEnabled('trace') === true when no env
//     override). This requires the Electron runtime: esbuild INLINED SettingsManager into
//     the flags bundle (init_SettingsManager → require("electron")), and headless
//     require('electron') returns a path STRING whose `.app` is undefined, so
//     SettingsManager.getInstance() throws in its constructor (app.isReady()). There is no
//     module boundary to stub (the dependency is inlined, not a separate require target),
//     so this path is verified by READING the source, not executed here. See the
//     SOURCE-EVIDENCE block at the bottom of this file for the exact chain + file:line.
// ───────────────────────────────────────────────────────────────────────────────────

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  intelligenceFlagKeys,
  intelligenceFlagMeta,
  setIntelligenceFlag,
  isIntelligenceFlagEnabled,
  isIntelligenceTraceEnabled,
  intelligenceFlagSnapshot,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

// Every flag key the rollout (and the IPC contract) depends on. If a flag is added/renamed
// without intent this list forces an explicit update — it pins the public surface the
// settings UI enumerates.
const EXPECTED_KEYS = [
  'trace',
  'durableMemoryWindow',
  'intelligenceOsEnabled',
  'profileTreeV2',
  'contextRouterV2',
  'liveTranscriptBrain',
  'promptAssemblerV2',
  'answerDiversityGuard',
  'meetingMemoryV2',
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingNotesStructuredOutput',
  'meetingSummaryLlmPolish',
  'speakerDiarizationV1',
  'globalSearchV2',
  'inMeetingSearchV2',
  'conversationMemoryV2',
  'lectureIntelligenceV2',
  'diagramIntelligence',
  'hindsightMemory',
  'hindsightLiveRecall',
  'hindsightPostMeetingRetain',
  'ragConfidenceGate',
  'ragLocalRerank',
  'ragRrfFusion',
  'ragSpeculativeRerank',
  // OKF document knowledge system flags.
  'okfKnowledgePacks',
  'okfMarkdownExport',
  'okfHybridRetrieval',
  'okfGraphExpansion',
  'okfKnowledgeUi',
  'okfUserEditableCards',
  // OKF Profile Intelligence upgrade flags (2026-07-02).
  'okfProfilePacks',
  'okfProfileHybridRetrieval',
  'okfProfileMarkdownExport',
  'okfProfileGraphExpansion',
  'okfProfileKnowledgeUi',
  // Document-grounded safety isolation gates.
  'docGroundedStrictIsolation',
  'docGroundedFalseRefusalRepair',
  // Custom-Mode Source Isolation (2026-07-06).
  'customModeSourceEnforcement',
  // Full-JIT final-answer law (2026-07-07).
  'jitFinalAnswerEnforced',
  // Context OS / Source Authority Kernel (2026-07-10) — docs/context-os/.
  'contextOsEnabled',
  'contextOsManualChatEnabled',
  'contextOsWtaEnabled',
  'contextOsRecapFollowupEnabled',
  'contextOsEvidencePackEnabled',
  'contextOsMemorySafetyEnabled',
  'contextOsEnforceSourceCapabilities',
  'contextOsPropertyValidation',
];

// All NATIVELY_* env vars these flags read — cleared before/after so a leaked env from the
// host (or another test) can't make an assertion pass/fail spuriously.
const DEFAULT_ON_KEYS = new Set([
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingSummaryLlmPolish',
  // Safety isolation gates — ON everywhere by default. (The okf*/okfProfile* dev/
  // test-default flags resolve to isInternalDevTestContext(), which is FALSE when
  // NODE_ENV is unset as it is under this bare `node --test` harness, so they are
  // NOT default-ON here.)
  'docGroundedStrictIsolation',
  'docGroundedFalseRefusalRepair',
  // Full-JIT final-answer law — unconditionally `true` everywhere (the intended
  // production policy, not a dev/test-only experiment), restored 2026-07-14
  // after the 2026-07-09 stability rollback was resolved.
  'jitFinalAnswerEnforced',
]);

const ALL_ENV_VARS = [
  'NATIVELY_INTELLIGENCE_TRACE',
  'NATIVELY_DURABLE_MEMORY_WINDOW',
  'NATIVELY_INTELLIGENCE_OS',
  'NATIVELY_PROFILE_TREE_V2',
  'NATIVELY_CONTEXT_ROUTER_V2',
  'NATIVELY_LIVE_TRANSCRIPT_BRAIN',
  'NATIVELY_PROMPT_ASSEMBLER_V2',
  'NATIVELY_ANSWER_DIVERSITY_GUARD',
  'NATIVELY_MEETING_MEMORY_V2',
  'NATIVELY_MEETING_SUMMARY_V3',
  'NATIVELY_MEETING_MODE_AUTODETECT',
  'NATIVELY_FOLLOWUP_DRAFT_V2',
  'NATIVELY_SPEAKER_LABELS_V1',
  'NATIVELY_MEETING_NOTES_STRUCTURED_OUTPUT',
  'NATIVELY_MEETING_SUMMARY_LLM_POLISH',
  'NATIVELY_SPEAKER_DIARIZATION_V1',
  'NATIVELY_GLOBAL_SEARCH_V2',
  'NATIVELY_IN_MEETING_SEARCH_V2',
  'NATIVELY_CONVERSATION_MEMORY_V2',
  'NATIVELY_LECTURE_INTELLIGENCE_V2',
  'NATIVELY_DIAGRAM_INTELLIGENCE',
  'NATIVELY_HINDSIGHT_MEMORY',
  'NATIVELY_HINDSIGHT_LIVE_RECALL',
  'NATIVELY_HINDSIGHT_POST_MEETING_RETAIN',
  'NATIVELY_RAG_CONFIDENCE_GATE',
  'NATIVELY_RAG_LOCAL_RERANK',
  'NATIVELY_RAG_RRF_FUSION',
  'NATIVELY_RAG_SPECULATIVE_RERANK',
  'NATIVELY_OKF_KNOWLEDGE_PACKS',
  'NATIVELY_OKF_MARKDOWN_EXPORT',
  'NATIVELY_OKF_HYBRID_RETRIEVAL',
  'NATIVELY_OKF_GRAPH_EXPANSION',
  'NATIVELY_OKF_KNOWLEDGE_UI',
  'NATIVELY_OKF_USER_EDITABLE_CARDS',
  'NATIVELY_OKF_PROFILE_PACKS',
  'NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL',
  'NATIVELY_OKF_PROFILE_MARKDOWN_EXPORT',
  'NATIVELY_OKF_PROFILE_GRAPH_EXPANSION',
  'NATIVELY_OKF_PROFILE_KNOWLEDGE_UI',
  'NATIVELY_DOC_GROUNDED_STRICT_ISOLATION',
  'NATIVELY_DOC_GROUNDED_FALSE_REFUSAL_REPAIR',
  'NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT',
  'NATIVELY_JIT_FINAL_ANSWER_ENFORCED',
  'NATIVELY_CONTEXT_OS',
  'NATIVELY_CONTEXT_OS_MANUAL_CHAT',
  'NATIVELY_CONTEXT_OS_WTA',
  'NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP',
  'NATIVELY_CONTEXT_OS_EVIDENCE_PACK',
  'NATIVELY_CONTEXT_OS_MEMORY_SAFETY',
  'NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES',
  'NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION',
];

function clearAllEnv() {
  for (const v of ALL_ENV_VARS) delete process.env[v];
  __resetIntelligenceFlagsCache();
}

describe('Phase 14 — intelligence flag settings contract (key + meta surface)', () => {
  beforeEach(clearAllEnv);
  afterEach(clearAllEnv);

  test('intelligenceFlagKeys() returns the complete, expected flag set', () => {
    const keys = intelligenceFlagKeys();
    assert.ok(Array.isArray(keys), 'keys is an array');
    // Exact set equality (no extra, none missing) — sorted compare so order is irrelevant.
    assert.deepEqual([...keys].sort(), [...EXPECTED_KEYS].sort());
    // Spot-check the keys the task names explicitly.
    for (const k of ['trace', 'durableMemoryWindow', 'conversationMemoryV2',
                     'lectureIntelligenceV2', 'diagramIntelligence',
                     'hindsightMemory', 'hindsightLiveRecall', 'hindsightPostMeetingRetain']) {
      assert.ok(keys.includes(k), `expected key present: ${k}`);
    }
  });

  test('intelligenceFlagMeta(key) returns {setting, env, default:false} for every flag', () => {
    for (const key of intelligenceFlagKeys()) {
      const meta = intelligenceFlagMeta(key);
      assert.equal(typeof meta.setting, 'string', `${key}.setting is a string`);
      assert.ok(meta.setting.length > 0, `${key}.setting non-empty`);
      assert.ok(meta.env.startsWith('NATIVELY_'), `${key}.env follows NATIVELY_ convention (${meta.env})`);
      const expectedDefault = DEFAULT_ON_KEYS.has(key) ? true : false;
      assert.equal(meta.default, expectedDefault, `${key}.default matches documented rollout posture`);
    }
  });

  test('intelligenceFlagMeta exact values for several named flags', () => {
    assert.deepEqual(intelligenceFlagMeta('trace'),
      { setting: 'intelligenceTraceEnabled', env: 'NATIVELY_INTELLIGENCE_TRACE', default: false });
    assert.deepEqual(intelligenceFlagMeta('durableMemoryWindow'),
      { setting: 'intelligenceDurableMemoryWindow', env: 'NATIVELY_DURABLE_MEMORY_WINDOW', default: false });
    assert.deepEqual(intelligenceFlagMeta('conversationMemoryV2'),
      { setting: 'conversationMemoryV2Enabled', env: 'NATIVELY_CONVERSATION_MEMORY_V2', default: false });
    assert.deepEqual(intelligenceFlagMeta('lectureIntelligenceV2'),
      { setting: 'lectureIntelligenceV2Enabled', env: 'NATIVELY_LECTURE_INTELLIGENCE_V2', default: false });
    assert.deepEqual(intelligenceFlagMeta('diagramIntelligence'),
      { setting: 'diagramIntelligenceEnabled', env: 'NATIVELY_DIAGRAM_INTELLIGENCE', default: false });
    assert.deepEqual(intelligenceFlagMeta('hindsightMemory'),
      { setting: 'hindsightMemoryEnabled', env: 'NATIVELY_HINDSIGHT_MEMORY', default: false });
  });

  test('flag setting-keys are UNIQUE (no two flags share a SettingsManager key)', () => {
    // A shared setting key would mean toggling one flag silently toggles another — a real
    // footgun for a settings UI. Pin uniqueness.
    const settings = intelligenceFlagKeys().map((k) => intelligenceFlagMeta(k).setting);
    assert.equal(new Set(settings).size, settings.length, 'all setting keys unique');
    const envs = intelligenceFlagKeys().map((k) => intelligenceFlagMeta(k).env);
    assert.equal(new Set(envs).size, envs.length, 'all env vars unique');
  });
});

describe('Phase 14 — setIntelligenceFlag is DEFENSIVE headless (never throws)', () => {
  beforeEach(clearAllEnv);
  afterEach(clearAllEnv);

  test('setIntelligenceFlag(true) returns false (does NOT throw) when SettingsManager is unavailable', () => {
    // Headless: SettingsManager.getInstance() throws (app.isReady() on undefined app).
    // The contract is that setIntelligenceFlag swallows that and returns false — it must
    // NEVER throw into the IPC handler. Prove it never throws AND signals failure.
    let returned;
    assert.doesNotThrow(() => { returned = setIntelligenceFlag('trace', true); });
    assert.equal(returned, false, 'returns false on SettingsManager failure');
  });

  test('setIntelligenceFlag(false) and (null) are equally defensive headless', () => {
    assert.doesNotThrow(() => assert.equal(setIntelligenceFlag('trace', false), false));
    assert.doesNotThrow(() => assert.equal(setIntelligenceFlag('trace', null), false));
  });

  test('setIntelligenceFlag with an unknown key returns false (defensive, no throw)', () => {
    // The IPC layer validates the key before calling this, but the function itself must
    // also be safe if handed garbage (defense in depth). FLAGS[key] is undefined → guarded.
    let returned;
    assert.doesNotThrow(() => { returned = setIntelligenceFlag('not_a_real_flag', true); });
    assert.equal(returned, false, 'unknown key → false');
  });

  test('a FAILED set does NOT mutate resolved state (no env, headless → stays default false)', () => {
    // Because the persist failed (no Electron), the resolved value must still be the
    // default — there is no in-process fallback store that could lie about success.
    assert.equal(setIntelligenceFlag('trace', true), false);
    assert.equal(isIntelligenceFlagEnabled('trace'), false, 'resolved state unchanged after failed set');
  });
});

describe('Phase 14 — ENV override resolution chain (the mechanism the UI/IPC relies on)', () => {
  beforeEach(clearAllEnv);
  afterEach(clearAllEnv);

  test('default (no env, no settings) → each flag resolves to its documented default', () => {
    for (const key of intelligenceFlagKeys()) {
      const expectedDefault = DEFAULT_ON_KEYS.has(key) ? true : false;
      assert.equal(isIntelligenceFlagEnabled(key), expectedDefault, `${key} default matches meta`);
    }
  });

  test('trace: env=1 → true, then unset → false (fresh read each call, no cache)', () => {
    assert.equal(isIntelligenceFlagEnabled('trace'), false, 'starts false');
    process.env.NATIVELY_INTELLIGENCE_TRACE = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('trace'), true, 'env=1 → true');
    assert.equal(isIntelligenceTraceEnabled(), true, 'helper agrees');
    delete process.env.NATIVELY_INTELLIGENCE_TRACE;
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('trace'), false, 'unset → false (fresh read)');
  });

  test('env accepts on/true/yes/enabled and off/false/no/disabled, case-insensitive', () => {
    for (const on of ['1', 'true', 'TRUE', 'on', 'On', 'yes', 'enabled']) {
      process.env.NATIVELY_CONVERSATION_MEMORY_V2 = on;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceFlagEnabled('conversationMemoryV2'), true, `"${on}" → true`);
    }
    for (const off of ['0', 'false', 'FALSE', 'off', 'no', 'disabled']) {
      process.env.NATIVELY_CONVERSATION_MEMORY_V2 = off;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceFlagEnabled('conversationMemoryV2'), false, `"${off}" → false`);
    }
    delete process.env.NATIVELY_CONVERSATION_MEMORY_V2;
  });

  test('env override is PER-FLAG (toggling one does not affect another)', () => {
    process.env.NATIVELY_LECTURE_INTELLIGENCE_V2 = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('lectureIntelligenceV2'), true);
    assert.equal(isIntelligenceFlagEnabled('diagramIntelligence'), false, 'sibling unaffected');
    delete process.env.NATIVELY_LECTURE_INTELLIGENCE_V2;
  });

  test('intelligenceFlagSnapshot() reflects the resolved state of the env override', () => {
    let snap = intelligenceFlagSnapshot();
    assert.equal(snap.trace, false, 'snapshot default false');
    process.env.NATIVELY_INTELLIGENCE_TRACE = 'on';
    __resetIntelligenceFlagsCache();
    snap = intelligenceFlagSnapshot();
    assert.equal(snap.trace, true, 'snapshot tracks env=on');
    // Snapshot covers EVERY key (so the diagnostics surface can never silently drop one).
    assert.deepEqual(Object.keys(snap).sort(), [...EXPECTED_KEYS].sort());
    delete process.env.NATIVELY_INTELLIGENCE_TRACE;
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// SOURCE-EVIDENCE (read-verified, NOT executed here): the SettingsManager persistence
// precedence that the dev settings UI / IPC `intelligence-flags:set` relies on.
//
// This is the get→set→get round-trip the task asks about. It cannot run headless (the
// dependency is INLINED into this bundle and needs Electron's `app`), so it is verified by
// reading the source. The chain, with file:line:
//
//   1. setIntelligenceFlag(key, value)            electron/intelligence/intelligenceFlags.ts:186-197
//        → SettingsManager.getInstance().set(spec.setting, value)
//   2. SettingsManager.set(key, value)            electron/services/SettingsManager.ts:115-118
//        → this.settings[key] = value; this.saveSettings()   (plain-object store, no schema filter)
//   3. SettingsManager.get(key)                   electron/services/SettingsManager.ts:111-113
//        → return this.settings[key]              (reads the same plain-object slot back)
//   4. readSettingOverride(key)                   electron/intelligence/intelligenceFlags.ts:114-125
//        → SettingsManager.getInstance().get(spec.setting); true/false → that value
//   5. isIntelligenceFlagEnabled(key)             electron/intelligence/intelligenceFlags.ts:131-138
//        → env override first; else settings override; else default(false)
//
// UNKNOWN-KEY PERSISTENCE SURVIVES RELOAD (the linchpin — flag setting keys like
// 'intelligenceTraceEnabled' are NOT in the AppSettings TS type, but the runtime store is a
// plain object so they round-trip):
//   • loadSettings():                             electron/services/SettingsManager.ts:142-166
//        → `this.settings = parsed` (line 150) — assigns the WHOLE parsed object, NO schema
//          filter / allow-list, so unknown keys persist across reloads.
//   • migrateLegacySettings():                    electron/services/SettingsManager.ts:170-184
//        → touches ONLY `screenUnderstandingMode`; it never deletes/strips any other key, so
//          it does NOT remove the intelligence flag settings. (Confirmed: the only mutations
//          are to settings.screenUnderstandingMode.) → NO CONCERN that the round-trip is lost.
//   • saveSettings():                             electron/services/SettingsManager.ts:186-194
//        → JSON.stringify(this.settings) — serializes the whole object incl. unknown keys
//          (atomic tmp+rename), so the persisted file keeps them.
//
// CONCLUSION (read-verified): under the Electron runtime, set('intelligenceTraceEnabled',
// true) → get(...) === true → isIntelligenceFlagEnabled('trace') === true when no env
// override is set, AND it survives an app restart. The chain holds in source.
// ─────────────────────────────────────────────────────────────────────────────────────
