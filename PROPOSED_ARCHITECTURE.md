# Context Architecture Document

## Overview
This document outlines the proposed context architecture designed to resolve the four target bugs: identity confusion, project recall, context mixing, and latency.

## 1. Separating Structured Profile Facts from Unstructured Nodes

**Problem:** Currently, structured profile data (like projects, skills, education) is often treated as unstructured text for vector retrieval, causing poor recall for exact facts (e.g., "What projects have I worked on?").

**Solution:**
- **Tier A (Structured Facts):** Extract and cache high-confidence structured facts (Name, Role, Company, Years of Experience, specific Skills, Project Titles) directly in SQLite during ingestion.
- **Tier B (Unstructured Nodes):** Keep vector chunks strictly for semantic details (e.g., STAR method stories, specific situational achievements).
- **Injection Logic:** 
  - When `IntentClassifier` detects an identity or structured fact query (e.g., `PROFILE_DETAIL_PATTERNS`, `IDENTITY_DIRECT_PATTERNS`), bypass vector retrieval and directly inject the structured JSON/text representation of the requested category from Tier A.
  - Reserve vector retrieval (Tier B) only for complex semantic queries (e.g., "Tell me about a time you handled a difficult client").

## 2. Defining Deterministic Identity/Project Answers

**Problem:** "Identity confusion" arises because identity questions rely on LLM synthesis of injected context, which can be overridden by system prompts or generic personas. 

**Solution:**
- **AOT Intro Bypass for Core Identity:** Expand the `generateJitIntro()` mechanism to handle *all* direct identity questions (Name, Current Role, Current Company) deterministically. 
  - If intent is `INTRO` and matches an exact identity field, return the string directly from the structured database without invoking the LLM (e.g., `"I am Aarav Menon, a Senior Backend Engineer."`).
- **Deterministic Project Summaries:** Precompute a structured summary of projects during AOT processing (`aot_results` table). If the user asks "What are my projects?", yield the precomputed project summary block directly, bypassing the LLM.

## 3. Fixing Prompt Injection Order (Candidate vs. Assistant Identity)

**Problem:** The `CORE_IDENTITY` (which defines the assistant as an AI) prepends the injected profile system prompt, causing the LLM to prioritize its identity as an AI assistant over the candidate's persona.

**Solution:**
- **Reorder System Prompts:** When `knowledgeMode` is active and `hasCandidateFraming` is true, the `systemPromptOverride` must prioritize the Candidate Identity.
- **Architecture Change in `LLMHelper.ts`:**
  - **Old:** `systemPromptOverride = CORE_IDENTITY + injection`
  - **New:** `systemPromptOverride = injection + "\n\n" + CORE_IDENTITY_FALLBACK` (Where the fallback explicitly states: "You are acting on behalf of the candidate described above. Adopt their persona completely. Do not introduce yourself as an AI assistant unless explicitly breaking character.")
- **Strict Role Boundary:** For non-streaming paths, ensure the same prompt injection logic is applied to prevent generic assistant prompts from overriding profile facts.

## 4. Eliminating Unnecessary LLM/Embedding Calls for Simple Queries

**Problem:** Every query, even "What is my name?", triggers context assembly, embedding generation, and potentially LLM calls.

**Solution:**
- **Intent-Based Fast Pathing:** 
  1. `classifyIntent()` runs first.
  2. If Intent is `INTRO`, `IDENTITY`, or `STRUCTURED_FACT`, lookup the fact directly from SQLite structured data.
  3. If found, return immediately. No embeddings, no LLM API call.
- **Router Inclusion Bias (Refined):**
  - If Intent is Ambiguous, inject only the `<candidate_identity>` block (Name, Role) into the prompt and make the LLM call, but *skip* the vector retrieval step (`getRelevantNodes`).
  - Only execute the full pipeline (Embedding + Hybrid Search + LLM) if the Intent is explicitly `SEMANTIC_QUERY`, `TECHNICAL`, or `COMPANY_RESEARCH`.
