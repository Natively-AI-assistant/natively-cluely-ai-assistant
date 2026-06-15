# 17 — Observability Setup (Axiom · PostHog · Sentry)

Telemetry is **wired live** on both the Railway control plane (`natively-api/server.js`) and the
Electron desktop client. Every sender is **fire-and-forget, never throws, and is a silent no-op
until its env is set** — so you can ship with nothing configured and turn it on later by adding env.

The **same three credentials** serve the control plane, the desktop client, and (later) the VPS relays.

---

## What's wired

### Control plane — `natively-api/lib/telemetry.js` (`createTelemetry()`)
| Sender | Fires on | Endpoint |
|---|---|---|
| **Axiom** | every `sttEvent(...)` (session_issued, railway_fallback_returned, quota_lease_degraded, both_relays_down, reaper_reconciled, …) — sent as `stt_<event>`; plus existing `embedding_request` | `POST https://api.axiom.co/v1/datasets/$AXIOM_DATASET/ingest` (Bearer `$AXIOM_TOKEN`) |
| **Sentry** | `uncaughtException` + `unhandledRejection` (tagged `kind`, `fatal`) | DSN envelope endpoint |
| **PostHog** | `embedding_request` (server metrics) | `POST $POSTHOG_HOST/capture/` |

`sttEvent` uses **both** delivery paths (your choice): a `console.log('[STTEvent] …')` line (so a
Railway→Axiom **log drain** also works) **and** a direct Axiom HTTP send (so events arrive even
without the drain, and the same code runs on the relays).

A boot line confirms state: `[Telemetry] axiom=… posthog=… sentry=… release=… env=…`.

### Desktop client — `electron/services/telemetry/TelemetryService.ts`
The previously no-op remote sinks now dispatch for real (raw fetch, no SDK dependency):
| Sink | Fires on | Notes |
|---|---|---|
| **PostHog** | every tracked event (`app_start`, `meeting_start`, `relay_*`, `llm_*`, `stt_*`, …) | `distinct_id` = a random, persisted, **non-PII install id** (`telemetryInstallId` in settings) |
| **Axiom** | every tracked event (`kind=<event>`, `source: desktop`) | optional second backend dataset for client events |
| **Sentry** | **only error-ish** events (`status: 'error'/'failed'` or name matching `error/fail/crash/reject`) | analytics events are NOT sent to Sentry |
| **local-jsonl** | always (default) | unchanged — writes to `userData/logs/…` |

Sinks are built from env at startup in `main.ts` and added **only when the credential is present**.
A boot line confirms: `[Telemetry] sinks: local-jsonl + posthog + sentry release=…`.

---

## Environment variables

Set on **Railway** (control plane) and/or the **packaged desktop build** (client). Identical names.

```
# Axiom — structured backend/desktop events
AXIOM_TOKEN=<axiom api token>
AXIOM_DATASET=natively-api          # control plane; use stt-relay on the VPS relays

# Sentry — errors/crashes (control plane + client)
SENTRY_DSN=https://<publicKey>@<org>.ingest.sentry.io/<projectId>
SENTRY_RELEASE=<optional; defaults to RAILWAY_GIT_COMMIT_SHA / app version>
SENTRY_ENVIRONMENT=<optional; defaults to NODE_ENV / 'production' on Railway>

# PostHog — product analytics
POSTHOG_API_KEY=<project api key>
POSTHOG_HOST=https://app.posthog.com   # or https://eu.posthog.com / self-hosted
```

All optional. Unset → that platform is silently skipped.

---

## Privacy guarantees (built in)

- **No secrets are shipped.** Credentials authenticate the transport only; event bodies carry
  metadata. The client sanitizes every property (`sanitizeTelemetryProperties`) and the control-plane
  STT events carry only **hashed** identities (`user_hash`), never raw keys/tokens/transcripts.
- **PostHog distinct_id is a hash / random install id**, never an email or API key.
- **Sentry** gets exceptions + tags + non-PII extra only.
- Local-JSONL records are independently asserted to never contain a sink credential (tested).

---

## How to verify it's working

### Control plane (after setting Railway env + redeploy)
1. Boot log shows `[Telemetry] axiom=true posthog=… sentry=true …`.
2. Issue a session: `POST /v1/stt/session` (any valid key) → an Axiom event `stt_session_issued`
   should appear in the `$AXIOM_DATASET` dataset within seconds.
3. Sentry smoke: a thrown uncaught exception (or a deliberate test route) appears in the Sentry project
   tagged `kind=uncaughtException`.

### Desktop client (packaged build with env set)
1. Launch log: `[Telemetry] sinks: local-jsonl + posthog + sentry …`.
2. Start a meeting → PostHog "Live events" shows `app_start` / `meeting_start` from `distinct_id` `nd_…`.
3. Force a provider error → a Sentry event `desktop:provider_error (error)` appears.

---

## Tests

- Control plane: `natively-api/tests/telemetry.test.mjs` — **8 tests** (injected env + fetch; each
  sender's endpoint/shape, DSN parsing, no-op-when-unset, never-throws, status() leaks no secrets).
- Client: `electron/services/__tests__/TelemetryRemoteSinks.test.mjs` — **7 tests** (PostHog/Axiom/
  Sentry dispatch, error-only Sentry gating, unconfigured-skip, failure-never-throws, no creds in JSONL)
  + existing `TelemetryService.test.mjs` (8) still green.

---

## Notes / decisions

- **Lightweight, dependency-free Sentry** (raw envelope POST) on both sides — no `@sentry/node` /
  `@sentry/electron`. Covers exceptions + messages with tags/release. If you later want breadcrumbs,
  release health, or performance tracing, swapping in the official SDKs is a clean follow-up.
- The control plane already had a single-event PostHog/Axiom sender (`shipEmbedMetric`) — left intact;
  the new `createTelemetry()` facade is the general-purpose path everything else uses.
- The VPS relays (`services/stt-relay`) have their **own** `telemetry.js` (built in the migration) using
  the same env vars — so when relays are re-enabled, point `AXIOM_DATASET=stt-relay` there.
