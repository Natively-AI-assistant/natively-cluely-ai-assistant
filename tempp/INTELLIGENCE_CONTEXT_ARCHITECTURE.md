# INTELLIGENCE_CONTEXT_ARCHITECTURE.md

## Context Pipeline Diagram

```
User Upload/Persistence                    Backend Chat Flow
─────────────────────────                 ─────────────────

Resume Upload
  ProfileIntelligenceSettings
        │
        ▼
  profile:upload-resume IPC
        │
        ▼
  KnowledgeOrchestrator.ingestDocument()
        │
        ├─► DocumentReader.extractDocumentText()
        ├─► StructuredExtractor.extractStructuredData() [LLM]
        ├─► PostProcessor.processResume()
        ├─► DocumentChunker.chunkAndEmbedDocument()
        ├─► KnowledgeDatabaseManager.saveDocument() [SQLite]
        └─► refreshCache() ──► activeResume (in-memory)
                                         │
JD Upload                                   │ Knowledge Mode Active?
  (same pipeline, DocType.JD)              │
        │                                    ▼
        ▼                            LLMHelper.streamChat()
  AOTPipeline.runForJD()                  │
  ├─► GapAnalysisEngine                    │
  ├─► NegotiationEngine                   ▼
  ├─► MockInterviewGenerator          shouldRunKnowledge?
  ├─► CultureValuesMapper                 │
  ├─► CompanyResearchEngine               (ignoreKnowledgeMode = false?)
        │                                    │
Custom Notes / Persona                       ▼
  ProfileIntelligenceSettings           processQuestion(message)
        │                                    │
        ▼                               classifyIntent()
  profile:save-notes/persona          hasCandidateFraming?
  DatabaseManager (SQLite)                    │
  LLMHelper.setCustomNotes/setPersonaPrompt() │
                                              ▼
Persona Engine Toggle                   IDENTITY_DIRECT_PATTERNS matched?
  ProfileIntelligenceSettings               │
        │                                    ▼
        ▼                               getRelevantNodes()
  profile:set-mode                     hybrid search from
  orchestrator.setKnowledgeMode(true)    resume/JD chunks
  SettingsManager (persisted)
                                              ▼
Persona Engine OFF                    assemblePromptContext()
  (normal LLM path, no persona)       buildIdentityHeader()
                                              │
  "what is my name?"                    ▼
    ├─► intro shortcut               buildKnowledgeSystemPrompt()
    └─► normal LLM call with         <knowledge_engine_rules>
        no identity context                │
                                              ▼
                                           LLM Prompt Assembly
                                              │
                                              ▼
                                           CORE_IDENTITY
                                           + <knowledge_engine_rules>
                                           + candidate_experience nodes
                                           + candidate_projects nodes
                                           + user_context
                                           + salary_intelligence
                                           + dossier
```

## Frontend Context Flow

```
ProfileIntelligenceSettings.tsx
    │
    ├─► profileGetStatus() ──► { hasProfile, profileMode, name, role }
    ├─► profileGetProfile() ──► { identity, skills, experience, activeJD, ... }
    ├─► profileSavePersona() ──► DatabaseManager + LLMHelper.setPersonaPrompt()
    ├─► profileSaveNotes() ───► DatabaseManager + LLMHelper.setCustomNotes()
    └─► profileSetMode() ────► orchestrator.setKnowledgeMode() + SettingsManager

MeetingChatOverlay.tsx
    │
    ├─► RAG path: ragQueryMeeting() ─► ragManager ─► streaming tokens
    └─► Fallback path: streamGeminiChat()
            │
            └─► { skipSystemPrompt: true } ─► context = meetingTranscript
                                                          │
                                                          ▼
                                               LLMHelper._streamChatInner()
                                                     │
                                                     ▼
                                               shouldRunKnowledge? ──► YES (if persona engine on)
                                                     │
                                                     ▼
                                               processQuestion() ──► identity response
```

## Backend Context Flow

```
IPC: gemini-chat-stream
    │
    ▼
LLMHelper._streamChatInner()
    │
    ├─► depth scorer (always feeds, even when orchestrator bypassed)
    │
    ├─► IF shouldRunKnowledge:
    │       processQuestion(message)
    │       ├─► classifyIntent() ─► INTRO / PROFILE_DETAIL / NEGOTIATION / TECHNICAL / COMPANY_RESEARCH / GENERAL
    │       ├─► isGenericKnowledgeQuestion() ─► false for candidate questions
    │       ├─► hasCandidateFraming ─► true if /you|your|me|my|.../i matches
    │       ├─► getRelevantNodes() ─► hybrid search with JD boost
    │       ├─► assemblePromptContext() ─► identity header + system prompt rules + nodes
    │       └─► PromptAssemblyResult { systemPromptInjection, contextBlock, introResponse }
    │
    ├─► MODE INJECTION (after knowledge, unless universal prompt):
    │       getActiveModeSystemPromptSuffix() + buildRetrievedActiveModeContextBlock()
    │
    └─► Provider routing:
            ├─► Multimodal: streamVisionWithFallback()
            ├─► Groq fast: Groq direct / Codex CLI
            ├─► Cloud: finalSystemPrompt + cloudCombinedContext (= context only)
            └─► Local: finalSystemPrompt + combinedContext (= personaContext + context)
```

