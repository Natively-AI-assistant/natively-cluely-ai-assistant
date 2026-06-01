# Intelligence Pipeline Map

Status: Phase 1 mapping before production fixes. This maps the current end-to-end path from upload/settings/live meeting input to final LLM prompt and response.

## 1. Upload/settings to persisted context

### 1.1 Resume upload path

1. User opens Profile Intelligence settings.
   - UI: `src/components/ProfileIntelligenceSettings.tsx`.
2. User clicks resume upload.
   - Renderer calls `window.electronAPI.profileSelectFile()` (`ProfileIntelligenceSettings.tsx:855`).
3. Preload sends `profile:select-file`.
   - Bridge: `electron/preload.ts:1877`.
4. Main shows open-file dialog with `pdf`, `docx`, `txt` filters.
   - Handler: `electron/ipcHandlers.ts:4206-4223`.
5. Main registers selected absolute path in a 60s allowlist.
   - Allowlist helpers: `electron/ipcHandlers.ts:4075-4103`.
6. Renderer calls `profileUploadResume(filePath)`.
   - UI: `ProfileIntelligenceSettings.tsx:859`.
   - Bridge: `electron/preload.ts:1872`.
7. Main validates Pro/trial and consumes selected path.
   - Handler: `electron/ipcHandlers.ts:4105-4135`.
8. Main calls `KnowledgeOrchestrator.ingestDocument(resolvedPath, DocType.RESUME)`.
   - `electron/ipcHandlers.ts:4128-4129`.
9. Orchestrator extracts raw text.
   - `premium/electron/knowledge/KnowledgeOrchestrator.ts:277-279`.
10. Orchestrator extracts structured resume JSON via LLM.
    - `KnowledgeOrchestrator.ts:280-282`.
    - `premium/electron/knowledge/StructuredExtractor.ts:129-143`.
11. Resume is post-processed/normalized.
    - `KnowledgeOrchestrator.ts:283-289`.
12. Old resume document is deleted.
    - `KnowledgeOrchestrator.ts:291-293`.
13. New resume document is saved.
    - `KnowledgeOrchestrator.ts:294-299`.
14. Structured resume is chunked/embedded.
    - `KnowledgeOrchestrator.ts:303-307`.
    - `premium/electron/knowledge/DocumentChunker.ts:189-249`.
15. STAR story nodes are generated best-effort.
    - `KnowledgeOrchestrator.ts:309-319`.
16. Cache refresh loads active resume/JD/nodes.
    - `KnowledgeOrchestrator.ts:328`, `KnowledgeOrchestrator.ts:725-735`.
17. Resume-only salary estimate is started in the background.
    - `KnowledgeOrchestrator.ts:346-355`.

#### Included from resume

- Structured fields: identity, skills, experience, projects, education, achievements, certifications, leadership.
- Embedded nodes: experience bullets, projects, education, achievements.
- Raw source text is used during extraction; current code stores structured document and nodes, not a clearly exposed raw-text fallback in `KnowledgeDocument`.

#### Dropped or at risk

- Identity facts are not chunked into retrieval nodes by `DocumentChunker`, so name/email/location are available in `activeResume.structured_data` but not necessarily searchable as nodes.
- Certifications/leadership are present in the schema but only achievements are chunked in current `DocumentChunker`; certifications/leadership have formatting support but may not be saved as nodes.
- If extraction misses identity/project fields, fallbacks (`Unknown Candidate`) can mask missing data instead of preserving uncertainty.

### 1.2 JD upload path

1. User clicks JD upload.
   - UI: `ProfileIntelligenceSettings.tsx:964-968`.
2. Same file select path allowlist is used.
3. Main handles `profile:upload-jd`.
   - `electron/ipcHandlers.ts:4229-4259`.
4. Main calls `KnowledgeOrchestrator.ingestDocument(resolvedPath, DocType.JD)`.
   - `electron/ipcHandlers.ts:4252-4253`.
5. Orchestrator extracts raw text and structured JD JSON.
   - `KnowledgeOrchestrator.ts:277-282`.
   - `StructuredExtractor.ts:69-83`.
