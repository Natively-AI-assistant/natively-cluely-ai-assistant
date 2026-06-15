# Durable STT Billing — Schema, RPCs, and the F2/F3/F5/F6/F7 Fixes

**Date:** 2026-06-13
**Status:** Implemented (Phase 6) — `migrations/003_stt_durable_billing.sql` + relay `usageStore.js` wiring + logic test harness
**Inputs (binding):**
- `docs/01-target-stt-relay-architecture.md` §6 (Supabase schema requirements)
- `docs/05-stt-relay-service.md` §4 (relay metering / flush-finalize contract)
- `docs/00b-pre-migration-review-findings.md` (F2/F3/F5/F6/F7 + MUST-PRESERVE §7 billing semantics)

**One-sentence summary:** The regional STT relay is an honest per-channel meter; all durable
billing state and the mic/system pairing decision live in Supabase via three idempotent RPCs
(`stt_flush_usage`, `stt_finalize_session`, `stt_reconcile_abandoned`) that apply usage to the
EXISTING `api_keys`/`free_trials` counters incrementally, crash-safely, and exactly-once.

---

## 1. Schema diagram

```
                         ┌──────────────────────────────────────────────┐
                         │ stt_sessions  (durable session record)        │
                         │  PK session_id ('st_…')                        │
                         │  user_id ──────────────┐  trial_id ──────┐     │
                         │  auth_type CHECK(api_key|trial)          │     │
                         │  billable_seconds  (relay meter, SHOULD) │     │
                         │  billed_seconds    (APPLIED — idempotency)│     │
                         │  last_seq          (highest flush applied)│     │
                         │  mic_unbilled      (pairing refunded)     │     │
                         │  status active|finalized|abandoned        │     │
                         └────────────┬──────────────────┬──────────┘     │
                                      │ FK (logical)      │ FK (logical)   │
                ┌─────────────────────▼───┐         ┌─────▼──────────────┐ │
                │ api_keys                │         │ free_trials        │ │
                │  transcription_minutes_ │         │  stt_seconds_used  │ │
                │  used  (MINUTES)        │         │  (SECONDS, cap 600)│ │
                └─────────────────────────┘         └────────────────────┘ │
                   ▲ increment_transcription_minutes    ▲ increment_trial_  │
                   │ (legacy path + relay delta)          stt_seconds(legacy)│
                                                                            │
   stt_usage_events (append-only journal)  ───── session_id ──────────────┘
     id bigserial PK
     UNIQUE(session_id, seq, event_type)   ← replay no-op
     event_type flush|finalize|reconcile
     billable_seconds_snapshot, billed_delta, metrics_json

   relay_health_events (optional health transition log)
     id, relay_id, region, healthy, latency_ms, source, created_at
```

**Ownership:** the control plane creates the row (Phase 7 reserve); the relay updates it via
flush/finalize (Phase 6 — this doc); the reaper (cron or control plane) closes abandoned rows.
`billed_seconds` is the single authoritative "already applied" anchor — every delta is computed
against it, so every operation is idempotent.

---

## 2. `stt_sessions` field dictionary

| Field | Type | Meaning |
|---|---|---|
| `session_id` | text PK | the relay's session UUID (`st_…`) |
| `user_id` | uuid | set iff `auth_type='api_key'` (CHECK: exactly one of user/trial) |
| `trial_id` | uuid | set iff `auth_type='trial'` |
| `auth_type` | text | `api_key` \| `trial` |
| `plan` | text | standard\|pro\|max\|ultra\|trial |
| `relay_id` / `region` | text | `us-1`/`asia-1`/`railway` ; `us`/`asia`/`railway` |
| `channel` | text | `system` \| `mic` \| `default` (drives pairing) |
| `started_at` / `ended_at` | timestamptz | first WS open ; terminal (finalize/abandon) |
| `status` | text | `active` \| `finalized` \| `abandoned` |
| `provider_primary` / `provider_final` | text | first connected ; provider at close |
| `duration_seconds` | int | wall-clock |
| **`billable_seconds`** | int | what the relay meter says SHOULD be billed (monotonic, GREATEST-merged) |
| **`billed_seconds`** | int | what HAS been applied to the downstream counter, in SECONDS — **the idempotency anchor** |
| `bytes_in_from_client` / `bytes_out_to_{deepgram,google_stt,elevenlabs,client}` | bigint | egress accounting (cost guards) |
| `chunks_{received,forwarded,dropped}` | bigint | flow counters |
| `reconnect_count` / `failover_count` / `shadow_probe_count` | int | reliability counters |
| `first_transcript_ms` | int | TTFT (NULL if none) |
| `final_transcript_count` | int | number of final transcripts |
| `close_code` / `close_reason` / `error_code` | int/text/text | terminal close info |
| **`last_seq`** | int | highest flush `seq` applied — **stale-seq guard** |
| `mic_unbilled` | boolean | true iff pairing refunded this mic session |
| `note` | text | free-form (pairing/reaper breadcrumbs) |
| `created_at` / `updated_at` | timestamptz | row lifecycle; `updated_at` drives the reaper |

