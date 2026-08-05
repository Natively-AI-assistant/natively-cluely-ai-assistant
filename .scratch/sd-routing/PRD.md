# PRD — SD answerType routing (~99%, no leftover)

**Status:** `ready-for-agent`  
**Grill:** `_workspace/grill-with-docs/01_question_log.md` (10/10 verified)  
**Glossary:** [docs/speakable-sd/CONTEXT.md](../../docs/speakable-sd/CONTEXT.md) (Routing section)  
**ADR:** [docs/adr/0004-sd-routing-hybrid-sticky.md](../../docs/adr/0004-sd-routing-hybrid-sticky.md)  
**Map:** CONTEXT-MAP.md → Speakable system design  

---

## Problem Statement

Candidates type or speak system-design prompts (e.g. “Designing a Scalable Ticketing Platform”, “design a service similar to ticketmaster”) and Natively often fails to set `answerType` to `system_design_answer`. Wrong types skip speakable Delivery Framework, strip, and DF STRICT template — so users get blog dumps or meeting answers. Regex alone misses titles/gerunds and fuzzy scale asks; an ungated LLM leftover would ship untested.

## Solution

Expand the deterministic SD routing front door (title-form, like-X, scale-ask; keep false-friend guards). When sticky SD session is armed, promote non-coding/non-DSA turns to `system_design_answer`. Gate **every** routing scenario with llm-eval goldens (**no leftover**): regex may short-circuit clear hits, but evals still assert them; fuzzy cases run live/capability as needed. No soft-clarify answerType in v1.

## Seams (acceptance)

**Primary seam:** `planAnswer` / routing predicates — utterance (+ optional sticky-armed flag) → `answerType`  
- Unit/matrix tests: title-form, like-X, scale-ask, false friends (experience/coding/concept/product-about)  
- No Electron required for matrix  

**Secondary seams:**  
1. Sticky SD session → answerType promotion for non-coding turns (WTA/manual path that sees authority)  
2. `evals/sd-routing` (or extend speakable-sd) — contract + live cases for **all** `sd-route-*` decisions; regression gate; no ungated residual  

Ideal: one routing decision function; sticky is an input flag; evals call the same seam.

## User Stories

1. As a candidate, I want “Designing a Scalable Ticketing Platform” to route to SD, so that DF speech starts.
2. As a candidate, I want “design a service similar to ticketmaster” to stay SD, so that like-X openers work.
3. As a candidate, I want “how would you scale our checkout?” to route to SD, so that scale asks aren’t concept tutorials.
4. As a candidate, I want “years on distributed systems” to stay experience, so that I don’t get DF scaffolding.
5. As a candidate, I want “implement a rate limiter” to stay coding, so that DSA contract remains.
6. As a candidate, I want “explain rate limiting” to stay concept, so that design verbs still distinguish.
7. As a candidate, I want “architecture of Natively” to stay product-about, so that metadata grounding wins.
8. As a candidate mid-SD interview, I want clarifiers to stay speakable SD-typed when session is armed, so that strip + DF template still apply.
9. As a candidate, I want an explicit coding pivot mid-SD to leave SD typing, so that I can still code.
10. As a workflow owner, I want a TDD routing matrix for clear positives/false friends, so that regressions are cheap.
11. As a workflow owner, I want llm-eval covering every routing scenario with no leftover, so that fuzzy paths cannot ship ungated.
12. As a workflow owner, I want regex short-circuit for clear hits without skipping evals, so that both layers stay honest.
13. As an implementer, I want sticky promotion behind an explicit armed-session input, so that planAnswer stays testable.
14. As an implementer, I want no new soft-clarify answerType in v1, so that scope stays closed.
15. As a QA agent, I want Ticketmaster title + like-X + scale-ask + four false friends in the matrix, so that dogfood misses close.
16. As a QA agent, I want eval SHIP/NO-SHIP on the routing suite, so that CI/pre-merge can gate.
17. As a prep user, I want speakable DF to fire whenever routing says SD, so that prior speakable-sd work is usable.
18. As a workflow owner, I want classic-noun expansion only case-by-case via TDD, so that we don’t invent open-ended product clones.
19. As a candidate, I want ASR-ish paraphrases covered in llm-eval capability/regression, so that messy speech improves toward ~99%.
20. As a workflow owner, I want candidate_rewind left out of this ship, so that routing isn’t blocked on SPECs 14–16.

## Implementation Decisions

- Glossary: all `sd-route-*` terms in speakable-sd CONTEXT; ADR 0004 for hybrid+sticky.
- **SD route hybrid (no leftover):** deterministic front door + full llm-eval coverage; not LLM-only; not ungated leftovers.
- **SD route sticky:** armed sticky SD session → non-coding turns as `system_design_answer`.
- **SD route no-soft-clarify-type:** unchanged fallthrough when no signal.
- Prefer extending `planAnswer` / `SYSTEM_DESIGN_PATTERNS` over a parallel classifier module unless a clean pure function seam appears.
- Soft-hint: classifier confidence can feed “use LLM path” but every path has cases.
- Do not change speakable strip/DF template contracts except as needed for sticky-typed turns.

## Testing Decisions

- Good tests: external behavior — question (+ sticky flag) → `answerType`; eval asserts on planned type and/or live classify output.
- Primary: unit matrix on planAnswer (TDD).
- Secondary: llm-eval `evals/sd-routing` — regression for deterministic expectations; capability for fuzzy live; gate_on regression; no case left “later.”
- Prior art: `AnswerPlannerValidator.test.mjs`, `evals/speakable-sd/`.

## Out of Scope

- Soft-clarify answerType
- Rewriting all of AnswerPlanner unrelated branches
- candidate_rewind / SPECs 14–16
- Replacing speakable output contract (already shipped)
- Open-ended product-clone classic noun list without cases

## Further Notes

- Dogfood: natively.db “Design a service similar to ticketmaster”; title miss “Designing a Scalable Ticketing Platform”
- Next: `/to-tickets` → `/implement` (TDD then llm-eval)
