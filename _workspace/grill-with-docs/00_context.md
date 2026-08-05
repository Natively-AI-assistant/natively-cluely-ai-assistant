# Context — SD interviewer-intention routing (llm-eval / evals/sd-routing)

**Topic:** Robust llm-eval coverage so we **100% detect when the interviewer intends a system-design question** — expanding `evals/sd-routing` as a regression gate.  
**Subproject (CONTEXT-MAP):** **Speakable system design** → `docs/speakable-sd/CONTEXT.md`  
**Map:** `CONTEXT-MAP.md` — SD route decisions define when `answerType` is `system_design_answer`; speakable contract applies after that typing.  
**Harvested:** 2026-08-05 (supersedes prior 00_context.md gaps-only draft)

**Layout:** `docs/speakable-sd/` has `CONTEXT.md` only (no `docs/speakable-sd/adr/`). ADRs live in `docs/adr/`. Root `CONTEXT.md` is **commercial surface strip** (orthogonal).

**Implementation status:** Tickets 01–03 marked done; `npm run eval:sd-routing` currently **SHIP** (18/18 regression @ 1.0; 2/2 capability tracked). Code on `feat/sd-routing` per local code-review.

---

## Known Terms

### Routing (`answerType`) — primary grill focus

| Term | Definition |
|------|------------|
| **SD route positive** | Utterances that **must** classify as `system_design_answer`: existing `SYSTEM_DESIGN_PATTERNS` shapes (`system design`, `design (a\|an\|the)`, design/architect/build/scale + scalable\|distributed\|architecture…, classic nouns rate limiter / url shortener / chat system / notification system) **and** design\|build + service\|system\|platform + like\|similar to + product name. Classic-noun expansion is TDD case-by-case only. _Avoid:_ open-ended “any product clone” without design/build framing. |
| **SD route title-form** | Interview titles and gerunds naming a system to design (e.g. “Designing a Scalable Ticketing Platform”) **shall** be `system_design_answer`. Patterns must cover `designing\|design` without requiring only `a\|an\|the`. _Avoid:_ treating titles as `general_meeting_answer`. |
| **SD route not-experience** | Years / tell-me-about experience with distributed\|scalable\|architecture **without** a design/build/architect imperative is **not** SD. _Avoid:_ routing experience probes into Delivery Framework. |
| **SD route not-coding** | Write/implement/code/solve (coding or DSA) for a component is coding/DSA — never SD. _Avoid:_ “Implement a rate limiter” as system design. |
| **SD route not-concept** | Explain / what-is / how-does without design\|architect → `technical_concept_answer`. _Avoid:_ tutorial concept answers on design asks. |
| **SD route not-product-about** | Named Natively + architecture/build/stack → `project_about_answer` before SD (unchanged). _Avoid:_ generic SD template for Natively product questions. |
| **SD route scale-ask** | How-would-you + (scale\|architect\|design) + named system/service/product → `system_design_answer`. How-would-you-use &lt;tool&gt; stays concept. _Avoid:_ all “how would you…” as SD. |
| **SD route sticky** | When sticky SD session is armed (`sdSessionOpen` / open `problemKey`), non-coding / non-DSA turns classify as `system_design_answer` so speakable DF + strip apply mid-interview. Explicit coding/DSA pivot leaves SD. _Avoid:_ leaving mid-interview clarifiers on `general_meeting` without speakable contract. |
| **SD route hybrid** | High-precision deterministic front door **plus** an always-covered classifier path. Every routing scenario (positives, false friends, title-form, scale-ask, sticky, fuzzy) has **llm-eval** goldens — **no ungated leftover**. Regex may short-circuit clear hits; llm-eval still asserts them. Not LLM-only; not “LLM only if regex misses” without cases. _Avoid:_ ungated residual LLM path; replacing the front door with LLM-only. |
| **SD route no-soft-clarify-type** | v1 does not invent a soft-clarify `answerType` for uncertain routing. High-precision SD when positives fire; otherwise existing fallthrough. _Avoid:_ new clarify type blocking SD ship. |

### Output contract (speakable SD — downstream of routing)