**Indexes:** `WHERE status='active'` partial on `updated_at` (reaper scan), `user_id`, `trial_id`,
`started_at`, and `(channel, started_at, ended_at)` for the pairing overlap query.

---

## 3. RPC contracts

All three RPCs are plain `LANGUAGE plpgsql` functions (not `SECURITY DEFINER` — the service-role
key already has the needed privileges; keeping them invoker-rights avoids a privilege-escalation
surface). Each function body is **atomic** (one implicit transaction) and serializes concurrent
operations on the same session via `SELECT … FOR UPDATE` on the `stt_sessions` row.

### 3.1 `stt_flush_usage(p_session_id text, p_seq int, p_metrics jsonb) → jsonb`

The periodic checkpoint (every 30–60s). Behavior:

1. **UPSERT** the `stt_sessions` row from `p_metrics` (`INSERT … ON CONFLICT (session_id) DO NOTHING`,
   then `SELECT … FOR UPDATE`). Monotonic counters (bytes/chunks/billable/duration) are merged with
   `GREATEST`, so a duplicated or out-of-order snapshot can never DECREASE a stored total. Immutable
   context (identity, started_at, provider_primary) is filled first-flush-wins.
2. **Stale-seq guard:** `p_seq <= last_seq` → `{applied:false, reason:'stale_seq', …}` (no-op). A
   finalized session also returns `{applied:false, reason:'already_finalized'}`.
3. **Incremental billing:** `delta = new billable − billed_seconds`; if `delta>0`, apply only the
   delta via `stt_apply_billing_delta`, then set `billed_seconds = billable_seconds`.
4. **Journal** a `flush` event (`ON CONFLICT (session_id, seq, event_type) DO NOTHING` → replay no-op).
5. Set `last_seq = p_seq`, `status='active'`, `updated_at=now()`.

Returns `{applied, billed_seconds, billable_seconds, units_added}` (`units_added` = seconds for trial,
minutes for api_key).

### 3.2 `stt_finalize_session(p_session_id, p_metrics, p_close_code, p_close_reason, p_error_code) → jsonb`

The terminal idempotent finalize. Behavior:

1. Ensure the row exists, lock it (`FOR UPDATE`).
2. **Idempotent guard:** `status='finalized'` → `{applied:false, reason:'already_finalized', …}` —
   no re-bill, no re-refund.
3. Merge the final snapshot (monotonic), **apply the final delta** (same math as flush — catches the
   last partial between the last checkpoint and close).
4. **Paid floor reconciliation** (defense): if a paid session is `>=30s` but somehow applied 0 minutes,
   top up by 1 (matches `max(1, round(total/60))`). In practice the `<30s`-free gate + `round(30/60)=1`
   make this a never-fires belt-and-suspenders.
5. **Mic/system pairing** (§5) — refund the mic billing if an overlapping billed system session exists.
6. Set terminal fields (`status='finalized'`, `ended_at`, close codes, `provider_final`).
7. Journal a `finalize` event.

Returns `{applied, billed_seconds, billable_seconds_effective, mic_unbilled, units_added}`.

### 3.3 `stt_reconcile_abandoned(p_older_than_seconds int DEFAULT 300) → int`

The reaper (F5/F7). Finds `status='active'` rows whose `updated_at` is older than the threshold (relay
died without finalizing), `FOR UPDATE SKIP LOCKED` (safe to run concurrently / from multiple schedulers),
finalizes each from its last checkpoint via `stt_finalize_session` (so pairing + idempotency are
identical to a normal close), overrides `status='abandoned'` + `ended_at=updated_at`, journals a
`reconcile` event. Returns the count reaped. `LIMIT 500` per call bounds the work.

