# Natively — AI Context Ownership Audit (Phase 5)

_Production-hardening audit, 2026-07-11. Branch: `context-os-evidence-execution-repair`._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; the cited fixes were independently re-verified
> present and passing (754/754 intelligence-suite tests) in the final
> working tree before this file was rewritten.

## Scoping note — this is NOT greenfield territory

Natively already has a mature, actively-developed system for exactly this
problem: **Context OS** (`electron/intelligence/context-os/` —
`SourceAuthorityKernel`, `EvidenceResolver`, `EvidenceOrchestrator`,
`ProfileEvidenceService`, typed `TurnContextContract`), backed by 18+ test
files and extensive design docs in `docs/context-os/`. Multiple concurrent
sessions/branches are actively developing this subsystem (confirmed directly
during this audit — see the operational note in
`AUDIT_VERIFICATION_REPORT.md`).

Given that, Phase 5's job here was **not** to design a new ownership system —
it was to (1) verify the existing system's invariants actually hold under
test, (2) find and fix any drift between the pieces of that system, and
(3) leave detailed evidence for continuing in-flight work rather than
freelance new architecture mid-audit.

## Method

1. Ran the full `electron/intelligence/__tests__/` suite (750 tests) as a
   baseline: **17 failures**.
2. Investigated every failure against the REAL current code (not
   assumptions) — several turned out to be genuine, well-scoped ownership
   bugs; several turned out to be stale tests asserting a contract the
   codebase deliberately moved past.
3. Fixed the real bugs. Rewrote the stale tests to assert the current,
   verified-correct contract.
4. Re-ran: **754/754 pass**.

## Fixed — real ownership bug

### [P1 — FIXED] Six JD-source answer types were invisible to the context router

