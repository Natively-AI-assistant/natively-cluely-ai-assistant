# Phase 12 — Final Code/Security/Reliability Review (STT Relay Migration)

**Date:** 2026-06-13
**Reviewer:** Independent final reviewer (adversarial pass before rollout)
**Scope:** Everything built in Phases 2–11 — `packages/stt-relay-core/src/*`, `services/stt-relay/src/*`,
`migrations/003_stt_durable_billing.sql`, the additive `server.js` Phase 3/4/8 block, and the Electron
client (`relaySession.ts` + `NativelyProSTT.ts` + flags).
**Method:** read every new/modified source file in full; `git diff HEAD -- server.js` (540 insertions,
**0 deletions** — `/v1/transcribe` provably untouched); traced the billing chain end-to-end; ran all
test suites before and after fixes.

---

## Executive verdict

> **APPROVE-WITH-FIXES.**
>
> One **CRITICAL** billing-bypass defect was found in the new (uncommitted, additive) code and **FIXED
> immediately** with tests added to lock it in. With that fix applied, the migration's security and
> reliability claims hold: token security is sound, secret redaction is complete, crash isolation is
> real, every session exit path cleans up, and the durable-billing idempotency model is correct. The
> remaining findings are MEDIUM/LOW and are safe to ship as documented follow-ups.
>
> **The CRITICAL fix is mandatory before any rollout above 0% (it is already applied here).** Without
> it, 100% of relay-path sessions would have failed to bill (silent revenue loss).

**Findings by severity:** 1 CRITICAL (FIXED), 0 HIGH, 4 MEDIUM (documented), 5 LOW (documented).

**Tests after fixes:** core **277/277**, relay service **106/106**, API stt endpoint+routes **38/38**,
migration billing logic **15/15**, `node --check server.js` **OK**. (436 automated tests green.)

---

## F1–F20 verification table

Each pre-migration finding (`docs/00b`) → is it actually fixed in the new code, where, and the evidence.

