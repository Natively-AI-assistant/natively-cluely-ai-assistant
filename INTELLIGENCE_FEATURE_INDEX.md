# Intelligence Feature Index

Status: Phase 1 mapping before production fixes. This document indexes Natively's Profile Intelligence / Context Intelligence features as currently implemented in this working tree.

## High-level architecture

Natively's intelligence system is split across four major layers:

1. **Renderer/UI settings and meeting surfaces**
   - Profile upload, JD upload, custom context, persona, company research, negotiation script UI.
   - Live meeting/manual chat surfaces stream user questions and answers through Electron IPC.
2. **Electron IPC and app state**
   - Main process validates upload file paths, gates premium features, initializes KnowledgeOrchestrator, RAG/embedding providers, and forwards streaming events.
3. **Premium knowledge engine**
   - Parses resumes/JDs into structured data, chunks facts into nodes, embeds them, retrieves relevant nodes, classifies intent, assembles prompt injections, and handles AOT company/negotiation/gap/mock/interview artifacts.
4. **LLM/provider layer**
   - `LLMHelper` routes to Gemini, Claude, OpenAI, Groq, DeepSeek, Natively API, custom/cURL providers, Codex CLI, and Ollama/local fallback. It injects knowledge context and streams output to the renderer.

## Frontend features and files

### Profile Intelligence settings

- `src/components/ProfileIntelligenceSettings.tsx`
  - Resume upload UI: `profileSelectFile` then `profileUploadResume` (`src/components/ProfileIntelligenceSettings.tsx:855`, `src/components/ProfileIntelligenceSettings.tsx:859`).
  - JD upload UI: `profileSelectFile` then `profileUploadJD` (`src/components/ProfileIntelligenceSettings.tsx:964`, `src/components/ProfileIntelligenceSettings.tsx:968`).
  - Profile mode toggle: `profileSetMode` (`src/components/ProfileIntelligenceSettings.tsx:758`).
  - Profile dashboard: identity, email, skills, experience/project/education counts (`src/components/ProfileIntelligenceSettings.tsx:550`, `src/components/ProfileIntelligenceSettings.tsx:725`, `src/components/ProfileIntelligenceSettings.tsx:805`).
  - Custom context textarea: auto-saves via `profileSaveNotes` with 4,000 char UI limit (`src/components/ProfileIntelligenceSettings.tsx:572`, `src/components/ProfileIntelligenceSettings.tsx:1040`, `src/components/ProfileIntelligenceSettings.tsx:1046`).
  - AI persona textarea: auto-saves via `profileSavePersona`, Pro/trial gated (`src/components/ProfileIntelligenceSettings.tsx:575`, `src/components/ProfileIntelligenceSettings.tsx:1102`).
  - Company research UI: calls `profileResearchCompany` (`src/components/ProfileIntelligenceSettings.tsx:1238`).
  - Negotiation script UI: calls `profileGenerateNegotiation` (`src/components/ProfileIntelligenceSettings.tsx:1525`, `src/components/ProfileIntelligenceSettings.tsx:1547`).

### Premium UI wrappers

- `src/premium/index.tsx`
  - Dynamically imports premium visualizers, toasters, negotiation card, and mode settings.
- `premium/src/ProfileVisualizer.tsx`
  - Renders detailed profile/JD/AOT artifacts from `profileGetProfile`.
- `premium/src/ProfileFeatureToaster.tsx`
  - Promotes profile setup.
- `premium/src/ModesSettings.tsx`
  - Custom modes and reference-file settings UI.

### Meeting and chat overlays

- `src/components/GlobalChatOverlay.tsx`, `src/components/MeetingChatOverlay.tsx`, `src/components/NativelyInterface.tsx`, `src/App.tsx`
  - Trigger manual chat / meeting actions via `streamGeminiChat`, `submitManualQuestion`, `generateWhatToSay`, and intelligence event listeners.
  - Relevant public contracts are declared in `src/types/electron.d.ts:195-289`.

## Electron API contracts

### Renderer type contracts

