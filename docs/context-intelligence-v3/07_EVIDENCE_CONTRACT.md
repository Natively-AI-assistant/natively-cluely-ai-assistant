# Phase 3 — Evidence Contract

**Status:** COMPLETE (contract). **Date:** 2026-07-29

---

## 1. Retrieval candidates are not evidence

The measured basis for insisting on this: every configuration returned a ranked pool for **every** question, including "What is idempotency?" The retriever has no concept of *should I run* or *is this good enough* — it always produces output. Something above it must decide.

```
RetrievalCandidate  →  [evidence evaluation]  →  EvidenceItem | RejectedEvidence
```

---

## 2. Types

```ts
interface RetrievalCandidate {
  evidenceId: string;
  sourceType: SourceType; sourceId: string; versionId: string; scopeId: string;
  documentTitle?: string; section?: string; headingPath?: string[];
  page?: number; chunkIndex?: number;
  content: string;

  semanticScore?: number; keywordScore?: number; headingScore?: number;
  entityScore?: number; continuityScore?: number; rerankerScore?: number;
  answerabilityScore?: number;          // see §2.1
  finalScore: number;

  authorityFor: ClaimType[];
  isDirectFact: boolean; isInferred: boolean;
  metadata: Record<string, unknown>;
}
```

### 2.1 Widening the type is a required fix, not a nicety

`ChunkCandidate` already computes `answerabilityScore`, `answerabilityBoosts`, `answerabilityPenalties` and `rerankScore` — and the public `ModeRetrievedChunk` **drops all four**. Structural and property-aware matching is calculated and then discarded before any consumer, including `EvidenceResolver`, can see it. It survives only in a diagnostics `console.log`.

This is **purely additive**: the values exist at the return site. Carrying them through is the single cheapest quality win available in Phase 4.

```ts
type Answerability = 'FULL' | 'PARTIAL' | 'NONE' | 'CONFLICTING';

interface EvidenceEvaluation {
  answerability: Answerability;
  supportedClaims: PlannedClaim[];
  unsupportedClaims: PlannedClaim[];
  conflictingClaims: ConflictingClaim[];
  acceptedEvidence: EvidenceItem[];
  rejectedEvidence: RejectedEvidence[];
  needsRetry: boolean; retryReason?: string;
}
```

---

## 3. Rejection reasons are first-class

A rejection must say **why**, because "not found" is currently indistinguishable from "found and discarded":

```ts
type EvidenceRejectionReason =
  | 'OUT_OF_SCOPE'            // scopeId mismatch
  | 'SUPERSEDED_VERSION'      // ← the 54.8% case
  | 'UNAUTHORIZED_SOURCE'     // mode does not allow this type
  | 'NOT_AUTHORITATIVE'       // e.g. JD offered for a user-skill claim
  | 'BELOW_THRESHOLD'
  | 'KEYWORD_OVERLAP_ONLY'    // shares terms, does not support the claim
  | 'DUPLICATE'
  | 'CONTRADICTED';
```

`SUPERSEDED_VERSION` and `OUT_OF_SCOPE` should be **structurally unreachable** if the pre-scoring filter (§06.3) works — they exist as an assertion surface. Their appearance in a trace is a filter bug, not a ranking outcome.

---

## 4. Evaluation must not collapse to similarity

Explicitly forbidden, and measured:

> high similarity **≠** complete answer  ·  low similarity **≠** information absent

The stale-version result is the proof: the superseded resume scores *highest* on similarity for questions it answers *wrongly*. Similarity was maximal; correctness was zero.

Evaluation checks, in order — the first four are **filters that cannot be outvoted by score**:

1. scope authorisation · 2. active version · 3. source authorised by mode · 4. source authoritative *for this claim*
5. relevance to the resolved question · 6. entity / heading overlap
7. directness · 8. completeness · 9. contradiction
10. **does this actually support the claim, or merely share keywords?**

---

## 5. Retry

Maximum **two** attempts, total. A second attempt runs only when the question clearly depends on a source *and* initial answerability is `NONE`/weak.

Permitted second-attempt strategies: resolve pronouns · expand abbreviations · correct likely entity spelling · exact-entity search · heading search · previous-source continuity · widen candidate breadth · parent/adjacent expansion.

Corpus questions F-04 (`EN-DE` vs "English-to-German") and F-06 (`postmorten` vs `post-mortem`) exist to exercise this. Unlimited retry is prohibited — latency is a correctness property in a live meeting.

---

## 6. Failure is evidence too

Today `NO_RELEVANT_CONTEXT_FOUND` and a retrieval **timeout** both silently become `{fallback:true}` and the answer proceeds ungrounded — indistinguishable, to both the user and telemetry, from a grounded answer.

**Contract:** dependency failure is recorded and distinguished.

| Situation | Behaviour |
|-----------|-----------|
| Retrieval unavailable, general fallback allowed | Answer from model knowledge, mark `retrievalFailed`, **never** synthesise evidence |
| Retrieval unavailable, STRICT_SOURCE_ONLY | Return grounded-unavailable — **never** silently substitute model knowledge |
| Embeddings unavailable at ingest | `PARTIALLY_INDEXED`, keyword search still available, **do not report success** |
| Reranker unavailable / timed out | Fall back to fused scores, record it, do not fail the answer |
| Malformed source | Isolate that source, continue with the others |

The last row is currently violated in the hardest way: a 128k-char PDF **aborts the process with SIGTRAP** (F22) rather than being isolated.

---

## 7. Packing

Priority: direct evidence for required claims → authoritative supporting evidence → parent/adjacent context → minimal conversation state → minimal transcript → screen (when relevant).

Never: dump whole documents · inject full resume + JD every turn · include rejected candidates · include duplicates · include stale versions · include out-of-scope content · fill the budget with low-score filler.

Retrieved content is tagged as **untrusted data**, never as instructions:

```xml
<evidence evidence_id="ev-123" source_type="RESUME" source_id="resume-456"
          version_id="v3" scope_id="user-1" section="Experience"
          authority="PERSONAL_EXPERIENCE" direct_fact="true">
Developed…
</evidence>
```

`ModeRetrievedChunk.trustLevel` is already the literal `'untrusted_reference'` — that part of the current design is correct and is retained.