6. Old JD is deleted, new JD document is saved.
   - `KnowledgeOrchestrator.ts:291-299`.
7. JD nodes are chunked/embedded: requirements, nice-to-haves, responsibilities, keywords.
   - `DocumentChunker.ts:121-180`.
8. Cache refresh loads active JD/nodes.
   - `KnowledgeOrchestrator.ts:328`.
9. AOT pipeline resets and runs for the active JD + active resume.
   - `KnowledgeOrchestrator.ts:331-344`.
10. AOT may seed negotiation tracker from generated script.
    - `KnowledgeOrchestrator.ts:337-342`.

#### Included from JD

- Structured role title, company, location, level, employment type, requirements, nice-to-haves, responsibilities, technologies, keywords, compensation hint, min years.
- Embedded JD nodes for requirements/responsibilities/keywords.
- AOT artifacts: company dossier, negotiation script, gap analysis, mock questions, culture mappings, intro.

#### Dropped or at risk

- JD-derived AOT artifacts are tied primarily to active JD/doc ID. Current in-memory cache validity by `(resumeId, jdId)` is not explicit.
- Deleting/replacing a resume does not obviously invalidate JD AOT results generated for the previous resume.

### 1.3 Custom context path

1. User types in Custom Context textarea.
   - UI state: `customNotes` in `ProfileIntelligenceSettings.tsx:572`.
2. UI enforces max 4,000 chars and debounces save 800ms.
   - `ProfileIntelligenceSettings.tsx:1040-1050`.
3. Renderer calls `profileSaveNotes(content)`.
   - `ProfileIntelligenceSettings.tsx:1046`.
4. Main handler trims/slices to 4,000 chars and saves in `DatabaseManager`.
   - `electron/ipcHandlers.ts:4419-4424`.
5. Main propagates notes to:
   - `KnowledgeOrchestrator.setCustomNotes(trimmed)` (`ipcHandlers.ts:4426-4428`).
   - `LLMHelper.setCustomNotes(trimmed)` (`ipcHandlers.ts:4429-4430`).
6. On app startup, notes are restored into LLMHelper and orchestrator.
   - `electron/main.ts:822-827`, `electron/main.ts:1067-1072`.
7. On profile question, orchestrator appends notes as `<user_context>` whenever it returns a profile result.
   - `KnowledgeOrchestrator.ts:695-700`.
8. On suggestion generation, `LLMHelper.generateSuggestion` prepends custom notes to suggestion context.
   - `electron/LLMHelper.ts:1193-1197`.

#### Context mixed incorrectly today

- Custom context is not currently routed by sub-intent. A private salary note inside custom context can be appended to non-salary identity/project answers.

### 1.4 AI persona path

1. User types in AI Persona textarea.
   - UI state: `persona` in `ProfileIntelligenceSettings.tsx:575`.
2. UI Pro/trial gates edits, enforces 4,000 chars, debounces save 800ms.
   - `ProfileIntelligenceSettings.tsx:1088-1119`.
3. Renderer calls `profileSavePersona(content)`.
   - `ProfileIntelligenceSettings.tsx:1102`.
4. Main saves trimmed persona to `DatabaseManager` and calls `LLMHelper.setPersonaPrompt(trimmed)`.
   - `electron/ipcHandlers.ts:4450-4459`.
5. On app startup, persona is restored to LLMHelper.
   - `electron/main.ts:828-831`, `electron/main.ts:1075-1084`.
6. Streaming `LLMHelper._streamChatInner` adds persona to the user-context channel for every streaming provider path.
   - `electron/LLMHelper.ts:3441-3449`.

#### Context mixed incorrectly today

- Persona is labeled tone/preferences only, but it is not selected/excluded by intent. It can bloat or bias unrelated factual recall.
- Persona does not reach `KnowledgeOrchestrator` directly; it only affects provider-level prompt composition.

### 1.5 Negotiation context path