- `src/types/electron.d.ts:411-429`
  - `profileUploadResume(filePath) -> { success, error? }`
  - `profileGetStatus() -> { hasProfile, profileMode, name?, role?, totalExperienceYears? }`
  - `profileSetMode(enabled) -> { success, error? }`
  - `profileDelete() -> { success, error? }`
  - `profileGetProfile() -> any`
  - `profileSelectFile() -> { success?, cancelled?, filePath?, error? }`
  - `profileUploadJD(filePath) -> { success, error? }`
  - `profileDeleteJD() -> { success, error? }`
  - `profileResearchCompany(companyName) -> { success, dossier?, error?, searchQuotaExhausted? }`
  - `profileGenerateNegotiation(force?) -> { success, script?, error? }`
  - `profileGetNegotiationState() -> { success, state?, isActive?, error? }`
  - `profileResetNegotiation() -> { success, error? }`
  - `profileGetNotes/profileSaveNotes`, `profileGetPersona/profileSavePersona`.

### Preload bridge

- `electron/preload.ts:620-654`
  - Local `ElectronAPI` interface declares Profile Engine API.
- `electron/preload.ts:1872-1891`
  - Bridges profile APIs to IPC channels:
    - `profile:upload-resume`
    - `profile:get-status`
    - `profile:set-mode`
    - `profile:delete`
    - `profile:get-profile`
    - `profile:select-file`
    - `profile:upload-jd`
    - `profile:delete-jd`
    - `profile:research-company`
    - `profile:generate-negotiation`
    - `profile:get-negotiation-state`
    - `profile:reset-negotiation`
    - `profile:get-notes`
    - `profile:save-notes`
    - `profile:get-persona`
    - `profile:save-persona`

### Main-process handlers

- `electron/ipcHandlers.ts:4075-4103`
  - Upload file path allowlist: files must originate from `profile:select-file`; entries expire after 60 seconds.
- `electron/ipcHandlers.ts:4105-4135`
  - Resume upload handler. Pro/trial gated. Calls `KnowledgeOrchestrator.ingestDocument(..., DocType.RESUME)`.
- `electron/ipcHandlers.ts:4137-4155`
  - Profile status handler. Maps `KnowledgeStatus` to UI shape.
- `electron/ipcHandlers.ts:4157-4180`
  - Profile mode handler. Calls `setKnowledgeMode` and persists `knowledgeMode` in `SettingsManager`.
- `electron/ipcHandlers.ts:4182-4204`
  - Profile delete/get-profile handlers.
- `electron/ipcHandlers.ts:4206-4223`
  - File selection handler. Allows `pdf`, `docx`, `txt`.
- `electron/ipcHandlers.ts:4229-4259`
  - JD upload handler. Pro/trial gated. Calls `ingestDocument(..., DocType.JD)`.
- `electron/ipcHandlers.ts:4261-4273`
  - JD delete handler.
- `electron/ipcHandlers.ts:4275-4340`
  - Company research handler. Wires Tavily, Natively API search, or LLM-only fallback.
- `electron/ipcHandlers.ts:4342-4378`
  - Negotiation script generation. Uses cached script unless `force`.
- `electron/ipcHandlers.ts:4380-4404`
  - Negotiation state/reset.
- `electron/ipcHandlers.ts:4410-4436`
  - Custom notes persistence and propagation to orchestrator and LLMHelper.
- `electron/ipcHandlers.ts:4438-4464`
  - Persona persistence and propagation to LLMHelper.

## Backend/app-state initialization

- `electron/main.ts:432-439`
  - Conditionally loads premium `KnowledgeOrchestrator` and `KnowledgeDatabaseManager`.
- `electron/main.ts:795-845`
  - Initializes `IntelligenceManager`; restores Groq fast mode, Codex CLI, custom notes, persona; starts RAG/embedding bootstrap and intent classifier warmup.
- `electron/main.ts:958-1091`
  - Initializes `RAGManager` and `KnowledgeOrchestrator`.
  - Wires `generateContentFn` to `LLMHelper.generateContentStructured` (`electron/main.ts:999-1002`).
  - Wires embedding to RAG `EmbeddingPipeline.waitForReady()/getEmbedding` (`electron/main.ts:1010-1015`).
  - Registers fast local query embedder (`electron/main.ts:1028-1045`).
  - Attaches `KnowledgeOrchestrator` to `LLMHelper` (`electron/main.ts:1048-1049`).
  - Restores knowledge mode and prewarms prompt cache (`electron/main.ts:1054-1064`).
  - Restores custom notes and persona (`electron/main.ts:1067-1084`).

## Premium knowledge engine features

### Data types and structured memory

- `premium/electron/knowledge/types.ts`
  - `DocType`: `resume`, `job_description`, `company_wiki`, `generic` (`types.ts:4-9`).
  - `KnowledgeDocument`: document metadata and structured data (`types.ts:14-20`).
  - `ContextNode`: atomic embedded facts (`types.ts:25-39`).
  - `StructuredResume`: identity, skills, experience, projects, education, achievements, certifications, leadership (`types.ts:118-127`).
  - `StructuredJD`: title, company, location, summary, level, requirements, responsibilities, technologies, compensation hint (`types.ts:146-160`).
  - Negotiation and AOT types (`types.ts:239-342`).

