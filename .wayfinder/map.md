# Natively Pro Features — Open Source Reimplementation

**Labels:** `wayfinder:map`

## Destination

All Pro features working locally in this build without the private `premium/` submodule. Six features implemented as open-source equivalents; the license gate unconditionally bypassed so nothing requires a key. Plus: the technical-interview mode delivers system-design answers following hellointerview's exact Delivery Framework, grounded in the user's ingested hellointerview content.

## Notes

- Domain: Electron (main process TypeScript) + React/Vite renderer (`src/`)
- Consult `electron/premium/featureGate.ts` for the gate entry point
- Consult `electron/ipcHandlers.ts` for all IPC channel wiring
- Consult `electron/main.ts` lines 1036–2240 for KnowledgeOrchestrator init/wiring
- Consult `electron/db/DatabaseManager.ts` for existing SQLite schema
- Consult `src/premium/index.tsx` for the renderer premium stub loader
- Each ticket is one implementation session; do them in dependency order (gate first, then knowledge stack, then UI features)
- Implementation tickets (type: `task`) — the map carries execution per Notes override

## Open tickets (frontier → blocked)

_All 8 tickets closed. Map complete pending the consolidated build/test verification pass._

## Decisions so far

- [Bypass the premium license gate unconditionally](tickets/01-license-gate-bypass.md) — `isProOrTrialActive()` → `return true` (the one real gate, 30 call sites); `isPremiumAvailable()` → `true` safely; `main.ts` untouched (already boots with empty `premium/`).
- [Design and migrate the knowledge document SQLite schema](tickets/05-knowledge-db-schema.md) — migration v26 adds `knowledge_documents` / `knowledge_chunks` / `vec_knowledge_chunks_{dim}`; new `electron/knowledge/{types.ts,KnowledgeDatabaseManager.ts}`; space-key on chunks directly, fail-closed vector search.
- [Implement ModesSettings UI panel](tickets/03-modes-settings-ui.md) — full React rewrite of `ModesSettings.tsx` (list + editor, Custom Context/Notes textarea capped 8000, template dropdown from `ModeTemplateType`); consumes existing `modes*` channels; `HelpSettings.tsx` paywall copy corrected.
- [Enable speaker diarization in the UI](tickets/02-speaker-diarization-enable.md) — flag `speakerDiarizationV1` was already wired end-to-end; only needed a `FLAG_META` entry in `IntelligenceSettings.tsx` to surface the toggle. Method is `setDiarization` (not `setDiarize`). Applies on next meeting start.
- [Encode the hellointerview Delivery Framework into the system-design prompt](tickets/07-system-design-delivery-framework.md) — `<system_design>` block + `<output_contract>` line in `prompts.ts` rewritten to the six-step Delivery Framework (Requirements → Core Entities → API → optional Data Flow → High-Level Design → Deep Dives); one canonical framework, spoken-voice, header-free.
- [Implement OSS KnowledgeOrchestrator](tickets/06-knowledge-orchestrator.md) — new `electron/knowledge/KnowledgeOrchestrator.ts` (parse via `SafeDocumentTextExtractor`, LLM structured extract, ~500-tok chunking, fail-closed space-scoped retrieval, negotiation/cover-letter/company-research stubbed null); wired into `main.ts`. Left a `DocType` re-export shim in `premium/` — ticket 08 repoints `ipcHandlers` to `./knowledge/types` and deletes it.
- [Implement NegotiationCoachingCard UI stub](tickets/04-negotiation-coach-ui.md) — new `src/components/NegotiationCoachingCard.tsx` (generate button, loading + graceful empty-state for the null orchestrator stub); `NativelyInterface.tsx` imports it directly instead of via `../premium`. Full `tsc --noEmit` clean (node_modules now present).
- [Ingest hellointerview content as a persistent lesson knowledge base](tickets/08-system-design-lesson-kb.md) — `appendDocument` for multi-doc LESSON corpus (singleton kept for RESUME/JD); `knowledge:ingest-lesson` IPC channel; top-5 LESSON-scoped retrieval injected as a `<reference_file>` block in `WhatToAnswerLLM` on `system_design_answer` turns; repointed 8 `DocType` requires + deleted the premium shim. **Fixed a real bug:** trial-teardown handlers did a raw `DELETE FROM knowledge_documents` that wiped lessons — scoped to `WHERE doc_type != 'lesson'`.

- **Mid-meeting live diarization toggle** — currently the toggle applies on next meeting start. To apply mid-meeting, add a `public setDiarization(enabled)` fan-out on `AppState` (mirroring `setRecognitionLanguage`) and have `intelligence-flags:set` call it. Deferred from ticket 02 because `main.ts` was owned by ticket 06 concurrently. Do after 06 lands if the mid-meeting case matters.

## Verification status (READ BEFORE MERGE)

All 8 tickets are IMPLEMENTED. Verification is INCOMPLETE — the authoritative build/test pass has NOT run.

- **What was checked:** static integration cross-checks all pass — premium `DocType` shim deleted, no lingering `premium/.../types` requires, `main.ts` + `ipcHandlers` repointed to `./knowledge/*`, gate returns `true`, migration v26 present, trial wipes scoped `!= 'lesson'`, lesson retrieval wired in `WhatToAnswerLLM` on `system_design_answer`, `knowledge:ingest-lesson` wired preload→d.ts→handler, framework rewritten in `prompts.ts`, both renderer stubs de-premium'd. Agents also reported `tsc --noEmit` clean (soft — ran against a partial/global toolchain).
- **What did NOT run:** `npm run build:electron` (esbuild bundle), the project's pinned `tsc`, and `node --test` DB migration tests. `node_modules` in this environment is a broken/partial install (empty `esbuild/`, no `better-sqlite3` native binary, no `.bin/tsc`), and `npm install` is blocked here.
- **Owed by the user before merge:** a clean `npm install` (the project `.npmrc` now pins public npm — `registry=https://registry.npmjs.org/`), then `npm run build:electron`, both `tsc --noEmit` configs, and `node --test`. The esbuild bundle is the important one — it resolves the remaining premium requires (`LicenseManager`, `TavilySearchProvider`, `NativelySearchProvider`, `NegotiationConversationTracker`) that are still empty in this OSS checkout and only surface at bundle time, not at `tsc`.

## Follow-ups (optional, non-blocking)

- **Remaining empty premium requires:** `ipcHandlers`/`main.ts` still `require` `LicenseManager`, `TavilySearchProvider`, `NativelySearchProvider`, `NegotiationConversationTracker` from the empty `premium/` submodule (all inside try/catch, so they degrade to "feature off"). The esbuild `bundle:true` build may still choke on unresolved paths — confirm at the build pass; if so, apply the same OSS-stub-or-repoint treatment used for `DocType`.

## Not yet specified

- How to surface diarization toggle in settings UI (toggle exists in DeepgramStreamingSTT, needs a settings knob wired through IPC)
- Whether NegotiationCoachingCard needs its own full UI or just a minimal "coming soon" stub pointing at the wired IPC

## Out of scope

- Phone Link Companion App — requires external mobile app infrastructure
- Auto-Calendar & Task Sync — requires external calendar service credentials
- Hindsight Long-Term Memory — requires full KnowledgeOrchestrator + vector DB beyond resume/JD scope
- Company Research & Dossiers — requires Tavily API key and separate research engine
- Keyboard detection bypass — already solved via CGEventTap / Carbon globalShortcut layer; nothing to build
