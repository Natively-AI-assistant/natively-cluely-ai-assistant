// electron/intelligence/intelligenceFlags.ts
//
// Central feature-flag module for the Natively Intelligence OS consolidation
// (spec Phase 15). Follows the EXACT convention already established by
// profileGroundingV2.ts / liveSessionMemoryConfig.ts / verificationEnabled.ts:
//   • read process.env.NATIVELY_* first, then SettingsManager opt-in,
//   • read DEFENSIVELY (never throw — settings may be unavailable in headless
//     benchmarks / tests / early boot),
//   • expose a __reset*Cache() hook so a test can change env mid-process.
//
// ROLLOUT POSTURE (release 2026-06-12): every flag here is ADDITIVE and OFF by
// default. The Intelligence OS facades (ProfileTreeService, LiveTranscriptBrain,
// ContextRouter) are a canonical READ/DECISION layer that sits BESIDE the
// existing, benchmark-green answer paths — turning a flag on never changes an
// answer unless a caller is also wired to consult the facade. The only flag that
// can change LIVE behavior is `durableMemoryWindow` (it points the long-range
// follow-up memory at the transcript store that actually survives eviction), and
// it is default-OFF so the current path is byte-for-byte unchanged until opted in.
//
// Decision precedence per flag (highest first):
//   1. env override on/off   → that value
//   2. settings opt-in       → that value
//   3. default               → the flag's documented default
//
// Privacy: this module only reads config — it never touches resume / JD /
// transcript content. Flags are checked ONCE PER ANSWER (not per token), and each
// check is a process.env read (+ a SettingsManager.get only when no env override is
// set). That's cheap enough for that cadence; there is deliberately no cache (see
// readEnvOverride for why a cache would be wrong under esbuild inline-bundling).

export type IntelligenceFlagKey =
  // Observe-only structured per-answer trace + context-inclusion report (Phase 3/12/13).
  | 'trace'
  // Point the live long-range follow-up memory at the DURABLE transcript store
  // (fullTranscript) instead of the 120s-evicted contextItems window. Fixes the
  // verified "2h window silently capped to 120s" bug. Default OFF → current path.
  | 'durableMemoryWindow'
  // ── Full Intelligence OS rollout set (Phase 3). Every entry default OFF so the
  //    current behavior is preserved until a caller is wired AND the flag is on.
  | 'intelligenceOsEnabled'        // umbrella (Phase 19 rollout)
  | 'profileTreeV2'                // Phase 4 — route identity through ProfileTreeService
  | 'contextRouterV2'              // Phase 6 — consult the consolidated ContextRouter
  | 'liveTranscriptBrain'          // Phase 7 — consult LiveTranscriptBrain
  | 'promptAssemblerV2'            // Phase 9
  | 'answerDiversityGuard'         // Phase 5 — wire AnswerDiversityGuard into delivery
  | 'meetingMemoryV2'              // Phase 10
  | 'meetingSummaryV3'             // Chunked/schema-v3 post-meeting notes
  | 'meetingModeAutoDetect'        // Meeting Notes V3 — detect mode from transcript/calendar
  | 'followUpDraftV2'              // Meeting Notes V3 — LLM-based follow-up draft generator
  | 'speakerLabelsV1'             // Meeting Notes V3 — editable speaker labels
  | 'meetingNotesStructuredOutput' // Meeting Notes V3 — provider-native JSON where available
  | 'meetingSummaryLlmPolish'      // Meeting Notes V3 — constrained LLM polish of the Summary
  | 'speakerDiarizationV1'         // Meeting Notes V3 — provider (Deepgram) diarization, opt-in
  | 'globalSearchV2'               // Phase 11
  | 'inMeetingSearchV2'            // Phase 12
  | 'conversationMemoryV2'         // Phase 13 (same-session follow-ups)
  | 'lectureIntelligenceV2'        // Phase 14
  | 'diagramIntelligence'          // Phase 15
  | 'hindsightMemory'              // Phase 16 — long-term memory provider on at all
  | 'hindsightLiveRecall'          // Phase 16 — last to enable (live recall in answers)
  | 'hindsightPostMeetingRetain'   // Phase 16 — async retain after meetings/lectures
  // ── Smart Retrieval / confidence-gated rerank (large-doc RAG) ───────────
  // Phase 0 — OBSERVE ONLY. Computes a per-query retrieval-confidence signal
  // from the existing combined-score distribution and emits `rag_confidence`
  // telemetry. Changes NO answer and NO retrieved context — it only measures
  // how often a low-confidence gate would fire, so the thresholds for the
  // (later) local-reranker escalation can be tuned from real traffic first.
  | 'ragConfidenceGate'
  // Phase 1 — local cross-encoder rerank escalation. When the confidence gate
  // trips on a MANUAL/typed/follow-up query (looser latency than a live
  // transcript turn), widen the candidate pool and re-order it with an
  // on-device bge-reranker. Default OFF. Requires ragConfidenceGate to also be
  // on (the gate provides the trip signal). No-ops if the model can't load
  // (e.g. not bundled in a packaged build) → falls through to today's top-K.
  | 'ragLocalRerank'
  // Phase 2 — Reciprocal Rank Fusion across the heterogeneous retrieval
  // sources (modes RAG + Profile Tree + Hindsight). Merges each source's
  // RANKED list by rank position (scale-agnostic — Hindsight 0.8.2 returns no
  // score), so a unified confidence can be computed over the merged set
  // ("RAG missed but Hindsight has it" no longer looks like a global miss).
  // Default OFF. The fusion module is pure + additive; no live path consumes it
  // until a consumer is wired in a follow-up.
  | 'ragRrfFusion'
  // Phase 3 — allow the local rerank escalation on the LIVE transcript path
  // (not just manual/follow-up). Safe by construction: the reranker is
  // PREWARMED at mode activation so it's never cold, and the rerank runs inside
  // the existing raceWithBudget(1500ms) retrieval envelope — if it ever
  // overruns, the race already falls through to the non-reranked block, so
  // first-token latency can never regress. Default OFF. Requires ragLocalRerank
  // (the reranker itself) to also be on.
  | 'ragSpeculativeRerank';

