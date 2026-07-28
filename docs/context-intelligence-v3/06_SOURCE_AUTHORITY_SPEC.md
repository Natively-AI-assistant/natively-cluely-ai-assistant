# Phase 3 — Source Authority Spec

**Status:** COMPLETE (contract). **Date:** 2026-07-29

---

## 1. Principle

A source is authoritative **for a claim type**, not in general. Authority is a property of the (claim, source) pair.

```ts
type SourceType =
  | 'RESUME' | 'JOB_DESCRIPTION' | 'PROFILE_FACT'
  | 'REFERENCE_FILE' | 'PROJECT_FILE' | 'CODING_SAMPLE'
  | 'CANDIDATE_FILE'                       // recruiting: NOT the user's resume
  | 'MEETING_TRANSCRIPT' | 'CONVERSATION_STATE' | 'SCREEN_CONTEXT';
```

**General model knowledge is not in this enum.** It is a capability, not a retrieved private source. Conflating the two is what lets "the model knows about Kubernetes" become "the candidate has used Kubernetes".

---

## 2. Authority table

| Claim type | Authoritative | Explicitly PROHIBITED |
|------------|---------------|----------------------|
| User employment history | RESUME, verified PROFILE_FACT | JOB_DESCRIPTION |
| User projects | RESUME, PROJECT_FILE, PROFILE_FACT | JOB_DESCRIPTION |
| User skills | RESUME, PROFILE_FACT | **JOB_DESCRIPTION** |
| User education | RESUME, PROFILE_FACT | JOB_DESCRIPTION |
| Job responsibilities | JOB_DESCRIPTION | RESUME |
| Required / preferred job skills | JOB_DESCRIPTION | RESUME |
| Document values & findings | the specific REFERENCE_FILE | any other document |
| Seminar / thesis content | seminar doc, slides, approved refs | general knowledge |
| Meeting statements & decisions | **current** MEETING_TRANSCRIPT | any prior meeting |
| Visible code or error | SCREEN_CONTEXT | — |
| General technical / industry concepts | model knowledge (capability) | — |
| User motivation | explicit user context only | inferred = must be labelled |
| Recommendations | model reasoning, clearly distinguished | — |

### 2.1 The rule the benchmark was built to catch

**A JD cannot prove the user has a skill.** Question C-02 ("Does the candidate have Postgres experience?") exists because `Postgres required` appears in the JD and **nowhere** in the resume. Retrieving that JD chunk is a contamination failure **even when the final answer is correctly hedged** — the benchmark scores the retrieval decision, not the prose, because prose hedging is exactly what erodes under prompt drift.

Measured contamination rates across configurations: 7.1%–16.7%. Not zero on any arm.

---

## 3. Scope and version — the load-bearing part

This section exists because it is the **largest measured risk** in the whole phase, not because the brief asked for it.

Measured stale-version retrieval rate:

| Arm | Rate |
|-----|------|
| semantic only | **54.8%** |
| hybrid (production) | 47.6% |
| real BM25 | 23.8% |
| lexical overlap | 16.7% |

`resume_v1_2023.md` and `resume_v2_2026.md` are near-identical prose disagreeing on five facts (graduation 2019 vs 2017; team of 4 vs 11; 2.3M vs 5.1M txn/day). **Their embeddings are correctly almost identical.** Semantic similarity therefore *cannot* distinguish document generations, and no amount of reranking or weight tuning changes that.

### 3.1 Contract

```ts
interface AuthorizedSource {
  sourceType: SourceType;
  sourceId: string;
  versionId: string;          // active version ONLY
  scopeId: string;            // user | profile | meeting | session | workspace
  authorityFor: ClaimType[];
  priority: number;
  metadataFilters: Record<string, string | number | boolean>;
}
```

**Enforcement is a pre-scoring filter, not a ranking signal:**

```
authorized sources
   → WHERE scopeId ∈ allowed AND versionId = active     ← SQL, before any scoring
   → score / fuse / rerank
```

`EvidenceItem` gains **`scopeId`** (F19: it has none today, so isolation cannot be asserted on evidence at all — only inferred from which retriever happened to run).

### 3.2 Superseded versions are not merely deprioritised

They are **not retrievable**. A superseded version must be excluded by the filter, not ranked lower — because at 54.8% the ranking approach demonstrably does not work.

---

## 4. Cross-meeting isolation

Same mechanism, different scope key. Corpus questions H-01…H-04 are built on two transcripts that **reverse** each other's decisions:

| | Previous (June) | Current (September) |
|---|---|---|
| Events DB | ScyllaDB | **Cassandra** |
| Ledger migration | moving to Cassandra | **explicitly NOT** |
| Headcount | 3 approved | **not opening, deferred** |
| Owner | Arjun | **Meera** |

Written with deliberately high lexical and semantic overlap. A similarity-ranked retriever cannot separate them; a `scopeId = currentMeetingId` filter separates them trivially.

`meetingRagEvidence.ts` already implements cross-meeting `wrong_entity` rejection — and has **zero production callers**. Wiring it is a keep, not a build.

---

## 5. Conflict resolution

When authorized, in-scope, current-version sources still disagree:

1. Identify the conflicting values explicitly.
2. Apply configured source authority (§2).
3. Prefer **direct facts over generated summaries** — a summary never outranks its source.
4. Never silently merge incompatible values.
5. If unresolvable, surface it:
   > "The two versions list different values. The newer document states X, the older Y."

Corpus questions G-01…G-03 assert exactly this shape.

---

## 6. Provenance

Today `isDirectFact`, `isInferred`, `evidenceText`, and `sourceVersion` return **zero hits** across `electron/`, `premium/`, and `src/`. The full provenance model exists only in Tier-2 OKF, which is **off in production**.

**Contract — every fact carries:**

```ts
interface ProfileFact {
  factId: string; category: string; key: string; value: unknown;
  sourceId: string; versionId: string; sourceLocation?: string;
  evidenceText: string;                 // verbatim span, not a paraphrase
  confidence: number;
  isDirectFact: boolean; isInferred: boolean;
  createdAt: number; updatedAt: number;
}
```

Rules: direct outranks inferred · inferred must be labelled · generated summaries are never authoritative · **a fact cannot remain active after its source version is replaced** (F12: today re-upload leaves the salary estimate, negotiation state, and company dossiers stale).
