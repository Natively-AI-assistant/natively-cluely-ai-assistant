# Phase 10 — Rollout and Rollback

**Status:** **V3 IS THE DEFAULT ANSWER SYSTEM** (2026-07-30, owner direction). `DEFAULT_ENABLED = true`; stages 1–4 were collapsed by decision, not by measurement. See §9.
**Date:** 2026-07-29, revised 2026-07-30

---

## 1. Rollback is a flag flip, for the whole migration

`contextIntelligenceV3 = false` restores the legacy path completely, because the new module is **purely additive** — nothing is deleted until Phase 9, and Phase 9 is blocked. There is no revert, no migration to undo, and no DB change to reverse (the chosen scope explicitly excludes schema work).

This property must be preserved deliberately. The moment a change is made that a flag cannot switch off, rollback stops being free and the migration acquires risk it does not currently have.

---

## 2. The flag rule that matters more than the rollout stages

```ts
contextIntelligenceV3: {
  env: 'NATIVELY_CONTEXT_INTELLIGENCE_V3',
  setting: 'contextIntelligenceV3Enabled',
  default: false,          // identical in dev, test, and production
}
```

**`isInternalDevTestContext` is forbidden as this flag's default.**

This is not stylistic. 20 of the 62 existing intelligence flags resolve differently in dev/test than in production, and that split is *the mechanism* by which `composePrompt` was built, tested, and never executed for a user; by which `assistantClaims` enforcement is on in tests and off in production; by which the OKF provenance layer — the only content-hash versioning in the system — is inert in every shipped build.

A rebuild that reproduces the split reproduces the outcome. **Any new sub-behaviour ships on the same value in both configurations, or it does not ship.**

---

## 3. Stages

| Stage | Population | Exit criterion |
|-------|-----------|----------------|
| 0 | Developer harness only | `AnswerTrace` parity green on the harness |
| 1 | Internal users, opt-in | No decision divergence on shadow traces for 3 days |
| 2 | 5% production | Error and no-evidence rates within baseline; p95 not regressed |
| 3 | 25% | Same, plus no contamination signal |
| 4 | 50% | Same |
| 5 | 100% | 2 weeks stable |
| 6 | Legacy removal | Phase 9 unblock chain complete |

Stage 0 cannot begin until **F21** is fixed, because no gate is measurable before then.

---

## 4. Monitoring

Decision-layer signals — these are the ones that would have caught the failures this mission investigated, and none of them exist today:

| Signal | Why |
|--------|-----|
| **Stale-version retrieval rate** | Top measured risk (54.8% on semantic). Should be ~0 once scope filtering lands; anything above noise means the filter is bypassed |
| **Contamination rate** (prohibited source in accepted evidence) | Measured 7.1–16.7% across arms; the JD-as-experience failure |
| Fast/grounded/verification split | A collapse toward "grounded" means the fast path is broken and latency will follow |
| No-evidence rate | Distinguishes "not found" from "retrieval failed" — currently indistinguishable |
| Strict-refusal rate | Rising = over-refusal; §27.2 explicitly forbids hiding failures behind refusal |
| General-fallback rate | Rising = grounding silently degrading |
| Request supersession rate | F4 — stale answers overwriting current ones |
| Retrieval dependency failures | Today `NO_RELEVANT_CONTEXT_FOUND` and a timeout both silently become an ungrounded answer |
| p50 / p95 TTFT | Fast path must bypass retrieval |
| User regeneration rate | Cheapest proxy for "the answer was wrong" |

**Telemetry must not carry private evidence text.** Log evidence **ids, source types, versions, scopes and scores** — never content. Redacted previews only, behind an explicit developer setting.

---

## 5. Abort conditions

Roll back to `false` immediately on any of:

- any stale-version or cross-meeting leak observed in production
- contamination rate above the legacy baseline
- p95 TTFT regression beyond 20%
- strict-refusal rate up while general-fallback rate is flat (over-refusal)
- any evidence content appearing in telemetry