1. JD upload triggers AOT pipeline, which can generate negotiation script and seed negotiation tracker target.
   - `KnowledgeOrchestrator.ts:331-344`.
2. User can manually generate/regenerate a negotiation script.
   - UI: `ProfileIntelligenceSettings.tsx:1525`, `ProfileIntelligenceSettings.tsx:1547`.
   - IPC: `electron/ipcHandlers.ts:4342-4378`.
3. Orchestrator serves cached script or runs `generateNegotiationScriptOnDemand()`.
   - `KnowledgeOrchestrator.ts:168-198`.
4. Live interviewer/user utterances are fed to `NegotiationConversationTracker`.
   - Verified interviewer STT: `KnowledgeOrchestrator.feedInterviewerUtterance` (`KnowledgeOrchestrator.ts:905-908`).
   - User profile question path: `negotiationTracker.addUserUtterance(question)` (`KnowledgeOrchestrator.ts:446-448`).
5. For questions classified as `NEGOTIATION`, orchestrator may short-circuit to `generateLiveCoachingResponse`.
   - `KnowledgeOrchestrator.ts:519-543`.
6. LLMHelper forwards coaching over a dedicated handler/channel.
   - `electron/LLMHelper.ts:1262-1264`, `LLMHelper.ts:3342-3345`, `LLMHelper.ts:1527-1534`.
7. `IntelligenceEngine` forwards it as `negotiation_coaching`.
   - `electron/IntelligenceEngine.ts:134-139`.

#### Context mixed incorrectly today

- Negotiation script cache may remain after JD delete/replacement.
- Salary context is gated by `intent === NEGOTIATION`, which is good, but custom context can still carry salary notes into unrelated answers.

### 1.6 Reference files and active modes

1. Modes/reference files are managed through `ModesManager` and mode settings UI.
2. `WhatToAnswerLLM.generateStream` retrieves active mode context/reference files by query.
   - Hybrid retrieval: `WhatToAnswerLLM.ts:133-141`.
3. `LLMHelper._streamChatInner` also injects mode prompt and mode context unless skipped.
   - Active mode injection: `LLMHelper.ts:3366-3413`.
4. `PromptAssembler` treats reference files as untrusted evidence and escapes content.
   - `PromptAssembler.ts:393-449`.

#### Context dropped by design

- `WhatToAnswerLLM` passes `skipModeInjection=true` into `LLMHelper.streamChat`, because it has already assembled active mode context into the packet.
- If provider policy denies `reference_files`, `WhatToAnswerLLM` may omit reference files unless local fallback is available.

## 2. Live meeting transcript to response path

### 2.1 STT/transcript ingestion

1. STT/native audio emits transcript segments.
2. `AppState` forwards transcript into `IntelligenceManager.addTranscript` / `handleTranscript`.
3. `IntelligenceManager` delegates to `IntelligenceEngine.handleTranscript`.
   - `IntelligenceManager.ts:95-103`, `IntelligenceEngine.ts:242-277`.
4. `SessionTracker` stores final/interim transcript and assistant history.
5. If segment is interviewer interim, `IntelligenceEngine.maybeSpeculate` can start speculative answer.
   - `IntelligenceEngine.ts:246-254`.
6. If segment is final, dynamic action detection may run.
   - `IntelligenceEngine.ts:260-268`.

### 2.2 What-to-answer path

1. A trigger calls `IntelligenceEngine.runWhatShouldISay(question, confidence, imagePaths, options)`.
   - `IntelligenceEngine.ts:515-693`.
2. Cooldown/abort handling happens.
   - `IntelligenceEngine.ts:516-536`.
3. Recent context items are loaded from session.
   - `IntelligenceEngine.ts:568`.
4. Latest interim interviewer transcript may be injected if non-duplicate.
   - `IntelligenceEngine.ts:570-586`.
5. Transcript is cleaned and truncated by `prepareTranscriptForWhatToAnswer`.
   - `IntelligenceEngine.ts:588-594`.
6. Temporal context is built from transcript and assistant response history.
   - `IntelligenceEngine.ts:596-600`.