interface FlagSpec {
  /** env var name (NATIVELY_* convention). */
  env: string;
  /** SettingsManager key for a UI/persisted opt-in. */
  setting: string;
  /** Default when neither env nor settings decide. */
  default: boolean;
}

const FLAGS: Record<IntelligenceFlagKey, FlagSpec> = {
  trace: {
    env: 'NATIVELY_INTELLIGENCE_TRACE',
    setting: 'intelligenceTraceEnabled',
    default: false,
  },
  durableMemoryWindow: {
    env: 'NATIVELY_DURABLE_MEMORY_WINDOW',
    setting: 'intelligenceDurableMemoryWindow',
    default: false,
  },
  intelligenceOsEnabled: { env: 'NATIVELY_INTELLIGENCE_OS', setting: 'intelligenceOsEnabled', default: false },
  profileTreeV2: { env: 'NATIVELY_PROFILE_TREE_V2', setting: 'profileTreeV2Enabled', default: false },
  contextRouterV2: { env: 'NATIVELY_CONTEXT_ROUTER_V2', setting: 'contextRouterV2Enabled', default: false },
  liveTranscriptBrain: { env: 'NATIVELY_LIVE_TRANSCRIPT_BRAIN', setting: 'liveTranscriptBrainEnabled', default: false },
  promptAssemblerV2: { env: 'NATIVELY_PROMPT_ASSEMBLER_V2', setting: 'promptAssemblerV2Enabled', default: false },
  answerDiversityGuard: { env: 'NATIVELY_ANSWER_DIVERSITY_GUARD', setting: 'answerDiversityGuardEnabled', default: false },
  meetingMemoryV2: { env: 'NATIVELY_MEETING_MEMORY_V2', setting: 'meetingMemoryV2Enabled', default: false },
  // Meeting Notes V3 ships ON by default (product decision 2026-06-20). Each remains
  // env/settings-overridable; set NATIVELY_MEETING_SUMMARY_V3=0 to revert to the legacy
  // single-pass summary path. All paths keep a deterministic fallback and honor the
  // post_call_summary data scope.
  meetingSummaryV3: { env: 'NATIVELY_MEETING_SUMMARY_V3', setting: 'meetingSummaryV3Enabled', default: true },
  meetingModeAutoDetect: { env: 'NATIVELY_MEETING_MODE_AUTODETECT', setting: 'meetingModeAutoDetectEnabled', default: true },
  followUpDraftV2: { env: 'NATIVELY_FOLLOWUP_DRAFT_V2', setting: 'followUpDraftV2Enabled', default: true },
  speakerLabelsV1: { env: 'NATIVELY_SPEAKER_LABELS_V1', setting: 'speakerLabelsV1Enabled', default: true },
  // Provider-native JSON mode is not implemented (the validate→repair→fallback ladder makes
  // it unnecessary for correctness); kept OFF as a reserved flag.
  meetingNotesStructuredOutput: { env: 'NATIVELY_MEETING_NOTES_STRUCTURED_OUTPUT', setting: 'meetingNotesStructuredOutputEnabled', default: false },
  // Constrained LLM polish of the Summary (note-content-only, "no new tokens" gated). ON by
  // default — it can only improve readability and always falls back to the deterministic
  // summary, so it never hallucinates or blocks.
  meetingSummaryLlmPolish: { env: 'NATIVELY_MEETING_SUMMARY_LLM_POLISH', setting: 'meetingSummaryLlmPolishEnabled', default: true },
  // Provider diarization (Deepgram) — opt-in; touches the realtime STT path so default OFF.
  speakerDiarizationV1: { env: 'NATIVELY_SPEAKER_DIARIZATION_V1', setting: 'speakerDiarizationV1Enabled', default: false },
  globalSearchV2: { env: 'NATIVELY_GLOBAL_SEARCH_V2', setting: 'globalSearchV2Enabled', default: false },
  inMeetingSearchV2: { env: 'NATIVELY_IN_MEETING_SEARCH_V2', setting: 'inMeetingSearchV2Enabled', default: false },
  conversationMemoryV2: { env: 'NATIVELY_CONVERSATION_MEMORY_V2', setting: 'conversationMemoryV2Enabled', default: false },
  lectureIntelligenceV2: { env: 'NATIVELY_LECTURE_INTELLIGENCE_V2', setting: 'lectureIntelligenceV2Enabled', default: false },
  diagramIntelligence: { env: 'NATIVELY_DIAGRAM_INTELLIGENCE', setting: 'diagramIntelligenceEnabled', default: false },
  hindsightMemory: { env: 'NATIVELY_HINDSIGHT_MEMORY', setting: 'hindsightMemoryEnabled', default: false },
  hindsightLiveRecall: { env: 'NATIVELY_HINDSIGHT_LIVE_RECALL', setting: 'hindsightLiveRecallEnabled', default: false },
  hindsightPostMeetingRetain: { env: 'NATIVELY_HINDSIGHT_POST_MEETING_RETAIN', setting: 'hindsightPostMeetingRetainEnabled', default: false },
  // Phase 0 — observe-only confidence telemetry. Default OFF.
  ragConfidenceGate: { env: 'NATIVELY_RAG_CONFIDENCE_GATE', setting: 'ragConfidenceGateEnabled', default: false },
  // Phase 1 — local cross-encoder rerank escalation (manual/follow-up). Default OFF.
  ragLocalRerank: { env: 'NATIVELY_RAG_LOCAL_RERANK', setting: 'ragLocalRerankEnabled', default: false },
  // Phase 2 — Reciprocal Rank Fusion across heterogeneous retrieval sources. Default OFF.
  ragRrfFusion: { env: 'NATIVELY_RAG_RRF_FUSION', setting: 'ragRrfFusionEnabled', default: false },
  // Phase 3 — allow rerank on the live transcript path (prewarmed + budget-guarded). Default OFF.
  ragSpeculativeRerank: { env: 'NATIVELY_RAG_SPECULATIVE_RERANK', setting: 'ragSpeculativeRerankEnabled', default: false },
};

