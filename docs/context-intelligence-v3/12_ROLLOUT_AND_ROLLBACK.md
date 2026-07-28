# Phase 10 — Rollout and Rollback

**Status:** PLAN ONLY — nothing enabled, no flag flipped, no telemetry wired.
**Date:** 2026-07-29

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
