# 15 — Final gap-closure review (STT relay migration → 100% production-ready)

**Reviewer:** senior code/security/reliability review (adversarial, last gate before live credentials)
**Scope:** ONLY the four follow-up changes that close the remaining gaps after the main migration
(Phases 0–14, reviewed in docs/12 → APPROVE-WITH-FIXES). The four changes:

1. **F7 atomic quota lease** — `migrations/004_stt_quota_lease.sql` + `server.js` `/v1/stt/session` wiring + `STT_QUOTA_LEASE_ENABLED`.
2. **Control-plane reaper** — `server.js` `STT_REAPER_INTERVAL_MS` / `STT_REAPER_ABANDON_AFTER_SECONDS` loop.
3. **`relay_health_events` write** — `server.js` `onHealthChange` fire-and-forget insert.
4. **Client latency probes** — `electron/audio/relaySession.ts` + `NativelyProSTT.ts` wiring.

---

## VERDICT: **APPROVE**

The new code is genuinely race-free, deploy-safe (server-before-migrations is safe for all four),
PII-clean, and non-blocking on the client. The regression surface is provably additive
(`git diff HEAD server.js` = **677 insertions, 0 deletions**; `/v1/transcribe` byte-for-byte untouched).
**No CRITICAL or HIGH findings.** Five MEDIUM/LOW items are documented below — none block the live test;
each is an observability/robustness polish, not a correctness or safety defect.

**Nothing was changed in this review** — there was nothing CRITICAL/HIGH to fix. All findings are
MEDIUM/LOW and documented for a follow-up, not the live gate.

---

## Findings by dimension (A–H)

### A. Lease atomicity — the whole point of F7 — **PASS (genuinely race-free)**

The advisory lock is taken as the FIRST act (`migrations/004_stt_quota_lease.sql:149`,
`PERFORM pg_advisory_xact_lock(hashtext(v_identity_key))`), BEFORE the idempotency read, the
expiry reclaim, the fresh `already_used` read, the `held` aggregate, and the INSERT. The lock is
**transaction-scoped** (`_xact_`), so via `supabase.rpc()` (each call = its own implicit transaction =
single `SELECT stt_reserve_session(...)`) it is held end-to-end and auto-released at COMMIT/ROLLBACK
(no leak on error).

- **Identity key construction** (`004:140-143`): `stt_lease:trial:<uuid>` / `stt_lease:api_key:<uuid>`.
  Two reserves for the SAME identity build the SAME key → SAME `hashtext` → collide on the lock →
  serialize. Different identities build different keys → (almost always) different hash → run parallel.
- **`hashtext` (32-bit) collisions between UNRELATED identities are harmless.** Confirmed: the lock is
  the ONLY thing keyed on the hash. The `already_used` read and the `held` SUM are filtered by
  `user_id = p_user_id` / `trial_id = p_trial_id` (`004:168-169, 186-187`), NOT by the hash. A hash
  collision causes extra serialization (two unrelated identities briefly take turns) — never quota-bleed.
- **`used + held` can never exceed `limit` under any interleaving.** `available := limit − used − held`
  (`004:190`); `grant := LEAST(requested, available)` with `available <= 0 ⇒ granted:false, no INSERT`
  (`004:193-215`). Because the read-aggregate-then-insert is serialized per identity, a second reserve
  always sees the first's COMMITTED `held` row. **The fuzz test (`stt_quota_lease_logic.test.mjs:141`,
  300 trials × 60 random reserve/release/bill steps) asserts `used + held <= limit` after EVERY step
  for BOTH identities — green.**
