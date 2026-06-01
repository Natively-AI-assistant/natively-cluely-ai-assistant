> **Real UI eval (2026-06-01):** A real UI Playwright/Electron eval has been added (`intelligence-eval-real-ui/`). Backend-only and API-only evals are not enough for release validation. It drives the REAL Natively Electron app (launch → load resume/JD/custom/persona through the UI → inject transcript via the shipped test IPC → press the real "What to answer?" button / type manual questions → grade real DOM-visible streamed answers), recording latency, cost, accuracy, context usage, screenshots, videos, traces, network. Verified runnable here (app launches, all windows render, all preload bridges + real transcript injection work); the full keyed 100-case run needs NATIVELY_TEST_API_KEY (Pro-entitled) + a GUI session. See `REAL_UI_TESTING_APPROACH.md` and `intelligence-eval-real-ui/README.md`.

> **Production-proof status (2026-06-01):** The deterministic backend-only eval (`intelligence-eval/`) is **NOT accepted as production proof** — it never calls a provider (sub-millisecond first-token is the tell). A **real API eval** (`intelligence-eval-real-api/`) has been added that hits the real Natively `/v1/chat` streaming endpoint with `NATIVELY_TEST_API_KEY`, records real first-token/total latency, and validates real context usage. Real API eval is the release-validation gate. See `intelligence-eval-real-api/README.md` and `results/real-api-summary.md`.
>
> **REAL API RESULT (executed against the live endpoint, gemini-3.5-flash):**
> **100/100 passed, 22/22 critical, release gate PASS** (after fixing the
> persona-fabrication finding — see `INTELLIGENCE_FIX_REPORT.md` §13). Earlier
> runs: 99/100 with the lone miss being persona-induced metric fabrication
> (ML-008), now fixed via real-experience grounding + restored EXECUTION_CONTRACT
> + hardened anti-fabrication prompt. Context audit: persona "no invented-metric
> failures: true", resume recall 31/31, JD/negotiation no-leak, 0 assistant confusion. 71/71 real streaming
> calls succeeded, 29 deterministic fast-path (identity/intro), 0 mocks, 0
> assistant-identity confusion. Context audit: JD/negotiation no-leakage,
> persona style-only (no invented facts), transcript follow-ups resolved.
> **Real latency (the headline finding):** manual factual recall (deterministic
> fast path) p50/p95 < 1ms; LLM-backed answers p50 ~6.2s / p95 ~9.3s
> first-useful-token — this **exceeds the spec's <3s/<5s LLM targets** and is a
> measured property of the Natively API's `gemini-3.5-flash`, not the
> intelligence layer (which adds <1ms). Earlier raw runs hit connection
> rate-limits firing 71 calls rapidly (fixed with pacing + retry/backoff;
> 37→71 calls succeed). The lone non-critical miss across runs was a
> codename-vs-paraphrase exact-match artifact (model said "ThreatHunter
> Playbook" for "ThreatHunter-Playbook"), fixed with punctuation-insensitive
> fact matching. Iterations preserved: `results/real-api-iteration-00{1..4}*.json`.

# Intelligence Eval Summary

End-to-end evaluation of Natively's Profile Intelligence across 10 synthetic
profiles × 10 patterns = **100 test cases**, plus the earlier 100-case
interviewer-perspective production eval and the 200-case routing harness.

## Headline (intelligence-100-e2e, iteration-001)

| Metric | Result |
|--------|--------|
| Total tests | 100 |
| Passed | 100 |
| Failed | 0 |
| Overall accuracy | **100%** |
| Critical tests | **22/22** ✅ |
| Identity recall (all "what is my name?" + interviewer identity) | **100%** ✅ |
| Context-isolation tests | **100%** ✅ |
| Assistant-identity confusion | **0** ✅ |
| Release gate (≥99 pass AND all critical pass) | **PASS** ✅ |

Every profile scored 10/10; both modes (manual_input 47/47, what_to_answer
53/53) at 100%.

## Honest scope of the harness

This environment has **no live LLM API keys**, so the runner cannot make 100
real streaming provider calls (and they would not be reproducible). Instead it:

- Drives the **REAL compiled production routing/grounding path** for every case
  — `extractLatestQuestion` / `toCandidateFraming` (real transcript extractor)
  and `KnowledgeOrchestrator.processQuestion` (real intent + structured pack +
  identity fast-path + negotiation gating). This is the surface where the bugs
  live (identity confusion, missing projects, JD/negotiation leakage, wrong
  perspective, follow-up mis-resolution).
- Composes a **deterministic answer strictly from the grounded facts** routing
  surfaced. This is a faithful proxy: if routing fails to surface a required
  fact, the composed answer cannot contain it, so the test fails exactly as a
  live run would for that bug class.
- Records **real wall-clock** for the deterministic stages.
- Gates real provider calls behind `--live` (runs only when keys are present).

What it does NOT prove: provider token-generation *quality* (phrasing, tone) and
real network first-token latency. Those require `--live` with credentials. The
correctness of *what context reaches the model* and *whether the right facts are
grounded* IS proven here on real production code.

## Latency (deterministic-stage wall-clock)

| Metric | Actual | Target | Status |
|--------|-------:|-------:|:------:|
| What-to-answer extraction p95 | ~0.27ms | <500ms | ✅ |
| Manual first-token p50 | ~0.05ms | <1000ms | ✅ |
| Manual first-token p95 | ~0.26ms | <2000ms | ✅ |
| What-to-answer first-token p50 | ~0.06ms | <3000ms | ✅ |
| What-to-answer first-token p95 | ~0.45ms | <5000ms | ✅ |

The intelligence prefix adds <1ms before the provider call. See
`INTELLIGENCE_LATENCY_REPORT.md` and `intelligence-eval/results/latency-report.md`.

## Product fixes this eval surfaced and drove

The eval found and fixed **real production gaps** (not test artifacts):

1. **Name questions mis-routed to TECHNICAL.** "what is my full name?",
   "can you tell me your name?", "your name please" missed the narrow
   `IDENTITY_DIRECT_PATTERNS` and fell into the `"what is"` TECHNICAL bucket →
   no identity grounding. Fixed with a robust `NAME_QUESTION_REGEX` (+ a
   `NAME_OF_THING_REGEX` disqualifier so "name of your company/project" stays
   out). `premium/electron/knowledge/IntentClassifier.ts`.

2. **Skills/tools/frameworks questions grounded nothing.** "what ML frameworks
   do I know?", "which monitoring tools have you used?", "what tech stack..."
   produced no category hints → the deterministic structured pack never fired →
   skills weren't surfaced. Fixed by broadening skill-synonym detection and
   letting the pack fire on a skill signal even when `detectCategoryHints` is
   empty. `premium/electron/knowledge/KnowledgeOrchestrator.ts`.

3. **First-person "I" questions weren't candidate-directed.** "what ML
   frameworks do I know?" has no "you/your/my" — the candidate-framing regex
   omitted standalone "i", so the question fell to the inclusion-bias path and
   grounded nothing. Added `i`/`i've`/`i'm` to the framing regex (safe: generic
   questions are already removed by the generic-knowledge bypass that runs
   first). `premium/electron/knowledge/KnowledgeOrchestrator.ts`.

4. **toCandidateFraming broke intro detection.** Rewriting "introduce yourself"
   → "introduce myself" stopped the orchestrator's INTRO_PATTERNS from matching,
   so interviewer "introduce yourself" intros never grounded the name. Fixed by
   preserving intro idioms verbatim. `electron/llm/transcriptQuestionExtractor.ts`.

## Harness integrity (test-engineer review + de-laundering)

A skeptical test-engineer review of the first 100/100 caught **real grade
laundering** — three paths where a test could pass without the orchestrator
actually doing the work. All three were fixed; the final 100/100 is after the fixes:

1. **Intro name was fixture-injected.** The runner used to read
   `fixture.identity.name` directly for "introduce yourself" cases, so the name
   passed even if the orchestrator never surfaced it. **Fix:** the runner now
   gives the orchestrator a stub `generateContentFn` and the intro flows through
   the REAL `ContextAssembler.generateCandidateIntro` prompt path; the stub can
   only echo a name the orchestrator embedded in the prompt it built.
2. **Isolation cases discarded the grounding.** Forbidden facts (JD/salary) were
   checked only against the composed answer, which for identity answers never
   echoes them. **Fix:** the grader now also scans the orchestrator's RAW
   `contextBlock` — a JD/salary leak into the context the model would see now
   fails the case (`forbidden_fact_in_grounding`).
3. **Missing-info admission came from the test field.** **Fix:** the
   hallucination guard now also scans the raw grounding for fabricated
   numbers/$amounts.

**Negative controls (proof the de-laundered harness catches regressions):**

- Breaking the candidate name in `generateCandidateIntro`'s prompt drops the
  score to **91/100** and fails exactly the 9 intro cases (incl. critical
  ML-002) with `missing_required_fact:<name>`. The laundered version stayed 100.
- Injecting a `<salary_intelligence>` block into an isolation case's grounding
  fails it with `forbidden_fact_in_grounding:salary` even when the answer is
  clean "My name is X." Clean grounding passes.

So the final 100/100 is evidence that the real orchestrator surfaces the name
for intros, grounds projects/skills/experience for recall, and does NOT leak
JD/salary into identity/isolation answers — not a vacuous pass.

### Remaining honest caveats

- `deriveLayers` is a runner-side interpretation of which context layers the
  orchestrator surfaced (from contextBlock tags + intent), not production's
  assembler. Layer assertions are therefore directional, not authoritative;
  the load-bearing checks are requiredFacts, forbidden-in-grounding, perspective,
  and assistant-identity.
- Provider answer *quality* (phrasing/tone) and real network first-token latency
  are still only covered by `--live`.
- The 9 negotiation cases verify perspective + no-leak, not coaching *content*
  (the companion `LLMHelperNegotiationCoachingGate` node test covers the gate).

## Files

```
intelligence-eval/
  fixtures/                  10 canonical synthetic profiles (production shape)
  test-cases/intelligence-100-e2e.json   100 cases (22 critical)
  scripts/
    generate-fixtures.mjs    normalize synthetic profiles → fixtures
    generate-test-cases.mjs  build the 100 cases (facts resolved from fixtures)
    run-intelligence-e2e.ts  real routing/grounding + grade + latency
    grade-intelligence-result.ts   10 deterministic grading rules
    latency-recorder.ts      per-stage hrtime recorder
    write-reports.mjs        results → markdown
  results/
    iteration-001.json       full per-test metrics
    latest-summary.md
    latency-report.md
```

## How to rerun

```bash
node scripts/build-electron.js
node intelligence-eval/scripts/generate-fixtures.mjs
node intelligence-eval/scripts/generate-test-cases.mjs
node intelligence-eval/scripts/run-intelligence-e2e.ts   # exits non-zero if gate fails
node intelligence-eval/scripts/write-reports.mjs
```

## Anti-hardcoding

Audited `electron/` + `premium/electron/` (excluding `__tests__`): **no fixture
names, roles, companies, projects, or fake answer strings** in production
intelligence routing/prompt/response logic. The only `"I'm Natively"` occurrences
are the legitimate assistant-identity probe (anchored regex, fires only on
"who are you?") and the identity-guard prompt that prevents candidate/assistant
confusion. Details in `INTELLIGENCE_FIX_REPORT.md` §Anti-hardcoding.
```
```