| # | Sev | Title | Fixed? | Where | Evidence |
|---|-----|-------|--------|-------|----------|
| F1 | CRIT | Raw API key in session id → ~88 logs/alerts | ✅ | `safeLog.js` `makeSessionId`/`hashIdentity`; session.js `sk = makeSessionId(sub,channel)` | Session id is `sha256(sub):channel`; raw key never enters a relay log. Grep of all new code: no key/secret/token interpolation into any log/response/telemetry string. |
| F2 | CRIT | mic/system close-order double-bill (in-mem) | ✅ | migration `stt_finalize_session` §6 `tstzrange` overlap query | DB-side overlap against BILLED system/default sessions of same identity; survives any close order; `migrations/__tests__` invariants pass. |
| F3 | HIGH | mic guard bypassable via <30s heartbeat | ✅ | migration §6 `o.billed_seconds > 0` predicate | A free (<30s) system session has `billed_seconds=0` → never counts as cover. |
| F4 | CRIT(cost) | Google rolling 16× re-send amplification | ✅ (deviation) | `googleRollingSession.js` (core), F14 ingress clamps | Incremental-suffix submission in the core rolling session; ingress normalized to 16k mono (F14). |
| F5 | HIGH | bill-only-at-close crash loss (≤4h) | ✅ | `usageStore.flushSession` + migration `stt_flush_usage` (30–60s) + `stt_reconcile_abandoned` reaper | Incremental idempotent checkpoints; loss window ≤ one flush interval; reaper finalizes relay-killed sessions. |
| F6 | HIGH | silent/non-idempotent/uncapped writes; missing migration | ✅ | migration 003 (all RPCs + re-exported `increment_transcription_minutes`); `usageStore` retry + alerts | Idempotent on `(session_id, seq)`/status; trial 600s cap in-RPC; never silent (retry queue + `usage_*_failed` Axiom events). |
| F7 | HIGH | quota TOCTOU across concurrent sessions | ✅ **RESOLVED** | atomic lease `stt_reserve_session` in `migrations/004_stt_quota_lease.sql` + `/v1/stt/session` wiring | Session-create reserves the granted budget from a SHARED per-identity counter (`available = limit − used − held`, serialized via `pg_advisory_xact_lock`); the token's `quota_remaining_seconds` is the LEASE, so N concurrent sessions share the budget instead of each spending the full snapshot. Released by a trigger on `stt_sessions` status→finalized/abandoned + a TTL backstop. Gracefully degrades to the snapshot if the RPC is missing (server-before-migration-004 safe). See docs/06 §11. |
| F8 | HIGH | `getIP` Railway-coupled trust order | ✅ | relay `server.js extractIp` + `config.TRUST_PROXY_HEADER` (default `''` = socket address) | Default = raw socket addr; a single configured header is trusted only when set. Railway `x-envoy-external-address` default deliberately NOT ported. |
| F9 | MED | transcript text + raw IPs at info | ✅ | `logger.js` (transcript gated on `LOG_TRANSCRIPTS`, 80-char truncate; `hashIP`) | `telemetry-redaction.test.mjs` proves transcript/IP/secret never reach logs/Axiom/Sentry. |
| F10 | MED | no provider-socket backpressure bound | ✅ | `backpressure.checkProviderBuffer` + session.processChunk (drop@cap, kill@4×) | Cap-then-shed-then-kill before every provider forward; `PROVIDER_BUFFER_CAP_BYTES` configurable. |
| F11 | MED | replay double-counts billing + dup transcripts | ✅ | session.js `billingSuppressUntil` watermark + `suppressBillingForReplay` | Deepgram-duration billing suppressed for a window == replayed duration after each failover/reconnect. |
| F12 | MED | session map leaks on rejection paths | ✅ | session.js `cleanup()` (idempotent, every exit path) + `sessionRegistry.remove` (socket-identity guarded) | Every exit path (auth timeout/reject/mismatch/bandwidth/no-providers/byte-budget/duration/quota/close/all-down/takeover/shutdown) clears timers, removes registry+IP. |
| F13 | MED | probes survive across failover | ✅ | session.js `switchToFallback` tears down handle + silenceTimer BEFORE switch; no dual side-streams | Shadow probes replaced by a single silence watchdog (no side-streams to leak). |
| F14 | MED | accepts 48k stereo end-to-end | ✅ | session.js bandwidth reject/down-negotiate vs token `max_*` claims AND `ALLOW_48KHZ`/`ALLOW_STEREO` (default 16k mono) | `REJECT_HIGH_BANDWIDTH_AUDIO` default true; clamps echoed back. |
| F15 | MED | shared failure domain (STT + payments/AI) | ✅ | separate relay process; `index.js` `uncaughtException` drains+exits **only the relay**; `unhandledRejection` does NOT exit; per-session try/catch in `onMessage` | Control plane and relay are now distinct processes; one session's throw is caught and reported. |
| F16 | LOW | auth-frame `channel` unvalidated (log injection) | ✅ | `validate.validateChannel` whitelist `{system,mic,default}`; relay enforces token channel == frame channel | Junk channel → `default`; mismatch → fatal `channel_mismatch`. |
| F17 | LOW | DG connect-timeout strikes pool after close | ✅ | adapter `isAlive: () => authed && !cleanedUp` guard passed into provider ctx | Timer bodies guard on liveness. |
| F18 | LOW | trial last-resort billing RMW race | ✅ | migration trial path is a single atomic `LEAST(used+delta,600)` UPDATE inside the locked RPC | No fallback ladder; one atomic path. |
| F19 | LOW | client reconnect flush burst | ✅ | preserved client dampers + relay `MAX_RECONNECTS_PER_SESSION` + per-identity cap | Reconnect budget enforced on the takeover key. |
| F20 | LOW | global WS ceiling counts handshakes; per-IP 5 tight | ✅ (partial) | relay `MAX_CONCURRENT_WS`/`MAX_WS_PER_IP` (configurable) + per-identity cap + `/64` IPv6 bucket | Pre-auth and post-auth share the per-IP counter (server.js parity); tunable per relay. The "separate pre-auth budget" refinement is not implemented but the cap is configurable (LOW-5). |

**Coverage: 20/20 fully verified fixed. F7 was a documented gap (lease deferred to Phase 7); it is now
RESOLVED via the `stt_reserve_session` atomic quota lease (`migrations/004_stt_quota_lease.sql`), which
lifts the docs/13 §12 25% STOP gate. See docs/06 §11 + MEDIUM-1 (resolved) below.**

---

## Findings (grouped by dimension A–J)

### A. Secret leakage

