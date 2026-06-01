# Context Architecture Design: Resolving Profile Intelligence Bugs

**Date:** 2026-05-31

This document proposes an architectural redesign of the Profile Intelligence context pipeline to structurally resolve four reproduced bugs: identity confusion, project recall failures, context mixing, and latency overhead on simple queries.

## 1. Separating Structured Profile Facts from Unstructured Nodes

**The Bug:** The system currently treats discrete structured facts (projects, skills, education) similarly to unstructured text (achievements, stories) by throwing them into the vector database. When a user asks "What projects have I worked on?", the vector search (`getRelevantNodes`) often retrieves poorly matching semantic chunks instead of a clean list of projects, leading to incomplete or hallucinated project recall.

**Architectural Fix: The Two-Tier Context Model**
*   **Tier A (Structured Facts Database):** During the ingestion phase (`StructuredExtractor.ts`), parse out immutable profile facts (Name, Role, Company, Years of Experience, strict list of Projects, list of Skills). Store these cleanly in SQLite (`knowledge_documents` or a dedicated profile facts table), *not* just as embeddable chunks.
*   **Tier B (Unstructured Vector Nodes):** Restrict chunking and embedding (`DocumentChunker.ts`) exclusively to semantic, narrative content (e.g., STAR-method bullet points, complex achievement descriptions, work histories).
*   **Pipeline Update:** In `KnowledgeOrchestrator.assemblePromptContext`, stop relying on `getRelevantNodes()` to return basic facts. Instead, always pull Tier A data directly from SQLite and inject it into a deterministic `<structured_profile_facts>` XML block. Use Tier B (vector retrieval) *only* to supplement the prompt with narrative examples.

## 2. Defining Deterministic Identity/Project Answers

**The Bug:** "Identity confusion" ("What is my name?" -> "I don't know") happens because identity questions rely entirely on the LLM synthesizing an answer from the injected context block. Even when the context block contains the name, the LLM might decide it's acting as a generic assistant and refuse to answer on behalf of the user.

**Architectural Fix: AOT Pre-computation & Fast-Path Yielding**
*   **Expand the Intro Fast-Path:** The current pipeline has a `generateJitIntro()` mechanism. Expand this to a generalized **Deterministic Fact Yielder**.
*   **AOT Pre-computation:** During `AOTPipeline.runForJD()`, pre-compute specific blocks of text for deterministic queries:
    *   `aot_identity_summary`: "I am [Name], currently a [Role] at [Company]."
    *   `aot_projects_summary`: A bulleted list of all projects extracted in Tier A.
*   **Execution Rule:** In `processQuestion()`, if `IntentClassifier` detects `IDENTITY_DIRECT_PATTERNS` or specific `PROFILE_DETAIL_PATTERNS` (like "what are my projects"), **intercept the request before LLM execution**. Yield the pre-computed `aot_` string directly. Do not pass go, do not call Gemini/Claude.

## 3. Fixing Prompt Injection Order (Candidate vs. Assistant Identity)

**The Bug:** Context mixing occurs because of the prompt assembly order. In streaming paths, `CORE_IDENTITY` (which asserts "I am Natively, an AI assistant") is *prepended* to the profile's injected system prompt. In non-streaming paths, the profile prompt isn't applied at all. This causes a massive identity clash where the LLM obeys the very first instruction ("I am Natively") and ignores the later instruction ("Adopt the persona of Aarav Menon").

**Architectural Fix: Strict Priority Reordering in LLMHelper**
*   **The Inversion Rule:** When `knowledgeMode` is active and `hasCandidateFraming` is true, the candidate persona *must* wrap or override the assistant persona.
*   **Refactoring `LLMHelper.ts` (Prompt Assembly):**
    *   *Current State:* `systemPromptOverride = CORE_IDENTITY + "\n\n" + knowledgeInjection;`
    *   *New State:*
        ```javascript
        let systemPromptOverride = knowledgeInjection; 
        // Append a modified, weakened core identity at the end as a fallback safety guard
        systemPromptOverride += "\n\n<assistant_rules>You are acting exclusively as the candidate described above. Do not break character or introduce yourself as an AI assistant unless explicitly asked to step out of character.</assistant_rules>";
        ```
*   **Unifying Streaming and Non-Streaming:** Apply the exact same `assemblePromptContext()` injection logic to non-streaming calls (`chatWithGemini`, etc.) to ensure consistency across the application.

## 4. Eliminating Unnecessary LLM/Embedding Calls for Simple Queries

**The Bug:** The system generates a vector embedding (`EmbeddingPipeline.getEmbeddingForQuery`) and performs a hybrid search for every single query that passes the candidate framing check, even for things like "Who am I?" or "What's my current role?". This adds ~50-100ms (or more if local dimension fallback fails) of pure latency overhead.

**Architectural Fix: Intent-Gated Pipeline Execution**
*   **Step 1: Early Intent Resolution:** Ensure `IntentClassifier.classifyIntent()` is the absolute first step in `processQuestion()`.
*   **Step 2: The Fast-Path Short Circuit:** If the intent is classified as `INTRO`, `IDENTITY`, or an exact match for a deterministic fact (see Section 2), return the deterministic string immediately. **Do not embed the query. Do not hit the LLM API.**
*   **Step 3: Refined Router Inclusion Bias:** 
    *   If the intent is `GENERAL` or `AMBIGUOUS` (lacks candidate framing but isn't a strict bypass), inject the `buildCompactIdentityBlock()` (AOT Intro) into the prompt, but **skip the `getRelevantNodes()` vector search**.
    *   *Only* execute the full, expensive pipeline (Query Embedding -> Vector Search -> Context Assembly -> LLM Stream) when the intent is explicitly `SEMANTIC_QUERY`, `TECHNICAL`, `NEGOTIATION`, or `COMPANY_RESEARCH`. 
