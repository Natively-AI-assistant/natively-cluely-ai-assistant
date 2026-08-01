# Context Intelligence Debug Logging — implementation report (2026-08-01)

## Architecture: existing flow → canonical flow

**Existing:** one `[V3]` console line per turn (engine-bridge.ts, single site) built from
`AnswerTrace` + `TurnDecision`; console-only (reaches disk only via main.ts's console
monkey-patch into natively_debug.log); generation timing/final answer/commit status never
correlated with the decision half; ingestion progress logged as unstructured warns; no JSONL.

**New:** `electron/context-intelligence/debug/` — six modules:
- `debug-types.ts` — canonical schema, `CONTEXT_DEBUG_SCHEMA_VERSION = 1`
  (`context_turn_complete`, `context_ingest_complete`). Adapts AnswerTrace/TurnDecision/
  EvidenceItem verbatim; recomputes nothing. knowledgePolicy uses the repo's GroundingPolicy
  vocabulary (incl. STRICT_SOURCE_ONLY) — deliberately NOT the spec's STRICT_REFERENCE, to keep
  one vocabulary. answerability is the runtime's 4-value enum (adds CONFLICTING).
- `redaction.ts` — THE centralized redaction: `redactSecrets` (always, incl. unsafe mode),
  `redactPii` (standard/verbose), `buildPreview` (240-char cap + truncation marker),
  `deepRedactStrings` (last-line-of-defence at every sink).
- `debug-config.ts` — level resolution env(NATIVELY_CONTEXT_DEBUG) > setting > off;
  content mode requires dev build + verbose + NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT=1;
  production/unbound fails CLOSED. Bound via `bindContextDebugConfig` (main.ts) — the module
  never imports SettingsManager.
- `jsonl-writer.ts` — append-only, one JSON object per line (crash-safe), serialized promise
  chain, bounded queue (500, drops counted), 50MB rotation, retain-10 retention, injectable
  directory, never throws.
- `turn-collector.ts` — `ContextDebugTurnCollector`, registry keyed by requestId on globalThis
  (NO mutable current-turn global; concurrent turns isolated; MAX 32 live with finalize-on-evict);
  snapshot-based; idempotent complete(); tolerates missing stages.
- `terminal.ts` — `[CONTEXT_DEBUG_TURN]` / `[CONTEXT_DEBUG_INGEST]` human-readable blocks; one
  block per turn, never per token. `ingest-debug.ts` — ingest event builder.

**Correlation:** identity {sessionId, meetingId?, turnId, requestId, conversationGeneration,
modeId, modeUniqueId?, surface} created in engine-bridge from the same values the [V3] line uses.
Manual-chat passes `deferDebugCompletion: true`; ipcHandlers looks the collector up by
`BridgeResult.debugRequestId` and records generation start / first token (TFFT) / final answer /
commit status at every exit path (done-emit, supersession, mode-change suppression, stream throw).
Other surfaces (WTA/assist) emit decision-only records finalized by the bridge with
commitRejectedReason='answer_not_correlated_on_this_surface'.

**Reused, not duplicated:** AnswerTrace (question/mode/plan/retrieval/answerability/fallback/
claimPlan), TurnDecision, port evidence metadata (status via detectDocumentStatus), the
[V3] documentSpecific/propertyMatched computation, existing ingest counters. Small additive
production changes to EXPOSE existing telemetry (no behavior change):
- conversation-state.ts: `ResolvedReference.reason` (typed reason enum).
- orchestrator.ts: optional `AnswerTrace.referentResolution` snapshot (pre-advance state).
- legacy-retrieval-port.ts: post-adapter drops (PLANNED_TYPE_FILTER / CLAIM_AUTHORITY /
  SCORE_CAP) added to the existing attempt-trace `rejections` — previously silent, "20 admitted,
  0 evidence" was unexplainable.
- ModeHybridRetriever.indexFileInner: emits the ingest event at each terminal state (level-gated).

## Files changed