7. Intent classifier runs on last interviewer turn + prepared transcript.
   - `IntelligenceEngine.ts:602-607`.
8. `WhatToAnswerLLM.generateStream` starts.
   - `IntelligenceEngine.ts:623`.
9. `WhatToAnswerLLM` optionally retrieves active-mode/reference context.
   - `WhatToAnswerLLM.ts:112-151`.
10. `WhatToAnswerLLM` builds final system prompt: universal/tiny prompt + active skill/mode suffix.
    - `WhatToAnswerLLM.ts:182-190`.
11. `PromptAssembler` creates typed blocks for intent, prior responses, screen, transcript, retrieved mode context.
    - `WhatToAnswerLLM.ts:192-202`, `PromptAssembler.ts:52-150`.
12. `WhatToAnswerLLM` calls `LLMHelper.streamChat(packet.userMessage, imagePaths, undefined, finalPromptOverride, true, true, packetScopes)`.
    - `WhatToAnswerLLM.ts:217`.
13. `ignoreKnowledgeMode=true` means `KnowledgeOrchestrator.processQuestion` is skipped for what-to-answer.
14. LLMHelper streams through provider routing.
15. Tokens are buffered in `IntelligenceEngine`, then emitted as a single `suggested_answer_token` event with `fullAnswer`.
    - `IntelligenceEngine.ts:626-672`.
16. Final answer is added to assistant history and usage, then emitted.
    - `IntelligenceEngine.ts:672-682`.

### 2.3 Manual chat path

There are two manual paths:

#### A. `submitManualQuestion`

1. Renderer invokes `submitManualQuestion(question)`.
2. `IntelligenceManager.runManualAnswer` calls `IntelligenceEngine.runManualAnswer`.
3. `runManualAnswer` builds 120s formatted transcript context.
   - `IntelligenceEngine.ts:981`.
4. `AnswerLLM.generate(question, context)` calls `LLMHelper.streamChat(question, undefined, fittedContext, UNIVERSAL_ANSWER_PROMPT)`.
   - `AnswerLLM.ts:15-20`.
5. Because `ignoreKnowledgeMode` defaults false, `LLMHelper._streamChatInner` can invoke profile `KnowledgeOrchestrator`.
6. This is the most likely path for typed `what is my name?` profile intelligence bugs.

#### B. `gemini-chat-stream`

1. Renderer calls `streamGeminiChat(message, imagePaths?, context?, options?)`.
2. Main handles `gemini-chat-stream`.
   - `electron/ipcHandlers.ts:519-670`.
3. A narrow assistant identity probe regex short-circuits true assistant meta questions.
   - `ipcHandlers.ts:511-587`.
4. If no explicit context, main snapshots 100s context before adding the new user message.
   - `ipcHandlers.ts:590-628`.
5. New user message is added to `IntelligenceManager`.
   - `ipcHandlers.ts:603-612`.
6. It calls `LLMHelper.streamChat(message, imagePaths, context, CHAT_MODE_PROMPT, options?.ignoreKnowledgeMode, false, [], abortSignal)`.
   - `ipcHandlers.ts:630-653`.
7. Profile knowledge mode can still run unless `options.ignoreKnowledgeMode` is true.
8. Tokens are sent incrementally to `gemini-stream-token`.
   - `ipcHandlers.ts:655-670`.

## 3. Profile knowledge hot path in LLMHelper

### 3.1 Streaming path

1. `LLMHelper.streamChat` wraps `_streamChatInner` and post-processes dash punctuation.
   - `LLMHelper.ts:3275-3290`.
2. `_streamChatInner` computes `shouldRunKnowledge`:
   - `!ignoreKnowledgeMode`
   - `!groqFastTextMode`
   - `knowledgeOrchestrator?.isKnowledgeMode()`
   - `LLMHelper.ts:3315-3318`.
3. Orchestrator depth scorer is fed with the message.
   - `LLMHelper.ts:3321-3323`.
4. `knowledgeOrchestrator.processQuestion(message)` runs.
   - `LLMHelper.ts:3324`.