**Problem.** `AnswerPlanner.ts` (2026-07-07, "JD/Resume JIT pipeline fix")
added six new `AnswerType` values distinguishing JD-only questions ("what
does this role require?") from resume+JD-mix questions ("which of MY
projects best matches this JD?"):

```
jd_summary_answer, jd_requirements_answer, jd_fact_answer          (JD-only — profile NOT required)
resume_jd_fit_answer, resume_jd_gap_answer, resume_jd_intro_answer (resume+JD mix — profile REQUIRED)
```

`AnswerPlanner` itself (`profileContextPolicyFor`, `CANDIDATE_VOICE_TYPES`,
`requiredLayersFor`) and `ProfileOutputValidator.ts` (updated the same day)
both correctly treat these six types. But **`ContextRouter.ts`**
(`answerContractFor`, `useHybridRag`) and **`ProfileIntelligenceRouter.ts`**
(`PROFILE_ANSWER_TYPES`, which drives `shouldUseProfile`/voice perspective)
were **never updated** — all six types silently fell through to the
`general_assistant`/no-profile default. Concretely: "why am I a fit for this
JD?" (classified as `resume_jd_fit_answer`) got `useProfileTree: false`,
`useHybridRag: false`, `answerContract: 'general_assistant'` — exactly
backwards for a question that must ground in the candidate's own resume.

**Why this matters even though `ContextRouter` is currently shadow-mode
(`contextRouterV2` flag default-OFF, non-load-bearing per the router file's
own header comment).** Three things: (1) it corrupted the shadow-mode
divergence telemetry — the exact signal the shadow-wiring test exists to
protect, so nobody would have noticed this router silently drifted before
the day it's turned on to actually drive answers; (2)
`decideProfileIntelligence` (the same stale `PROFILE_ANSWER_TYPES`) is a
general-purpose exported decision function — any future caller inherits the
same bug; (3) this is precisely the "two systems disagree about who owns
the answer" failure mode the audit brief calls out.

**Fix.**
- `ContextRouter.ts`: `answerContractFor()` — all six types now route to
  `'interview_detailed'`. `useHybridRag` — added `resume_jd_fit_answer` and
  `resume_jd_gap_answer` alongside the existing `jd_fit_answer`.
- `ProfileIntelligenceRouter.ts`: `PROFILE_ANSWER_TYPES` — added only the
  three **resume+JD mix** types. The three **JD-only** types were
  deliberately left out — they describe the target role, not the candidate
  (`AnswerPlanner.profileContextPolicyFor` returns `'allowed'`, not
  `'required'`, for those; `CANDIDATE_VOICE_TYPES` excludes them with the
  same reasoning).
- Verified every change against `AnswerPlanner`'s own source of truth before
  writing it — the fix makes the two downstream consumers agree with the
  type system's already-correct owner, not a new invented policy.

**Tests:** extended `ContextRouterShadowWiring.test.mjs` with 5 new cases
(resume+JD mix must ground in profile; JD-only must NOT force profile in;
legacy `jd_fit_answer` phrasing still routes correctly). Every phrasing was
verified against the real compiled classifier output before being written
into the test, not guessed. 18/18 pass in that file; 754/754 across the full
intelligence suite.

## Fixed — stale tests corrected to match a deliberate, documented architecture change

Two test files (16 of the 17 original failures) were asserting an **old**
contract the codebase had already, deliberately, moved past — confirmed by
reading `ProfileTreeService.ts`'s own docstring: *"This service no longer
returns deterministic final prose; callers must pass this prompt to a
provider when a user-visible answer is needed."* `ManualProfileRouteResult.answer`
is typed `never` with an explicit `@deprecated` tag.

**What changed (real, intentional, not a regression):** every profile-question
getter now returns a **structured JIT prompt**
(`<profile_jit_final_answer_request>` XML) with
`<source_owner>profile</source_owner>`, an explicit `<allowed_evidence>` list
of only the candidate's own facts, and hard anti-fabrication `<rules>` —
then the LLM generates the final prose from that. This is **arguably a
stronger** ownership guarantee than the old literal string: the
source-owner and evidence boundary are now structural and
machine-checkable in the prompt itself.

Also found and fixed a **stale docstring**: `getRoleFit()`'s comment claimed
"Returns null when no JD is loaded" — false;
`selectManualProfileEvidence`'s `JD_FIT_PATTERNS` fallback branch still
answers from the candidate's real skills/experience/projects when a fit
question is asked with no JD loaded (never fabricating JD facts).

**Fix:** rewrote `ProfileTreeDeterministicFastPath2026_06_15.test.mjs` (18
assertions) and `ProfileTreeService.test.mjs` (15 assertions) to assert the
**current, verified-real** contract: profile-only source ownership, no
cross-candidate leakage (Alice/Bob isolation retained), no
`<target_job_evidence>` fabrication with no JD loaded, correct
`answer_type`/`source_owner` tagging. Every new assertion checked against
real `node -e` output before being written. Both files: 100% pass after
rewrite.

## Verified — invariants that already hold (no fix needed)

Ran the contamination-specific suites directly — **all pass** (79/79):
`ContextOsContaminationSuite.test.mjs`, `ContextOsGateBehavior.verif.test.mjs`,
`ContextOsRuntimeCompletion.verif.test.mjs`, `ContextOsManualChatWiring.test.mjs`,
`ContextOsWtaWiring.test.mjs`.

Manual chat's document-grounded duplicate-retrieval bug (the "validator sees
evidence the answer was never grounded in" defect described in
`docs/context-os/evidence-execution-repair/`) is fixed on this branch as of
recent commits — verified the `EvidenceResolver` wiring in `LLMHelper.ts` and
the governed-pack reuse in the post-stream validator (`ipcHandlers.ts`).

## Left for the next `context-os` phase (not this audit — flagging, not fixing)

**WTA's pre-provider retrieval still runs through the legacy
`ModeHybridRetriever` path**, not `EvidenceResolver.resolve()` directly
(unlike manual chat, which is fully unified). WTA's post-stream validator
correctly reuses the governed pack (no second retrieval) — but the *first*
retrieval isn't yet the single OKF→hybrid→lexical pipeline `EvidenceResolver`
implements for manual chat. This looks like the deliberate next increment of
the in-flight repair work, not something to bolt on mid-audit. Recommend the
next `context-os` session wire `WhatToAnswerLLM.ts`'s pre-provider retrieval
through `EvidenceResolver` the same way `LLMHelper.ts` does for manual chat.
