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

export type SourceOwnerEnforcementStage = 'off' | 'observe' | 'soft_block' | 'enforce';

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
  | 'ragSpeculativeRerank'
  // ── OKF Hybrid Knowledge System (2026-07-01 autopilot build) ─────────────
  // Generate OKF-compatible (Open Knowledge Format v0.1) "Knowledge Packs"
  // from uploaded reference files — source-attributed concept cards layered
  // ON TOP of (never replacing) the existing chunk-retrieval pipeline.
  // Default ON in dev/test so the benchmark + test suite exercise the real
  // path; configurable (default OFF) in production until validated.
  | 'okfKnowledgePacks'
  // Export a generated Knowledge Pack as a real OKF v0.1 Markdown bundle
  // (index.md/log.md/concept files). Default ON in dev/test.
  | 'okfMarkdownExport'
  // Use OKF cards (in addition to raw chunks) in document-grounded retrieval
  // and prompt assembly. Default ON in dev/test, guarded (OFF) in production
  // until the 19-question benchmark is consistently green end-to-end.
  | 'okfHybridRetrieval'
  // Entity/relation graph layer derived from OKF cards (Phase 4). Default OFF
  // everywhere until Phase 4 ships.
  | 'okfGraphExpansion'
  // Knowledge Pack inspector UI (Phase 5). Default OFF until the UI ships.
  | 'okfKnowledgeUi'
  // Allow users to edit/approve/reject generated cards (Phase 6). Default OFF
  // until the edit/approval flow ships.
  | 'okfUserEditableCards'
  // ── OKF Profile Intelligence upgrade (2026-07-02 autopilot build) ────────
  // Generate an OKF-compatible Knowledge Pack (candidate profile + target job +
  // AOT interview artifacts) from the structured resume/JD on ingest — layered
  // ON TOP of (never replacing) the deterministic fast path, structured-JSON
  // grounding, and context_nodes vector store. PROFILE packs are PII and obey
  // profileContextPolicy; they are FORBIDDEN in document-grounded custom modes.
  // Default ON in dev/test so the 18-question benchmark exercises the real
  // path; configurable (default OFF) in production until validated.
  | 'okfProfilePacks'
  // Use profile OKF cards (in addition to context_nodes) in answer evidence.
  // Fail-closed: contributes nothing without an explicit AnswerPlan/route that
  // allows profile context. Default ON in dev/test, guarded (OFF) in production.
  | 'okfProfileHybridRetrieval'
  // Allow a profile Knowledge Pack to be exported as an OKF v0.1 Markdown
  // bundle (explicit user action only). Default ON in dev/test.
  | 'okfProfileMarkdownExport'
  // Typed relation graph derived from profile cards (Phase 4). Default OFF.
  | 'okfProfileGraphExpansion'
  // Profile Knowledge Pack inspector UI (Phase 5). Default OFF until UI ships.
  | 'okfProfileKnowledgeUi'
  // Document-grounded custom modes must NEVER let Hindsight/profile/general
  // knowledge override uploaded document evidence. Default ON everywhere —
  // this is a safety isolation gate, not an experimental feature.
  | 'docGroundedStrictIsolation'
  // Attempt a single bounded repair when the model issues a false refusal
  // ("I could not find that...") despite strong retrieved evidence existing.
  // Default ON everywhere — see SYSTEM_REFUSAL_RE / isFalseRefusal in
  // ipcHandlers.ts. Turning this OFF reverts to the prior log-only behavior.
  | 'docGroundedFalseRefusalRepair'
  // Custom-Mode Source Isolation (2026-07-06, hardening/v2.7.0): when ON, the
  // SourceArbiter enforces the CustomModeExecutionContract at every layer
  // (retrieval, prompt, validator, regen, SessionTracker write). When OFF,
  // the arbiter logs the resolved contract as telemetry but does NOT block
  // any path. Phase 4 ships the arbiter in observe-only mode (default OFF);
  // Phase H flips this ON after we've collected telemetry confirming the
  // contract is correctly built for every modeKind × answerType combination.
  | 'customModeSourceEnforcement'
  // Full-JIT final-answer law (2026-07-07, JD/Resume JIT pipeline fix). When ON,
  // AOT-precomputed intro/identity/greeting text is demoted to EVIDENCE (a
  // <candidate_identity_fact> context block) and the provider generates the
  // user-visible final answer — instead of the AOT string being emitted verbatim.
  // Default ON (the full-JIT policy is the intended behavior); flip OFF to
  // restore the legacy AOT-emit fast paths if a latency/behavior regression is
  // found in the field.
  | 'jitFinalAnswerEnforced'
  // ── Context OS / Source Authority Kernel (2026-07-10) ────────────────────
  // See docs/context-os/. Umbrella: nothing Context OS runs without this.
  | 'contextOsEnabled'
  // Per-surface wiring gates (each also requires contextOsEnabled).
  | 'contextOsManualChatEnabled'
  | 'contextOsWtaEnabled'
  | 'contextOsRecapFollowupEnabled'
  // Build + trace the typed EvidencePack alongside legacy retrieval.
  | 'contextOsEvidencePackEnabled'
  // Memory safety: assistant-claim extraction + validated-claim reuse gates.
  | 'contextOsMemorySafetyEnabled'
  // Enforce capability-scoped retrieval (block, not just log, forbidden fetches).
  | 'contextOsEnforceSourceCapabilities'
  // Property-aware evidence validation gates generation (refuse on mismatch).
  | 'contextOsPropertyValidation'
  // Coordinate evidence from multiple explicitly-authorized source families.
  | 'contextOsMultiFamilyEvidenceEnabled'
  // ── Answer-relevance semantic guard (campaign2 longsession, 2026-07-19) ──
  // Live-fires ONE bounded regeneration when a local zero-shot NLI check
  // (AnswerRelevanceChecker.ts) flags an answer as not addressing the
  // question — targets the free-form no-content-hallucination family. Default
  // OFF (observe-only): validation run-032 found the classifier's confidence
  // scores for REAL, on-topic answers in the live multi-turn transcript
  // context (observed range ~0.0002-0.09) overlap almost entirely with the
  // synthetic single-turn tuning corpus's known-bad range (~0.0-0.224) — no
  // threshold separates them on real traffic, and a live-reproduced case
  // (press A1, run-032) showed the guard actively made a correct answer
  // WORSE by regenerating it. When OFF, `checkAnswerRelevance` still runs and
  // its verdict is still traced (`answer_relevance_discard`/`_would_fire`)
  // so real production score distributions can be collected before this is
  // re-enabled — mirrors the `ragConfidenceGate` observe-only precedent.
  | 'answerRelevanceGuardLive'
  // ── TurnIdentity (Phase 6 Slice 1, context-rebuild) ──────────────────────
  // Formal (turnId, attemptId) identity (electron/llm/turnIdentity.ts)
  // replacing the ad hoc per-sender streamId supersession check with a
  // shared predicate + a SessionTracker-level write guard. Genuinely new
  // mechanism replacing a working production system, so it ships dev/test-
  // only first (pattern 1, mirrors ragConfidenceGate/okfHybridRetrieval's
  // rollout precedent) — both identity schemes run in parallel until a
  // documented promotion decision citing real telemetry (see
  // contextOsEnabled's 2026-07-18 promotion comment for the bar this must
  // clear: a live-Electron trace campaign, not a unit-test pass alone).
  | 'turnIdentityV2'
  // ── PromptComposer (Phase 6 Slice 2, context-rebuild) ────────────────────
  // electron/llm/promptComposer.ts's composePrompt() — the one assembly
  // point replacing the ad hoc CONTEXT/USER-QUESTION concatenation
  // scattered across LLMHelper.ts, and the RC1 answerPolicy short-circuit
  // (no provider call for refuse_insufficient_evidence/ask_clarification).
  // This flag exists but has NO consuming call site yet as of this pass —
  // composePrompt() is built and tested standalone; wiring it into the live
  // manual-chat generation path and retiring E20 (the assistant-meta
  // refusal detector it subsumes) is deliberately deferred, since this
  // codebase's own established bar for promoting a replacement to a
  // load-bearing generation path is a documented live-Electron trace
  // campaign (contextOsEnabled's 2026-07-18 precedent), not a green unit-
  // test suite alone — see 05_MIGRATION_PLAN.md's Slice 2 STATUS note.
  // Pattern 1 (dev/test-only default) exactly like turnIdentityV2 above.
  | 'promptComposerV2'
  // ── CanonicalTurn on manual chat (Phase 6 Slice 3, context-rebuild) ──────
  // resolveCanonicalTurn (electron/llm/resolveCanonicalTurn.ts) called from
  // ipcHandlers.ts's manual-chat handler for the FIRST TIME — a genuinely
  // new classifier on a surface it has never run on at all (the WTA surface
  // is the only one that calls it today, "observe-only"). SHADOW-ONLY: runs
  // alongside the existing legacy classification, logging a divergence
  // trace when they'd disagree; the live answer/generation path continues
  // to use the legacy classification exclusively. This is the plan's own
  // named "riskiest slice" — promotion requires the benchmark-corpus
  // regression test passing across MULTIPLE live-Electron runs (not one),
  // per 05_MIGRATION_PLAN.md's Slice 3 section, since this is the surface
  // every one of Phase 0's 10 named failures came from. Pattern 1
  // (dev/test-only default).
  | 'canonicalTurnManualChat'
  // ── Atomic JD profile-pack generation (Phase 6 Slice 5, context-rebuild) ─
  // KnowledgeOrchestrator.ingestDocument's JD branch fires
  // aotPipeline.runForJD(...).then(...) without awaiting it, then returns
  // {success:true} immediately — a real race (Ingestion Audit §A.6.3): the
  // IPC caller sees success before the JD OKF profile pack (gap analysis,
  // negotiation script, mock questions, culture mapping, then
  // _generateProfileOkfPack('jd')) has been generated. Closing this fully
  // means awaiting the AOT pipeline before ingestDocument returns for a JD —
  // a genuine, user-facing slower upload-ack (AOT runs real LLM calls), not
  // a free fix like the resume branch's setImmediate removal. Ships dev/
  // test-only first (pattern 1) so the race-free sequence is exercised and
  // tested without changing production upload latency until a documented
  // promotion decision. See 05_MIGRATION_PLAN.md's Slice 5 STATUS note.
  | 'atomicJdProfilePackGeneration'
  // ── Assistant-claims precedence enforcement (Phase 6 Slice 7, context-
  // rebuild) ────────────────────────────────────────────────────────────
  // RC8: getVerifiedAssistantClaims/markAssistantClaimContradicted (and
  // assistantClaims.ts's claimReusableAsEvidence/claimContradictedByEvidence)
  // are write-only today — zero read-side production callers. This flag
  // gates the new checkAssistantClaimsPrecedence read-side check
  // (assistantClaimsPrecedenceCheck.ts), built and tested standalone this
  // pass but NOT wired into any live generation path (see that file's
  // header for why). Genuinely new enforcement that could, in principle,
  // incorrectly block a legitimate answer if a claim was mis-classified
  // contradicted upstream — dev/test-only default (pattern 1) rather than
  // an already-resolved promote-everywhere flag. This flag is also the
  // removal condition for A4g/D17g's WRAP disposition in
  // 05_COMPONENT_DISPOSITION.md.
  | 'assistantClaimsEnforcement'
  // ── Pronoun-regex shadow observation (Phase 6 Slice 4 item 2, follow-up
  // pass, context-rebuild) ──────────────────────────────────────────────
  // KnowledgeOrchestrator.processQuestion's pronoun-presence gate
  // (isGenericKnowledgeQuestion/CANDIDATE_FRAMING_REGEX) is the confirmed
  // root cause (RC2, live-reproduced 4/4) of a 3-way retrieval fork for
  // the same answerType/contractHash. Retiring it as the live decision-
  // maker is a genuinely consequential deletion of a currently-LIVE gate
  // with real user traffic — correctly deferred pending a live-trace
  // campaign per 05_MIGRATION_PLAN.md's Slice 4 STATUS note. This flag
  // gates a SHADOW-ONLY observation (mirrors the CanonicalTurnV2 shadow-
  // wiring precedent in ipcHandlers.ts for Slice 3): on every real
  // processQuestion() call, additionally compute isLayerAllowed(plan,
  // 'resume') and log agreement/divergence against the legacy gate's own
  // decision — a pure side-channel trace, zero change to
  // processQuestion's return value. Exists so a future promotion decision
  // is evidence-based (real traffic, not this pass's synthetic corpus).
  // Pattern 1 (dev/test-only default).
  | 'pronounRegexShadowObservation'
  // ── ModePolicy shadow observation (Phase 6 Slice 7 follow-up, context-
  // rebuild) ────────────────────────────────────────────────────────────
  // electron/services/modePolicy.ts's resolveModePolicy() is a NEW, pure,
  // unwired projection (built standalone, no prior call sites). This flag
  // gates a SHADOW-ONLY comparison in ipcHandlers.ts's manual-chat handler
  // (right next to the existing contextRouterV2 shadow block, which
  // already has both `manualActiveMode` (ActiveModeInfo) and
  // `_activeSourceContract` (ModeSourceContract) in scope): compute
  // ModePolicy.documentGroundedCustomModeActive from the same inputs and
  // log agreement/divergence against the LIVE
  // `manualActiveMode.documentGroundedCustomModeActive` field the doc-
  // grounded-strip guard (~line 2049) already reads today. Pure
  // side-channel log, zero change to any return value or downstream
  // behavior. Exists so any future consumer of `ModePolicy` inherits
  // real-traffic evidence instead of a synthetic-fixture-only history.
  // Pattern 1 (dev/test-only default).
  | 'modePolicyShadowObservation'
  // ── Impossible-evidence-state gate, Stage 0 shadow (answer-pipeline-
  // rebuild Phase 2, docs/answer-pipeline-rebuild/03_EVIDENCEPACK_DESIGN.md)
  // ──────────────────────────────────────────────────────────────────────
  // The manual-chat-no-mode path's evidence-selection ALREADY produces a
  // typed EvidencePack when profile capabilities are granted
  // (ProfileEvidenceService.retrieveEvidence, gated by contextOsEvidencePackEnabled)
  // — but nothing validates the pack against `profileContextPolicy` before
  // the prompt is built. RC-9 (live-confirmed, 2026-07-27) is the concrete
  // failure this closes: a misclassified `unknown_answer`/`allowed` turn
  // gets profile capability granted and consulted with no relevance check,
  // 100% deterministic leak. This flag gates a SHADOW-ONLY validator
  // (checkImpossibleEvidenceState in evidencePackValidation.ts): for every
  // manual-chat-no-mode turn where a TurnContextContract was built, run the
  // typed pack through the forbidden-direction checks only (profile item
  // present when profileContextPolicy==='forbidden'; an 'allowed'-policy
  // profile item with no requestedProperty-tied reasonIncluded) and log
  // agreement/divergence — ZERO change to the prompt, the pack, or any
  // return value. The design's own asymmetric-staging analysis is why
  // required-direction enforcement (a genuinely different, higher-risk
  // check) is explicitly OUT of scope for this flag: RC-8 (also live-
  // confirmed the same day) shows a required-direction false-positive turns
  // a fixable heuristic bug into a permanent structural refusal if enforced
  // before its own dedicated shadow period. Pattern 1 (dev/test-only
  // default), mirrors modePolicyShadowObservation/pronounRegexShadowObservation
  // immediately above.
  | 'contextOsImpossibleStateGateShadow'
  // ── Impossible-evidence-state gate, Stage 1 enforcement (answer-pipeline-
  // rebuild Phase 2, docs/answer-pipeline-rebuild/03_EVIDENCEPACK_DESIGN.md)
  // ──────────────────────────────────────────────────────────────────────
  // The first REAL behavior change in the design's asymmetric rollout —
  // separate flag from contextOsImpossibleStateGateShadow (Stage 0,
  // observation-only) since this stage actually narrows what the legacy
  // fast path injects. Mirrors _contractAllowsProfile's established pattern
  // in ipcHandlers.ts (ANDed into sourceOwnershipAllowsProfile, so it can
  // only narrow the legacy decision, never widen it — leak-safe by
  // construction) and fails OPEN on any internal error (a gate failure must
  // never break chat). Forbidden-direction ONLY (checks #1/#2) — the design
  // doc's own risk analysis is why required-direction enforcement must wait:
  // RC-8 (a real, live false-refusal bug from the same session this gate
  // was designed in) shows that direction is unsafe to enforce before its
  // own dedicated shadow period, so this flag structurally cannot affect a
  // 'required'-policy turn (checkImpossibleEvidenceState never flags one).
  // Pattern 1 (dev/test-only default).
  | 'contextOsImpossibleStateGateEnforceForbidden';

