# Question Log — SD answerType routing boundary

**Topic:** When utterances should classify as `system_design_answer` (vs coding/DSA/experience/concept/product-about) so speakable DF + evals can hit ~99% correct routing.  
**Mode:** C (automode)  
**Budget:** 12  
**Research:** `00_context.md`, `00_code_patterns.md`, `00_memory.md`

## Branch Tree

- [x] Positive SD routing signals
- [x] Title / gerund / session-title forms
- [x] False friend: experience probes
- [x] False friend: coding / write-implement
- [x] False friend: explain / what-is concept
- [x] False friend: Natively product-about
- [x] Ambiguous “how would you scale/architect …”
- [x] Sticky SD once session armed
- [x] Mechanism: regex vs hybrid LLM for ~99%
- [x] Uncertain / no soft clarify type

## Summary

| Metric | Count |
|--------|-------|
| Branches | 10 |
| Verified | 10 |
| Unresolved | 0 |

## Questions

### Q1 — Positive SD routing signals
**Q:** What utterances MUST route to `system_design_answer`?  
**A (Mode C):** `sd-route-positive` — (1) existing SYSTEM_DESIGN_PATTERNS shapes; (2) design|build + service|system|platform + like|similar to + product name. Classic-noun expansion is TDD case-by-case only.  
**Verdict:** VERIFIED (after sharpen from VAGUE)

### Q2 — Title / gerund forms
**Q:** Is “Designing a Scalable Ticketing Platform” SD?  
**A (Mode C):** `sd-route-title-form` — SHALL be SD; current `design (a|an|the)` misses; extend patterns (intentional router change).  
**Verdict:** VERIFIED (after reframe as target, not current-behavior claim)

### Q3 — Experience false friend
**A:** `sd-route-not-experience` — years/tell-me-about scalable|distributed without design imperative → not SD.  
**Verdict:** VERIFIED

### Q4 — Coding false friend
**A:** `sd-route-not-coding` — write/implement/code → coding/DSA not SD.  
**Verdict:** VERIFIED

### Q5 — Concept false friend
**A:** `sd-route-not-concept` — explain/what-is without design|architect → technical_concept.  
**Verdict:** VERIFIED

### Q6 — Product-about
**A:** `sd-route-not-product-about` — Natively architecture stays project_about before SD.  
**Verdict:** VERIFIED

### Q7 — Scale / architect how-would-you
**A:** `sd-route-scale-ask` — how-would-you+(scale|architect|design)+system/service/product → SD; how-would-you-use tool → concept.  
**Verdict:** VERIFIED

### Q8 — Sticky session answerType
**A:** `sd-route-sticky` — today sticky key ≠ sticky answerType; **target:** armed SD session → non-coding turns as `system_design_answer` for speakable mid-interview.  
**Verdict:** VERIFIED (after correcting false current-behavior claim)

### Q9 — Mechanism ~99%
**A:** `sd-route-hybrid` — deterministic front door + TDD matrix; LLM classify only low-confidence leftovers + llm-eval gate; not LLM-only.  
**Verdict:** VERIFIED

### Q10 — Soft clarify type
**A:** `sd-route-no-soft-clarify-type` — no new clarify answerType in v1.  
**Verdict:** VERIFIED

## Verified glossary terms (this session)

1. `sd-route-positive`
2. `sd-route-title-form`
3. `sd-route-not-experience`
4. `sd-route-not-coding`
5. `sd-route-not-concept`
6. `sd-route-not-product-about`
7. `sd-route-scale-ask`
8. `sd-route-sticky`
9. `sd-route-hybrid`
10. `sd-route-no-soft-clarify-type`

## Next (ask-matt)

- Say **export** → write routing terms into `docs/speakable-sd/CONTEXT.md` (+ ADR if sticky/hybrid trade-offs warrant).
- Then **`/to-spec`** or **`/implement`**: TDD routing matrix (title-form, like-X, scale-ask) + optional llm-eval low-confidence path per `sd-route-hybrid`.