**[CRITICAL — FIXED] `services/stt-relay/src/session.js:450` + `server.js:4501` — relay billing rows never carry the durable account UUID → 100% billing bypass on the relay path.**
*(Filed under D as the billing impact, but the root cause is an identity-claim defect; full detail in D-1.)*

No secret-leakage defects found. Verified by exhaustive grep of every new log/telemetry/response site:
- `STT_SESSION_TOKEN_SECRET`, `SUPABASE_SERVICE_KEY`, `DEEPGRAM_API_KEY*`, `ELEVENLABS_API_KEY*`,
  `GOOGLE_CREDENTIALS` never reach a log, response, or client message.
- `AXIOM_TOKEN` appears only in the `Authorization: Bearer` header (ingest credential, not user data),
  never in a body.
- `safeLog.hashIdentity`/`hashIP` are applied at every sensitive site; `logger.js` has a
  `SECRET_KEY_RE` backstop that redacts any field keyed `*token*/*key*/*secret*/authorization/...`.
- The control-plane issue log (`server.js:4521`) and the `[STTEvent]` drain logs carry only the hashed
  `sub`, region, reason, bucket, channel — never the token or credentials.
- The new `sub_id` claim (the durable UUID, added by the fix) is **not** PII-sensitive in the secret
  sense (it is the same internal id the legacy path already uses for billing), is **never logged**, and
  is stripped from Axiom by `session.js telemetryRow()` (which substitutes `user_hash`). Confirmed it is
  not matched by `SECRET_KEY_RE` and never interpolated into a log string.

### B. Token security

No defects. `sessionToken.verifySessionToken` is correct:
- `timingSafeEqual` with an explicit **length pre-guard** (`expBuf.length === recBuf.length`) before the
  compare; the `try/catch` is belt-and-suspenders and stays closed.
- **Signature is verified before the payload JSON is parsed/trusted** — no unauthenticated `JSON.parse`
  result is ever used.
- HMAC covers the **`v1.` version prefix** (`hmacSig` updates `` `${TOKEN_PREFIX}.${payloadB64}` ``), so a
  token cannot be re-versioned without re-signing; a `v2.` token → `bad_version`, not silent acceptance.
- Empty/null/short signature → `malformed`/`bad_signature` (an empty sig fails the length guard).
- Strict expiry (`now >= exp` → expired, zero grace); `iat` future-skew tolerated ±30s only.
- Rotation (`prevSecret`) tries at most two secrets and only widens the window for the OLD secret during
  the documented ≤300s drain — correct and bounded.

### C. Token replay / session hijack

No defects. `createJtiCache.checkAndStore` is memory-bounded (`maxEntries`, sweep-then-evict-oldest),
TTL = token `exp`, empty/non-string jti never fresh. A captured token:
- is single-admission per relay (jti), and
- is bound to ONE region (the relay verifies `expectedRegion: config.REGION` → a `region=us` token on
  the asia relay is `wrong_region`). The jti lives on that one region's relay, so cross-region replay is
  impossible. **A us token cannot be replayed on asia. Confirmed.**

The quota-snapshot-replay concern is the F7 gap (MEDIUM-1), not a token defect: the token's
`quota_remaining_seconds` is a snapshot; within its ≤300s TTL the same identity can open N sessions each
seeing the same budget. Bounded by the per-session watchdog + the DB reaper; documented & accepted.

### D. Billing bypass / double-billing

**[CRITICAL — FIXED] `services/stt-relay/src/session.js:450-452` + `server.js` token claims — relay billing rows carried no valid `user_id`/`trial_id`, so every relay-path flush/finalize would fail the `stt_sessions` identity CHECK (or `::uuid` cast) → 100% silent billing loss on the relay path.**

- **Risk:** The token signs `auth_type: 'api_key'` (server.js) and `sub: hashIdentity(identity)` (a 16-hex
  hash) — it did **not** carry the durable account UUID at all. `snapshotRow` then (a) compared
  `claims.auth_type === 'key'` which **never matches** `'api_key'` → `user_id` always null, and (b) even
  on the trial branch set `trial_id` from `claims.sub_id`, which `handleAuthFrame` had derived as
  `claims.sub_id || claims.sub` = the **hash**, not a UUID. Net result for every relay session:
  `user_id` and `trial_id` both null/invalid → the migration-003 `stt_sessions_identity_chk`
  (`(user_id IS NOT NULL)::int + (trial_id IS NOT NULL)::int = 1`) fails (or the `NULLIF(...)::uuid` cast
  throws) → `stt_flush_usage`/`stt_finalize_session` error on **every** call → no usage ever applied to
  `api_keys`/`free_trials`. The entire migration's billing chain was inert on the relay path. The
  existing tests masked it: `_helpers.buildToken` used the **wrong** `auth_type: 'key'` and the usageStore
  tests injected `user_id` directly, so the broken derivation was never exercised.
