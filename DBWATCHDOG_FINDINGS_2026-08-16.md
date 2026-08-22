# DbWatchdog "database unreachable" — investigation findings

Date: 2026-08-16. Service: natively-api on Railway (project dazzling-determination,
US East, deployment 1218e117). Supabase project `fvflvlobvwbywjhzifng`.

## The alert

```
[DbWatchdog] database unreachable for 0s (egress=up, failures=1,
  verdict=db_unreachable_but_egress_healthy): The operation was aborted due to timeout
```

162 occurrences in 8.9h of logs (04:14–13:06 UTC). **Every single one** carries the
identical error string `The operation was aborted due to timeout` — i.e. the
`AbortSignal.timeout(5000)` in `lib/dbWatchdog.js:135`, never a socket error, never
a DNS error, never a refused connection.

Failure rate by hour (probe interval 30s → ~120 probes/h):

| hour (UTC) | failures | rate |
|---|---|---|
| 05 | 21 | 17.5% |
| 06 | 18 | 15.0% |
| 07 | 3 | 2.5% |
| 09 | 30 | 25.0% |
| 10 | 28 | 23.3% |
| 11 | 53 | 44.2% |
| 12 | 9 | 7.5% |

## Ruled out, with evidence

| Hypothesis | Evidence against |
|---|---|
| Network path / egress broken | Railway flow logs: every TCP flow to Supabase's edge shows `l4LatencyMs` 0–6 ms, `dropCause: null`. In-container `net.connect` = **1–2 ms**, TLS = **5–12 ms**. |
| DNS failing or stalling | Railway DNS logs: 300/300 queries `NOERROR` with answers. In-container `dns.lookup` = **1–4 ms**. |
| Supabase endpoint inherently slow | 40 in-container samples at 1.5 s spacing: `GET /rest/v1/` p50 472 ms, p99 864 ms, **0/40 timeouts**. |
| Container CPU/memory starvation | cgroup `cpu.stat`: `nr_throttled 0`, `throttled_usec 0` over 94 141 periods. Memory 305 MB / 8 GB, `oom_kill 0`. cpu.max = 8 CPUs. |
| App load / event-loop blocking | 74% of failures (120/162) had **zero** app log lines in the preceding 60 s. Rate is *highest* when idle (44% at 11:00) and *lowest* when busy (2.5% at 07:00). |
| Stale keep-alive socket reuse | At a 30 s cadence undici opens a **new** socket for every probe (`newSocket: 1` on both a long-lived and a per-request Agent). There is no reuse to go stale. Confirmed by flow logs: each probe uses a new ephemeral port. |
| Probe body size (132 KB OpenAPI) | `fetch` resolves at headers; the failing request never received a single application-data byte. |
| Cloudflare edge / Railway egress IP | From the container, `GET /cdn-cgi/trace` (edge-served, never reaches origin) on a fresh connection each time: **21 ms**, `colo=IAD`, stable egress IP `152.55.180.60`. The edge answers instantly while `/rest/v1/` stalls. |
| Supabase database saturation | Supabase privileged metrics: `node_load15 = 0.02`, pgbouncer `client_waiting_connections = 0`, `maxwait_seconds = 0`. Postgres CPU is ~98% idle over the instance's lifetime. The database is not busy. |

### Production failures are on fresh connections, matching the reproduction

Flow logs for the 5-failure cluster at 11:39:26–11:41:26 (each failing probe starts
~5 s before its log line). A **new ephemeral port appears at every probe instant**
— `:20.6` and `:50.6` each minute, exactly the 30 s watchdog cadence:

```
11:39:20.746 port=38132 dur=30.35s out= 6720B in=23073B  FRESH (handshake present)
11:39:50.651 port=37162 dur=15.00s out= 2445B in= 2298B  handshake only, no response
11:40:20.647 port=36820 dur=30.02s out= 5398B in= 5763B  FRESH
11:40:50.669 port=35240 dur=15.00s out= 2445B in= 2364B  handshake only, no response
11:41:20.657 port=36532 dur=14.44s out= 6823B in= 8328B  FRESH
```