5. If `isIntroQuestion && introResponse`, response is yielded directly.
   - `LLMHelper.ts:3332-3335`.
6. Otherwise, if active mode allows premium intercept:
   - Live negotiation payload short-circuits to handler (`LLMHelper.ts:3342-3345`).
   - `systemPromptInjection` sets `systemPromptOverride = CORE_IDENTITY + injection` (`LLMHelper.ts:3351-3353`).
   - `contextBlock` is prepended to context (`LLMHelper.ts:3354-3359`).
7. Active mode injection may add mode suffix/context unless skipped/universal.
   - `LLMHelper.ts:3366-3413`.
8. Provider-scope checks may route to Ollama or omit context/screenshots.
   - `LLMHelper.ts:3417-3435`.
9. Final system prompt is language-wrapped.
   - `LLMHelper.ts:3437-3440`.
10. Persona is prepended to context as untrusted tone/preferences.
    - `LLMHelper.ts:3441-3444`.
11. `userContent` is built as `CONTEXT + USER QUESTION`.
    - `LLMHelper.ts:3446-3449`.
12. Provider-specific streaming path starts.
    - Vision fallback: `LLMHelper.ts:3458-3477`.
    - Fast mode: `LLMHelper.ts:3486-3531`.
    - Ollama/Codex/custom/curl/cloud/Natively/Gemini fallback: `LLMHelper.ts:3533-3678`.

### 3.2 Non-streaming path

1. `LLMHelper.chatWithGemini(message, imagePaths?, context?, skipSystemPrompt?, alternateGroqMessage?)`.
   - `LLMHelper.ts:1496-1818`.
2. If knowledge mode active, calls `processQuestion(message)`.
   - `LLMHelper.ts:1505-1513`.
3. Intro response short-circuits.
   - `LLMHelper.ts:1517-1520`.
4. Live negotiation response short-circuits.
   - `LLMHelper.ts:1527-1534`.
5. Current bug/risk: `systemPromptInjection` is not applied to `finalGeminiPrompt`, `openaiSystemPrompt`, `claudeSystemPrompt`, or custom provider system prompt. Only `contextBlock` is prepended.
   - `LLMHelper.ts:1535-1544`, `LLMHelper.ts:1569-1613`.
6. Provider-scope checks and provider routing happen.
   - `LLMHelper.ts:1576-1818`.

## 4. Orchestrator processQuestion context selection today

### 4.1 Current intent categories

- `INTRO`: intro/full self-introduction and identity direct questions.
- `PROFILE_DETAIL`: project/skill/experience/education/background/work-history questions.
- `NEGOTIATION`: salary/offer/compensation/benefits/equity questions.
- `COMPANY_RESEARCH`: company/interview process/culture/funding/reviews.
- `TECHNICAL`: technical/explain/implement/design/how-to.
- `GENERAL`: fallback.

### 4.2 Current routing behavior

1. If no knowledge mode or no resume, return `null`.
2. Classify intent.
3. If `isGenericKnowledgeQuestion(question)`, return `null`.
4. Candidate-directed if intent is intro/profile/negotiation/company or pronoun framing is present.
5. If not candidate-directed but ambiguous, return compact identity context if available.
6. Otherwise:
   - Add user question to negotiation tracker.
   - Detect category hints.
   - Compute JD requirements for boosting.
   - Start node retrieval with local/cloud query embedder.
   - Optionally get company dossier.
   - Optionally run live negotiation coaching.
   - Optionally build salary context.
   - Optionally build gap context.
   - Await relevant nodes.
   - Assemble prompt context.
   - Append dossier/salary/gap/mock/culture/custom notes.
   - Return `PromptAssemblyResult`.

### 4.3 Where context is included

- Resume structured data:
  - Identity and current role included in system prompt via `buildIdentityHeader`.
  - Experience/project/education/achievement nodes included only if retrieval returns them.
- JD structured data:
  - Target role/company included in identity header.
  - JD requirements can boost resume nodes and JD nodes can be returned in `<target_job_context>`.
  - Company/salary/gap/mock/culture context appended by intent/similarity.