- **Fix (applied):**
  1. `server.js` (additive endpoint): added a `sub_id` claim carrying the real durable UUID —
     `auth.isTrial ? auth.trial.id : auth.user.id`. `sub` stays the hash (F1).
  2. `session.js snapshotRow`: compare `claims.auth_type === 'api_key'` (the production value) and read
     `user_id`/`trial_id` from `claims.sub_id`.
  3. `session.js handleAuthFrame`: removed the `claims.sub_id || claims.sub` hash fallback — a token
     missing `sub_id` now leaves `user_id`/`trial_id` null (caught loudly by the RPC) rather than
     silently billing a non-existent account.
  4. Tests: `_helpers.buildToken` now mirrors production (`auth_type: 'api_key'` + a real-shaped
     `sub_id` UUID); `telemetry-fields`/`token-gate` assertions aligned to `'api_key'`; a **regression
     guard** added to `billing.test.mjs` asserting the finalize row carries the UUID and `auth_type`.
- **Verification:** relay suite **106/106** green after the fix (was masking-green before).

Other billing dimensions verified correct (no defects):
- **F2/F3 (mic/system pairing):** DB `tstzrange` overlap against BILLED system/default sessions; cannot
  double-refund (refund sets `billed_seconds=0` AND `status='finalized'` → a second finalize hits the
  `already_finalized` guard). The overlap query cannot "miss" on close order — the system row carries
  `ended_at`+`billed_seconds` by mic finalize time.
- **F6 idempotency:** replaying a flush `seq` → `stale_seq` no-op; finalizing twice → `already_finalized`;
  monotonic `GREATEST` merge; journal `UNIQUE(session_id, seq, event_type)`. `FOR UPDATE` serializes
  concurrent same-session ops. Finalize cannot be raced into a double-apply.
- **Delta math:** telescoping `round(billable/60) − round(billed/60)` proven == old one-shot total across
  the migration reference-model tests (15/15).

### E. Reliability / resource leaks

No defects. Every session exit path runs the idempotent `cleanup()` (clears authTimer/pingTimer/
flushTimer/durationTimer/silenceTimer, empties authQueue/preBuffer, closes handle, `registry.remove` +
`registry.releaseIp`). `reserveIp` is called only AFTER the cap checks and immediately before
`createSession`, with no early-return between — so IP accounting is balanced. All four timers + the
health-check interval + the usage-flush drain interval + the relay sweep + the control-plane rollup
timer are `unref()`'d. Backpressure is bounded on both client side (`shouldDropInterim`) and provider
side (`checkProviderBuffer` drop/kill). A slow client cannot OOM the relay (1MB transport cap + 64KB app
cap + provider-buffer kill@4×). See LOW-1 for the one cosmetic timer-cleanup nit.

### F. Crash isolation (F15)

No defects. Relay and control plane are **separate processes** (confirmed: `services/stt-relay/src/index.js`
is its own entrypoint with its own `app.listen`). `uncaughtException` drains + `exit(1)` only the relay;
`unhandledRejection` logs + reports but does NOT exit. `onMessage`/`onClose`/socket-`error` are each
wrapped in per-session try/catch that reports and cleans up without touching other sessions.

### G. Supabase failure behavior

No defects. `usageStore` is fire-and-forget — `flushSession`/`finalizeSession` never throw into session.js
(double-guarded: the store's own `.catch` + session.js's `try/catch` around the calls). Retries
1s/5s/15s, then parks in a bounded (500) drop-oldest retry queue with a **loud** `usage.retry_queue_overflow`
error + `usage_retry_dropped` Axiom event (never silent). RPC-missing degrades to a direct `stt_sessions`
upsert (logged once). A Supabase outage never blocks the audio path or stalls a session — billing is
best-effort-durable and reconciled by the reaper. The retry-drain splices-then-re-enqueues failures
(can reorder, never loses); the RPCs are order-independent (`GREATEST`/`last_seq`), so reorder is benign.

