# Speakable system design

Glossary for system-design interview answers that a human can read aloud to a live interviewer — Delivery Framework speech, not DSA code scaffolds.

## Language

### Surfaces

**Speakable SD surface**:
The speakable output contract on **both** product Technical Interview WTA and T2 sim SUT whenever `answerType` is `system_design_answer`.
_Avoid_: Sim-only tone fix, InterviewMan-only custom prompt

**Candidate-led showcase**:
T2 sim-only rule that the candidate leads Delivery Framework progression; interviewer clarifiers / hand-back / END only.
_Avoid_: Applying candidate-led to live meeting product WTA

### Output contract

**Speakable SD answer**:
Full-sentence Delivery Framework prose for one framework slice per turn; preferred “we”; readable aloud without telegram/caveman style.
_Avoid_: Cue-card bullets-only, essay multi-phase dump, DSA RESPONSE CONTRACT headings

**Speakable SD length**:
FULL_RAW means no caveman / allow tradeoff prose — not force-essay and not `compressToSpeakable` on SD turns.
_Avoid_: compressToSpeakable on system_design_answer, telegram style

**Speakable SD diagram**:
On SD turns, the only allowed code fence is ASCII HLD (` ```text ` / ` ```ascii `) per SPEC 10. Impl-language fences and DSA `## Code` / Dry Run / Complexity are banned.
_Avoid_: Zero fences (reopens SPEC 10), Python/JS dumps as “explanation”

**Speakable SD interviewer**:
T2 FULL_RAW interviewer uses prose + optional mermaid only — no impl-language code dumps.
_Avoid_: Interviewer Python modules, Dry Run / Complexity blocks

### Enforcement

**Speakable SD enforcement**:
Defense in depth: (1) untangle TI so SYSTEM DESIGN never inherits DSA RESPONSE CONTRACT; (2) never run DSA repair unless coding answer type; (3) post-stream strip DSA headings + impl fences on `system_design_answer`, keeping ASCII HLD.
_Avoid_: Prompt-only retune, post-strip-only

**Speakable SD root cause**:
One bug family: SHARED_CODING_RULES lumping SD with DSA **and** repair/misroute onto non-coding turns. Acceptance: no DSA scaffolds and no repair markers on `system_design_answer`.
_Avoid_: Fixing only misroute or only the prompt lump

### Related (out of scope for this context)

**candidate_rewind**:
Late Requirements Draft restart after gate progress — owned by SPECs 14–16 / SdSessionAuthority; not a speakable-format ship gate.
_Avoid_: Blocking speakable SD on rewind-green

**Delivery Framework**:
Spoken order: Requirements → Core Entities → API / Interface → (optional) Data Flow → HLD → Deep Dives.
_Avoid_: Invented alternate SD skeletons, one-turn full-framework dump

### Routing (`answerType`)

**SD route positive**:
Utterances that must classify as `system_design_answer`: existing `SYSTEM_DESIGN_PATTERNS` shapes (`system design`, `design (a|an|the)`, design/architect/build/scale + scalable|distributed|architecture…, classic nouns rate limiter / url shortener / chat system / notification system) **and** design|build + service|system|platform + like|similar to + product name.
_Avoid_: Open-ended “any product clone” without design/build framing; expanding classic nouns without a TDD case

**SD route title-form**:
Interview titles and gerunds that name a system to design (e.g. “Designing a Scalable Ticketing Platform”) **shall** be `system_design_answer`. Patterns must cover designing|design without requiring only `a|an|the`.
_Avoid_: Treating titles as `general_meeting_answer`

**SD route not-experience**:
Years / tell-me-about experience with distributed|scalable|architecture **without** a design/build/architect imperative is not SD.
_Avoid_: Routing experience probes into Delivery Framework

**SD route not-coding**:
Write/implement/code/solve (coding or DSA) for a component is coding/DSA — never SD.
_Avoid_: “Implement a rate limiter” as system design

**SD route not-concept**:
Explain / what-is / how-does without design|architect → `technical_concept_answer`.
_Avoid_: Tutorial concept answers on design asks

**SD route not-product-about**:
Named Natively + architecture/build/stack → `project_about_answer` before SD (unchanged).
_Avoid_: Generic SD template for Natively product questions

**SD route scale-ask**:
How-would-you + (scale|architect|design) + named system/service/product → `system_design_answer`. How-would-you-use &lt;tool&gt; stays concept.
_Avoid_: All “how would you…” as SD

