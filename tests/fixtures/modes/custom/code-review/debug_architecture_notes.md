# Natively custom-mode answer-path architecture notes

## High-level flow
1. `IntelligenceEngine` receives a transcript chunk or explicit Ask action.
2. `IntentClassifier` decides whether the turn warrants an answer.
3. `WhatToAnswerLLM` owns runtime intent classification and live-answer prompt construction.
4. `PromptAssembler` combines the live answer request with retrieved snippets, screen OCR context, prior responses, and the active mode prompt suffix.
5. `LLMHelper.streamChat` routes the assembled prompt to the active provider (Claude / Gemini / OpenAI / Natively / Ollama).

## Ownership
- Modes Manager owns the mode catalog, reference files, and the active mode prompt suffix.
- ModeContextRetriever owns lexical retrieval; ModeHybridRetriever owns hybrid lexical + vector retrieval with telemetry on fallback.
- WhatToAnswerLLM must read the active mode suffix freshly per call because the active mode can be switched mid-session.
- WhatToAnswerLLM must be constructed with a live LLMHelper dependency before `generateStream` is called. Mode hot-swap may refresh ModesManager, but it must not drop provider routing dependencies.

## Invariants
- `ModesManager.getActiveModeSystemPromptSuffix()` returns a string, never undefined.
- `LLMHelper.streamChat` must be available for streaming live-answer calls. If the active provider is unavailable, streamChat owns provider fallback; callers should not bypass it.
- Prompt-suffix caching is owned by ModesManager, not by WhatToAnswerLLM.

## Known sharp edges
- Mode hot-swap during a live call: replacing or reconstructing WhatToAnswerLLM can accidentally preserve the refreshed ModesManager while losing the existing LLMHelper instance.
- Retrieval fallback: if hybrid retrieval cannot use embeddings, ModeHybridRetriever should fall back to lexical snippets without blocking live-answer prompt assembly.

## Test surfaces
- electron/services/__tests__/ModesManager.test.mjs covers the prompt-suffix invariant.
- electron/services/__tests__/PromptAssembler.test.mjs covers the assembly contract.
- electron/llm/__tests__/WhatToAnswerLLM.test.mjs should cover dependency preservation during custom-mode hot-swap.