### Document ingestion

- `premium/electron/knowledge/KnowledgeOrchestrator.ts:269-363`
  - `ingestDocument(filePath, type)`:
    1. Extract text using `DocumentReader`.
    2. Extract structured JSON with `StructuredExtractor`.
    3. Post-process resume with `processResume`.
    4. Delete old document of same type.
    5. Save `KnowledgeDocument`.
    6. Chunk and embed document.
    7. Save nodes.
    8. Generate STAR-story nodes for resumes.
    9. For JDs, trigger AOT pipeline.
    10. For resumes, precompute salary estimate in background.

### Structured extraction

- `premium/electron/knowledge/StructuredExtractor.ts`
  - Resume schema includes identity/name/email/phone/location/links/summary, skills, experience, projects, education, achievements, certifications, leadership (`StructuredExtractor.ts:7-67`).
  - JD schema includes role/company/location/requirements/responsibilities/technologies/keywords/compensation (`StructuredExtractor.ts:69-83`).
  - Calls LLM with strict JSON extraction prompt and 45s timeout (`StructuredExtractor.ts:129-143`).
  - Current fallback fills missing resume name as `Unknown Candidate` and JD title/company/location as unknown placeholders (`StructuredExtractor.ts:149-198`).

### Chunking and retrieval

- `premium/electron/knowledge/DocumentChunker.ts`
  - Creates resume nodes for experience bullets, projects, education, achievements (`DocumentChunker.ts:50-120`).
  - Creates JD nodes for requirements, nice-to-haves, responsibilities, keywords (`DocumentChunker.ts:121-180`).
  - Embeds nodes in batches of 10 with one retry and a 100ms inter-batch delay (`DocumentChunker.ts:189-249`).
- `premium/electron/knowledge/HybridSearchEngine.ts`
  - Relevance scoring: semantic similarity, tag match, duration/recency boost, JD-skill boost, category boost, title/org match (`HybridSearchEngine.ts:100-170`).
  - Category hints map project/education/skill/experience terms to resume node categories (`HybridSearchEngine.ts:54-98`).
  - Default threshold: `0.55`, default max nodes: `8` (`HybridSearchEngine.ts:3-4`).
  - Formats grouped XML blocks: `<candidate_experience>`, `<candidate_projects>`, `<candidate_education>`, `<target_job_context>`, etc. (`HybridSearchEngine.ts:238-314`).

### Intent classification

- `premium/electron/knowledge/IntentClassifier.ts`
  - Current `IntentType`: `technical`, `intro`, `company_research`, `negotiation`, `profile_detail`, `general` (`types.ts:285-292`).
  - Identity direct patterns route `what is my name`, `who am i`, role/job/current/background/experience questions to `INTRO` (`IntentClassifier.ts:134-147`).
  - Profile detail patterns cover projects, education, certifications, achievements, skills, background, work history (`IntentClassifier.ts:42-53`).
  - Negotiation patterns cover salary/compensation/offer/equity/benefits (`IntentClassifier.ts:27-32`).
  - Generic question gate bypasses profile/persona retrieval when no candidate framing exists (`IntentClassifier.ts:185-201`).

### Context assembly

- `premium/electron/knowledge/ContextAssembler.ts`
  - Intro/greeting handling (`ContextAssembler.ts:16-53`, `ContextAssembler.ts:246-280`).
  - `buildIdentityHeader` creates candidate/JD identity system text (`ContextAssembler.ts:60-92`).
  - `buildKnowledgeSystemPrompt` builds candidate spoken-voice rules, anti-fabrication, category rules, salary rules (`ContextAssembler.ts:97-157`).
  - `generateCandidateIntro` generates JIT self-intro when AOT intro missing (`ContextAssembler.ts:168-216`).
  - `assemblePromptContext` formats relevant nodes and returns `{ systemPromptInjection, contextBlock, isIntroQuestion, introResponse? }` (`ContextAssembler.ts:235-294`).

### Orchestration and AOT