### H. Control-plane admin routes

No defects. `/admin/stt-relays` (GET) and `/admin/stt-relays/control` (POST) both gate on
`checkAdminSecret` — which hashes both sides to fixed-length SHA-256 digests before `timingSafeEqual`
(no length-leak) and returns **false when `ADMIN_SECRET` is unset** (fail-closed, cannot be hit without
the secret). Input validation is strict: `kill_switch` must be boolean, `force_region ∈ {us,asia,null}`,
`enable_percent` finite 0–100. The inspection route exposes the relay **URLs** (admin-appropriate) and
rollout knobs but **never** the session-token secret or provider keys. Every effective change is logged
+ Telegram-alerted (audit trail). Runtime overrides are intentionally non-persistent (restart → env).

### I. DNS / TLS / proxy

No defects. Relay `extractIp` defaults to the **raw socket address**; a single configured
`TRUST_PROXY_HEADER` is honored only when set (F8). With no trusted proxy configured, per-IP limits
cannot be bypassed by spoofing `X-Forwarded-For` (the header is simply ignored). IPv6 is bucketed to
`/64` so rotating the low 64 bits can't bypass the per-IP cap. The control-plane health tracker derives
`https://host/healthz` from the `wss://` URL and probes with `redirect: 'manual'` + an unref'd
AbortController timeout — no open-redirect or probe-storm surface (concurrent probes coalesce).

### J. Migration safety

No defects. `/v1/transcribe` is provably untouched (`git diff HEAD -- server.js` = **540 insertions, 0
deletions**; all `validateKey`/`validateTrial` references are inside the new endpoint). All new env vars
safe-default to OFF/inert: relay disabled at `STT_RELAY_ENABLE_PERCENT=0` (everyone → Railway), kill
switch default off, Railway fallback always present, missing token secret → endpoint 503s without
crashing the API. Deploy-in-isolation is safe in every order:
- Migration 003 applied but relay not deployed → no caller; harmless.
- Relay deployed but migration not applied → `usageStore` gets RPC-missing, logs once, falls back to a
  direct `stt_sessions` upsert (forward-compatible). **Caveat:** that fallback table won't exist until
  the migration is applied, so the fallback upsert would itself error and park in the retry queue — usage
  is buffered, not lost, and applies once the migration lands within the retry window. Acceptable; see
  MEDIUM-3.
- Client flag default OFF → `maybeResolveRelayTarget` returns false synchronously and the resolver is
  never constructed; the flag-off path is byte-for-byte the legacy direct-Railway behavior.

---

## MEDIUM / LOW findings (documented — recommendations, not blockers)

**[MEDIUM-1] F7 quota TOCTOU — RESOLVED.** ~~`quota_remaining_seconds` is a ≤30s-stale snapshot; N
concurrent sessions on one key can each spend the full snapshot.~~ Closed by the atomic quota lease in
`migrations/004_stt_quota_lease.sql` (`stt_reserve_session`): session-create reserves the granted budget
from a SHARED per-identity counter (`available = limit − fresh_used − held`, serialized per identity via
`pg_advisory_xact_lock` so the read-aggregate-then-insert is atomic across not-yet-existing rows — a
row-level `FOR UPDATE` cannot do this), and the token carries the LEASE, not the snapshot. The hold is
released by a trigger on `stt_sessions` (status→finalized/abandoned) with a TTL + reaper backstop. The
control plane degrades gracefully to the snapshot if the RPC is unavailable, so the server can deploy
before the migration. This lifts the docs/13 §12 **25% STOP gate** (the ramp can proceed to 100% once
migration 004 is live). Full design + reserve/release/finalize flow + tests: `docs/06 §11`.

**[MEDIUM-2] `auth_type` literal drift was latent across the test suite.** The whole relay test suite was
written against `auth_type: 'key'` while production signs `'api_key'`. *Risk:* future contributors may
re-introduce the mismatch. *Fix applied:* helper + assertions aligned to `'api_key'` and a positive
`user_id` regression guard added. *Recommendation:* consider a single shared constant for the auth-type
string across server.js, session.js, and the migration to prevent re-drift.

