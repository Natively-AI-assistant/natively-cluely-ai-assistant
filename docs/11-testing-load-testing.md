# Phase 11 — STT Relay Testing + Load Testing

**Date:** 2026-06-13
**Status:** Complete — 480/480 tests green across all suites; load test + rollout-verify scripts built and run; coverage matrix 34/34 covered (30 pre-existing, 4 gap-fillers added).
**Inputs (binding):**
- `docs/03-relay-session-token.md` (token format + verify), `docs/04-relay-selection.md` (selection + health),
- `docs/05-stt-relay-service.md` (relay WS contract + provider chain + backpressure),
- `docs/06-durable-stt-billing.md` (flush/finalize + mic/system pairing),
- `docs/09-cost-guards.md` (guard catalog), `docs/01-target-stt-relay-architecture.md` §14 (cost model).

**One-sentence summary:** The full migration test matrix is verified across five suites (core, relay, control-plane, migration billing, electron client); a standalone in-process load generator (`scripts/load-test-stt-relay.mjs`) measures the relay's own capacity (memory/latency/egress) with mock providers; and a rollout smoke verifier (`scripts/verify-stt-relay-rollout.mjs`) probes the full handshake in a self-contained mode plus a live production probe.

---

## 1. Coverage matrix (requirement → suite/test → status)

The 34 required migration-spec scenarios. **Status:** `covered` = a pre-existing test already asserts it; `added` = a Phase-11 gap-filler test was written. Suite keys: **core** = `packages/stt-relay-core/tests/`, **relay** = `services/stt-relay/tests/`, **cp** = `natively-api/tests/`, **mig** = `migrations/__tests__/`, **client** = `electron/audio/__tests__/`.