- `premium/electron/knowledge/KnowledgeOrchestrator.ts`
  - Active state: active resume, active JD, cached nodes, processed resume memo (`KnowledgeOrchestrator.ts:28-44`).
  - Query embedder resolution prefers local MiniLM when dimensions match (`KnowledgeOrchestrator.ts:92-119`).
  - `processQuestion(question)` main profile-intelligence hot path (`KnowledgeOrchestrator.ts:369-704`).
  - Generic bypass returns `null` for pure technical/general questions (`KnowledgeOrchestrator.ts:404-411`).
  - Ambiguous inclusion-bias path injects a compact identity block but skips heavy retrieval (`KnowledgeOrchestrator.ts:415-444`, `KnowledgeOrchestrator.ts:813-836`).
  - Candidate-directed path retrieves resume/JD nodes and appends dossier, salary, gap, mock-question, culture, and custom-note blocks when applicable (`KnowledgeOrchestrator.ts:446-703`).
  - `getProfileData()` exposes identity, skills, experience/projects/education, JD, AOT results, compact persona, and tone directive (`KnowledgeOrchestrator.ts:838-899`).
  - Negotiation tracker is updated by verified interviewer/user paths (`KnowledgeOrchestrator.ts:901-925`).

### AOT/company/negotiation features

- `premium/electron/knowledge/AOTPipeline.ts`
  - Precomputes company research, negotiation script, gap analysis, STAR mapping, intro, mock questions/culture mappings.
- `premium/electron/knowledge/CompanyResearchEngine.ts`
  - Company research with optional Tavily/Natively search providers.
- `premium/electron/knowledge/SalaryIntelligenceEngine.ts`
  - Resume-based salary estimate and salary context block.
- `premium/electron/knowledge/NegotiationEngine.ts`
  - Generates negotiation script.
- `premium/electron/knowledge/NegotiationConversationTracker.ts`
  - Tracks live negotiation phase/offers/silence/pushback.
- `premium/electron/knowledge/LiveNegotiationAdvisor.ts`
  - Generates live coaching payload for dedicated channel.

## Live transcript and meeting intelligence features

### Session and transcript state

- `electron/SessionTracker.ts`
  - Maintains transcript segments, interim transcript, assistant history, usage, detected coding question, epoch summaries.
- `electron/IntelligenceManager.ts`
  - Facade over `SessionTracker`, `IntelligenceEngine`, and `MeetingPersistence` (`IntelligenceManager.ts:25-41`).
  - Public methods add transcript, run modes, clear session context, reset, stop meeting (`IntelligenceManager.ts:91-278`).

### Intelligence engine

- `electron/IntelligenceEngine.ts`
  - Modes: `idle`, `assist`, `what_to_say`, `follow_up`, `recap`, `clarify`, `manual`, `follow_up_questions`, `code_hint`, `brainstorm` (`IntelligenceEngine.ts:20`).
  - Transcript handling and speculative inference (`IntelligenceEngine.ts:242-277`).
  - `runWhatShouldISay` builds cleaned transcript, temporal context, intent result, then streams `WhatToAnswerLLM.generateStream` (`IntelligenceEngine.ts:515-693`).
  - `runManualAnswer` uses `AnswerLLM.generate(question, context)` (`IntelligenceEngine.ts:971-1004`).

### Prompt assembly for meeting context

- `electron/llm/WhatToAnswerLLM.ts`
  - Builds intent context, active mode/reference context, system prompt, typed `ContextPacket`, and calls `LLMHelper.streamChat(..., ignoreKnowledgeMode=true, skipModeInjection=true)` (`WhatToAnswerLLM.ts:46-226`).
  - Currently bypasses `KnowledgeOrchestrator` for what-to-answer streaming because `ignoreKnowledgeMode=true` is passed at `WhatToAnswerLLM.ts:217`.
- `electron/llm/AnswerLLM.ts`
  - Manual answer path passes `UNIVERSAL_ANSWER_PROMPT`/tiny prompt into `LLMHelper.streamChat` (`AnswerLLM.ts:15-20`).
- `electron/services/context/PromptAssembler.ts`
  - Typed context block assembler with trust levels for intent, assistant history, screen, transcript, active-mode custom instructions, reference files, meeting history, custom context (`PromptAssembler.ts:52-150`).
  - Escapes user content and some prompt-injection phrases (`PromptAssembler.ts:160-190`).
  - Enforces token budget by trust order/truncation (`PromptAssembler.ts:193-246`).

## LLM/provider features