### 3.4 Locking & idempotency mechanisms (summary)

| Mechanism | What it guards |
|---|---|
| `SELECT … FOR UPDATE` on the session row | concurrent flushes/finalizes of the **same** session serialize |
| `billed_seconds` anchor + delta math | replaying any flush, or finalizing twice, applies `delta=0` → no-op |
| `last_seq` monotonic guard | a stale/duplicate `seq` is rejected before any billing |
| `GREATEST` counter merge | out-of-order/duplicate snapshots never decrease a stored total |
| `UNIQUE(session_id, seq, event_type)` on the journal | event insert is replay-safe |
| `status='finalized'` early return | terminal idempotency (no re-bill/re-refund) |
| `FOR UPDATE SKIP LOCKED` in the reaper | multiple reaper invocations don't double-process a row |

---

## 4. Incremental-billing delta math (and proof it matches the old path)

### 4.1 The two counters

- **Trial** (`free_trials.stt_seconds_used`, SECONDS, hard cap 600): apply EXACT seconds —
  `stt_seconds_used = LEAST(stt_seconds_used + delta, 600)`. Mirrors `increment_trial_stt_seconds` +
  the live 600s cap.
- **Paid** (`api_keys.transcription_minutes_used`, MINUTES): the live counter is in MINUTES, but we
  track `billed_seconds` precisely in SECONDS on `stt_sessions`. Each apply adds
  `minutes_delta = round(new_billed/60) − round(old_billed/60)` (clamped `>= 0`) to the counter.

### 4.2 Rounding decision

We track `billed_seconds` in **seconds** and convert to minutes at the **boundary**:

```
minutes_delta = round(billable/60) − round(billed/60)        (clamped >= 0)
```

`round()` in PostgreSQL and `Math.round()` in JS both round **half away from zero**; for the
non-negative values here that is identical, and `round(30/60) = round(0.5) = 1` in both. The deltas
**telescope**: summing over a session's flushes,

```
Σ ( round(billable_i/60) − round(billed_i/60) )
   = round(final_billable/60) − round(0/60)
   = round(total/60)
```

Because the paid path is gated `<30s → free`, `round(total/60) >= round(30/60) = 1`, so the
`max(1, round(total/60))` floor is automatically satisfied; finalize's floor reconciliation is a
never-fires defense.

### 4.3 Proof it equals the old `/v1/transcribe` total

Old path bills **once** at close: `minutes = max(1, round(total_seconds/60))`, only if `total >= 30s`.
The incremental sum equals `round(total/60)` (above) = `max(1, round(total/60))` for any `total >= 30`.
The reference model (`migrations/__tests__/billingReferenceModel.mjs`) and test invariant #3 verify this
across `[30,31,45,59,60,61,89,90,91,119,120,121,599,600,3600,3601,7199]` seconds, each partitioned into
1–6 noisy monotonic checkpoints — every case's incremental total equals the one-shot old-path total.

---

## 5. The mic/system pairing fix (F2/F3)

### 5.1 The overlap query

At mic-session finalize (and only when the mic session itself billed, `billed_seconds>0`):

```sql
SELECT o.session_id
  FROM stt_sessions o
 WHERE o.session_id <> <this mic>
   AND o.channel IN ('system','default')
   AND o.billed_seconds > 0                          -- F3: a BILLED system session, not a free heartbeat
   AND <same identity: o.user_id=mic.user_id OR o.trial_id=mic.trial_id>
   AND tstzrange(o.started_at, COALESCE(o.ended_at, now()), '[]')
       && tstzrange(mic.started_at, COALESCE(mic.ended_at, now()), '[]')   -- window overlap
 LIMIT 1;
```

### 5.2 Refund mechanics

If an overlapping billed system/default session exists, the mic billing is **reversed**:

- **Trial:** `stt_seconds_used = GREATEST(stt_seconds_used − mic.billed_seconds, 0)` (exact seconds out).
- **Paid:** subtract `round(mic.billed_seconds/60)` minutes:
  `transcription_minutes_used = GREATEST(used − refund_minutes, 0)`.