---

## 6. Two independent P1s that rollout does not fix

Both are inherited by the reused ingestion layer and are **not** gated by the flag — they affect users today:

| | |
|---|---|
| **F22** | A 128k-char (66-page) PDF **aborts the process with SIGTRAP** during embedding. Extraction succeeds; a 64k-char PDF indexes fine. This is precisely the thesis/seminar use case. |
| **F12** | Re-uploading a resume or JD leaves the salary estimate, negotiation state, and company dossiers stale — a new JD carries the **previous role's** negotiation phase forward. |

Neither should wait for this migration.


---

## 7. Execution, 2026-07-30

### 7.1 §4's signals now exist

`observability/rollout-metrics.ts` implements every signal in §4, derived entirely from the `AnswerTrace` that already existed — no new instrumentation on the answer path, because a monitoring layer that touches that path can cause the regression it watches for. Both engines record into **one** counter set, which is what makes §3's "within baseline" comparable. §5's abort conditions are **evaluated**, not described.

Two vacuity guards, since gates that cannot fail were this mission's recurring defect: rates are `null` rather than `0` with no data, and `evaluateAbortConditions` returns `insufficientData` below a turn threshold instead of "all clear".

### 7.2 Stage 0 — executed, flag ON, gate passes

`benchmarks/ci-v3-retrieval/stage0-rollout.cjs`, 42 corpus questions through the production retrieval port:

| | |
|---|---|
| turns | 42 (42 v3 / 0 legacy) |
| path split | GROUNDED 39 · FAST 3 |
| contamination | **0.0%** |
| §5 abort conditions | **NONE triggered** |
| evidence text in telemetry | **none** |

**Two signals are structurally 0% and must not be read as proof.** The production port's registry is degenerate by design — one synthetic version, one user scope — so stale-version and out-of-scope rejections *cannot* occur on this configuration. `golden-live` exercises them on a real versioned/scoped registry (7 and 14 turns). `groundedWithNoEvidence` is 50% because the port covers reference files only, so RESUME/JD/MEETING questions correctly find nothing rather than fabricating.

### 7.3 Running Stage 0 found two defects in the monitoring itself

Recorded because both would have produced a green rollout gate over a broken instrument:

1. **Counters were per-bundle.** Self-contained esbuild bundles duplicate the module, so the orchestrator incremented one instance and the IPC read another — production would have reported permanent zeros. Now `globalThis`-backed. Caught only because null-with-no-data meant the run said `insufficientData` over 42 executed turns rather than "0%, green".
2. **Contamination read 45.2% on a clean corpus.** The check compared a type string against `trace.authorizedSources` (objects), and that field is derived *from* the accepted evidence, so the comparison was tautological and could not detect a leak in principle. The trace now carries `plannedSourceTypes`, and the rate's denominator is *checkable* turns so an uninstrumented path reports `null`. Exposed by the contradiction with `golden-live`'s 42/42 — neither number was reported until one was proven wrong.

### 7.4 What Stage 1+ needs from a human

Stages 1–5 are population rollouts: they need real users, and the flag default stays `false` in every environment until someone decides otherwise. The instrument is ready — `context-intelligence:rollout-metrics` returns the live rates and the evaluated abort conditions, so a stage can be gated on measurement rather than on a description of measurement.


---

## 8. Stage 1 — entered 2026-07-30

**The flag is ON for one internal user**, via the persisted opt-in in userData. `DEFAULT_ENABLED` remains `false` in dev, test and production alike — the rule that held through all eleven phases is untouched, and this is an explicit choice layered on top of it.

### 8.1 Entering Stage 1 required a fix, and the defect is the mission's own thesis

The flag's resolution order documented an "explicit persisted setting" from the day it was written. **No caller ever supplied one.** Every call site invoked `isContextIntelligenceV3Enabled()` with no arguments, so `overrides.setting` was permanently `undefined` and the environment variable was the only functioning switch.