- `electron/LLMHelper.ts`
  - Provider clients: Gemini, Groq, OpenAI, Claude, DeepSeek, Ollama, Natively API, custom/cURL, Codex CLI (`LLMHelper.ts:71-109`).
  - Provider data scope policy and fallback (`LLMHelper.ts:147-186`, `LLMHelper.ts:3417-3435`).
  - Prompt cache prewarm (`LLMHelper.ts:1452-1494`).
  - Non-streaming knowledge intercept in `chatWithGemini` (`LLMHelper.ts:1496-1549`).
  - Streaming knowledge intercept in `_streamChatInner` (`LLMHelper.ts:3315-3364`).
  - Active mode injection (`LLMHelper.ts:3366-3413`).
  - Persona injected as user context for every streaming provider path (`LLMHelper.ts:3441-3449`).
  - Multimodal vision streaming fallback (`LLMHelper.ts:3451-3477`).
  - Groq fast-text routing (`LLMHelper.ts:3479-3531`, `LLMHelper.ts:1615-1645`).
  - Provider routing/fallback order for stream/non-stream paths (`LLMHelper.ts:3533-3678`, `LLMHelper.ts:1674-1818`).

## Existing tests and eval artifacts

- `tests/intelligence-fixtures/fixture-set.mjs`
  - 10 synthetic role profiles: Backend Engineer, ML Engineer, PM, SDR, UX Designer, Data Analyst, DevOps/SRE, CSM, Cybersecurity Analyst, Founder/CEO.
- `electron/services/__tests__/IntelligenceEval.test.mjs`
  - Routing-level regression for `what is my name?` and related identity/generic/negotiation pattern gates.
- `electron/services/__tests__/IntelligenceEvalComprehensive.test.mjs`
  - 190 tracked routing/classifier cases across 10 profiles. Writes `intelligence-eval-results/iteration-002.json`.
- `electron/services/__tests__/LLMHelperNegotiationCoachingGate.test.mjs`
  - Gates negotiation coaching and premium intercept by active mode; includes stream and non-stream tests.
- `electron/services/__tests__/RouterInclusionBias.test.mjs`
  - Tests generic bypass, candidate-directed full path, ambiguous compact identity injection.
- `electron/services/__tests__/AotIntroPrecompute.test.mjs`
  - Tests cached intro store and query-time serving logic.
- `electron/services/__tests__/ModePersonaScenarios.test.mjs`, `ModeRetrievalIsolation.test.mjs`, `ModeReferenceFormats.test.mjs`
  - Active-mode/reference-file context isolation.
- `electron/services/__tests__/SensitiveLogRedaction.test.mjs`
  - Redaction coverage.

## Known risks and suspected broken areas

### Release-blocking suspected correctness risks

1. **Non-streaming knowledge prompt injection is incomplete**
   - `LLMHelper.chatWithGemini` computes/receives `knowledgeResult.systemPromptInjection`, but only prepends `contextBlock`; it does not apply the injected system prompt to the provider prompt (`electron/LLMHelper.ts:1535-1544`, `electron/LLMHelper.ts:1569-1613`).
   - Risk: manual/non-streaming profile answers can use generic assistant prompts and answer as Natively instead of the user/candidate.

2. **Streaming prompt injection prepends `CORE_IDENTITY` before candidate identity rules**
   - `_streamChatInner` sets `systemPromptOverride = `${CORE_IDENTITY}\n\n${knowledgeResult.systemPromptInjection}`` (`electron/LLMHelper.ts:3351-3353`).
   - `CORE_IDENTITY` includes the exact allowed answer `"I'm Natively, an AI assistant"` for `who are you` (`electron/llm/prompts.ts:26-29`).
   - Risk: assistant identity can dominate direct identity/profile questions, especially with ambiguous `who are you` vs `who am I`/`what is my name` traffic.

3. **Profile/JD/AOT cache invalidation is not pair-safe**
   - `getNegotiationScript()` checks `aotPipeline.getCachedNegotiationScript()` before active JD validation (`KnowledgeOrchestrator.ts:168-174`).
   - `deleteDocumentsByType(DocType.JD)` resets negotiation tracker but not AOT pipeline (`KnowledgeOrchestrator.ts:716-720`).
   - Resume replacement invalidates processed resume but not derived JD AOT artifacts (`KnowledgeOrchestrator.ts:283-289`, `KnowledgeOrchestrator.ts:331-343`).
   - Risk: old JD/company/salary/gap/mock/culture results can leak into a new candidate/role.

4. **Direct profile facts rely on retrieval/LLM instead of deterministic structured memory**
   - Identity/name questions route to full profile path, but `DocumentChunker` does not create identity nodes (`DocumentChunker.ts:50-120`).
   - `assemblePromptContext` does not directly answer `what is my name`; it builds a system prompt and lets the LLM infer (`ContextAssembler.ts:282-293`).
   - Risk: unnecessary latency and occasional wrong answer.