- **Idempotent re-reserve is a true no-op** (`004:152-160`): a retried `session-create` with the same
  `session_id` returns the existing row without inserting → never double-counts `held`. (Test #4.)
- **NULL-isolation** confirmed: the identity CHECK (`004:88-90`) forces exactly one of `user_id`/`trial_id`
  set, so a trial row (`user_id IS NULL`) can never match `user_id = p_user_id` (NULL ≠ value), and
  vice-versa. The two identity kinds never bleed into each other's `held` sum.

**Hand-traced concurrency proof (the F7 core):** key with 60s left, used=0.
T0: reserve A and reserve B arrive simultaneously, both compute key `stt_lease:api_key:K`, both call
`pg_advisory_xact_lock(hashtext('stt_lease:api_key:K'))`. → **B blocks** (same lock).
T1: A: no existing row; reclaim (none); `used=0`; `held=0`; `available=60`; `grant=LEAST(60,60)=60`;
INSERT `held` 60s; **COMMIT → lock released**.
T2: B acquires the lock; no existing row; reclaim (none); `used=0`; `held=60` (A's committed,
non-expired row); `available=0`; **`granted:false, quota_exhausted` → no INSERT**.
**Result: aggregate held across the two concurrent sessions = 60, not 120.** The pre-F7 bug
(each session receiving the full 60s snapshot → 4×60=240s billable) is closed. ✅

### B. Lease release correctness — **PASS**

- **Premature release / oversell — NO.** The trigger fires `AFTER UPDATE OF status` only on a
  transition INTO `finalized`/`abandoned` (`004:274-287`, `WHEN NEW.status IN (...) AND OLD IS DISTINCT
  FROM NEW`). `finalized` is set by `stt_finalize_session` (`003:526-527`), which runs at/after the
  relay stops billing. `abandoned` is set ONLY by the reaper (`003:585`), which targets sessions whose
  `updated_at` (last checkpoint) is older than the threshold (`003:570`) — i.e. the relay is gone and
  not billing. A still-active relay keeps `updated_at` fresh and is never reaped. **No path releases a
  reservation while the session is still billing.**
- **Double-release is harmless.** The reaper sets `finalized` (via `stt_finalize_session`, trigger fires
  → release) then immediately overrides to `abandoned` (trigger fires AGAIN → release again). The second
  `stt_release_reservation` finds no still-`held` row → `{released:false}` (`004:248-253`, idempotent).
  Test 6b proves it.
- **Reservation leak if `stt_sessions` row never gets created** (relay died before first flush): the
  reservation has no row to release. It is reclaimed by **(a)** `expires_at` (`created_at + max_session +
  600s`, `004:222`) — the next reserve for that identity reclaims it (`004:164-169`) and `held` excludes
  expired rows (`004:185`); and **(b)** the reaper would never see a non-existent session, so (a) is the
  active backstop here. Acceptable: the worst case is the lease holds for ~`max_session+600s` and then
  self-frees. Confirmed both the expiry reclaim AND the held-sum exclude expired rows (test #5).
- **`stt_release_reservation` is idempotent** (`004:248-253`): only a still-`held` row transitions;
  `ROW_COUNT` drives `released:bool`.

### C. Graceful degradation (deploy-safety) — **PASS**

- **Lease (004 missing, `STT_QUOTA_LEASE_ENABLED` default ON):** `server.js:4590-4602` — `if (leaseErr)
  throw leaseErr` catches function-missing (42883) AND any other supabase error AND a thrown exception,
  all funneled into `catch (leaseErr)` (`server.js:4612-4626`). The catch keeps `leasedQuotaSeconds =
  quotaRemainingSeconds` (the snapshot — never reassigned in the catch; asserted by the test), increments
  a counter, logs **loud-once** (`_sttQuotaLeaseDegradedWarned`), and emits a `quota_lease_degraded`
  `[STTEvent]`. **Session-create returns 200 unchanged.** No 500, no block, no per-request log spam.
  Server-before-004 is safe.
- **Reaper (003 missing):** default OFF (interval 0). If turned on without 003, the first tick detects
  42883/`does not exist`, logs once, `clearInterval`s itself (`server.js:4336-4343`). No spam.
- **Health-event insert (`relay_health_events` table missing → 003 not applied):** the insert is wrapped
  in `try {}` (`server.js:4302`) AND uses `.then(onOk, onErr)` where `onErr = () => {}` swallows the
  rejection (`server.js:4310-4312`). A missing-table error becomes a `console.warn` on the `error` path,
  never a throw into `onHealthChange` → routing is untouched. Confirmed it CANNOT throw into the routing
  path.

### D. Reaper safety — **PASS**

- **Unref'd** (`server.js:4357`, `sttReaperTimer?.unref()`) — never holds the process open.
- **Cleared on shutdown** (`server.js:8303`, inside `gracefulShutdown`) AND on self-disable
  (`server.js:4341`).
- **Self-overlap is harmless.** `stt_reconcile_abandoned` uses `FOR UPDATE SKIP LOCKED` (`003:573`) and
  reuses the idempotent `stt_finalize_session`, so two overlapping ticks (slow RPC) or a control-plane
  tick racing a pg_cron schedule simply skip each other's locked rows → at-most-once per row, no
  double-billing.
- **60s floor** (`server.js:4269`, `Math.max(60_000, …)`) prevents DB hammering. Default 0 = OFF
  (`server.js:4268`) so teams on pg_cron don't run a second racing reaper.

### E. Secret / PII leakage — **PASS**

- Lease RPC args are uuids (`p_user_id`/`p_trial_id`) + plan + integer seconds — no raw key/token.
- `quota_lease_degraded` event logs `user_hash: hashIdentity(identity)` (sha256-prefix,
  `packages/stt-relay-core/src/safeLog.js:32`), `auth_type`, a counter, and a 120-char error slice —
  no secrets.
- `relay_health_events` row: `relay_id`, `region`, `healthy`, `latency_ms`, `source` — no token/key/IP.
  The reaper logs a count + ISO timestamp. The `[STTSession] issued …` log carries only the sha256
  identity hash. The client probes hit `/healthz` (no auth, no secrets) and record only an integer ms.
- Probe cache is bounded by construction (exactly 2 regions: `us`, `asia`).

### F. Client latency probes — non-blocking guarantee — **PASS**

- `getRelayLatencyProbes()` is called synchronously in the `resolveRelaySession` options literal
  (`NativelyProSTT.ts:843`). It **cannot throw synchronously**: it reads `_probeCache`, optionally kicks a
  fire-and-forget `refreshRelayLatencyProbes(...).then(()=>{}, ()=>{}).finally(...)` (both rejection and
  fulfillment handled → **no unhandledRejection**), and returns the cache or `null`. The **first call
  returns `null` immediately** (cache empty) and the result lands for NEXT time — never on the connect
  path (test: "first call returns null (non-blocking)").
- The `AbortController` timeout (`PROBE_TIMEOUT_MS = 1500`) is cleared in a `finally` (`relaySession.ts`
  probe loop), so the timer is always cleaned up; a dead/wrong host just omits that region (server falls
  back to geo routing). 1500ms is fully OFF the connect path.
- Hardcoded hosts `us-relay.natively.software` / `asia-relay.natively.software` + `/healthz` **match
  `docs/10-deploy-regional-relays.md`** (line 174: `curl https://us-relay.natively.software/healthz`).
- The probe data flows correctly to the server: `getRelayLatencyProbes()` → `opts.latencyProbes`
  (`relaySession.ts:81`) → POST body `latency_probes` (`relaySession.ts:122`) → server `body.latency_probes`
  → `selectRelay({ latencyProbes })` (`server.js:4537-4539`), honored only when
  `STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES` is on. Keys (`us`/`asia`) match the server regions.

### G. Token budget correctness — **PASS**

`server.js:4608-4610` sets `leasedQuotaSeconds = Math.max(0, Math.floor(lease.granted_seconds))` (the
LEASE), not the snapshot, and that value goes into BOTH the token claim
`quota_remaining_seconds: leasedQuotaSeconds` (`server.js:4648`) AND the response
`quota_remaining: leasedQuotaSeconds` (`server.js:4719`). So a 40s grant of a 60s request → the relay
watchdog cuts at 40s. When degraded/disabled/railway, `leasedQuotaSeconds` stays the snapshot
(`server.js:4587`). Verified by source tests + the integration test asserting
`v.claims.quota_remaining_seconds === body.quota_remaining`.

### H. Regression — **PASS**

- `git diff HEAD server.js` = **677 insertions, 0 deletions** (3 hunks: imports +9; the whole STT block
  inserted after the calendar-refresh handler, +672; the gracefulShutdown clear, +2). **No deletions,
  no edits to existing lines.**
- `/v1/transcribe` WS handler is at `server.js:4873`, OUTSIDE the additive block (ends ~4855) — byte-for-
  byte untouched (also asserted by the existing endpoint suites that still pass unchanged).
- Env safe-defaults: `STT_QUOTA_LEASE_ENABLED` default ON but degrades safely; `STT_REAPER_INTERVAL_MS`
  default 0 (OFF); `STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES` default ON but advisory-only;
  `STT_RELAY_ENABLE_PERCENT` default 0 ⇒ **no relay traffic unless explicitly enabled. Nothing forces the
  relay path on.**

---

## F7 — now truly closed? **YES.**

Migration 003 owned the POST-reservation truth (`billed_seconds`, exactly-once reconcile) but
deliberately did NOT own the lease (TOCTOU). Migration 004 is that missing half: a shared per-identity
`held`-seconds ledger, mutated atomically at session-create under a per-identity transaction-scoped
advisory lock, released by a trigger on the `stt_sessions` terminal-status transition and backstopped by
both `expires_at` and the reaper. The hand-traced proof in **§A** shows the aggregate held across N
concurrent sessions on one credential can never exceed the limit, and the 300-trial fuzz invariant
(`used + held <= limit` after every step) holds. **F7 (quota TOCTOU) is genuinely resolved.**

**One honesty caveat (documented, not blocking):** the proof rests on a model-based test
(`quotaLeaseReferenceModel.mjs`) that mirrors the SQL — it is NOT a live-Postgres integration test. The
*logic* is proven; a divergence between the JS model and the deployed PL/pgSQL would not be caught here.
The SQL was additionally hand-audited for the SQL-only hazards the model can't express (advisory-lock
overload resolution, `AFTER UPDATE OF status` firing on both terminal paths, the identity CHECK +
NULL-isolation, `int`-typed `billed_seconds` matching the trigger signature) — all correct. The live-DB
integration test remains the documented MANUAL post-deploy step (needs SUPABASE creds; docs/06). **This
is the single residual verification gap before/at the live test — see MEDIUM-1.**

---

## Deploy-safety matrix

| Feature | Requires migration | If migration MISSING (server already deployed) | Default |
|---|---|---|---|
| **F7 quota lease** (`stt_reserve_session`) | **004** | `stt_reserve_session` 42883/any error → caught → **degrade to snapshot quota**, loud-once log + `quota_lease_degraded` event, **session-create still 200**. Pre-004 behavior. | **ON** (degrades safely) |
| **Release trigger** (`stt_release_on_finalize`) | **004** | Trigger doesn't exist → finalize/abandon behave exactly as in 003 (no release attempted). No reservation rows exist anyway (lease degraded). Consistent. | n/a |
| **Control-plane reaper** (`stt_reconcile_abandoned`) | **003** | First tick 42883 → log once → `clearInterval` self-disable. No spam, no throw. | **OFF** (interval 0) |
| **`relay_health_events` insert** | **003** (table) | Insert error → swallowed by `.then(_, ()=>{})` inside `try{}` → `console.warn` only. **Routing untouched.** | always (best-effort) |
| **Client latency probes** | none | Probe to a host that doesn't resolve → region omitted → server falls back to geo routing. No user-visible delay (off the connect path, 1500ms cap). | **ON** (advisory) |

**Server-before-migrations is SAFE for all four.** Recommended apply order for full functionality:
**003 first, then 004** (004's trigger sits on the 003 `stt_sessions` table; 004's reclaim/release path is
the lease's primary path and complements the 003 reaper). Both migrations are idempotent (CREATE … IF NOT
EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS) and safe to re-run.

---

## MEDIUM / LOW findings (documented — none block the live test)

**[MEDIUM-1] `migrations/004` — no live-Postgres integration test; correctness proven only against a JS
reference model.** *Risk:* a divergence between `quotaLeaseReferenceModel.mjs` and the deployed PL/pgSQL
(e.g. an advisory-lock overload surprise, a NULL-comparison quirk, a trigger-firing edge) would pass CI
yet ship a bug. The SQL-only hazards were hand-audited and are correct, but that is reviewer judgment, not
an executed test. *Fix:* before or immediately at the live gate, run the lease against the real DB with
two concurrent `stt_reserve_session` calls for one identity (creds available at live test) and assert the
second is `granted:false` / partial — the documented MANUAL step in docs/06. This is the one residual
verification gap.

**[MEDIUM-2] Idempotent re-reserve returns an expired-but-still-`held` row as `granted:true`.**
`server.js`/`004:152-160`: the idempotency branch returns `granted: (status='held')` and
`granted_seconds` WITHOUT checking `expires_at`. If a session-create is retried AFTER the reservation's
TTL has lapsed but BEFORE any reclaim ran on it, the retry returns the old grant as still-granted even
though the live `held` sum no longer counts it. *Risk:* low and transient — re-reserve only happens on a
control-plane retry of the SAME `session_id`, the TTL is `max_session + 600s` (≥4h10m here), and the relay
watchdog still bounds the session to the returned grant; the only effect is that a stale retry may report
a grant the aggregate ledger has already written off. No oversell of OTHER sessions (their `held` excludes
the expired row). *Fix (optional):* in the idempotency branch, treat `status='held' AND expires_at <
now()` as not-granted (or fall through to recompute). The reference model mirrors the current behavior, so
update both together.

**[LOW-1] Reaper `tgAlert` dedup is defeated by the variable batch count.** `server.js:4350`:
`tgAlert(\`⚠️ STT reaper finalized ${reconciled} abandoned session(s)…\`)`. The default dedup key is the
first 80 chars of the message, which include the variable count — so `finalized 5` vs `finalized 7` are
distinct keys and can each alert within the window. Bounded by `TG_DEDUP_MAX` and the ≥60s reaper
interval, so not a real spam vector, but noisy under a sustained incident. *Fix:* pass a stable dedup key,
e.g. `tgAlert(msg, 'stt_reaper_batch')`.

**[LOW-2] Client probe hosts are hardcoded and can drift from env-configured relay URLs.**
`relaySession.ts` `RELAY_HEALTH_URLS` hardcodes `us-/asia-relay.natively.software`. If a deployment
configures different relay hostnames via `STT_RELAY_US_URL`/`STT_RELAY_ASIA_URL`, the client probes the
wrong hosts → probes fail → server falls back to geo routing. *Risk:* none to correctness (probes are
advisory; the server-returned `relay_ws_url` is authoritative) — only a lost latency hint. They currently
match `docs/10`. *Fix (optional):* derive probe hosts from the relay list returned by `GET /v1/stt/relays`
(the `deriveHealthUrl` helper already exists for exactly this) instead of hardcoding.

**[LOW-3] `relay_health_events.source` value mismatch with the column comment.** `server.js:4309` writes
`source: 'control_plane'`; the 003 column comment lists `'active_probe' | 'passive_client_report'`. The
column is free `text` (no CHECK) so it's accepted, but the analytics vocabulary is now three-valued.
*Fix:* align the comment, or use `'active_probe'` (this insert fires from the active health tracker).

---

## What was FIXED vs documented

- **FIXED:** nothing — there was no CRITICAL/HIGH defect to fix. The code is correct and safe as written.
- **DOCUMENTED:** MEDIUM-1 (live-DB integration test is the residual gap), MEDIUM-2 (expired-idempotent
  edge), LOW-1 (reaper alert dedup), LOW-2 (hardcoded probe hosts), LOW-3 (source-value vocabulary).

---

## Final test results (REAL, this review)

```
node --check server.js                                   → OK (syntax valid)

node --test migrations/__tests__/*.test.mjs              → tests 25  pass 25  fail 0
  (includes the F7 fuzz invariant: used+held <= limit over 300×60 random steps)

node --test tests/stt-session-endpoint.test.mjs \
            tests/stt-relays-routes.test.mjs \
            tests/stt-quota-lease.test.mjs \
            tests/stt-reaper-health-events.test.mjs       → tests 64  pass 64  fail 0  skipped 0

# client (desktop app):
npm run typecheck:electron                                → clean (tsc --noEmit, 0 errors)
npm run build:electron                                    → Done in ~1.3s
node --test electron/audio/__tests__/Relay*.test.mjs      → tests 49  pass 49  fail 0
```

**Total: 138 tests, 138 pass, 0 fail, 0 skipped. Typecheck clean. Build clean. Syntax valid.**

---

## Merge recommendation

**APPROVE.** The four gap-closure changes are correct, race-free, deploy-safe (server-before-migrations
safe for all four), PII-clean, non-blocking on the client, and provably additive with `/v1/transcribe`
untouched. Proceed to live testing. Carry MEDIUM-1 (run the two-concurrent-reserve check against the real
DB at the live gate — creds become available there) as the one verification still owed.

### Post-review polish (applied)

Two of the documented robustness items were fixed immediately after the review (additive, re-verified green):

- **MEDIUM-2 — expired-but-held re-reserve:** `stt_reserve_session`'s idempotent branch
  (`migrations/004_stt_quota_lease.sql` §2) now reports `granted` only when the existing lease is
  `held` **AND** `expires_at >= now()` (was: `held` alone), with an `expired` flag in the return. The JS
  reference model (`quotaLeaseReferenceModel.mjs`) mirrors the guard so the fuzz + idempotency tests cover
  it. A retry of a session whose lease has aged out can no longer report a stale budget.
- **LOW-1 — reaper alert dedup:** the batch-reconcile `tgAlert` now passes a stable explicit dedup key
  (`'stt_reaper_batch'`) instead of relying on the message text (which embedded the variable count and
  would have defeated coalescing). Alert storms during a relay incident now collapse to one + a summary.

LOW-2 (hardcoded probe hosts — advisory-only) and LOW-3 (health-event `source` vocabulary — free-text
column) are left as documented, no behavioral impact. Re-verified after the polish:
migrations 25/25, control-plane STT suites 64/64, core 277/277, relay 106/106, client 49/49,
`node --check server.js` OK, typecheck + build clean — **577/577, 0 fail.**
