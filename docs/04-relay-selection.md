# Phase 4 — Relay Selection + Health System (Control Plane)

**Date:** 2026-06-13
**Status:** Complete — all gates green
**Inputs (binding):** `docs/01-target-stt-relay-architecture.md` §2.3/§8/§9, `docs/03-relay-session-token.md` (Phase 3 endpoint + selector contract).
**Scope:** live relay health tracking (active `/healthz` probes + passive session-create signals), the `GET /v1/stt/relays` listing route, admin inspection (`GET /admin/stt-relays`) and runtime control (`POST /admin/stt-relays/control`), plus stereo/dual-stream per-identity buckets in the session limits. All server.js changes are additive (`git diff --stat` vs the pre-Phase-3 baseline: `server.js | 426 insertions(+)`, **zero deletions** — `/v1/transcribe` and every existing route byte-for-byte untouched; Phase 2 parity suite still green against the edited file).

---

## 1. Selection algorithm — final form

Module: `packages/stt-relay-core/src/relaySelection.js` — **signature unchanged from Phase 3** (the brief's preference held: all health wiring happens in server.js through the existing `healthMap`/`latencyProbes` parameters; the selector stays pure).

Priority order, as executed by `POST /v1/stt/session` (`server.js:4374-4385`):

1. **Runtime kill switch** (`sttRelayRuntime.kill_switch`) → `railway` (`kill_switch`). Boot default from `STT_RELAY_KILL_SWITCH`, overridable live via the admin control route.
2. **Rollout gate**: `rolloutBucket(identity) ≥ sttRelayRuntime.enable_percent` → `railway` (`rollout_percent`). Bucket = sha256(identity) first-4-bytes uint32 BE % 100 — deterministic + monotonic (raising the percent only ever adds users). Identity = key id / `trial_<id>` — never the raw credential.
3. **Forced region** (`sttRelayRuntime.force_region`, dogfood) — only when that relay is **healthy** per the live tracker (`forced_region`).
4. **Client latency probes** (`body.latency_probes`) — lowest-RTT *healthy* region (`latency_probe`). **Honored only when `STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES` is on** (default true); when off, the request field is ignored entirely (server.js:4383-4385).
5. **Geo map** from `region_hint` (ISO-3166 alpha-2 or coarse string; `GEO_MAP` table) → `geo_map`, or `STT_RELAY_DEFAULT_REGION` → `default_region`.
6. **Health overrides**: selected region unhealthy → alternate (`*_unhealthy_alternate`); both unhealthy → `railway` (`all_relays_unhealthy`).

**What changed vs Phase 3:** the static `healthMap: { us: !!STT_RELAY_US_URL, asia: !!STT_RELAY_ASIA_URL }` is replaced by `sttRelayHealthMap()` — the live tracker view, still ANDed with URL-configured (an unconfigured region is permanently unhealthy *inside* the tracker, so semantics with no probes yet are identical to Phase 3). When no relay URL is configured at all, the tracker isn't instantiated and the Phase 3 static map is the fallback (same answer: all unhealthy).

**Deferred (unchanged from Phase 3 plan):** session-affinity pinning (§8 step 0) and `STT_RELAY_ALLOWLIST` — they need the `stt_sessions` table live (Phase 2 schema) to answer "active session for this identity"; tracked for Phase 7.

---

## 2. Health tracker design

Module: `packages/stt-relay-core/src/relayHealth.js` (NEW). Relay-agnostic, fully DI — no env reads, injectable `fetchImpl`/`now`/`logger`/`onHealthChange`. Exported via the core index; the Phase 5 relay can reuse it for its own upstream checks.

### 2.1 Active probing

- `checkNow(region)` probes the relay's **`/healthz` over HTTP(S)**, derived from the public WS URL: `wss://host[:port]/path → https://host[:port]/healthz` (`ws:` → `http:`; `deriveHealthUrl()`). An explicit `healthUrl` per region overrides the derivation.
- **Timeout** via AbortController (`timeoutMs`, env `STT_RELAY_HEALTH_TIMEOUT_MS`); the abort timer is `unref()`'d.
- **Cache TTL** (`cacheMs`, env `STT_RELAY_HEALTH_CACHE_MS`): `checkNow` within the TTL serves the cached snapshot — no network call. `force: true` (used by the background checker) bypasses the TTL.
- **Coalescing**: concurrent `checkNow` calls on one region share a single in-flight probe promise — no probe storms, even with `force`.
- `startBackgroundChecks(intervalMs)` / `stopBackgroundChecks()`: `setInterval`-based, **`unref()`'d so it never holds the process open**; idempotent (re-start replaces, stop is safe to repeat). Background ticks probe every configured region with `force: true` (the background checker *is* the cache refresher).

### 2.2 Flap damping (docs/01 §9: "2 consecutive fails ⇒ unhealthy; 1 success ⇒ healthy")

- **healthy → unhealthy needs 2 consecutive active failures** (timeout, network error, or non-2xx). One blip never trips the region.
- **unhealthy → healthy flips on ONE probe success** (fast recovery, slow trip).
- A success resets the consecutive-failure counter, so alternating fail/ok never flips.

### 2.3 Passive signals

- `recordPassiveFailure(region)`: **3 consecutive** (default, `passiveFailureThreshold`) force-mark the region unhealthy **until the next active probe succeeds** — passive successes do *not* resurrect a passive-marked region (clients see WS-path failures the HTTP probe can miss: Caddy up, WS handler wedged).
- `recordPassiveSuccess(region)`: resets the consecutive streak only.
- An active probe success clears both the active and passive counters.

**server.js wiring (4281-4294, 4371-4373, 4387-4390):** clients re-creating a session after a relay failure send `failed_relay_region: 'us'|'asia'` in the body. The control plane **dedupes per identity-hash per cache window** (`recordSttPassiveFailure`) before forwarding to the tracker — docs/01 §9 requires ≥3 *distinct* identities, so one abusive client cannot force a healthy relay off rotation by spamming the field. Successful relay-mode issuance records a passive success for the selected region.

### 2.4 States + the healthMap

- A region with **no URL configured is permanently unhealthy** (never probed, never resurrectable).
- A configured region with **no probe data yet is assumed healthy** (`source: 'assumed'`) — exact Phase 3 parity, so wiring the tracker in was behavior-neutral until the first probe.
- `getHealth(region)` → `{healthy, lastCheck, latencyMs, consecutiveFailures, passiveFailures, source: 'probe'|'cache'|'assumed', configured}` (`probe` = data fresher than the TTL, `cache` = stale).
- `getHealthMap()` → `{us: boolean, asia: boolean}` — exactly the shape `selectRelay` consumes.
- `onHealthChange(region, healthy, detail)` fires on **transitions only** (never per-probe); server.js wires it to a Telegram alert. Observer exceptions are swallowed — health tracking never breaks on a logging bug.

---

## 3. Route specs

### 3.1 `GET /v1/stt/relays` — public-but-authenticated (server.js:4481-4506)

Auth: same credential surface as every authenticated GET — `authenticate()` (`x-natively-key` / `Authorization: Bearer <key>` via `getKey()`, or `x-trial-token` via `getTrialToken()`), preceded by `checkDDoS`. Same 401 vocabulary as the session endpoint.

```
GET /v1/stt/relays
Authorization: Bearer natively_sk_…        (or x-natively-key / x-trial-token)

200 {
  "relays": [
    { "region": "us",   "ws_url": "wss://us-relay.natively.software/ws",   "healthy": true,  "latency_ms": 42 },
    { "region": "asia", "ws_url": "wss://asia-relay.natively.software/ws", "healthy": false, "latency_ms": null }
  ],
  "railway_fallback_ws_url": "wss://api.natively.software/v1/transcribe",
  "kill_switch": false,
  "rollout_percent": 10,
  "client_latency_probes_allowed": true
}
```

- Unconfigured regions are omitted (nothing useful to tell a client).
- `latency_ms` is the last successful probe's RTT, `null` if unknown/failing.
- **NO secrets, no env snapshot, no internal URLs** — only the public wss URLs the client needs (the admin route below carries the detail). `kill_switch`/`rollout_percent` reflect the *runtime* values.

### 3.2 `GET /admin/stt-relays` — admin inspection (server.js:4513-4550)

Auth: the existing admin pattern, copied exactly — `if (!checkAdminSecret(req)) return reply.code(401).send({ error: 'unauthorized' })` (timing-safe `x-admin-secret` check, same as `/admin/provider-health`).

```
GET /admin/stt-relays
x-admin-secret: …

200 {
  "tracker_active": true,
  "background_checks_running": true,
  "regions": {
    "us":   { "url": "wss://us-relay.natively.software/ws", "configured": true, "healthy": true,
              "lastCheck": "2026-06-13T10:02:45.000Z", "latencyMs": 42,
              "consecutiveFailures": 0, "passiveFailures": 0, "source": "probe" },
    "asia": { "url": null, "configured": false, "healthy": false, "lastCheck": null,
              "latencyMs": null, "consecutiveFailures": 0, "passiveFailures": 0, "source": "assumed" }
  },
  "runtime": { "kill_switch": false, "force_region": null, "enable_percent": 10 },
  "env":     { "kill_switch": false, "force_region": null, "enable_percent": 1,
               "default_region": "us", "railway_fallback_ws_url": "wss://…",
               "health_timeout_ms": 2500, "health_cache_ms": 15000, "health_check_interval_ms": 30000,
               "allow_client_latency_probes": true, "allow_stereo_percent": 0,
               "allow_dual_stream_percent": 0, "session_token_ttl_seconds": 180 }
}
```

- Admin **may** see the full relay URLs (decision per the brief: they're operator-deployed public endpoints, not secrets).
- `runtime` = the live values the session endpoint reads; `env` = boot defaults (rollout knobs + TTLs only). **The session-token secret and provider keys are never referenced by the handler at all** (asserted by a source-check test, plus an integration check that neither secret string appears anywhere in the serialized response).

### 3.3 `POST /admin/stt-relays/control` — runtime control / operational kill switch (server.js:4560-4609)

Same admin auth pattern. Body — all fields optional, validated, applied atomically (a 400 on any field changes nothing):

```
POST /admin/stt-relays/control
x-admin-secret: …
{ "kill_switch": true, "force_region": "asia" | null, "enable_percent": 25 }

200 {
  "ok": true,
  "changed": ["kill_switch false→true"],
  "effective": { "kill_switch": true, "force_region": null, "enable_percent": 100 },
  "boot_env":  { "kill_switch": false, "force_region": null, "enable_percent": 100 },
  "note": "runtime overrides are NOT persisted — a restart reverts to env"
}
```

Validation: `kill_switch` boolean; `force_region` ∈ {`us`,`asia`,`null`}; `enable_percent` finite 0–100 (rounded). **Every effective change is logged** (`[Admin] STT relay control: kill_switch false→true`) **and Telegram-alerted** — the admin audit trail. No-op posts log a no-op line.

### 3.4 Runtime-override semantics (intentional design)

- The env vars are the **boot defaults**; `sttRelayRuntime` is the **live, mutable** config the session endpoint and the relays listing read.
- Overrides are **deliberately NOT persisted across restarts**: a redeploy/restart reverts to env. Rationale: env is the audited configuration source of record (Railway dashboard, change history); the runtime route exists for *incident response speed* (flip the kill switch in seconds, no deploy), and any override worth keeping must be promoted to env — which the responder does as the durable follow-up. A persisted shadow config would create a second, invisible source of truth that survives the incident.
- Precedence: runtime value always wins while the process lives; the admin GET shows both so drift is visible at a glance.

---

## 4. Env var table (all `STT_RELAY_*` / `STT_ALLOW_*`, read once at startup)

| Var | Default | Clamp | Meaning |
|---|---|---|---|
| `STT_RELAY_US_URL` | — | — | us relay WSS URL; unset ⇒ region permanently unhealthy |
| `STT_RELAY_ASIA_URL` | — | — | asia relay WSS URL; unset ⇒ region permanently unhealthy |
| `STT_RELAY_RAILWAY_FALLBACK_URL` | `wss://api.natively.software/v1/transcribe` | — | always-present emergency path |
| `STT_RELAY_DEFAULT_REGION` | `us` | — | unknown-geo default |
| `STT_RELAY_ENABLE_PERCENT` | `0` | 0–100 (selector) | rollout percent **boot default** (runtime-overridable) |
| `STT_RELAY_FORCE_REGION` | unset | `us`/`asia` | dogfood override **boot default** (runtime-overridable) |
| `STT_RELAY_KILL_SWITCH` | `0` | `1`/`true` | always-railway **boot default** (runtime-overridable) |
| `STT_RELAY_HEALTH_TIMEOUT_MS` | `2500` | **500–10000** | per-probe AbortController timeout |
| `STT_RELAY_HEALTH_CACHE_MS` | `15000` | **5000–120000** | probe-cache TTL (no re-probe within) + passive-dedupe window |
| `STT_RELAY_HEALTH_CHECK_INTERVAL_MS` | `30000` | `0`=disabled, else ≥5000 | background `/healthz` probe interval |
| `STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES` | `true` | `0`/`false` disables | when false, `latency_probes` in session-create is ignored |
| `STT_ALLOW_STEREO_PERCENT` | `0` | 0–100 | per-identity stereo bucket: in-bucket ⇒ `max_channels: 2` |
| `STT_ALLOW_DUAL_STREAM_PERCENT` | `0` | 0–100 | per-identity `allow_dual_stream` bucket (Phase 3, now salted) |
| `STT_MAX_SAMPLE_RATE` | `16000` | — | token claim + config clamp (Phase 3) |
| `STT_MAX_CHANNELS` | `1` | — | base channel limit (stereo bucket raises to 2) |
| `STT_SESSION_TOKEN_SECRET` | — | — | HMAC secret (Phase 3; unset ⇒ session endpoint 503s) |
| `STT_SESSION_TOKEN_TTL_SECONDS` | `180` | 120–300 | token TTL (Phase 3) |

**Bucket salting note:** stereo uses `rolloutBucket('stereo:'+identity)`, dual-stream `rolloutBucket('dualstream:'+identity)` — deterministic per identity (same user always gets the same answer; raising a percent only adds users) and **independent** of each other and of the relay-rollout cohort, so enabling 5% stereo doesn't accidentally select the same 5% as the relay rollout. *Deviation from Phase 3:* dual-stream previously used the unsalted bucket; it is now salted for cohort independence. Acceptable pre-rollout (percent has been 0 everywhere; no user-visible change), and worth it before any cohort goes live.

---

## 5. server.js wiring summary (all additive)

| What | Where |
|---|---|
| `createRelayHealthTracker` import | `server.js:61` |
| Health/runtime env block (clamps) | `server.js:4226-4248` |
| `sttRelayRuntime` mutable config | `server.js:4254-4258` |
| Tracker instantiation (only if ≥1 URL) + background start (only if interval>0) + Telegram on transitions | `server.js:4264-4279` |
| Passive-failure per-identity dedupe (`recordSttPassiveFailure`) | `server.js:4283-4294` |
| `sttRelayHealthMap()` (tracker → selector shape, Phase 3 fallback) | `server.js:4296-4302` |
| Session endpoint: passive signal intake, runtime knobs, live healthMap, probe gating, passive success | `server.js:4361-4390` |
| Stereo/dual-stream salted buckets + `max_channels` | `server.js:4392-4399` (claims `:4434-4435`, limits `:4464-4465`) |
| `GET /v1/stt/relays` | `server.js:4481-4506` |
| `GET /admin/stt-relays` | `server.js:4513-4550` |
| `POST /admin/stt-relays/control` | `server.js:4560-4609` |
| Shutdown: `stopBackgroundChecks()` in `gracefulShutdown` | `server.js:8052` |

---

## 6. Test inventory + results

| Suite | Tests | Result |
|---|---|---|
| `packages/stt-relay-core/tests/relayHealth.test.mjs` (NEW) | 26 | deriveHealthUrl (wss→https, ws→http, junk→null), healthy probe (latency, source=probe), network-error failure, timeout→failure + 2-consecutive flip, http_503 detail, 1-success fast recovery, fail/ok alternation never flips, cache TTL (no re-probe within; probe→cache source transition), force bypass, concurrent coalescing (3 calls → 1 probe, incl. forced), per-region independence, no-URL permanently unhealthy (never probed), unknown-region safety, assumed-healthy parity, passive ×3 force-mark, passive-success streak reset, passive-marked sticky until active success, custom threshold, onHealthChange transitions-only, throwing observer tolerated, start/stop idempotent + isRunning + 0/neg/NaN disabled, background tick probes all regions past TTL, explicit healthUrl override, missing fetchImpl throws, exported defaults — **26/26 pass** |
| `tests/stt-relays-routes.test.mjs` (NEW) | 20 | **Offline (11, always run):** routes registered; admin routes copy the `checkAdminSecret` 401 pattern verbatim (and never re-read `ADMIN_SECRET`); listing reuses `authenticate()` + `checkDDoS`, no direct DB; **no secret env vars referenced in any Phase 4 handler**; control route logs old→new + alerts; session endpoint reads runtime config + tracker map (static Phase 3 map gone) + probe gate; salted buckets + max_channels=2; shutdown stops checks; env clamps + defaults; tracker/interval gating; passive dedupe per identity. **Integration (9, env-gated, same spawn/skip-guard as stt-session-endpoint):** listing shape via Bearer AND x-natively-key (no secrets in payload), unauthenticated/garbage → 401, admin inspection full shape + secrets-never-serialized, missing/wrong admin secret → 401 (and no state change), kill-switch flip → session returns railway → restore → relay again (both changes logged), force_region/enable_percent overrides + 400-validation matrix (rejected input applies nothing), latency probes honored (lowest RTT wins) / ignored when disabled (default region wins + listing reports the gate), stereo bucket 100% ⇒ max_channels 2 + stereo honored vs 0% ⇒ clamped mono — **20/20 pass with env** (integration tier skips cleanly without Supabase env) |
| `packages/stt-relay-core/tests/*.test.mjs` (full core incl. parity vs edited server.js) | 277 | **277/277 pass** (251 existing + 26 new) |
| `tests/stt-session-endpoint.test.mjs` (Phase 3 contract — endpoint health wiring changed) | 18 | **18/18 pass** |
| `tests/unit-fixes.test.mjs` + `tests/flash-model-picker.test.mjs` (regression) | 56 | **56/56 pass** |
| `node --check server.js` | — | pass |
| `relaySelection.test.mjs` | 26 | unchanged — selector untouched, **no signature change needed** (per brief preference) |

---

## 7. Decisions / deviations

1. **Selector untouched.** All health/runtime wiring happens in server.js through the existing `healthMap`/`latencyProbes`/parameters — exactly the Phase 3 extension plan; `relaySelection.test.mjs` needed zero changes.
2. **Probe path `/healthz`, not `/readyz`.** The brief specifies `/healthz` (docs/01 §2.3 says `/readyz`). Followed the brief: at this phase the relays don't exist yet, and Phase 5 builds both endpoints; switching the control plane to `/readyz` (capacity-aware shedding) is a one-line `healthUrl` change documented for Phase 5/7.
3. **Assumed-healthy-until-probed** for configured regions: makes wiring the tracker in behavior-neutral vs Phase 3 (URL-presence map) and avoids a railway stampede during a control-plane cold start before the first probe completes.
4. **Passive failures deduped per identity-hash per cache window** (docs/01 §9's "≥3 distinct identities") — implemented in server.js, not the tracker, so the tracker's `recordPassiveFailure` stays a clean consecutive-count primitive any caller can use.
5. **Passive success ≠ recovery.** Only an active probe success flips an unhealthy region back. A region that fails its probes but happens to issue tokens must not self-heal off issuance alone.
6. **Runtime overrides not persisted** (§3.4 above) — intentional, documented in the route's response `note` field so the operator is told at flip time.
7. **Stereo/dual-stream buckets salted** (`stereo:`/`dualstream:` prefixes) for cohort independence; dual-stream's Phase 3 unsalted bucket changed pre-rollout (percent 0 everywhere ⇒ no user-visible change).
8. **`failed_relay_region`** (not the design's `failed_relay_id`): regions are the routing unit on the control plane today (one relay per region); the field name matches what the selector can act on. Phase 5 relays get ids (`us-1`); the body field can grow `failed_relay_id` alongside without breaking anything.
9. **Admin sees full relay URLs** (brief's explicit call: "admin may see full URL") — they're operator-deployed public endpoints; the secrets boundary is the token secret + provider keys, which no Phase 4 handler references at all (test-enforced).
