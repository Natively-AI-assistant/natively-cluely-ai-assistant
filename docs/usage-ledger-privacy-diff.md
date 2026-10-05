# Usage Ledger — exact PRIVACY.md changes required before enabling collection

> **This is a release gate, not a follow-up.** `PRIVACY.md` has NOT been edited by this
> campaign. Collection is off (`LICENSE_LEDGER_ENABLED` unset), so nothing is being
> collected that the current policy does not already cover. Applying this diff is a
> precondition for setting that flag in production.
>
> Reviewed against `PRIVACY.md` as of _Last updated: April 25th 2026_.

---

## 1. Exactly what Campaign 1 newly collects

Only two writers are live in Campaign 1, and both are server-side.

### A. Licence activity — `/v1/usage` and `/v1/pro/verify`

One row per licence per 6 hours, recording **that an authenticated client contacted us**:

| Field | Value | Already covered by current policy? |
|---|---|---|
| `license_id` / `trial_id` | The authenticated licence | Yes — §3.2 "License key" |
| `api_key_fingerprint` | SHA-256 prefix of the key. Never the key. | Yes — narrower than storing the key |
| `plan`, `entitlement_state` | Plan name; active/trial/suspended/expired | Yes — §3.2 "Plan / product / order ID" |
| `event_ts` | Server timestamp | **New** — a timestamped activity record |
| `metadata.endpoint` | `/v1/usage` or `/v1/pro/verify` | **New** |

**Net new disclosure: a timestamped record that the application checked in.** No IP, no
device identifier, no content.

### B. Payment lifecycle — the Dodo webhook hook

One row per verified, deduplicated Dodo webhook:

| Field | Value | Already covered? |
|---|---|---|
| `dodo_payment_id`, `dodo_subscription_id` | Dodo identifiers | Yes — §3.2/§3.3 "order ID", "transaction metadata" |
| `subject_email` | Billing email from the webhook | Yes — §3.2 "Billing email" |
| `event_type`, `entitlement_state` | e.g. `subscription_cancelled` → `cancelled` | Yes — §3.2 "Operate billing, refunds, and support" |

**Net new disclosure: none of substance.** This durably records lifecycle transitions we
already receive and act on; it is a retention change more than a collection change.

### C. Not collected in Campaign 1

`install_id`, `device_id_hash`, `app_version`, `platform`, session ids, product feature
names, and every `client_reported` field exist as **columns** in migration 008 but have no
writer until Campaign 2. This diff covers Campaign 1 only; Campaign 2 needs its own pass
before `BYOK_CLIENT_EVENTS_ENABLED` is set.

---

## 2. Proposed diff

### 2.1 §3.2 — add two rows to the table

```diff
 | Quota counters (AI / STT / search) | Enforce plan limits and bill correctly | Rolling — counters reset per cycle; aggregate history kept for accounting |
+| Usage ledger — per-operation records of AI, search and speech-to-text requests we run for you (timestamp, endpoint, provider/model name, token and duration counts, success or failure) | Bill correctly, investigate billing disputes and refunds, diagnose failures, and meet statutory accounting-record obligations | 8 years from the date of the event (Companies Act 2013 record-keeping; GST records for 72 months from annual-return filing) |
+| Licence activity — a timestamped record, at most once every 6 hours, that your licensed application contacted our servers to check its entitlement | Confirm a licence was in active use, investigate billing disputes, and detect licence sharing | Same as above |
 | Free Trial token, started_at / expires_at | Provide and time-limit the trial | Until 90 days after trial expiry |
```

### 2.2 §3.2 — extend the closing sentence

The current sentence is correct and must stay; this makes the ledger's boundary explicit
rather than leaving a reader to infer it.

```diff
-We do **not** store the audio you capture, the screen content you capture, your transcripts, your prompts, or your generated outputs on our servers.
+We do **not** store the audio you capture, the screen content you capture, your transcripts, your prompts, or your generated outputs on our servers.
+
+This applies to the usage ledger too. The ledger records **that** an operation happened —
+when, through which endpoint, on which model, whether it succeeded, and how much of your
+quota it used. It never records **what** the operation was about. No prompt text, answer
+text, résumé or job-description content, meeting transcript, document content, clipboard
+content, keystroke, or screenshot is written to it, and neither is any provider API key:
+your Natively key appears only as a one-way hash that cannot be reversed into the key.
```

### 2.3 §9 — make the erasure answer specific

The existing "subject to retention required by law" is accurate but does not say what
actually happens. Replace the Erasure bullet:

```diff
-- **Erasure** — you can ask us to delete your account and the data associated with it, subject to retention required by law (e.g., tax records).
+- **Erasure** — you can ask us to delete your account and the data associated with it. Where a record must be retained by law (for example accounting and tax records), we **pseudonymise** rather than keep it identifiable: your billing email, device identifiers and licence-key hash are erased from the usage ledger, and the remaining rows are re-keyed to a salted hash so they survive only as an anonymous count for accounting. The salt is not stored, so the link back to you cannot be rebuilt. If a payment dispute is open at the time of your request, we hold the underlying records until it closes and pseudonymise immediately afterwards.
```

### 2.4 §12 "Source transparency" — no change required

### 2.5 Header — bump the date

```diff
-_Last updated: April 25th 2026_
+_Last updated: <date this diff is applied>_
```

---

## 3. What this diff deliberately does not claim

* It does **not** say Natively can see what BYOK features a customer ran. It cannot —
  when a customer supplies their own provider key, Natively executes nothing and meters
  nothing (architecture doc §5).
* It does **not** introduce any third-party marketing analytics. The ledger is
  first-party and is not wired to any analytics sink.
* It does **not** add IP-address collection. §3.2 already covers rate-limiting IPs as an
  anti-abuse signal with a 12-month retention; the ledger does not store IPs.

## 4. Cross-check against §3.2's existing tax-retention line

The existing policy already states licence-key data is retained for "the duration of the
licence + tax-record retention period (typically 7 years under Indian GST & income-tax
rules)". The ledger's 8 years is longer, so it is stated explicitly in its own rows above
rather than folded into "same as above" — the two numbers differ and the policy should not
imply otherwise.
