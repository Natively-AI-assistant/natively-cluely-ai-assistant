# Phase 7/8 — Client Integration (Electron desktop ↔ STT relay)

**Date:** 2026-06-13
**Status:** Complete — typecheck green, 44 new unit tests green, flag-OFF unchanged-behavior proven. Seam wired (flag-on attempts the relay); full-socket state-machine path is exercised by Phase 11 integration.
**Inputs (binding):** `docs/01-target-stt-relay-architecture.md` §5 (client responsibilities, fallback ladder, flags), `docs/03-relay-session-token.md` §2 (`POST /v1/stt/session` contract), `docs/05-stt-relay-service.md` §2 (relay WS auth frame + error vocabulary).

**One-sentence summary:** A flag-gated, byte-for-byte-additive integration that resolves a regional relay session via `POST /v1/stt/session` before the first WS connect, sends a `session_token` auth frame to relay URLs (and the unchanged legacy `key`/`trial_token` frame to the Railway URL), walks an ordered fallback ladder (relay → alternate → railway) on failure, and never logs tokens/keys — with the legacy direct-Railway path preserved as the final rung and as the entire flag-off behavior.

---

## 1. Files created / modified

| File | Change |
|---|---|
| `electron/audio/relaySession.ts` | **NEW.** Pure-ish resolver: `resolveRelaySession()`, `buildFallbackChain()`, `getCachedSession`/`setCachedSession`/`clearCachedSession`, `getHardcodedRailwayUrl()`. No UI, no WebSocket. |
| `electron/audio/NativelyProSTT.ts` | **MODIFIED (additive).** New deps/flags/telemetry injection (`NativelyProSTTDeps`), relay pre-flight seam in `connect()`, `buildAuthFrame(url)`, fallback-ladder helpers (`maybeAdvanceTarget`/`forceAdvanceTarget`/`installTarget`/`connectUrl`/`kindForUrl`/`isOnRelayTarget`), telemetry, relay-state reset in `start()`/`stop()`. Reconnect machine NOT rewritten. |
| `electron/services/SettingsManager.ts` | **MODIFIED.** 7 new typed `AppSettings` flags + typed getters + `isRegionalSttRelayEnabledForKey()` gate + module-level `fnv1aBucket()`. |
| `electron/services/telemetry/TelemetryService.ts` | **MODIFIED.** 7 new `TelemetryEventName` entries. |
| `electron/main.ts` | **MODIFIED (minimal, ~line 1508).** Passes `appVersion` + `platform` into the `NativelyProSTT` constructor; the class reads flags from `SettingsManager` itself and derives the control-plane base URL. |
| `electron/audio/__tests__/Relay*.test.mjs` | **NEW.** 4 suites, 44 tests. |

---

## 2. Client integration contract (re-implementable elsewhere)

### 2.1 Session-create request — `POST {controlPlaneBaseUrl}/v1/stt/session`

`controlPlaneBaseUrl` defaults to `https://api.natively.software` (derived from the wss host of `BACKEND_URL`). `content-type: application/json`. Body:

```json
{
  "key": "natively_sk_…",            // OR "trial_token": "natively_trial_…" (never both)
  "region_hint": "us",                // from forceSttRelayRegion, or omitted
  "latency_probes": { "us": 42, "asia": 180 }, // optional; see "Latency probes" below
  "app_version": "2.7.0",
  "platform": "mac",                  // mac | windows | linux
  "language": "en-US",
  "language_alternates": ["en-GB"],
  "sample_rate": 16000,               // min(client rate, sttMaxSampleRate)
  "audio_channels": 1,                // min(client channels, sttMaxChannels)
  "channel": "system",                // system | mic
  "intent": "meeting"
}
```

Timeout: **4000ms** default via `AbortController`. On **any** failure (non-2xx, timeout, network, malformed body, missing `session_token` or `relay_ws_url`, **402 quota**) → resolver returns `null` and the caller uses the legacy direct-Railway path. A 402 is logged with a discriminable reason but is **not** surfaced here — the WS path re-surfaces `transcription_quota_exceeded` to the user exactly as today.

#### Latency probes (`relaySession.ts` → `getRelayLatencyProbes()`)

The client measures each relay's HTTPS `/healthz` round-trip and passes the results as
`latency_probes` so the control plane can pick the lowest-latency healthy relay (docs/01 §8) instead
of falling back to coarse geo routing. Design constraints — it must **never** add latency to
session-create:

- `getRelayLatencyProbes()` returns whatever is **cached** (TTL 5 min); it returns `null` on the very
  first call and kicks off a **fire-and-forget** background measurement whose result lands in the cache
  for the *next* session-create. The connect path never awaits a probe.
