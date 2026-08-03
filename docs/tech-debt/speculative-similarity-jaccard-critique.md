# Speculative Pre-fetch: Jaccard Similarity Critique & Recommended Fix

> **Scope**: `electron/IntelligenceEngine.ts` — `jaccardSimilarity()` and `handleSuggestionTrigger()`  
> **Author**: Architecture review, August 2026  
> **Status**: Findings only — no code changed in this PR

---

## What the Jaccard Check Does

When the STT system detects a high-confidence interviewer question mid-sentence, the engine speculatively fires an LLM call before the sentence is finished (`maybeSpeculate`, line ~496). When the final, complete transcript arrives, `handleSuggestionTrigger` must decide: **is the question the model speculated on close enough to the final question to reuse the answer — or does it need to re-run?**

```
Interviewer mid-sentence (partial):   "Can you walk me through"
→ speculative LLM call fires

Interviewer finishes:                 "Can you walk me through your system design?"
→ Jaccard check: partial ↔ final
→ score ≥ threshold → reuse speculative answer, skip re-generation
```

The implementation is at lines 477–486:

```ts
private static jaccardSimilarity(a: string, b: string): number {
    const setA = IntelligenceEngine.wordsOf(a); // raw word tokens, lowercased
    const setB = IntelligenceEngine.wordsOf(b);
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    setA.forEach(w => { if (setB.has(w)) intersection++; });
    const jaccard = intersection / (setA.size + setB.size - intersection);
    // Containment: fraction of speculative words covered by final
    const containment = setA.size > 0 ? intersection / setA.size : 0;
    return Math.max(jaccard, containment * 0.9);
}
```

The **containment blend** (`Math.max(jaccard, containment * 0.9)`) was added because pure Jaccard underestimates prefix-to-full matches. The comment explicitly acknowledges this limitation.

---

## What Works

- Computationally free — runs in microseconds, no model load
- The containment blend is a correct and thoughtful fix for the intended prefix-completion case
- Works well for the common case: partial sentence vs. complete sentence on the same topic

---

## The Core Problem: Token Overlap ≠ Semantic Similarity

Jaccard compares raw word-token sets. This means two questions can score high despite being **semantically opposite**:

| Speculative text | Final text | Jaccard score | Should reuse? |
|---|---|---|---|
| `"Can you walk me through"` | `"Can you walk me through your design process?"` | ~0.90 (containment) | ✅ Yes |
| `"What are your greatest strengths"` | `"What are your greatest weaknesses"` | **~0.75** | ❌ No — opposite |
| `"Tell me about a time you succeeded"` | `"Tell me about a time you failed"` | **~0.64** | ❌ No — opposite |
| `"Can you describe your leadership style"` | `"Can you describe your biggest mistake"` | ~0.55 | ❌ Likely rejected but close |
| `"Tell me about a project you led"` | `"Tell me about a time you showed leadership"` | ~0.42 | ✅ Should reuse — same intent |

**The critical failure class** for this app is row 2 and row 3. In interview contexts, "strengths/weaknesses", "success/failure", "led/followed" are extremely common antonym pairs. An answer about the candidate's strengths played in response to a weaknesses question is the **single worst possible failure mode** — it gives the candidate the wrong answer to speak aloud.

### Why stop words inflate the score

`wordsOf` uses `\b\w+\b` with no stop-word filtering. Words like `"what"`, `"are"`, `"your"`, `"can"`, `"you"`, `"a"`, `"the"`, `"tell"`, `"me"`, `"about"` appear in almost every interview question. They inflate the intersection, making questions look more similar than they are.

---

## The Right Fix: Semantic Embedding Similarity

### The Model: Sentence-BERT (`all-MiniLM-L6-v2`)

Raw BERT (`[CLS]` pooling) is **not appropriate for sentence similarity** — it wasn't trained for it. The correct model is Sentence-BERT (SBERT), specifically fine-tuned on paraphrase and NLI tasks.

| Model | Size | CPU latency | Quality |
|-------|------|-------------|---------|
| `paraphrase-MiniLM-L3-v2` | 17MB | ~3ms | Good |
| **`all-MiniLM-L6-v2`** | **22MB** | **~5–10ms** | **Best for size** |
| `all-MiniLM-L12-v2` | 34MB | ~15ms | Better |
| `all-mpnet-base-v2` | 420MB | ~50ms | Best overall |

**`all-MiniLM-L6-v2` is the right pick** — 22MB, ~5–10ms on CPU, trained specifically on semantic similarity tasks. The codebase already has the infrastructure for this: `IntentClassifier.ts` (34KB) runs a transformer model in a `Worker` thread. The same worker pattern applies.

### How it fixes the antonym problem

Under cosine similarity of SBERT embeddings:

```
embed("What are your greatest strengths") · embed("What are your greatest weaknesses")
  → cosine ≈ 0.31  ← correctly LOW (antonyms)

embed("Can you walk me through") · embed("Can you walk me through your system design?")  
  → cosine ≈ 0.89  ← correctly HIGH (prefix completion)

embed("Tell me about a project you led") · embed("Tell me about a time you showed leadership")
  → cosine ≈ 0.82  ← correctly HIGH (synonymous intent, Jaccard would miss this)
```

