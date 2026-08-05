# evals/sd-routing — LLM-EDD for SD answerType routing (no leftover)

**Surface under test:** `planAnswer` SD routing (+ sticky `sdSessionOpen`)  
**Mutable:** `electron/llm/AnswerPlanner.ts` (`SYSTEM_DESIGN_PATTERNS`, sticky promote)  
**Immutable during a run:** `cases.jsonl`, `threshold.yaml`, runner graders  

**No leftover:** every grilled `sd-route-*` term has ≥1 case. Regex may short-circuit clear hits; evals still assert them. Fuzzy/ASR paraphrases live under `capability` until graduated.

## Glossary coverage

| Tag | Meaning |
|-----|---------|
| `sd-route-positive` | Classic / like-X design asks → SD |
| `sd-route-title-form` | Gerund/title forms → SD |
| `sd-route-not-experience` | Years/tell-me experience → not SD |
| `sd-route-not-coding` | Write/implement/DSA → not SD |
| `sd-route-not-concept` | Explain/what-is / how-would-you-use → not SD |
| `sd-route-not-product-about` | Natively architecture → project_about |
| `sd-route-scale-ask` | How-would-you scale/architect → SD |
| `sd-route-sticky` | Armed session promotes clarifiers; coding pivot leaves |
| `sd-route-hybrid` | Meta: all glossary tags present in suite |
| `sd-route-no-soft-clarify-type` | No soft-clarify type; vague stays non-SD |

## Run

```bash
npm run eval:sd-routing
```

Exit **0** = SHIP (regression gate). Exit **1** = NO-SHIP.
