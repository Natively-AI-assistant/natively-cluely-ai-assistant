# Natively Usage Ledger & Operational Telemetry — Architecture

> Status: Campaign 1 (server foundation). Kept in sync with the implementation.
> Companion file: `docs/usage-ledger-progress.md` (where the work stands).
> This file: what the system *is*.

---

## 1. The question this system answers

> "What actually happened when this specific Natively license was active?"

And, just as importantly, **how confident we are in each part of that answer.** A record
that cannot say where it came from is not evidence; it is a number. Every row in this
system carries an explicit provenance, and every report repeats it.

Four consumers:

1. Product reliability and debugging
2. Internal product/usage analytics
3. Fraud / abuse / billing investigation
4. Defensible first-party dispute evidence

Explicit non-goal: this is **not** a surveillance system. No prompts, completions,
resumes, JDs, transcripts, document contents, clipboard, keystrokes, screenshots, or
provider API keys are stored anywhere in it. See §9.

---

## 2. What already existed (and why the design bends around it)

The original plan assumed a greenfield ledger. It is not greenfield. `natively-api`
already ships a **billable-operation ledger**, merged and flag-gated:

| Artefact | What it is |
|---|---|
| `migrations/007_usage_ledger.sql` | `usage_events` table — append-oriented, RLS on, `REVOKE ALL … FROM anon, authenticated` |
| `lib/usageLedger.js` | Bounded in-memory buffer (5000), 5s batched flush, `unref`'d timer, lossy-under-pressure, never throws into a caller, inert unless `USAGE_LEDGER_ENABLED` |
| `billAI` / `billSearch` / `billSTTSeconds` / `recordSttCost` | Already call `recordUsage(buildUsageEvent(...))` **after** the entitlement deduction actually lands |

That existing work is good, and it is load-bearing for refund maths. It is also
**structurally unable** to hold the wider event taxonomy:

* `feature text NOT NULL CHECK (feature IN ('ai','search','embedding','stt'))` — a
  `license_activity` or `app_started` event has no billable feature.
* `entitlement_units int NOT NULL DEFAULT 1` — a non-billable event that lands here with
  the default silently **inflates consumption in the table refunds are computed from.**
* No `source`, no `event_type`, no `event_status`, no session hierarchy, no
  `app_version` / `platform` / `install_id`.

Therefore: **`usage_events` is not modified.** A sibling table carries everything it
cannot express, and a read-only view unifies the two.

---

## 3. Two layers, two retentions

### Layer A — Durable Usage Ledger (8 years)

Minimal, durable, privacy-sensitive. License history, entitlement activity, feature
lifecycle, dispute evidence, high-level product metrics.

Layer A is **two physical tables plus one view**:

```
usage_events            ← pre-existing. METERED billable operations. Untouched.
license_usage_events    ← new (migration 008). Everything usage_events cannot express.
license_ledger_unified  ← new. Read-only VIEW projecting both into one event schema.
```

### Layer B — Operational Telemetry (45 days)

Latency, provider/model, execution stages, retrieval performance, pipeline debugging.
Rich and short-lived. Delivered in Campaign 2. Never the basis of a dispute report.

**The layers share a vocabulary, not a table.** Debug events do not enter Layer A.

### Known incompleteness in Layer A, as shipped

Two things §7 and §8 ask for are not yet answerable, both inherited from the pre-existing
metered ledger rather than introduced here. They are tracked as O1 and O2 in the progress
file: metered rows from two of the four billing call sites carry no usable `request_id`,
so the correlation chain has a hole; and metered rows carry no `entitlement_state`, so
"was the licence valid at `event_ts`?" cannot currently be answered for them. Campaign 3's
reporting must not assume either is available.

---

## 4. Why no write amplification (the load-bearing decision)

The obvious design is to mirror every billable operation into the new table so that one
table answers everything. It is rejected.

