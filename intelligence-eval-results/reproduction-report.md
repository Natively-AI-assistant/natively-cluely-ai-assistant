# Profile Intelligence Reproduction Report

Status: Phase 2 reproduction before production fixes in this session.

## Scope

Bug classes requested:

1. Identity confusion: `what is my name?` must answer from loaded profile, never assistant identity.
2. Project recall failure: `what are my projects?` must list loaded resume/custom/reference projects or say missing.
3. Wrong context mixing: stable personal facts should not be overwritten by JD/transcript/mode/persona.
4. JD overuse: personal background questions should prioritize resume/profile/custom context.
5. Persona overuse: persona controls tone/style only, not facts.
6. Negotiation overuse: compensation context only for salary/offer/HR negotiation.
7. Live transcript pollution: transcript only when relevant, never overriding stable profile facts.
8. Latency: identify why profile answers can take 7+ seconds.

## Commands run

### Current routing/eval regression suite

```bash
node --test electron/services/__tests__/IntelligenceEval.test.mjs \
  electron/services/__tests__/IntelligenceEvalComprehensive.test.mjs \
  electron/services/__tests__/RouterInclusionBias.test.mjs \
  electron/services/__tests__/LLMHelperNegotiationCoachingGate.test.mjs
```

Observed result:

- Current routing/gating tests pass.
- Existing comprehensive harness writes `intelligence-eval-results/iteration-002.json`.
- `iteration-002.json` currently reports:
  - total tracked cases: 190
  - passed: 190
  - failed: 0
  - accuracy: 100%
  - identity recall accuracy: 100%

Important limitation: these tests are mostly classifier/routing tests. The broad harness inlines classifier constants instead of importing production implementation, so it is not enough to prove production prompt/output correctness.

### Static production probes

```bash
python3 - <<'PY'
from pathlib import Path
root = Path('/Users/evin/natively-cluely-ai-assistant')
llm = (root/'electron/LLMHelper.ts').read_text()
ctx = (root/'premium/electron/knowledge/ContextAssembler.ts').read_text()
chunker = (root/'premium/electron/knowledge/DocumentChunker.ts').read_text()
chat = llm[llm.index('public async chatWithGemini'):llm.index('  /**', llm.index('public async chatWithGemini')+1)]
hardcoded_final = 'const finalGeminiPrompt = this.injectLanguageInstruction(HARD_SYSTEM_PROMPT)' in chat and 'const openaiSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(OPENAI_SYSTEM_PROMPT)' in chat
stream_prefix = 'systemPromptOverride = `${CORE_IDENTITY}\\n\\n${knowledgeResult.systemPromptInjection}`' in llm
identity_nodes_absent = 'category: \'identity\'' not in chunker and 'candidate_identity' not in chunker
project_nodes_thresholded = "category: 'project'" in chunker and 'RELEVANCE_THRESHOLD = 0.55' in (root/'premium/electron/knowledge/HybridSearchEngine.ts').read_text()
identity_answer_absent = 'Your name is' not in ctx and 'isIdentityDirect' not in ctx
print('non_streaming_prompt_still_hardcoded=', hardcoded_final)
print('streaming_core_identity_precedes_knowledge=', stream_prefix)
print('identity_nodes_absent_from_chunker=', identity_nodes_absent)
print('project_nodes_exist_but_thresholded=', project_nodes_thresholded)
print('identity_direct_deterministic_answer_absent=', identity_answer_absent)
PY
```

Observed output:

```text
non_streaming_prompt_still_hardcoded= True
streaming_core_identity_precedes_knowledge= True
identity_nodes_absent_from_chunker= True
project_nodes_exist_but_thresholded= True
identity_direct_deterministic_answer_absent= True
```

This reproduces the failures at prompt/routing/retrieval-contract level without making external LLM calls.

## Bug class reproduction notes

### 1. Identity confusion

Current status: **reproduced as a production prompt-level bug/risk**.

Evidence:

- `CORE_IDENTITY` explicitly allows assistant identity answers for assistant-meta probes: `"I'm Natively, an AI assistant."` (`electron/llm/prompts.ts:26-29`).
- Streaming profile path prepends `CORE_IDENTITY` before the profile/candidate system prompt when knowledge mode injects a system prompt (`electron/LLMHelper.ts:3351-3353`).
- Direct identity questions are not deterministically answered from structured memory. `ContextAssembler` excludes `what is my name?` from self-intro, then builds a system prompt and lets the LLM infer from `buildIdentityHeader` (`premium/electron/knowledge/ContextAssembler.ts:35-43`, `ContextAssembler.ts:282-293`).
- `DocumentChunker` does not create identity nodes, so identity is not a retrievable context category (`premium/electron/knowledge/DocumentChunker.ts:50-120`).
- Non-streaming path receives `knowledgeResult.systemPromptInjection` but does not apply it to the actual system prompts (`electron/LLMHelper.ts:1535-1544`, `LLMHelper.ts:1569-1613`).