So the in-container reproduction is the same phenomenon as the production alerts,
not a separate one. (The `891B out / 132B in` reuse-then-reconnect pattern seen at
12:33:50 is the app's *other* 60 s Supabase task, not the watchdog.)

## Reproduced under control

In-container, watchdog's exact cadence (30 s) and exact deadline (5 s):

```
i=1  dns=4  tcp=2  tls=12  GET=516  ->200   HEAD=695 ->200
i=2  dns=1  tcp=1  tls=5   GET=873  ->200   HEAD=225 ->200
i=3  dns=1  tcp=2  tls=6   GET=5000 ->"The operation was aborted due to timeout"
                           HEAD=885 ->200
i=4  dns=1  tcp=1  tls=9   GET=449  ->200   HEAD=226 ->200
```

Same script, same config, same endpoint, run from a laptop at the same 30 s
cadence: **0/20 failures** (p50 508 ms, max 1331 ms). The fault is specific to the
Railway container's path.

Railway flow log for the controlled failure at 13:43:03.494 (ephemeral port 34510):

```
port 34510: 13:43:03.494 -> 13:43:08.494  out=2933B/8pkt  in=4223B/5pkt  drops=[]
```

Exactly 5.000 s. TCP connected, TLS handshake completed (4223 B inbound ≈ cert
chain), request written — then **zero response bytes for 5 s**. No drops.

## The episode has a beginning and an end

| period | watchdog failures |
|---|---|
| 00:00 – 00:45 | 0 |
| 00:45 – 05:00 | 5 (sparse) |
| 05:00 – 12:35 | ~157 (15–44% of probes) |
| **12:36 – 14:10** | **0** (~188 consecutive probes) |

No restart, no redeploy, no config change at that boundary — there is no boot
marker anywhere in the 00:00–14:10 logs, so the container ran continuously
through both the failing and the clean period. **A structural client-side bug
cannot switch itself off.** This was a time-bounded upstream latency episode.

## Cold-path penalty is real but small outside the episode

Controlled burst test in-container (every 30s, three probes 700ms apart, a
brand-new Agent for each so all three are fresh connections):

| position | when it arrives | p50 | p90 | max | mean |
|---|---|---|---|---|---|
| 1 | after a ~29 s idle gap | 470 ms | **838 ms** | **1738 ms** | 665 ms |
| 2 | 0.7 s later | 458 ms | 481 ms | 686 ms | 464 ms |
| 3 | 1.4 s later | 451 ms | 527 ms | 731 ms | 493 ms |

The **median is identical** across positions — the idle gap costs nothing most of
the time. The difference is entirely in the **tail**: position 1 has ~1.7× the p90
and ~2.5× the max. That is precisely the shape that produces an intermittent
deadline miss rather than a uniform slowdown, and it explains why the watchdog's
sparse 30 s sampling is the worst possible sampling strategy for this endpoint.

`connected` is 8–10 ms median in all three positions, so the difference is time
waiting for the response — upstream of the container. This project's database is
nearly idle (`node_load15 = 0.02`), so nothing keeps Cloudflare's connection to
the Supabase origin warm between probes.

## Where this leaves the diagnosis

The probe never detected a dead network. It detected a **response that did not
arrive within 5 s on a freshly-established connection**.

Two things are separately true, and it matters which is which.

1. **The trigger was an upstream latency episode, and it is over.** Something in
   Supabase's API layer intermittently took >5 s to answer `GET /rest/v1/` between
   00:45 and 12:35, then stopped. No local change accompanies either boundary.

2. **The watchdog's design is what turned that episode into 162 error lines and 7
   false outage alerts.** Two design choices combine badly:
   - *Sparse sampling of a cold path.* A probe every 30 s is always a cold-path
     request, and the cold path has a heavier tail (p90 838 ms vs 481 ms). Against
     a 5 s deadline that is the worst possible sampling strategy for this endpoint.
   - *A deadline miss classified as a transport failure.* `probe()` maps **any**
     thrown error to `PROBE.CONNECT_FAILED`, and `shouldExit` is written around
     "fetch threw ⇒ connect-layer failure". An `AbortSignal` deadline on a
     connection whose TLS handshake completed is not that. So a slow response gets
     announced as `db_unreachable_but_egress_healthy` — "provider-side incident,
     NOT restarting, a redeploy will NOT clear this". Every alert you received was
     mislabelled. bedc55e added an escalating ladder, which made the mislabelled
     alert *repeat* instead of fixing the classification.

**Be clear about the cold-path tail's role.** p90 838 ms and max 1738 ms are
nowhere near 5000 ms. The tail does not by itself produce a deadline miss — it
explains why sparse sampling is fragile. The episode is what pushed that tail past
5 s.

## What I could not determine

The source of the >5 s stalls is inside Supabase's API layer (Kong/PostgREST),
which is shared multi-tenant infrastructure and exposes no metrics to you — the
privileged metrics endpoint returns only Postgres-host and pgbouncer series, no
`pgrst_*`. So: I know what it is **not** (network, DNS, Cloudflare edge, egress IP,
container CPU/memory, Postgres load, connection reuse, probe body size), I know it
was **upstream of your container**, and I could not see inside the layer where it
happened.

**One unresolved inconsistency, stated plainly:** my own in-container probe timed
out once at 13:43:09 — inside the clean window where the real watchdog logged
0 failures in ~188 probes. Either that was coincidence on only 4 samples, or the
extra raw TCP/TLS connections my script opened and abruptly destroyed each round
provoked it. I did not resolve this.

## Separate findings (not caused by the watchdog)

- **No wrongly-locked-out users.** No key in the window was both accepted and
  rejected. The 563 `account_suspended` rejections are a *single* key
  (`17043d1f042d483c`) in a reconnect loop. User-facing auth failures fall *below*
  chance inside watchdog-down windows (12.4% observed vs 17.3% expected), so the
  `validateKey`-masks-a-DB-error pattern did **not** fire today.
- **6 sessions produced no transcript** despite audio flowing. In 3 of them the
  system channel carried `rms_p50=0 rms_max=0` — the client streamed pure silence
  for 134–367 s. That is a client-side system-audio-capture failure, not a server
  or database problem. Sessions: `e5aee78156790ffb` (06:43, 07:19),
  `82485eeb6fd7786d` (09:08).
- **2 chat streams started and never ended**: `ddecd8a6` at 07:10:05 and
  `nat_stream_260e9d85…` at 08:00:07 (61 started, 59 ended).

## Proposed changes — NOT APPLIED, pending your go-ahead

All in `lib/dbWatchdog.js`; none touch SQL or schema.

1. **Classify a deadline separately from a transport failure.** This is the actual
   fix. Today:
   ```js
   } catch (err) {
     return { state: PROBE.CONNECT_FAILED, error: err?.message || String(err) }
   }
   ```
   Every throw becomes `CONNECT_FAILED`, and `shouldExit`'s contract is written
   around "fetch THREW (connect timeout, dropped SYN, DNS failure)". An
   `AbortSignal` deadline on a connection whose TLS handshake completed is none of
   those. Add a third state (e.g. `PROBE.SLOW`) for `err.name === 'TimeoutError'`
   **when the transport is provably alive** — cheapest way to prove that is to run
   the existing `tcpProbe` against the Supabase host itself on failure.
   *Safety*: in the 2026-08-04 signature, TCP to Supabase fails too, so it still
   lands in the connect-failed branch and the control-host discriminator still
   drives the exit. `tests/db-watchdog.test.mjs` covers the exit path and must
   keep passing; it currently has **no** case for a slow response, which is why
   this gap shipped.

2. **Alert only on sustained failure.** One deadline miss is not an outage. Of
   the 162 failures, 136 were isolated (`failures=1`, cleared on the next probe);
   15 reached 2, 7 reached 3, 3 reached 4, 1 reached 5. The `shouldAlert` ladder
   starts at 3, so **7 Telegram alerts fired** — each one saying Supabase was
   unreachable when it was not. Every failure also writes an error-level log line
   regardless of the ladder, which is the bulk of the noise.

3. **Raise the deadline** from 5 s to ~10 s. Measured cold-path p90 is 1.7 s, but
   5 s leaves no headroom for an upstream slow period.

4. **Stop probing the most expensive endpoint.** `GET /rest/v1/` makes PostgREST
   regenerate a 132 KB OpenAPI document — 2,880 times a day — for a status code.
   `HEAD /rest/v1/` (p50 233 ms vs 472 ms, 0 bytes) or `GET /auth/v1/health`
   (p50 230 ms) proves the same thing. **This is waste reduction, not the
   root-cause fix** — do not let it be mistaken for one.

5. **Fix the alert copy.** "Supabase unreachable … provider-side incident, NOT
   restarting. A redeploy will NOT clear this." is wrong for a slow response and
   is what sent this investigation down the wrong path twice.

## Artifacts left in the container (to remove)

`/app/.claude-probe.mjs`, `/app/.claude-gvh.mjs`, `/app/.claude-pvf.mjs`,
`/app/.claude-phases.mjs`, `/tmp/pvf.log`, `/tmp/ph.log`.
SSH key `claude-diagnostics-2026-08-16` registered on the Railway account.

---

# ADDENDUM — after the CPU/disk-100% and license-telemetry information

## Correction to this document

Above I wrote "the database is not busy" from `node_load15 = 0.02` and pgbouncer
waits of 0. **That reading was taken at 14:20 UTC, after the failing window had
already ended at 12:35.** It is not evidence about the failing window and should
not have been listed as a ruled-out cause. A dashboard showing CPU/disk at 100%
*during* the failures is better evidence than my post-hoc sample.

## This exact failure is already documented in this repo

`migrations/011_request_counter_bulk_and_index_dedup.sql` and
`lib/requestCounter.js` both open with a post-mortem of **2026-08-14**:

> The Supabase project's disk IO burst budget hit 100% and every authenticated
> PostgREST and GoTrue request hung. Total outage 44 minutes … It recovered
> unaided when the budget refilled.
>
> The instance is Nano (Free plan). CPU was 34% and memory 50%, and the disk was
> 4% full. It was IOPS.
>
> ~1.15 GB of WAL against a 44.6 MB database: 26:1 amplification … that is
> FULL-PAGE WRITES … the lever is the number of TRANSACTIONS and the number of
> INDEXES each one has to maintain.

That signature — everything hangs, nothing is unreachable, recovers with no local
change — **is exactly what happened on 2026-08-16 between 00:45 and 12:35.** The
watchdog timeouts are a symptom of IO-budget exhaustion, not a separate fault.

Instance confirmed still Nano: **2 vCPU, 0.40 GiB RAM** (privileged metrics).

## What I verified about the telemetry suspicion

| Check | Result |
|---|---|
| `LICENSE_LEDGER_ENABLED` in Railway | **not set** → license ledger timer is a no-op |
| `OPS_TELEMETRY_ENABLED` in Railway | **not set** → ops telemetry timer is a no-op |
| `USAGE_LEDGER_ENABLED` in Railway | **`1`** → `usage_events` upsert every 30 s |
| `usage_events` rows | 22,993 (was 21,853 during the 2026-08-14 outage → +1,140) |
| `license_usage_events` rows | 7,046 — non-zero, so it *was* written at some point |
| `operational_telemetry_events` rows | 9 |
| `license_ledger_unified` | a VIEW (22,993 + 7,046 = 30,039 exactly), not a table |

So the 11-index `license_usage_events` table is **not** currently being written by
the ledger timer. But note the latent hazard if you ever set that flag:

- `license_usage_events` carries **11 indexes** (migration 008)
- `lib/licenseLedger.js` uses `FLUSH_INTERVAL_MS = 5000` — **6× more transactions**
  than `usageLedger.js` (30 s), against ~3.7× the indexes

That is the precise combination migration 011 was written to eliminate. Turning
that flag on without changing the interval would very likely reproduce 2026-08-14.

## Unexplained lead

At idle, the instance sustains **193 read IOPS / 4.5 MB/s**. On a 44.6 MB database
with 400 MB RAM the working set should be fully cached; sustained reads at idle
suggest something is scanning repeatedly and burning IO budget continuously.
Worth identifying.

## Read-only SQL to find the current top writers

I cannot run these — there is no DB connection string in `.env` and PostgREST
exposes no generic SQL. Run them in the Supabase SQL editor; all are read-only.

```sql
-- 1. Biggest WAL producers (this is what named the culprit on 2026-08-14)
select substr(query,1,90) as query, calls, wal_bytes, wal_fpi,
       round(total_exec_time::numeric,1) as total_ms
from pg_stat_statements order by wal_bytes desc limit 15;

-- 2. Per-table write volume + autovacuum churn
select relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup,
       autovacuum_count, seq_scan, seq_tup_read
from pg_stat_user_tables order by n_tup_ins+n_tup_upd+n_tup_del desc limit 15;

-- 3. Index bloat per table (the second lever from migration 011)
select relname,
       pg_size_pretty(pg_total_relation_size(relid)) as total,
       pg_size_pretty(pg_indexes_size(relid))        as indexes,
       (select count(*) from pg_index where indrelid = relid) as idx_count
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15;

-- 4. Indexes never used — each one costs a full-page write on every insert
select relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes where idx_scan = 0
order by pg_relation_size(indexrelid) desc;
```

## Security advisor triage

**Ignore for now (32 × `function_search_path_mutable`).** Standard hardening
(`SET search_path = ''` on each function). No performance relevance.

**Fix (`anon` can execute SECURITY DEFINER functions).** These are reachable by
anyone holding your publishable/anon key:

- `increment_trial_ai`, `increment_trial_search`, `increment_trial_stt_seconds`,
  `increment_trial_stt_seconds_raw` — callable via `/rest/v1/rpc/...` with an
  arbitrary `trial_id`. Anyone can burn or inflate any trial's quota. **And each
  call is a write** — on a Nano instance with an IO budget, that is also a
  denial-of-service lever against the whole database. This connects the security
  finding to the performance one.
- `rls_auto_enable()` — callable by `anon` **and it does not exist anywhere in
  `migrations/`**, so it was created out-of-band and is not in version control.
  Find out what it does before anything else.

Remediation is `REVOKE EXECUTE ... FROM anon, authenticated;` on the trial
functions (the server calls them with the service role, which is unaffected).
Not applied — you asked for no SQL changes.

---

# ADDENDUM 2 — live capture, and the resolved root cause

## The measurement that settles it

A watchdog failure occurred at **21:08:56**, *between* two cluster-wide SQL
samples (21:02:11 and 21:10:10). During that window:

| whole cluster | value |
|---|---|
| `blks_read` (disk reads) | **0** (5,068 → 5,068) |
| row changes | 36 |
| transactions | 515 (~1.07/s) |
| cache hits | +87,693 |
| replication slots | none |

**Postgres did zero disk I/O and changed 36 rows while a PostgREST request was
timing out at 5 seconds.** The database is not the bottleneck during a failure.

## Retraction: the "100 MB of WAL" alarm was wrong

`archive_timeout = 120s` forces a WAL segment switch every ~2 minutes, and a
forced switch advances the LSN to the segment boundary regardless of content.
Measured: WAL +50,326,088 bytes = **2.9997 × 16 MB**, `current_wal_file`
`…58` → `…5B` (+3), `archived_count` +3. The WAL growth is **padding, not data**.
I raised it as alarming; it is normal for this configuration.

## Root cause

The stall is in Supabase's **API layer**, not Postgres. On Nano (2 shared vCPU,
0.40 GiB RAM) PostgREST, Kong, GoTrue, Realtime and Storage share the instance —
so the dashboard's 100% CPU is instance-wide, and PostgREST's own work never
appears in `pg_stat_statements`.

