# Usage Ledger Implementation Progress

Append-only. Never delete entries.
Companion file: `docs/usage-ledger-architecture.md` (what the system *is*).
This file: where the work stands.

## Campaign status

- Campaign 1 (Phases 0–3): **complete** — 2026-08-13. Migrations 008 + 008a APPLIED and
  probe-verified in production (`fvflvlobvwbywjhzifng`).
- Campaign 2 (Phases 4–5): **complete** — 2026-08-14. Server ingestion, client SQLite
  outbox (v27), feature instrumentation, Layer B. Migration 009 **APPLIED** and
  probe-verified (including the service_role revoke — the 008 grant trap did not repeat).
- Campaign 3 (Phases 6–8): **complete** — 2026-08-14. Backfill APPLIED (7,024 rows,
  idempotency re-verified). Reporting (JSON + PDF + digest), support lookup, adversarial
  suite, and a **live end-to-end run at 28 passed / 0 failed** against production.

**ALL THREE CAMPAIGNS COMPLETE, AND ALL FOUR OPEN ITEMS CLOSED** (2026-08-15) — feature
instrumentation now 9/9 handlers, `PRIVACY.md` applied, `docs/` tracked, and O3 addressed by
`migrations/010_usage_events_append_only.sql`.

**NOTHING OUTSTANDING.** Migrations 007–011 all applied and probe-verified; every finding
(O1–O5) closed. Schema probe 20/0/0, live E2E 28/0, 118 server tests, 26 Electron tests,
typecheck clean.

`license_ledger_unified` now returns **29,682 rows** across four provenances —
22,636 metered · 7,024 historical_import · 11 license_activity · 11 client_reported.

Nothing is committed — everything is staged and the staged trees boot.

Two sections at the end of this file narrow claims made earlier in it: "CORRECTIONS AND
PRECISE SCOPE" (E2E result, instrumentation coverage) and "OPEN ITEMS CLOSED".

## Phase checklist

- [x] Phase 0 — repository forensics (see "Repository facts discovered")
- [x] Phase 1 — data model + migration + retention job
      → `natively-api/migrations/008_license_usage_ledger.sql`, `natively-api/lib/licenseLedger.js`
- [x] Phase 2 — server-observed usage + Dodo webhook hook
      → verified the pre-existing `bill*` instrumentation (D2); added the webhook hook.
      **Partial: see open gaps O1 (request-id correlation) and O2 (entitlement state on
      metered rows) under "Known deviations from spec".**
- [x] Phase 3 — license activity journalling (debounced)
      → `/v1/usage` + `/v1/pro/verify`, one row per identity per 6h
- [x] Campaign 1 test suite (§35) — `natively-api/tests/licenseLedger.test.mjs`, 50/50 pass

### Not done, and deliberately so

- ~~**Migration 008 has not been applied to any database.**~~ SUPERSEDED 2026-08-13:
  008 + 008a are applied and probe-verified. Kept for the record.
- ~~**`PRIVACY.md` has not been edited.**~~ SUPERSEDED 2026-08-15: applied, covering both
  campaigns' fields. `docs/usage-ledger-privacy-diff.md` is kept as the record of what was
  proposed and why; the policy itself is now the source of truth.
- **Nothing was committed.** Everything is STAGED in both repos, and the staged trees were
  verified to boot (`git archive $(git write-tree)` → boot → `/health`), but the commit
  itself is left to the owner.

---

## ✅ RESOLVED 2026-08-13 — the server.js conflict (history kept below)

All 7 conflicts were resolved to the **`Updated upstream` (HEAD)** side, and the file now
parses, boots, and serves `/health` in ~1s with a clean graceful shutdown.

This was not a judgement call between two viable alternatives. Every stash side referenced
code that **no longer exists in HEAD**, so taking any of it produced an unbootable file:

| # | Stash side needs | Reality in HEAD |
|---|---|---|
| 1 | `buildGroqMessages` | Would have deleted the `embedTelemetry` definition while **20 references remain** → boot crash. The stash's 2 call sites for `buildGroqMessages` were not in the tree, so it would also be dead code. |
| 2, 3 | `callGroq`, `GROQ_API_KEYS`, `pickBestGroqFastModel`, `isGroqCapacityError`, `GROQ_MAX_TOKENS_FAST`, `GROQ_SCOUT_MODEL` | **Groq appears 0 times in HEAD** and 184 times in the stash. Groq was removed from the backend entirely. |
| 4, 5 | `isProviderHealthy` + a hardcoded `['deepgram','googleSTT','elevenlabs']` order | Drops **Soniox**, the live-verified first-choice realtime STT, and ignores `sttFallbackProviderEligible` / `nextSTTProvidersAfter` / `sttProviderUsableForFailover`. |
| 6, 7 | `MAX_MESSAGE_CHARS` at the call site | Not defined at that scope in HEAD; HEAD uses `DEEPSEEK_MSG_CHAR_CAP` (imported from `lib/deepseekProvider.js`) at 9+ sites. |

The stash — `stash@{0}: "pre-cleanup natively-api dirty state from PR247 integration"` —
predates the Groq removal, the MiniMax-M3 promotion, and the Soniox STT promotion.

**How it was done, and what was preserved.** `git checkout --ours server.js` was NOT used:
that restores index stage 2 and would have discarded both the stash hunks that applied
cleanly AND the Campaign 1 edits. Instead the 7 marker blocks were stripped in place,
keeping the upstream side. Verified afterwards:

* byte-identical to the scratchpad copy that had already passed `node --check`;
* all 6 Campaign 1 edit sites still present;
* the cleanly-applied stash work survived — 338 lines still differ from HEAD, e.g. the
  escalating-backoff `BACKOFF_MS` block, which HEAD does not have;
* `embedTelemetry` still defined (21 occurrences), `Groq` 0, no conflict markers.

**Two harmless leftovers**, both introduced by cleanly-applied stash hunks and left alone
rather than "tidied" inside someone else's in-flight work:

* `MAX_MESSAGE_CHARS` — declared as a local `const` at two call sites (~5641, ~5853) and
  never read, because the usage lines resolved to `DEEPSEEK_MSG_CHAR_CAP`. Dead, not broken.
* `isProviderHealthy` (~5002) — now an unused function, since conflicts 4/5 kept the
  Soniox-aware helpers.

**`stash@{0}` was deliberately NOT dropped.** A conflicted `git stash pop` retains the
stash, so the original work is still recoverable in full. Dropping it is the owner's call.

The conflict is also still marked `UU` in the index — the file content is fixed, but
`git add natively-api/server.js` is needed to mark it resolved. Left undone on purpose:
staging is the owner's decision, and it must happen in the same commit as
`lib/licenseLedger.js` (see the tracked-tree note in "Rollout").

<details>
<summary>Original blocker description (kept for the record)</summary>

`natively-api/server.js` **does not parse.** It carries 7 unresolved
`<<<<<<< Updated upstream` / `>>>>>>> Stashed changes` conflict blocks from a failed
`git stash pop` that predates this work. `node --check server.js` fails.