Why this reproduces the observed bad answer:

- For `what is my name?`, the correct answer is a simple structured fact.
- Current code can route to a prompt where assistant identity text is higher/earlier than candidate identity rules and there is no deterministic fast answer.
- If the provider follows the first/high-priority assistant identity instruction, it can answer `I'm Natively, an AI assistant.` instead of the user's loaded name.

Current test gap:

- Existing tests prove `what is my name?` is not generic-routed, but they do not assert that the real production provider prompt cannot answer as Natively.

### 2. Project recall failure

Current status: **reproduced as a retrieval/structured-memory design bug**.

Evidence:

- Structured resume stores `projects` (`premium/electron/knowledge/types.ts:118-127`).
- `DocumentChunker` creates project nodes (`DocumentChunker.ts:74-86`).
- Project answers currently depend on `getRelevantNodes` scoring above threshold `0.55` (`premium/electron/knowledge/HybridSearchEngine.ts:3`, `HybridSearchEngine.ts:221-223`).
- `KnowledgeOrchestrator.processQuestion` only passes retrieved nodes into `assemblePromptContext`; it does not directly include all structured projects for project intent (`KnowledgeOrchestrator.ts:607-619`).
- If embeddings are missing/mismatched, local query embedder is unavailable, or terse query scores below threshold, the context block can be empty even though structured projects exist.

Expected failing case:

- Resume contains projects.
- User asks `what are my projects?`.
- Retrieval returns zero project nodes.
- Prompt has identity/JD/persona but no `<candidate_projects>` block.
- LLM falls back to generic response such as `I have your background loaded...` or asks what the user wants.

Current test gap:

- Existing eval validates routing for project questions, not that all structured project names/descriptions are included or emitted.

### 3. Wrong context mixing

Current status: **reproduced as multiple state/prompt mixing risks**.

Evidence:

- `buildIdentityHeader` always includes target JD role/company when `jdDoc` exists (`ContextAssembler.ts:70-91`), even for simple personal identity/project questions.
- Custom notes are appended for every non-null profile result (`KnowledgeOrchestrator.ts:695-700`).
- Persona is appended for every streaming provider request (`LLMHelper.ts:3441-3449`).
- AOT artifacts are not clearly versioned by current `(resumeId, jdId)` pair. `getNegotiationScript` checks in-memory AOT cache before active JD validation (`KnowledgeOrchestrator.ts:168-174`), and JD delete does not reset AOT pipeline (`KnowledgeOrchestrator.ts:716-720`).

Impact:

- Old JD/company/salary/gap/mock/culture context can leak after resume/JD replacement.
- JD role/company can pollute direct profile answers.
- Salary/private custom notes can appear in unrelated answers.

### 4. JD overuse

Current status: **reproduced as prompt-selection risk**.

Evidence:

- JD target context is included in identity header for any assembled profile answer when JD exists (`ContextAssembler.ts:70-91`).
- Retrieval can include both resume and JD nodes for candidate-directed questions (`KnowledgeOrchestrator.ts:479-485`).
- JD required skills boost resume nodes for any candidate-directed retrieval, not only alignment questions (`KnowledgeOrchestrator.ts:459-485`, `HybridSearchEngine.ts:130-140`).

Impact:

- `what is my name?` or `what are my projects?` can carry JD framing despite not needing it.

### 5. Persona overuse

Current status: **reproduced as global context inclusion risk**.

Evidence:

- `LLMHelper._streamChatInner` unconditionally includes `personaPrompt` in `combinedContext` if set (`LLMHelper.ts:3441-3444`).
- The label says tone/preferences only, but the context still consumes tokens and can bias factual answers.

Impact:

- Persona like `confident senior engineer` can affect factual recall style and may encourage inflated experience unless a stronger router excludes it or strictly constrains it.

### 6. Negotiation overuse

Current status: **partially reproduced and partially covered**.

Evidence of protection:

- `LLMHelperNegotiationCoachingGate.test.mjs` verifies live negotiation coaching is gated by active mode.
- `KnowledgeOrchestrator` injects salary context only when `intent === NEGOTIATION` (`KnowledgeOrchestrator.ts:546-575`).

