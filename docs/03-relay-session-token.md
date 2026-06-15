# Phase 3 — Relay Session Tokens + `POST /v1/stt/session`

**Date:** 2026-06-13
**Status:** Complete — all gates green
**Inputs (binding):** `docs/01-target-stt-relay-architecture.md` §2/§7/§8, `docs/00-current-server-audit.md` (route table, auth helpers), `docs/02-stt-core-extraction.md` (core package layout).
**Scope:** shared token module + basic relay selector in `packages/stt-relay-core`, plus ONE additive control-plane endpoint in `natively-api/server.js`. `/v1/transcribe` and every existing route are byte-for-byte untouched (verified: `git diff --stat` = `server.js | 187 insertions(+)`, zero deletions; the Phase 2 parity suite still passes against the edited file).

---

## 1. Token format spec

### 1.1 Wire format

```
"v1." + base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, "v1." + payloadB64))
```

- Exactly three `.`-separated segments. The HMAC input includes the `v1.` version prefix, so a token cannot be re-versioned without re-signing.
- Same compact-HMAC construction as the production trial token (`server.js:1716-1744`) — proven in prod; `node:crypto` only, no JWT library, no `alg` header (no algorithm-confusion / `none`-downgrade class).
- Module: `natively-api/packages/stt-relay-core/src/sessionToken.js`. The Phase 5 relay imports `verifySessionToken` + `createJtiCache` from this same file — the format lives in ONE place.

### 1.2 Claims

| Claim | Type | Source | Notes |
|---|---|---|---|
| `v` | int | signer | always `1`; payload-level version check in addition to the prefix |
| `jti` | uuid | signer (`crypto.randomUUID`) | replay-cache nonce; one WS admission per token |
| `session_id` | string | control plane | `st_<uuid>` |
| `sub` | string | `hashIdentity(identity)` | sha256 16-hex prefix of the stable identity — **never** a raw API key or trial token (F1) |
| `auth_type` | `'api_key'\|'trial'` | auth result | |
| `plan` | string | `auth.user.plan` / `'trial'` | |
| `channel` | `'system'\|'mic'\|'default'` | request body, whitelisted via core `validateChannel` (F16) | relay must match it against the first-frame channel |
| `region` | `'us'\|'asia'\|'railway'` | selector output | relay rejects tokens whose region ≠ its own (`wrong_region`) |
| `quota_remaining_seconds` | int | `floor(quota.transcription.remaining × 60)` | budget for the relay's 25s quota watchdog |
| `allowed_providers` | string[] | live provider-health picker availability (`providerHealth` + key pools) | snapshot at issue time |
| `max_sample_rate` | int | `STT_MAX_SAMPLE_RATE` (default 16000) | relay clamps the auth frame to this |
| `max_channels` | int | `STT_MAX_CHANNELS` (default 1) | |
| `allow_dual_stream` | bool | `rolloutBucket(identity) < STT_ALLOW_DUAL_STREAM_PERCENT` | deterministic per identity |
| `app_version` | string\|null | body passthrough, truncated to 64 chars | |
| `platform` | string\|null | body passthrough, truncated to 64 chars | |
| `iat` | unix s | signer clock | caller-supplied `iat`/`exp` in claims are overridden — always computed at sign time |
| `exp` | unix s | `iat + ttl` | |

**NOT in the token:** provider API keys (Deepgram/Google/EL keys live only in relay env), the raw user API key, the raw trial token, IPs, emails.

### 1.3 TTL

`STT_SESSION_TOKEN_TTL_SECONDS`, default **180 s**, clamped **120–300** at startup. Expiry gates *admission only* — it never kills a live WS session (the quota watchdog does that, per docs/01 §7).

### 1.4 Verification semantics (`verifySessionToken`)

Returns `{ok:true, claims}` or `{ok:false, code}`:

| Code | Condition |
|---|---|
| `malformed` | empty/non-string, wrong segment count, bad base64, non-JSON/non-object payload, missing numeric `iat`/`exp` |
| `bad_version` | prefix `v<N≠1>.` or signed payload with `v ≠ 1` |
| `bad_signature` | HMAC mismatch under both current and prev secret (timingSafeEqual, length-guarded) |
| `not_yet_valid` | `iat` more than **30 s** in the verifier's future (`IAT_SKEW_TOLERANCE_SECONDS`) |
| `expired` | `now ≥ exp` — **strict**, zero grace |
| `wrong_region` | `expectedRegion` provided and ≠ `claims.region` |

