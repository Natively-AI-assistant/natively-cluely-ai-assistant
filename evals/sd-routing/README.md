# evals/sd-routing — LLM-EDD for SD answerType routing (LLM parallel)

**Surface under test:** `planAnswer` SD routing (+ sticky `sdSessionOpen` + `sdIntention` / `classifySdIntention`)  
**Mutable:** `AnswerPlanner.ts`, `sdIntention.ts`, sticky exclusions, promote threshold  
**Immutable during a run:** `cases.jsonl`, `threshold.yaml`, runner graders  

**ADR 0005:** deterministic front door + parallel SD-intention promote (never demote regex hits). Sticky exclusions for nego/identity/meeting-admin. No soft-clarify. ≥99.99% framing = regression gate 1.0 on this versioned corpus.

## Glossary coverage

| Tag | Meaning |
|-----|---------|
| `sd-route-positive` | Classic / like-X design asks → SD |
| `sd-route-title-form` | Gerund/title forms → SD |
| `sd-route-not-*` | False friends (experience/coding/concept/product-about) |
| `sd-route-scale-ask` | How-would-you scale/architect → SD |
| `sd-route-sticky` | Armed session promotes clarifiers; coding pivot leaves |
| `sd-route-sticky-exclusions` | Nego/identity/meeting-admin never sticky-promote |
| `sd-route-llm-parallel` | Intention promote path for Tier A.2 openers |
| `sd-route-classifier-contract` | Inject promote / below-threshold / no-demote |
| `sd-eval-corpus-v1` | Tier A corpus openers |
| `sd-eval-source-matrix` | WTA + manual on same opener |
| `sd-route-uncertain-precision` | Below threshold → no promote |
| `sd-route-hybrid` | Meta: glossary tags present (historical alias) |
| `sd-route-no-soft-clarify-type` | Vague stays non-SD |

## Run

```bash
npm run eval:sd-routing
```

Exit **0** = SHIP (regression gate). Exit **1** = NO-SHIP.