Remaining risk:

- Custom notes can contain salary targets and are always appended to profile results (`KnowledgeOrchestrator.ts:695-700`).
- A stale negotiation script can survive JD deletion/replacement because AOT cache invalidation is incomplete.

### 7. Live transcript pollution

Current status: **partially covered; direct profile fast path missing**.

Evidence of partial protection:

- `IntelligenceEngine.runWhatShouldISay` uses cleaned transcript and dedupes interim duplicates (`IntelligenceEngine.ts:568-594`).
- `PromptAssembler` treats transcript as untrusted (`PromptAssembler.ts:334-343`).
- Existing tests cover some prepared transcript/overlay/sentinel behavior.

Remaining risk:

- Manual profile questions pass recent session transcript as `context` into `AnswerLLM.generate` (`IntelligenceEngine.ts:981-982`, `AnswerLLM.ts:15-20`).
- Without a deterministic structured-memory fast path, irrelevant live transcript can be presented alongside direct profile facts and bias the LLM.

### 8. Latency issue

Current status: **root-cause bottlenecks reproduced by code-path inspection; e2e provider timing requires runtime credentials/network**.

Local current test runtime:

- Routing/eval unit tests complete quickly and are not representative of provider latency.
- Existing `iteration-002.json` has no latency fields.

Hot-path bottlenecks identified:

1. **No deterministic fast path for direct facts**
   - `what is my name?`, `what is my email?`, `what are my projects?`, `what are my skills?` currently can go through orchestrator/retrieval/provider generation.

2. **Query embedding/retrieval on simple structured questions**
   - `processQuestion` starts retrieval for candidate-directed questions (`KnowledgeOrchestrator.ts:478-491`).
   - If local query embedder is unavailable/dimension-mismatched, it falls back to cloud embedding.

3. **Possible live company/salary LLM calls on question path**
   - Company research can run live if no cached dossier exists and `needsCompanyResearch(question)` is true (`KnowledgeOrchestrator.ts:493-517`).
   - Resume-only salary estimate can run live for negotiation questions (`KnowledgeOrchestrator.ts:546-575`).

4. **Provider prewarm mismatch**
   - `prewarmPromptCache` warms `HARD_SYSTEM_PROMPT`, not the profile/mode-specific prompt that may be used for real profile questions (`LLMHelper.ts:1452-1458`).
   - It marks a key as warmed before success (`LLMHelper.ts:1458-1461`).

5. **Streaming UI delay in what-to-answer path**
   - `WhatToAnswerLLM` yields tokens, but `IntelligenceEngine.runWhatShouldISay` buffers full answer and emits one token event at the end (`IntelligenceEngine.ts:626-672`).

6. **Non-streaming fallback can add seconds**
   - Non-streaming dynamic fallback retries full provider rotations with backoff (`LLMHelper.ts:1804-1814`).

Likely 7+ second sequence for a profile question:

1. Query route + embedding fallback/cold pipeline wait.
2. Prompt/context assembly includes more than needed.
3. Provider cold prefill because cache prewarm does not match prompt.
4. Provider first token/network latency.
5. Full-answer buffering or non-streaming fallback delays user-visible output.

## Reproduction summary table

| Bug class | Current local reproduction | Evidence type |
|---|---:|---|
| Identity confusion | Yes | Prompt ordering + missing deterministic answer + non-stream injection gap |
| Project recall failure | Yes | Structured projects can be dropped by retrieval threshold; no direct structured pack |
| Wrong context mixing | Yes | JD/custom/persona/AOT over-inclusion and stale caches |
| JD overuse | Yes | JD target in identity header and JD boost for broad profile questions |
| Persona overuse | Yes | Persona globally appended to streaming context |
| Negotiation overuse | Partial | Mode gate exists; custom notes/stale script risks remain |
| Transcript pollution | Partial | Transcript is untrusted but no direct stable-fact fast path |
| Latency | Yes | Hot-path code inspection shows avoidable LLM/retrieval/provider delays |

## Fix order from reproduction

1. Add structured-memory context router and deterministic fast path for identity/projects/skills/education/experience/JD role.
2. Apply knowledge prompt injection consistently and prevent assistant identity from overriding user identity.
3. Include structured project/skill/experience packs by intent, independent of retrieval threshold.
4. Route/exclude JD/custom/persona/negotiation/reference/transcript by intent.
5. Version/invalidate AOT caches by active resume/JD IDs.
6. Add privacy-safe latency telemetry and prompt/context route debug metadata.
7. Replace routing-copy evals with production-path tests and answer/context assertions.