| Term | Definition |
|------|------------|
| **Speakable SD surface** | Speakable output contract on **both** product Technical Interview WTA and T2 sim SUT whenever `answerType` is `system_design_answer`. |
| **Speakable SD answer** | Full-sentence Delivery Framework prose for one framework slice per turn; preferred “we”; readable aloud without telegram/caveman style. |
| **Speakable SD length** | FULL_RAW means no caveman / allow tradeoff prose — not force-essay and not `compressToSpeakable` on SD turns. |
| **Speakable SD diagram** | On SD turns, the only allowed code fence is ASCII HLD (` ```text ` / ` ```ascii `) per SPEC 10. Impl-language fences and DSA `## Code` / Dry Run / Complexity are banned. |
| **Speakable SD interviewer** | T2 FULL_RAW interviewer uses prose + optional mermaid only — no impl-language code dumps. |
| **Speakable SD enforcement** | Defense in depth: (1) untangle TI so SYSTEM DESIGN never inherits DSA RESPONSE CONTRACT; (2) never run DSA repair unless coding answer type; (3) post-stream strip DSA headings + impl fences on `system_design_answer`, keeping ASCII HLD. |
| **Speakable SD root cause** | One bug family: SHARED_CODING_RULES lumping SD with DSA **and** repair/misroute onto non-coding turns. Acceptance: no DSA scaffolds and no repair markers on `system_design_answer`. |
| **Delivery Framework** | Spoken order: Requirements → Core Entities → API / Interface → (optional) Data Flow → HLD → Deep Dives. |
| **Candidate-led showcase** | T2 sim-only: candidate leads DF progression; interviewer clarifiers / hand-back / END only. Not live meeting WTA. |
| **candidate_rewind** | Late Requirements Draft restart after gate progress — owned by SPECs 14–16 / SdSessionAuthority; **not** a speakable or routing ship gate. |

### Informal / code terms (not glossary-locked)

| Term | Working meaning |
|------|-----------------|
| **Interviewer SD intention** | Informal goal of this grill: the interviewer’s utterance (WTA / transcript / manual) should be classified as `system_design_answer`. **Not** a separate enum — implemented as `planAnswer` → `answerType`. |
| **`planAnswer`** | Primary routing seam: `(question, source, speakerPerspective, sdSessionOpen, …)` → `answerPlan.answerType`. Eval runner calls compiled `planAnswer` only (contract-only, no API). |
| **`classifyIntent`** | Separate parallel classifier (`IntentClassifier.ts`) for orchestrator routing (coding, negotiation, etc.). **Not** the SD answerType gate; can disagree with `planAnswer`. |
| **`SdSessionAuthority` / `deriveSdSessionAuthority`** | Session-open boolean from sticky `problemKey` + TI mode; feeds `sdSessionOpen` into `planAnswer` (IE ~1589–1606). Distinct from gate arming on `general_meeting_answer` (prior sd-session-authority grill). |
| **`system_design_answer`** | Code enum for SD typing; triggers speakable template, strip, LESSON allowlist (when not overridden by session-authority exceptions). |

### Root CONTEXT.md (orthogonal)

Commercial strip terms only (`commercial surface strip`, `donation cluster`, `trial UI`, `trial backend hard-disable`, `checkout/upsell`, `engagement cluster`, `license bypass`, `BYOK`, `client Pro gate align`, `Natively identity kept`, `skip-premium`). No SD/routing terms.

---

## Locked Decisions (ADRs)

All under `docs/adr/` (no `docs/speakable-sd/adr/`).

| ADR | Title | One-sentence summary (SD / answerType / routing / evals relevance) |
|-----|-------|----------------------------------------------------------------------|
| **0001** | Strip commercial surfaces; keep license bypass | **Not relevant** to SD routing — fork monetization policy only. |
| **0002** | Hard-disable trial backend (not UI-only) | **Not relevant** to SD routing — trial IPC/sentinel teardown. |
| **0003** | Speakable SD enforcement (defense in depth) | Output contract after typing: prompt untangle + repair gate + post-strip on `system_design_answer`; **assumes routing already correct**; does not define classification rules. |
| **0004** | SD routing hybrid + sticky answerType | **Core routing ADR:** expand deterministic front door (title-form, like-X, scale-ask, false friends) **and** require llm-eval goldens for **every** scenario including fuzzy/sticky with **no ungated leftover**; armed sticky session promotes non-coding/non-DSA turns to `system_design_answer`; `evals/sd-routing` regression gate; no soft-clarify answerType in v1. |