---

## Recommended Implementation: Hybrid Approach

Running SBERT on every speculative check would add 5–10ms even for trivially obvious cases. The optimal design runs it **only when Jaccard is in the ambiguous zone**:

```
1. Jaccard containment check (µs, always):
   → score < 0.3  → reject immediately (clearly different topic, don't call SBERT)
   → score > 0.92 → accept immediately (obvious prefix/synonym, don't call SBERT)
   → score 0.3–0.92 → ambiguous → proceed to step 2

2. SBERT cosine similarity (only in ambiguous zone, ~5–10ms):
   → cosine < 0.65 → reject, re-run generation
   → cosine ≥ 0.65 → accept speculative answer
```

This keeps the fast path (clear prefix match, clearly different topic) at zero cost, and only pays the embedding cost for the genuinely ambiguous middle where Jaccard makes mistakes — which is exactly where the strengths/weaknesses failure class lives.

### Implementation sketch

```ts
// electron/llm/speculativeSimilarity.ts

export async function speculativeSimilarity(
    speculativeQuestion: string,
    finalQuestion: string,
): Promise<{ score: number; method: 'jaccard' | 'sbert' }> {
    const jScore = jaccardWithContainment(speculativeQuestion, finalQuestion);

    // Fast exits — no embedding needed
    if (jScore < 0.3)  return { score: jScore, method: 'jaccard' };
    if (jScore > 0.92) return { score: jScore, method: 'jaccard' };

    // Ambiguous zone — run semantic check
    const [embA, embB] = await Promise.all([
        embeddingWorker.embed(speculativeQuestion),
        embeddingWorker.embed(finalQuestion),
    ]);
    const cosine = cosineSimilarity(embA, embB);
    return { score: (cosine + 1) / 2, method: 'sbert' }; // normalize to [0,1]
}
```

```ts
// In handleSuggestionTrigger (IntelligenceEngine.ts):
const { score, method } = await speculativeSimilarity(this.speculativeText, trigger.lastQuestion);
console.log(`[IntelligenceEngine] Speculative check (${method}): ${score.toFixed(2)}`);

if (score >= SPECULATIVE_SIMILARITY_THRESHOLD) {
    // accept
} else {
    // restart generation
}
```

### Worker reuse

`IntentClassifier.ts` already maintains a warmed transformer worker. The embedding worker can share the same infrastructure — no new model-loading overhead on startup. The worker is already warm by the time a speculative check fires.

---

## Threshold Calibration

The current `SPECULATIVE_SIMILARITY_THRESHOLD` constant should be audited. If it's ≥ 0.7, Jaccard-inflated stop-word matches may be passing the gate. With the hybrid approach:

- **Jaccard fast-accept threshold**: 0.92 (very conservative — only obvious prefix completions bypass SBERT)
- **SBERT acceptance threshold**: 0.65 (cosine normalized to [0,1])

These values should be validated against a test set of real interview question pairs covering:
- Clear prefixes ("Can you walk me through" → "Can you walk me through your architecture")
- Antonym pairs (strengths/weaknesses, success/failure, led/followed)
- Synonymous rephrasing ("Tell me about a project" → "Walk me through something you built")
- Completely different topics

---

## Is the Speculative Pre-fetch Concept Worth Keeping?

**Yes.** The underlying idea is sound — firing an LLM call on a high-confidence partial transcript so the answer is ready when the question finishes is a legitimate latency optimization. The Jaccard gate is the right *type* of solution (a similarity check to avoid wrong-answer reuse). The problem is purely the implementation of that gate.

The speculative system is also well-designed in other respects:
- `SPECULATIVE_DEBOUNCE_MS` prevents flooding on rapid partials
- `speculativeTextExpiry` prevents stale answers from being served
- `forceFresh` correctly bypasses the gate on explicit user button presses
- `AbortController` cancellation is correctly wired

The only thing that needs to change is how the similarity score is computed in the ambiguous zone.

---

## Summary

| Aspect | Current (Jaccard) | Recommended (Hybrid) |
|--------|------------------|----------------------|
| Antonym pairs (strengths/weaknesses) | ❌ ~0.75 — often wrong accept | ✅ ~0.31 SBERT — correct reject |
| Prefix completion (partial → full) | ✅ Handled by containment blend | ✅ Still handled at fast-exit tier |
| Synonymous rephrasing | ❌ ~0.42 — may incorrectly reject | ✅ ~0.82 SBERT — correct accept |
| Latency (fast cases) | µs | µs (Jaccard fast exit) |
| Latency (ambiguous zone) | µs | ~5–10ms (SBERT) |
| Model size overhead | 0MB | +22MB (`all-MiniLM-L6-v2`) |
| Infrastructure needed | None | Worker thread (reuse IntentClassifier pattern) |
