# Ingest hellointerview content as a persistent lesson knowledge base

**Labels:** `wayfinder:task`
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)
**Blocked by:** 06, 07

## Question

The user's system-design study material lives at hellointerview.com. Ingest it into the knowledge pipeline as a persistent, curated corpus (not session-scoped like resume/JD), and retrieve it during system-design turns to ground the substance of each Deep Dive with hellointerview's actual patterns, capacity numbers, and canonical answers.

## Scope

### Storage (reuses ticket 05/06 pipeline — decision A)
- Add `LESSON = 'lesson'` to the `DocType` enum (`electron/knowledge/types.ts`)
- `lesson` documents are **persistent / global** — NOT wiped when a trial ends or profile is cleared (unlike RESUME/JD). Confirm the trial-teardown path in `App.tsx` (~line 561) and the `deleteDocumentsByType` callers do not delete `lesson` docs.
- Ingested via the same `ingestDocument` path (parse → chunk → embed → store), skipping the resume/JD structured-extraction step (lessons need chunks + embeddings only, no `structured_data`).

### Ingestion input
- Content acquisition (how the hellointerview pages become local files: manual save as MD/TXT/PDF, or a scrape) is a **separate manual step the user performs** — this ticket consumes local files, it does not scrape the site. The reference-file formats from ticket 06 (PDF/DOCX/TXT/MD) are the input.
- Provide an ingestion entry point: either a new IPC channel `knowledge:ingest-lesson(filePath)` or a folder-watch on a `lessons/` dir. Decide during implementation; IPC is the lazier fit with the existing `profile:upload-*` pattern.

### Retrieval + injection
- During a system-design turn (reuse the existing `SYSTEM_DESIGN_PATTERNS` detection in `AnswerPlanner`), retrieve top-k `lesson` chunks via `queryRelevantChunks(query, { docType: LESSON })`
- Inject retrieved chunks into `MODE_TECHNICAL_INTERVIEW_PROMPT` using the existing `<reference_file>` / `<injected_context>` mechanism (~line 2079), so the framework skeleton (ticket 07) stays fixed while the Deep Dives are grounded in real hellointerview substance
- Retrieval scoped to `doc_type = 'lesson'` so lesson content never contaminates profile/behavioral answers

## Dependency note

Blocked by 06 (needs the KnowledgeOrchestrator pipeline + `queryRelevantChunks`) and 07 (needs the framework skeleton as the injection target).

## Answer

### 1. Multi-document LESSON support
`KnowledgeDatabaseManager.appendDocument(doc)` added: deletes only the row with the
SAME `(doc_type, file_path)` (idempotent re-upload of one file) then inserts —
never wiping the rest of the corpus. `upsertDocument` (singleton delete-then-insert)
is unchanged for RESUME/JD. Vec-row reaping was factored into a shared private
`reapVecRows()` used by `appendDocument` (via `deleteByFilePath`) and `deleteByDocType`.
`KnowledgeOrchestrator.ingestDocument` routes `DocType.LESSON` → `appendDocument`
(and skips structured extraction — lessons are chunks + embeddings only);
RESUME/JD → `upsertDocument`.

### 2. Ingestion entry point
New IPC channel `knowledge:ingest-lesson(filePath)` in `ipcHandlers.ts` (after
`profile:delete-jd`). Consumes a LOCAL path via the existing
`consumeSelectedProfilePath` nonce (registered by `profile:select-file`) — same
trust boundary as the resume/JD uploads — then calls
`orchestrator.ingestDocument(path, DocType.LESSON)`. Supports PDF/DOCX/TXT/MD via
`SafeDocumentTextExtractor` (reused from ticket 06). Does NOT scrape any site.
Exposed as `knowledgeIngestLesson` in `electron/preload.ts` and typed in
`src/types/electron.d.ts`, following the `profileUploadJD` pattern.

### 3. Persistence-safety audit (result)
- All `deleteDocumentsByType` callers delete ONLY `RESUME`/`JD`, never `LESSON`
  (ipcHandlers lines ~5540/41, ~5608/09, 8757, 8883, 10928/29; the `__e2e__:clear-profile`
  and re-extract handlers likewise). No "delete all knowledge" typed path exists.
- **Bug found + fixed:** both trial-teardown handlers (`trial:end-byok` and
  `trial:wipe-profile-data`) did a RAW `DELETE FROM knowledge_documents` that wiped
  the whole table — LESSON included — undoing the persistence guarantee. Scoped both
  to `DELETE FROM knowledge_documents WHERE doc_type != 'lesson'` (still cascades
  RESUME/JD chunks; LESSON corpus survives trial end). `App.tsx` (~561) only calls
  `wipeTrialProfileData` → that handler, now LESSON-safe; no direct main.ts DB wipe exists.

### 4. Retrieval + injection (system-design turns)
In `WhatToAnswerLLM.ts`, right after mode-context resolution (before the token-budget
calc so the block is counted), when `answerPlan.answerType === 'system_design_answer'`
(the planner's result of `SYSTEM_DESIGN_PATTERNS`), retrieve top-5 LESSON chunks via
`orchestrator.queryRelevantChunks(query, DocType.LESSON, 5)` — scoped strictly to
`doc_type='lesson'` so lesson content never reaches profile/behavioral answers —
and append them to `modeContextBlock` as a `<reference_file name="hellointerview-system-design.md">`
block. This reuses the EXISTING `retrievedModeContext` → `<reference_file>` mechanism
(the technical-interview prompt's `<injected_context>` already documents study-notes
reference files); no new injection path, and the ticket-07 framework text is untouched.
Retrieval is bounded by `HYBRID_RETRIEVAL_BUDGET_MS` (via `raceWithBudget`) and
best-effort — a miss leaves the framework ungrounded rather than stalling first-token.

### 5. Shim removal
Repointed all 8 `require('../premium/electron/knowledge/types')` in `ipcHandlers.ts`
to `require('./knowledge/types')` and DELETED the `premium/electron/knowledge/types.ts`
shim created in ticket 06. No source file imports DocType from the premium path anymore.

### Files changed / created
- `electron/knowledge/KnowledgeDatabaseManager.ts` — `appendDocument`, `deleteByFilePath`, `reapVecRows`.
- `electron/knowledge/KnowledgeOrchestrator.ts` — LESSON → append routing.
- `electron/llm/WhatToAnswerLLM.ts` — system-design lesson grounding block.
- `electron/ipcHandlers.ts` — `knowledge:ingest-lesson` handler, DocType require repoint (×8), LESSON-safe trial wipes (×2).
- `electron/preload.ts`, `src/types/electron.d.ts` — `knowledgeIngestLesson` exposure/type.
- Deleted `premium/electron/knowledge/types.ts`.

### Verification
- `tsc -p electron/tsconfig.json --noEmit` → **0 errors**; `tsc -p tsconfig.json --noEmit`
  (renderer, covers the d.ts) → **0 errors**.
- Isolated logic self-check: LESSON corpus accumulates across files, re-ingest of the
  same file is idempotent, RESUME/JD stay singleton, and trial-wipe removes RESUME/JD
  while preserving all LESSON docs — passes.
- Per ticket, full esbuild build + runtime tests deferred; `npm install` blocked in this env.