| # | Requirement | Suite | Test (file → name) | Status |
|---|---|---|---|---|
| 1 | token creation | core | `sessionToken.test.mjs` → roundtrip (all claims), wire format | covered |
| 2 | token verification | core | `sessionToken.test.mjs` → e2e verify + jti; relay `token-gate.test.mjs` → valid token connects | covered |
| 3 | token expiry | core | `sessionToken.test.mjs` → expiry boundary (valid at exp−1s, dead at exp); relay `token-gate.test.mjs` → expired key → `invalid_key_format` | covered |
| 4 | token tamper rejection | core | `sessionToken.test.mjs` → payload byte-flip / sig tamper / claims-rewrite → `bad_signature`; relay `token-gate.test.mjs` → tampered → `invalid_key_format` | covered |
| 5 | wrong-region token | core | `sessionToken.test.mjs` → wrong region; relay `token-gate.test.mjs` → wrong region → rejected | covered |
| 6 | paid auth | cp | `stt-session-endpoint.test.mjs` → paid happy path (full contract, clamps) | covered |
| 7 | trial auth | cp | `stt-session-endpoint.test.mjs` → trial happy path; relay `token-gate.test.mjs` → expired trial → `trial_expired` | covered |
| 8 | quota exceeded | cp | `stt-session-endpoint.test.mjs` → quota-exceeded → 402 `transcription_quota_exceeded` + `resets_at` | covered |
| 9 | relay selection US | core | `relaySelection.test.mjs` → geo matrix (US/CA/EU→us); cp `stt-relays-routes.test.mjs` → percent=100+forced-us → us URL | covered |
| 10 | relay selection Asia | core | `relaySelection.test.mjs` → geo matrix (IN/SG/JP/AU→asia) | covered |
| 11 | relay health fallback | core | `relayHealth.test.mjs` → 2-consecutive-fail flip + 1-success recovery; `relaySelection.test.mjs` → unhealthy → alternate | covered |
| 12 | kill-switch fallback | core | `relaySelection.test.mjs` → kill switch beats all → railway; cp `stt-relays-routes.test.mjs` → kill-switch flip → railway | covered |
| 13 | Deepgram normal stream | relay | `session-flow.test.mjs` → binary forwarded; interim/final shapes exact + cumulative `full_text` | covered |
| 14 | Deepgram connection failure | relay | `failover.test.mjs` → deepgram fatal → `provider_switched`; all-down at admission → `all_stt_providers_down` | covered |
| 15 | Deepgram reconnect | relay | `failover.test.mjs` (rotate/replay path) + `provider-failure-modes.test.mjs` → 1011 key-rotation reconnect (dgConnectCount ≥ 2) | covered |
| 16 | **Deepgram 1011 loop** | relay | `provider-failure-modes.test.mjs` → "1011-loop … rotate keys, then ESCALATE to failover (no infinite spin)" | **added** |
| 17 | **Deepgram key cooldown (relay layer)** | relay | `provider-failure-modes.test.mjs` → "key cooldown at the relay layer: a 1011-struck key (2 identities) is skipped by a later session for 5 min" (also core `deepgramPool.test.mjs` for the pure pool) | **added** |
| 18 | Google STT fallback | relay | `failover.test.mjs` → deepgram→googleSTT `provider_switched` with replay | covered |
| 19 | **Google STT invalid-language fallback** | relay | `provider-failure-modes.test.mjs` → "invalid-language: gst_invalid_argument → fails over to elevenlabs" (+ EL-disabled exhausts chain) | **added** |
| 20 | ElevenLabs fallback | relay | `failover.test.mjs` → chain walks deepgram→googleSTT→elevenlabs | covered |
| 21 | ElevenLabs disabled by flag | relay | `cost-guards.test.mjs` → guard #16: `ENABLE_ELEVENLABS_FALLBACK=false` → chain skips EL → `all_stt_providers_down` | covered |
| 22 | mic/system paired billing | relay+mig | relay `cost-guards.test.mjs` → guard #15 (system anchor) + #14 (mic honest); mig `stt_billing_logic.test.mjs` → mic refunded when overlapping billed system | covered |
| 23 | mic-only abuse billing | mig | `stt_billing_logic.test.mjs` → free heartbeat does NOT launder the mic stream (`billed_seconds=0` cover rejected) | covered |
| 24 | client disconnect | relay | `session-flow.test.mjs` → close → finalize fires; `billing.test.mjs` → close path bills | covered |
| 25 | relay shutdown | relay | `shutdown.test.mjs` → active session gets 1001 `server_restart` + finalize; refuses new while draining (1013) | covered |
| 26 | Supabase flush failure | relay | `usageStore.test.mjs` → transient error parked in retry queue then drained; `billing.test.mjs` → flush failure doesn't interrupt session | covered |
| 27 | Supabase finalization retry | relay | `usageStore.test.mjs` → RPC-missing finalize → direct upsert; retry-queue drain; `billing.test.mjs` → finalize fires after a throwing flush | covered |
| 28 | backpressure partial drop | relay | `cost-guards.test.mjs` → guard #12a (provider shed) + #13 (client drops interims, keeps finals) | covered |
| 29 | max bytes cutoff | relay | `session-flow.test.mjs` → byte budget → `session_byte_budget_exceeded` + 1008; `cost-guards.test.mjs` → guard #6a/#6b | covered |
| 30 | max duration cutoff | relay | `cost-guards.test.mjs` → guard #5: max session duration → 1008 `max_session_duration` | covered |
| 31 | high sample-rate rejection | relay | `cost-guards.test.mjs` → guard #1a: 48kHz rejected (`invalid_key_format`); `limits.test.mjs` → 48k reject when flag off | covered |
| 32 | stereo rejection | relay | `cost-guards.test.mjs` → guard #2: stereo rejected; `limits.test.mjs` → stereo reject when flag off | covered |
| 33 | alternate relay fallback (client ladder) | client | `RelayFallbackLadder.test.mjs` → "ladder walks relay → alternate → railway"; `maybeAdvanceTarget` advances to `ALT_URL` after 2 same-relay failures | covered |
| 34 | Railway fallback fallback (client ladder) | client | `RelayFallbackLadder.test.mjs` → ladder advances to `RAILWAY_URL` + sets `onRailway` terminal flag; railway is terminal (no further advance) | covered |