* Two writes per billable operation, forever, for rows that already exist.
* Two records of the same fact that can **drift** — and a dispute report whose two
  internal sources disagree is worse than one that has a single source.
* At realistic volumes, tens of millions of duplicate rows over the retention window.

Instead, `usage_events` **is** the `metered` provenance. `license_ledger_unified`
projects it into the common event schema — `source` is the constant `'metered'`, and
`event_type` / `event_status` are *derived deterministically* from `feature` and
`outcome`. A view cannot drift from the table it reads.

Consequence, and it is deliberate: **`usage_events` retention rises from the 400 days its
comment recommended to 8 years**, because it is now a financial record (§8). Migration
008 states this; the cleanup job in §8 enforces it.

---

## 5. Provenance — the trust model

Every event declares where it came from. This is the single most important column in the
system, and it is never dropped, defaulted, or inferred at read time.

| `source` | Trust | Means | Written by |
|---|---|---|---|
| `metered` | Highest | Server observed and metered an operation Natively itself executed. | `usage_events`, via the unified view |
| `license_activity` | High for *"the app was running and the license was valid"*, **zero** for *"feature X ran"* | An authenticated Natively client called Natively. | `/v1/pro/verify`, `/v1/usage` (Campaign 1, Phase 3) |
| `client_reported` | Low — corroborating only | The desktop app says a local/BYOK feature executed. | `POST /v1/usage/audit` (Campaign 2) |
| `historical_import` | Reconstructed | Derived from pre-existing logs/tables. | Backfill (Campaign 3) |
| `system` | N/A — not user activity | Internally generated lifecycle/administrative events. | Dodo webhook hook, reports |

### The BYOK problem, stated honestly

Natively's backend meters what Natively executes. When a customer supplies their own
provider key, **Natively executes nothing and can meter nothing.** There is no server-side
observation to be had. The two available signals are:

* **B1 `license_activity`** — the authenticated app contacted us. Proves the app ran and
  the license was valid at that moment. Proves *nothing* about which feature ran.
* **B2 `client_reported`** — the app says a feature ran. The client is tamperable
  (§6), so this is corroboration, never proof.

Reports must present these separately and must never sum them into an authoritative
total. See §10.

---

## 6. Threat model

Assume a user can fully modify the desktop client: disable telemetry, intercept requests,
edit event fields, replay events, skew timestamps, fabricate counts, block the endpoint.

Controls:

| Attack | Control |
|---|---|
| Attribute activity to another license | Identity is resolved **only** from the authenticated context (`auth.user.id` / `auth.trial.id`). The request body has no license field, and one is rejected if present. |
| Replay / duplicate submission | `UNIQUE(event_id)` + upsert `ignoreDuplicates`. N submissions → 1 logical event. |
| Timestamp forgery | `client_event_ts` is stored *as a claim*; `ingested_at` is server-side and authoritative. Client time never overwrites server time. Implausible skew is flagged, not corrected. |
| Content exfiltration into the ledger | Strict allowlist schema (Campaign 2), not a sensitive-key regex. Unknown fields are rejected outright. |
| Logging DoS | Auth + per-license rate limits + payload size caps (Campaign 2). |
| Suppression | **Undetectable and unpreventable.** A tampered client can simply not report. Documented, not papered over. |

**What the server cannot detect, stated plainly:** a client that reports nothing is
indistinguishable from a client that was never run, except via `license_activity`. A
client that under-reports is indistinguishable from light usage. This is inherent to
BYOK and is the reason `client_reported` is a separate provenance rather than a merged
total.

Webhook events are the one identity path with no `auth` context. Their trust anchor is
the **Dodo HMAC signature** verified before any processing, plus the existing
`processed_webhooks` dedup. They are `source = system`.

---

## 7. Data flow