**SD route sticky**:
When sticky SD session is armed (`sdSessionOpen` / open `problemKey`), non-coding / non-DSA clarifiers classify as `system_design_answer` so speakable DF + strip apply mid-interview. Explicit coding/DSA pivot leaves SD. See **SD route sticky exclusions**.
_Avoid_: Leaving mid-interview clarifiers on `general_meeting` without speakable contract

**SD route sticky exclusions**:
Under `sdSessionOpen`, negotiation, identity/intro, and meeting-admin (`general_meeting_answer` admin turns) **must not** sticky-promote to `system_design_answer`. Coding/DSA/write-implement still exit SD.
_Avoid_: Sticky-promoting salary, intro, or action-item turns into Delivery Framework

**SD route hybrid** (superseded mechanism name — prefer **SD route LLM parallel**):
Historical term for “front door + covered classifier path, no ungated leftover.” Live mechanism is **SD route LLM parallel** (ADR 0005).
_Avoid_: Ungated residual LLM path; replacing the front door with LLM-only

**SD route LLM parallel**:
Deterministic `SYSTEM_DESIGN_PATTERNS` + false-friend guards remain. On every WTA/manual route turn, also resolve **SD intention** (sync heuristic and/or injected classifier result). Merge: hard vetoes win; LLM/heuristic may **promote** a regex miss to `system_design_answer` at confidence ≥ 0.75; must **not** demote a clear regex SD hit. Product target ≥99.99% on the versioned `evals/sd-routing` corpus (trials on classifier-dependent cases).
_Avoid_: LLM-only routing; demoting regex SD hits; promote below threshold

**SD route classifier contract**:
Binary SD intention yes/no + confidence. Promote iff yes ∧ confidence ≥ 0.75. Timeout/error → no promote (precision over recall). Prefer one production entrypoint (`classifySdIntention` + optional inject into `planAnswer`).
_Avoid_: Soft-clarify answerType; fail-open promote on timeout

**SD route no-soft-clarify-type**:
v1 does not invent a soft-clarify `answerType` for uncertain routing. Low confidence / timeout → do not promote; existing fallthrough.
_Avoid_: New clarify type blocking SD ship

**SD eval corpus v1**:
Versioned regression set for the ≥99.99% gate: existing `sd-route-*` cases; LLM-promote openers (whiteboard, HLD walkthrough, architecture review, section opener, let’s design); sticky exclusion goldens; fuzzy/ASR graduated with trials. Classic-noun grid expansion, non-English, live Gemini quality stay capability-only.
_Avoid_: Claiming open-world omniscience; gating live Gemini quality as routing SHIP

## Flagged ambiguities

**FULL_RAW**:
Historically “do not shorten / full paragraphs.” Speakable retune redefines it as no-caveman + tradeoff prose + one DF slice — not multi-phase essay dump and not compressToSpeakable.

**Code fence**:
ASCII HLD fence is allowed diagram speech; impl-language fence is a forbidden code dump. Do not conflate.

**Misroute**:
Prefer **SD route** terms for wrong `answerType`. Prefer **speakable SD root cause** for DSA contract/repair bleed on an already-SD turn.

## Example dialogue

Dev: “Can we just change the T2 FULL_RAW tone string?”  
Expert: “No — **speakable SD surface** includes product TI. Tone overlay alone won’t beat **speakable SD root cause**.”  

Dev: “Strip all fences so it’s pure speech?”  
Expert: “Keep **speakable SD diagram** — ASCII HLD only. Ban Python fences.”  

Dev: “Should we compressToSpeakable for glance-and-go?”  
Expert: “Not on SD — that fights **speakable SD length**. One DF slice of full sentences.”  

Dev: “Interviewer still pastes reconcile.py in the smoke.”  
Expert: “Fix **speakable SD interviewer** too — mermaid OK, impl dumps not.”  

Dev: “Rewind still tagged on Vesta smokes — block merge?”  
Expert: “No — **candidate_rewind** is a separate track.”  

Dev: “User typed Designing a Scalable Ticketing Platform — why meeting mode?”  
Expert: “That’s **SD route title-form** — gerund titles shall be `system_design_answer`; extend the front door.”  

Dev: “Can LLM only handle the leftovers?”  
Expert: “Use **SD route LLM parallel** — front door stays; classifier promotes misses with goldens. No ungated leftover.”  

Dev: “Sticky session — salary question became system design?”  
Expert: “That’s a bug against **SD route sticky exclusions** — negotiation must not sticky-promote.”  

Dev: “Whiteboard ‘sketch the architecture’ missed regex?”  
Expert: “Classifier promote path under **SD route LLM parallel** / **SD eval corpus v1** Tier A.”
