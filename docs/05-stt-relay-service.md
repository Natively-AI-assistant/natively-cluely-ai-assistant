# Phase 5 — Standalone STT Relay Service (`services/stt-relay`)

**Date:** 2026-06-13
**Status:** Complete — 47/47 tests green, standalone boot verified, parent repo untouched
**Inputs (binding):**
`docs/00b-pre-migration-review-findings.md` (MUST-PRESERVE §1–12, MUST-FIX F1–F17),
`docs/01-target-stt-relay-architecture.md` (§3 relay responsibilities, §7 token, §9 health, §11 cost guards),
`docs/02-stt-core-extraction.md` (the core modules this service consumes — used, not re-implemented),
`natively-api/server.js` `/v1/transcribe` handler (~4186–6564) — orchestration semantics replicated.

**One-sentence summary:** A deployable Node ≥20 Fastify + `ws` relay that verifies a
short-lived HMAC session token offline, runs the exact `/v1/transcribe` client
contract over the shared core's provider chain, checkpoints billable usage to
Supabase idempotently, and exposes `/healthz` `/readyz` `/metrics` with a graceful
SIGTERM drain — installable and runnable independently of the Railway monolith.

---

## 1. Service layout

```
services/stt-relay/
├── package.json            # deps: fastify^4, @fastify/websocket^9, ws^8,
│                           #       @supabase/supabase-js^2, undici^8, dotenv;
│                           #       @natively/stt-relay-core via file:../../packages/…
│                           #       @google-cloud/speech optional
├── .env.example            # every env var, commented, placeholders, NO secrets
├── README.md               # run instructions
├── src/
│   ├── config.js           # the ONLY env reader (validate/clamp/default; fail-fast)
│   ├── logger.js           # structured JSON; never logs tokens/keys/audio (F1/F9)
│   ├── telemetry.js        # Axiom shipper + Sentry-lite + PostHog; bounded, no-op-safe
│   ├── usageStore.js       # Supabase flush/finalize RPCs; idempotent; retry queue (F5/F6)
│   ├── sessionRegistry.js  # byId / takeover / per-IP / global / TTL sweep (F12)
│   ├── ipTrust.js          # normalizeIPForLimit + hashIP; F8 trust lives in server.js
│   ├── providers/
│   │   ├── deepgram.js     # core router+pool+health → common adapter (F10/F17)
│   │   ├── googleStt.js    # wraps core rolling session as-is
│   │   └── elevenlabs.js   # core client framing → common adapter (gated on flag)
│   ├── session.js          # THE orchestrator (auth→prebuffer→chain→bill→close)
│   ├── server.js           # Fastify app + WS endpoint + caps + graceful drain;
│   │                       #   create(config,{providerFactory}) test hook
│   └── index.js            # entrypoint: load config, boot, banner, signals
└── tests/                  # node --test, no network, mock providers (47 tests)
```

The service consumes the Phase-2 core verbatim; it does **not** re-implement key
pools, health classification, the Google rolling session, EL framing, transcript
shapes, billing math, clamps, the token verify, or the jti cache.

---

## 2. WS protocol spec

### 2.1 Auth frame (first message, JSON, within `AUTH_TIMEOUT_MS` = 5s)

```json
{
  "session_token": "v1.<payloadB64>.<sigB64>",
  "sample_rate": 16000,
  "language": "en-US",
  "language_alternates": [],
  "audio_channels": 1,
  "channel": "system"
}
```

- First message MUST be JSON → else `auth_must_be_json` + close.
- `session_token` (or `token`) is required. A legacy `key`/`trial_token`-only frame
  fails loud & fatal with `auth_required` (a misrouted legacy client must not hang).
- Subsequent messages are raw binary LINEAR16 PCM.
- `language: "auto"` enables auto-detect (core `resolveLanguage`).

### 2.2 Token claim enforcement

The token is verified **offline** via core `verifySessionToken` with
`expectedRegion = config.REGION` + the per-relay jti replay cache. Enforced:

| Claim | Rule |
|---|---|
| signature / version / region | bad → fatal (mapping table §2.4) |
| `exp` | strict; expired → fatal |
| `jti` | single-use; replay → fatal |
| `channel` | must match the auth-frame `channel` (else fatal) |
| `max_sample_rate` / `max_channels` | the frame's `sample_rate`/`audio_channels` are clamped to `min(claim, global cap)` |
| `quota_remaining_seconds` | F7 lease snapshot → mid-session quota watchdog budget |
| `allowed_providers` | the relay's provider chain is intersected with this list |

Global caps: `ALLOW_48KHZ` raises the rate cap to 48000 (else 16000);
`ALLOW_STEREO` raises the channel cap to 2 (else 1). When the requested format
exceeds the effective cap:

- `REJECT_HIGH_BANDWIDTH_AUDIO=true` ⇒ `invalid_key_format` + close (`cost_guard`
  telemetry `bandwidth_reject`).
- `=false` ⇒ **down-negotiate** (clamp) and proceed; the clamped rate/channels
  flow to the provider; `cost_guard` telemetry `bandwidth_downnegotiate`. (F14)

### 2.3 Message flow

```
client → relay : {session_token, …}            (auth)
relay  → client: {status:'connected', provider, quota}
client → relay : <binary LINEAR16 PCM> …
relay  → client: {text, is_final:false, confidence}            (interim)
relay  → client: {text, full_text:<cumulative>, is_final:true, confidence}  (final)
relay  → client: {language_detected:<bcp47>}                   (≤ once/session)
relay  → client: {status:'provider_switched', from, to, reason, has_replay}  (failover)
client → relay : close
```

