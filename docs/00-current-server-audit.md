# Natively Production Backend Audit — Pre-STT-Relay-Migration Baseline

**Date:** 2026-06-13
**Scope:** `natively-api/server.js` (7,673 lines, authoritative deployed entrypoint), Electron client STT (`electron/audio/`), Supabase schema/migrations, test tooling.
**Purpose:** Read-only audit ahead of moving realtime audio relay OFF Railway onto regional relay servers, keeping Railway as control plane. All line references are `file:line` against the current working tree (commit `6b61623`).

---

## 1. Executive summary

- The backend is a **single 7,673-line Fastify ESM monolith** (`natively-api/server.js`) deployed on Railway via nixpacks (`natively-api/railway.toml:8` — `startCommand = "node server.js"`). One process serves **24 routes**: 23 HTTP + 1 WebSocket (`/v1/transcribe`).
- `/v1/transcribe` is a **full STT relay**: client streams LINEAR16 PCM over WS → server forwards to Deepgram (primary, 6-key pool), with mid-session failover to Google STT chirp_2 (rolling batch recognize) and ElevenLabs Scribe v2 (base64 JSON). It carries a 30-second replay ring buffer, dual shadow probes, silence watchdogs, per-key rotation, a reconnect spreader, and close-time billing into Supabase.
- **All operational state is in-memory** (rate limits, sessions, key cooldowns, provider health, key/trial caches). The code itself documents this constraint (`server.js:215-217`): *"Keep the server single-instance, or wire a shared (redis) store before scaling out."* This is the central blocker the relay migration must solve.
- **Billing is close-time only**: STT seconds are computed in `socket.on('close')` and written via one Supabase RPC per session. A crash/SIGKILL mid-session loses up to 4 hours of billable usage per live session (mitigated only by a 20s SIGTERM drain).
- **Cost multipliers identified**: mic+system dual-streaming (2× WAN+upstream), acceptance of up to 48kHz stereo without server-side transcoding (up to 6× vs 16k mono), prebuffer/probe/reconnect replays (each failover re-sends up to 30s), Google rolling-recognize window re-sending (each audio second sent to GCP up to ~16×), ElevenLabs base64+JSON inflation (~+37%), and screenshots (≤800KB/request) routed through the same process.
- `servertobeupgraded.js` is an **older snapshot, not a staged upgrade** (see §3).
- Test tooling: `node --test`; only a subset is offline-safe. `node --check` passes on all server/lib files; 56/56 + 81/81 offline unit tests pass (see §11).

---

## 2. Current architecture diagram

```
                          ┌─────────────────────────────────────────────────────┐
                          │             Electron Desktop Client                  │
                          │  SystemAudioCapture ──► NativelyProSTT('system') ─┐ │
                          │  MicrophoneCapture  ──► NativelyProSTT('mic')   ──┤ │
                          │  (Rust DSP resamples to canonical 16 kHz mono)    │ │
                          └───────────────────────────────────────────────────┼─┘
                                                                              │ 2× WSS (PCM s16le)
                                                                              ▼
        ┌───────────────────────────────── Railway: node server.js (ONE process) ─────────────────────────────────┐
        │                                                                                                          │
        │  CONTROL PLANE (HTTP)                          REALTIME STT RELAY (WS /v1/transcribe)                    │
        │  ── /health                                    ── auth frame (key|trial_token, rate, lang, channel)      │
        │  ── /v1/trial/{start,status,convert}           ── per-IP(≤5) + global(≤200) WS caps                      │
        │  ── /v1/usage, /v1/pro/verify                  ── 30s CircularBuffer prebuffer                           │
        │  ── /v1/chat (+SSE), /v1/chat/completions      ── provider chain + failover:                             │
        │  ── /v1/embed, /v1/search                      │     Deepgram pool ──► GoogleSTT chirp_2 ──► ElevenLabs   │
        │  ── /api/calendar/{exchange,refresh}           │     (shadow probes verify silent failures)              │
        │  ── /webhooks/dodo/{api,pro}, /webhooks/dodo   ── transcript JSON → client                               │
        │  ── /webhooks/telegram                         ── close-time billing → Supabase RPC                      │
        │  ── /admin/* (6 endpoints)                                                                               │
        │                                                                                                          │
        │  SHARED IN-MEMORY STATE: keyCache(30s) trialCache(15s) activeSessions liveSockets wsConnections          │
        │  providerHealth keyPools+cooldowns(Groq/Gemini/MiniMax/Tavily/Deepgram/ElevenLabs) DDoS maps tgDedupe    │
        └───────┬──────────────────┬──────────────────────┬───────────────────┬───────────────────────────────────┘
                │                  │                      │                   │
                ▼                  ▼                      ▼                   ▼
          Supabase (PG)      AI providers           STT providers        Misc upstreams
          api_keys           Groq(10 keys)          Deepgram(≤6 keys)    Tavily(11 keys)
          free_trials        Gemini(≤6)             GCP Speech v2        Resend (email)
          pro_licenses       MiniMax(≤6 M3/M2.7)    us-central1          Telegram, Dodo
          processed_webhooks                        ElevenLabs(≤6)       Google OAuth
          sent_marketing_emails
```

---

## 3. Repo & server inventory