That is F1 — a documented path with no caller — living inside the flag module written to end exactly that pattern. It survived every test, because the tests supplied the override the production callers never did.

It surfaced the first time anyone tried to actually opt in, which is the honest answer to "why run a rollout stage at all": an opt-in that requires relaunching the app from a shell with an env var set is not an opt-in, and no amount of reading the file would have revealed that.

### 8.2 How to leave

| Intent | Action |
|---|---|
| Turn it off, keep the choice explicit | `context-intelligence:flag-set` with `{ enabled: false }` |
| Return to the shipped default | `context-intelligence:flag-set` with `{ enabled: null }` — clears to `DEFAULT_ENABLED`, not to "last value" |
| Force off without touching user state | `NATIVELY_CONTEXT_INTELLIGENCE_V3=0` — the env var wins over the persisted choice in both directions |
| Nuclear | delete `~/Library/Application Support/natively/context-intelligence-v3.json` |

Rollback remains a flag flip. Nothing about entering Stage 1 changed that.

### 8.3 The Stage 1 exit criterion, and what to watch

§3's exit is *"no decision divergence on shadow traces for 3 days"*. The instrument for it exists: `context-intelligence:rollout-metrics` returns the live §4 rates and the evaluated §5 abort conditions, and both engines record into one counter set so the comparison is like-for-like.

Read `abort.insufficientData` before reading any rate. Below the turn threshold it reports that instead of "all clear" — the guard that caught the per-bundle counter defect on the very first Stage 0 run.

The three known golden-suite failures (A-03, A-06, F-06) are precision, not safety: across two models the forbidden-claim rate is 0%, over-refusal is 0%, and unsupported-claim disclosure is 100%.


---

## 9. Default-on, 2026-07-30 — a decision, not a measurement

The owner directed that V3 become the main system. Stages 1–4 of §3 were **not** executed; they were skipped. This section says so plainly because §3 otherwise implies these numbers were earned by population rollout, and they were not.

### 9.1 What changed

| | |
|---|---|
| `DEFAULT_ENABLED` | `false` → **`true`** |
| premium gitlink | `a19ecd71` → `c6d46bc2`, so the Answer-policy UI renders (backend was already wired) |
| per-user opt-in file | **removed** — the default now governs, so this machine and a fresh install behave identically |

### 9.2 The F5 rule is intact, and the tests now protect it properly

The rule was never "false". It is that the default resolves **identically in dev, test and production** — F5 is about environment-sensitivity, not about a particular value. One constant, read the same way everywhere, no environment branch above it.

The flag tests had been asserting the literal `false`, which would have made them *fight* the rollout — the delete-the-test-to-ship pressure that quietly erodes an invariant. They now assert environment-invariance against `DEFAULT_ENABLED` itself, so the protection survives a value change instead of being deleted by one.

### 9.3 What is running, and its known limits

Live on all five answer surfaces, with reference-file **and** meeting evidence, the Answer-policy control, and the §4 telemetry recording every turn.

Carried in knowingly:

- **Three golden-suite failures** — A-03, A-06, F-06. Precision, not safety: across two models forbidden-claim 0%, over-refusal 0%, disclosure 100%.
- **`groundedWithNoEvidence` ran 50% in Stage 0.** Expected — the port covers what the mode authorizes, so questions outside it disclose rather than fabricate. Watch it in real use; a *rise* means retrieval is degrading.
- **No population data.** Stage 0 was a 42-question harness. Real traffic has not been observed.

### 9.4 Rollback — still one flip, now three ways

| | |
|---|---|
| Ship it off | `DEFAULT_ENABLED = false` in `contracts/flag.ts` |
| Force off, no code change | `NATIVELY_CONTEXT_INTELLIGENCE_V3=0` — env wins over everything |
| Per-user off | persist `{ "enabled": false }` via `context-intelligence:flag-set` |

The module stayed additive, so none of these is a revert.