- Custom notes:
  - Appended for every non-null profile result.
- Persona:
  - Added later by LLMHelper for every streaming request, not selected by orchestrator.
- Negotiation:
  - Live coaching and salary context only for `NEGOTIATION` intent.
- Reference files:
  - Active mode retrieval path, not profile orchestrator path.
- Live transcript:
  - Included in manual chat context or what-to-answer `PromptAssembler`, not inside orchestrator except when message/context passed to LLMHelper.

### 4.4 Where context is dropped

- Generic questions return `null`, intentionally dropping profile/JD/persona retrieval.
- What-to-answer path always sets `ignoreKnowledgeMode=true`, so profile intelligence does not run there.
- Active mode injection is skipped for universal/tiny/CHAT prompts or when `skipModeInjection=true`.
- Provider-scope denial can drop context/screenshots.
- Token budget in `PromptAssembler` drops/truncates low-priority blocks.
- `LLMHelper.fitContextForCurrentModel` may truncate transcript/context for current model.

### 4.5 Where context is mixed incorrectly

- JD facts are included in `buildIdentityHeader` for normal profile questions, including identity/name/project asks.
- Custom notes are always appended after profile result, even if unrelated.
- Persona is always appended to streaming context, even if unrelated.
- Assistant identity (`CORE_IDENTITY`) is prepended to profile injected system prompt in streaming.
- Non-streaming profile prompt injection is not applied, so generic assistant/system prompts can override profile facts.
- AOT negotiation/gap/mock/culture caches may outlive current resume/JD pairing.
- Live transcript is included by manual chat and what-to-answer path even when the direct question is a stable profile fact, unless the profile fast path short-circuits first.

## 5. Latency map

### 5.1 Upload/settings time

Potentially slow operations:

- File text extraction (`DocumentReader`).
- Structured extraction LLM call with 45s timeout (`StructuredExtractor.ts:140-143`).
- Embedding batches: batch size 10, parallel per batch, 100ms delay between batches, one 500ms retry delay (`DocumentChunker.ts:197-244`).
- STAR story generation per resume (`KnowledgeOrchestrator.ts:309-319`).
- AOT pipeline for JD: company research, negotiation, gap, mock, culture, intro.
- Resume salary precompute.
- RAG embedding pipeline bootstrapping/wait-for-ready (`main.ts:1010-1015`).

These are intentionally off the live question hot path except retrieval/query embedding.

### 5.2 Live profile question hot path

1. Renderer/IPC event handling.
2. Session context snapshot/add transcript for manual chat.
3. `LLMHelper._streamChatInner` knowledge intercept.
4. `KnowledgeOrchestrator.processQuestion`:
   - classify intent.
   - generic/ambiguous gates.
   - query embedding via fast local or cloud fallback.
   - `getRelevantNodes` scoring.
   - optional dossier lookup/research.
   - optional live negotiation LLM.
   - optional salary estimate LLM if uncached/resume-only.
   - optional AOT result lookups.
   - prompt assembly.
5. Active mode injection/retrieval in LLMHelper if not skipped.
6. Persona/context concat.
7. Provider request setup.
8. Provider first-token latency.
9. Renderer IPC per token or batch.
10. Post-processing, final session save.

### 5.3 Known latency bottlenecks

- Identity/name/project/skill questions currently require orchestrator + retrieval + LLM generation instead of deterministic structured-memory answer.
- Terse project questions can still do embedding search even though structured projects are already known.
- Non-streaming fallback paths can rotate providers up to 3 full rotations with backoff (`LLMHelper.ts:1804-1814`).
- Prewarm warms `HARD_SYSTEM_PROMPT`, not necessarily profile/mode-specific prompt used on real query.
- `_prewarmedKeys` is marked before successful warmup.
- What-to-answer uses active mode hybrid retrieval before streaming begins.
- `IntelligenceEngine.runWhatShouldISay` buffers all tokens and emits `suggested_answer_token` once with the full answer (`IntelligenceEngine.ts:626-672`), so some UI paths may not display first token immediately even though `WhatToAnswerLLM` yields token-by-token internally.

