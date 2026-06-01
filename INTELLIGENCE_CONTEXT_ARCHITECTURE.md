# Context Architecture Design: Resolving Profile Intelligence Bugs

**Date:** 2026-05-31

This document outlines the architectural redesign of the Profile Intelligence context pipeline to resolve four reproduced bugs: identity confusion, project recall failures, context mixing, and latency overhead on simple queries.

## 1. Context Layers and Memory Separation

**Goal:** Stop throwing discrete structured facts (projects, skills, identity) into unstructured vector retrieval where thresholding can drop them.

### Tier A: Structured Profile Facts
- **Storage:** Persisted whole in SQLite under `KnowledgeDocument.structured_data` (`StructuredResume` / `StructuredJD`).
- **Access:** Direct synchronous retrieval by the orchestrator.
- **Content:** Identity (name, role, company, location), strict lists of projects, strict lists of skills, education, and JD requirements.
- **Usage:** Injected cleanly as deterministic `<structured_profile_facts>` XML blocks, bypassing vector search completely for simple recall.

### Tier B: Unstructured Vector Nodes
- **Storage:** Embedded and stored as `ContextNode` entries.
- **Content:** Semantic/narrative content only — experience bullet points, STAR stories, complex achievement descriptions.
- **Usage:** Vector retrieved via `HybridSearchEngine` only when the query intent demands narrative examples or semantic matching.

## 2. Smart Routing Rules

**Goal:** Route queries deterministically based on intent to prevent context mixing (JD/persona bleeding) and bypass expensive pipeline steps.

The `IntentClassifier` runs first. Context is assembled strictly based on the output intent:

1. **`INTRO` / Identity Direct:**
   - **Trigger:** "What is my name?", "Who am I?"
   - **Context:** ONLY Tier A Identity facts (or AOT pre-computed identity summary).
   - **Excluded:** JD, Persona, Negotiation, Vector nodes, Custom notes.
   - **LLM Call:** Bypassed if a deterministic answer exists, else fast-path LLM call with strict identity constraints.

2. **`PROFILE_DETAIL` (e.g., Projects/Skills):**
   - **Trigger:** "What are my projects?", "List my skills."
   - **Context:** Tier A specific array (Projects or Skills). Vector nodes (Tier B) only if the query implies narrative (e.g., "Tell me a story about a project").
   - **Excluded:** JD, Negotiation. Persona included only for tone.
   - **LLM Call:** Bypassed if a deterministic list exists, else fast-path formatting call.

3. **`NEGOTIATION`:**
   - **Trigger:** "What salary should I ask for?"
   - **Context:** Negotiation script, JD compensation hints, salary intelligence.
   - **Excluded:** Projects, Education, STAR stories.

4. **`GENERAL` / `TECHNICAL` (Non-Candidate Framed):**
   - **Trigger:** "Explain TCP handshake."
   - **Action:** Full Bypass. Return `null` from `processQuestion`. Let base assistant handle it. No profile context loaded.

5. **`AMBIGUOUS` (General intent, no framing):**
   - **Trigger:** "Is this a good idea?"
   - **Action:** Inclusion Bias. Inject compact identity block (Tier A) to provide context without heavy vector retrieval.

## 3. Prompt Injection Order (Identity Confusion Fix)

**Goal:** Ensure the candidate persona overrides the default assistant persona ("I am Natively") when profile mode is active.

### Current Flaw
`systemPromptOverride = CORE_IDENTITY + "\n\n" + knowledgeInjection;`
This causes the LLM to prioritize the first instruction (assistant) over the later one (candidate).

### New Assembly Contract
When `knowledgeMode` is active and intent is candidate-directed:
1. **Candidate Identity First:** `systemPromptOverride = knowledgeResult.systemPromptInjection;`
2. **Weakened Guardrail Last:** Append a modified safety guard at the bottom:
   ```xml
   <assistant_rules>
   You are acting exclusively as the candidate described above. Do not break character or introduce yourself as an AI assistant unless explicitly asked to step out of character (e.g. "Who created you?").
   </assistant_rules>
   ```
3. **Consistency:** This logic must be applied symmetrically across both **streaming** (`_streamChatInner`) and **non-streaming** (`chatWithGemini`) paths in `LLMHelper.ts`.

## 4. Latency Fast Paths

**Goal:** Eliminate the 7s+ delay for simple queries like "What is my name?" by removing unnecessary embedding and LLM calls.

### The Fast-Path Short Circuit
1. **Immediate Resolution:** `IntentClassifier` runs. If `INTRO`, `IDENTITY_DIRECT`, or a strict subset of `PROFILE_DETAIL` (e.g., "list my skills").
2. **Bypass Embeddings:** Do NOT call `EmbeddingPipeline.getEmbeddingForQuery`.
3. **Bypass Vector Search:** Do NOT call `getRelevantNodes()`.
4. **Deterministic Yield:** If an AOT pre-computed summary exists (e.g., `aot_identity_summary`, `aot_projects_summary`), return it immediately as `introResponse` or similar direct output payload.
5. **If LLM Formatting Needed:** Send only the tiny Tier A block to the LLM.

### Telemetry Design
To measure the impact safely:
- Log `intent_classified` (e.g., `INTRO`).
- Log `context_selected` (e.g., `[TierA_Identity]`).
- Log `pipeline_path` (e.g., `deterministic_bypass` vs `vector_retrieval_llm`).
- Log `latency_ms` for each phase.
- **Never log:** Raw names, salaries, or project descriptions. Use counts or hashes.