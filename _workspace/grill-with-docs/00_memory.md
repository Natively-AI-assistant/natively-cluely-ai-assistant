# Memory — SD routing / llm-eval for interviewer SD intention detection

**Topic (current):** Robust llm-eval for system design routing / interviewer SD intention detection  
**Subproject:** natively-cluely-ai-assistant  
**Sources read:** `01_question_log.md`, prior `00_memory.md`, `00_context.md`, `evals/sd-routing/README.md`, archived `speakable-sd-20260805-012109/01_question_log.md`, `.scratch/sd-routing/PRD.md`

---

## Prior Glossary Terms

### SD routing (`sd-route-*`) — verified this grill (10/10)

| Term | Lock |
|------|------|
| `sd-route-positive` | Classic SYSTEM_DESIGN_PATTERNS shapes; design\|build + service\|system\|platform + like\|similar to + product name → SD. Classic-noun expansion TDD case-by-case only. |
| `sd-route-title-form` | Gerund/title forms (e.g. “Designing a Scalable Ticketing Platform”) **SHALL** → SD; extend patterns (intentional router change). |
| `sd-route-not-experience` | Years / tell-me-about scalable\|distributed without design imperative → not SD. |
| `sd-route-not-coding` | write / implement / code / DSA asks → coding not SD. |
| `sd-route-not-concept` | explain / what-is without design\|architect → technical_concept; how-would-you-**use** tool → concept. |
| `sd-route-not-product-about` | Natively architecture → `project_about` before SD. |
| `sd-route-scale-ask` | how-would-you + (scale\|architect\|design) + system/service/product → SD. |
| `sd-route-sticky` | **Target:** armed SD session → non-coding turns as `system_design_answer`; coding pivot leaves SD. (Today: sticky key ≠ sticky answerType.) |
| `sd-route-hybrid` | Deterministic front door + TDD matrix; LLM classify only low-confidence leftovers + llm-eval gate; **not** LLM-only; meta tag = all `sd-route-*` present in suite. |
| `sd-route-no-soft-clarify-type` | No new clarify answerType in v1; vague / uncertain stays non-SD fallthrough. |

### Speakable SD output (`speakable-sd-*`) — prior grill, still binding on output

| Term | Lock |
|------|------|
| `speakable-sd-surface` | Speakable contract on T2 SUT **and** product TI WTA when `answerType === system_design_answer`. Candidate-led sim-only (SPEC 09). |
| `speakable-sd-diagram` | Keep SPEC 10 ```text/```ascii HLD; ban impl-language fences + DSA ## Code/Dry Run/Complexity. |
| `speakable-sd-length` | Full sentences + one DF slice/turn; no telegram; no DSA/impl dumps; no `compressToSpeakable` on SD; FULL_RAW = no-caveman not essay-dump. |
| `speakable-sd-enforcement` | Defense in depth: untangle SHARED_CODING_RULES + tone bans; no DSA repair on non-coding; post-strip DSA headings/impl fences, keep ASCII HLD. |
| `speakable-sd-interviewer` | Interviewer no impl dumps; prose + mermaid OK. |
| `speakable-sd-root-cause` | One family: no DSA contract on SD **and** repair only if `isCodingAnswerType`. “Misroute” here = DSA repair lump, **not** classifier coverage. |
| `speakable-sd-rehearse-shape` | Full-sentence DF prose for read-aloud rehearse — not cue-card bullets, not DSA Code sections. |
| `speakable-sd-vs-rewind` | candidate_rewind / SPECs 14–16 out of scope for format retune; speakable ship must not wait on rewind-green. |

### Eval / suite vocabulary (`evals/sd-routing`)

| Term | Lock |
|------|------|
| **regression suite** | Deterministic expectations; `npm run eval:sd-routing` exit 0 = SHIP, exit 1 = NO-SHIP. Regex may short-circuit clear hits; evals still assert them. |
| **capability suite** | Fuzzy / ASR-ish paraphrases tracked until graduated (e.g. `designing uh scalable ticketing platform kinda`, messy scale-ask). Not the regression gate in v1. |
| **no leftover** | Every grilled `sd-route-*` term has ≥1 case; no ungated residual path. |
| **Surface under test** | `planAnswer` SD routing (+ sticky `sdSessionOpen`); mutable seam = `AnswerPlanner.ts` (`SYSTEM_DESIGN_PATTERNS`, sticky promote). |

### Adjacent (output / sim, not routing)

- **Delivery Framework** — Requirements → Core Entities → API → optional Data Flow → HLD → Deep Dives.
- **FULL_RAW** / **CASUAL_SD_TONE_INSTRUCTION** — T2 tone contracts; separate from routing.
- **CANDIDATE_ASCII_HLD** — candidate fenced HLD; interviewer may mermaid.
- **SdSessionAuthority** / **sd-session-open** — gate/strip armed from open SD artifact even on clarifier `general_meeting_answer`.

---

## Prior Decisions

### Routing grill (locked 2026-08-05, `01_question_log.md`)