Working-tree line numbers of the conflict blocks:
`2991`, `4291`, `4609`, `5110`, `5141`, `5724`, `5960`.

Enclosing context of each:

| Line | Inside |
|---|---|
| 2991 | Embedding model constants |
| 4291 | `routeChat()` |
| 4609 | Streaming AI routing |
| 5110 | `pickSTTProvider()` |
| 5141 | `pickNextSTTProvider()` |
| 5724 | `app.post('/v1/chat')` |
| 5960 | `app.post('/v1/chat/completions')` |

This is **someone else's uncommitted work** in the file containing every billing
chokepoint. It was NOT resolved by this campaign and must not be resolved blind.
A verbatim copy of the conflicted file is preserved at
`<session scratchpad>/server.js.conflicted.bak` (md5 `3acfb6ac1bc233ea4bddefb766547925`).

**Consequences and the workaround adopted:**

* All Phase 0 line numbers below refer to **`git show HEAD:server.js`** (11,659 lines,
  parses clean), *not* the working tree. Working-tree numbers are offset by roughly
  +150–180 lines below line 5000 and will churn again when the conflict is resolved.
* None of Campaign 1's server.js edit sites fall inside a conflict block — see
  "Architectural decisions made" → D6.
* Syntax validation of edits is done by mechanically resolving the 7 conflicts
  **in a scratchpad copy only** (both directions: all-ours and all-theirs) and running
  `node --check` on each. The working tree is never resolved.

</details>

---

## Repository facts discovered

All server.js line numbers are from `git show HEAD:server.js` unless stated otherwise.
`natively-api` is a **git submodule** with its own history (branch
`fix/bound-interactive-stream-output`, HEAD `d38c22b`).

### CURRENT ARCHITECTURE

* Backend: single-file Fastify app, `natively-api/server.js` (~11.7k lines at HEAD),
  plus `natively-api/lib/*.js` helper modules and `natively-api/services/stt-relay/`.
* Deps are deliberately thin: fastify, @fastify/{cors,rate-limit,websocket},
  fastify-raw-body, @supabase/supabase-js, undici, ws, sharp, @google-cloud/speech,
  dotenv. **No ORM, no migration runner** — migrations are hand-applied `.sql` files.
* Migrations: `natively-api/migrations/00N_*.sql`, currently 001–007. Convention is a
  long `--` header explaining *why*, `CREATE TABLE IF NOT EXISTS`, `COMMENT ON TABLE`,
  `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated`.
* Tests: `natively-api/tests/*.test.mjs` run by `npm test` → `node --test tests/*.test.mjs`.
  Pure-logic reference-model tests also live in `migrations/__tests__/`.

### A USAGE LEDGER ALREADY EXISTS (biggest deviation from the plan)