And the watchdog asks that layer for the most expensive response it can produce:
`GET /rest/v1/` regenerates and serialises a **132 KB OpenAPI document** every
30 seconds, 2,880 times a day.

## Measured probe alternatives (25 samples each)

| candidate | p50 | p90 | max | bytes | touches Postgres? |
|---|---|---|---|---|---|
| `GET /rest/v1/` (current) | 491 ms | 583 ms | 683 ms | 132,327 | unclear — see below |
| `HEAD /rest/v1/` | **193 ms** | **202 ms** | **295 ms** | 0 | probably not |
| `GET /auth/v1/health` | 331 ms | 405 ms | 570 ms | 107 | no (GoTrue only) |
| `HEAD /rest/v1/api_keys?select=id&limit=1` | 330 ms | 391 ms | 577 ms | 0 | **yes** |

**Recommended: `HEAD /rest/v1/api_keys?select=id&limit=1`.** 33% cheaper than the
current probe, no 132 KB body, and — unlike the alternatives — it executes real
SQL, so it proves the whole path Cloudflare → Kong → PostgREST → Postgres.

Worth confirming: PostgREST builds the OpenAPI document from its **in-memory
schema cache**. If that is served without a Postgres round-trip, the current
probe never actually tests the database, and a component called `DbWatchdog` has
been reporting on something other than the database.

## Correction to Addendum 1's priority list

- Changing the probe endpoint is **not** "waste reduction" as I framed it. Given
  the stall is in the API layer and the probe targets that layer's most
  expensive operation, the endpoint choice is close to the cause itself.
- Dropping `usage_events_trial_time_idx` and raising `checkpoint_timeout` are
  now **low priority** — full-page writes are not the problem (79 dirty buffers
  per checkpoint), and `usage_events` logged zero INSERT calls in the window.
- What survives: the instance is Nano and that is the real ceiling.