- Each probe has a **1500ms** timeout; a failing/slow relay is simply omitted (the server then geo-routes).
- The server honors probes only when `STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES` is on; otherwise it ignores
  the field. Health URLs are derived from the relay hostnames via `deriveHealthUrl(wss→https/healthz)`.
- Covered by `electron/audio/__tests__/RelayLatencyProbes.test.mjs` (5 tests).

### 2.2 Session-create response (200) handling — docs/03 §2.3

Server snake_case → client camelCase (`RelaySessionConfig`):

| Server field | Client field | Notes |
|---|---|---|
| `session_id` | `sessionId` | |
| `session_token` | `sessionToken` | **required**; NEVER logged |
| `relay_ws_url` | `relayWsUrl` | **required** |
| `fallback_relay_ws_url` | `fallbackRelayWsUrl` | nullable (other region / railway target) |
| `railway_fallback_ws_url` | `railwayFallbackWsUrl` | defaults to hardcoded Railway URL if absent |
| `selected_region` | `selectedRegion` | |
| `stt_config.*` | `sttConfig.{sampleRate,audioChannels,language,languageAlternates,channel}` | server-clamped echo |
| `limits.*` | `limits.{maxSampleRate,maxChannels,allowDualStream,maxSessionSeconds,maxBytesPerSession}` | |
| `quota_remaining` | `quotaRemaining` | |
| `expires_at` (ISO or epoch ms) | `expiresAt` (epoch ms) | unknown/absent → "now" (forces re-resolve) |

### 2.3 Auth-frame selection rule (the crux)

`buildAuthFrame(url)` picks the shape from the url + token state:

| URL kind | Condition | Frame shape |
|---|---|---|
| **relay** / **alternate** | url is a relay target AND `config.sessionToken` is non-empty | `{ session_token, sample_rate, audio_channels, language, language_alternates, channel, app_version, platform }` — **no key, no trial_token** |
| **railway** (last rung) | url is the Railway URL | LEGACY `{ sample_rate, language, language_alternates, audio_channels, channel, key \| trial_token }` — **no session_token, no app_version** |
| **any url, flag OFF** | no relay target installed | LEGACY frame (identical to pre-Phase-7) |
| relay target but **empty token** | defensive | LEGACY frame |

The legacy frame is the verbatim shape from the original `'open'` handler: trial sentinel (`TRIAL_SENTINEL_KEY`) swaps in `CredentialsManager.getTrialToken()` as `trial_token`; otherwise `key` carries the raw API key.

---

## 3. Fallback ladder state machine

```
                      regionalSttRelayEnabled && rollout gate
                                  │  (flag OFF / no credential ──────────────┐
                                  ▼                                          │
   start()/first connect()  →  maybeResolveRelayTarget()                     │
                                  │ cache hit? ── yes ──► installTarget(cached)
                                  │ no                                       │
                                  ▼                                          │
                       POST /v1/stt/session (4s timeout)                     │
                          │ ok                  │ null (any failure / 402)   │
                          ▼                     ▼                            ▼
                installTarget(config)   installTarget(null) ───────► chain = [BACKEND_URL]
                          │                                                  │
                          ▼                                                  │
        chain = [relayWsUrl, fallbackRelayWsUrl?, railwayFallbackWsUrl]      │
                          │  (dedup, drop nulls; railway stripped iff        │
                          │   sttRailwayFallbackEnabled === false)           │
                          ▼                                                  │
        ┌──────────► dial chain[index]  ◄──────── scheduleReconnect() ◄──────┘
        │                 │                              ▲
        │            connect close (non-intentional)     │ (existing backoff:
        │                 │                              │  base 1500ms, cap 30s, ±20% jitter)
        │      maybeAdvanceTarget(failedUrl, code)       │
        │                 │                              │
        │   sameUrlFailures++ ; advance after 2 ─────────┘
        │
        └─ token-fatal (invalid_key_format on a relay url):
             clearCachedSession(channel) → forceAdvanceTarget (advance on 1st failure, NOT fatal)

   index walks: relay (0) ──2 fails──► alternate (1) ──2 fails──► railway (2, terminal: onRailway=true, no flap-back)
```