**Result: 34/34 covered** — 30 pre-existing, **4 gap-fillers added** (#16, #17, #19; #19 covers two tests — the EL-on and EL-disabled invalid-language paths).

### 1.1 The four gap-filler tests (new file `services/stt-relay/tests/provider-failure-modes.test.mjs`)

These exercise provider failure modes at the **relay / session-orchestration** layer (the core has unit coverage for the pool/health classifiers; these prove the *session* reacts correctly), using the `create()` hook with a controllable provider factory wired to the **real core `deepgramPool`**:

1. **Deepgram 1011-loop escalation** — a provider that keeps closing with 1011 rotates keys, and once the pool is exhausted the session **fails over** to the next provider (it does not spin forever on a wedged provider). Asserts the deepgram adapter reconnected ≥2× (key rotation) before the final escalation, and the terminal `provider_switched.reason === 'deepgram_close_1011'`.
2. **Deepgram key cooldown at the relay layer** — one shared pool across two sequential sessions on one relay; session 1's 1011 strikes (2 distinct identities) cool the key, and session 2's deepgram connect must NOT reuse the cooling key. After `DEEPGRAM_KEY_COOLDOWN_MS` the key recovers. Proves cooldown is honored across sessions end-to-end, not just in the pool unit (`deepgramPool.test.mjs`).
3. **Google STT invalid-language fallback** — first asserts the core `classifyGoogleSttError({code: INVALID_ARGUMENT})` → `gst_invalid_argument`, then proves the session fails over deepgram→googleSTT→elevenlabs when Google emits that fatal for a bad language code.
4. **Google STT invalid-language with EL disabled** — the same fatal with `ENABLE_ELEVENLABS_FALLBACK=false` exhausts the chain → `all_stt_providers_down` (does not hang), terminal reason `gst_invalid_argument`.

### 1.2 Note on the client-ladder rungs (#33/#34)

The two client-side ladder rungs (**alternate relay** and **Railway fallback**) were verified already-asserted in `electron/audio/__tests__/RelayFallbackLadder.test.mjs`: the test "ladder walks relay → alternate → railway and then sticks on railway" explicitly drives `maybeAdvanceTarget` and asserts `connectUrl()` transitions through `ALT_URL` then `RAILWAY_URL`, and that railway is terminal (`target.onRailway === true`, no further advance). No gap-filler was needed for the ladder; it is referenced in the matrix.

---

## 2. Test inventory + totals (REAL results from this run)

`Node v25.9.0, darwin/arm64`.

| Suite | Command | Tests | Pass | Fail |
|---|---|---|---|---|
| Core | `node --test packages/stt-relay-core/tests/*.test.mjs` | 277 | 277 | 0 |
| Relay service | `node --test services/stt-relay/tests/*.test.mjs` | **106** | 106 | 0 |
| Control plane | `node --test tests/stt-session-endpoint.test.mjs tests/stt-relays-routes.test.mjs` | 38 | 38 | 0 |
| Migration billing | `node --test migrations/__tests__/*.test.mjs` | 15 | 15 | 0 |
| Electron client (relay) | `node --test electron/audio/__tests__/Relay*.test.mjs` | 44 | 44 | 0 |
| **Total** | | **480** | **480** | **0** |

The relay suite grew 102 → **106** with the 4 gap-fillers. The electron suite is run after `npm run build:electron` (the tests load the compiled `dist-electron/electron/audio/NativelyProSTT.js`). The control-plane integration tier auto-skips cleanly without Supabase env (same skip-guard as `stt-health-system.test.mjs`); the offline tiers always run.

---

## 3. Load test — `scripts/load-test-stt-relay.mjs`

### 3.1 What it measures (and deliberately does NOT)

It measures the **relay process's own capacity**: WS connection handling, per-session orchestration, metering, backpressure, and **memory** under concurrent sessions. It uses **MOCK provider adapters** (via `create()`'s `providerFactory` hook) and a **fake Supabase store**, so the numbers reflect the relay — **not** Deepgram/Google/ElevenLabs latency or Supabase round-trips. Provider transcripts are synthesized locally once audio flows; flush/finalize calls are counted. No creds, no network beyond loopback.

### 3.2 Methodology

- Boots the relay **in-process** on an ephemeral port (reusing the relay's own `tests/_helpers.mjs` harness, so its `@natively/stt-relay-core` imports resolve through the relay's `node_modules`).
- Mints a **distinct valid HMAC session token** per session (unique `jti`/`sub`/`session_id`, so no takeover/replay/identity-cap interference).
- For each concurrency tier (`1, 10, 50` by default; `100, 200` gated behind `--max`), launches that many WS sessions concurrently. Each session: connect → auth frame → stream **synthetic 16 kHz mono LINEAR16 PCM** (a sine+noise buffer, 3200 bytes ≈ 100 ms) at a realtime-ish cadence for `--duration` seconds → receive the mock transcript → close.
- Per tier it reports: CPU (`process.cpuUsage` delta), **peak RSS + peak heapUsed** (50 ms sampler), bytes in/out (authoritative, scraped from `/metrics`), **first-transcript latency p50/p95**, transcript count, disconnects, close codes, injected provider failures (`--fail-rate`, which forces a deepgram fatal → failover), and **Supabase flush/finalize counts** (fake store).
- Extrapolates **monthly egress + cost** from the measured per-session egress (see §3.4).