**Related SPEC locks (not ADRs):** sim-08/09/10 (T2 tone, candidate-led, ASCII HLD); SdSessionAuthority grill (gate arming decoupled from answerType for Requirements machinery — **partially overlaps** sticky routing but LESSON key remains `system_design_answer` only).

---

## Flagged Ambiguities

1. **~99% vs 100% target** — PRD and ADR 0004 say “~99% correct classification.” Current eval gate is `min_pass_rate: 1.0` on **regression only** (18 cases). User goal “100% identification for regression gate” is met for that suite today but **does not** cover capability/fuzzy or production paraphrase long tail.

2. **Q9 grill log vs exported glossary (hybrid LLM path)** — `01_question_log.md` Q9 says “LLM classify only low-confidence leftovers + llm-eval gate.” Exported `sd-route-hybrid` and ADR 0004 say **no ungated leftover** and require cases for **every** path. **Today’s implementation is regex-only `planAnswer`** — no separate LLM SD classifier in `AnswerPlanner`; “hybrid” is satisfied by deterministic front door + eval coverage, not a live LLM routing fallback.

3. **“Interviewer intention” vs `answerType`** — No dedicated intention model. Detection is pattern matching on normalized question text (+ sticky flag). Transcript ASR noise, speaker attribution, and `source` (`what_to_answer` vs `manual_input`) can change routing but are lightly covered in evals.

4. **`classifyIntent` vs `planAnswer`** — Two independent classifiers (see forensic traces). SD routing eval tests **only** `planAnswer`. Misalignment with intent/orchestrator paths is out of scope for `evals/sd-routing` but can still affect live behavior.

5. **Scale-ask vs `isHypotheticalTech`** — “How would you scale our checkout?” must beat `technical_concept_answer`. Resolved for clean phrasing via `SYSTEM_DESIGN_PATTERNS` scale-ask regex; **competes** with hypothetical-tech branch for borderline wording (capability case `sd-route-fuzzy-scale-checkout`).

6. **Sticky answerType vs SdSessionAuthority** — ADR 0004 sticky promotes **answerType** for speakable strip/DF. Prior SdSessionAuthority grill armed **Requirements gate** on `general_meeting_answer` without changing answerType. Both use `sessionOpen` / `problemKey`; behaviors are related but not identical (e.g. sticky GM→SD may change LESSON allowlist — noted in local code-review).

7. **Misroute overloaded** — Speakable glossary: misroute = DSA repair/lump on an SD-typed turn. Engineers also use misroute for wrong `answerType`. Prefer **`sd-route-*`** for classification; **speakable SD root cause** for contract bleed.

8. **Regression vs capability** — Fuzzy/ASR cases (`sd-route-fuzzy-*`) are **capability** (tracked, `min_pass_rate: 0.0`, not gated). “100% regression gate” ≠ “100% on all paraphrases.” Promotion path: stable capability → retag regression (per speakable-sd README pattern).

9. **Classic noun / product list closure** — `sd-route-positive` allows case-by-case classic nouns and a fixed product allowlist in patterns (`Design Bit.ly`, etc.). “Design Acme Corp” without list membership is **undefined** — intentionally not open-ended.

10. **FULL_RAW / speakable length** — FULL_RAW redefined as no-caveman + one DF slice, not essay dump; still ambiguous vs `compressToSpeakable` on non-SD paths (output topic, not routing).

11. **Early `planAnswer` without sticky** — Code-review notes `_wtaPlan` / early intent routing calls may omit `sdSessionOpen` (prior-turn routing only). Full WTA path passes sticky (IE ~1589–1606).

12. **Meta case self-reference** — `sd-route-hybrid-matrix-covered` requires tag `sd-route-hybrid` in `requireTags` while also carrying that tag — meta completeness check, not a routing scenario.

---

## Gaps

### Eval suite design (100% SD intention regression gate)