| Artifact | Verdict |
|---|---|
| `natively-api/server.js` (7,673 lines, v2.6.0) | **Authoritative.** `railway.toml:8` `startCommand = "node server.js"`; `package.json` `main`/`start` both point to it. Last touched Jun 12. |
| `natively-api/servertobeupgraded.js` (7,307 lines) | **Older copy, NOT a staged upgrade.** File mtime Jun 3 vs server.js Jun 12. Header comment lacks the MiniMax tier (`server.js:6` lists `→ MiniMax (M3→M2.7 hedge) →`; servertobeupgraded.js:6 does not). It lacks the `flashModelPicker`/`minimaxProvider` imports (`server.js:24-33`) and `/v1/pro/verify`. Its git introduction commit (`582bc78 "…add Pro subscription verification endpoint…"`) added those features to server.js while archiving the pre-change copy. **Treat as dead code; do not migrate from it.** |
| `natively-api/server_local.js` | Smaller (173KB) local-dev variant, untouched since Jun 1. Not deployed. |
| `natively-api/lib/` | `flashModelPicker.js`, `minimaxProvider.js`, `queryClassifier.js` — pure, unit-tested helpers used only by AI routes (control plane). |
| `natively-api/migrations/` | `001_atomic_quota_enforcement.sql` (AI/search atomic check-and-increment), `002_billing_stats_aggregates.sql` (Telegram revenue RPC). |
| `natively-api/scehma/` (typo'd folder) | Supabase schema dumps (`public.schema` etc., context-only) + `scehma/migrations/001_trial_rpc_functions.sql` (trial billing RPCs). Note: trial RPC migration lives under the typo'd folder, NOT under `natively-api/migrations/`. |
| `natively-api/tests/` | `node --test` suites + many ad-hoc scripts; see §11. |
| Electron client | `electron/audio/NativelyProSTT.ts` (Railway STT client), instantiated twice in `electron/main.ts:1508`. |

---

## 4. Complete route table

Category legend: **CP** = control plane, **STT** = realtime STT relay, **SH** = shared.

| # | Method | Path | Auth | Category | Purpose | Lines |
|---|---|---|---|---|---|---|
| 1 | GET | `/health` | none (sanitized) | SH | Categorical provider up/degraded + embedding telemetry | `server.js:3485-3521` |
| 2 | POST | `/v1/trial/start` | none (HWID+IP gated, 3/h/IP) | CP | Create/resume 30-min trial; issues HMAC trial token | `server.js:3529-3644` |
| 3 | GET | `/v1/trial/status` | trial token | CP | Live trial usage/remaining (bypasses cache) | `server.js:3646-3684` |
| 4 | POST | `/v1/trial/convert` | trial token | CP | Record conversion choice (byok/plan) once | `server.js:3686-3715` |
| 5 | GET | `/v1/usage` | API key OR trial token | CP | Plan + quota snapshot | `server.js:3718-3730` |
| 6 | GET | `/v1/pro/verify` | API key | CP | Desktop entitlement check (pro/max/ultra ⇒ has_pro) | `server.js:3744-3753` |
| 7 | POST | `/v1/chat` | API key OR trial | CP | AI chat, native format; SSE when `stream:true`; bills 1 AI req | `server.js:3760-3928` |
| 8 | POST | `/v1/chat/completions` | API key OR trial | CP | OpenAI-compatible chat (non-streaming) | `server.js:3933-3986` |
| 9 | POST | `/v1/embed` | API key only | CP | Gemini embedding (768-dim), bills AI quota | `server.js:3990-4009` |
| 10 | POST | `/v1/search` | API key OR trial | CP | Tavily search; session-dedup billing via `session_id` | `server.js:4012-4108` |
| 11 | POST | `/api/calendar/exchange` | API key OR trial | CP | Google OAuth code→token proxy (holds CLIENT_SECRET) | `server.js:4128-4156` |
| 12 | POST | `/api/calendar/refresh` | API key OR trial | CP | Google OAuth refresh proxy | `server.js:4158-4184` |
| 13 | **WS** | `/v1/transcribe` | first-frame key/trial token | **STT** | Realtime STT relay (full spec §5) | `server.js:4198-6139` |
| 14 | POST | `/webhooks/dodo/api` | HMAC (Standard Webhooks) | CP | API plan lifecycle → api_keys (+bundled pro_licenses) | `server.js:6266`, handler `6700-7231` |
| 15 | POST | `/webhooks/dodo/pro` | HMAC | CP | Pro desktop license lifecycle → pro_licenses only | `server.js:6267`, handler `6514-6693` |
| 16 | POST | `/webhooks/dodo` | none (deprecated) | CP | 410 + alert (misconfiguration detector) | `server.js:6270-6275` |
| 17 | POST | `/webhooks/telegram` | TG secret token | CP | `/subscribers`, `/revenue` ops bot commands | `server.js:6278-6484` |
| 18 | POST | `/admin/create-key` | x-admin-secret | CP | Manual key creation + email | `server.js:7234-7250` |
| 19 | GET | `/admin/lookup` | x-admin-secret | CP | Key metadata by email (key value redacted) | `server.js:7253-7269` |
| 20 | POST | `/admin/resend-key` | x-admin-secret | CP | Resend key email | `server.js:7276-7297` |
| 21 | GET | `/admin/webhook-log` | x-admin-secret | CP | Last 50 webhook bodies (in-memory ring) | `server.js:7302-7314` |
| 22 | POST | `/admin/fail-provider` | x-admin-secret | SH | Force provider unhealthy (testing) — includes STT slots | `server.js:7318-7333` |
| 23 | POST | `/admin/reset-provider` | x-admin-secret | SH | Reset provider health — includes STT slots | `server.js:7336-7343` |
| 24 | GET | `/admin/provider-health` | x-admin-secret | SH | Full health dump (sanitized session counts) | `server.js:7350-7363` |

Cross-cutting plugins/hooks: rawBody (`:194`), CORS allow-list (`:199-211`), `@fastify/websocket` (`:212`), in-memory rate limit 120/min keyed by key/trial/IP, skipped for WS upgrades (`:213-239`), DDoS IP tracker (`checkDDoS` `:1470-1486`), 4MB body limit + trustProxy (`:134`).

**STT-relevant shared helpers** (used by both `/v1/transcribe` and HTTP routes): `authenticate`/`validateKey`/`validateTrial` (`:1812-1823`, `:2030-2106`, `:1778-1805`), `getIP` (`:1565-1573`), `hashIP` (`:1579-1582`), `checkDDoS` (`:1470-1486`), `tgAlert` (`:1519-1556`), provider health framework (`:807-978`).

---

## 5. `/v1/transcribe` — sequence diagram + full behavioral spec

### 5.1 Sequence diagram (happy path + failover)

```
Client                       Railway server.js                    Deepgram          GoogleSTT        ElevenLabs
  │  WS upgrade /v1/transcribe   │
  │─────────────────────────────►│ per-IP cap(5)/global cap(200) checks  [4211-4225]
  │                              │ start 5s authTimeout                  [5758-5770]
  │  JSON auth frame             │
  │─────────────────────────────►│ validateKey/validateTrial (Supabase)  [5893-5902]
  │   (binary chunks during auth │ quota.transcription.remaining>0 gate  [5919-5927]
  │    are queued, ≤200 frames)  │ session takeover: terminate old sk    [5936-5942]
  │                              │ alloc 30s CircularBuffer preBuffer    [5982-5983]
  │                              │ drain authQueue → preBuffer           [5997-6003]
  │                              │ connectSTTProvider('deepgram')        [6005]
  │                              │── wss listen?model&lang&rate… ───────►│
  │                              │   (replay preBuffer in 4KB chunks)    │
  │ {"status":"connected",       │◄─ open ────────────────────────────── │
  │  "provider":"deepgram",      │  KeepAlive every ≤5s; 3s first-msg deadline
  │  "quota":{...}}              │
  │◄─────────────────────────────│
  │  binary PCM (≤64KB/frame)    │
  │─────────────────────────────►│ preBuffer.write + forward binary ────►│
  │                              │◄─ Results (interim/final) ─────────── │
  │ {"text","is_final",          │  finals: secondsUsed += p.duration
  │  "confidence"[,"full_text"]} │  (interims dropped if bufferedAmount>1MB)
  │◄─────────────────────────────│
  │                              │  ...Deepgram closes 1011 / errors...
  │                              │  shadow GoogleSTT probe (replay 15s) ────►│
  │                              │  probe confirms speech ⇒ failover         │
  │ {"status":"provider_switched"│  fallbackStartTime = now (wall-clock bill)│
  │  ,"from","to","reason"}      │  replay FULL 30s preBuffer ──────────────►│
  │◄─────────────────────────────│◄─ rolling recognize partials/finals ──────│
  │                              │  ...GoogleSTT fatal/silent ⇒ EL probe/failover ──────────►│
  │                              │  (base64 JSON chunks, session_started gate, silence keepalive)
  │  client closes WS            │
  │─────────────────────────────►│ socket.on('close'): compute seconds   [6008-6124]
  │                              │ billSTTSeconds → Supabase RPC
  │                              │   increment_transcription_minutes /
  │                              │   increment_trial_stt_seconds
```

### 5.2 First auth/config frame

Client must send one JSON text frame within **5s** (`authTimeout`, `server.js:5758-5770`) or receive `{"error":"auth_timeout"}` and a close. Frame shape (parsed at `server.js:5879-5887`; documented `4186-4197`):

```json
{
  "key": "natively_sk_…",            // 52 chars total — OR —
  "trial_token": "natively_trial_…", // HMAC token (trial path)
  "sample_rate": 16000,              // clamped to [8000, 48000]   (5961)
  "language": "en-US",               // 'auto' enables detection    (5963)
  "language_alternates": ["en-GB"],  // accepted but currently unused by server
  "audio_channels": 1,               // clamped to [1, 2]           (5962)
  "channel": "system"                // 'system' | 'mic' | 'default' (5887-5888)
}
```

All subsequent frames are **binary LINEAR16 PCM** (s16le). Binary frames arriving before auth completes are queued (cap 200 frames; overflow → close 1009 `auth_queue_overflow`, `server.js:5850-5863`) and drained into the prebuffer post-auth (`5997-6003`, fix P0-1).

### 5.3 Authentication

- **API key**: `key.startsWith('natively_sk_')` → `validateKey(key, ip)` (`server.js:5894-5895` → `2030-2106`). Format gate: prefix + exact length 52 (`2032-2034`, constants `1634-1636`). 30s in-memory `keyCache` (`251-252`); cached entries re-checked for `active`/`suspended` (`2036-2045`). DB read: `api_keys` by key (`2047-2052`). Side effects per cache miss: fire-and-forget `increment_total_requests` RPC w/ non-atomic fallback (`2070-2083`), debounced `last_used_at/last_used_ip` audit write (`2090-2101`), `maybeResetQuota` atomic monthly reset (`2103`, `2144-2178`).
- **Trial token**: `validateTrial(trial_token, ip)` (`5896-5897` → `1778-1805`). Token = `natively_trial_<b64url payload>.<b64url HMAC-SHA256>` with `{id, exp}` payload (`1716-1744`), secret `TRIAL_JWT_SECRET` (process exits at boot if unset in prod, `1707-1714`). 15s `trialCache` (`253-254`). DB read: `free_trials` by id; rejects expired / `converted_to='byok'`.
- Both paths run `checkDDoS(ip)` first (`1779`, `2031`).
- Quota gate at open: `auth.quota.transcription.remaining <= 0` → `{"error":"transcription_quota_exceeded","resets_at":…}` + close (`5919-5927`). Trial limit: 10 STT minutes (`TRIAL_LIMITS`, `1697-1702`); paid limits per plan (`PLANS`, `1415-1421`: standard 200 / pro 500 / max 1000 / ultra 2000 min/mo).

### 5.4 Channel semantics & active-session locking

- Session key `sk = "<key | trial_<id>>:<channel>"` (`server.js:5935`). **Locking is per key+channel, not per key** — system and mic streams coexist by design.
- **Reconnect takeover**: a new connection with the same `sk` terminates the prior socket (`5936-5942`); `liveSockets`/`activeSessions` maps updated (`5943-5944`). The close handler only clears maps if it's still the live socket (`6032-6040`).
- Note: the client still handles a `concurrent_session_blocked` error (`NativelyProSTT.ts:379-385`), but the current server never emits it — takeover replaced blocking. Legacy-compat only.
- `recentSystemChannels` records system-channel presence per identity for the mic-only billing guard (`5947-5950`, `270-271`, used at `6066-6077`).
- Stale sessions: `SESSION_TTL_MS` = 4h; 60s housekeeping sweep terminates/evicts (`245`, `1336-1342`).

### 5.5 IP and global WebSocket limits

- **Per-IP**: ≤5 concurrent WS per normalized IP (IPv6 collapsed to /64 via `normalizeIPForLimit`, `1589-1609`); excess → close 1008 `too_many_connections` (`4211-4215`).
- **Global**: `MAX_CONCURRENT_WS` = 200 default (`250`); ceiling check at `4220-4225` → close 1013 `server_at_capacity`. Rationale: 48kHz-stereo session ≈ 5.5MB ring buffer each (`247-249`).
- Counter decrement is idempotent across close/error (`4233-4239`, `6015`, `6137`).

### 5.6 Sample rate / channel handling

- Accepts **8,000–48,000 Hz** (clamp `5961`) and **1–2 channels** (clamp `5962`). Default 16000/1.
- **No server-side transcoding/resampling.** The declared rate/channels are passed verbatim to Deepgram (`sample_rate`, `channels` URL params, `4838-4849`), Google (`explicitDecodingConfig`, `1082-1087`), and ElevenLabs (`audio_format: pcm_${rate}`, `5467-5478`). Bytes are forwarded as-is.
- Per-frame cap 64KB; oversized frame → close (`5779-5784`). Per-session byte budget = 2× a 4-hour stream at declared params (`5986-5990`; check `5786-5792`).

### 5.7 Pre-buffer behavior

- `preBuffer` = `CircularBuffer` sized to **30s** at session params (`5982-5983`; class `990-1040`). Every accepted chunk is written regardless of provider state (`5800`).
- Replay windows:
  - **Provider failover**: full ring (`getReplayBuffer`, `4414-4417`), snapshotted before teardown (`4764`) and re-snapshotted right before connect (`4805`, P2-1).
  - **Key rotation / reconnect**: window sized to actual upstream downtime +1s, capped 30s (`getReplayBufferForReconnect`, `4432-4436`, P0-3); short fixed windows elsewhere (`getShortReplayBuffer`, `4422-4426` — 2s default, 3s EL inactivity reconnect `5730`, 5s EL key rotation `5748`).
  - **Auto-detect reconnect**: 3s only, to limit duplicate transcripts (`5080-5084`).
  - **Shadow probes**: last 15s replayed into the probe (`4565-4581` Google; `4674-4695` ElevenLabs).
- Replay is chunked at 4KB; Deepgram replay is synchronous (`5106-5112`), Google immediate via `onChunk` (`5443-5449`), EL deferred until `session_started` plus a "gap flush" of audio that arrived during the open→session_started window (`5581-5615`, C1).

### 5.8 Deepgram connection setup

- Key pool: `DEEPGRAM_API_KEY` + `_1.._5`, deduped (`521-526`). Round-robin `pickDeepgramKey` skipping cooling keys (`533-545`). Per-key failure tracking with 2-strike + ≥2-distinct-identity (or 5-strike single-identity) → 5-min cooldown (`547-569`); `markDeepgramKeyHealthy` on connect (`571-573`, `4982`).
- **URL**: `wss://api.deepgram.com/v1/listen?` with params (`4838-4853`): `model` (nova-3 or nova-2), `encoding=linear16`, `sample_rate`, `language`, `interim_results=true`, `endpointing=300`, `utterance_end_ms=1000`, `smart_format=true`, `channels`, `vad_events=true`. Auth header `Token <key>`; shared keep-alive `https.Agent` with cached DNS (`wsKeepAliveAgent`, `104-113`).
- **Model/language router** `pickDeepgramModelLang` (`614-632`): `auto`/`multi` → nova-3 `language=multi`; `NOVA_2_ONLY_LANGS` deny-list (uk, bg, ca, cs, da, et, fi, el, hu, id, ko, lv, lt, ms, no, pl, ro, sk, sv, tr, vi — `609-613`) → nova-2 with bare ISO code; non-US English variants normalized to `en-US` (`628-631`); default nova-3 pinned.
- **Connect guards**: 10s connect timeout (`4939-4962`), `unexpected-response` HTTP classification (`4874-4936`: 400 → direct failover no health pollution; 402 → out_of_credits provider-disable until midnight UTC; 401/403 → key rotation then auth_error; 429/5xx → rotation), 3s first-message deadline for silent-open backends with ≤2 rotations (`5000-5024`).
- **KeepAlive**: `{"type":"KeepAlive"}` JSON sent when no audio for ≥5s, checked every 1s (`5114-5131`).

### 5.9 Deepgram reconnect behavior (spreader / backoff)

- `scheduleDeepgramReconnect(fn, baseMs, jitterMs)` (`577-592`): global pending-reconnect counter scales jitter window up to 20× — a synchronized failure burst is smeared over seconds instead of milliseconds. Used at every rotation/reconnect site (e.g. `4912-4914`, `5019`, `5310-5312`, `5349-5351`, `5363-5365`, `5377-5379`).
- **Close-code taxonomy** (`5226-5384`, comments `5235-5263`):
  - `1005`, own teardown → never a strike.
  - early `1006` (<10 chunks forwarded) → auth-ish → key rotation, 800–1200ms+ jitter.
  - late `1006` (≥10 chunks) → idle drop → same-key reconnect, no strike (`5357-5367`).
  - `1000` with no transcripts → Deepgram 60-min idle timeout → silent same-key reconnect (`5371-5381`).
  - `1011` → fast reconnect if the session was producing transcripts (15s one-shot watchdog after, `5300-5314`); else shadow probe decides (`5315-5320`); 3×-in-30s loop cap forces failover (`4285-4287`, `5288-5298`).
  - `1008`/`1009` → transient strike, no rotation (protocol-level, all keys would fail equally) (`5258-5259`, `5326-5331`).
- Provider-level health: `markFailed('deepgram', reason, sk)` multi-session 3-strike/2-identity with 5-min auto-recovery; out_of_credits → midnight; auth_error → permanent (`905-971`).

### 5.10 Google STT rolling-recognize fallback

- Trigger: `pickNextSTTProvider('deepgram')` on failover (`3452-3463` chain deepgram→googleSTT→elevenlabs) — entered via `switchToFallback` (`4745-4806`) from connect failures, close-code paths, 1011 loops, or shadow-probe confirmation.
- Implementation `createGoogleSTTSession` (`1057-1291`): chirp_2 is **batch-only**, so streaming is simulated:
  - 15s PCM ring (`BUFFER_BYTES`, `1074`), **8s recognize window** (`WINDOW_BYTES`, `1073`), **500ms roll timer** (`ROLL_MS`, `1076`), 400ms minimum (`1075`), `MAX_IN_FLIGHT=2` (`1101`).
  - **RMS energy gate** `MIN_AUDIO_RMS=230` blocks chirp_2 silence hallucination (`1078`, `1147-1158`; `pcmRmsEnergy` `1046-1055`).
  - Finals: 2 identical consecutive raw responses (`STABLE_ROLLS`, `1077`, `1200-1207`), window-overflow commit at >8s continuous speech (`1193-1197`), silence→final (`1153-1156`). `commitEpoch` discards stale in-flight results (`1105`, `1145`, `1173`).
  - Recognizer: `projects/${gcpProjectId}/locations/us-central1/recognizers/_`, model `chirp_2`, `explicitDecodingConfig` LINEAR16 at session rate/channels (`1081-1091`); endpoint `us-central1-speech.googleapis.com` (`173-176`).
  - gRPC error classification: INVALID_ARGUMENT → fatal failover; RESOURCE_EXHAUSTED → out_of_credits; UNAUTHENTICATED/PERMISSION_DENIED → auth_error (`1234-1250`).
  - Partials are raw-replace (no word-diff); finals append to `sessionTranscript`. Partial dropped if `socket.bufferedAmount > 1MB` (`1218-1228`).
- 90s silence watchdog (2× base) with ElevenLabs shadow probe verification before failing over (`4469-4481`).

### 5.11 ElevenLabs fallback

- Last resort in the chain; also probe target for GoogleSTT silence. Key pool mirrors Deepgram's (`634-679`).
- **URL**: `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_${rate}&commit_strategy=vad&include_language_detection=true[&language_code=xx]` (`5467-5483`), header `xi-api-key`.
- Audio must be **base64 inside JSON**: `{"message_type":"input_audio_chunk","audio_base_64":…,"commit":false}` per 4KB sub-chunk (`5541-5554`) — ~33% base64 inflation + ~70B JSON envelope per 4KB chunk (≈ +37% total).
- Gates on `session_started` (12s combined connect timeout, `5501-5510`); audio before that is recovered via the C1 gap-flush replay (`5495-5498`, `5599-5615`).
- Keepalive: 100ms of real silent PCM every 10s when idle ≥8s (EL kills idle streams at 20s; empty chunks don't reset the timer) (`5556-5578`).
- Error taxonomy: `quota_exceeded`/`scribe_quota_exceeded_error`/`scribe_resource_exhausted_error` → out_of_credits; `scribe_auth_error` → auth_error; throttle/rate/scribe_error → transient (`5619-5650`).
- Close 1000 = inactivity timeout → transparent reconnect, capped at 3 (`EL_1000_CAP`, `4311-4312`, `5716-5734`); other closes → key rotation w/ 5s replay (`5738-5751`) then failover.
- Silence on EL (last resort): single reconnect attempt then give up (`4483-4499`).

### 5.12 Shadow probes

- **Deepgram→Google probe** `startShadowProbe` (`4506-4600`): triggered by 25s silence watchdog (`SILENCE_WATCHDOG_MS`, `803`) or 1011 close on a not-yet-productive session. Runs a hidden Google session against a null socket, replays last 15s, requires ≥2 words at ≥0.60 confidence to declare Deepgram silently broken (`4537-4546`) → `markFailed('deepgram','silent_failure')` + failover. Timeout 18s (`SHADOW_PROBE_TIMEOUT_MS`, `804`) → genuine silence, reconnect Deepgram with full replay (`4584-4599`, P0-2). Max 5 probes/session (`MAX_SHADOW_PROBES`, `805`).
- **Google→ElevenLabs probe** `startElevenLabsShadowProbe` (`4617-4731`): same pattern at 90s; ≥2 words confirm; rate-limit exhaustion fails over only if speech was ever confirmed (`4620-4634`). VAD events (`SpeechStarted`/`UtteranceEnd`) reset the watchdog and tear probes down (`5175-5188`).
- Probes replay audio = additional STT vendor spend per probe (15s × probe count).

### 5.13 Audio chunk forwarding path

`processChunk` (`5772-5842`): timestamp update → counters → 64KB frame cap → session byte budget → `preBuffer.write` → live-audio RMS gate (`5802-5805`) → forward:
- Deepgram: raw binary `upstreamWs.send(chunk)` (`upstreamSendAudio`, `4856`).
- Google: `googleSTTSession.onChunk(chunk)` (`5834-5837`).
- ElevenLabs: base64 JSON sender (assigned only after `session_started`).
- Shadow Google probe also receives every live chunk (`5839-5841`).
Drops (upstream not OPEN / sender not ready) are counted and rate-limit logged (`5821-5833`, P1-4).

### 5.14 Transcript message format (client contract — relay MUST preserve)

Server→client JSON text frames:

```jsonc
// transcript (Deepgram path: server.js:5206-5211; Google: 1131-1137 & 1221-1227; EL: 5677-5683)
{ "text": "...", "is_final": false, "confidence": 0.98 }                      // interim — droppable under backpressure
{ "text": "...", "full_text": "<cumulative finals>", "is_final": true,
  "confidence": 1.0 }                                                          // final — always sent

// status frames
{ "status": "connected", "provider": "deepgram"|"googleSTT"|"elevenlabs", "quota": {used,limit,remaining} }   // 4991, 1287, 5537
{ "status": "provider_switched", "from": "...", "to": "...", "reason": "...", "has_replay": true }            // 4785-4793
{ "language_detected": "fr-FR" }                                                                              // 5075, 5420, 5665

// errors (client treats some as fatal — NativelyProSTT.ts:373-378)
{ "error": "auth_timeout" | "auth_must_be_json" | "invalid_key_format" | "auth_required" | "trial_expired"
         | "trial_not_found" | "trial_ended" | "key_not_found" | "subscription_inactive" | "account_suspended"
         | "transcription_quota_exceeded" (+ "resets_at") | "all_stt_providers_down" (+ "reason")
         | "chunk_too_large" | "session_byte_budget_exceeded" | "ip_blocked", "message": "..."? }
```

Backpressure: `sendTranscript` drops **interims** when `socket.bufferedAmount > 1MB`; finals always sent (`4357-4363`).

### 5.15 Billing seconds computation

(`socket.on('close')`, `6058-6124`):
- **Channel gate**: bill `system` and `default`; skip `mic` UNLESS no paired system socket is live and none was seen for this identity within 5 min (`SYSTEM_RECENCY_MS`, `271`) — mic-only abuse guard C2 (`6066-6077`).
- **Seconds**: `secondsUsed` accumulates Deepgram `p.duration` on finals only (`5192`). On failover, wall-clock for fallback portions: `fallbackStartTime` set on leaving Deepgram (`4798`), accumulated across flaps in `fallbackSecsAccumulated` (`4985-4988`, C6). Pre-failover wall-clock substituted when Deepgram produced no finals (`6092-6099`, P2-4). If nothing tracked, pure wall-clock (`6100-6102`).
- **Threshold**: sessions with no tracked speech and <30s wall-clock are free (`6109`).
- **Mid-session quota watchdog**: 25s ping loop estimates `liveBillableSeconds()` (`4372-4379`) against `sessionBudgetSeconds` captured at auth (`5966-5970`); cutoff closes with `transcription_quota_exceeded` (`4381-4401`).

### 5.16 Billing-on-close flow (Supabase)

`billSTTSeconds(auth, trialTok, seconds)` (`1919-1979`), invoked at `6112-6116`:
- **Paid**: `<30s → free`; `minutes = max(1, round(seconds/60))` (1-min floor, minute granularity); RPC `increment_transcription_minutes(key_id uuid, minutes int)` (`1968-1971`); `keyCache.delete(key)` in `finally` (`1973-1977`). **Note: this RPC has no migration file in the repo** — it exists only in live Supabase.
- **Trial**: RPC `increment_trial_stt_seconds(trial_id, secs)` (`1921`); on rpcErr fall back to `increment_trial_stt_seconds_raw`, then a guarded read-modify-write capped via `.lt('stt_seconds_used', 600)` (`1930-1951`); trialCache updated in-memory (`1953-1960`).
- Failure handling: caught and logged only — billing loss is silent beyond logs (`6118-6122`).

### 5.17 Cleanup & graceful shutdown

- Close handler: clears timers, sets `authed=false` + `failoverInProgress=true` first, frees `preBuffer`, tears down probes/watchdogs/auto-detect, conditionally clears `liveSockets`/`activeSessions`, flushes EL final commit, closes upstream, cleans Google session, then bills (`6008-6124`).
- `socket.on('error')`: idempotent counter decrement + timer clears (`6127-6138`).
- Housekeeping (60s): stale session/TTL eviction, DDoS expiry, caches, key cooldowns, DNS cache, processed_webhooks purge (`1298-1413`).
- `gracefulShutdown` (SIGTERM/SIGINT, `7625-7669`): sends close 1001 `server_restart` to all WS clients, `app.close()`, polls up to **20s** for sessions to drain (close → billing), exits. Railway grace is 30s.
- Crash guards: unhandledRejection logged-and-continue; uncaughtException → exit(1) after 1s (`119-127`).

---

## 6. Client (Electron) STT behavior

**File:** `electron/audio/NativelyProSTT.ts` (575 lines).

- **URL**: hardcoded `wss://api.natively.software/v1/transcribe` (`NativelyProSTT.ts:72`). WS options via `streamingStttWsOptions()` (`dnsHelpers.ts:86-93`): IPv4-only resolver with 60s TTL cache + stale-on-error (`dnsHelpers.ts:31-74`), `handshakeTimeout: 15000`.
- **Two sockets per meeting**: `electron/main.ts:1508` constructs `new NativelyProSTT(nativelyKey, speaker === 'interviewer' ? 'system' : 'mic')` — one instance per speaker; each opens its own WS. Selected when STT provider is `natively` with a configured key.
- **First frame** (`NativelyProSTT.ts:335-352`): `{ sample_rate, language, language_alternates, audio_channels, channel }` plus `key` — or `trial_token` (fetched from CredentialsManager) when `apiKey === TRIAL_SENTINEL_KEY`.
- **Audio format**: binary LINEAR16 PCM via `ws.send(chunk)` (`:283`). Sample rate comes from the capture layer: the Rust DSP resamples to **canonical 16 kHz** before emit (`SystemAudioCapture.ts:34-49`); mono is forced (`main.ts:1935`, `2031`). Rate is locked from the first chunk (`main.ts:1932-1937` system, `2028-2033` mic); `MicrophoneCapture.getSampleRate()` falls back to **48000** before native init (`MicrophoneCapture.ts:64`) — a race that can declare 48k. Mid-stream rate change reconnects only after handshake commit (`NativelyProSTT.ts:82-125`).
- **Buffering**: when disconnected, chunks queue up to **500** (~10s); oldest dropped beyond that with a `buffer-overflow` event (`:29-38`, `:254-277`); on (re)connect after `status:connected`, the buffer is flushed to the server (`flushBuffer`, `:525-541`).
- **Reconnect**: exponential backoff base 1500ms, exponent capped at 2^6, ceiling 30s, ±20% jitter (`:499-522`); attempts only reset after 5s of stable connection (`:397-404`); DNS failures (ENOTFOUND/EAI_AGAIN) use a fixed 10s retry that doesn't consume backoff (`:443-459`, `:489-497`); `persistent-reconnect` UI event at attempt 5 (`:515-517`).
- **Fatal errors** (stop retrying): `auth_timeout`, `invalid_key_format`, `trial_expired`, `transcription_quota_exceeded` (`:373-378`).
- **Transcript consumption**: `msg.text` → emits `transcript {text, isFinal, confidence}` (`:431-437`); `msg.status === 'connected'` → emits `connected {provider, channel}`; `msg.language_detected` → stores the BCP-47, emits `languageDetected`, and intentionally reconnects after 250ms with the pinned language (`:412-429`). `full_text` is currently ignored by the client.
- **Lifecycle hygiene**: every handler gated on `ws === this.ws` (`:324-327`); `closeUpstream` strips listeners and clears all timers (`:543-574`); `stop()` restores configured language (`:212-250`).
- Other STT classes (`SonioxStreamingSTT.ts`, `OpenAIStreamingSTT.ts`, `LocalWhisperSTT.ts`, `DeepgramStreamingSTT.ts`, `ElevenLabsStreamingSTT.ts`) are BYOK direct-to-vendor paths selected in `createSTTProvider` (`main.ts:1484-1595`) — they do not touch Railway and are out of migration scope (useful as protocol references only).

---

## 7. Metering & billing behavior (tables / RPCs / flow)

### Tables (from `natively-api/scehma/public.schema`)

| Table | STT-billing-relevant columns | Written by |
|---|---|---|
| `api_keys` (`public.schema:4-25`) | `transcription_minutes_used`, `ai_requests_used`, `search_requests_used`, `quota_resets_at`, `plan`, `active`, `suspended`, `total_requests`, `last_used_at`, `last_used_ip`, `sub_period_end` | billing RPCs, validateKey audit, webhooks, maybeResetQuota |
| `free_trials` (`:26-37`) | `stt_seconds_used`, `ai_used`, `search_used`, `expires_at`, `converted_to`, `hwid`, `ip_hash` | trial RPCs, /v1/trial/* |
| `pro_licenses` (`:38-45`) | entitlements only | webhooks |
| `processed_webhooks` (`:46-50`) | webhook idempotency | webhook route, housekeeping purge |
| `request_logs` (`:51-61`) | **defined but never written by server.js** (dead table) | — |
| `sent_marketing_emails` (`:62-67`) | email dedup | email helpers |

### RPCs

| RPC | Defined in repo? | Used at | Purpose |
|---|---|---|---|
| `increment_transcription_minutes(key_id, minutes)` | **NO migration in repo** (referenced only) | `server.js:1968-1971` | Paid STT billing (minute floor) — **must be exported from live Supabase before migration** |
| `increment_trial_stt_seconds(trial_id, secs)` | `scehma/migrations/001_trial_rpc_functions.sql:15-23` | `server.js:1921` | Trial STT billing (atomic add) |
| `increment_trial_stt_seconds_raw` | same file `:27-35` | `server.js:1931-1934` | Fallback |
| `increment_trial_ai(trial_id)` | same file `:39-49` (limit 10 hardcoded) | `server.js:1836` | Trial AI billing, returns granted bool |
| `increment_trial_search(trial_id)` | same file `:53-63` (limit 2) | `server.js:1884` | Trial search billing |
| `increment_ai_requests_limited(key_id, max_requests)` | `migrations/001_atomic_quota_enforcement.sql:24-36` | `server.js:1864` | Atomic check-and-increment, returns granted |
| `increment_search_requests_limited` | same file `:39-51` | `server.js:1902` | ditto |
| `increment_ai_requests` / `increment_search_requests` (void legacy) | not in repo | fallbacks `server.js:1867,1875,1905,1911` | non-atomic fallback |
| `increment_total_requests(key_id)` | not in repo (SQL in comment `server.js:2065-2069`) | `server.js:2070` | usage audit counter |
| `billing_stats()` | `migrations/002_billing_stats_aggregates.sql` | `server.js:6337` | Telegram revenue aggregates |

### Flow summary

1. **Session open**: quota gate from (≤30s stale) cache or fresh read; budget seconds captured (`5966-5970`).
2. **During session**: no DB writes for STT; in-memory `secondsUsed`/fallback accumulators; 25s watchdog cuts session at budget.
3. **Session close**: channel-gated `billSTTSeconds` → single RPC; cache evicted so next auth re-reads.
4. **Monthly reset**: `maybeResetQuota` atomic conditional UPDATE on `quota_resets_at <= now()` (`2144-2178`); renewal webhooks also zero counters anchored to Dodo billing date (`6885-6913`).
5. **AI/search**: per-request `billAI`/`billSearch` with atomic *_limited RPCs + cache-decrement mirror (`1834-1916`). Stream billing fires once in `finally`, including on client abort with partial content (`3838-3849`, `3891-3903`, C3).

---

## 8. Cost multiplier diagnosis (egress analysis)

Ranked by estimated impact. Bandwidth baseline: 16kHz mono s16le = 32 KB/s = 115 MB/h per stream.

| # | Multiplier | Evidence | Impact |
|---|---|---|---|
| 1 | **Mic + system dual stream** — every meeting runs two full-duration WS streams; both forwarded upstream full-time, even though only `system` typically bills | `main.ts:1508` (two instances); server bills system-only (`server.js:6066-6077`) but **forwards both** to Deepgram/Google/EL | 2× WAN ingress to Railway, 2× egress to STT vendors, 2× vendor minutes consumed vs 1× billed |
| 2 | **48kHz / stereo acceptance with no transcoding** — server clamps to ≤48kHz/2ch and forwards raw | clamp `server.js:5961-5962`; raw forward `4856`; ring sizing comment "48kHz stereo ≈ 5.5MB" `247-249`; client mic 48000 default pre-init `MicrophoneCapture.ts:64` | 48k stereo = 192 KB/s = **6×** 16k-mono egress per affected stream (Railway egress is billed per GB) |
| 3 | **Google rolling-recognize window re-send** — every 500ms a window of up to 8s is re-sent to GCP; each audio second is included in up to ~16 windows (bounded by MAX_IN_FLIGHT=2 concurrency, still ~4–16× duplication) | `WINDOW_BYTES` 8s `server.js:1073`, `ROLL_MS` 500 `1076`, `scheduleRoll` `1254-1267` | During GoogleSTT fallback, GCP-bound egress is ~8–16× the live audio rate; also per-call recognize billing on overlapping audio |
| 4 | **Prebuffer / probe / reconnect replays** — every failover replays up to 30s; every shadow probe replays 15s (≤5 probes/session per provider pair); reconnects replay downtime-sized windows; auto-detect re-POSTs 2.5s + replays 3s | full replay `4414-4417`/`4765`/`4805`; probe replays `4565-4581`, `4674-4695`; reconnect `4432-4436`; detect POST `5043-5059`, replay `5080-5084` | Per incident: up to 30s duplicate audio to the new provider + 15s per probe. Under provider flapping (C6 scenario) this compounds |
| 5 | **ElevenLabs base64 + JSON envelope (~+37%)** — PCM split into 4KB sub-chunks, base64'd (+33%) inside ~70B JSON; plus 100ms silent-PCM keepalives every 10s; plus probe traffic uses same encoding | sender `server.js:5541-5554`; replay `5581-5593`; keepalive `5561-5578` | When EL is active (emergency or probe), upstream egress is ≈1.37× audio rate |
| 6 | **Screenshots through the backend** — `/v1/chat` accepts ≤4 images ≤200KB base64 each (≤800KB/request, 4MB body limit), re-sent to Gemini/Groq | `server.js:134` (bodyLimit comment), `3800-3805` (`MAX_IMAGE_B64_CHARS`), forwarded in `callGemini`/`buildGroqMessages` `2466-2478`, `2287-2301` | Inflates control-plane ingress+egress; unrelated to STT but shares the same Railway egress bill |
| 7 | **Client reconnect flush** — up to 500 buffered chunks (~10s+) burst-flushed on reconnect, while the server may also replay its own prebuffer to the upstream | `NativelyProSTT.ts:525-541`; server-side replay independent | Bursty, not duplicative client→server, but server→vendor replay of the same audio doubles vendor-side bytes after reconnects |
| 8 | **Transcript/log verbosity** — every Deepgram transcript logged with 80-char text (`5205`), Google partials/finals logged (`1130`, `1215`), 294 console.* sites; Railway charges for log volume | `server.js:5146-5148` (first-5 + verbose gate is mitigation), `5205`, `1130` | Log egress cost + noise; partially mitigated by H4 gating |

Mitigating controls already present: interim drop under 1MB backpressure (`4357-4363`), 64KB frame cap (`5779`), session byte budget (`5786-5792`), per-image caps (`3800-3805`), keepalive instead of constant audio.

---

## 9. Scale & reliability risks

| # | Risk | Evidence | Consequence |
|---|---|---|---|
| 1 | **All state in-memory ⇒ single-instance only.** Rate limiter (`server.js:213-218` — comment explicitly says keep single-instance), DDoS maps (`757-761`), `activeSessions`/`liveSockets`/`wsConnections` (`242-244`), `keyCache`/`trialCache` (`251-254`), `searchSessionCache` (`262`), `recentSystemChannels` (`270`), all key pools/cooldowns (`300`, `529`, `644`, `694`, `728`), `providerHealth` (`810-825`), webhook idempotency maps (`6163`) | Horizontal scaling today: session takeover breaks (duplicate sessions per sk on different instances), mic/system pairing detection breaks (mic double-billing or missed billing), provider-health split-brain (each instance independently burns failing keys), rate limits multiply, search session dedup leaks credits |
| 2 | **Billing loss window = entire session.** STT usage exists only in process memory until `socket.on('close')` (`6078-6124`). Crash/OOM/SIGKILL loses all open sessions' usage (sessions can run 4h). SIGTERM drain is 20s (`7648-7660`) — covers redeploys only. `uncaughtException` → exit(1) in 1s (`122-127`) makes any unguarded throw a fleet-wide billing wipe | Revenue leakage scales with concurrent session count and crash frequency; no journal/WAL of in-progress seconds |
| 3 | **STT blast radius onto the whole API.** One process: Google rolling recognize runs `pcmRmsEnergy` (O(n) per chunk per session) + Buffer copies + base64 encodes on the same event loop serving `/v1/chat` SSE streams and webhooks. The global WS cap exists precisely because of memory pressure (`246-250`). An STT-triggered uncaughtException restarts the process → 502s + 1006s on **all** routes (acknowledged at `115-118`) | STT load/instability degrades and can kill control-plane availability; this is the strongest argument for the relay split |
| 4 | **Supabase write-failure handling is log-only for billing.** `billSTTSeconds` failures caught and logged (`6118-6122`); trial RPC-missing fallbacks alert but skip billing (`1849-1851`); webhook handlers get 3 retries then permanent loss w/ Telegram alert (`6244-6264`) | Silent under-billing; webhook loss requires manual replay from `/admin/webhook-log` (in-memory, lost on restart) |
| 5 | **Quota enforcement races on 30s-stale cache.** Session-open gate reads cached counters (`5919`); STT overrun bounded only by the 25s watchdog granularity (`4381-4401`); two channels share one budget watchdog (noted `4394-4397`); minute-floor billing (`1966`) rounds 31s → 1 min | Bounded over/under-billing; acceptable today, but relay must reproduce the watchdog or improve it |
| 6 | **Stale/leaky session state.** Crashed clients leave `activeSessions` until the 60s sweep / 4h TTL (`1331-1342`); `recentSystemChannels` 10-min retention drives mic billing decisions (`1350-1354`) — on a relay split this map must be shared or mic-billing logic re-thought | Mis-billing of mic-only sessions across relay nodes |
| 7 | **Global ceilings sized for one box.** `MAX_CONCURRENT_WS=200` (`250`) counts both channels ⇒ ~100 concurrent meetings/instance; rejections are client-visible 1013 | Hard scale ceiling; relay regions each need their own (and the cap math changes) |
| 8 | **IP extraction is Railway/Envoy-specific.** `getIP` prefers `x-envoy-external-address` (`1565-1573`); rate-limit keying likewise (`224-229`) | Regional relays behind different LBs must replicate equivalent trusted-header logic or per-IP limits collapse/bypass |
| 9 | **Deepgram deny-list and close-code taxonomy are tribal knowledge encoded in one closure.** `NOVA_2_ONLY_LANGS` (`609-613`), en-* normalization (`628-631`), close-code semantics (`5235-5263`) cite production log forensics | High regression risk if re-implemented rather than extracted verbatim |
| 10 | **`request_logs` table unused; `increment_transcription_minutes` RPC unversioned.** No repo migration defines the paid-STT RPC (only a comment-reference at `1961-1971`) | Migration must first export the live function definition or relay billing will silently fall through |

---

## 10. Responsibility map for the migration

### 10.1 Stays on Railway (control plane)

Everything in §4 except route 13: trial lifecycle, usage, pro/verify, chat/completions/embed/search, calendar OAuth proxy, Dodo + Telegram webhooks, admin, email senders (`7365-7619`), AI provider pools (Groq `273-408`, Tavily `410-515`, Gemini `681-714`, MiniMax `716-748`, routing `2949-3235`, embeddings `3237-3426`), webhook handlers (`6514-7231`), plan logic (`1415-1467`).

### 10.2 Moves to / is duplicated in a shared STT core (extract from server.js verbatim — exact line ranges)

| Extractable unit | server.js lines | Notes |
|---|---|---|
| WS DNS cache + keep-alive `https.Agent` | `76-113` | Needed by relay for Deepgram/EL reconnect storms |
| Deepgram key pool + per-key strike/cooldown | `517-575` | `pickDeepgramKey`, `markDeepgramKeyFailed/Healthy` |
| Deepgram reconnect spreader | `577-592` | Global pending counter — per-relay-node is fine |
| Deepgram model/language router (incl. `NOVA_2_ONLY_LANGS`) | `594-632` | Encodes prod-log-verified 400 behavior |
| ElevenLabs key pool | `634-679` | |
| Auto-detect language tables + normalizers (`AUTO_DETECT_LANGS`, `normaliseDetectedLang`, `CHIRP2_LANG_MAP`, `toChirp2Lang`, `CHIRP2_AUTO_DETECT_LANGS`) | `763-798` | |
| Watchdog/probe timing constants (env-overridable) | `800-805` | |
| Provider health framework: `providerHealth` STT slots + `markFailed`/`markHealthy` + `msUntilMidnight` | `807-825`, `884-978` | Embedding slots (`823-873`) stay on Railway; split the object |
| `CircularBuffer` | `980-1040` | Used by prebuffer + Google ring |
| `pcmRmsEnergy` | `1042-1055` | |
| `createGoogleSTTSession` (rolling recognize) | `1057-1291` | Needs `speechClient` (`143-176`) + GCP creds bootstrap |
| STT provider picker (`hasAvailable*Key`, `pickSTTProvider`, `pickNextSTTProvider`) | `3428-3463` | |
| `/v1/transcribe` session handler — whole closure | `4186-6139` | Decompose as below |
| — backpressure transcript sender | `4357-4363` | |
| — live-billable estimator + quota watchdog ping loop | `4365-4401` | |
| — replay buffer helpers (A/B semantics, downtime-sized) | `4407-4436` | |
| — shadow probes (Google + ElevenLabs) + teardown | `4438-4731` | |
| — `switchToFallback` | `4733-4806` | |
| — `connectSTTProvider` (Deepgram `4816-5385`, Google `5388-5450`, ElevenLabs `5457-5755`) | `4808-5756` | The largest, most behavior-dense unit |
| — auth timeout + `processChunk` | `5758-5842` | |
| — auth handshake (frame parse → session init) | `5844-6006` | Auth *validation* itself should call control plane (see 10.4) |
| — close/billing/error handlers | `6008-6138` | |
| Safe logging/hash + IP helpers (`getIP`, `hashIP`, `normalizeIPForLimit`) | `1559-1609` | Relay needs trusted-header config per region |
| `tgAlert` debounced alerting | `1488-1556` | Or replace with shared observability |
| `checkDDoS` + DDoS maps + housekeeping sweep STT portions | `757-761`, `1469-1486`, `1293-1413` (subset: lines `1302-1366` session/IP/system-channel/DNS evictions) | Sweep must be split: webhook purge (`1406-1412`) and Groq/Tavily evictions (`1383-1404`) stay on Railway |
| In-memory session registries (`activeSessions`, `liveSockets`, `wsConnections`, `recentSystemChannels`, caps) | `241-271` | Per-relay-node OK **except** `recentSystemChannels` + takeover semantics if a key's two channels can land on different regions — must pin both channels of one identity to one relay (or share state) |

### 10.3 Client (Electron) changes

- `NativelyProSTT.ts:72` hardcodes the Railway URL — needs region selection/discovery (control-plane endpoint returning relay URL, or DNS-based). The fatal-error list (`:373-378`), transcript shape (§5.14), and reconnect/backoff behavior must remain compatible.
- `dnsHelpers.ts` IPv4-only resolver assumptions should be re-validated against relay hosting.

### 10.4 Auth/billing seam (control plane ↔ relay)

- Relay needs: key/trial validation + quota snapshot at session open, and a billing write at close. Options: (a) relay calls Railway (`/v1/usage`-like internal endpoint + new internal billing endpoint), or (b) relay talks to Supabase directly reusing `validateKey` (`2030-2106`), `validateTrial` (`1778-1805`), `buildQuota`/`buildTrialQuota` (`2108-2131`, `1746-1776`), `billSTTSeconds` (`1919-1979`), `maybeResetQuota` (`2144-2178`). Either way the **webhook-driven `keyCache` eviction** (`6491-6496`, used throughout webhook handlers) no longer reaches relay caches — relay key caches need TTL-only semantics or an invalidation channel.

### 10.5 DB

- Export live definition of `increment_transcription_minutes` into a repo migration before anything else (referenced `server.js:1968`, no SQL in repo).
- Trial RPCs already in `scehma/migrations/001_trial_rpc_functions.sql` (note hardcoded limits: ai<10, search<2).
- Consider an STT usage journal table (periodic flush) to close the §9.2 crash-loss window — currently nothing exists.

### 10.6 Observability / deployment

- Current observability: console logs (level via `LOG_LEVEL`, default `warn` in prod, `132-134`), Telegram alerts, `/health`, `/admin/provider-health`, optional PostHog/Axiom for embeddings only (`3401-3426`). No metrics for STT sessions — relay should add session-count/forwarded-bytes/failover-rate metrics; metric **types** to define fresh (none exist to extract).
- Deployment: Railway nixpacks, Node 20, restart on_failure max 5 (`railway.toml`). Graceful shutdown contract (1001 close + 20s drain, `7625-7669`) must be reproduced on relays so redeploys don't strand billing.

---

## 11. Existing test/build tooling status

**`natively-api/package.json` scripts** (`natively-api/package.json:9-15`):
- `start` / `dev` — run server (needs full env).
- `test` — `node --test tests/*.test.mjs`. **Not offline-safe as a whole**: most suites (`fallback`, `stt-fixes`, `stt-health-system`, `stt-comprehensive`, `key-pool`, `smart-routing` §2, `mode-model-routing`, `exhaustion`) spawn `node server.js` and require `.env` (Supabase URL/keys, provider keys) and/or a `TEST_KEY`, some hit live providers.
- `test:payments` — live payment-flow script.
- **No lint, no typecheck, no build step** for natively-api (plain JS ESM).

**What was run for this audit (offline-safe only):**
- `node --check` — PASS on `server.js`, `servertobeupgraded.js`, `lib/flashModelPicker.js`, `lib/minimaxProvider.js`, `lib/queryClassifier.js`.
- `node --test tests/unit-fixes.test.mjs tests/flash-model-picker.test.mjs` — **56/56 pass** (covers C2 mic-billing logic, C3 stream-abort billing, C6 fallback-secs accumulation, H2 DNS cache, H11 timer cleanup, M1/M2 helpers, B4 webhook retry — all relevant to the extraction map).
- `node --test tests/minimax-{provider,failure,hedge,wire}.test.mjs` — **81/81 pass** (wire test uses a local mock HTTP server; no external network).
- Not run (require live server/env/network): `fallback`, `key-pool`, `stt-comprehensive`, `stt-fixes`, `stt-health-system`, `smart-routing` (integration section), `mode-model-routing`, `exhaustion`, payments, and all non-`.test.mjs` ad-hoc scripts.

**Caveat for the migration**: the STT integration suites (`stt-comprehensive.test.mjs`, `stt-fixes.test.mjs`, `stt-health-system.test.mjs`, `key-pool.test.mjs`) are the closest thing to a relay conformance suite — they drive the real WS protocol (auth frame, failover, language detect, key rotation) against a spawned server with env-driven timing overrides (`TEST_SILENCE_WATCHDOG_MS` etc., `server.js:800-805`). They should be retargeted at the relay during extraction.