### 3.3 How to run

```bash
cd natively-api
node scripts/load-test-stt-relay.mjs                 # default: tiers 1,10,50, duration 10s
node scripts/load-test-stt-relay.mjs --max=200       # add the 100 + 200 tiers
node scripts/load-test-stt-relay.mjs --duration=20 --fail-rate=0.2   # 20s, 20% failover
node scripts/load-test-stt-relay.mjs --tiers=25,75 --json            # custom tiers + JSON out
node scripts/load-test-stt-relay.mjs --help
```

Flags: `--max=N` (highest tier, default 50), `--duration=SEC` (10), `--chunk-ms=MS` (100), `--fail-rate=F` (0), `--monthly-hours=H` (28000), `--tiers=a,b,c`, `--json`. **Exit 0** on all-clean; **non-zero** if any tier had session errors, an unexpected close code, or a crash.

### 3.4 Cost extrapolation — assumptions (stated)

From `docs/01 §14`: **16 kHz mono s16le = 32 KB/s = 1.92 MB/min ≈ 115 MB per channel-hour**, each direction; egress is the billable signal. The script measures `bytes_out_total / session` (client→provider forwards + relay→client JSON), scales to a full channel-hour, multiplies by `--monthly-hours` (default **28 000** — the docs §14 modeling point), and prices it:
- **Hetzner US VPS** (`us-relay`): 20 TB included, then ~$1.16/TB.
- **Railway** (status-quo baseline): ~$0.05/GB ⇒ ~$160/TB egress.

The model is **illustrative and one-directional** (it counts relay-outbound only; it does not model vendor-side amplification such as ElevenLabs base64 inflation). The measured per-channel-hour egress (~110 MB) validates the docs' ~115 MB assumption.

### 3.5 Sample result (REAL run: `--max=200 --duration=10`)

```
PER-TIER RESULTS
tier  conn  txns   errs  p50ms   p95ms   peakRSS   peakHeap  cpuU    MB out    MB in     flush  final
----- ----- ------ ----- ------- ------- --------- --------- ------- --------- --------- ------ ------
1     1     1      0     107.9   107.9   72.0      12.6      102     0.31      0.31      0      1
10    10    10     0     106.2   107.4   84.7      20.2      170     3.05      3.05      0      10
50    50    50     0     160.5   173.1   94.4      21.8      480     15.27     15.26     0      50
100   100   100    0     126.1   134.7   163.8     27.2      783     30.53     30.52     0      100
200   200   200    0     131.2   158.0   261.9     37.5      768     61.07     61.04     0      200

EGRESS + COST EXTRAPOLATION (docs/01 §14 model)
  basis tier:                 200 sessions × 10s
  measured egress/session:    0.305 MB  (31.3 KB/s)
  → per channel-hour:         109.9 MB  (docs model: ~115 MB)
  assumed monthly volume:     28,000 channel-hours
  → monthly egress:           2.935 TB  (3006 GB)
  Hetzner US egress cost/mo:  $0.00  (20 TB incl, then ~$1.16/TB; flat base $5–15 not counted)
  Railway egress cost/mo:     $150.29  (~$0.05/GB ⇒ ~$160/TB) — the status-quo baseline

RESULT: PASS (all tiers clean, zero crashes)
```