**[MEDIUM-3] RPC-missing fallback upserts to a table the migration creates.** If the relay deploys before
migration 003 is applied, the RPC-missing path falls back to `stt_sessions.upsert`, but that table won't
exist yet → the upsert errors and parks in the retry queue. *Risk:* usage is buffered (≤500 items) and
only applies once the migration lands; a long delay could overflow the queue and drop-oldest. *Fix:* apply
migration 003 **before** deploying the relay (the README/runbook should state this ordering explicitly).

**[MEDIUM-4] The reaper must actually be scheduled.** `stt_reconcile_abandoned` exists but the pg_cron
block is commented out and the control-plane scheduled call is not wired in this diff. *Risk:* without a
scheduler, F5's "reaper catches abandoned sessions" guarantee doesn't hold — a relay SIGKILL leaves the
session `active` forever and its last unbilled tail is never applied. *Recommendation:* enable pg_cron (or
wire the control-plane 60s sweep to call the RPC) as a **rollout prerequisite**.

**[LOW-1] `_sttRollupTimer` (server.js) is not cleared on shutdown.** It is `unref()`'d so it never holds
the process open, but unlike `sttRelayHealthTracker.stopBackgroundChecks()` it isn't stopped in the
shutdown path. *Fix:* add `clearInterval(_sttRollupTimer)` alongside the health-tracker stop. Cosmetic.

**[LOW-2] `peekAuthType` parses an unverified token** (only for the `trial_expired` error mapping). It is
wrapped in try/catch and used solely to choose between two fatal error strings — no security impact. Note
only.

**[LOW-3] `directUpsert` fallback omits `bytes_out_*` columns** present in the RPC payload. Cost-accounting
fidelity is slightly reduced in the degraded path. Acceptable (the degraded path is rare and billing
seconds are preserved).

**[LOW-4] PostHog `posthogCapture` is fire-and-forget with no queue bound** (unlike Axiom/Sentry). A
PostHog outage can't OOM (each call is a single un-awaited fetch), but failures are silently swallowed.
Acceptable.

**[LOW-5] Per-IP pre-auth budget is shared with post-auth** (server.js parity). F20's "separate pre-auth
budget" refinement is not implemented; the caps are configurable per relay, which is sufficient for
launch. Note only.

---

## Must-fix-before-rollout vs follow-up

### Must-fix before rollout
1. **CRITICAL billing-bypass (D-1) — DONE in this review.** Verified green. *Re-run the relay suite in CI
   to confirm the regression guard is wired.*
2. **Apply migration 003 BEFORE deploying the relay** (MEDIUM-3 ordering).
3. **Schedule the reaper** (pg_cron or control-plane call) before relying on F5 (MEDIUM-4).

### Follow-up (can ship at low rollout %, land before high %)
- ~~F7 atomic quota lease `stt_reserve_session` (MEDIUM-1).~~ **DONE** — `migrations/004_stt_quota_lease.sql`; lifts the 25% STOP gate (docs/13 §12). See docs/06 §11.
- Shared auth-type constant to prevent literal drift (MEDIUM-2).
- `clearInterval(_sttRollupTimer)` on shutdown (LOW-1).
- Degraded-path `bytes_out_*` parity (LOW-3); separate pre-auth IP budget (LOW-5).

---

## Changes made during this review (all in NEW, uncommitted, additive code)

| File | Change |
|---|---|
| `server.js` (additive endpoint) | Added `sub_id` claim = durable account UUID (`auth.trial.id`/`auth.user.id`). |
| `services/stt-relay/src/session.js` | `snapshotRow`: `auth_type === 'api_key'` (was `'key'`); read `user_id`/`trial_id` from `claims.sub_id`. Removed the `sub_id ||= sub` hash fallback. |
| `services/stt-relay/tests/_helpers.mjs` | `buildToken` now mirrors production (`auth_type: 'api_key'` + real-shaped `sub_id`). |
| `services/stt-relay/tests/billing.test.mjs` | Added a positive `user_id`/`auth_type` regression guard on finalize. |
| `services/stt-relay/tests/telemetry-fields.test.mjs` | Assertion `auth_type === 'api_key'`. |
| `services/stt-relay/tests/token-gate.test.mjs` | Expiry test uses `auth_type: 'api_key'`. |

**Tests after fixes:** core 277/277 · relay 106/106 · API 38/38 · migration 15/15 · `node --check server.js` OK.