interface FlagSpec {
  /** env var name (NATIVELY_* convention). */
  env: string;
  /** SettingsManager key for a UI/persisted opt-in. */
  setting: string;
  /**
   * Default when neither env nor settings decide. A plain `boolean` for a
   * fixed default; a thunk (`() => boolean`) for a CONTEXT-DEPENDENT default
   * (e.g. `isInternalDevTestContext`) that must be re-evaluated on every read
   * — NOT computed once when the `FLAGS` object literal is constructed at
   * module load. A thunk baked into a plain boolean at module-load time
   * freezes whatever `NODE_ENV`/`BENCHMARK_MODEL` happened to be set at
   * import time, so a test (or a benchmark harness importing before its env
   * setup) can never observe a context change — the same class of drift as
   * the flag-parity bug this module's `assertVerificationFlagsOrThrow` exists
   * to catch (2026-07-14 real-app source-switch repair). Resolve with
   * `resolveFlagDefault`, never read `.default` directly.
   */
  default: boolean | (() => boolean);
}

/** Resolve a FlagSpec's default, evaluating a thunk lazily on every call. */
function resolveFlagDefault(spec: FlagSpec): boolean {
  return typeof spec.default === 'function' ? spec.default() : spec.default;
}

/** Is this an internal/dev/test/benchmark context (used for OKF default-ON gating)? */
function isInternalDevTestContext(): boolean {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return true;
    if (process.env.BENCHMARK_MODEL) return true;
    if (process.env.NATIVELY_INTERNAL === '1' || process.env.NATIVELY_DEV === '1') return true;
  } catch { /* default false */ }
  return false;
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
  // Phase 0 — observe-only confidence telemetry. Was default OFF everywhere
  // for stability (2026-07-09); the underlying stability issue is resolved
  // (2026-07-14 flag-parity repair) — restored to dev/test/benchmark default-ON
  // (matching okfProfilePacks' precedent) so the benchmark and a real dev-mode
  // Electron run (`npm run electron:dev`, which sets NODE_ENV=development)
  // exercise the same effective flags. Still default OFF in production/packaged
  // builds until validated in the field.
  ragConfidenceGate: { env: 'NATIVELY_RAG_CONFIDENCE_GATE', setting: 'ragConfidenceGateEnabled', default: isInternalDevTestContext },
  // Phase 1 — local cross-encoder rerank escalation (manual/follow-up). Was
  // default OFF for stability (2026-07-09); resolved (2026-07-14) — restored to
  // dev/test/benchmark default-ON. Still OFF in production until validated.
  ragLocalRerank: { env: 'NATIVELY_RAG_LOCAL_RERANK', setting: 'ragLocalRerankEnabled', default: isInternalDevTestContext },
  // Phase 2 — Reciprocal Rank Fusion across heterogeneous retrieval sources. Default OFF.
  ragRrfFusion: { env: 'NATIVELY_RAG_RRF_FUSION', setting: 'ragRrfFusionEnabled', default: false },
  // Phase 3 — allow rerank on the live transcript path (prewarmed + budget-guarded).
  // Default OFF for stability (2026-07-09); enable explicitly after soak testing
  // the local ONNX pressure profile on packaged builds.
  ragSpeculativeRerank: { env: 'NATIVELY_RAG_SPECULATIVE_RERANK', setting: 'ragSpeculativeRerankEnabled', default: false },
  // OKF Hybrid Knowledge System. Was default OFF everywhere for stability
  // (2026-07-09); the underlying issue is resolved (2026-07-14 flag-parity
  // repair) — restored to dev/test/benchmark default-ON (matching
  // okfProfilePacks' precedent) so a real dev-mode Electron run
  // (`npm run electron:dev`) and the benchmark harness exercise identical
  // Context OS behavior. Still default OFF in production until validated.
  okfKnowledgePacks: { env: 'NATIVELY_OKF_KNOWLEDGE_PACKS', setting: 'okfKnowledgePacksEnabled', default: isInternalDevTestContext },
  okfMarkdownExport: { env: 'NATIVELY_OKF_MARKDOWN_EXPORT', setting: 'okfMarkdownExportEnabled', default: isInternalDevTestContext },
  okfHybridRetrieval: { env: 'NATIVELY_OKF_HYBRID_RETRIEVAL', setting: 'okfHybridRetrievalEnabled', default: isInternalDevTestContext },
  // Entity/relation graph layer derived from OKF cards (Phase 4). Default OFF.
  okfGraphExpansion: { env: 'NATIVELY_OKF_GRAPH_EXPANSION', setting: 'okfGraphExpansionEnabled', default: false },
  okfKnowledgeUi: { env: 'NATIVELY_OKF_KNOWLEDGE_UI', setting: 'okfKnowledgeUiEnabled', default: false },
  okfUserEditableCards: { env: 'NATIVELY_OKF_USER_EDITABLE_CARDS', setting: 'okfUserEditableCardsEnabled', default: false },
  // OKF Profile Intelligence — default ON in dev/test/benchmark contexts so the
  // 18-question profile benchmark + test suite exercise the real path; default
  // OFF in production until validated end-to-end. Graph/UI stay OFF everywhere
  // until their phases ship.
  okfProfilePacks: { env: 'NATIVELY_OKF_PROFILE_PACKS', setting: 'okfProfilePacksEnabled', default: isInternalDevTestContext },
  okfProfileHybridRetrieval: { env: 'NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL', setting: 'okfProfileHybridRetrievalEnabled', default: isInternalDevTestContext },
  okfProfileMarkdownExport: { env: 'NATIVELY_OKF_PROFILE_MARKDOWN_EXPORT', setting: 'okfProfileMarkdownExportEnabled', default: isInternalDevTestContext },
  okfProfileGraphExpansion: { env: 'NATIVELY_OKF_PROFILE_GRAPH_EXPANSION', setting: 'okfProfileGraphExpansionEnabled', default: false },
  okfProfileKnowledgeUi: { env: 'NATIVELY_OKF_PROFILE_KNOWLEDGE_UI', setting: 'okfProfileKnowledgeUiEnabled', default: false },
  // Safety isolation gates — ON everywhere by default.
  docGroundedStrictIsolation: { env: 'NATIVELY_DOC_GROUNDED_STRICT_ISOLATION', setting: 'docGroundedStrictIsolationEnabled', default: true },
  // Custom-Mode Source Isolation (2026-07-06, hardening/v2.7.0). Default OFF.
  customModeSourceEnforcement: { env: 'NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT', setting: 'customModeSourceEnforcementEnabled', default: false },
  // NOTE (2026-07-02): the false-refusal REPAIR path is INERT unless
  // `okfHybridRetrieval` is also on — the repair gate keys off the active OKF
  // pack's entity/card-title overlap, which only exists when OKF packs are
  // built. With OKF off, a doc-grounded "not mentioned" is always treated as an
  // honest refusal (the safe fallback) regardless of this flag. Toggling this
  // flag alone (without okfHybridRetrieval) has no effect.
  docGroundedFalseRefusalRepair: { env: 'NATIVELY_DOC_GROUNDED_FALSE_REFUSAL_REPAIR', setting: 'docGroundedFalseRefusalRepairEnabled', default: true },
  // Full-JIT final-answer law (2026-07-07). Was default OFF everywhere for
  // stability (2026-07-09); the underlying issue is resolved (2026-07-14
  // flag-parity repair) — restored to `true` everywhere, matching the original
  // intended policy (full-JIT is the intended production behavior, not a
  // dev/test-only experiment). Flip OFF by env/settings if a regression is
  // found in the field.
  //
  // NOTE — asymmetric with the other 4 restored flags: this is the ONLY one
  // of the five NOT scoped to isInternalDevTestContext() — it affects
  // PRODUCTION traffic too (demotes the AOT-precomputed intro/identity string
  // to an evidence block and routes through a real generation call instead of
  // returning it verbatim — a real latency/behavior change, not a no-op
  // restoration). A future reader should not assume this flag is as
  // conservatively scoped as ragConfidenceGate/ragLocalRerank/
  // okfKnowledgePacks/okfHybridRetrieval, which stay production-OFF.
  jitFinalAnswerEnforced: { env: 'NATIVELY_JIT_FINAL_ANSWER_ENFORCED', setting: 'jitFinalAnswerEnforcedEnabled', default: true },
  // ── Context OS / Source Authority Kernel (2026-07-10) ────────────────────
  // Rollout ladder (docs/context-os/): observe → shadow-block → enforce, per
  // surface. Originally everything defaulted OFF in production pending
  // telemetry validation; the umbrella + observe-only surfaces defaulted ON
  // in dev/test so the contamination suite exercised the real path (same
  // convention as okfProfilePacks).
  //
  // PROMOTED TO PRODUCTION DEFAULT-ON (2026-07-18, grounding campaign): this
  // is the "telemetry validation" the original decision was waiting on. This
  // campaign's live-Electron traces (real MiniMax-M3, real thesis document,
  // no mocking) exercised this exact pipeline end-to-end and found it
  // correct: H4 routing dead zone refuted (all 10 phrasings route
  // correctly), NEW-3 false-refusal fabrication found+fixed, THESIS-091
  // query-dependent recall gap found+fixed, C8 rapid-fire desync tested
  // clean (3/3 runs, zero cross-contamination). The stricter invariant this
  // flag enables (one typed EvidencePack before the provider, no
  // unrestricted raw-retrieval fallback, final-prompt validation) is a
  // hallucination-prevention improvement over the legacy path, promoted ON
  // per explicit user instruction after this evidence was presented.
  // contextOsEnforceSourceCapabilities / contextOsPropertyValidation are
  // SEPARATE, stricter enforcement flags not covered by this promotion — see
  // their own comment below; they remain dev/test-only pending their own
  // dedicated rollout decision.
  contextOsEnabled: { env: 'NATIVELY_CONTEXT_OS', setting: 'contextOsEnabled', default: true },
  contextOsManualChatEnabled: { env: 'NATIVELY_CONTEXT_OS_MANUAL_CHAT', setting: 'contextOsManualChatEnabled', default: true },
  contextOsWtaEnabled: { env: 'NATIVELY_CONTEXT_OS_WTA', setting: 'contextOsWtaEnabled', default: true },
  contextOsRecapFollowupEnabled: { env: 'NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP', setting: 'contextOsRecapFollowupEnabled', default: true },
  contextOsEvidencePackEnabled: { env: 'NATIVELY_CONTEXT_OS_EVIDENCE_PACK', setting: 'contextOsEvidencePackEnabled', default: true },
  contextOsMemorySafetyEnabled: { env: 'NATIVELY_CONTEXT_OS_MEMORY_SAFETY', setting: 'contextOsMemorySafetyEnabled', default: true },
  // Real-custom-mode-repair (2026-07-11), Phase 7: these two flags gate the
  // ONLY code paths that actually ACT on the kernel's decision (the
  // clarification short-circuit and the hard capability gate). Before this
  // fix both defaulted to `false` in EVERY environment, including internal
  // dev/test — so the P0 incident's manual-test run computed the CORRECT
  // sourceOwner=clarify decision but nothing downstream was required to obey
  // it (docs/context-os/real-custom-mode-repair/04_AUTHORITY_CONFLICT_REPORT.md).
  // Now ON by default in dev/test (same convention as the sibling Context OS
  // flags above) so the enforcement path is actually exercised whenever the
  // rest of Context OS is; production stays default OFF until telemetry
  // validates the blocking behavior, per the incident's Phase 7 requirement
  // that "production flags remain safely default-OFF unless deliberately
  // rolled out."
  contextOsEnforceSourceCapabilities: { env: 'NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES', setting: 'contextOsEnforceSourceCapabilitiesEnabled', default: isInternalDevTestContext },
  contextOsPropertyValidation: { env: 'NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION', setting: 'contextOsPropertyValidationEnabled', default: isInternalDevTestContext },
  contextOsMultiFamilyEvidenceEnabled: { env: 'NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE', setting: 'contextOsMultiFamilyEvidenceEnabled', default: isInternalDevTestContext },
  // Default false (not isInternalDevTestContext) even in dev/test — unlike
  // the Context OS flags above, this one's live-fire behavior was PROVEN to
  // regress real answers in run-032 (see the flag's doc comment). Dev/test
  // should observe the same off-by-default state as production until the
  // classifier is recalibrated against real traffic; it must not be
  // silently exercised by every dev-context test run the way the Context OS
  // rollout flags intentionally are.
  answerRelevanceGuardLive: { env: 'NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE', setting: 'answerRelevanceGuardLiveEnabled', default: false },
  turnIdentityV2: { env: 'NATIVELY_TURN_IDENTITY_V2', setting: 'turnIdentityV2Enabled', default: isInternalDevTestContext },
  promptComposerV2: { env: 'NATIVELY_PROMPT_COMPOSER_V2', setting: 'promptComposerV2Enabled', default: isInternalDevTestContext },
  canonicalTurnManualChat: { env: 'NATIVELY_CANONICAL_TURN_MANUAL_CHAT', setting: 'canonicalTurnManualChatEnabled', default: isInternalDevTestContext },
  atomicJdProfilePackGeneration: { env: 'NATIVELY_ATOMIC_JD_PROFILE_PACK', setting: 'atomicJdProfilePackGenerationEnabled', default: isInternalDevTestContext },
  assistantClaimsEnforcement: { env: 'NATIVELY_ASSISTANT_CLAIMS_ENFORCEMENT', setting: 'assistantClaimsEnforcementEnabled', default: isInternalDevTestContext },
  pronounRegexShadowObservation: { env: 'NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION', setting: 'pronounRegexShadowObservationEnabled', default: isInternalDevTestContext },
  modePolicyShadowObservation: { env: 'NATIVELY_MODE_POLICY_SHADOW_OBSERVATION', setting: 'modePolicyShadowObservationEnabled', default: isInternalDevTestContext },
  contextOsImpossibleStateGateShadow: { env: 'NATIVELY_CONTEXT_OS_IMPOSSIBLE_STATE_GATE_SHADOW', setting: 'contextOsImpossibleStateGateShadowEnabled', default: isInternalDevTestContext },
  contextOsImpossibleStateGateEnforceForbidden: { env: 'NATIVELY_CONTEXT_OS_IMPOSSIBLE_STATE_GATE_ENFORCE_FORBIDDEN', setting: 'contextOsImpossibleStateGateEnforceForbiddenEnabled', default: isInternalDevTestContext },
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
  return resolveFlagDefault(FLAGS[key]);
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
 * True when the full-JIT final-answer law is enforced: AOT intro/identity/
 * greeting text is demoted to evidence and the provider writes every
 * user-visible final answer. Default ON. Flip OFF to restore the legacy
 * AOT-emit fast paths.
 */