const ON_VALUES = new Set(['1', 'true', 'on', 'enabled', 'yes']);
const OFF_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);

// Env is read FRESH on every call (no cache). Two reasons: (1) env never changes at
// runtime, so a cache only saves a trivial string-normalize + Set lookup that these
// once-per-answer gates don't need; (2) the electron build bundles this module INLINE
// into every consumer (esbuild bundle:true), so a cached value + a `__reset` hook live
// in each bundle's OWN copy — a reset reachable from one module can't clear another's
// inlined cache, which silently breaks flag flips in tests. Reading fresh makes the
// flag observable identically across every bundle, no shared mutable state required.
function readEnvOverride(key: IntelligenceFlagKey): 'on' | 'off' | null {
  try {
    const raw = (process.env[FLAGS[key].env] || '').trim().toLowerCase();
    if (ON_VALUES.has(raw)) return 'on';
    if (OFF_VALUES.has(raw)) return 'off';
  } catch {
    /* fall through */
  }
  return null;
}

function readSettingOverride(key: IntelligenceFlagKey): boolean | null {
  try {
    // From electron/intelligence/ → ../services/SettingsManager
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get(FLAGS[key].setting);
    if (v === true) return true;
    if (v === false) return false;
  } catch {
    /* settings unavailable → no override */
  }
  return null;
}