## Context Priority Order

| Priority | Context Source | Trust Level | Where Defined |
|----------|--------------|-------------|--------------|
| 1 | Negotiation live coaching | (bypass) | `generateLiveCoachingResponse()` |
| 2 | JIT intro response | (bypass) | `generateJitIntro()` |
| 3 | Knowledge system prompt | SYSTEM_POLICY | `buildKnowledgeSystemPrompt()` |
| 4 | Candidate experience nodes | TRUSTED_PROFILE | `formatContextBlock()` |
| 5 | Candidate projects nodes | TRUSTED_PROFILE | `formatContextBlock()` |
| 6 | JD salary intelligence | TRUSTED_PROFILE | `SalaryIntelligenceEngine` |
| 7 | JD dossier / company research | TRUSTED_PROFILE | `CompanyResearchEngine` |
| 8 | Gap pivot scripts | TRUSTED_PROFILE | `GapAnalysisEngine` |
| 9 | Mock question hints | TRUSTED_PROFILE | `MockInterviewGenerator` |
| 10 | Culture value alignments | TRUSTED_PROFILE | `CultureValuesMapper` |
| 11 | Mode custom instructions | MODE_POLICY | `ModesManager` |
| 12 | Mode reference files | UNTRUSTED_REFERENCE | `ModesManager` |
| 13 | User-provided persona | USER_PREFERENCES | `LLMHelper.personaPrompt` |
| 14 | User-provided notes | USER_PREFERENCES | `orchestrator.customNotes` |
| 15 | Meeting transcript | UNTRUSTED_TRANSCRIPT | `PromptAssembler` |
| 16 | Screen context | UNTRUSTED_SCREEN | `PromptAssembler` |
| 17 | Meeting history | UNTRUSTED_MEETING_HISTORY | `PromptAssembler` |

## Token/Truncation Strategy

- **TrustLevel ordering**: When token budget is exceeded, lowest-trust blocks are truncated first
- **Mode context**: MAX_FILE_CHARS = 12,000 per file, MAX_TOTAL_CHARS = 40,000 across all files
- **Combined context cap**: COMBINED_CTX_CAP = 60,000 chars (mode context + existing context)
- **Per-block budgets**: transcript=4000, mode_context=1800, screen=600, meeting_history=1000, custom_context=500
- **Truncation marker**: ` [...truncated]` appended to truncated blocks

## Debuggability

Context assembly can be traced via console.log statements:

```
[LLMHelper] Knowledge mode (stream): returning generated intro response
[ContextAssembler] Generating Just-In-Time Intro...
[KnowledgeOrchestrator] Intent classified: INTRO
[KnowledgeOrchestrator] Non-candidate-directed question — bypassing persona & retrieval
[KnowledgeOrchestrator] Category hints detected: [project, skills]
[KnowledgeOrchestrator] Injecting JD-based salary intelligence
```

Safe debug fields logged without PII:
- `hasResumeContext: true/false`
- `resumeContextLength: number`
- `activeModeId: string`
- `finalPromptTokenEstimate: number`

## Privacy/Logging Rules

- **Never log full resume/JD content** in production console
- `KnowledgeOrchestrator` only logs structured metadata (docId, node count, processing step)
- `PromptAssembler` logs block types and trust levels, not content
- User-controlled content (persona, custom notes) logged at DEBUG level only
- `escapeUserContent()` neutralizes XML injection in all user-controlled strings
- `escapePromptInjection()` neutralizes prompt injection patterns in user content

## Regression Test Coverage

| Scenario | Test Location | Status |
|----------|-------------|--------|
| Resume upload + persona engine off → normal LLM | `ModeFixtureIntegrity.test.mjs` | ✅ |
| Resume upload + persona engine on → persona response | `ModeFixtureIntegrity.test.mjs` | ✅ |
| "what is my name?" with uploaded resume | `ModeFixtureIntegrity.test.mjs` | ✅ |
| JD upload → AOT pipeline runs | `ModeFixtureIntegrity.test.mjs` | ✅ |
| Negotiation coaching fires for salary questions | `ModeFixtureIntegrity.test.mjs` | ✅ |
| Mode switch preserves context | `ModeLongSession.test.mjs` | ✅ |
| App reload restores knowledge mode | `ModeLongSession.test.mjs` | ✅ |
| RAG fallback → normal LLM when orchestrator bypassed | `ModeFixtureIntegrity.test.mjs` | ✅ |