**Advance triggers**
- **Same-relay ×2:** a non-intentional WS close on the current rung increments `sameUrlFailures`; on the 2nd failure `advance()` bumps `index` and resets `reconnectAttempts` (fresh backoff for the new rung).
- **Token-fatal on a relay:** the relay maps an expired/forged **session token** to `invalid_key_format` (docs/05 §2.4). On a relay url this advances **immediately** (skips the ×2 budget) and is **NOT** session-fatal — the cache is cleared and the next rung (alternate relay → Railway with legacy auth) re-validates the real key. On the **Railway** url `invalid_key_format` remains fatal exactly as today.
- **Terminal rung:** reaching Railway sets `onRailway=true`; no further advance and no flap-back to a relay for the rest of the meeting (next meeting re-evaluates).
- **Stale close guard:** an advance only fires when `failedUrl === chain[index]` (ignores a delayed close from an already-superseded socket).

**Preserved fatal vocabulary:** `trial_expired`, `transcription_quota_exceeded`, `auth_timeout` stay session-fatal on every url (real user-facing states). The reconnect machine (`scheduleReconnect`, DNS-retry path, stability timer, backoff cap) is **unchanged** — the ladder only changes which url `connectUrl()` returns on the next dial.

---

## 4. Feature flags (`AppSettings`, read via `SettingsManager`)

| Name | Type | Default | Effect |
|---|---|---|---|
| `regionalSttRelayEnabled` | boolean | `false` | Master switch. OFF ⇒ no session-create, BACKEND_URL, legacy frame (unchanged). |
| `regionalSttRelayPercent` | number (0–100) | `0` | Client-side rollout gate. |
| `forceSttRelayRegion` | `'us' \| 'asia' \| null` | `null` | Sent as `region_hint` to session-create. |
| `sttRailwayFallbackEnabled` | boolean | `true` | When `false`, the Railway URL is stripped from the chain (relay-isolation QA). Default `true` so production always has the net. |
| `sttMaxSampleRate` | number | `16000` | Client-side cap echoed into the request (server re-clamps). |
| `sttMaxChannels` | number | `1` | Client-side cap echoed into the request. |
| `sttAllowDualStream` | boolean | `false` | Advisory; server authoritative. |

### 4.1 Rollout gate precedence (`isRegionalSttRelayEnabledForKey(apiKey)`)

1. `regionalSttRelayEnabled !== true` → **false** (master off wins).
2. master ON + `percent <= 0` → **true** (Enabled-as-override = 100%). *A developer flipping the master switch with no dial expects the relay on, not silently gated to nothing.*
3. master ON + `percent >= 100` → **true**.
4. master ON + `0 < percent < 100` → `fnv1aBucket(apiKey) % 100 < percent`.

`fnv1aBucket` is a stable FNV-1a-32 hash → `[0,99]`. Deterministic per key and **monotonic** (raising the percent only ever adds keys), mirroring the server's rollout intent (docs/01 §8). The client gate is in **addition** to the server's authoritative gate; both must agree for the relay to be used (the server can still return a railway-only chain).

---

## 5. Telemetry events (via `telemetryService.record` — sanitized, never token/key/transcript)

| Event | Properties |
|---|---|
| `relay_session_resolved` | `region`, `hadFallback` |
| `relay_selected` | `kind` (relay\|alternate\|railway), `region` |
| `relay_connected` | `kind`, `region`, `firstConnectMs` |
| `relay_failed` | `kind`, `closeCode`, `reason` (close\|token_fatal) |
| `relay_fallback_used` | `fromKind`, `toKind` |
| `first_transcript_latency_bucket` | `bucket` (`<500`/`<1000`/`<2000`/`<4000`/`>=4000`), `kind` |
| `stt_relay_disabled_flag_off` | `channel` (emitted once/session when the flag is off) |

All properties are metadata only. `sanitizeTelemetryProperties` (TelemetryService) redacts secret-shaped keys/values as a backstop, but by construction these calls never pass the token, key, or transcript text.

---

## 6. Flag-OFF safety guarantee (byte-for-byte identical)

When `regionalSttRelayEnabled` is OFF (default):
- `maybeResolveRelayTarget()` returns **false synchronously** — the resolver is never constructed, `/v1/stt/session` is never called, `this.target` stays `null`.
- `connectUrl()` returns the hardcoded `BACKEND_URL = wss://api.natively.software/v1/transcribe`.
- `buildAuthFrame(url)` returns `buildLegacyAuthFrame()` — the verbatim legacy frame (extracted unchanged from the original `'open'` handler).
- `maybeAdvanceTarget()`/`forceAdvanceTarget()` are no-ops (single-entry chain / null target).
- The reconnect machine, backoff, DNS-retry, stability timer, and fatal-error handling are untouched.

This is proven by the test **"flag OFF: resolver never called, connect() dials BACKEND_URL, legacy frame"** (RelayFallbackLadder.test.mjs).

