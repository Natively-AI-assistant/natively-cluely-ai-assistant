# Tech Debt — Architecture Review Notes

This directory contains architecture review findings that **do not change any code**. Each document describes a problem, explains why it is a problem, and proposes a concrete fix for the implementing developer.

> These documents are the output of a focused review session on the `IntelligenceEngine` answering pipeline (August 2026).

---

## Documents

### 1. [`intelligence-engine-architecture-critique.md`](./intelligence-engine-architecture-critique.md)
**Scope**: `electron/IntelligenceEngine.ts` (5,094 lines) and `electron/llm/`

Covers:
- The God-file problem (`runWhatShouldISay` at ~2,400 lines)
- The post-stream repair cascade (up to 3 sequential blocking LLM calls after the answer already streams to the UI)
- `AnswerPlanner.ts` at 211KB — no internal module split
- Manual path / WTA path post-processing duplication (`ipcHandlers.ts` "mirrors" pattern)
- Disabled answer relevance guard that still runs NLI classification on every answer
- `detectRefinementIntent` — possibly dead code
- Dynamic `require()` in the hot path
- Per-call-site context sanitization with inconsistent limits

**Priority fixes**: Delete disabled Phase 8 guard · Extract `WtaPipeline` stages · Unify post-processing · Move constraints into primary prompt

---

### 2. [`speculative-similarity-jaccard-critique.md`](./speculative-similarity-jaccard-critique.md)
**Scope**: `jaccardSimilarity()` and `handleSuggestionTrigger()` in `IntelligenceEngine.ts`

Covers:
- What Jaccard is doing (speculative pre-fetch reuse gate)
- Why token-overlap similarity fails on semantically opposite questions (strengths/weaknesses, success/failure)
- Why stop words inflate scores on interview questions
- Recommended fix: Sentence-BERT (`all-MiniLM-L6-v2`, 22MB) hybrid — Jaccard fast-exit for clear cases, SBERT for the ambiguous zone
- Implementation sketch reusing the existing `IntentClassifier.ts` worker pattern

**Priority fix**: Hybrid Jaccard + SBERT gate · Calibrate thresholds against a test set of interview question antonym pairs

---

## How to Use These Documents

Each document follows this structure:
1. **What it is** — describes the current code behavior
2. **What's wrong** — concrete failure modes with examples
3. **Recommended fix** — specific, implementable solution with code sketches where applicable

The documents are intentionally **read-only findings** — no production code was changed to produce this PR. The implementing developer should read the relevant section, verify the finding in the live code at the cited line numbers, and implement the recommended fix on a feature branch.

---

## Severity at a Glance

| Issue | Severity | Document |
|-------|----------|----------|
| Post-stream repair cascade (up to 14s added latency) | 🔴 Critical | Architecture Critique §1.2 |
| `runWhatShouldISay` ~2,400 lines, untestable | 🔴 Critical | Architecture Critique §1.1 |
| Disabled relevance guard still runs NLI on every answer | 🟡 Medium | Architecture Critique §2.1 |
| `AnswerPlanner.ts` 211KB monolith | 🟡 Medium | Architecture Critique §1.3 |
| Regex failure detectors per model/provider | 🟡 Medium | Architecture Critique §3.2 |
| Manual/WTA path post-processing duplicated | 🟡 Medium | Architecture Critique §1.4 |
| Dynamic `require()` in hot path | 🟡 Medium | Architecture Critique §3.3 |
| Jaccard antonym false-positive (strengths/weaknesses) | 🟡 Medium | Jaccard Critique |
| `detectRefinementIntent` possibly unwired | 🟠 Low | Architecture Critique §2.2 |
| Sanitization limits copy-pasted at 3 sites | 🟠 Low | Architecture Critique §3.4 |