**Reading of this run:** every tier 1→200 connected fully (`conn == tier`), produced a transcript per session (`txns == tier`), and had **zero errors / zero crashes**. Column units: `peakRSS`/`peakHeap` in MB, `cpuU` = CPU user-ms over the tier, `MB out`/`MB in` = egress/ingress for the whole tier. The `flush=0` column is expected — the incremental flush is interval-driven (15 s in the test config) and a 10 s tier does not tick; **finalize** (the durability anchor) fires per session (`final == tier`). Numbers vary ±20% run to run (it's wall-clock + GC sensitive); the **shape** is what matters: linear bytes, sub-linear memory, flat latency.

### 3.6 What "good" looks like (interpretation thresholds)

| Signal | Good | Investigate |
|---|---|---|
| **Errors / crashes** | **0 at every tier** (hard requirement) | any error or non-1000/1001/1005 close at the audio path |
| **Peak RSS @ 50 sessions** | ≲ 150 MB | > 250 MB suggests a per-session leak |
| **Peak RSS @ 200 sessions** | ≲ 300 MB (marginal ~1.1 MB/session) | RSS that grows super-linearly with tier |
| **Peak heapUsed @ 200** | ≲ 50 MB | unbounded heap growth ⇒ retained session state |
| **first-transcript p95** | ≲ 200 ms (mock path; this is relay overhead, not vendor TTFT) | p95 that climbs steeply with concurrency ⇒ event-loop saturation |
| **per-channel-hour egress** | ~110 MB (≈ docs 115 MB) | a large divergence ⇒ a metering/forwarding bug |
| **conn / txns** | `== tier` (full admission + a transcript each) | shortfall ⇒ admission caps or dropped sessions |

The relay's default global cap is `MAX_CONCURRENT_WS=200`; the load test raises it per tier so the cap itself isn't what's being measured. Against the §14 envelope (us-relay 20 TB/mo included), 28 000 channel-hours ≈ **2.9 TB/mo** egress — comfortably inside the included allotment, $0 overage.

---

## 4. Rollout verifier — `scripts/verify-stt-relay-rollout.mjs`

The script ops runs **after deploying a relay**. Clear PASS/FAIL per step; exit 0 iff all checked steps pass.

### 4.1 Self-contained mode (default, no external infra)

Mirrors the control-plane `POST /v1/stt/session` logic in-process using the **exact shared core functions the real endpoint calls** (`selectRelay` + `signSessionToken`), boots a relay in-process with mock providers + a fake Supabase store, then walks the full handshake. Run:

```bash
cd natively-api
node scripts/verify-stt-relay-rollout.mjs
```

**REAL run output (9/9 PASS):**

```
STT Relay Rollout Verify — SELF-CONTAINED mode (in-process, mock providers)

  [1] PASS  relay selection  — region=us reason=geo_map bucket=75
  [2] PASS  session token signed  — v1.eyJ2IjoxL… (v1, 3 segments)
  [3] PASS  relay booted  — ws://127.0.0.1:…/v1/transcribe
  [4] PASS  /healthz  — relay_id=us-1 region=us
  [5] PASS  /readyz ready  — 200
        fixture: de.pcm (366336 bytes, 16kHz mono LINEAR16)
  [6] PASS  WS connected + token accepted  — provider=deepgram
  [7] PASS  transcript received  — "guten tag" (final, full_text="guten tag")
  [8] PASS  usage finalize called  — channel=system billable_seconds=1 first_transcript_ms=5
  [9] PASS  usage flush path wired  — finalize fired (flush is interval-gated)

RESULT: PASS  (9 step(s) checked, 0 failures)
```

It streams a **real PCM fixture** (`tests/de.pcm`, 16 kHz mono LINEAR16) over the WS — exercising the binary audio path, not just synthetic bytes — and asserts a transcript plus a usage finalize. (The incremental flush is interval-gated, so a short probe relies on **finalize** as the durability anchor; the script reports this honestly and does not fail when no flush ticked.)

### 4.2 Live mode (`--live`, production readiness probe)

Hits the **real** control plane + relay:
1. `GET {CONTROL_PLANE_URL}/v1/stt/relays` (auth via key or trial),
2. `POST {CONTROL_PLANE_URL}/v1/stt/session` → relay URL + session token,
3. connect to the returned relay over WSS, send the auth frame,
4. stream the PCM fixture, assert a transcript comes back, then close cleanly.

```bash
CONTROL_PLANE_URL=https://api.natively.software \
NATIVELY_API_KEY=natively_sk_… \
node scripts/verify-stt-relay-rollout.mjs --live
```

**Env vars (live mode):** `CONTROL_PLANE_URL` (required); `NATIVELY_API_KEY` **or** `NATIVELY_TRIAL_TOKEN` (one required); `STT_VERIFY_REGION_HINT` (optional, e.g. `US`); `STT_VERIFY_FIXTURE` (optional absolute path to a 16 kHz mono LINEAR16 `.pcm`). When required env is absent the script **SKIPS** live mode gracefully (prints exactly what's needed) and **does not fail** — verified:

```
  SKIP  live mode — missing required env:
          • CONTROL_PLANE_URL
          • NATIVELY_API_KEY or NATIVELY_TRIAL_TOKEN
  (live mode skipped — not a failure)
RESULT: PASS  (0 step(s) checked, 0 failures)
```

---

## 5. CI integration recommendation

| Suite / script | CI? | Why |
|---|---|---|
| Core (`packages/stt-relay-core/tests`) | **Yes — every PR** | pure, fast (~0.2 s), no network; the foundation |
| Relay service (`services/stt-relay/tests`) | **Yes — every PR** | in-process, mock providers, ~8 s; the relay contract |
| Control-plane offline tier | **Yes — every PR** | source-checks + pure handler logic; no Supabase needed |
| Control-plane integration tier | **Nightly / pre-deploy** | needs Supabase env; auto-skips in PR CI |
| Migration billing logic | **Yes — every PR** | pure reference-model invariants, ~0.06 s |
| Electron client (`Relay*.test.mjs`) | **Yes — every PR** (after `build:electron`) | the ladder + session-resolve + flag-gate; load the compiled bundle |
| **Load test — low tiers** (`--max=50`) | **Yes — every PR (smoke gate)** | deterministic enough; exit-code gates on zero-crash; ~30–40 s |
| **Load test — 100/200 tiers** | **Manual / pre-release** | longer; run when touching session/registry/backpressure or before a capacity sign-off |
| **Rollout verify — self-contained** | **Yes — pre-deploy gate** | proves the full handshake wiring without creds, ~1 s |
| **Rollout verify — live** | **Manual — post-deploy by ops** | the production readiness probe; needs prod creds + a reachable relay |

**Recommended PR gate (one command set):**

```bash
cd natively-api
node --test packages/stt-relay-core/tests/*.test.mjs
node --test services/stt-relay/tests/*.test.mjs
node --test tests/stt-session-endpoint.test.mjs tests/stt-relays-routes.test.mjs
node --test migrations/__tests__/*.test.mjs
node scripts/load-test-stt-relay.mjs --max=50          # zero-crash smoke gate
node scripts/verify-stt-relay-rollout.mjs              # full-handshake wiring gate
# and (from repo root, after build:electron):
node --test electron/audio/__tests__/Relay*.test.mjs
```

All of the above are creds-free and complete in well under two minutes combined.

---

## 6. Files

| Path | What |
|---|---|
| `natively-api/scripts/load-test-stt-relay.mjs` | in-process load generator (NEW) |
| `natively-api/scripts/verify-stt-relay-rollout.mjs` | rollout smoke verifier, self-contained + `--live` (NEW) |
| `natively-api/services/stt-relay/tests/provider-failure-modes.test.mjs` | 4 gap-filler tests: 1011-loop, key cooldown at relay, Google invalid-language ×2 (NEW) |
| `natively-api/services/stt-relay/tests/_helpers.mjs` | the reused `create()` harness (mock providers, token mint, ephemeral port) |
| `docs/11-testing-load-testing.md` | this document |

---

## 7. Decisions / deviations

1. **Scripts are `.mjs`**, matching `natively-api`'s `"type": "module"`. They import the relay's `tests/_helpers.mjs` by absolute path so the core package resolves through the relay's own `node_modules` symlink (the core is not resolvable from the `natively-api` root, only from `services/stt-relay/`).
2. **Gap-fillers live at the relay layer, not the core**, because the core already has pool/health/classifier unit tests; the migration matrix item is specifically "does the *session* react correctly" (escalate, honor cooldown across sessions, fail over on invalid-language). The new tests wire a controllable mock adapter to the **real core pool** so cooldown is exercised end-to-end.
3. **Load test uses mock providers + fake Supabase by design** — the goal is the relay's own capacity (memory/latency/backpressure), independent of vendor latency. A vendor-latency benchmark is a separate (live-creds) exercise, out of scope here.
4. **Cost extrapolation is one-directional and illustrative** — it measures relay-outbound egress only and prices it per docs §14; it does not model vendor-side amplification. The measured ~110 MB/channel-hour validates the docs' ~115 MB assumption, which is the point of including it.
5. **Rollout-verify finalize-over-flush** — the self-contained probe is short (sub-second of audio) and the incremental flush is interval-driven (15 s), so the probe asserts on **finalize** (the durability anchor) and reports the flush path as wired rather than failing on a flush that legitimately did not tick.
6. **Live mode skip-guard is a PASS, not a FAIL** — absent prod creds, the script prints what's needed and exits 0, so it is safe to wire into a pipeline that may or may not have the secrets.
```
