# Phase 8 — STT Relay Observability, Telemetry & Alerts

**Date:** 2026-06-13
**Status:** Complete — relay + control-plane telemetry made complete, consistent, and alert-ready; 73 relay tests + 277 core tests green.
**Inputs (binding):**
- `docs/01-target-stt-relay-architecture.md` §12 (observability strategy, alert list), §6.1 (`stt_sessions` field set)
- `docs/05-stt-relay-service.md` (relay telemetry design, redaction guarantees)
- `natively-api/services/stt-relay/src/telemetry.js` (Axiom + Sentry-lite + PostHog shippers)
- `natively-api/server.js` `tgAlert` (control-plane Telegram alerting) + Phase-4 relay health tracker

**One-sentence summary:** Every billable/operational event the relay and control plane produce is shipped as a structured, PII-free Axiom event (or a `[STTEvent]` JSON log line picked up by Railway's Axiom log drain), surfaced on a secret-free `/metrics` scrape, and tied to a documented alert catalog — with the cheap, high-signal alerts wired NOW via the existing `tgAlert` mechanism and the rest defined as Axiom monitors.

---

## 1. Telemetry surfaces (where signal goes)

| Surface | Producer | Transport | Dataset / channel | PII? |
|---|---|---|---|---|
| **Axiom** structured events | relay (`telemetry.axiom`) | batched HTTP ingest (≤100 events / 5s) | dataset `stt-relay` | none (hashed ids only) |
| **Axiom** log-drain events | control plane (`[STTEvent]` JSON console lines) | Railway → Axiom **log drain** | dataset `railway-control-plane` (or your drain target) | none (hashed ids only) |
| **Sentry** exceptions | relay (`telemetry.captureException`) | Sentry-lite envelope (raw HTTP, no SDK) | Sentry project, release `stt-relay@<version>` | none |
| **PostHog** product funnel | **client** (Electron, Phase 7) | PostHog capture | product project | distinct id = hashed identity |
| **PostHog** server capture | relay (`telemetry.posthogCapture`) | PostHog capture | product project | hashed `sub` only — `stt_relay_connected` only |
| **Prometheus `/metrics`** | relay HTTP endpoint | scrape (Axiom agent / uptime monitor) | n/a | none |
| **Telegram** | control plane `tgAlert`, relay logs | Telegram bot | ops channel | hashed only |

The three relay shippers (`createTelemetry`) are each a **silent no-op when their env is unconfigured**, never throw into the caller, and use **bounded drop-oldest queues (1000)** so a downstream outage can't grow process memory or block the audio path.

---

## 2. Axiom event catalog

### 2.1 Base fields (every relay Axiom event)

`telemetry.axiom(event, fields)` automatically stamps:

| Field | Source | Notes |
|---|---|---|
| `_time` | `new Date(now()).toISOString()` | ingest time |
| `event` | first arg | event name (table below) |
| `relay_id` | `config.RELAY_ID` | `us-1` / `asia-1` |
| `region` | `config.REGION` | `us` / `asia` |

### 2.2 Relay events (dataset `stt-relay`)

| Event | Emitted when | Key fields (beyond base) |
|---|---|---|
| `session_started` | auth success → session connects (`session.js` auth_ok) | `session_id` (safe hash:channel), `user_hash`, `auth_type`, `plan`, `channel`, `provider_primary`, `sample_rate`, `channels`, `auto_detect`, `budget_seconds`, `reconnect` |
| `session_summary` | socket close → finalize (`session.js` onClose) | **the full field dictionary — §3** |
| `provider_failover` | forward-only failover (`switchToFallback`) | `session_id`, `from`, `to`, `reason` |
| `all_providers_down` | chain exhausted | `session_id`, `reason`, `from` |
| `cost_guard` | any cost guard trips | `session_id`, `guard` ∈ {`bandwidth_reject`, `bandwidth_downnegotiate`, `byte_budget_exceeded`, `max_duration`, `quota_cutoff`, `reconnect_budget`}, + guard-specific (`req_rate`/`clamped_rate`/`bytes_in`/`max_bytes`/`duration_s`/`budget_s`/`billed_s`/`reconnects`/`max`) |
| `backpressure_shed` | provider-socket backpressure drop/kill (`processChunk`) | `session_id`, `peer`, `kill?` |
| `key_pool_exhausted` | Deepgram non-cooling key count hits 0 (edge-triggered, `/readyz` probe) | `provider`, `total` |
| `key_pool_recovered` | Deepgram keys return (edge-triggered) | `provider`, `available` |
| `provider_error` | `providerHealth.onAlert` | `msg` (safe) |
| `usage_flush_failed` | a checkpoint flush is parked in the retry queue after in-line retries (`usageStore`) | `session_id`, `relay_id`, `region` |
| `usage_finalize_failed` | a finalize is parked in the retry queue | `session_id`, `relay_id`, `region` |
| `usage_write_failed` | aggregate of the two above (back-compat) | `kind` ∈ {`flush`,`finalize`}, `session_id` |
| `usage_retry_dropped` | retry queue overflow (500, drop-oldest) | `session_id` |

> **PostHog (relay, server-side):** only `stt_relay_connected {region, channel}` keyed by the hashed `sub`. The relay deliberately does **not** duplicate the client product funnel (`stt_relay_selected`, `stt_relay_failed`, `stt_fallback_used`, `stt_first_transcript_bucket`) — those are owned by the Electron client (§5, Phase 7).

### 2.3 Control-plane events (dataset via Railway → Axiom log drain)

Emitted as single-line JSON on the `[STTEvent]` prefix from `server.js` (`sttEvent()`), no SDK. Railway's log drain ships stdout to Axiom; a transform/parse on the `[STTEvent] ` prefix lands them as structured rows.

| Event | Emitted when | Key fields |
|---|---|---|
| `session_issued` | every `POST /v1/stt/session` success | `session_id`, `user_hash`, `region`, `mode` (`relay`/`railway`), `reason`, `bucket`, `channel`, `auth_type`, `plan`, `eligible` |
| `railway_fallback_returned` | a **relay-eligible** create nonetheless returned Railway (a relay was unhealthy) | `session_id`, `user_hash`, `reason` |
| `railway_fallback_alert` | rolling railway-fallback share crosses threshold | `share_pct`, `railway`, `eligible`, `window_min` |
| `both_relays_down` | both regions unhealthy in the health map | `us`, `asia` |

`eligible` = the user **would** have gotten a relay (not kill-switched, inside the rollout percent). A `mode:railway` create with `reason ∈ {kill_switch, rollout_percent}` is **expected**, not a fallback, and is excluded from the fallback-share alert.

---

## 3. `session_summary` field dictionary (the billing/usage record)

The Axiom `session_summary` event carries the complete per-session record (docs/01 §6.1, `metrics.js`), projected to be analytics-safe (`telemetryRow` strips the durable `user_id`/`trial_id` uuids and substitutes a one-way `user_hash`).

| Field | Type | Meaning / source |
|---|---|---|
| `session_id` | string | safe id `<sha256-prefix>:<channel>` (never raw key) |
| `user_hash` | string | `hashIdentity(token.sub)` — one-way, NOT the raw account id |
| `auth_type` | `key`/`trial` | token claim |
| `plan` | string | token claim (`standard`/`pro`/`max`/`ultra`/`trial`) |
| `region` | string | relay region |
| `relay_id` | string | relay id |
| `channel` | `system`/`mic`/`default` | validated channel |
| `provider_primary` | string | first connected provider |
| `provider_final` | string | provider at close |
| `sample_rate` | int | clamped session rate |
| `channels` | int | clamped session channels |
| `bytes_in_from_client` | int | client→relay PCM |
| `bytes_out_to_deepgram` | int | relay→Deepgram |
| `bytes_out_to_google_stt` | int | relay→Google STT |
| `bytes_out_to_elevenlabs` | int | relay→ElevenLabs |
| `bytes_out_to_client` | int | relay→client JSON |
| `chunks_received` | int | inbound audio frames |
| `chunks_forwarded` | int | frames forwarded to provider |
| `chunks_dropped` | int | dropped (backpressure / no provider) |
| `reconnect_count` | int | takeover/reconnects on this identity |
| `failover_count` | int | provider failovers |
| `shadow_probe_count` | int | always 0 on the relay (probes replaced by the silence watchdog — docs/05 §3); field kept for schema parity |
| `first_transcript_ms` | int\|null | ms from start to first transcript |
| `final_transcript_count` | int | finals emitted |
| `duration_seconds` | int | wall clock |
| `billable_seconds` | int | honest per-channel billable (pairing applied by the finalize RPC) |
| `close_code` | int\|null | WS close code |
| `close_reason` | string\|null | mapped error code, if any |
| `quota_cutoff` | bool | the mid-session quota watchdog cut this session |
| `error_code` | string\|null | terminal error code, if any |

**Client-side concepts** (`selected_relay`, `fallback_relay_used`, `railway_fallback_used` from docs/01 §6) are NOT relay-knowable — they are the Electron PostHog events (Phase 7). The relay emits what it knows: `region`/`relay_id` and the fact that THIS relay was reached (a `session_summary` exists ⇒ the relay was reached). The control plane's `session_issued`/`railway_fallback_returned` cover the selection side.

---

## 4. Sentry configuration

| Aspect | Value |
|---|---|
| Transport | Sentry-lite raw-HTTP envelope (no `@sentry/node` dependency) |
| Enabled when | `SENTRY_DSN` set; silent no-op otherwise |
| Wired to | `uncaughtException` (drain + exit 1) and `unhandledRejection` (report, no exit) in `index.js`; plus per-session `captureException` on auth/message errors |
| Release | `stt-relay@<version>` — version from `npm_package_version`, falling back to a direct read of `package.json` (correct under systemd where the npm env is unset) |
| Tags | `relay_id`, `region`, `release` |
| Extra | flat map of SAFE fields only (`stage`, hashed `session_id`, `code`, `kind`) |
| **No-PII guarantee** | no raw keys/tokens, no transcript text, hashed IPs only. Verified by `telemetry-redaction.test.mjs` (feeds known secrets through the shipper, asserts the wire bytes contain none). |

---

## 5. PostHog client events (cross-reference Phase 7)

Owned by `electron/audio/NativelyProSTT.ts` (docs/01 §5.5, §12), distinct id = hashed identity, no transcript text / no raw keys / Sentry breadcrumbs on ladder transitions:

- `stt_relay_selected {region, mode}`
- `stt_relay_connected {region, ms}`
- `stt_relay_failed {region, stage, code}`
- `stt_fallback_used {from, to}`
- `stt_first_transcript_bucket {<1s | 1-2s | 2-5s | >5s}`

These catch whole classes the server can't see (DNS, regional routing, captive portals). The relay does not duplicate them.

---

## 6. `/metrics` scrape contract (per relay)

`GET /metrics` → 200 JSON, **secret-free**, stable shape (verified by `metrics-endpoint.test.mjs`):

| Field | Type | Meaning |
|---|---|---|
| `relay_id`, `region`, `uptime_s` | | identity + liveness |
| `active_sessions` | gauge | live sessions now |
| `sessions_total` | counter | sessions closed since boot |
| `sessions_by_provider` | map | live session count by current provider |
| `per_ip_map_size` | gauge | distinct IP buckets with live sessions |
| `usage_queue_depth` | gauge | usage retry-queue depth (flush/finalize backlog) |
| `provider_health` | `{deepgram,googleSTT,elevenlabs: bool}` | health classifier state |
| `deepgram_keys_available` | gauge | non-cooling Deepgram keys (0 ⇒ pool exhausted) |
| `deepgram_keys_total` | gauge | configured pool size |
| `close_codes` | histogram | `{ "1000": n, "1006": n, … }` since boot |
| `bytes_in_total` | counter | client→relay bytes (cumulative + live in-flight) |
| `bytes_out_to_deepgram_total` / `_google_stt_total` / `_elevenlabs_total` / `_client_total` | counters | per-direction egress (cumulative + live) |
| `bytes_out_total` | counter | sum of all outbound directions |
| **`egress_estimate_gb`** | gauge | **the cost signal** — `bytes_out_total / 1024³`, the metric the egress alert tracks |
| `draining` | bool | graceful-shutdown state |

Byte totals fold closed sessions' finalized counters (accumulated on each close handler) PLUS the live in-flight bytes of currently-open sessions, so a single long session still moves the gauge.

---

## 7. Alert catalog

Severity: **page** = wake someone; **warn** = next-business-day / dashboard. "Wired now" = active via `tgAlert` in this phase; "Axiom monitor" = define as an Axiom saved-query monitor against the dataset.

| # | Alert | Signal source | Threshold | Severity | Wired now? | Runbook |
|---|---|---|---|---|---|---|
| 1 | Relay down (1 region) | control-plane health tracker `onHealthChange` → `tgAlert` | `/healthz` unhealthy (2 consecutive fails) | page | **Yes** (Phase 4) | RB-1: check VPS / Caddy / systemd; relay self-recovers on 1 success |
| 2 | **Both relays down (CRITICAL)** | control-plane rollup interval (health map) → `tgAlert` `stt_both_relays_down` | both regions unhealthy | page | **Yes** (this phase) | RB-2: kill switch is irrelevant (clients ladder to Railway); restore ≥1 relay urgently |
| 3 | Railway-fallback share | control-plane rolling window → `tgAlert` `stt_railway_fallback_share` + Axiom `railway_fallback_alert` | >20% of **eligible** creates over 10min (≥20 samples) | page | **Yes** (this phase) | RB-3: relays degraded; inspect `/admin/stt-relays`, health events |
| 4 | Egress projection | relay `/metrics` `egress_estimate_gb` rate (Axiom monitor on scrape) | monthly projection > 80% of included TB | warn | Doc-only (Axiom monitor) | RB-4: check Google-fallback amplification, 48k/stereo cohort, EL flag |
| 5 | Deepgram key pool exhausted | relay Axiom `key_pool_exhausted` (and `/metrics` `deepgram_keys_available==0`) | 0 non-cooling keys on any relay | page | Event emitted now; Axiom monitor | RB-5: rotate/replace Deepgram keys; check 402 (credits) / 401 (auth) |
| 6 | Google STT fallback spike | Axiom: `provider_failover` where `to=googleSTT` | failovers/hour > 5× 7-day baseline | warn | Doc-only (Axiom monitor) | RB-6: Deepgram health; cost (Google amplification) |
| 7 | ElevenLabs fallback spike | Axiom: `provider_failover` where `to=elevenlabs` | failovers/hour > 5× baseline | warn | Doc-only (Axiom monitor) | RB-7: both Deepgram+Google failing; consider `ENABLE_ELEVENLABS_FALLBACK=0` during cost incident |
| 8 | Supabase usage flush failures | relay Axiom `usage_flush_failed` / `usage_finalize_failed` (+ `/metrics` `usage_queue_depth`) | >3 in a window, or queue depth rising | page (billing!) | Event emitted now; Axiom monitor | RB-8: Supabase health; reaper finalizes abandoned; reconcile after recovery |
| 9 | High 1006/1011 close rate | relay `/metrics` `close_codes` (Axiom monitor on scrape) | 1006/1011 > 3× baseline | warn | Doc-only (Axiom monitor) | RB-9: 1006 = client-side/network; 1011 = upstream provider |
| 10 | First-transcript p95 latency | derive from Axiom `session_summary.first_transcript_ms` | p95 > 2500ms over 15min | warn | Doc-only (Axiom monitor) | RB-10: provider RTT, key-pool spreading, region routing |
| 11 | Billing reconciliation backlog | Supabase query: `stt_sessions status='active'` older than threshold (Phase-6 reaper) | `abandoned` pending finalize > 25, or oldest > 15min | warn | Doc-only (DB monitor) | RB-11: reaper health; relay SIGKILL recovery |

---

## 8. Railway → Axiom log-drain setup + dataset names

- **Relays (VPS):** ship structured Axiom events directly via `AXIOM_TOKEN` + `AXIOM_DATASET` (default **`stt-relay`**). No log drain needed — the relay batches to the ingest API. Each VPS also writes JSON logs to stdout (systemd journal) for local forensics.
- **Control plane (Railway):** has no Axiom SDK (non-goal: no heavy deps on the monolith). Instead it emits single-line JSON on the `[STTEvent] ` prefix to stdout. Configure a **Railway log drain → Axiom** (Railway Settings → Logs → add HTTP/Axiom drain) targeting a dataset such as **`railway-control-plane`** (or a dedicated `stt-control-plane`). An Axiom ingest transform parses lines beginning `[STTEvent] ` into structured rows (`event`, `region`, `mode`, …). This is the documented path; it adds zero runtime dependency to the control plane.
- **Sentry:** independent of Axiom; the relay's `SENTRY_DSN` envelopes go straight to Sentry.

---

## 9. Suggested Axiom dashboards / queries

(APL-style sketches against dataset `stt-relay` unless noted.)

- **Egress (cost):** scrape `/metrics` `egress_estimate_gb` into a gauge series per `relay_id`; chart rate and project monthly. Alert #4.
- **Railway-fallback rate:** on `railway-control-plane`, `session_issued | where eligible == true | summarize railway=countif(mode=='railway'), total=count() by bin(_time, 5m) | extend share = 100.0*railway/total`. Alert #3 mirrors this in-memory.
- **First-transcript p95:** `session_summary | summarize p95=percentile(first_transcript_ms, 95) by bin(_time, 15m), region`. Alert #10.
- **Provider mix:** `session_summary | summarize count() by provider_final, region` (and `provider_failover | summarize count() by to, reason`). Alerts #6/#7.
- **Close-code health:** scrape `/metrics` `close_codes`, chart 1006/1011 share. Alert #9.
- **Billing-write health:** `usage_flush_failed or usage_finalize_failed | summarize count() by bin(_time, 5m), relay_id`. Alert #8.

---

## 10. Redaction guarantees (what's hashed, what's never logged)

| Datum | Treatment |
|---|---|
| API key / trial token | **never** logged or shipped. Logger backstop redacts any field key matching `token|key|secret|authorization|apikey|credential|password` → `[redacted]`. |
| Account identity (key id / trial id) | one-way `hashIdentity` (sha256, 16-hex prefix) → `user_hash`. Raw `user_id`/`trial_id` uuids stay in the billing RPC payload only (Supabase), never in Axiom/Sentry/PostHog. |
| Session id (logs/events) | `makeSessionId` → `<sha256-prefix>:<channel>`, never a raw credential. |
| IP address | `hashIP` (sha256, 16-hex prefix) for logs/alerts; full address only on the DDoS/security path. |
| Transcript text | logged **only** when `LOG_TRANSCRIPTS=true`, then truncated to 80 chars; the `asConsole` core adapter never elevates core log strings above `debug`. Never shipped to Axiom/Sentry/PostHog. |
| Provider keys / token secret | live only in relay env; never in a token, log, event, or `/metrics`. |

**Verification (this phase):**
- `telemetry-fields.test.mjs` — drives a real session to close; asserts `session_summary` has every required field, `user_hash == hashIdentity(sub)` (not the raw sub), no `user_id`/`trial_id` present, and no token/key/transcript substring in any field; asserts `cost_guard` fires for byte-budget / max-duration / quota paths; asserts `usage_flush_failed`/`usage_finalize_failed` on retry-queue park.
- `telemetry-redaction.test.mjs` — feeds known secrets through the real Axiom + Sentry shippers (capturing fetch) and the real logger (capturing sink); asserts the wire bytes / stdout never contain them, and that secret-keyed fields are `[redacted]`.
- `metrics-endpoint.test.mjs` — boots the relay, hits `/metrics`, asserts `egress_estimate_gb` present + numeric, byte totals track a live session, stable shape, no secret-like fields.

`cd services/stt-relay && node --test tests/*.test.mjs` → **73/73 pass** (58 prior + 15 new: 7 telemetry-fields + 5 telemetry-redaction + 3 metrics-endpoint). Core suite `node --test packages/stt-relay-core/tests/*.test.mjs` → **277/277**. `node --check server.js` (control plane) → clean.
