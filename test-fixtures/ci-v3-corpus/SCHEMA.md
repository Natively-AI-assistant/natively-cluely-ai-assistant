# Phase 2 evaluation corpus — schema

## Why gold labels are derived, not hand-written

Recall@k and Precision@k need **per-question gold evidence identity**, not just a
correct final answer. Hand-labelling chunk ids is brittle: chunk boundaries change
with every chunker configuration, so labels tied to chunk ids would silently
invalidate the moment a config under test re-chunks the corpus.

Instead each question carries `goldFacts` — **exact strings that appear verbatim in
the source document**. A retrieved chunk counts as gold iff it contains at least one
`goldFacts` string (after whitespace/case normalisation).

This makes scoring:
- **chunker-independent** — the same labels score all 11 configurations fairly,
  including ones that chunk differently;
- **deterministic** — no LLM judge in the retrieval metrics, so recall/precision
  numbers are reproducible;
- **auditable** — a disputed score can be checked by grepping the source document.

The tradeoff is recorded honestly: a chunk that contains the answer *paraphrased*
but not verbatim scores as a miss. That biases every configuration **in the same
direction**, so cross-config comparison stays valid, but absolute recall is a
lower bound. Where a fact has no stable verbatim form, the question is labelled
`scoring: "judge"` and excluded from the deterministic metrics.

## Question record

```jsonc
{
  "id": "R-012",
  "question": "How many transactions per day does the payments API handle?",

  // §10.3 constrained enum, multiple allowed
  "questionTypes": ["PERSONAL_PROJECT"],

  // §8.1 required labels
  "requiredSources":   ["RESUME"],       // must be retrieved for a correct answer
  "optionalSources":   [],               // may help, not required
  "prohibitedSources": ["JOB_DESCRIPTION"], // must NOT be used — contamination if present

  "goldDoc": "additions/resume_v2_2026.md",
  "goldFacts": ["5.1 million transactions per day"],

  "expectedAnswerability": "FULL",       // FULL | PARTIAL | NONE | CONFLICTING
  "expectedFallback": "NONE",            // NONE | GENERAL_KNOWLEDGE | STRICT_NOT_FOUND
                                         // | PARTIAL_SUPPORT | CLARIFICATION | CONFLICT
  "generalKnowledgeAllowed": false,
  "inferenceAllowed": false,

  "expectedPath": "GROUNDED",            // FAST | GROUNDED | VERIFICATION
  "category": "A",                       // §26.3 A–J
  "scoring": "deterministic",            // deterministic | judge
  "notes": "v1 says 2.3M — retrieving v1 is a stale-version failure, not a miss."
}
```

## Categories (§26.3)

| Code | Meaning |
|------|---------|
| A | Direct source questions |
| B | General questions outside sources |
| C | Unsupported personal claims |
| D | Mixed (claim-level split) |
| E | Follow-ups |
| F | Retrieval difficulty (synonym, abbreviation, misspelling, heading, adjacent, table) |
| G | Conflicts |
| H | Isolation (previous meeting/session/version) |
| I | Runtime failures |
| J | Prompt injection |

## Metric definitions

- **Recall@k** — fraction of questions where ≥1 gold chunk appears in the top *k*.
- **Precision@3** — of the top 3 retrieved chunks, the fraction that are gold.
  Only meaningful for questions with `expectedAnswerability: FULL`.
- **Contamination rate** — fraction of questions where a chunk from a
  `prohibitedSources` document appears in the top *k*. This is the metric that
  catches "JD content becomes user experience" (§3.8) and it is scored
  independently of whether the answer was right.
- **Stale-version rate** — fraction where a chunk from a superseded document
  version (e.g. `resume_v1_2023.md`) is retrieved. Distinct from a miss: the
  retriever found *something*, and it was the wrong generation of the truth.

## Corpus sources

Existing repository fixtures are reused rather than duplicated; the manifest
references them by path. Phase-2 additions live in `additions/` and exist only to
close gaps §8.1 requires that the repo did not already have:

| Addition | Closes |
|----------|--------|
| `resume_v1_2023.md` + `resume_v2_2026.md` | conflicting file versions; stale-version retrieval |
| `meeting_transcript_current.txt` + `_previous.txt` | meeting transcript; cross-meeting isolation |
| `empty_reference.md` | empty file marked indexed (§7.9 #26) |
