# Question Log — Robust SD-routing llm-eval for interviewer intention

**Topic:** Expand `/llm-eval` (`evals/sd-routing`) so interviewer SD intention routes correctly via parallel LLM + deterministic front door (≥99.99% on versioned corpus).  
**Mode:** C (auto — switched from A after user “ack, auto mode rest”)  
**Budget:** 20  
**Prior session:** archived as `archive/01_question_log-sd-route-boundary-20260805.md` (10/10 routing glossary verified)  
**Research:** `00_context.md`, `00_code_patterns.md`, `00_memory.md`

## Branch Tree

- [x] What “100%” / 99.99% means + LLM mechanism (parallel promote)
- [x] Intention taxonomy / scenario classes to cover (`sd-eval-corpus-v1`)
- [x] Failure harvest sources (`sd-eval-harvest`)
- [x] Positive openers — corpus Tier A.2
- [x] Sticky × false-friend matrix (`sd-route-sticky-exclusions`)
- [x] Hybrid leftover LLM path — superseded by `sd-route-llm-parallel`
- [x] Capability graduation — locked in Q1 / corpus Tier B
- [x] Precision vs recall when uncertain (`sd-route-uncertain-precision`)
- [x] Source / channel matrix (`sd-eval-source-matrix`)
- [x] How routing improves (`sd-route-implement-path`)
- [x] Classifier contract (`sd-route-classifier-contract`)

## Summary

| Metric | Count |
|--------|-------|
| Branches | 11 |
| Verified | 11 |
| Unresolved | 0 |

## Questions

### Q1 — 100% / LLM-from-start / 99.99%
**A:** `sd-route-llm-parallel` — regex front door + always-on parallel LLM; promote-only; hard vetoes; ≥99.99% on versioned corpus; reopen leftover-only / capability-only fuzzy / ~99%. User rec **B**.  
**Verdict:** VERIFIED

### Q2 — Versioned corpus taxonomy
**A:** `sd-eval-corpus-v1` + `sd-route-sticky-exclusions` (nego/identity/meeting-admin hard-exclude). User: yes.  
**Verdict:** VERIFIED

### Q3 — Classifier contract (Mode C)
**A:** `sd-route-classifier-contract` — binary `sd_intention` yes|no; promote iff yes ∧ conf ≥ 0.75; ≤400ms p95; timeout → no promote; prefer IntentClassifier extension; eval goldens for promote/below-threshold/veto/timeout/no-demote.  
**Verdict:** VERIFIED

### Q4 — Failure harvest (Mode C)
**A:** `sd-eval-harvest` — dogfood/sims Tier A → prior F-ROUTE bugs → unit gaps → sticky wrong-promote → ASR Tier B; ≤20 new cases first slice.  
**Verdict:** VERIFIED

### Q5 — Uncertain precision (Mode C)
**A:** `sd-route-uncertain-precision` — no soft-clarify; low conf/timeout → no promote (precision > recall).  
**Verdict:** VERIFIED

### Q6 — Source matrix (Mode C)
**A:** `sd-eval-source-matrix` — ≥1 WTA + ≥1 manual on Tier A.2 opener; fuzzy as WTA; transcript optional capability.  
**Verdict:** VERIFIED

### Q7 — Implement path (Mode C)
**A:** `sd-route-implement-path` — TDD sticky exclusions → Tier A goldens → classifier+merge → fuzzy trials → CI; `/tdd` + `/llm-eval` then `/to-spec` or `/implement`.  
**Verdict:** VERIFIED

## Verified glossary terms (this session)

1. `sd-route-llm-parallel`
2. `sd-eval-corpus-v1`
3. `sd-route-sticky-exclusions`
4. `sd-route-classifier-contract`
5. `sd-eval-harvest`
6. `sd-route-uncertain-precision`
7. `sd-eval-source-matrix`
8. `sd-route-implement-path`
