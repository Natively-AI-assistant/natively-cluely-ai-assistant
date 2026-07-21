# Implement OSS KnowledgeOrchestrator

**Labels:** `wayfinder:task`  
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)  
**Blocked by:** 05  
**Blocks:** 04

## Question

The premium `KnowledgeOrchestrator` is the core of resume/JD/reference file support. How should the OSS reimplementation be structured to satisfy the full interface expected by `ipcHandlers.ts` and `main.ts`?

## Scope

### File location
`electron/knowledge/KnowledgeOrchestrator.ts` — loaded in `main.ts` replacing the premium require

### Interface to satisfy (from ipcHandlers + main.ts usage)

**Properties:**
- `activeResume: { structured_data: ResumeStructuredData | null }`
- `activeJD: { structured_data: JDStructuredData | null }`

**Methods:**
- `ingestDocument(filePath: string, docType: DocType): Promise<{ success: boolean; error?: string }>`
- `deleteDocumentsByType(docType: DocType): void`
- `getStatus(): KnowledgeStatus`
- `setKnowledgeMode(enabled: boolean): void`
- `isKnowledgeMode(): boolean`
- `getProfileData(): { resume: any; jd: any } | null`
- `setEmbedFn(fn: (text: string) => Promise<number[]>): void`
- `setEmbedWithMetadataFn(fn: any): void`
- `setEmbedQueryFn(fn: (text: string) => Promise<number[]>): void`
- `setFastQueryEmbedFn(fn: any): void`
- `setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void`
- `setLiveCoachingContentFn(fn: any): void`
- `setConversationContextProvider(fn: () => any): void`
- `setActiveSpaceFn(fn: () => any): void`
- `ensureEmbeddingSpace(): Promise<void>`
- `queryRelevantChunks(query: string, limit?: number): Promise<ChunkResult[]>`
- **Stubs (return null/empty):** `generateNegotiationScriptOnDemand()`, `getNegotiationScript()`, `getCoverLetter()`, `getCompanyResearchEngine()`

### Document parsing
- PDF: `pdfjs-dist` (already used in ipcHandlers, worker src pin already exists)
- DOCX: `mammoth` (already in package.json)
- TXT / MD: `fs.readFile` + utf-8 decode

### Structured extraction (resume only)
- Call `generateContentFn` with a structured extraction prompt → parse JSON response into `ResumeStructuredData` shape: `{ identity: { name, email, phone, location }, experience: [...], projects: [...], skills: { ... } }`
- JD: lighter extraction — `{ role, company, requirements: [...], responsibilities: [...] }`

### Chunking
- Split raw text into ~500 token overlapping chunks (200 token overlap)
- Embed each chunk via `embedFn`
- Store via `KnowledgeDatabaseManager.saveChunks`

### Retrieval
- `queryRelevantChunks`: embed query → `KnowledgeDatabaseManager.queryChunksByEmbedding` → top-k results
- Called from `ipcHandlers.ts` answer flow where `orchRouter` is checked

### Wiring in main.ts
- Replace the premium require block (lines 1036–1044) with a require of `./knowledge/KnowledgeOrchestrator`
- Same for `KnowledgeDatabaseManager` → `./knowledge/KnowledgeDatabaseManager`
- `DocType` → `./knowledge/types`

## Answer

### Files

- **Created** `electron/knowledge/KnowledgeOrchestrator.ts` — the OSS orchestrator.
- **Created** `premium/electron/knowledge/types.ts` — one-line re-export shim
  (`export { DocType } from '../../../electron/knowledge/types'`). Required because
  `ipcHandlers.ts` (which the ticket forbids editing) statically requires `DocType`
  from `../premium/electron/knowledge/types` in 8 profile handlers, and the build
  bundles (`bundle: true`) so that path must resolve. The real premium submodule
  supersedes it when checked out.
- **Changed** `electron/knowledge/KnowledgeDatabaseManager.ts` — added
  `hasChunksOutsideSpace(docType, activeSpace)` for the re-embed self-heal.
- **Changed** `electron/main.ts` — premium require block (~1040–1047) now resolves
  `KnowledgeOrchestratorClass` / `KnowledgeDatabaseManagerClass` from
  `./knowledge/...`; `textHasCompEvidence` kept in a nested try/catch (premium-only,
  stays null in OSS so `setConversationContextProvider` degrades to no hint).

### Interface coverage (every ipcHandlers + main.ts call site)

Properties `activeResume` / `activeJD` (shape `{ id?, source_uri?, created_at?,
updated_at?, structured_data }` — matches `ActiveProfileContext` +
`profileAnswerBackend`). Methods: `ingestDocument`, `deleteDocumentsByType`,
`getStatus` (`{ hasResume, hasJD, activeMode, resumeSummary }`), `setKnowledgeMode`
/ `isKnowledgeMode`, `getProfileData` (`{ resume, jd, activeResume, activeJD,
hasActiveResume, hasActiveJD }`), `queryRelevantChunks` (overloaded
`(q, limit)` / `(q, docType, limit)`), `ensureEmbeddingSpace`, and all setters:
`setEmbedFn`, `setEmbedWithMetadataFn`, `setEmbedQueryFn`, `setFastQueryEmbedFn`,
`setGenerateContentFn`, `setLiveCoachingContentFn`, `setConversationContextProvider`,
`setActiveSpaceFn`. Stubs return null: `generateNegotiationScriptOnDemand`,
`getNegotiationScript`, `getCoverLetter`, `getCompanyResearchEngine`.

### Parsing / extraction / chunking

- **Parsing**: reuses `electron/services/SafeDocumentTextExtractor.extractSafeDocumentText`
  (the same trusted PDF-via-pdfjs+pdf-parse-with-worker-pin / DOCX-via-mammoth /
  TXT+MD text path Modes upload uses). No second parser.
- **Structured extraction**: RESUME → `generateContentFn` with a strict-JSON prompt
  producing `{ identity{name,email,phone,location}, experience[], projects[],
  skills{...} }` (satisfies `profileFactsReady`); JD → lighter `{ role, company,
  requirements[], responsibilities[] }`. Responses run through a loose JSON parser
  (raw → fenced-stripped → first `{...}` block → null). Extraction is skipped
  gracefully if `generateContentFn` is unset (documents still ingest + chunk).
- **Chunking**: ~500-token / ~200-overlap sliding window over whitespace words
  (step 300), each chunk embedded via `embedWithMetadataFn` (preferred, carries
  producer space) or `embedFn`, saved via `KnowledgeDatabaseManager.saveChunks`.
  A failed embed still stores the chunk text (embedding NULL).
- **Retrieval**: `queryRelevantChunks` embeds via `embedQueryFn ?? embedFn`, reads
  the active space via `activeSpaceFn`, and delegates to `queryChunksByEmbedding`
  (fail-closed without a space). Results map to `{ text, similarity, docType }`.
- **Self-heal**: `ensureEmbeddingSpace` re-embeds any singleton doc whose chunks are
  outside the active space (`hasChunksOutsideSpace`) — the knowledge analogue of the
  meeting-RAG auto-reindex sweep.

### Verification

- `tsc -p electron/tsconfig.json --noEmit` → **0 errors** (includes the new
  `premium/electron/**` shim, which the config globs in).
- Isolated logic self-check of the chunk splitter (overlap boundary, tail coverage,
  no infinite loop on exact multiples, empty input) + loose JSON parser (raw /
  fenced / embedded / garbage / empty): passes.
- Per ticket, full esbuild build + runtime tests deferred to the consolidated pass;
  `npm install` is blocked in this environment (see ticket 05 answer).