/**
 * Resolve a single intelligence flag. env override wins, then settings opt-in,
 * then the flag's documented default. Never throws.
 */
export function isIntelligenceFlagEnabled(key: IntelligenceFlagKey): boolean {
  const env = readEnvOverride(key);
  if (env === 'on') return true;
  if (env === 'off') return false;
  const setting = readSettingOverride(key);
  if (setting !== null) return setting;
  return FLAGS[key].default;
}

/**
 * True when the flag's value is FORCED by an environment override (NATIVELY_* var set to
 * a recognized on/off value). When true, the env is the authoritative source — callers
 * must NOT persist a contradicting SettingsManager value (e.g. HindsightManager's
 * auto-flip would otherwise write `hindsightMemoryEnabled=true` to settings while
 * `NATIVELY_HINDSIGHT_MEMORY=0` is set, silently re-enabling the flag the moment the
 * user unsets the env). Never throws.
 */
export function isIntelligenceFlagEnvForced(key: IntelligenceFlagKey): boolean {
  return readEnvOverride(key) !== null;
}

/** True when the observe-only IntelligenceTrace should collect (Phase 12/13). */
export const isIntelligenceTraceEnabled = (): boolean => isIntelligenceFlagEnabled('trace');

/**
 * True when the live long-range follow-up memory should read from the durable
 * transcript store (fullTranscript) rather than the 120s-evicted contextItems.
 * Default OFF — the current behavior is preserved until explicitly opted in.
 */
export const isDurableMemoryWindowEnabled = (): boolean =>
  isIntelligenceFlagEnabled('durableMemoryWindow');

/**
 * True when the umbrella `intelligenceOsEnabled` flag is on. A sub-feature flag
 * still gates its own behavior; this is just the master switch a rollout can use.
 */
export const isIntelligenceOsEnabled = (): boolean => isIntelligenceFlagEnabled('intelligenceOsEnabled');

/**
 * True when the observe-only retrieval-confidence telemetry should be computed
 * and emitted (Phase 0 of the smart-retrieval rollout). Default OFF. This flag
 * NEVER changes retrieval output — it only gates the extra `rag_confidence`
 * telemetry + the optional `confidence` field on ModeRetrievedContext, so the
 * low-confidence thresholds for the later local-reranker escalation can be
 * tuned from real traffic before any behavior change ships.
 */
export const isRagConfidenceGateEnabled = (): boolean =>
  isIntelligenceFlagEnabled('ragConfidenceGate');

/**
 * True when the local cross-encoder rerank escalation (Phase 1) may run on a
 * manual/follow-up query whose confidence gate tripped. Default OFF. Requires
 * `ragConfidenceGate` to also be on — the gate provides the low-confidence trip
 * signal that this escalation reacts to. No-ops gracefully if the reranker
 * model can't load.
 */
export const isRagLocalRerankEnabled = (): boolean =>
  isIntelligenceFlagEnabled('ragLocalRerank');

/**
 * True when Reciprocal Rank Fusion across the heterogeneous retrieval sources
 * (modes RAG + Profile Tree + Hindsight) may run (Phase 2). Default OFF. The
 * fusion module is pure + additive; this flag gates whether a (future) consumer
 * consults it — turning it on changes nothing until a caller is wired.
 */