| Gap | Detail |
|-----|--------|
| **No live LLM routing eval** | Runner (`scripts/run-evals-sd-routing.mjs`) is **contract-only** — calls `planAnswer`, no Gemini. ADR “hybrid” LLM path is **not exercised** in eval; only regex behavior is gated. |
| **Thin fuzzy coverage** | Only **2** capability cases (ASR title, messy scale-ask). No regression gate on paraphrase/ASR long tail despite ~99% product goal. |
| **No corpus-driven expansion** | No harvest loop from `natively.db` / dogfood failures beyond Ticketmaster, Bit.ly, Twitter. Missing systematic ingestion of missed SD titles from traces. |
| **Source / perspective matrix** | Most cases use `what_to_answer` + interviewer; manual_input used for title/like-X/product-about. No matrix asserting **same intention** across `source` variants. |
| **Negative space incomplete** | Missing eval tags for: “explain design patterns” (lecture, not SD — unit test only); open-ended “Design FooBar Startup” without allowlist; architect/imperative variants; debugging-vs-SD boundary; behavioral “tell me about a system you designed.” |
| **Classic noun coverage** | Pattern list has 4 phrase nouns + ~15 product names. No eval per noun; expansion rule is TDD case-by-case but suite doesn’t enforce “new noun ⇒ new case.” |
| **Sticky edge cases** | No cases for: sticky + experience probe; sticky + product-about Natively; sticky + debugging; sticky + meeting recap; unarmed clarifier mid-TI without prior SD prepare (session never opened). |
| **Scale-ask variants** | Missing: “how would you **architect** a notification pipeline”, “how would you **design** our API”, without checkout keyword; negative “how would you **approach** data analysis” (hypothetical tech). |
| **Title-form variants** | Missing: ALL-CAPS titles, punctuation-only titles, “Design: Scalable X”, session agenda lines, multi-sentence prompts with SD title + behavioral tail. |
| **CI / trials** | `threshold.yaml` has `trials: 1` — no flake detection for future live cases. |
| **Cross-suite duplication** | `evals/speakable-sd` asserts output contract on Ticketmaster opener, not full routing matrix. Overlap intentional but routing regressions could ship if only speakable-sd run. |
| **100% definition unstated** | Need explicit scope: 100% of **regression** tagged scenarios vs 100% of **all interviewer SD intentions in the wild**. Latter requires capability promotion + corpus growth. |

### Implementation / architecture gaps

| Gap | Detail |
|-----|--------|
| **Regex ceiling** | All SD intention detection is `SYSTEM_DESIGN_PATTERNS` + order-dependent branches in `AnswerPlanner.ts` (~632–658, ~2543–2576, sticky ~2703–2713). No confidence score or LLM fallback for unmatched-but-SD utterances. |
| **Hypothetical-tech ordering** | Scale-asks must match SD patterns **before** `isHypotheticalTech` → `technical_concept_answer`. Fragile for novel phrasing. |
| **Experience guard vs title-only** | Experience guard requires design imperative with scalable/distributed; title-form patterns compensate but ambiguous “Scalable Ticketing Platform experience?” untested. |
| **Intent parallel path** | `intentResult` can influence coding branch but not SD-positive branch — SD detection ignores SLM intent. |
| **Documentation drift** | Prior `00_context.md` listed gaps now **closed** in glossary (routing section exported). Prior session still referenced missing ADR 0004 — now exists. |

### Essential files for understanding

| Path | Role |
|------|------|
| `CONTEXT-MAP.md` | Subproject map; SD route ↔ speakable surface |
| `docs/speakable-sd/CONTEXT.md` | Full glossary (output + routing) |
| `docs/adr/0003-speakable-sd-enforcement.md` | Output enforcement ADR |
| `docs/adr/0004-sd-routing-hybrid-sticky.md` | Routing + eval ADR |
| `electron/llm/AnswerPlanner.ts` | `SYSTEM_DESIGN_PATTERNS`, routing order, sticky promote |
| `electron/IntelligenceEngine.ts` | `sdSessionOpen` from `deriveSdSessionAuthority` |
| `evals/sd-routing/cases.jsonl` | Golden cases + tags |
| `evals/sd-routing/threshold.yaml` | Regression gate 1.0 |
| `scripts/run-evals-sd-routing.mjs` | Contract runner |
| `electron/llm/__tests__/AnswerPlannerValidator.test.mjs` | Unit matrix (mirrors evals) |
| `.scratch/sd-routing/PRD.md` | User stories + testing decisions |
| `_workspace/grill-with-docs/01_question_log.md` | Verified Q1–Q10 routing terms |