* `migrations/007_usage_ledger.sql` — table `usage_events`, committed in `3f1f2b3`
  ("feat: implement usage ledger for billable event tracking with buffered async
  persistence"), merged to `main`.
  Columns: `event_id`, `idempotency_key UNIQUE`, `request_id`, `occurred_at`, `user_id`,
  `trial_id`, `api_key_fingerprint`, `plan`, `endpoint`,
  `feature CHECK (feature IN ('ai','search','embedding','stt'))`, `provider`, `model`,
  `outcome`, `prompt_tokens`, `completion_tokens`, `search_credits`, `embedding_tokens`,
  `stt_seconds`, `entitlement_units NOT NULL DEFAULT 1`, `duration_ms`, `created_at`.
  RLS on; `REVOKE ALL … FROM anon, authenticated`. Comment recommends 400-day retention.
  **No cleanup job exists** — the retention is advisory only, nothing deletes.
* `lib/usageLedger.js` (220 lines) — `ledgerEnabled()`, `fingerprint()`, `recordUsage()`,
  `ledgerStats()`, `flushOnce()`, `startUsageLedger()`, `createUsageSink()`,
  `buildUsageEvent()`. Bounded buffer 5000 / flush 5s / batch 500, lossy-on-full with a
  drop counter, `unref`'d timer, never throws into a caller, inert unless
  `USAGE_LEDGER_ENABLED=1|true`. Flush is an upsert on `idempotency_key` with
  `ignoreDuplicates: true`.

### CURRENT BILLING CHOKEPOINTS (all already ledger-instrumented)

| Function | HEAD line | Ledger write |
|---|---|---|
| `billAI(auth, meta)` | 2422 | yes — one row **per cascade attempt**; only the winner carries `entitlement_units: 1`, earlier legs are `entitlement_units: 0, outcome: 'failover'` |
| `billSearch(auth, meta)` | 2518 | yes — `feature: 'search'`, `search_credits: 1` |
| `recordSttCost(auth, segments, units, endpoint)` | 2585 | yes — per-provider cost rows |
| `billSTTSeconds(auth, trialTok, seconds)` | 2596 | returns units deducted; caller records |

Critical existing invariant, preserved: the ledger write is **last** in each `bill*`
function, so quota-exhausted and RPC-missing early returns record nothing. Recording them
would overstate usage in the table refunds are computed from.

### CURRENT LICENSE IDENTITY PATH

* `authenticate(req, ip)` — HEAD 2387. Dispatches to `validateKey(key, ip)` (HEAD 2723)
  when the key has `KEY_PREFIX`, else `validateTrial(trial, ip)`.
* Paid identity: `auth.user.id` (uuid, `api_keys.id`). Trial identity: `auth.trial.id`
  (uuid, `free_trials.id`). `auth.isTrial` discriminates. `getOwnerId(auth)` (HEAD 2415)
  returns a stable owner string.
* `auth.plan` carries the resolved plan limits; `auth.user.plan` the plan name.
  `PLAN_ALIASES = { starter: 'standard' }` (HEAD 5435), `PRO_PLANS = {pro,max,ultra}`.
* Synthetic local-test user: `auth.user.__localTest` — never billed, must never be ledgered.

### CURRENT DODO WEBHOOK FLOW

* `registerWebhookRoute(path, handler, secret)` — HEAD ~9999. Registers
  `/webhooks/dodo/api` → `handleApiWebhookEvent` (HEAD 10599) and
  `/webhooks/dodo/pro` → `handleProWebhookEvent` (HEAD 10398), with per-route secrets.
* Order inside the route: (1) `verifyDodoSignature` — fails closed on an unset secret;
  (2) three-step dedup — synchronous memory check, synchronous memory *claim* before any
  await, then `processed_webhooks` DB check keyed `${path}:${webhook-id}`; (3) persist the
  dedup row **before** replying; (4) `reply.send({ok:true})` immediately (Dodo's timeout is
  15s); (5) `setImmediate(() => processWebhookWithRetry(...))`.
* `/webhooks/dodo` (unsuffixed) is deprecated → 410 + hourly Telegram page.
* Event types handled: `payment.succeeded`, `payment.failed`, `subscription.active`,
  `subscription.renewed`, `subscription.cancelled`, `subscription.expired`,
  `subscription.on_hold`, `subscription.failed`.
* Dedup TTL `WEBHOOK_ID_TTL` = 24h; a housekeeping sweep purges `processed_webhooks`
  older than 25h (HEAD 1661). **Note for Campaign 3 backfill: `processed_webhooks` is
  purged after ~25 hours, so it is NOT a historical archive of payment events.**
  Lifecycle history must come from `pro_licenses` / `api_keys` instead.

### CURRENT TELEMETRY

* `lib/telemetry.js` — unified fire-and-forget Axiom + PostHog + Sentry sender. Every
  sender no-ops when unconfigured, never throws, 3s AbortSignal, reads env lazily per
  call, ships only hashed identities + metadata. This is the model the new writer follows.
* `ledgerStats()` is already exposed on the health/stats route (HEAD 5295).
* `logWebhookEvent(body)` records raw webhook events for the admin webhook log.

### CURRENT DATA RETENTION

* No scheduled cleanup exists for any table. `pg_cron` is **not confirmed installed** —
  `migrations/003_stt_durable_billing.sql:619-624` ships its reaper schedule *commented
  out* behind an `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')` guard,
  with "otherwise schedule from the control plane" as the documented fallback. Migration
  008 follows exactly that pattern.
* `processed_webhooks` is swept to 25h by the control-plane housekeeping loop.

### CURRENT PRIVACY CONSTRAINTS

* `PRIVACY.md` exists at the repo root and must be diffed before production collection is
  enabled (release gate — §29 of the spec, §9 of the architecture doc).
* Existing ledger already commits, in a `COMMENT ON TABLE`, to holding no prompts,
  completions, transcripts, API keys or unredacted personal data. The new table makes the
  same commitment and must not weaken it.

### CURRENT BYOK PATHS

Client-side; not yet mapped in depth (Campaign 2 owns this). Server-side the only BYOK
signals available are `/v1/pro/verify` (HEAD 5437) and `/v1/usage` (HEAD 5411) — both
authenticate and neither performs any metered work.

### RECOMMENDED INTEGRATION POINTS (Campaign 1)

1. `registerWebhookRoute`, immediately after the dedup block and **before**
   `reply.send({ok:true})` — one hook covers both Dodo routes. HEAD ~10062.
2. `/v1/pro/verify` after `validateKey` succeeds — HEAD 5448.
3. `/v1/usage` after `authenticate` succeeds — HEAD 5415.

### CONFLICTS WITH THE ORIGINAL PLAN

See "Known deviations from spec" below.

---

## Architectural decisions made

**D1 — `usage_events` is not modified; a sibling table is added.** (2026-08-13)
*Rationale:* `feature CHECK (feature IN ('ai','search','embedding','stt'))` cannot express
`license_activity` or `app_started`, and `entitlement_units int NOT NULL DEFAULT 1` means a
non-billable row landing in that table with the default **inflates the consumption figure
refunds are computed from**. Extending the CHECK constraint would weaken a live billing
invariant to serve a reporting need. New table: `license_usage_events` (migration 008).

**D2 — metered events are NOT duplicated into the new table.** (2026-08-13)
*Rationale:* mirroring every billable operation would create a second record of the same
fact that can drift, and a dispute report whose two internal sources disagree is worse than
one with a single source. Instead `usage_events` **is** the `metered` provenance, projected
into the common event schema by the read-only view `license_ledger_unified`, where `source`
is a constant and `event_type`/`event_status` are derived deterministically. A view cannot
drift from the table it reads. This also avoids tens of millions of duplicate rows over the
8-year window. Consequence: §8 of the spec ("add ledger writes to `billAI` …") is satisfied
by the **pre-existing** `recordUsage` calls, not by new ones.

**D3 — `usage_events` retention rises from 400 days to 8 years.** (2026-08-13)
*Rationale:* it is now the `metered` layer of a financial record and cannot expire before
the record it belongs to. The 400 days was a recommendation in a comment, never enforced —
no cleanup job existed, so nothing is being deleted today and no data is lost by the change.

**D4 — webhook identity is anchored on the HMAC signature, not on `auth`.** (2026-08-13)
*Rationale:* §1 of the spec ("resolve identity from `auth.user.id`") assumes an
authenticated client. A webhook has no `auth` context; its trust anchor is
`verifyDodoSignature` plus the `processed_webhooks` dedup, both of which run **before** the
hook fires. Rows are `source = system` and carry the Dodo correlation keys
(`dodo_payment_id`, `dodo_subscription_id`, `subject_email`) rather than a fabricated
`license_id`. `license_id` is resolved where it can be, left null where it cannot.

**D5 — `event_id` for payment events is `dodo:<webhook-id>`.** (2026-08-13)
*Rationale:* §5 requires the live hook and the Campaign 3 backfill to derive the same id
from the same Dodo event so they can never double-write. Since Dodo fans the same
`webhook-id` out to every configured endpoint, the id is scoped by route exactly as the
existing dedup key is: `dodo:<path>:<webhook-id>`.

**D6 — Campaign 1 touches no conflicted region of server.js.** (2026-08-13)
*Rationale:* the three integration points (HEAD 5415, 5448, ~10062) all sit outside the 7
conflict blocks. The `bill*` chokepoints (HEAD 2422–2596) are already instrumented and are
also outside. So Campaign 1 is fully deliverable without touching the failed stash pop.

**D7 — retention is enforced by a `SECURITY DEFINER` function, scheduled opportunistically.**
(2026-08-13) *Rationale:* §21 requires that the application runtime hold no DELETE right.
`ledger_retention_sweep()` is owned by the privileged role and is the only path that
deletes. It is scheduled via `pg_cron` when the extension is present and is otherwise
callable from the existing control-plane housekeeping sweep — the same pattern
`003_stt_durable_billing.sql` already uses for the STT reaper.

---

## Known deviations from spec

1. **§3 table name.** The spec suggests `license_usage_events`; that name is used. But the
   spec assumed it would be the *only* Layer-A table. It is not — see D1/D2. Layer A is
   `usage_events` + `license_usage_events` + the `license_ledger_unified` view.
2. **§8 "add usage ledger writes to `billAI()` / `billSearch()` / `billSTTSeconds()`".**
   Already done, before this campaign, by commit `3f1f2b3`. Campaign 1 verifies and
   documents rather than duplicating. See D2.
3. **§31 backfill source `processed_webhooks`.** That table is purged to 25 hours by the
   housekeeping sweep, so it is not a historical archive. Campaign 3 must source payment
   lifecycle history from `pro_licenses` / `api_keys` instead, and must record honestly
   that pre-instrumentation webhook history is **unrecoverable**.
4. **§28 `pg_cron`.** Not confirmed installed on the Supabase project. Handled with the
   guarded pattern already used by migration 003 rather than assumed.
5. **Blocked/unblocked.** Nothing in Campaign 1 is blocked by the server.js conflict
   (D6), but nothing in server.js could be *executed* to verify it either — see
   "Validation" in the campaign report.

### OPEN gaps — §8/§7 asks that the pre-existing instrumentation does not satisfy

D2 says §8's "add ledger writes to `billAI` …" is satisfied by commit `3f1f2b3`. That is
true of the *writes*. It is **not** true of two things §8 and §7 also ask for, and both
are still open. They are not defects introduced by Campaign 1 — they predate it — but they
must not hide behind a ticked checkbox.

* **O1 — the request-correlation chain has a hole.** §4 wants
  `license → app session → feature session → request → event`. `buildUsageEvent`'s own
  comment records that **two of the four billing call sites have no request id in scope**
  and default to a fresh UUID. Metered rows from those two sites therefore cannot be
  correlated to a request, a session, or each other. Fixing it means threading `reqId`
  into those call sites — a `server.js` change inside regions the stash conflict currently
  touches, which is why it was not attempted here.
* **O3 — `usage_events` (007) is UPDATE/DELETE-able by the runtime.** CONFIRMED by
  probing the live database on 2026-08-13, not inferred. Supabase's bootstrap runs
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon,
  authenticated, service_role`, so every table in `public` is born with full privileges
  for all four roles, and 007 never revoked them. §21's append-only guarantee therefore
  does not hold for the metered ledger today. 008 had the identical defect and is fixed
  (see `008a_license_ledger_revoke_service_role_writes.sql`); 007 was deliberately NOT
  changed in the same breath, because narrowing privileges on a table sitting on the live
  billing path is a production behaviour change that deserves its own decision and its own
  flush-path verification. The fix, when taken, is one statement:
  `REVOKE UPDATE, DELETE, TRUNCATE ON usage_events FROM service_role;` — safe because
  `lib/usageLedger.js` flushes with `ignoreDuplicates: true`, which PostgREST issues as
  `INSERT … ON CONFLICT DO NOTHING` and which needs INSERT alone.
* **O2 — metered rows carry no entitlement state.** `license_ledger_unified` projects
  `NULL::text AS entitlement_state` for the entire metered half, because `usage_events`
  stores `plan` but no state. So §7's "was the licence valid at `event_ts`?" is currently
  unanswerable for metered rows. **Campaign 3's entitlement-boundary tests will hit this.**
  Options: add an `entitlement_state` column to `usage_events` and populate it in
  `buildUsageEvent`, or reconstruct state from lifecycle rows in `license_usage_events` at
  report time. The second is preferable — it does not touch the billing ledger — but it
  only works for periods after Campaign 1's webhook hook went live.

### Campaign 2 prerequisites discovered while building Campaign 1

* **P1 — batch flushes are poison-pill-prone.** `flushOnce` upserts 500 rows at a time. A
  single row Postgres rejects fails the whole batch, which requeues and fails again,
  halting ingestion behind nothing but a climbing `flushErrors`. `lib/usageLedger.js` has
  the same shape and has been fine because its rows are built server-side from a fixed
  shape — but Campaign 2's rows originate from client input. Before
  `BYOK_CLIENT_EVENTS_ENABLED` is set, `flushOnce` needs either a split-batch-on-failure
  retry or a quarantine path for individually rejected rows.
* **P2 — `recordLicenseEvent` is not a validation boundary.** It re-checks `source` and
  the required keys, but not `event_status`, and it does not construct `event_ts`. Those
  guarantees come from `buildLicenseEvent`. **Campaign 2's `/v1/usage/audit` handler must
  never call `recordLicenseEvent` with a parsed request body** — it must go through the
  allowlist schema and then `buildLicenseEvent`, which is what forces server time and
  refuses an unknown provenance.
* **P3 — a `client_reported` row legitimately has no `client_event_ts`.** The §9 B2
  payload does not carry one. An earlier draft of migration 008 had a CHECK requiring it;
  it was removed before shipping (see the comment in the migration and the regression test
  `no constraint requires a client timestamp on a client_reported row`). Do not
  reintroduce it.

---

## Files produced by Campaign 1

| File | Status |
|---|---|
| `docs/usage-ledger-architecture.md` | new |
| `docs/usage-ledger-progress.md` | new (this file) |
| `docs/usage-ledger-privacy-diff.md` | new — release gate, not applied |
| `natively-api/migrations/008_license_usage_ledger.sql` | new — **not applied to any DB** |
| `natively-api/lib/licenseLedger.js` | new |
| `natively-api/tests/licenseLedger.test.mjs` | new — 50 tests, all passing |
| `natively-api/server.js` | edited at 4 sites, all outside the conflict blocks |

`server.js` edit sites (import block, boot, stats route, `/v1/usage`, `/v1/pro/verify`,
`registerWebhookRoute`). No conflict block was read, resolved, moved, or touched; the
count is still 7.

## Validation performed

* `node --test tests/licenseLedger.test.mjs` → **50/50 pass**.
* Neighbouring pure-logic suites re-run together with it (clientIdentity,
  cancellation-policy, envKeyAudit, auth-failure-classifier) → **99/99 pass**, no regression.
* `node --check` on `lib/licenseLedger.js` → clean.
* `node --check` on `server.js` **with the 7 conflicts mechanically resolved in a
  scratchpad copy, in BOTH directions (all-ours and all-theirs)** → both parse. The
  working tree itself was never resolved.
* **NOT run:** the full `npm test`. It is `node --test tests/*.test.mjs` over a directory
  containing networked benchmark and e2e files; it did not terminate and was killed. Do
  not read this as "the full suite passes".
* **Migration 008 applied to `fvflvlobvwbywjhzifng` (customer DB) on 2026-08-13** and
  verified live with `node scripts/verify-usage-ledger-schema.mjs` (read-only; no row is
  written — privilege probes use zero-row predicates, which Postgres rejects at plan time).
  Result: table, view (UNION executes), all 36 columns, `anon` blocked from all three
  relations, `ledger_pseudonymize_license` not callable by the runtime. **Two failures:
  `service_role` could UPDATE and DELETE the ledger — the defect that produced 008a.**
* **008a applied 2026-08-13. Re-verified: 10 passed / 0 failed / 1 warned.** The append-only
  guarantee of §21 now holds for `license_usage_events` and is confirmed by probe rather
  than by reading the migration. The single remaining warning is O3 (`usage_events`),
  deliberately left unfixed. Re-run `node scripts/verify-usage-ledger-schema.mjs` after any
  future migration touching either ledger — it is cheap, read-only, and it is the only
  check that catches a privilege that was never actually removed.
* Local Postgres/Docker were unavailable, so the SQL was never executed *before* it went
  to the live project. The static UNION arity test caught nothing that mattered; the live
  probe caught a defect no amount of re-reading the SQL would have. **Lesson worth keeping:
  a `GRANT` in a migration says nothing about what was already granted.**

## Rollout — exact next steps

1. Resolve the `server.js` stash conflict (owner's call — not this campaign's).
2. Apply `natively-api/migrations/008_license_usage_ledger.sql` in the Supabase SQL
   editor for project `fvflvlobvwbywjhzifng` (the CUSTOMER database — `usage_events` lives
   there, and the view cannot reference a table in another project). **DONE 2026-08-13.**
2b. Apply `008a_license_ledger_revoke_service_role_writes.sql`. Required for any database
   where 008 was applied before the grant fix — see O3. **Verify afterwards by re-running
   the probe: `service_role` must be unable to UPDATE or DELETE `license_usage_events`.**
3. Confirm `security_invoker = true` was accepted on the view. If that statement errored,
   **stop** — do not drop the option to make it apply; it is what prevents the view from
   handing `anon` what the REVOKE just took away. **DONE — verified: `anon` is blocked
   (42501) from both the table and the view.**
4. Check whether `pg_cron` exists. If it does, uncomment §7 of the migration. If not,
   call `ledger_retention_sweep()` from the control-plane housekeeping sweep.
5. Deploy. With `LICENSE_LEDGER_ENABLED` unset the new code is inert.
6. Apply the `PRIVACY.md` diff (`docs/usage-ledger-privacy-diff.md`). **Release gate.**
7. Set `LICENSE_LEDGER_ENABLED=1`. Watch `licenseLedger` on `GET /admin/health-detail`:
   `dropped` and `flushErrors` should stay at 0; `rejected` and `unknownType` should be 0
   in Campaign 1 (every writer is server-side and uses the taxonomy module).
8. Verify event quality before Campaign 2 — provenance distribution, and that
   licence-activity volume matches roughly one row per active licence per 6h.

## Next session starting point

**Campaign 1 is code-complete. Campaign 2 (Phases 4–5) is next.**

Read the blocker section at the top of this file first, then spot-check that these still
exist before trusting the rest: `natively-api/lib/licenseLedger.js`,
`migrations/008_license_usage_ledger.sql`, and `journalLicenseActivity` in `server.js`.
Only re-run full forensics if they do not.

Exact first action for Campaign 2: map the Electron client's existing local SQLite layer
(initialization, migration mechanism, main-process access path) — Phase 4 mandates the
outbox reuse it rather than introducing a new persistence engine. Campaign 1 did not map
the client at all; that forensics is genuinely still owed. Then build `POST /v1/usage/audit`
with the strict allowlist schema (§10) and per-licence rate limits (§34).

Campaign 2 must also produce its own `PRIVACY.md` pass: the `install_id`, `device_id_hash`,
`app_version`, `platform`, session-id and product-feature columns exist in migration 008 but
have **no writer** until Campaign 2, and `docs/usage-ledger-privacy-diff.md` deliberately
covers Campaign 1 only.

---

# CAMPAIGN 2 — Client BYOK outbox (Phases 4–5) — 2026-08-14

## Client forensics (the pass Campaign 1 explicitly still owed)

* **Local SQLite layer:** `electron/db/DatabaseManager.ts` — singleton `getInstance()`,
  `natively.db` under `app.getPath('userData')` (overridable with `NATIVELY_TEST_USERDATA`),
  `PRAGMA user_version` migration blocks, WAL with an explicit `checkpoint()` on shutdown.
  Never throws from its constructor; degrades to `db: null` and every public method guards.
  **Schema was at v26; the outbox is v27.**
* **Driver:** `better-sqlite3` 12.11.1 (+ `sqlite-vec`), rebuilt against Electron's ABI by
  `scripts/rebuild-native-electron.js`. No second persistence engine was introduced.
* **Install identity:** `getOrCreateInstallId()` in `services/InstallPingManager.ts` already
  provides exactly what §15 asks for — a random per-install UUID in `install_id.txt`,
  explicitly not derived from hardware. Reused rather than reinvented.
* **Auth to the backend:** `x-natively-key` header, key from
  `CredentialsManager.getInstance().getNativelyApiKey()`, base URL `NATIVELY_API_URL`.
  `services/ReviewService.ts` was the template.
* **Typecheck reality:** the root `tsconfig.json` includes only `src` and `premium/src`, and
  `tsconfig.node.json` only `vite.config.mts`. **Neither covers `electron/`.** The real gate
  is `npm run typecheck:electron` (`electron/tsconfig.json`). Anything claiming the Electron
  code typechecks must have run that command.

## What was built

| File | |
|---|---|
| `natively-api/lib/usageAuditSchema.js` | new — strict allowlist (§10) |
| `natively-api/migrations/009_operational_telemetry.sql` | new — Layer B, **NOT YET APPLIED** |
| `natively-api/lib/licenseLedger.js` | extended — Layer B buffer sharing the one flush timer |
| `natively-api/server.js` | `POST /v1/usage/audit` + `byokClientEventsEnabled()` |
| `natively-api/tests/usageAudit.test.mjs` | new — 28 tests |
| `electron/db/DatabaseManager.ts` | v27 migration + 7 outbox methods |
| `electron/services/UsageOutbox.ts` | new — durable dispatcher |
| `electron/services/usageInstrumentation.ts` | new — feature lifecycle + failure classification |
| `electron/main.ts` | outbox started after credentials load |
| `electron/ipcHandlers.ts` | `generate-what-to-say` instrumented |
| `electron/services/__tests__/UsageOutbox.test.mjs` | new — 16 tests, real SQLite |
| `electron/llm/WhatToAnswerLLM.ts` | fixed a pre-existing TS7005 that broke the build |

## Architectural decisions (Campaign 2)

**D8 — the allowlist constrains every free string to an identifier charset with NO SPACES.**
*Rationale:* length limits and sensitive-key blocklists both fail open. A prompt, a résumé
line and a transcript all contain spaces; `/^[A-Za-z0-9_.:@/-]{1,64}$/` makes the endpoint
*structurally* unable to carry prose, so it cannot become an exfiltration channel even if a
future call site is careless. Verified live: `metadata: {note: 'a whole sentence…'}` rejected.

**D9 — partial batch acceptance.** *Rationale:* the client's outbox deletes on ACK. Rejecting
a 100-event batch because one event is malformed would either lose 99 good events or wedge
the queue retrying a poison row forever. Accepted events ingest, rejected ids come back, the
client drops exactly those.

**D10 — one endpoint, two layers, routed by a `layer` field.** *Rationale:* one outbox, one
rate limit, one auth path. The rows still land in different tables with different retention,
and a test asserts telemetry never reaches the evidence ledger.

**D11 — a disabled ingestion returns 503, not 200.** *Rationale:* 200 makes the client ACK
and delete events that were never stored. The kill switch must not destroy the data it is
protecting.

**D12 — telemetry flush failures DROP; ledger flush failures RE-QUEUE.** *Rationale:* 45-day
diagnostics are not worth holding process memory for. Ledger rows are evidence.

**D13 — `feature` is only named for BUILT-IN modes.** *Rationale:* users rename modes freely.
Reporting a custom mode called "Technical Interview" as a `technical_interview` execution
would be a guess printed as a fact (§31). Custom modes report `mode_execution`.

**D14 — an uncategorised error is attributed to `natively`, not `unknown`.** *Rationale:* a
dispute report must never imply a provider was at fault when the truth is we could not tell.

## Bugs this campaign's own verification caught

1. **`ipcHandlers.ts` used a top-level `ModesManager`** that is never imported there (every
   other call site `require`s it locally), and a `../services/` path where the file needs
   `./services/`. Both sat inside a try/catch, so instrumentation would have **silently never
   fired**. Found by running the real typecheck, not the default one.
2. **`UsageOutbox` statically imported `getOrCreateInstallId`**, and `InstallPingManager`
   calls `app.getPath()` at *module load*. Importing the outbox in any non-Electron context
   threw. Now a cached lazy `require`, matching `HindsightManager`.
3. **Two early returns in `generate-what-to-say` return `answer: null` + `error`.** A blanket
   `finally { completed() }` recorded them as successful executions — precisely the "implied
   successful delivery" §6 forbids. Now explicitly `failed()`, with the `finally` as an
   idempotent safety net.

---

# CAMPAIGN 3 — Backfill + reporting (Phases 6–8) — 2026-08-14

## What the historical data can and cannot prove (probed, not assumed)

§31 assumes `request_logs` and the `stt_*` tables can be mined. Probed against production:

| Source | Reality | Imported? |
|---|---|---|
| `request_logs` | **0 rows** | no — nothing there |
| `stt_sessions`, `stt_usage_events` | **0 rows** | no — nothing there |
| `processed_webhooks` | 376 rows, columns are `(webhook_id, processed_at)` **only** | **no** — the event TYPE is unknowable; importing would mean inventing whether each was a purchase, renewal, cancellation or refund. Also purged to ~25h, so not an archive |
| `pro_licenses` | 1004 rows with `purchased_at` + `dodo_payment_id` | yes → `payment_succeeded` |
| `api_keys` | 1502 rows with `created_at` | yes → `license_activated` |
| `free_trials` | 2259 rows | yes → `license_activated` (+ `license_expired` only where already expired) |
| `usage_events` | **20,342 rows — already live** | **no** — already reaches reports via `license_ledger_unified`; copying would double-count every metered operation |

**Pre-instrumentation payment history is unrecoverable.** That is stated in the tool's output
on every run rather than quietly omitted.

**D15 — the backfill takes a `--before` cutoff, defaulting to the earliest live `system` row.**
*Rationale:* a `pro_licenses` row and a live webhook describe the same purchase but carry
different identities, so their deterministic ids *cannot* collide. Without a cutoff, anyone
who purchased after the webhook hook went live would get the event twice. The cutoff is what
actually delivers §5's no-double-write guarantee for this source.

## Backfill result (APPLIED to production 2026-08-14)

7,024 rows written, all `source = historical_import`. **Idempotency verified by re-running:
7,024 → 7,024, unchanged.** `license_ledger_unified` now returns **27,367 rows** across both
layers, which is also the first proof the view executes correctly at real scale.

## Reporting

* `lib/evidenceReport.js` — pure aggregation, canonical serialization, SHA-256 over the
  **event set** (not the rendered document, so formatting changes do not look like tampering).
* `lib/evidenceReportPdf.js` — **pdfkit 0.19.1**, pure JS. No Puppeteer/Playwright/Chromium;
  a test asserts none is a dependency.
* `lib/evidenceQuery.js` — paged (1000/page, 200k ceiling, truncation reported not silent),
  scoped to one resolved licence, lookup by licence id / email / payment id / subscription id.
* `GET /admin/usage-report` (JSON + `format=pdf`) and `GET /admin/usage-summary` (§43
  aggregates only, no raw payloads). Report generation is logged as an **admin** event with
  actor, report id and hash — never into the customer's ledger (§26).

**D16 — the report object has no `total` field, by construction.** *Rationale:* the single
rule this report exists to enforce is that provenances are never summed. A `total` field
would eventually be printed. `usage` has exactly five keys, one per provenance, and a test
asserts that set never grows.

## Live end-to-end run

`natively-api/tests/usageLedgerLiveE2E.mjs` boots the real server against the real Supabase
project with every flag on, drives the real HTTP endpoints with a real (disposable, deleted
afterwards) licence, and reads the rows back. **22 of 24 checks passed**; the 2 failures were
both diagnosed and are not defects in the system:

* `operational_telemetry_events` missing → **migration 009 is not applied yet.**
* the replay assertion queried before the 5s flush landed (the row *was* singular). Fixed:
  a 13s flush wait, and a precondition check that names a missing migration explicitly
  instead of surfacing it as a bogus row-count failure.

Proven live: licence-activity journalling and its 6h debounce (6 calls → 1 row), client batch
ingestion routed to both layers, **all six hostile payload shapes rejected**, replay collapsing
to one row, identity bound to the authenticated licence, server time authoritative, telemetry
not leaking into the ledger, report + PDF + reproducible digest, admin authorisation
(unauthenticated 401, customer key 401), and **the running service unable to rewrite ledger
history**.

## Test totals

| Suite | |
|---|---|
| `natively-api` — licenseLedger + usageAudit + evidenceReport | **109 pass / 0 fail** |
| `electron` — UsageOutbox (real SQLite, Electron runner) | **16 pass / 0 fail** |
| `npm run typecheck:electron` | **clean** |
| live E2E | 22/24, blocked only on migration 009 |

## Next action

1. Apply `natively-api/migrations/009_operational_telemetry.sql` in the Supabase SQL editor
   (project `fvflvlobvwbywjhzifng`).
2. Re-run `node natively-api/tests/usageLedgerLiveE2E.mjs` — expect 24/24.
3. Apply the `PRIVACY.md` diff **and extend it for Campaign 2's fields** (`install_id`,
   `app_version`, `platform`, session ids, product feature names) — the existing
   `docs/usage-ledger-privacy-diff.md` deliberately covers Campaign 1 only. Release gate.
4. Then set `LICENSE_LEDGER_ENABLED`, `OPS_TELEMETRY_ENABLED`, `BYOK_CLIENT_EVENTS_ENABLED`
   (server) and `NATIVELY_USAGE_OUTBOX_ENABLED` (client).

---

## CORRECTIONS AND PRECISE SCOPE (2026-08-14, post-review)

### Live E2E: 28 passed / 0 failed (final, after migration 009)

Confirmed 2026-08-14 with 009 applied. Observed flush latencies across runs: licence
activity 5022–5537 ms, replayed client event 2597–7428 ms — comfortably inside the 40 s
poll ceiling, and the variance is exactly why this waits on a condition rather than a
fixed sleep. Layer B verified live: the telemetry row landed in
`operational_telemetry_events` carrying `{reranking_used, retrieval_count,
knowledge_source_type}` and did NOT appear in the evidence ledger.

Schema probe after 009: **14 passed / 0 failed / 1 warned** (the warning is O3).
`service_role` cannot UPDATE or DELETE `operational_telemetry_events`, and `anon` is
blocked from all four relations.

### (historical) Live E2E: 27 passed / 0 failed / 1 skipped

An earlier draft of this file claimed "22/24, blocked only on migration 009". That was
wrong on one count and is corrected here: **only one** of the two failures was migration 009.
The other was the replay assertion, and it had NOT been re-verified when that claim was
written — the fix (a longer sleep) was unrun and, worse, was the wrong shape of fix.

Rewritten to **poll on the condition** rather than sleep, which both fixed it and produced
the explanation a sleep never would:

* licence-activity row arrives after **5022 ms** (one flush interval)
* replayed client row arrives after **7428 ms** — against the old fixed 7000 ms sleep

So the original failure was a genuine race with the 5 s batched flush plus round trips, not a
flush fault. `flushErrors` is now queried from `/admin/health-detail` and reported on any
failure, so a future slow row distinguishes "still buffered" from "flush is erroring".

**O4 (open, low): every E2E run leaves ~2 append-only ledger rows referencing a licence that
was deleted at teardown.** They cannot be removed — that is the design. The run now prints
the count and the filter (`source = 'client_reported' AND install_id LIKE 'e2e-%'`) so they
can be excluded from real dispute lookups.

### Feature instrumentation coverage — EXACTLY ONE HANDLER (superseded 2026-08-15: now 9/9, see "OPEN ITEMS CLOSED")

The Campaign 2 section above says "feature instrumentation" without qualifying it. Precisely:

| Handler | Instrumented |
|---|---|
| `generate-what-to-say` (primary auto-answer) | **yes** |
| `generate-assist` | no |
| `generate-clarify` | no |
| `generate-code-hint` | no |
| `generate-brainstorm` | no |
| `generate-recap` | no |
| `generate-follow-up` / `generate-follow-up-questions` | no |
| `generate-followup-email` | no |

**Do not read §50's "feature lifecycle visible" as satisfied.** One of eight IPC answer paths
emits `feature_started`/`feature_completed`. A report built on the assumption of full
coverage would show 3 `technical_interview` executions for a user who ran 40 assists — which
is worse than showing nothing, because it looks complete. The remaining seven follow the same
three-line pattern (`trackFeature` → `failed()` on error returns → `completed()` in `finally`)
and are the first thing to do before client events are enabled in production.

### O5 — `usage_events` COMMENT corrected (was self-contradicting)

007's `COMMENT ON TABLE usage_events` still said "Recommended retention: 400 days" while
008's `ledger_retention_sweep()` deletes from it at 2922 days. On a live table holding 20,000+
billing rows, that is the schema disagreeing with itself about a financial-record question.
Corrected by a `COMMENT ON TABLE` in **migration 009** (idempotent, touches no data), which
states 8 years, names the enforcing function, and records that it supersedes 007.

### DECISION STILL NEEDED FROM THE OWNER — `docs/` is gitignored

`.gitignore:475` is `docs/*` with per-file negations; only 3 files under `docs/` are tracked.
**All three usage-ledger documents are untracked**, including this one — which the spec makes
the mandatory handoff contract, and which now carries 16 architectural decisions, 5 open
findings, and the entire forensics record for three campaigns. On a fresh clone or in a
worktree, none of it exists.

Three lines resolve it:

```
!docs/usage-ledger-architecture.md
!docs/usage-ledger-progress.md
!docs/usage-ledger-privacy-diff.md
```

Left undone because changing ignore rules is a repo-convention decision, and the privacy-diff
file contains policy language. Until then, this work is documented on one machine only.

---

# OPEN ITEMS CLOSED — 2026-08-15

All four remaining items are done. Three took effect immediately; one needs a migration run.

## 1. Feature instrumentation — 1 of 8 → 9 of 9

Every answer handler in `ipcHandlers.ts` now emits `feature_started` plus exactly one
terminal event: `generate-what-to-say`, `generate-assist`, `generate-clarify`,
`generate-code-hint`, `generate-brainstorm`, `generate-follow-up`, `generate-recap`,
`generate-follow-up-questions`, `generate-followup-email`.

**D17 — one wrapper, not nine hand-edits.** The handlers end three different ways, and the
difference is exactly the distinction §42 forbids blurring: some throw, some return
`{ error, hint: null }` (a failure that LOOKS like a normal return), and some return
`{ clarification: null }` (nothing produced, no error raised). Instrumenting each by hand
means making that judgement right nine separate times — and it was already got wrong once,
when the early returns in `generate-what-to-say` were recorded as successes until a review
caught it. `runTracked(feature, fn, { failedIf })` is now the single path, with a `failedIf`
predicate defaulting to the error-object shape. `generate-what-to-say` was migrated onto it
too, so the bespoke plumbing is gone.

Covered by 8 new tests asserting: normal return → completed; error-object → **failed**;
throw → failed *and the error still reaches the caller unchanged*; null-result → failed with
a custom predicate; exactly one terminal event; a throwing predicate cannot decide the
outcome; duration recorded; and no content or raw error message ever emitted.

**D18 — those tests run against the REAL outbox and a REAL SQLite file, not a stub.** The
first attempt stubbed `usageOutbox.record`, and it was wrong twice: a stub restored in a
`finally` misses everything the awaited work emits, and esbuild inlines modules PER ENTRY
BUNDLE, so the `usageOutbox` reachable from `usageInstrumentation.js` is not necessarily the
object a test can patch through `UsageOutbox.js`. Reading rows back out of the queue avoids
both and proves the stronger claim — that instrumentation reaches durable storage.

## 2. O3 — `usage_events` append-only → `migrations/010_usage_events_append_only.sql`

**NOT YET APPLIED — run it in the Supabase SQL editor.** Revokes UPDATE/DELETE/TRUNCATE on
the live billable ledger from `service_role`.

Safety established empirically rather than argued: `license_usage_events` has carried this
exact posture since 008a (SELECT + INSERT, no UPDATE) and `lib/licenseLedger.js` flushes it
with the identical `upsert(..., { ignoreDuplicates: true })` call, which Postgres executes as
`INSERT … ON CONFLICT DO NOTHING` and which needs INSERT alone. That path passes 28/28 live.
Also verified by grep that no UPDATE or DELETE against `usage_events` exists anywhere in the
codebase — the only writer is the flush, and the only `.delete()` is the verifier's own
zero-row probe. `ledger_retention_sweep()` is unaffected: it is SECURITY DEFINER and runs as
its owner, so it remains the single delete path.

After applying, `node scripts/verify-usage-ledger-schema.mjs` should report **0 warnings**.

## 3. `PRIVACY.md` — applied

Date bumped to 2026-08-15. §3.2 gained five rows (usage ledger, licence activity,
app-reported feature activity, app context, diagnostics) with their real retentions — 8
years for the ledger rows, 45 days for diagnostics. The closing "we do not store your
content" paragraph was extended to cover the ledger explicitly, to state that the
installation identifier is random rather than hardware-derived, and to say plainly that
app-reported activity is labelled self-reported and is **not** presented as the same kind of
evidence as what the servers observed. §9's erasure bullet now describes the actual
pseudonymisation behaviour, including that the salt is not stored and that an open dispute
defers it.

`docs/usage-ledger-privacy-diff.md` is retained as the record of what was proposed and why;
the policy itself is now the source of truth.

## 4. `docs/` tracked

Three `!docs/usage-ledger-*.md` negations added to `.gitignore:483`. All three documents are
now tracked and survive a fresh clone.

## Final verification (2026-08-15)

| | |
|---|---|
| Live E2E against production | **28 passed / 0 failed** |
| `natively-api` suites | **109 / 0** |
| Electron suite | **26 / 0** (was 18 — 8 new wrapper tests) |
| `typecheck:electron` | 1 error, **0 in usage-ledger files** (pre-existing, `IntelligenceEngine.ts`) |
| Schema probe | 14 / 0 / **1 warned** — the warning is O3, and clears when 010 is applied |

---

## O3 CLOSED — 2026-08-15

`migrations/010_usage_events_append_only.sql` applied. The runtime can no longer rewrite or
erase billing history: **18 passed / 0 failed / 0 warned.**

Two checks were added to `scripts/verify-usage-ledger-schema.mjs` while doing it, because the
reasoning behind 010 had two load-bearing assumptions and neither was tested:

**1. The metered flush still works without UPDATE.** 010 rests on the claim that
`.upsert(..., { ignoreDuplicates: true })` is `INSERT … ON CONFLICT DO NOTHING` and needs
INSERT alone. The check now exercises that exact call against the live table — re-upserting an
idempotency_key that already exists, so the conflict fires, zero rows are written, and the
statement is still planned. A missing privilege would surface exactly as it would in a real
flush. Row count asserted unchanged either side (22,371 → 22,371). This also catches anyone
later flipping `ignoreDuplicates` to false: a merging upsert needs UPDATE and would start
failing here, which is the intended alarm — an append-only ledger must never merge.

**2. The control plane keeps its read access.** natively-control reads `usage_events` for the
cost and reliability dashboards. Before applying 010 I checked what it actually is: all seven
of its calls are `.select()`, and it authenticates as a dedicated **`control_readonly`** role
— never `service_role`, which `packages/data/src/customerDb.ts` refuses to hold. So neither
line of 010 touches it. Now verified live and permanently guarded, so a future revoke aimed at
one role cannot quietly empty the dashboards by landing on another.

Building that probe surfaced a detail worth recording: **the readonly role token alone is
rejected by the gateway with "Invalid API key"** — which reads like a permissions failure and
is not one. The control plane pairs it with the publishable key (`apikey` header) and sends the
role token in `Authorization: Bearer`. The verifier now mirrors that construction exactly.

### O1–O5 status

| | |
|---|---|
| O1 — request-id correlation hole on 2 of 4 metered call sites | **open** (pre-existing) |
| O2 — metered rows carry no entitlement_state | **open** (pre-existing) |
| O3 — usage_events UPDATE/DELETE-able by the runtime | **CLOSED 2026-08-15** |
| O4 — E2E leaves ~2 append-only rows per run | open by design, filter documented |
| O5 — usage_events COMMENT contradicted the sweep | **CLOSED** (corrected in 009) |

---

# O1, O2, O4 CLOSED — 2026-08-15

## O1 — request correlation at every metered call site

`/v1/embed` and `/v1/search` had no `reqId` in scope, so `buildUsageEvent` minted a fresh
UUID per event and those rows could not be tied to a request, a session, or each other. Both
now derive one with the same rule `/v1/chat` uses (honour a well-formed inbound
`x-request-id`, otherwise mint) and pass it through.

**Deliberately NOT done: session correlation for search.** `/v1/search` has a `session_id` in
scope and passing it looks like an easy win, but `usage_events` has no session column and
`buildUsageEvent` constructs an explicit row — so it would be silently dropped. A call site
that appears to correlate sessions while doing nothing of the kind is worse than one that
plainly does not. A test asserts the argument is absent.

## O2 — entitlement state on metered rows → `migrations/012_usage_events_entitlement_state.sql`

**NOT YET APPLIED — run it in the Supabase SQL editor.**

Adds a nullable `entitlement_state` to `usage_events`, constrained to the same vocabulary
`license_usage_events` uses, and re-creates `license_ledger_unified` so the metered half
projects the real column instead of the `NULL::text` literal 008 shipped. `lib/usageLedger.js`
fills it from the same `auth` context the `bill*` helpers already hold.

**History is NOT backfilled.** Existing rows keep NULL. There is no record anywhere of what a
licence's state was on an arbitrary past day, and assuming 'active' or copying today's value
backwards would put a fabricated entitlement claim into a dispute record. NULL means "not
recorded", which is true, and reports must render it as unknown rather than as any state.

**D19 — the state is captured at WRITE time, never re-derived at report time.** Today's
`api_keys` row is not what was true then, and a dispute is always about then. A licence
suspended today may have been perfectly valid on the day in question; comparing an old event
against current state produces a confident, wrong answer.

**D20 — a deploy-ordering guard, because the failure mode is silent.** The writer now emits a
column that does not exist until 011 runs. A missing column fails the whole INSERT, and since
the flush is batched and re-queues on failure, that would not be a degraded ledger — it would
be a ledger that silently stops recording anything until someone noticed `flushErrors`
climbing. For a table that is evidence, "code deployed slightly before its migration" must not
be able to cause that. `startUsageLedger` now probes once at boot and omits the field if the
column is absent; the default is optimistic, so a correctly-ordered deploy pays nothing.

**D21 — `entitlementStateForUsage` is a deliberate COPY of the licence-ledger rule, not an
import.** `usageLedger.js` is the billing path and predates the licence ledger; making a
customer's request depend on a module it has never needed widens that module's blast radius
for no benefit. The two are eight lines and are pinned identical by a test — including the one
place they intentionally differ (no auth at all → the metered path records NULL "not
recorded"; the licence ledger answers 'unknown').

## O4 — E2E orphan rows

The E2E created a fresh licence per run and deleted it at teardown, but the ledger is
append-only, so its rows survived pointing at an id that no longer resolved. Ten runs meant
ten phantom licences someone would eventually meet during a real dispute lookup.

Now ONE standing licence (`usage-ledger-e2e@natively.invalid`), re-activated for the run and
**suspended with its secret rotated** at teardown — never deleted. All synthetic history sits
under one obviously-test identity, and the key cannot be used in between because a suspended
key fails authentication.

That change required scoping every assertion to the run's own time window: with a stable
licence, a second run inside the same 6h window would otherwise see the first run's
licence-activity row and fail "journalled exactly once" on a system working perfectly.
**Verified by running the E2E twice back to back: 28/28 both times, rows accumulating 2 → 4
under the single licence.**

## Status of all findings

| | |
|---|---|
| O1 — request-id correlation | **CLOSED** |
| O2 — entitlement state on metered rows | **CLOSED** — 011 applied 2026-08-16 |
| O3 — usage_events append-only | **CLOSED** (010 applied) |
| O4 — E2E orphan rows | **CLOSED** |
| O5 — usage_events COMMENT | **CLOSED** (009) |

## Verification (2026-08-15)

| | |
|---|---|
| `natively-api` suites | **118 / 0** |
| Electron suite | **26 / 0** |
| `typecheck:electron` | **0 errors** |
| Live E2E, run twice | **28 / 0** each |
| Schema probe | **20 / 0 / 0** after 011 was applied (2026-08-16) |
