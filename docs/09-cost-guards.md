# Phase 9 — STT Relay Cost Guards & Abuse Protection

**Date:** 2026-06-13
**Status:** Complete — every required guard verified-present or gap-closed; one dedicated test per guard (#1–#19) in `services/stt-relay/tests/cost-guards.test.mjs`; 102/102 relay tests green (73 prior + 29 new), 277/277 core, 15/15 migration billing.
**Inputs (binding):**
- `docs/01-target-stt-relay-architecture.md` §11 (cost guard strategy), §6.5 (mic/system pairing), §12 (egress metric)
- `docs/05-stt-relay-service.md` §2.2 (token-claim enforcement), §5 (backpressure), §6 (caps)
- `docs/06-durable-stt-billing.md` §5 (F2/F3 pairing — the bypass-prevention SQL)
- `docs/08-observability.md` §2.2 (`cost_guard` event), §6 (`egress_estimate_gb`)
- `docs/00b-pre-migration-review-findings.md` F2, F3, F8, F10, F11, F14, F20

**One-sentence summary:** The relay enforces a layered set of hard cost/abuse guards — bandwidth caps, duration/byte/replay/reconnect budgets, per-IP/global/per-identity connection ceilings, two-sided backpressure, provider-flag fallback control, and a one-shot egress threshold alert — each with a documented enforcement point, close code, `cost_guard` telemetry event, and a dedicated auditable test.

---

## 1. Guard catalog

| # | Guard | Mechanism | Config knob (default) | Enforcement point | Failure mode / close code | `cost_guard` / event | Test name |
|---|---|---|---|---|---|---|---|
| 1 | Hard-cap sample rate to 16 kHz | clamp auth frame to `min(env, token claim)`; reject **or** down-negotiate | `ALLOW_48KHZ` (`false`), `REJECT_HIGH_BANDWIDTH_AUDIO` (`true`) | `session.js:621-640` | reject: `invalid_key_format` + close; clamp: proceed at 16k | `bandwidth_reject` / `bandwidth_downnegotiate` | `guard #1a`, `guard #1b` |
| 2 | Hard-cap channels to mono | same dual-gate clamp on channels | `ALLOW_STEREO` (`false`), `REJECT_HIGH_BANDWIDTH_AUDIO` (`true`) | `session.js:621-640` | reject: `invalid_key_format` + close | `bandwidth_reject` | `guard #2` |
| 3 | Stereo flag (dual-gate) | effective cap `= min(env ALLOW_STEREO?2:1, token max_channels)` | `ALLOW_STEREO` + token `max_channels` | `session.js:619-622` | stricter side wins; over-cap → reject/clamp | `bandwidth_*` | `guard #3a`, `guard #3b` |
| 4 | 48kHz flag (dual-gate) | effective cap `= min(env ALLOW_48KHZ?48000:16000, token max_sample_rate)` | `ALLOW_48KHZ` + token `max_sample_rate` | `session.js:619-621` | stricter side wins; over-cap → reject/clamp | `bandwidth_*` | `guard #4a`, `guard #4b` |
| 5 | Max session duration | wall-clock watchdog timer | `MAX_SESSION_SECONDS` (`14400`) | `session.js:419-430` | close **1008** reason `max_session_duration` | `max_duration` | `guard #5` |
| 6 | Max bytes per session | running `bytes_in` vs budget; `0`⇒auto `declared-rate×2×4h×2` | `MAX_BYTES_PER_SESSION` (`0`=auto) | `session.js:171-177` | `session_byte_budget_exceeded` + close **1008** | `byte_budget_exceeded` | `guard #6a`, `guard #6b` |
| 7 | Max reconnects per logical session | cumulative takeover count on the `sub:channel` registry key | `MAX_RECONNECTS_PER_SESSION` (`20`) | `session.js:665-678`, `sessionRegistry.js:register/reconnectCount` | `invalid_key_format` + close **1008** `too_many_connections` | `reconnect_budget` | `guard #7` |
| 8 | Max replay seconds | `getReplayBuffer` caps replay at `maxSeconds×bytesPerSec` | `MAX_REPLAY_SECONDS` (`30`) | `session.js:271-276` | replay bytes bounded (no close) | — | `guard #8` |
| 9 | Max WS per IP | per-IP live count; IP chosen per `TRUST_PROXY_HEADER` | `MAX_WS_PER_IP` (`5`), `TRUST_PROXY_HEADER` (`''`) | `server.js:303-308` (+ `extractIp` `:187`) | close **1008** `too_many_connections` | — (logged `ws.too_many_per_ip`) | `guard #9a`, `guard #9b` |
| 10 | Max global WS | global live count vs ceiling | `MAX_CONCURRENT_WS` (`200`) | `server.js:310-315` | close **1013** `server_at_capacity` | — (logged `ws.at_capacity`) | `guard #10` |
| 11 | Max sessions per identity **(GAP CLOSED)** | per-`sub` live AUTHED session count | `MAX_SESSIONS_PER_IDENTITY` (`4`, `0`=off) | `session.js:680-691`, `sessionRegistry.js:subCount` | close **1008** reason `too_many_sessions` | `identity_session_cap` | `guard #11a`, `#11b`, `#11c` |
| 12 | Backpressure (both sides) | client: `shouldDropInterim`; provider: `checkProviderBuffer` (send/drop/kill) | (constants in core `backpressure.js`) | `session.js:188-209` (provider), `:248` (client) | provider kill → failover; drops counted | `backpressure_shed` (+`kill?`) | `guard #12a`, `#12b` |
| 13 | Drop partials, keep finals | `shouldDropInterim` gates **interims only**; finals never gated | `SEND_BUFFER_LIMIT` (1MB, core) | `session.js:247-250` | interim dropped; final always sent | — | `guard #13` |
| 14 | Prevent mic-only billing bypass | relay bills the channel honestly + reports `channel`+`billable_seconds`; pairing applied DB-side | — (DB RPC, Phase 6) | `session.js:517-545` (finalize payload) | (no close; DB pairing) | `session_summary` | `guard #14` |
| 15 | Avoid duplicate system+mic billing | system session reported with `channel=system`+billed secs (pairing anchor) | — (DB RPC, Phase 6, F2) | `session.js:517-545` | (no close; DB overlap query) | `session_summary` | `guard #15` |
| 16 | Disable ElevenLabs fallback | chain `next()` skips EL when flag off | `ENABLE_ELEVENLABS_FALLBACK` (`true`) | `server.js:46,68` (factory `available`/`next`) | chain ends `all_stt_providers_down` | `all_providers_down` | `guard #16` |
| 17 | Disable high-cost probe **(GAP CLOSED)** | gate around the energetic-silence watchdog (the only probe) | `ENABLE_SILENCE_WATCHDOG` (`true`) | `session.js:372-388` (gate at `:378`) | no failover when off | `provider_failover` (when on) | `guard #17a`, `#17b` |
| 18 | Egress estimate metric | `egress_estimate_gb = bytes_out_total / 1024³`; sums every outbound peer | — (always on) | `server.js:228-253` | (metric only) | `/metrics egress_estimate_gb` | `guard #18` |
| 19 | Egress threshold warning **(GAP CLOSED)** | one-shot latch when cumulative egress crosses threshold | `EGRESS_WARN_GB` (`0`=off) | `server.js:144-153`, called `:255` + `:342-346` | (alert only, no close) | `egress_threshold_warning` | `guard #19a`, `#19b` |

> Bandwidth guards (#1–#4) share the SAME enforcement block (`session.js:611-640`): one `min(env, token)` computation feeds both the reject and down-negotiate paths for rate and channels. They are catalogued separately because each is independently testable (rate vs channels × reject vs clamp × env-gate vs token-gate).

---

## 2. The dual-gate (env ∧ token claim) precedence rule

For sample rate and channels the **effective cap is the stricter of two independent gates** — defense in depth:

```
effMaxRate     = min( ALLOW_48KHZ  ? 48000 : 16000 ,  token.max_sample_rate )
effMaxChannels = min( ALLOW_STEREO ? 2     : 1     ,  token.max_channels    )
```

(`session.js:619-622`.) Precedence consequences:

- **Token says 48k, relay env `ALLOW_48KHZ=false`** ⇒ effective 16k. The relay refuses/clamps even though the control plane granted 48k. The relay's local cost posture is final — a misconfigured or compromised signer cannot force expensive audio through a relay that is told not to accept it. (`guard #1a`, `guard #4b`.)
- **Relay env `ALLOW_48KHZ=true`, token says 16k** ⇒ effective 16k. A relay running in a 48k-capable cohort still honors the per-session grant; an un-upgraded client/token is not silently upgraded. (`guard #4b`.)
- **Both allow** ⇒ the requested rate up to the shared cap is honored. (`guard #4a`.)

Identical logic for stereo (`guard #3a`/`#3b`). When the request exceeds the effective cap, `REJECT_HIGH_BANDWIDTH_AUDIO` decides reject (`invalid_key_format`+close, `bandwidth_reject`) vs down-negotiate (clamp to the cap, proceed, `bandwidth_downnegotiate`). The clamped rate/channels flow to the provider context and are reflected in `status:connected`’s session params.

---

## 3. Three-layer defense (48kHz / stereo / dual-stream default-OFF posture)

The canonical ingress is **16 kHz mono, single stream** by default, enforced at three independent layers so no single layer's misconfiguration opens the cost valve:

```
┌─ Layer 1: CLIENT (Phase 7) ───────────────────────────────────────────────┐
│  Electron Rust DSP emits canonical 16k mono; the client requests within    │
│  caps (audit §6). A good citizen never asks for 48k/stereo.                 │
└───────────────────────────────────────────────────────────────────────────┘
                              │ session-create
┌─ Layer 2: CONTROL PLANE (Phase 4) ────────────────────────────────────────┐
│  Token claims `max_sample_rate:16000, max_channels:1, allow_dual_stream`   │
│  for all plans by default; rollout PERCENT flags decide who is even        │
│  eligible. Raising a claim is an explicit per-plan/per-cohort grant (F14).  │
└───────────────────────────────────────────────────────────────────────────┘
                              │ WSS + token
┌─ Layer 3: RELAY (this phase) — HARD CAP ──────────────────────────────────┐
│  `effective = min(env flag, token claim)`. Even a token that grants 48k is │
│  refused/clamped if the relay's ALLOW_48KHZ=false. The relay is the last,  │
│  non-bypassable word on bytes accepted per session.                        │
└───────────────────────────────────────────────────────────────────────────┘
```

Dual-stream is gated at Layer 2 (`allow_dual_stream` claim → the second channel's session-create 402s when revoked) and additionally bounded at Layer 3 by the per-identity session cap (#11, default 4 = mic+system × 2 devices). A client requesting within caps, granted within rollout percent, is still hard-capped by the relay — three layers, each fail-safe toward 16k-mono-single-stream.

---

## 4. Egress math

`/metrics` (`server.js:228-253`) computes egress as the sum of **every relay-outbound direction**, cumulative-since-boot folded with the live in-flight bytes of currently-open sessions:

```
bytes_out_total =  bytes_out_to_deepgram_total
                 + bytes_out_to_google_stt_total
                 + bytes_out_to_elevenlabs_total
                 + bytes_out_to_client_total

egress_estimate_gb = round( bytes_out_total / 1024³ , 6 )      # GiB
```

- **Provider-outbound** (`bytes_out_to_{deepgram,google_stt,elevenlabs}`) is accumulated in `session.accumulateOutBytes` on every successful forward AND on replay (`session.js:215-219`, `:283`).
- **Client-outbound** (`bytes_out_to_client`) is the byte length of every JSON frame the relay sends (`session.js:124`).
- Closed sessions roll their finalized byte counters into `state.cumulative` on the WS close handler (`server.js:328-347`); `/metrics` adds the live sessions' `snapshotRow()` byte fields on top — so a single multi-hour session still moves the gauge before it closes (`guard #18` asserts `bytes_out_total == Σ directions` and `egress_estimate_gb == bytes_out_total/1024³`).

Ingress (`bytes_in_total`) is tracked separately (client→relay PCM) and is roughly equal to provider-outbound at 16k mono — it is reported but is not the egress cost signal (most vendors bill egress).

**Threshold (#19):** when the monotonic `egress_estimate_gb` first crosses `EGRESS_WARN_GB`, a **one-shot** `egress_threshold_warning` (log + Axiom event) fires (`server.js:144-153`). The check piggybacks on the existing `/metrics` scrape AND the session-close path — no new timer. A `state.egressWarned` latch guarantees exactly one emit per process lifetime (`guard #19b`). `0` disables it (`guard #19a`). This is the cheap per-relay complement to the Axiom monthly-projection monitor (docs/08 alert #4); the per-relay included-traffic envelopes are docs/01 §14 (us-relay ~20 TB, asia-relay ~1 TB).

---

## 5. What is enforceable per-socket vs per-identity vs DB (honest scope)

| Layer | What it can enforce | What it CANNOT | Guards |
|---|---|---|---|
| **Per-socket** (one WS) | frame size, byte budget, session duration, sample-rate/channel clamp, client/provider backpressure, replay cap | anything spanning multiple sockets of the same user (a per-socket reconnect counter only ever reaches 1) | #1–#6, #8, #12, #13 |
| **Per-relay-instance** (registry) | per-IP cap, global cap, **per-identity concurrent-session cap (#11)**, **cumulative reconnect-takeover count per `sub:channel` (#7)** | counts across the OTHER region's relay (each relay has its own registry) | #7, #9, #10, #11 |
| **DB (Supabase, Phase 6)** | mic/system pairing & dedupe across relays + close orderings, durable billing, abandoned-session reconcile | nothing real-time on the audio hot path (out-of-band) | #14, #15 |

### #7 reconnect semantics — honest accounting

A relay session is **one socket**. "Reconnects" are the client's **takeover reconnects** for the same `sub:channel` within a logical session (MUST-PRESERVE §6). The naive per-socket counter is meaningless: each socket calls `createSession` once and could only ever increment its own counter to 1, so `> MAX_RECONNECTS_PER_SESSION` would never trip for a sane budget.

**What is actually enforced:** the registry persists a **cumulative `reconnectCount` on the `sub:channel` takeover key** (`sessionRegistry.js:register` → each takeover bumps `prior.reconnectCount + 1`). At admission the new socket reads the PROSPECTIVE count (`registry.reconnectCount(key) + 1`) and refuses with close 1008 once it would exceed the budget (`session.js:665-678`). This is a **per-relay-instance, per-`sub:channel` takeover-rate cap** — exactly the abuse vector (a client hammering reconnects on one region) that is enforceable per-socket-free. It does NOT see takeovers that landed on the *other* relay (each relay holds its own registry, and the control plane pins one identity's channels+reconnects to one region — docs/01 §3.2 item 6 — so in normal operation all takeovers for a `sub:channel` DO hit the same relay; a deliberate cross-region flip resets the local counter, which is acceptable because the control plane's session-affinity pin already rate-limits region flips). `guard #7` proves the cumulative-across-sockets enforcement (3 sockets, budget 1 → 3rd refused).

### #11 per-identity cap — honest accounting

`MAX_SESSIONS_PER_IDENTITY` (default 4) counts **live authed sessions per token `sub`** in `bySub` (`sessionRegistry.js`). A **reconnect-takeover of the same `sub:channel` reuses the prior slot** (the prior record's slot is handed to the new socket — `decSub(prior.sub)` then `incSub(entry.sub)`), so a user reconnecting their mic is NEVER blocked (`guard #11b`). Only a genuinely NEW `sub:channel` beyond the cap is refused with close 1008 `too_many_sessions` (`guard #11a`). The slot is released on close (`guard #11c`). **Scope honesty:** this is per-relay-instance — it bounds one identity's fan-out on a single relay (mic+system×2 devices = 4), not globally across both regions. For a hard global cap the control-plane atomic lease (docs/01 §6.5 `stt_reserve_session`) is the cross-instance authority; the relay cap is a cheap local backstop against a single compromised client opening dozens of sockets on one relay.

---

## 6. Mic/system bypass-prevention cross-reference (Phase 6)

Guards #14/#15 are **honest-meter** guards: the relay does NOT decide pairing (server.js's in-process `recentSystemChannels` was structurally broken across relays — F2/F3). The relay's only job is to hand the Phase-6 finalize RPC the truth:

- `channel` (`system`/`mic`/`default`) — drives the pairing query.
- `billable_seconds` — the channel's OWN honest seconds (mic billed normally; the RPC refunds it iff an overlapping **billed** system session exists).
- `started_at`/`ended_at` — the window the `tstzrange &&` overlap query needs.

`session.js:517-545` (finalize payload) carries all three; `guard #14` asserts a mic session reports `channel=mic` + honest `billable_seconds>0` (the relay never pre-zeros), and `guard #15` asserts a system session reports `channel=system` + `billable_seconds>0` so it qualifies as the **billed cover** the overlap query requires (F3: a `<30s` free heartbeat with `billed_seconds=0` cannot launder a long mic stream). The pairing SQL itself — overlap, refund, idempotency, heartbeat-bypass rejection — is proven in `migrations/__tests__/stt_billing_logic.test.mjs` ("mic billing reversed when an overlapping billed system session exists", "free heartbeat does NOT launder the mic stream", "default channel always bills"), 15/15 green. See `docs/06-durable-stt-billing.md` §5.

---

## 7. Estimated cost impact of each guard

Baseline: 16 kHz mono s16le = 32 KB/s = **1.92 MB/min ≈ 115 MB/channel-hour** each direction (docs/01 §14).

| Guard | Cost lever | Estimated impact |
|---|---|---|
| #1/#2/#3/#4 16k-mono cap | blocks 48k (×3) and stereo (×2) ingress→egress | up to **6× egress reduction** vs an un-clamped 48k-stereo stream; the dominant amplifier (F14) |
| #5 max duration (4h) | bounds a stuck/abandoned stream | caps worst-case at ~115 MB/h × 4 = **~460 MB/channel** instead of unbounded |
| #6 byte budget | bounds a malicious flood at the byte level | hard ceiling ~921 MB (16k mono 4h ×2) per session |
| #7 reconnect cap | bounds replay-amplification via reconnect storms | each takeover replays ≤ #8 cap; 20 reconnects ≤ ~640 MB extra worst-case (with #8=30s) |
| #8 replay cap (30s) | bounds re-transcription egress on failover/reconnect | ≤ 30s × 32 KB/s = **~960 KB per failover** instead of the full 4h prebuffer |
| #9/#10/#11 connection caps | bound fan-out (abuse / runaway client) | linear: each blocked socket saves a full session's egress |
| #12/#13 backpressure | prevents unbounded in-process audio queue on a wedged provider | **OOM prevention** (F10) + sheds audio a dead provider would never bill anyway |
| #16 EL flag off | removes the +37% base64-inflation vendor during a cost incident | **~37% egress cut** on the EL-fallback share when toggled off |
| #17 silence-watchdog off | removes spurious failovers (each failover = a replay + a 2nd provider connect) | eliminates failover-driven replay spend if the probe ever misfires |
| #18 egress metric | visibility (no direct saving) | enables the projection alert that catches a cost regression early |
| #19 egress warn | one-shot early warning before the monthly-projection monitor | bounds the blast radius of an unnoticed amplification incident |

Net: the relay both **caps** (16k clamp, EL flag, duration/byte/replay budgets) and **reduces** total bytes (the F4 Google incremental fix in the core, the EL flag) versus the Railway status quo — the §14 cost comparison (2× VPS flat ≈ $25–40/mo vs Railway ~$160/TB) understates the win because these guards shrink the byte volume itself.

---

## 8. Gaps closed this phase

| # | Was | Now |
|---|---|---|
| 11 | **Missing** — no per-identity concurrent-session cap | Added `MAX_SESSIONS_PER_IDENTITY` (config) + `bySub`/`subCount` (registry) + admission enforcement (close 1008 `too_many_sessions`, `identity_session_cap` cost_guard). |
| 7 | **Ineffective** — `reconnectsUsed` was per-socket (could only reach 1) | Cumulative `reconnectCount` now persists on the registry `sub:channel` key; admission enforces the prospective count. |
| 17 | **No kill-switch** — silence watchdog always on | Added `ENABLE_SILENCE_WATCHDOG` (default true) gate so the only probe can be disabled without a redeploy during a spurious-failover incident. |
| 19 | **No per-relay threshold** — only docs-level Axiom monitor | Added `EGRESS_WARN_GB` one-shot `egress_threshold_warning` (log + Axiom), checked cheaply on the existing metrics/close path. |

All other guards (#1–#6, #8–#10, #12–#16, #18) were verified present and correct; tests were added for each so coverage is auditable 1:1.

---

## 9. Test inventory

`cd services/stt-relay && node --test tests/*.test.mjs` → **102/102 pass** (73 prior + 29 new in `cost-guards.test.mjs`). New env vars: `MAX_SESSIONS_PER_IDENTITY`, `ENABLE_SILENCE_WATCHDOG`, `EGRESS_WARN_GB` (all in `.env.example`). Regression gates held: core `node --test packages/stt-relay-core/tests/*.test.mjs` → 277/277; control-plane `node --check server.js` → clean; `node --test migrations/__tests__/*.test.mjs` → 15/15.

Each test is named `guard #N: …` so the suite is a 1:1 audit of the catalog in §1.