export const isJitFinalAnswerEnforced = (): boolean =>
  isIntelligenceFlagEnabled('jitFinalAnswerEnforced');

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

/** True when uploaded reference files should be indexed into OKF Knowledge Packs. */
export const isOkfKnowledgePacksEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfKnowledgePacks');

/** True when a generated Knowledge Pack may be exported as an OKF v0.1 Markdown bundle. */
export const isOkfMarkdownExportEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfMarkdownExport');

/** True when OKF cards should be consulted (alongside raw chunks) in document-grounded retrieval. */
export const isOkfHybridRetrievalEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfHybridRetrieval');

/** True when the entity/relation graph layer derived from OKF cards may expand retrieval (Phase 4). */
export const isOkfGraphExpansionEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfGraphExpansion');

/** True when the Knowledge Pack inspector UI is shown (Phase 5). */
export const isOkfKnowledgeUiEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfKnowledgeUi');

/** True when users may edit/approve/reject generated Knowledge Cards (Phase 6). */
export const isOkfUserEditableCardsEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfUserEditableCards');

/** True when a profile OKF Knowledge Pack should be generated on resume/JD ingest. */
export const isOkfProfilePacksEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfProfilePacks');

/** True when profile OKF cards may contribute to answer evidence (still fail-closed on route/policy). */
export const isOkfProfileHybridRetrievalEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfProfileHybridRetrieval');