1. **~99% target, not 100%:** Topic explicitly aims for “~99% correct routing” on messy ASR/vague speech — not perfect interviewer-intention recognition.
2. **Hybrid mechanism (`sd-route-hybrid`):** Deterministic regex/pattern front door first; LLM classify only for low-confidence leftovers; every path gated by llm-eval. Not regex-only, not LLM-only.
3. **Sticky promotion is a target behavior:** Mid-SD clarifiers (consistency vs availability) should type as SD when session armed; coding pivot (two sum) must still leave SD.
4. **No soft-clarify answerType in v1:** “hmm interesting” / vague → not SD; no new clarify type to defer classification.
5. **False friends are explicit negatives:** experience, coding, concept, product-about each have guarded routes — do not collapse into SD for speakable DF convenience.
6. **Title-form and scale-ask are intentional router extensions:** Current `design (a|an|the)` misses gerunds; scale-ask distinguishes “scale checkout” (SD) from “use GraphQL” (concept).
7. **Classic-noun expansion is TDD-only:** e.g. Bit.ly, Twitter added case-by-case; no open-ended Title Case product clone list.
8. **Export path:** Terms → `docs/speakable-sd/CONTEXT.md` Routing section + ADR 0004 (hybrid+sticky); then TDD matrix + optional llm-eval low-confidence path.

### Speakable SD output (ADR 0003 + prior grill)

9. **ADR 0003:** Defense in depth for speakable **output** assumes correct `system_design_answer` typing; does **not** define classification rules.
10. **Output enforcement is separate from routing:** Strip/repair/TI untangle fixes DSA bleed **after** typing; routing grill closes the **when** gap.

### Eval harness (`.scratch/sd-routing/PRD.md`, `evals/sd-routing/`)

11. **Regression gate blocks ship; capability tracks improvement:** Fuzzy ASR cases live in `capability` until stable enough to graduate — messy speech improves **toward** ~99%, not guaranteed day-one.
12. **No ungated leftover:** Every `sd-route-*` decision must have ≥1 eval case including sticky + false friends + hybrid meta case.
13. **Regex short-circuit allowed but evals stay honest:** Clear regex hits OK in prod; eval suite still asserts expected `answerType`.
14. **candidate_rewind explicitly out of scope** for routing ship.

---

## Conflicts with Current Session

Focus: **100% interviewer intention recognition** vs **locked hybrid ~99% + capability track for fuzzy ASR + no soft clarify type**.

| Tension | Detail | Resolution guard |
|---------|--------|------------------|
| **100% vs ~99% claim** | Prior grill + PRD title lock **~99%** correct routing on messy speech. Claiming “100% interviewer intention recognition” overstates the contract and conflicts with Q9/Q topic framing. | State ~99% for regression/clear cases; ASR fuzz as capability track improving toward ~99%. Never promise perfect intention detection. |
| **Capability vs regression gate** | Fuzzy/ASR paraphrases (`designing uh scalable…`, messy scale-ask) are in **`capability` suite**, not regression SHIP gate. Treating them as day-one 100% blockers misreads eval design. | Regression = deterministic glossary coverage; capability = tracked graduation path. |
| **No soft clarify type** | `sd-route-no-soft-clarify-type` forbids a clarify answerType to soak uncertainty. A “100% recognition” story that adds clarify-on-uncertain or SD-by-default for vague utterances **reopens closed v1 scope**. | Vague stays non-SD fallthrough; improve patterns/LLM low-confidence path + eval cases instead of new type. |
| **Hybrid vs LLM-only / regex-only** | Locked: deterministic front door + LLM for low-confidence + llm-eval gate. Pure LLM classifier or “regex is enough for 100%” both conflict. | Keep both layers; eval every path; no ungated leftover. |
| **`speakable-sd-root-cause` “misroute” overload** | Prior term treats misroute as **DSA repair lump on wrong typing**, not “classifier missed SD.” Current routing work must use `sd-route-*` for classification; don’t conflate output repair with routing coverage. | Separate routing evals (`evals/sd-routing`) from speakable output evals (`evals/speakable-sd`). |
| **Sticky: target vs today** | Q8 corrected a false current-behavior claim: sticky answerType promotion is **target**, not necessarily shipped. Evals assert target; don’t claim sticky is live everywhere without checking `AnswerPlanner`. | Label “target” vs “shipped” when citing sticky behavior. |
| **Output glossary without routing (resolved)** | Prior `00_memory` noted routing positives/false friends were missing — **this grill filled that gap** (10 terms + cases.jsonl). Current llm-eval session should **extend** coverage/robustness, not re-litigate basics unless export to CONTEXT.md is still pending. | Build on locked `sd-route-*`; add capability graduation + low-confidence LLM path tests. |
| **ADR 0003 scope boundary** | Speakable enforcement ADR assumes typing is already correct. Robust llm-eval for routing **feeds** ADR 0003; it does not replace it. | Routing ship enables speakable DF; don’t merge into one “100% end-to-end” metric without splitting routing vs output. |

**Still binding unless explicitly reopened:** all `sd-route-*` terms; hybrid not LLM-only; no soft-clarify v1; ~99% framing; capability track for fuzzy ASR; all speakable-sd output terms; Delivery Framework order; candidate-led = sim-only.
