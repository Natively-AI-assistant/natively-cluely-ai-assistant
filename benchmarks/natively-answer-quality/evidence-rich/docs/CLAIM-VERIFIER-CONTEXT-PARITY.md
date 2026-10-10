# Claim pass: does it see what the generator saw? (2026-10-04)

Question: when the claim pass (`electron/llm/claimVerifier.ts`) checks a draft, does it have the evidence the
generator had? If not, it can "correct" a right answer it cannot see the support for (`verifier_context_loss`).

## Measured on every recorded run (judge-free)

Script: `node evidence-rich/report/verifier-parity.mjs <run dirs>`. For each turn on which the pass ran, it compares the
generator's user message with the material in the pass's own request (everything before `DRAFT REPLY:`), counts the
evidence items in each, and checks the oracle's needed-fact strings that reached the generator against what the pass
saw. A `verifier_context_loss` is an answer the pass CHANGED while missing a needed fact the generator had.

| Run (build) | passes | pass saw the generator's whole user message | marked cut | fewer evidence items | needed facts the generator had | of those missing from the pass | edited answers | verifier_context_loss |
|---|---|---|---|---|---|---|---|---|
| er-dev-base (kept build, before E1) | 202 | 201 | 0 | 1 | 186 | 0 | 64 | 0 |
| **er-dev-e1 (E1, before E5)** | 201 | **40** | **118** | **158** | 262 | **42** | 88 | **20** |
| er-dev-s3 (E1 + markup + E5) | 201 | 201 | 0 | 0 | 265 | 0 | 49 | 0 |
| er-dev-m1 (main) | 203 | 203 | 0 | 0 | 270 | 0 | 53 | 0 |
| er-dev-m1r (main, repeat) | 203 | 203 | 0 | 0 | 272 | 0 | 53 | 0 |
| er-dev-m2 (main + E2) | 201 | 201 | 0 | 0 | 278 | 0 | 45 | 0 |
| **er-holdout-e1** | 133 | **27** | **77** | **106** | 185 | **42** | 56 | **15** |
| er-holdout-m1 (main) | 133 | 133 | 0 | 0 | 192 | 0 | 23 | 0 |

`verifier_evidence_parity` = 1.00 on every recorded build since E5: the pass saw the whole generator user message on
941 of 941 passes (s3, m1, m1r, m2, holdout-m1). None of these runs is `efc126a9` itself; it adds only the
claim-authority exemption for whole mode files, which widens the prompt the pass inherits whole. The loss existed exactly once, in the window between E1 (whole files, prompts above 24,000 chars)
and E5 (cap raised to 96,000), and E5 removed it. Both are on local main.

## What can still differ (code, not seen at runtime in these runs)

1. **System prompt.** The pass uses its own system prompt (claim-check rules), not the answer's. In V3 the answer's
   system prompt holds rules, persona, mode and grounding; the evidence and the user's instructions are in the user
   message, which the pass receives whole. Lost: the answer's style rules and any ACTIVE SKILL block. Facts: none,
   unless a custom mode's persona text itself carries facts (`prompt-composer.ts:1425-1474`).
2. **Material above 96,000 chars** is head-cut (`claimVerifier.ts:273,277`). Largest real prompt measured: 48,716.
   A typed message of ~95,000+ chars would reach it (typed-input probe: the app sends 400,000 chars whole).
3. **Spoken turn with no remembered answer call** rebuilds the request without the screenshot (`repairCallArgs`
   with `imagePaths=undefined`). Typed image turns skip the pass entirely.
4. **Stalled turns.** A WTA turn that ends on a stall aborts the pass immediately (`parentSignal`), so the partial is
   kept unchecked. On typed V3, a 20 s engine stall ends the stream with `truncated=false` and the pass runs on the
   partial draft.
5. **Other repairs** still inherit only 24,000 chars (`LLMHelper.ts:1012`). Measured on main's recorded runs: one
   such repair is common — the heard path's **document-grounded "corrected answer" repair**
   (`IntelligenceEngine.ts:5730-5830`). It runs when the legacy coverage check fails the streamed answer, and:
   - inherits the answer's prompt **cut at 24,000 chars** (with the `[...answer context truncated...]` marker), so on a
     whole-file turn the files' tails are gone;
   - adds its OWN evidence: a relaxed re-retrieval through the legacy ModesManager block (`buildDocContext(true)`,
     5,200 tokens, topK 24), not the V3 pack the answer used;
   - **replaces the streamed answer** when its rails pass (`fullAnswer = repairedTrim`); the claim pass then checks it.

   Measured with `node evidence-rich/report/repair-parity.mjs <runs>` (requests identified by their
   "Output ONLY the corrected answer" line):

   | Run | heard turns | repair ran | cut at 24,000 | needed facts the generator had | missing from the repair | turns with a loss |
   |---|---|---|---|---|---|---|
   | er-dev-base (kept build) | 179 | 25 | 0 | 34 | 0 | 0 |
   | er-dev-e1 | 179 | 36 | 36 | 56 | 8 | 5 |
   | er-dev-s3 | 179 | 35 | 35 | 53 | 6 | 2 |
   | er-dev-m1 | 179 | 34 | 34 | 57 | 9 | 3 |
   | er-dev-m1r | 179 | 38 | 38 | 63 | 11 | 3 |
   | er-dev-m2 | 179 | 35 | 35 | 55 | 7 | 4 |
   | er-holdout-m1 | 119 | 24 | 24 | 34 | 1 | 1 |

   The repair runs on about 20 % of heard turns and never on typed turns. Since E1 (whole files) it is cut at
   24,000 chars every time it runs, and it lacks at least one needed fact the generator had on 1–4 turns per run
   (about 1–2 % of heard turns). E5 did not touch it.
   **Whether its text became the shown answer cannot be read from these runs:** the prompt recorder keeps no response
   body for secondary calls (repair and claim pass both record 0 chars), so a changed answer cannot be attributed to
   the repair or to the claim pass. NOT MEASURED. This is the remaining parity gap on main.

## Classification of the 35 E1-era claim-pass losses (for the record)
All 35 (20 dev + 15 holdout edited answers) are the same mechanism: whole files pushed the generator's prompt over the 24,000-char replay cap; the pass got a
head-cut prompt with `[...answer context truncated...]` and lost the files' tails. Fixed by E5 (`be676d88`).