Then `billed_seconds = 0`, `mic_unbilled = true`, and a `note` breadcrumb is appended. The finalize
return reports `billable_seconds_effective = 0, mic_unbilled = true`.

### 5.3 Idempotency

Because the refund sets `billed_seconds = 0` AND `status='finalized'`, a second finalize hits the
`already_finalized` guard and never refunds again (verified by test 7b). `system`/`default` channels are
never refund candidates — they always bill (test "default channel always bills").

### 5.4 In one paragraph

The relay bills every channel honestly and writes its own seconds to `stt_finalize_session`; the DB,
not any single relay's in-memory map, decides whether a `mic` session should actually be billed by
running a `tstzrange` overlap query against BILLED `system`/`default` sessions of the same identity.
If a billed system session overlaps the mic window, the mic's already-applied seconds/minutes are
refunded out of the counter and the mic row is flagged `mic_unbilled`; otherwise the mic bills
normally. This works across relay instances, survives any close ordering (the system row already
carries `ended_at` + `billed_seconds` by the time mic finalizes), and a `<30s` free heartbeat system
session (which has `billed_seconds=0`) cannot launder a long mic stream.

---

## 6. How each finding is resolved

| Finding | Mechanism |
|---|---|
| **F2** mic/system double-bill on close ordering | DB `tstzrange` overlap query at mic finalize (§5) — not an in-memory `recentSystemChannels` snapshot. The system row carries `ended_at`+`billed_seconds`, so close order is irrelevant. |
| **F3** heartbeat bypass | the overlap query requires `o.billed_seconds > 0` — a `<30s` free system session never qualifies as cover (§5.1, test 5b). |
| **F5** bill-only-at-close crash loss | `stt_flush_usage` checkpoints every 30–60s with incremental delta application; `stt_reconcile_abandoned` finalizes a relay-killed session from its last checkpoint. Loss window ≤ one flush interval (≤60s) instead of ≤4h. |
| **F6** silent/non-idempotent/unversioned writes | every RPC is in this migration; flushes idempotent on `(session_id, seq)` + the journal `UNIQUE`; finalize idempotent on `status`; trial 600s cap in-RPC; the live `increment_transcription_minutes` is re-exported here (it had no migration file). The relay's `usageStore.js` retries + alerts (never silent). |
| **F7** quota TOCTOU | **RESOLVED** by the atomic quota lease in `migrations/004_stt_quota_lease.sql` (`stt_reserve_session`) — see §11 below. This migration (003) still owns the post-reservation truth: `billed_seconds` is the authoritative applied amount, and the reaper reconciles any session the watchdog let overrun. |

---

## 7. Reaper / cron setup

Two options (the RPC is the same; only the scheduler differs):

- **pg_cron (preferred if installed):** uncomment the guarded block at the bottom of the migration:
  ```sql
  SELECT cron.schedule('stt_reaper', '*/2 * * * *', $cron$ SELECT stt_reconcile_abandoned(300); $cron$);
  ```
  Runs every 2 minutes inside Postgres; no external moving parts. The block is wrapped in an
  `IF EXISTS (… pg_extension … 'pg_cron')` guard so applying the migration on a project without
  pg_cron is a safe no-op.
- **Control-plane scheduled call (fallback):** the Railway housekeeping sweep (`server.js` 60s sweep,
  audit §3) calls `supabase.rpc('stt_reconcile_abandoned', { p_older_than_seconds: 300 })` on an
  interval. `FOR UPDATE SKIP LOCKED` makes it safe even if both pg_cron and the control plane run it.

Alert (docs/01 §12): "Reconciliation backlog" — `abandoned` pending finalize > 25, or oldest active
unflushed row > 15 min.

---

## 8. GRANTs

The relay + control plane authenticate with the Supabase **service-role** key. The migration grants:

```sql
GRANT EXECUTE ON FUNCTION increment_transcription_minutes(uuid,int)         TO service_role;
GRANT EXECUTE ON FUNCTION stt_apply_billing_delta(text,uuid,uuid,int,int)   TO service_role;
GRANT EXECUTE ON FUNCTION stt_flush_usage(text,int,jsonb)                   TO service_role;
GRANT EXECUTE ON FUNCTION stt_finalize_session(text,jsonb,int,text,text)    TO service_role;
GRANT EXECUTE ON FUNCTION stt_reconcile_abandoned(int)                      TO service_role;
GRANT SELECT,INSERT,UPDATE ON stt_sessions       TO service_role;
GRANT SELECT,INSERT        ON stt_usage_events   TO service_role;
GRANT SELECT,INSERT        ON relay_health_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE stt_usage_events_id_seq    TO service_role;
GRANT USAGE,SELECT ON SEQUENCE relay_health_events_id_seq TO service_role;
```

`service_role` bypasses RLS by default; the GRANTs are explicit/defensive. For tighter isolation
(docs/01 §17 — the relay key should reach only `stt_*`), provision a dedicated DB role scoped to these
objects and use its key on the relay instead of the project service-role key.

---

## 9. Compatibility note (binding)

- The OLD RPCs `increment_transcription_minutes(key_id, minutes)` and
  `increment_trial_stt_seconds(trial_id, secs)` are **UNTOUCHED** and still used by the legacy
  `/v1/transcribe` close-time billing.
- The new RPCs are **ADDITIVE**: only the relay calls them. A session is one path or the other
  (decided at create) — never billed by both (docs/01 §16.4).
- This migration **re-exports** `increment_transcription_minutes` (byte-for-byte its live definition)
  purely to capture it in the repo (F6) — it does not change its behavior, and the legacy path keeps
  calling it directly.
- The relay's `usageStore.js` is forward-compatible: it calls the new RPCs and, on a
  "function does not exist" error, logs once and falls back to a direct `stt_sessions` upsert — so the
  migration can be applied **before or after** the relay deploys.

---

## 10. Apply + live-DB test steps

### 10.1 Apply (Supabase SQL editor)

1. Open the Supabase project → SQL editor.
2. Paste the entire contents of `migrations/003_stt_durable_billing.sql` and **Run**. It is idempotent
   (`CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`) and safe to re-run.
3. (Optional) if the project has pg_cron, uncomment the §9 block at the bottom and re-run.

### 10.2 Verify with a test session (manual, needs service-role creds)

```sql
-- 1. A paid flush: 120 billable seconds → expect +2 minutes on the api_key.
SELECT stt_flush_usage('st_manual_1', 1, jsonb_build_object(
  'auth_type','api_key', 'user_id','<a-real-api_keys.id>', 'channel','system',
  'plan','pro', 'relay_id','us-1', 'region','us',
  'started_at', now()::text, 'billable_seconds', 120, 'duration_seconds', 125));
-- → {"applied":true,"billed_seconds":120,"billable_seconds":120,"units_added":2}

-- 2. Replay the SAME seq → no-op (stale_seq), counter unchanged.
SELECT stt_flush_usage('st_manual_1', 1, '{"billable_seconds":120}'::jsonb);
-- → {"applied":false,"reason":"stale_seq",...}

-- 3. Finalize → applies any tail, sets terminal fields.
SELECT stt_finalize_session('st_manual_1', '{"billable_seconds":120}'::jsonb, 1000, 'client_closed', NULL);
-- → {"applied":true,...,"mic_unbilled":false}

-- 4. Finalize AGAIN → already_finalized, no double-bill.
SELECT stt_finalize_session('st_manual_1', '{"billable_seconds":120}'::jsonb, 1000, 'client_closed', NULL);
-- → {"applied":false,"reason":"already_finalized",...}

-- 5. Inspect.
SELECT session_id, status, billable_seconds, billed_seconds, last_seq, mic_unbilled
  FROM stt_sessions WHERE session_id = 'st_manual_1';
SELECT seq, event_type, billed_delta FROM stt_usage_events WHERE session_id = 'st_manual_1' ORDER BY id;

-- 6. Mic/system pairing: create an overlapping system session, then a mic session;
--    finalize the mic and confirm mic_unbilled=true and the minutes refunded.
-- (Use distinct session_ids with the same user_id and overlapping started_at windows.)

-- CLEANUP test rows:
DELETE FROM stt_usage_events WHERE session_id LIKE 'st_manual_%';
DELETE FROM stt_sessions     WHERE session_id LIKE 'st_manual_%';
-- and reverse any counter changes on the test api_key if needed.
```

### 10.3 Automated logic proof (no DB)