Check order: structure → signature → JSON → version → iat → exp → region. Signature is verified **before** the payload is parsed/used. Missing secret **throws** (fail loud, never fail open).

### 1.5 Rotation

`verifySessionToken({secret, prevSecret?, …})` tries the current secret first, then `prevSecret`. During a rotation window, deploy `STT_SESSION_TOKEN_SECRET` (new) + `STT_SESSION_TOKEN_SECRET_PREV` (old) to relays, rotate the signer, then drop the prev after the max TTL (300 s) has elapsed.

### 1.6 Replay protection — `createJtiCache`

Per-relay in-memory nonce cache: `checkAndStore(jti, exp)` → `true` (fresh, stored; entry lives until the token's `exp`) / `false` (replay). Pure Map + opportunistic sweep, injectable clock, no real timers. Bounded by `maxEntries` (default 100k): when full it sweeps expired entries first, then evicts oldest-inserted (bounded memory beats a marginally longer replay window under flood). Empty/non-string jti is never fresh.

---

## 2. Endpoint spec — `POST /v1/stt/session`

`server.js:4242-4372` (config block `:4192-4240`, imports `:55-62`). Control-plane only; no audio flows through it.

### 2.1 Request

```json
{
  "key": "natively_sk_…",            // OR
  "trial_token": "natively_trial_…",
  "region_hint": "IN",                // ISO-3166 alpha-2 OR coarse ('us','asia','eu','latam','apac',…)
  "latency_probes": { "us": 42, "asia": 187 },
  "app_version": "3.4.1",
  "platform": "darwin",
  "language": "en-US",
  "language_alternates": ["en-GB"],
  "sample_rate": 16000,
  "audio_channels": 1,
  "channel": "system",                // whitelist {system, mic, default}; junk → 'default'
  "intent": "meeting"                 // accepted, currently unused
}
```

### 2.2 Behavior (in order)

1. Secret unset → `503 {"error":"feature_unavailable"}` (startup logs ONE warning; server never crashes — deviation from docs/01 §2.4's boot-fail, per this phase's brief).
2. `checkDDoS(getIP(req))` → `429 {"error":"ip_blocked"}`.
3. **Auth — exact reuse of the WS-path helpers and branching** (`server.js:5894-5901` semantics): `key.startsWith(KEY_PREFIX)` → `validateKey(key, ip)` (`:2030`, with keyCache + maybeResetQuota); else `trial_token` → `validateTrial(trial_token, ip)` (`:1778`, with trialCache); else `invalid_key_format` / `auth_required`. Failures return `auth.status` + the existing error vocabulary (`key_not_found`, `subscription_inactive`, `account_suspended`, `trial_expired`, `trial_not_found`, `trial_ended`, `invalid_trial_token`, `ip_blocked`). Zero duplicated auth logic; the handler never touches Supabase directly (asserted by a source-check test).
4. **Quota**: `auth.quota.transcription.remaining <= 0` → `402 {"error":"transcription_quota_exceeded","resets_at":…}` — same string + field as the WS path (MUST-PRESERVE §4). `quota_remaining_seconds = floor(remaining × 60)` (same minutes→seconds math as the WS watchdog capture at `:6151-6155` region).
5. **Identity** for rollout hashing: `auth.user.id` (key id) or `trial_<trial.id>` — never the raw credential; falls back to `hashIdentity(key)` if no id.
6. **Selection** via core `selectRelay` (§3 below).
7. **Token signing** with the §1.2 claims; `session_id = st_<randomUUID()>`.
8. Structured log: hashed sub, region, reason, bucket, channel — never the token or credentials.

### 2.3 Response (200)

```json
{
  "session_id": "st_5cfe…",
  "session_token": "v1.eyJ2IjoxLCJqdGkiOi….k3jX9…",
  "relay_ws_url": "wss://us-relay.natively.software/ws",
  "fallback_relay_ws_url": "wss://asia-relay.natively.software/ws",
  "railway_fallback_ws_url": "wss://api.natively.software/v1/transcribe",
  "selected_region": "us",
  "stt_config": {
    "sample_rate": 16000,
    "audio_channels": 1,
    "language": "en-US",
    "language_alternates": ["en-GB"],
    "channel": "system"
  },
  "limits": {
    "max_sample_rate": 16000,
    "max_channels": 1,
    "allow_dual_stream": false,
    "max_session_seconds": 14400,
    "max_bytes_per_session": 0
  },
  "quota_remaining": 28800,
  "expires_at": "2026-06-13T10:03:00.000Z"
}
```

- `relay_ws_url`: the selected region's URL; when `selected_region === 'railway'` it is the railway fallback URL itself.
- `fallback_relay_ws_url`: the OTHER region's URL; `null` when that region's URL env is unset or target is railway.
- `railway_fallback_ws_url`: always present (default `wss://api.natively.software/v1/transcribe`).
- `stt_config` echoes the request clamped to limits: `sample_rate = min(requested, max_sample_rate)`, `audio_channels = min(requested, max_channels)`, `language` validated against the existing `WS_LANG_RE` (core copy of `server.js:6149`) else `en-US`, alternates filtered by the same regex (≤5), `channel` whitelisted.
- Status codes: `200` issued; `401` auth (existing vocabulary); `402` quota (+`resets_at`); `403` suspended/inactive/expired (from the helpers); `429` `ip_blocked` / global rate limit; `503` `feature_unavailable`.

### 2.4 Rate limiting

The codebase applies a single **global** Fastify rate limit (120/min keyed by key/trial/IP, `server.js:213-239`); no existing route registers a per-route limit, and WS upgrades are exempted. `/v1/stt/session` follows the same pattern: covered by the global limiter + `checkDDoS`, no bespoke per-route limiter (consistent with `/v1/trial/*`, `/v1/chat`, etc.).

---

## 3. Selection behavior — Phase 3 vs Phase 4

Module: `packages/stt-relay-core/src/relaySelection.js` (pure, no env).

**Phase 3 (this phase)** — `selectRelay({config, identity, regionHint, forcedRegion, killSwitch, enablePercent, defaultRegion, healthMap?, latencyProbes?})` → `{target, reason, bucket}` with docs/01 §8 priority:

1. `killSwitch` → `railway` (`kill_switch`)
2. `rolloutBucket(identity) ≥ enablePercent` → `railway` (`rollout_percent`). Bucket = `sha256(identity)` first 4 bytes (uint32 BE) `% 100` — deterministic and **monotonic**: raising the percent only ever adds users.
3. `forcedRegion` if healthy (`forced_region`)
4. `latencyProbes` → lowest-RTT healthy region (`latency_probe`)
5. `GEO_MAP[regionHint]` (exported table; accepts ISO-3166 alpha-2 or coarse strings, case-insensitive: US/CA/LatAm→us, IN/SE-E-Asia/AU/NZ→asia, EU/UK/MEA→us, unknown→`defaultRegion`) (`geo_map` / `default_region`)
6. Selected region unhealthy → alternate (`*_unhealthy_alternate`); both unhealthy → `railway` (`all_relays_unhealthy`)

Health defaults to **healthy** when `healthMap` is absent. The endpoint passes `healthMap: { us: !!STT_RELAY_US_URL, asia: !!STT_RELAY_ASIA_URL }` — an unconfigured region URL counts as unhealthy, so selection degrades to the other region or Railway instead of returning a null `relay_ws_url`.

**Phase 4 (next)** extends through the SAME signature: the active `/readyz` health-cache feeds `healthMap`, client probe plumbing + the §2.3 passive `failed_relay_id` signal feed in, plus session-affinity pinning (§8 step 0) and `STT_RELAY_ALLOWLIST`. No signature change anticipated; `config` is the reserved extension point.

---

## 4. Auth reuse (which server.js helpers are called)

| Concern | Helper | server.js (pre-edit audit lines) |
|---|---|---|
| IP extraction | `getIP(req)` | `:1565-1573` |
| DDoS gate | `checkDDoS(ip)` | `:1470-1486` |
| API key validation (+keyCache 30s, audit writes, `maybeResetQuota`) | `validateKey(key, ip)` | `:2030-2106` |
| Trial validation (+trialCache 15s) | `validateTrial(trial_token, ip)` | `:1778-1805` |
| Key format constant | `KEY_PREFIX` | `:1634` |
| Provider availability for `allowed_providers` | `providerHealth.*` + `hasAvailableDeepgramKey()` / `hasAvailableElevenLabsKey()` | `:3431-3445` |

Both helpers are **top-level functions** (per the audit), so no extraction from the WS closure was needed. The branching (`key.startsWith(KEY_PREFIX)` → key; else trial; else `invalid_key_format`/`auth_required`) mirrors the WS auth handshake exactly.

**NOT implemented in this phase (Phase 2/7 per docs/01 §18):** the atomic quota lease RPC `stt_reserve_session` (F7) — `quota_remaining_seconds` is the same ≤30s-stale-cache snapshot the WS path uses today, bounded by the same watchdog contract; `GET /v1/stt/relays`; admin routes; health checker.

---

## 5. Env vars added (all read once at startup, `server.js:4192-4230`)

| Var | Default | Meaning |
|---|---|---|
| `STT_SESSION_TOKEN_SECRET` | — | HMAC secret. Unset ⇒ endpoint 503s + one startup warning (server does NOT crash) |
| `STT_SESSION_TOKEN_TTL_SECONDS` | `180` | token TTL, clamped 120–300 |
| `STT_RELAY_US_URL` | — | us relay WSS URL; unset ⇒ region treated unhealthy |
| `STT_RELAY_ASIA_URL` | — | asia relay WSS URL; unset ⇒ region treated unhealthy |
| `STT_RELAY_RAILWAY_FALLBACK_URL` | `wss://api.natively.software/v1/transcribe` | always-present emergency path |
| `STT_RELAY_DEFAULT_REGION` | `us` | unknown-geo default |
| `STT_RELAY_ENABLE_PERCENT` | `0` | deterministic rollout percent (0 ⇒ everyone railway) |
| `STT_RELAY_FORCE_REGION` | unset | dogfood region override |
| `STT_RELAY_KILL_SWITCH` | `0` | `1`/`true` ⇒ always railway |
| `STT_MAX_SAMPLE_RATE` | `16000` | token `max_sample_rate` claim + config clamp (F14 cost guard) |
| `STT_MAX_CHANNELS` | `1` | token `max_channels` claim + config clamp |
| `STT_ALLOW_DUAL_STREAM_PERCENT` | `0` | deterministic per-identity `allow_dual_stream` gate |

---

## 6. Test inventory + results

| Suite | Tests | Result |
|---|---|---|
| `packages/stt-relay-core/tests/sessionToken.test.mjs` (NEW) | 28 | roundtrip (all claims), wire format, sig-covers-prefix, iat/exp not overridable, expiry boundary (valid at exp−1s, dead at exp), payload byte-flip → `bad_signature`, sig tamper, claims-rewrite forgery, wrong secret, prev-secret rotation (both directions), no-secret throws, wrong region, bad version (prefix + payload level), malformed matrix (empty/dots/b64/non-JSON/array/null/missing iat-exp/non-string), iat skew ±30s boundary (30s ok, 31s `not_yet_valid`), strict exp (no grace), jti fresh/replay/exp-seconds-expiry/sweep/maxEntries-eviction/sweep-before-evict/junk-jti, e2e verify+jti, jti uniqueness — **28/28 pass** |
| `packages/stt-relay-core/tests/relaySelection.test.mjs` (NEW) | 26 | bucket determinism vs independent sha256, 0-99 range, 10k-id distribution at 10% within ±50%, monotonicity, kill switch beats all, percent 0 → all railway, percent 100 → none railway, bucket-gate edges, forced region, forced-but-unhealthy → alternate, invalid force ignored, latency probes (lowest / skip-unhealthy / junk-values / priority-below-force), geo matrix (US,CA,MX,BR,DE,FR,GB→us; IN,SG,JP,AU,KR,NZ…→asia; ''/unknown→default; defaultRegion override), case/trim insensitivity, GEO_MAP closure over RELAY_REGIONS, otherRegion, unhealthy→alternate, both-unhealthy→railway, absent/partial healthMap, NaN/oversized percent — **26/26 pass** |
| `natively-api/tests/stt-session-endpoint.test.mjs` (NEW) | 18 | Follows the `stt-health-system.test.mjs` pattern exactly: same `spawnServer` (spawn `node server.js`, poll `/health`), same `.env` loading, same Supabase-backed `itest` skip-guard. **Offline tier (9, always run):** source checks (route present; handler calls `validateKey`/`validateTrial`/`checkDDoS` and never queries `api_keys`/`free_trials` directly; 402 vocabulary; 503 gate without `process.exit`; issue-log hashes identity and never logs token/raw key; TTL clamp) + pure handler logic (railway URL mapping, endpoint-shaped token sign/verify with §7 claims, bucket stability). **Integration tier (9, env-gated):** missing secret → 503; kill switch → railway URLs + `region:'railway'` claim; percent=100+forced-us → us URL/asia fallback/railway present; percent=0 → railway; paid happy path (full contract keys, clamps 48k→16k & stereo→mono, alternates filtered, `st_<uuid>` id, exact-ISO `expires_at` within TTL clamp, offline token verify, sub≠raw key, token absent from logs); 401 matrix; channel-injection → 'default' in config+claim; trial happy path (mints a trial token the same way `generateTrialToken` does; skips with a note if no live trial row); quota-exceeded 402 (skips if no exhausted key in DB — gate covered by the source check) — **18/18 pass with env** (integration tier skips cleanly without Supabase env, same as the existing suites) |
| `packages/stt-relay-core/tests/*.test.mjs` (full core, incl. Phase 2 parity vs the EDITED server.js) | 251 | **251/251 pass** (197 existing + 54 new) |
| `tests/unit-fixes.test.mjs` + `tests/flash-model-picker.test.mjs` (regression) | 56 | **56/56 pass** |
| `node --check server.js` | — | pass |

---

## 7. Security notes

- **Not in the token:** provider keys, raw API key, raw trial token, IPs, emails. `sub` is a sha256 16-hex prefix (`hashIdentity`, F1 module). A captured token authorizes at most one WS admission (jti) on one region (region claim) for ≤300 s (exp) within a quota budget — it cannot mint quota, name a provider key, or be replayed cross-region.
- **Signature before parse:** verification HMACs the raw payload segment before its JSON is trusted; constant-time compare (`timingSafeEqual`) with length pre-guard; rotation tries at most two secrets.
- **No fail-open paths:** missing verifier secret throws; missing signer secret disables the endpoint (503) rather than issuing unsigned/weakly-signed tokens; `iat`/`exp` cannot be caller-injected through `claims`.
- **Log hygiene:** the only issue log line carries `hashIdentity(identity)`, region, reason, bucket, channel. Tested: the spawned-server suite asserts the session token never appears in server logs and the source-check forbids `sessionToken`/raw-key interpolation in the log template. Auth failures reuse the existing helpers' logging (which already redacts).
- **Rollout identity ≠ credential:** bucketing hashes the key **id** / trial id (or sha256 of the credential as fallback) — log lines and bucket math never see the raw key.
- **Existing auth untouched/un-weakened:** the endpoint adds checks (DDoS, auth, quota) in the same order as the WS path and adds no new auth bypass; `/v1/transcribe` is unmodified (git diff: insertions only, parity suite green).

## 8. Decisions / deviations

1. **Missing secret = 503, not boot-fail.** docs/01 §2.4 specifies the `TRIAL_JWT_SECRET` boot-fail pattern; the phase brief explicitly overrides this for the additive rollout (the feature is dark until provisioned; killing the whole API for an un-deployed feature's env var would be worse). Revisit at Phase 7 when the endpoint becomes load-bearing.
2. **Unset region URL ⇒ unhealthy** in the Phase 3 healthMap — keeps `relay_ws_url` non-null in every 200 response without inventing a health checker early.
3. **`max_bytes_per_session: 0`** in `limits` per the contract in the phase brief (0 = "relay computes its own 2× budget", matching `server.js` byte-budget semantics); the relay derives the real cap from the token's rate/channel claims.
4. **No `stt_reserve_session` lease yet** (F7) — Phase 2 schema/RPC work; quota snapshot semantics match today's WS path exactly until then.
5. **`intent` accepted but ignored** (forward-compat with the request shape in the brief).
6. **Env names:** the brief's `STT_SESSION_TOKEN_TTL_SECONDS` was used (docs/01 §2.4 calls it `STT_SESSION_TOKEN_TTL_S`); relays should standardize on the brief's name.