/** True when a profile Knowledge Pack may be exported as an OKF v0.1 Markdown bundle. */
export const isOkfProfileMarkdownExportEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfProfileMarkdownExport');

/** True when the profile entity/relation graph layer may expand retrieval (Phase 4). */
export const isOkfProfileGraphExpansionEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfProfileGraphExpansion');

/** True when the profile Knowledge Pack inspector UI is shown (Phase 5). */
export const isOkfProfileKnowledgeUiEnabled = (): boolean =>
  isIntelligenceFlagEnabled('okfProfileKnowledgeUi');

/**
 * True when document-grounded custom modes must positively isolate retrieval
 * evidence from Hindsight/profile/persona/general-knowledge context. Default
 * ON everywhere — this is a safety gate, not an experimental feature.
 */
export const isDocGroundedStrictIsolationEnabled = (): boolean =>
  isIntelligenceFlagEnabled('docGroundedStrictIsolation');

/**
 * True when a single bounded regeneration attempt is allowed for a detected
 * false refusal ("I could not find that...") when strong evidence exists in
 * the retrieved context. Default ON everywhere.
 */
export const isDocGroundedFalseRefusalRepairEnabled = (): boolean =>
  isIntelligenceFlagEnabled('docGroundedFalseRefusalRepair');

export function getSourceOwnerEnforcementStage(): SourceOwnerEnforcementStage {
  try {
    const raw = (process.env.NATIVELY_SOURCE_OWNER_ENFORCEMENT_STAGE || '').trim().toLowerCase();
    if (raw === 'off' || raw === 'observe' || raw === 'soft_block' || raw === 'enforce') return raw;
    if (isIntelligenceFlagEnabled('customModeSourceEnforcement')) return 'enforce';
  } catch {
    /* fall through */
  }
  return 'observe';
}