export const isRagRrfFusionEnabled = (): boolean =>
  isIntelligenceFlagEnabled('ragRrfFusion');

/**
 * True when the local rerank escalation may run on the LIVE transcript path
 * (Phase 3), not just manual/follow-up. Safe by construction (prewarmed +
 * inside the existing retrieval budget race). Default OFF. Requires
 * `ragLocalRerank` to also be on — this flag only widens WHERE that reranker
 * is permitted to run.
 */
export const isRagSpeculativeRerankEnabled = (): boolean =>
  isIntelligenceFlagEnabled('ragSpeculativeRerank');

/**
 * A snapshot of every flag's resolved state — handy for the IntelligenceTrace and
 * the rollout/diagnostics surface. Enumerates the FLAGS record so it can never
 * drift out of sync with the key union when a flag is added.
 */
export function intelligenceFlagSnapshot(): Record<IntelligenceFlagKey, boolean> {
  const out = {} as Record<IntelligenceFlagKey, boolean>;
  for (const key of Object.keys(FLAGS) as IntelligenceFlagKey[]) {
    out[key] = isIntelligenceFlagEnabled(key);
  }
  return out;
}

/** All flag keys (for a settings UI / diagnostics). */
export function intelligenceFlagKeys(): IntelligenceFlagKey[] {
  return Object.keys(FLAGS) as IntelligenceFlagKey[];
}

/** The SettingsManager key + env var name backing a flag (for a settings UI). */
export function intelligenceFlagMeta(key: IntelligenceFlagKey): { setting: string; env: string; default: boolean } {
  const f = FLAGS[key];
  return { setting: f.setting, env: f.env, default: f.default };
}

/**
 * Persist a flag's value via its SettingsManager key (the same key the flag reads).
 * Used by the dev/experimental settings UI (Phase 14). Pass `null` to clear the
 * override (revert to env/default). Defensive — never throws.
 *
 * ALSO writes a paired `*Explicit` sibling key (e.g. `hindsightMemoryEnabledExplicit`)
 * so callers can distinguish "default OFF, user hasn't touched it" (auto-flip is OK)
 * from "user explicitly set OFF" (auto-flip would silently reverse user intent). Only
 * `hindsightMemory` reads this sibling today; the others ignore it.
 */
export function setIntelligenceFlag(key: IntelligenceFlagKey, value: boolean | null): boolean {
  try {
    // OWN-property check (not `FLAGS[key]` truthiness): `FLAGS['__proto__']` /
    // `['constructor']` resolve to Object.prototype members (truthy) with an undefined
    // `.setting`, which would write `settings[undefined]`. Reject non-own keys so a
    // future unvalidated caller can't reach SettingsManager.set with a bad key
    // (security review 2026-06-13 — defense in depth; the IPC path already validates).
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(FLAGS, key)) return false;
    const spec = FLAGS[key];
    if (!spec || typeof spec.setting !== 'string') return false;
    const { SettingsManager } = require('../services/SettingsManager');
    const sm = SettingsManager.getInstance();
    if (value === null) {
      sm.set(spec.setting, undefined);
      // Clearing the override also clears the explicit marker — the value reverts to
      // the registry default, which is itself a non-explicit state.
      sm.set(`${spec.setting}Explicit`, undefined);
    } else {
      sm.set(spec.setting, value);
      // Mark "explicit" only when value DIFFERS from registry default. This is the key
      // invariant: if the value equals the default, the user hasn't expressed intent
      // beyond the registry default and the auto-flip should still be free to flip.
      // Only `hindsightMemory` actually reads this sibling — others ignore it.
      const isExplicit = value !== spec.default;
      sm.set(`${spec.setting}Explicit`, isExplicit ? true : undefined);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Test-only no-op. Env is read fresh on every call, so there is no cache to clear —
 * a test can change `process.env.NATIVELY_*` and the next read reflects it
 * immediately. Kept for API stability with callers that defensively reset.
 */
export function __resetIntelligenceFlagsCache(): void {
  /* intentionally empty — no cached state (see readEnvOverride). */
}