Core (new): context-intelligence/debug/{debug-types,debug-config,redaction,jsonl-writer,
turn-collector,terminal,ingest-debug}.ts. Wiring: engine-bridge.ts (collector + debugSources/
deferDebugCompletion inputs + debugRequestId output), ipcHandlers.ts (debug source identity list,
generation/commit hooks, 5 `context-debug:*` IPC handlers beside the log handlers), main.ts
(startup binding to app.getPath('logs')/context-debug — ~/Library/Logs/<app> on macOS as spec'd —
startup content-mode warning, before-quit flush), SettingsManager.ts (contextDebugLevel +
validated getter/setter per screenUnderstandingMode precedent), preload.ts + electron.d.ts
(5 API methods, both type copies), IntelligenceSettings.tsx (ContextDebugSection inside the
existing Developer-options disclosure: Off/Standard/Verbose segmented control with env-override
annotation + disable, Open Folder, Copy Path (CopyBlock), Export (flush + reveal — never
uploads), Clear (ConfirmDialog), privacy text, content-mode warning banner). Production changes
to expose telemetry: conversation-state.ts, orchestrator.ts, answer-trace.ts,
legacy-retrieval-port.ts, ModeHybridRetriever.ts.

## Privacy

- Standard: full question + final answer + identity/counts/scores; no chunk/transcript/prompt
  text (asserted). Verbose: adds query strings, rejected evidence, scoring, previews (240-char,
  secret+PII-scrubbed, marked). Unsafe content mode: dev build + verbose + env flag only;
  packaged builds ignore the flag (getContentInclusionEnabled fails closed, incl. when unbound);
  startup prints [CONTEXT_DEBUG_WARNING]; secrets STILL scrubbed.
- deepRedactStrings runs over the whole record at the sink — PII inside the question/answer text
  itself is masked at standard/normal-verbose (privacy fixture tests).
- Logs stay local; "Export" reveals the file in the file manager, uploads nothing.

## Performance (measured, scratchpad/perf-debug.mjs)

- Off: 0.15 µs/turn (one level check; no objects constructed).
- Standard: 0.060 ms/turn synchronous collector work; avg record 3.1 KB.
- Verbose: 0.165 ms/turn; avg record 5.8 KB. (Budget: <2 ms.)
- File writes: queued off the streaming path (serialized promise chain, bounded 500); JSON
  stringify happens once at complete(), after the done-emit.
- No extra model calls, embeddings, or retrieval at any level (collector observes only).

## Tests (electron/context-intelligence/__tests__/ContextDebugLogging2026_08_01.test.mjs — 31/31)

Level parsing; env precedence both directions; production content rejection (pure + live
binding); reader-throw degradation; secrets/PII redaction; preview truncation; deep redaction;
JSONL validity mid-session; size rotation; retention; write-failure isolation; bounded queue;
collector correlation + schema stability; concurrent-turn isolation; missing-stage finalization;
idempotent complete; standard exclusions; verbose inclusions (redacted); privacy fixtures at both
levels; precedence serialization (ACTIVE_SOURCE/SUPERSEDED_SOURCE); rejected-evidence stage
mapping; bridge integration (correlated record with question/plan/evidence/answer/TFFT);
follow-up state (Leena → PRONOUN_RESOLVED_TO_ACTIVE_PERSON); explicit entity (CampusMesh →
CURRENT_QUESTION_CONTAINS_EXPLICIT_ENTITY); OFF mode (no collector/no record/no debug file);
writer failure not failing the turn; ingest READY/PARTIAL/FAILED/off.
Commands: `node scripts/build-electron.js && node --test electron/context-intelligence/__tests__/ContextDebugLogging2026_08_01.test.mjs`.
Full V3 sweep after wiring: 487 tests, 485 pass — the 2 fails are the KNOWN pre-existing
AnswerPolicy parallel-run store collision (passes in isolation, present before this feature).
tsc clean on both tsconfigs. Retriever suites re-run green.

## Remaining risks / not fully verified

1. Live in-app run (real Electron, real provider) not executed here — the acceptance run of the
   Deep Mode Test Pack under NATIVELY_CONTEXT_DEBUG=verbose should be done in-app; every field it
   needs is asserted present by the offline integration tests.
2. WTA/assist/transcript surfaces emit decision-only records (no final answer correlation) —
   manual chat is fully correlated per the spec's primary goal; wiring WhatToAnswerLLM's stream
   completion is a follow-up.
3. Profile Intelligence ingestion (premium KnowledgeOrchestrator) does not yet emit
   context_ingest_complete — mode-file ingestion does; profile ingest diagnostics remain the
   existing console logs.
4. requestedEntity/requestedProperty fields are omitted (no production component computes them
   post-classifier; the schema carries claimTypes + propertyMatched instead — honest, not
   recomputed).
5. Renderer commit (the UI actually painting the answer) is approximated by the main-process
   done-emit + supersession guards; a renderer-side ack would need a new IPC round-trip.
6. Legacy (non-V3) turns produce no debug records — V3 is default-on, and the spec forbids
   removing legacy logs before parity anyway (nothing was removed).