export function isSourceOwnerEnforcementBlocking(): boolean {
  const stage = getSourceOwnerEnforcementStage();
  return stage === 'soft_block' || stage === 'enforce';
}

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

// ── Flag-parity verification (2026-07-14 real-app source-switch repair) ────
//
// Root cause of the reported benchmark-vs-real-app divergence: five flags
// (ragConfidenceGate/ragLocalRerank/okfKnowledgePacks/okfHybridRetrieval/
// jitFinalAnswerEnforced) were hardcoded `default: false` during a 2026-07-09
// stability rollback, while the benchmark harness relied on the pre-rollback
// dev/test-default-ON behavior — so the SAME build + user configuration
// produced DIFFERENT effective Context OS behavior depending on which surface
// asked. `intelligenceFlagSnapshot()` is the one canonical read every surface
// (benchmark harness, Electron main, renderer diagnostics via the
// `intelligence-flags:get` IPC handler, backend diagnostics) must call — never
// re-derive flag state locally. This section adds an explicit startup
// assertion so a FUTURE regression of this kind fails loudly instead of
// silently, for internal verification builds only.

/**
 * The flags a verification build expects to be ON. Kept as a short, explicit
 * list rather than "every isInternalDevTestContext() flag" so this assertion is
 * legible and doesn't silently grow/shrink as unrelated flags are added. The
 * Context OS core entries are production-default-ON; the retrieval/OKF entries
 * remain a verification-only expectation because production deliberately keeps
 * those higher-cost augmentations opt-in.
 */