---

## 7. Test inventory + results

`npm run build:electron` then `node --test electron/audio/__tests__/Relay*.test.mjs` → **44/44 pass**.

| Suite | Tests | Covers |
|---|---|---|
| `RelaySessionResolve.test.mjs` | 21 | happy path snake→camel mapping; correct request body (key vs trial_token, hints, channel); non-2xx/401/402/timeout/network/malformed/missing-token/missing-url/no-credential → null; **token never in logs**; buildFallbackChain ordering+dedup+null-drop+null→[railway]; cache get/set + 15s-skew expiry + per-channel eviction |
| `RelayAuthFrameSelection.test.mjs` | 7 | relay/alternate url → relay frame (session_token, no key); railway url → legacy frame (key, no token); flag-off → legacy; empty-token relay → legacy; structural guard (relay branch never sets `key:`); trial + paid both correct |
| `RelayFallbackLadder.test.mjs` | 10 | installTarget chain + connectUrl; advance only after 2 same-relay fails; relay→alternate→railway walk + terminal stick; stale-close ignored; token-fatal immediate advance (not kill); no token-advance on railway; railway-strip when fallback flag off; **flag-OFF unchanged-behavior proof**; flag-ON async resolve seam |
| `RelayFlagGate.test.mjs` | 6 | fnv1aBucket determinism + [0,99] range + distribution; precedence (off→false, %0→override-true, %100→true, mid deterministic, monotonic); structural guard pinning the class precedence |

**Gates:** `npm run typecheck:electron` (tsc -p electron/tsconfig.json --noEmit) → **pass**. Full audio suite: **213 pass / 8 fail**, where all 8 failures are pre-existing structural tests against unrelated `main.ts` regions (single-instance lock, model-changed targeting, gemini-chat-stream, token batcher, curl provider, streamChat) — verified identical on pristine `HEAD:electron/main.ts`. Phase 7 adds **zero** regressions.

---

## 8. What is fully wired vs deferred to Phase 11

**Fully wired (flag-on attempts the relay end to end):**
- Session-create call + response parsing + per-channel session cache.
- The connect() seam: flag-on triggers an async resolve, blocks the socket, and re-enters connect() with the resolved chain.
- Auth-frame selection (relay vs legacy) at the live `'open'` handler.
- The fallback-ladder advance points: same-relay ×2 (close handler) and token-fatal (message-error handler), advancing `connectUrl()` for the next `scheduleReconnect()` dial.
- All telemetry emission points.
- Flag plumbing + the deterministic client gate + the minimal main.ts construction-site wiring.

**Deferred to Phase 11 (observability/integration), exercised there not here:**
- The full live-socket state-machine walk (real WS opens/closes against a mock/staging relay across all rungs) — Phase 11 integration. The unit tests here drive the **extracted pure helpers** that the live path composes, plus structural guards that pin the wiring.
- Axiom/Sentry/PostHog sink delivery (TelemetryService currently writes local JSONL; the new event names are registered and emitted; the SDK-backed sinks are a Phase 11 concern).
- Passive `failed_relay_id` re-POST signal (docs/01 §2.3) — the client advances its **cached** chain today; sending `failed_relay_id` on a session re-create is a Phase 11/8-extension item.

---

## 9. Key decisions

1. **Class reads its own flags; main.ts edit stays tiny.** The construction site only passes `appVersion`+`platform`; the class lazy-requires `SettingsManager` (a throw → relay simply disabled). Keeps the delicate constructor call site minimal and the seam testable via injected `deps.flags`.
2. **Resolver returns `null` on every failure incl. 402.** The WS path remains the single place that surfaces user-facing quota/auth errors, so the resolver never duplicates that surface — it just decides "relay or not".
3. **Token-fatal on a relay advances, not kills.** A bad/expired session token (mapped to `invalid_key_format` by the relay) must fall through to the next rung; only `invalid_key_format` on the **Railway** url stays fatal (real bad key).
4. **Did not rewrite `scheduleReconnect`.** The ladder only changes which url `connectUrl()` yields; the proven backoff/DNS/stability machine is untouched. Advance is a surgical helper invoked in the close and message-error handlers.
5. **Per-channel cache with 15s skew.** Reuses a still-valid token across a 1006 blip (avoids hammering session-create); a relay hard failure clears it so re-resolve gets a healthy rung.
6. **`sttRailwayFallbackEnabled=false` strips Railway for QA only.** Default `true` so production always terminates the chain at the unchanged emergency path (migration invariant docs/01 §16.2).