5. **Project recall depends on vector threshold and may drop all projects**
   - Project questions retrieve nodes above threshold `0.55` (`HybridSearchEngine.ts:3`, `HybridSearchEngine.ts:221`).
   - Category boost helps projects (`HybridSearchEngine.ts:145-149`) but still may return zero when embeddings are mismatched/missing or query is terse.
   - Risk: `what are my projects?` can return a generic answer despite structured projects existing.

6. **Persona is globally appended as context**
   - `LLMHelper._streamChatInner` adds persona to `combinedContext` for all streaming requests (`LLMHelper.ts:3441-3449`).
   - Persona is labeled untrusted/tone-only, but still sent for unrelated factual/direct questions.
   - Risk: tone context can bias facts or increase latency/token count.

7. **Custom notes are always injected by KnowledgeOrchestrator when a result exists**
   - `KnowledgeOrchestrator.processQuestion` appends `<user_context>` unconditionally for candidate-directed results (`KnowledgeOrchestrator.ts:695-700`).
   - Risk: salary/private notes in custom context can pollute normal identity/project answers unless routed by intent.

8. **Provider-data scope checks are marker-dependent**
   - Scope inference looks for XML marker strings (`LLMHelper.ts:156-162`).
   - `_streamChatInner` computes `initialOutboundText` but passes only `message` into `getDeniedOutboundScopes` (`LLMHelper.ts:3417-3420`).
   - Risk: private context without markers may be sent to cloud providers when policy denies it.

9. **Persistent logs include sensitive paths**
   - Resume/JD upload logs absolute selected paths (`ipcHandlers.ts:4120`, `ipcHandlers.ts:4244`).
   - Main logs are persisted to Documents (`main.ts:65-93`, `main.ts:121-140`).
   - Risk: personal names/employers in filenames leak to logs.

10. **Eval harness mostly tests copied classifier logic**
    - `IntelligenceEvalComprehensive.test.mjs` inlines classifier constants instead of importing production (`IntelligenceEvalComprehensive.test.mjs:25-29`).
    - Risk: production code can drift while eval still passes.

## Data contracts summary

### Resume structured data

```ts
interface StructuredResume {
  identity: { name: string; email?: string; phone?: string; location?: string; linkedin?: string; github?: string; website?: string; summary?: string };
  skills: string[];
  experience: Array<{ company: string; role: string; start_date: string; end_date: string | null; bullets: string[] }>;
  projects: Array<{ name: string; description: string; technologies: string[]; url?: string }>;
  education: Array<{ institution: string; degree: string; field: string; start_date: string; end_date: string | null; gpa?: string }>;
  achievements: Array<{ title: string; description: string; date?: string }>;
  certifications: Array<{ name: string; issuer: string; date?: string }>;
  leadership: Array<{ role: string; organization: string; description: string }>;
}
```

### JD structured data

```ts
interface StructuredJD {
  title: string;
  company: string;
  location: string;
  description_summary: string;
  level: 'intern'|'entry'|'mid'|'senior'|'staff'|'principal';
  employment_type: 'full_time'|'part_time'|'contract'|'internship';
  min_years_experience: number;
  compensation_hint: string;
  requirements: string[];
  nice_to_haves: string[];
  responsibilities: string[];
  technologies: string[];
  keywords: string[];
}
```

### Prompt assembly result

```ts
interface PromptAssemblyResult {
  systemPromptInjection: string;
  contextBlock: string;
  isIntroQuestion: boolean;
  introResponse?: string;
  liveNegotiationResponse?: LiveCoachingResponse;
}
```

## Immediate fix targets

1. Add dynamic intent router/result model with fine-grained categories and safe debug metadata.
2. Add deterministic structured-memory fast paths for identity/name/email/location/role/projects/skills/education/experience/JD role.
3. Ensure project/skill/experience questions get structured facts directly, not only vector nodes.
4. Apply knowledge system prompt consistently in stream and non-stream paths without letting assistant identity override user identity.
5. Separate persona/tone, negotiation, JD, custom context, reference files, and transcript by intent.
6. Make AOT/cache artifacts versioned by current resume/JD IDs and invalidate on context changes.
7. Add latency instrumentation with redacted labels/hashes only.
8. Replace copied routing evals with production-path tests and expand eval to 200+ tracked production assertions.