```
                    ┌─────────────────────────────────────────────┐
  Natively-routed   │  billAI / billSearch / billSTTSeconds       │
  AI / search / STT │      ↓ (after the deduction actually lands) │
                    │  recordUsage → buffer → 5s batch → PG       │──▶ usage_events
                    └─────────────────────────────────────────────┘        │  metered
                                                                            │
  /v1/pro/verify    ┌─────────────────────────────────────────────┐        │
  /v1/usage         │  recordLicenseEvent (debounced 1/license/6h)│──▶ license_usage_events
                    └─────────────────────────────────────────────┘        │  license_activity
                                                                            │
  Dodo webhook      ┌─────────────────────────────────────────────┐        │
  (post-signature,  │  recordLicenseEvent, event_id=dodo:<wh-id>  │──▶ ────┤  system
   post-dedup)      └─────────────────────────────────────────────┘        │
                                                                            │
  Desktop BYOK      ┌─────────────────────────────────────────────┐        │
  (Campaign 2)      │  SQLite outbox → POST /v1/usage/audit       │──▶ ────┤  client_reported
                    └─────────────────────────────────────────────┘        │
                                                                            ▼
                                                        license_ledger_unified (view)
                                                                            │
                                                        Campaign 3 reporting ▼
```

Both writers share one invariant: **the audit write is never on the request's critical
path**, never awaited by a user-facing handler, and can never throw into one. A telemetry
failure is an observability problem; it is never allowed to become a product outage
(§49).

---

## 8. Retention

| Data | Retention | Rationale |
|---|---|---|
| `license_usage_events` | **8 years** from event date | Natively is an Indian private limited company. Companies Act 2013 record-keeping is 8 years; GST records are 72 months from annual-return filing. The ledger doubles as billing-dispute evidence (card-network chargeback windows are ~120 days, far shorter, so the statutory window governs). 8 years covers all of them. |
| `usage_events` | **8 years** (raised from the 400-day recommendation) | Same reason. It is now the `metered` layer of a financial record; it cannot expire before the record it belongs to. |
| Operational telemetry (Layer B) | **45 days** | Debugging horizon. Not evidence. |
| Client outbox (delivered) | 7 days after ACK | Local disk hygiene. |
| Client outbox (undelivered) | Until delivered, or dropped at the queue cap | Bounded, with a drop counter. |

Enforcement: `ledger_retention_sweep()`, a `SECURITY DEFINER` function owned by the only
role holding `DELETE`. Scheduled via `pg_cron` when installed, otherwise invoked by the
existing control-plane housekeeping sweep. **Deletion/DSAR requests override retention**
(§9).

---

## 9. Privacy boundary

**Collected:** event type, status, provenance, timestamps, app version, platform,
pseudonymous install id, session ids, request id, provider/model names, counts and
durations, entitlement state, normalized failure categories.

**Never collected, at any layer:** prompt text, answer text, resume text, JD text,
meeting transcripts, document contents, clipboard, keystrokes, screenshots, raw provider
secrets, raw API keys. API keys appear only as a one-way SHA-256 fingerprint.

Device identity is `install_id` — a pseudonymous per-installation identifier. Raw hardware
identifiers are **not** collected. One license may have many installations; the schema
assumes it.

**Deletion / DSAR.** On verified account deletion, ledger rows are **pseudonymized**, not
dropped: `license_id` is replaced by a salted hash and every email / IP / device linkage is
stripped, retaining only the aggregate counts required as a financial record. Full deletion
applies where no statutory retention or active dispute requires otherwise. An active
dispute holds full records until it closes. `PRIVACY.md` must state this before collection
is enabled in production — that is a release gate, not a follow-up.

---

## 10. Report language rules

The exporter (Campaign 3) is a factual business record, not an argument.

Required forms:

> "Server records show authenticated license activity on 8 distinct calendar days."
> "Server-observed records show 42 AI requests during the entitlement period."
> "The client reported 17 Technical Interview executions."

Forbidden:

> ~~"The customer definitely used Technical Interview 17 times."~~
> ~~any total that silently merges `metered` with `client_reported`~~