```
node --test migrations/__tests__/*.test.mjs          # 15 invariants (1–8 + trial/default)
cd services/stt-relay && node --test tests/*.test.mjs # 58 (47 existing + 11 usageStore)
```

The reference model (`migrations/__tests__/billingReferenceModel.mjs`) mirrors the SQL exactly and is
the executable spec the logic tests assert against; a live-DB integration test is the manual §10.2 step.

---

## 11. F7 RESOLVED — the atomic quota lease (`migrations/004_stt_quota_lease.sql`)

**Status:** Implemented. `migrations/004_stt_quota_lease.sql` + control-plane wiring in
`server.js` (the `/v1/stt/session` handler) + logic + control-plane tests. Lifts the docs/13 §12
"STOP — F7 gate" 25% rollout cap (see docs/13).

### 11.1 The problem (TOCTOU)

`POST /v1/stt/session` mints a token carrying `quota_remaining_seconds` as a **snapshot** read from a
≤30s-stale auth cache. The per-session relay watchdog bounds **each** session to that snapshot but not
the **aggregate**: N concurrent sessions on one credential each receive the full snapshot and can each
spend it. A key with 60s left can open 4 simultaneous sessions = 240s billed. Migration 003 deliberately
deferred this (its header: *"the lease is a control-plane concern, `stt_reserve_session`, NOT in this
migration"*). Migration 004 is that missing half.

### 11.2 The lease (shared per-identity counter)

`stt_quota_reservations` is an append-only ledger of **held seconds** per identity:

```
session_id text PK · identity_kind (api_key|trial) · user_id|trial_id ·
reserved_seconds int · status (held|released) · created_at · released_at · expires_at
```

At session-create the control plane calls **`stt_reserve_session(...)`**, which, in ONE transaction
**serialized per identity**:

```
available := limit_seconds − already_used_seconds − currently_held_seconds
grant     := LEAST(requested_seconds, GREATEST(available, 0))
```

- `already_used_seconds` is read **FRESH** from the authoritative counter
  (`api_keys.transcription_minutes_used*60` paid / `free_trials.stt_seconds_used` trial) — **not** the
  stale token snapshot (that staleness IS F7).
- `currently_held_seconds` = `SUM(reserved_seconds)` of this identity's still-`held`, non-expired rows.
- If `available <= 0` → `{granted:false, reason:'quota_exhausted', …}` and **no** row is inserted; the
  control plane returns the same `402 transcription_quota_exceeded` it uses for the snapshot pre-check.
- Else it INSERTs a `held` reservation for `grant` seconds and returns `{granted:true, granted_seconds}`.
  The token's `quota_remaining_seconds` (and the response `quota_remaining`) is set to **`grant`**, so the
  relay watchdog cuts at the **leased** budget. Two concurrent reserves on one identity therefore SHARE
  the budget: the first leases it, the second sees it already held and is granted only the remainder.

**Idempotency:** a re-reserve of the same `session_id` (a retried session-create) returns the existing
row unchanged (`idempotent:true`) — never double-counts.

### 11.3 Atomicity mechanism — `pg_advisory_xact_lock`, not `FOR UPDATE`

`stt_reserve_session` takes **`pg_advisory_xact_lock(hashtext(identity_key))`** as its first act, keyed on
the **identity** (`stt_lease:api_key:<uuid>` / `stt_lease:trial:<uuid>`). A row-level `SELECT … FOR UPDATE`
**cannot** close this race: the very first concurrent reserve has **no rows yet** to lock (the rows don't
exist — that's the TOCTOU), so `FOR UPDATE` can't serialize two brand-new INSERTs for the same identity.
The transaction-scoped advisory lock serializes the whole *read-aggregate-then-insert* per identity
end-to-end, is auto-released at COMMIT/ROLLBACK (no leak on error), and lets reserves for **different**
identities run fully parallel. This is the standard Postgres pattern for serializing an INSERT that depends
on an aggregate over not-yet-existing rows.

### 11.4 Release — the trigger (reserve → release → finalize flow)

```
session-create ── stt_reserve_session ──► reservation 'held' (grant seconds)
                                              │
relay streams, watchdog cuts at the lease    │
                                              ▼
relay close ── stt_finalize_session (003) ── stt_sessions.status → 'finalized'
   │  (or reaper: stt_reconcile_abandoned → status → 'abandoned')
   │  (or degraded directUpsert(finalize) → status → 'finalized')
   ▼
TRIGGER stt_release_reservation_trg (AFTER UPDATE OF status, on transition into a terminal status)
   └─► stt_release_reservation(session_id)  →  reservation 'released'  (frees the HELD amount)
```

**Choice: a TRIGGER on `stt_sessions`, NOT a `CREATE OR REPLACE` of 003's `stt_finalize_session` /
`stt_reconcile_abandoned`.** Rationale: (a) **lower risk** — redefining the two large 003 functions just
to append one release call would mean reproducing their full pairing/delta/journaling bodies, a copy that
can silently drift; the trigger touches neither. (b) **single chokepoint** — both the normal close and the
reaper (and the degraded `directUpsert(finalize)`) drive `stt_sessions.status` to a terminal value; one
trigger on that column covers all three paths. (c) **no relay code change** — the relay already calls
`stt_finalize_session(p_session_id := row.session_id)` (`usageStore.callFinalize`), so the matching
`reservation.session_id` is always present for the trigger to release.

The trigger fires only on a **transition into** `finalized`/`abandoned` (`OLD.status IS DISTINCT FROM
NEW.status`), and `stt_release_reservation` is itself idempotent (only a still-`held` row transitions), so
a repeated finalize / late normal-close-after-reaper is a safe no-op. The release frees the **hold only**;
the actual billing (billed_seconds → counter) is migration 003's job — the lease never bills, so there is
no double-counting.

### 11.5 Backstops against a dead reservation blocking quota

Two independent mechanisms ensure an abandoned reservation can't permanently consume quota:

1. **TTL** — each reservation carries `expires_at = created_at + (max_session + 600s grace)`.
   `stt_reserve_session` opportunistically reclaims this identity's expired `held` rows at the top of every
   reserve, and the `currently_held` sum counts only **non-expired** rows — so an abandoned reservation
   stops blocking on its own at the TTL.
2. **Reaper** — the migration-003 reaper finalizes abandoned sessions (status → `abandoned`) → the §11.4
   trigger fires → the reservation is released. Independent of the TTL.

### 11.6 Graceful degradation (server-before-migration-004 is safe)

The control plane (`new env STT_QUOTA_LEASE_ENABLED`, default **true**) leases only **relay** sessions
(`target !== 'railway'`; the railway path bills the old way). On **any** RPC error (function missing →
server deployed before migration 004, or Supabase down) it:

- logs **loud-once** (`⚠️ quota lease RPC unavailable — DEGRADED to snapshot quota … Apply migration 004`),
- emits a structured **`[STTEvent] quota_lease_degraded`** event with a degrade **counter**, and
- **falls back to the snapshot** `quota_remaining_seconds` (the exact pre-004 behavior).

Session-create **never hard-fails** because the lease RPC is unavailable. Verified live: against a Supabase
**without** migration 004, a lease-enabled server returns **HTTP 200** with the snapshot budget and the
`quota_lease_degraded` event — so the server can deploy before the migration, and the migration can be
applied later to activate the lease with **zero** server change. Setting `STT_QUOTA_LEASE_ENABLED=0`
disables the lease entirely (pure snapshot path, the RPC is never called).

### 11.7 Tests

```
node --test migrations/__tests__/stt_quota_lease_logic.test.mjs   # 10 lease invariants
node --test tests/stt-quota-lease.test.mjs                        # 20 (source + migration + integration)
```

`migrations/__tests__/quotaLeaseReferenceModel.mjs` mirrors the SQL exactly (the executable spec). The
logic invariants prove: two concurrent reserves on a 60s limit → first 60 / second 0; partial 40-of-60 then
the remaining 20; release frees the budget; idempotent re-reserve doesn't double-count; an expired hold is
reclaimed; finalize/abandon releases (trigger) and bills the real amount; the trial 600s cap; and **the F7
core invariant — `used + held` never exceeds the limit — fuzzed across 300 random reserve/release/bill
sequences for both identity kinds**. The control-plane test proves the handler calls `stt_reserve_session`
with the correct args, uses `granted_seconds` in the token, returns 402 on `granted:false`, and degrades to
the snapshot (with the `quota_lease_degraded` event) when the RPC is unavailable.