## 6. Streaming start points

- Main chat stream starts token IPC inside `gemini-chat-stream` loop immediately as `LLMHelper.streamChat` yields (`ipcHandlers.ts:655-670`).
- What-to-answer currently collects all tokens in `IntelligenceEngine` and emits full answer as one token event after completion (`IntelligenceEngine.ts:626-672`).
- LLMHelper provider streaming starts after:
  - knowledge intercept,
  - mode injection,
  - scope checks,
  - persona/context assembly,
  - selected provider branch.

## 7. Provider-specific behavior

- Gemini:
  - Prompt cache wrapper exists (`GeminiPromptCache`).
  - Can stream via Gemini model or parallel race fallback.
- Claude:
  - Uses `buildClaudeSystemBlocks` with cache control where eligible (`LLMHelper.ts:1399-1427`).
- OpenAI/Groq/DeepSeek:
  - Prefix cache key support and separate system/user prompt paths.
- Groq fast mode:
  - Skips knowledge mode entirely (`LLMHelper.ts:3315-3317`) and routes to Groq/Codex/Natively fast pool when applicable (`LLMHelper.ts:3486-3531`).
- Natively API:
  - SSE streaming path in `streamWithNatively` (`LLMHelper.ts:3685-3699+`).
- Custom/cURL providers:
  - Custom provider stream path receives `message`, `context`, `systemPrompt`; cURL currently uses non-streaming fallback.
- Ollama/local:
  - Used for local-only mode or provider-scope fallback when cloud scopes denied.

## 8. Request/response contracts

### `profile:get-status`

Input: none.

Output:

```json
{
  "hasProfile": true,
  "profileMode": true,
  "name": "...",
  "role": "...",
  "totalExperienceYears": 5
}
```

Safe fallback when orchestrator unavailable:

```json
{ "hasProfile": false, "profileMode": false }
```

### `profile:get-profile`

Input: none.

Output: orchestrator `getProfileData()`:

```json
{
  "identity": {},
  "skills": [],
  "experienceCount": 0,
  "projectCount": 0,
  "educationCount": 0,
  "nodeCount": 0,
  "experience": [],
  "projects": [],
  "education": [],
  "activeJD": null,
  "hasActiveJD": false,
  "gapAnalysis": null,
  "negotiationScript": null,
  "mockQuestions": null,
  "cultureMappings": null,
  "aotStatus": {},
  "compactPersona": "...",
  "toneDirective": "..."
}
```

### `streamGeminiChat`

Renderer call:

```ts
streamGeminiChat(message, imagePaths?, context?, options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean })
```

Events:

- `gemini-stream-token` token string
- `gemini-stream-done`
- `gemini-stream-error`

### Intelligence events

- `onIntelligenceSuggestedAnswerToken({ token, question, confidence })`
- `onIntelligenceSuggestedAnswer({ answer, question, confidence })`
- `onIntelligenceNegotiationCoaching({ payload })`
- `onIntelligenceTokenBatch({ kind, items })`
- Manual events: started/result.

## 9. Phase 1 conclusion

The system already has useful building blocks: structured resume/JD extraction, active mode/reference trust blocks, profile intent classification, category hints, fast local query embeddings, AOT intro/negotiation artifacts, negotiation gating, and several regression tests.

The core production gaps are:

1. No first-class context router with explicit selected/excluded layers and confidence.
2. No deterministic structured-memory answer path for stable factual recall.
3. Direct profile facts depend on LLM prompt behavior and can be overridden by assistant identity/system prompt ordering.
4. Project recall depends on vector retrieval despite structured projects being available.
5. Non-streaming prompt injection is incomplete.
6. Persona/custom/JD/transcript are over-included relative to intent.
7. AOT caches are not clearly versioned by resume/JD pair.
8. Latency instrumentation is partial and unsafe/private logging needs tightening.
9. The current broad eval is largely routing-copy based, not production-path answer/context/latency validation.