export const REQUIRED_CONTEXT_OS_FLAGS_FOR_VERIFICATION: IntelligenceFlagKey[] = [
  'ragConfidenceGate',
  'ragLocalRerank',
  'okfKnowledgePacks',
  'okfHybridRetrieval',
  'jitFinalAnswerEnforced',
  'contextOsEnabled',
  'contextOsManualChatEnabled',
  'contextOsWtaEnabled',
  'contextOsRecapFollowupEnabled',
  'contextOsEvidencePackEnabled',
  'contextOsMemorySafetyEnabled',
];

/**
 * True only when the process has explicitly opted into verification-mode
 * assertions (`NATIVELY_VERIFICATION_MODE=1`). Never true by default — this
 * must never affect a normal user boot, a packaged build, or an ordinary dev
 * session; it is an opt-in internal check for benchmark/CI/soak runs that want
 * to FAIL FAST if the effective Context OS flags don't match what the
 * verification run assumes.
 */
export function isVerificationModeEnabled(): boolean {
  try {
    return (process.env.NATIVELY_VERIFICATION_MODE || '').trim() === '1';
  } catch {
    return false;
  }
}

/**
 * Assert that every flag in `REQUIRED_CONTEXT_OS_FLAGS_FOR_VERIFICATION` is
 * enabled in THIS process's effective snapshot. No-ops (returns immediately)
 * unless verification mode is explicitly enabled. Throws — rather than
 * logging — so a verification/benchmark/CI run fails immediately and loudly
 * instead of silently exercising a different code path than it believes it
 * is testing. Call once at startup (Electron main, after app.whenReady(); a
 * benchmark harness process at its own entry point).
 */
export function assertVerificationFlagsOrThrow(): void {
  if (!isVerificationModeEnabled()) return;
  const snapshot = intelligenceFlagSnapshot();
  const missing = REQUIRED_CONTEXT_OS_FLAGS_FOR_VERIFICATION.filter((flag) => !snapshot[flag]);
  if (missing.length > 0) {
    throw new Error(
      `Context OS verification started with required flags disabled: ${missing.join(', ')}. `
      + 'Set NATIVELY_VERIFICATION_MODE=0 to run without this check, or fix the flag defaults/env.',
    );
  }
}

/** The SettingsManager key + env var name backing a flag (for a settings UI). */
export function intelligenceFlagMeta(key: IntelligenceFlagKey): { setting: string; env: string; default: boolean } {
  const f = FLAGS[key];
  return { setting: f.setting, env: f.env, default: resolveFlagDefault(f) };
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
      const isExplicit = value !== resolveFlagDefault(spec);
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