- `full_text` key is **absent** on interims (core `makeInterim`, wire-identical to
  server.js's `undefined`-drop). `full_text` on finals is the relay-local cumulative
  finals across **all** providers (so failover keeps one consistent transcript).
- `language_detected` is sent at most once per session.

### 2.4 Error / close vocabulary mapping (old server.js ↔ relay)

The token swap is the only behavioral change; every legacy error string keeps its
exact meaning. Token-verify outcomes map onto the EXISTING client vocabulary:

| verify code | `auth_type` | client error string | client-fatal? | rationale |
|---|---|---|---|---|
| `malformed` / `bad_signature` / `bad_version` / `wrong_region` / `not_yet_valid` | any | `invalid_key_format` | **yes** | a bad/forged/mis-regioned token never self-heals — correct to be fatal |
| `expired` | `trial` | `trial_expired` | **yes** | trial token lifetime ended |
| `expired` | `key` | `invalid_key_format` | **yes** | expired *session* token; the relay-aware client re-POSTs `/v1/stt/session` |
| jti replay | any | `invalid_key_format` | **yes** | one WS per token |
| channel mismatch | any | `invalid_key_format` | **yes** | token authorizes a specific channel |

> Note: the relay deliberately maps expired/bad **session tokens** onto
> `invalid_key_format` rather than introducing a brand-new `invalid_session_token`
> string, because Phase-5's mandate is to replicate the EXISTING client contract.
> `invalid_key_format` is already in the client's fatal set (`CLIENT_FATAL_ERRORS`);
> the relay-aware client treats a relay-path fatal as "re-create the session"
> (Phase-8 ladder), so the user still recovers. Legacy clients never reach the relay.

Other errors are reused verbatim from the core `ERR` table:
`auth_timeout`, `auth_must_be_json`, `auth_required`, `transcription_quota_exceeded`
(+`resets_at`), `all_stt_providers_down` (+`reason` mid-session), `chunk_too_large`,
`session_byte_budget_exceeded`.

Close codes (core `CLOSE`): `1001 server_restart` (graceful drain), `1008`
too-many-connections / quota cutoff / byte-budget / max-duration, `1009`
auth-queue overflow, `1013 server_at_capacity`.

---

## 3. Provider chain + shadow-probe decision

Forward-only chain **deepgram → googleSTT → elevenlabs → null**, identical
semantics to server.js (MUST-PRESERVE §11) via core `sttPicker`, `providerHealth`
(HTTP-status / error-frame / gRPC / EL classifiers), `deepgramPool`/`elevenLabsPool`
(key rotation, spreader), `deepgramRouter` (model/lang/URL), `googleRollingSession`
(used as-is), `elevenLabsClient` (framing). On a fatal provider error the session
snapshots the prebuffer, **tears down ALL prior provider resources first (F13)**,
emits `provider_switched`, then connects the next provider and replays.

Provider-level fixes honored:
- **F17** — the Deepgram connect-timeout and first-message-deadline timer bodies are
  guarded by `ctx.isAlive()` (session liveness) before striking pool/key health, so a
  timer that fires after the session closed never poisons a key.
- **F10** — before each forward the session consults core `checkProviderBuffer`:
  `send` below cap, `drop` (shed + count `chunks_dropped` + `backpressure_shed`
  telemetry) between cap and 4×, `kill` (terminate the wedged provider → failover)
  above 4×.

### Shadow-probe decision (deviation, documented)

**The server.js shadow probes are NOT ported in relay v1.** They were a Railway-era
diagnostic that ran a *second* Google/EL side-stream to confirm whether Deepgram
silence was a real failure — doubling vendor egress for the probe window. The relay
replaces their **purpose** (detect a provider that is connected-but-wedged) with a
single **silence watchdog**: if a provider is connected but produces **zero
transcripts** while **energetic** audio (RMS ≥ `MIN_AUDIO_RMS`) has been flowing for
> `SILENCE_WATCHDOG_MS` (18s; 2× for the secondary providers), treat it as a silent
failure and fail over. No dual side-streams, no extra vendor egress. Genuine silence
(RMS below the gate) just re-arms the watchdog — it never forces a failover. Cited:
F13 (probe teardown complexity) + cost (docs/01 §11 egress guards).

Language auto-detect replicates the server.js Deepgram-autodetect path: a
`detected_language` field (Deepgram) / `language_code` (Google/EL) is normalised once
via core `normaliseDetectedLang` and surfaced as `{language_detected}`.

---

## 4. Billing / metering model

### 4.1 Accumulation (core `metrics.js`, verbatim math)

- **Deepgram** bills speech duration: `p.duration` summed on `is_final` only.
- **Google STT / ElevenLabs** report no inline duration → wall-clock, including
  flap windows (C6) and the pre-failover wall-clock substitute when Deepgram
  produced no finals before failing (P2-4). All via `computeCloseBilling`.
- `<30s` with no tracked speech is **free** (`shouldBill` gate).

### 4.2 Replay billing suppression (F11)

On every failover/reconnect the relay replays the prebuffer to the new provider.
Replayed audio is re-transcribed and Deepgram re-emits `p.duration` for the
already-billed range. The session keeps a **billed-through watermark**: after each
replay it suppresses Deepgram-duration billing for a wall-clock window equal to the
replayed audio's duration at the session format. Finals arriving inside that window
do not double-count. Wall-clock fallback billing is unaffected (it already measures
elapsed time, not per-final duration).

### 4.3 Per-channel HONEST billing (deviation from server.js, documented)

server.js made the mic/system pairing decision **in-process at close** using the
`recentSystemChannels` map — structurally broken across relay instances and the
source of the F2/F3 double-bill + heartbeat-bypass bugs. The relay does **not**
make the pairing decision. At close it bills **the channel's own seconds** honestly
and writes them to `stt_finalize_session`; the **Phase-6 finalize RPC** applies the
mic/system pairing rules via a DB overlap query (`stt_mic_overlap_billed`, docs/01
§6.5) that works across relays and survives close-ordering. The relay is the honest
meter; the control plane is the arbiter.

### 4.4 Flush / finalize idempotency + retry (F5/F6)

- **Incremental checkpoint** every `USAGE_FLUSH_INTERVAL_MS` (45s, clamp 15–120s):
  `stt_flush_usage(session_id, seq, snapshot)` — idempotent on `(session_id, seq)`
  with a per-session monotonic `seq`. Crash-loss window shrinks from ≤4h to ≤45s.
- **Finalize** on close: `stt_finalize_session(session_id, totals)` — idempotent on
  status (re-run is a no-op).
- **RPC-missing degrade** (Phase-6 RPCs not yet deployed): on a
  "function does not exist" class error the store logs ONCE per process and falls
  back to a direct `stt_sessions` upsert so usage stays durable.
- **Retry**: 3 attempts (1s/5s/15s) then a bounded in-memory queue (500, drop-oldest
  with a loud error + `usage_retry_dropped` telemetry), drained every 30s.
- **Never blocks the audio path** — all writes are fire-and-forget and guarded so a
  throwing store can never crash a timer/audio callback.

---

## 5. Backpressure design

| Direction | Rule | Source |
|---|---|---|
| client (relay → client) | drop **interims** when `socket.bufferedAmount > 1MB`; **finals always sent** | core `shouldDropInterim` |
| provider (relay → provider) | `checkProviderBuffer`: send ≤ cap, drop (shed + count) cap–4×, kill > 4× → failover | core `checkProviderBuffer` (F10) |
| transport frame | application-level 64KB cap → `chunk_too_large` + 1008 (the `@fastify/websocket` `maxPayload` is set to 1MB so the app-level cap, not a protocol reset, classifies the error) | core `isFrameTooLarge` |
| per-session bytes | `MAX_BYTES_PER_SESSION` (0 = auto `2× declared-rate 4h`) → `session_byte_budget_exceeded` + 1008 | core `computeMaxSessionBytes` |

---

## 6. Security

- **Token verify** — offline HMAC (core `verifySessionToken`); no network on the hot
  path. Current + `STT_SESSION_TOKEN_SECRET_PREV` accepted during a rotation window.
  jti replay cache makes a token single-use. No provider keys ride in the token.
- **Proxy trust (F8)** — `extractIp()` defaults to the **raw socket address**; a
  single configured `TRUST_PROXY_HEADER` (e.g. `x-forwarded-for`) is honored ONLY
  when set, for a proxy you control (Caddy). The Railway-coupled
  `x-envoy-external-address` default is deliberately NOT ported.
- **Log hygiene (F1/F9)** — session ids are hash-derived (`makeSessionId`,
  `<sha256-prefix>:<channel>`), never raw keys/tokens; IPs are hashed (`hashIP`);
  transcript text is logged only when `LOG_TRANSCRIPTS=true` and then truncated to
  80 chars. The logger also redacts any field whose key looks like a secret (backstop).
- **Channel whitelist (F16)** — `validateChannel` restricts `channel ∈ {system, mic,
  default}`; junk → `default`. The token's `channel` claim must match.
- **Caps** — per-IP (`MAX_WS_PER_IP`, 1008), global (`MAX_CONCURRENT_WS`, 1013),
  reconnect budget (`MAX_RECONNECTS_PER_SESSION`), max session duration
  (`MAX_SESSION_SECONDS`, 1008), max replay seconds (`MAX_REPLAY_SECONDS`).

---

## 7. Env var table

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `REGION` | — **(required)** | `us` \| `asia` — boot-fails if unset/invalid |
| `RELAY_ID` | `${REGION}-1` | logs/metrics/telemetry tag |
| `PUBLIC_RELAY_URL` | `''` | this relay's public wss URL (advisory) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | `''` | usage persistence (stt_* only) |
| `STT_SESSION_TOKEN_SECRET` | — **(required)** | shared HMAC secret — boot-fails if unset |
| `STT_SESSION_TOKEN_SECRET_PREV` | `null` | rotation: also accepted on verify |
| `DEEPGRAM_API_KEY` (+`_1..5`) | `[]` | Deepgram pool; ≥1 for `/readyz` |
| `GOOGLE_CREDENTIALS_JSON` / `GCP_PROJECT_ID` | `''` | Google STT; both needed to enable |
| `ELEVENLABS_API_KEY` (+`_1..5`) | `[]` | ElevenLabs pool |
| `AXIOM_TOKEN` / `AXIOM_DATASET` | `''` / `stt-relay` | Axiom shipping (no-op when unset) |
| `SENTRY_DSN` | `''` | Sentry-lite envelopes (no-op when unset) |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | `''` / app.posthog.com | PostHog (no-op when unset) |
| `MAX_CONCURRENT_WS` | `200` | global live-WS ceiling |
| `MAX_WS_PER_IP` | `5` | per-IP concurrent WS |
| `MAX_SESSION_SECONDS` | `14400` | wall-clock session cap |
| `MAX_BYTES_PER_SESSION` | `0` | 0 = auto `declared×2`; else fixed cap |
| `MAX_RECONNECTS_PER_SESSION` | `20` | takeover/reconnect budget |
| `MAX_REPLAY_SECONDS` | `30` | replay window cap |
| `ENABLE_ELEVENLABS_FALLBACK` | `true` | EL arm in the chain |
| `ENABLE_GOOGLE_STT_FALLBACK` | `true` | Google arm in the chain |
| `REJECT_HIGH_BANDWIDTH_AUDIO` | `true` | reject vs down-negotiate >cap (F14) |
| `ALLOW_STEREO` | `false` | global 2-channel cap |
| `ALLOW_48KHZ` | `false` | global 48kHz cap |
| `TRUST_PROXY_HEADER` | `''` | `''`=socket addr; else trusted header (F8) |
| `USAGE_FLUSH_INTERVAL_MS` | `45000` | checkpoint cadence (clamp 15k–120k) |
| `LOG_TRANSCRIPTS` | `false` | transcript text in logs (F9) |
| `SHUTDOWN_GRACE_MS` | `20000` | drain window on SIGTERM |

(Internal test knobs, not in `.env.example`: `STT_AUTH_TIMEOUT_MS`,
`STT_PING_INTERVAL_MS`, `STT_SILENCE_WATCHDOG_MS`, `STT_SESSION_TTL_MS`.)

---

## 8. `/healthz` vs `/readyz` semantics

| Endpoint | Returns | Checks |
|---|---|---|
| `GET /healthz` | always `200 {status:'ok', relay_id, region, uptime_s}` | process up / event loop responsive |
| `GET /readyz` | `200 {status:'ready'}` or `503 {status:'not_ready', reasons[]}` | token secret present **and** ≥1 Deepgram key available **and** (Supabase configured ⇒ client constructed) **and** live sessions < `MAX_CONCURRENT_WS` **and** not draining |
| `GET /metrics` | `200` JSON | active sessions, sessions-by-provider, per-IP map size, usage queue depth, provider health, deepgram-keys-available, close-code histogram, draining — **no secrets/PII** |

The Railway health checker probes `/readyz`; a `503` sheds NEW sessions to the
other region while existing sessions continue.

---

## 9. Graceful shutdown sequence (SIGTERM / SIGINT)

1. `state.draining = true` — `/readyz` flips 503; new WS upgrades are refused with
   `1013 server_at_capacity`.
2. Every live session receives close **`1001 server_restart`** (clients reconnect via
   the Phase-8 ladder onto a healthy relay).
3. Wait for sessions to drain (poll) up to `SHUTDOWN_GRACE_MS`; sessions finalize
   their usage on their own close handlers as they go.
4. Force-terminate any sockets still open at the deadline so `app.close()` can't hang.
5. Flush the usage retry queue + telemetry; `app.close()`; `exit 0`.

`uncaughtException` → log + Sentry + attempt graceful drain → `exit 1`.
`unhandledRejection` → log + Sentry, **do not exit** (per-session try/catch contains
most of these; one bad promise must not take the relay down). Per-session try/catch
on every message/close/error path means one session's error never kills the process.

---

## 10. Test inventory + results

`cd services/stt-relay && npm install && node --test tests/*.test.mjs` →
**47/47 pass, 0 fail** (Node 25; satisfies the node≥20 floor). No network, no real
keys — provider adapters are mocked through `create()`'s `providerFactory` hook;
WS-level tests spin the relay on an ephemeral port.

| Suite | Tests | Covers |
|---|---|---|
| `config.test.mjs` | 11 | defaults, clamps (flush 15k–120k), required-fail-fast (REGION, secret), boolean parsing, key collection, google-creds gating, frozen object, proxy-header normalize |
| `token-gate.test.mjs` | 10 | WS e2e: valid→connected; expired key→`invalid_key_format`; expired trial→`trial_expired`; tampered→`invalid_key_format`; wrong region→rejected; jti replay→rejected; auth timeout→`auth_timeout`; non-JSON→`auth_must_be_json`; legacy key→`auth_required`; channel mismatch→fatal |
| `session-flow.test.mjs` | 6 | binary forwarded; interim/final shapes EXACT incl. cumulative `full_text` + absent-on-interim; `first_transcript_ms` recorded; frame>64KB→`chunk_too_large`; byte budget→1008; takeover (first close doesn't wipe second) |
| `failover.test.mjs` | 5 | deepgram→google `provider_switched` w/ replay; chain→elevenlabs; EL-disabled chain skip→`all_stt_providers_down`; all-down admission; F13 prior-provider teardown |
| `billing.test.mjs` | 5 | metrics accumulate + surface on finalize; <30s free; flush strictly-increasing seq; flush failure doesn't interrupt session; finalize fires after a throwing flush |
| `shutdown.test.mjs` | 4 | active session gets 1001 server_restart + finalize; refuses new while draining (1013); idempotent; empty drain returns promptly |
| `limits.test.mjs` | 6 | per-IP cap (1008); global cap (1013); 48k/stereo reject when flags off; 48k down-negotiate; stereo allowed when flag+claim agree |

**Regression gates:** `node --check` on all 12 src files: pass. Standalone boot:
`STT_SESSION_TOKEN_SECRET=test REGION=us DEEPGRAM_API_KEY=fake node src/index.js` →
`/healthz` 200 `{status:ok}`, `/readyz` 200 `{status:ready}`, `/metrics` 200; SIGTERM
graceful drain logged. Fail-fast: missing REGION / secret → clear FATAL message,
exit 1. Parent repo: `git status --short` shows only `services/` added (plus the
pre-existing Phase 3/4 `server.js` diff + `packages/` + two Phase 3/4 test files).

---

## 11. Non-goals

The relay process **never** contains or proxies: Dodo payment webhooks / any payment
logic; Resend / email; AI chat / completions / embeddings (`/v1/chat*`, `/v1/embed`);
Tavily search; trial creation / conversion; API-key creation; admin billing
operations; Telegram bot commands; Google OAuth calendar proxying. It holds STT
vendor keys + the token secret + a Supabase service-role key scoped to the `stt_*`
tables/RPCs only, and never logs raw secrets, raw API keys, transcript text at info
level, or unhashed IPs (F1, F9).

---

## 12. Decisions / deviations (summary)

| ID | Decision | Rationale |
|---|---|---|
| Shadow probes | Not ported; replaced by a single energetic-silence watchdog | Railway-era diagnostic; dual side-streams double vendor egress. Watchdog replicates the *purpose* at zero extra egress (F13 + cost) |
| Per-channel billing | Relay bills the channel honestly; Phase-6 finalize RPC applies mic/system pairing | server.js in-process pairing is structurally broken across relays (F2/F3); the meter and the arbiter are separated |
| Token-error mapping | Expired/bad **session** tokens → `invalid_key_format` (not a new string) | Phase-5 mandate is the EXISTING client contract; `invalid_key_format` is already in the fatal set and the relay-aware client treats relay-path fatals as "re-create session" |
| `maxPayload` 1MB | Transport ceiling above the 64KB app cap | so an oversized frame produces the exact `chunk_too_large`+1008 the client expects, not an unclassifiable protocol reset |
| Session timers `unref()`'d | ping/flush/duration/silence/auth timers are unref'd | defensive: always explicitly cleared on every exit path (F12); unref guarantees a missed cleanup can never hold the event loop |
| RPC-missing degrade | flush/finalize fall back to a direct `stt_sessions` upsert | Phase-6 RPCs aren't deployed yet; usage must stay durable in the interim |
```