`feature_started` ≠ `feature_completed` ≠ `provider_success`. These are three different
facts and are never collapsed into "used = true".

---

## 11. Rollout

```
migration 008 applied (additive; nothing reads it)
        ↓
USAGE_LEDGER_ENABLED already gates the metered layer
        ↓
LICENSE_LEDGER_ENABLED=1 → shadow: rows land, nothing reads them
        ↓
verify event quality (volume, debounce, provenance distribution)
        ↓  ── end of Campaign 1 ──
client outbox released → BYOK_CLIENT_EVENTS_ENABLED  (Campaign 2)
        ↓
reports enabled                                       (Campaign 3)
```

Kill switch: every flag is read **per call**, so ingestion can be disabled by changing an
environment variable and restarting, with no code change and no data loss beyond the
period it is off.

---

## 12. Explicitly out of scope

Hash chains, Merkle trees, public transparency logs, RFC-3161 timestamping. The only
cryptographic integrity is the SHA-256 digest over a report's canonical event set (§25 of
the spec). Chromium-based PDF rendering is also out of scope — Railway deploy size and
memory rule it out; Campaign 3 uses a pure-JS renderer.

---

## 13. Layer B, as built (Campaign 2)

`operational_telemetry_events` (migration 009). Same privacy boundary as the ledger, 45-day
retention, and **no `source` column** — deliberately. Nothing in this table is ever presented
as evidence, so there is no provenance question to answer. Reporting reads
`license_ledger_unified` and never joins to it.

Both layers share one flush timer and one ingestion endpoint (`POST /v1/usage/audit`, routed
by a `layer` field), but land in different tables with different retention and different kill
switches. A test asserts a telemetry event can never appear in the evidence ledger.

## 14. The client outbox, as built (Campaign 2)

`usage_outbox` in the app's existing SQLite database (`natively.db`, `user_version` 27) —
not a new persistence engine. The event is written to disk **before** any network attempt, so
it survives network loss, restart, sleep/wake, OS restart and a crash mid-flush.

Claiming a batch is not consuming it: rows are only marked delivered on ACK, so a process
that dies between send and ACK redelivers rather than loses. Duplicate delivery is harmless —
`event_id` is the same value in the local PRIMARY KEY, the server's `UNIQUE(event_id)` and the
upsert's `onConflict`, so a duplicate at any layer collapses to one logical event.

Bounded at 10,000 rows; past the cap the oldest **undelivered** row is dropped and counted.
Delivered rows linger as tombstones for 7 days so a late duplicate enqueue is still caught,
then compact.

## 15. What the evidence system cannot do (§36, stated plainly)

A user who modifies the desktop client can **suppress or under-report** client events. This is
undetectable and unpreventable from inside the client, and no amount of instrumentation
changes it. What survives tampering is everything the server observed independently: metered
operations, licence activity, and payment lifecycle from signature-verified webhooks.

This is the whole reason `client_reported` is a separate provenance rather than part of a
total. The report presents it as a claim, says it cannot be independently verified, and never
adds it to anything.

Verified adversarially: a flood of 5,000 fabricated client events, each claiming 1,000
entitlement units, moves no server-observed figure at all — it only inflates its own bucket,
which is labelled unverifiable.

## 16. Reporting, as built (Campaign 3)

* Lookup by licence id, email, Dodo payment id, or Dodo subscription id — because a card
  network hands you a payment id, not a licence id.
* Output: JSON and PDF (**pdfkit**, pure JS — no Chromium, asserted by test).
* SHA-256 over the canonical **event set**, not the rendered document, so re-wording a
  heading does not look like tampered evidence.
* The report object has **no `total` field**, by construction. `usage` has exactly five keys,
  one per provenance, and a test asserts that set never grows.
* Report generation is itself audited — actor, report id, hash — into the **admin** trail,
  never the customer's ledger.
