# Phase 2 — STT Core Extraction (`packages/stt-relay-core`)

**Date:** 2026-06-13
**Status:** Complete — all gates green
**Inputs (binding):** `docs/00-current-server-audit.md` (§10.2 extraction map), `docs/00b-pre-migration-review-findings.md` (MUST-PRESERVE §1–12, F-findings), `docs/01-target-stt-relay-architecture.md` (§4 shared core).
**Strategy:** **DUPLICATE, not move.** `natively-api/server.js` is byte-for-byte untouched (verified, §5 below) — zero Railway risk. The core package carries faithful copies; the relay binary (Phase 5) consumes the core; parity is enforced mechanically by `tests/parity.test.mjs` reading server.js at test runtime.

Package: `natively-api/packages/stt-relay-core/` — `@natively/stt-relay-core`, private, pure ESM JS, node ≥20, **zero new runtime deps** (`@google-cloud/speech` is an optional peer, lazy-imported). No `process.env` reads at module load, no cross-instance singletons (two pools coexist — tested), no Supabase/Telegram calls (injectable `onAlert`/`logger` hooks only).

---

## 1. Module table

| Core file | server.js source (commit `6b61623`) | Behavior notes |
|---|---|---|
| `src/dnsCache.js` | 76–113 | `createDnsCache()` (cachedLookup, 30s TTL, all/family keying) + `createKeepAliveAgent()` (keepAlive 30s, maxSockets 50). Injectable `now()`/`lookup()`. |
| `src/circularBuffer.js` | 990–1040 | `CircularBuffer` verbatim — write/wrap/oversized-tail/`getLast`/`bytesAvailable`/monotonic `totalWritten`. No `clear()` (server.js drops the reference; preserved). |
| `src/pcmEnergy.js` | 1042–1055, 1078 | `pcmRmsEnergy` verbatim (int16 LE RMS, odd-byte floor) + `MIN_AUDIO_RMS=230`. |
| `src/deepgramPool.js` | 517–592 (+3431–3434) | `createDeepgramPool()`: round-robin w/ exclude, per-key 2-strike/≥2-identity (or ≥5 single-identity) → 5-min cooldown, channel-suffix strip, `markKeyHealthy`, side-effect-free `hasAvailableKey`, `scheduleReconnect` spreader (pending-count × jitter, factor cap 20, default 800/400). Injectable `now()`/`random()`/`setTimeoutFn`. |
| `src/deepgramRouter.js` | 594–632, 763–798, 4838–4853 | `NOVA_2_ONLY_LANGS` (21 langs), `pickDeepgramModelLang` (auto/multi→nova-3 multi; deny-list→nova-2 bare ISO; en-*→en-US), `buildDeepgramUrl` (exact param set/order/values), `AUTO_DETECT_LANGS`, `normaliseDetectedLang`, `CHIRP2_LANG_MAP`/`CHIRP2_UNSUPPORTED`/`toChirp2Lang`/`CHIRP2_AUTO_DETECT_LANGS`. Production-log forensics — verbatim. |
| `src/elevenLabsPool.js` | 634–679 (+3435–3438) | `createElevenLabsPool()` — same shape as Deepgram pool but **without** the ≥5 single-identity gate (server.js doesn't have it for EL; preserved exactly). |
| `src/providerHealth.js` | 807–825 (STT slots), 884–978; classifiers 1234–1250, 4860–4934 (decision table), 5157–5162, 5628–5650 | `createProviderHealth()`: `markFailed` (transient 3-strike/≥2-identity w/ channel-suffix strip + 5-min auto-recover; out_of_credits→midnight UTC; auth_error→permanent; permanent-lock no-downgrade; reason-guarded restore timers), `markHealthy`, `msUntilMidnight`. Plus pure classifiers: `classifyDeepgramErrorFrame`, `classifyDeepgramHttpStatus` (400/402/401-403/other), `classifyGoogleSttError` (gRPC codes + transient-pattern no-strike), `classifyElevenLabsMessage`. The multi-identity gating prevented a real global outage — ported exactly. Embedding/AI slots stay on Railway. |
| `src/sttPicker.js` | 3428–3463 | `createSttPicker()`: `pickSTTProvider` + forward-only `pickNextSTTProvider` (deepgram→googleSTT→elevenlabs→null), key-availability mirrored. |
| `src/googleRollingSession.js` | 1057–1291 (+173–176 client construction) | `createGoogleSTTSession()`: 8s window / 15s ring / 400ms min / 500ms roll / STABLE_ROLLS=2 / RMS 230 gate / MAX_IN_FLIGHT=2 / seq-staleness(−5) / commitEpoch / low-conf-short reject / overflow commit / silence→final / 8s recognize timeout w/ cleanup (H11) / 1MB partial drop / markHealthy on first transcript (NOT creation) / gRPC classification. `createGoogleSpeechClient()` **lazy-imports** `@google-cloud/speech` — core loads & tests pass without it installed. Injectable speechClient/timers/logger/health hooks. |
| `src/elevenLabsClient.js` | 5457–5615, 6047, 4311–4312 | `buildElevenLabsUrl` (scribe_v2_realtime, pcm_<rate>, vad, lang detection, bare-ISO pin / omit on auto), `xi-api-key` header, `frameAudioChunk` (4KB base64 JSON sub-chunks, commit:false), `buildFinalCommitFrame` (empty + commit:true), `buildSilenceKeepaliveFrame` (100ms REAL zero PCM — empty frames don't reset EL's 20s idle timer), `isSessionStarted` gate, `parseTranscriptMessage` (partial/committed, conf pinned 1.0, lang fallback chain), constants (12s connect, 10s keepalive, 8s idle, EL_1000_CAP=3). Lifecycle/state machine stays in the Phase 5 session layer. |
| `src/transcripts.js` | 5206–5211, 1131–1137, 5677–5683, 4991/1287/5537, 4785–4793, 5075/5420/5665, error sites, 7636/4214/4223/5858/4399 | The EXACT client contract: `makeInterim` (**`full_text` key absent**, wire-identical to server.js's `undefined`-drop), `makeFinal`, `makeConnected`, `makeProviderSwitched`, `makeLanguageDetected`, `makeError` (message omitted when absent), `makeQuotaExceeded` (+`resets_at`), `makeAllProvidersDown` (no `reason` at auth-time, `reason` mid-session — matches both server.js sites). `ERR` (16 exact strings), `CLIENT_FATAL_ERRORS` (matches NativelyProSTT.ts:373-378), `CLOSE` 1001/1008/1009/1013 + reasons. |
| `src/metrics.js` | 4372–4379, 6085–6109, 1962–1966, 1950; field set from docs/01 §6.1 | `createSessionMetrics()` (full §6.1 field set), `createBillingState()`, `liveBillableSeconds` (watchdog estimator), `computeCloseBilling` (Deepgram `p.duration` finals + C6 flap accumulation + P2-4 pre-failover substitute + pure-wall fallback + `shouldBill` gate), `accumulateFallbackOnDeepgramReconnect` (C6), `paidMinutesForSeconds` (<30s free; `max(1, round(s/60))`), `trialSecondsForSeconds` (exact seconds; 600s cap is RPC/DB-side). |
| `src/safeLog.js` | 1579–1582 (hashIP verbatim) + F1 (new) | `hashIP`, `hashIdentity` (sha256 16-hex prefix), `redactToken` (first6…last4, ≤12-char fully masked), `makeSessionId` (`<hash>:<channel>` — keeps the channel suffix so identity-strip logic works on safe ids). Never returns raw secrets. |
| `src/backpressure.js` | 4357–4363 (verbatim) + F10 (new) | `shouldDropInterim` (strict `>` 1MB; finals never gated), `checkProviderBuffer` (NEW — send/drop/kill against provider-socket `bufferedAmount`). |
| `src/validate.js` | 5961–5965, 5779, 5990, 5982, 5856, 245 + F16 (new) | `clampSampleRate` [8000,48000]/16000-default, `clampChannels` [1,2]/1, `resolveLanguage` (regex copied verbatim; `'auto'` flag), `isFrameTooLarge` (strict `>` 64KB), `computeMaxSessionBytes` (2× 4h), `computePreBufferBytes` (30s), `AUTH_QUEUE_MAX_FRAMES=200`, `validateChannel` (NEW — whitelist). |
| `src/index.js` | — | Re-exports (112 named exports). |

Not extracted in this phase (deliberately — they are session-orchestration glue that Phase 5 composes from the above, per docs/01 §4): `switchToFallback`, shadow-probe state machines, `connectSTTProvider` lifecycle wiring, auth handshake, close handler. Their decision logic (classifiers, replay sizing inputs, billing math, message shapes, close-code constants) IS in the core; the stateful closure orchestration is the relay binary's job.

## 2. Documented deviations (everything else is byte-identical logic)

| ID | Module | Deviation | Justification |
|---|---|---|---|
| **F1** | `safeLog.js` | Session ids are hash-derived (`makeSessionId`); helpers never return raw keys/IPs | 00b finding #1 (CRITICAL): raw API key in `sk` leaks into ~88 log lines + alerts. The core is new code — allowed fix per phase brief. `hashIP` itself is the verbatim server.js construction. |
| **F10** | `backpressure.js` | NEW `checkProviderBuffer(ws, capBytes)` → send/drop/kill | 00b finding #10 (MEDIUM): server.js never bounds provider-socket `bufferedAmount` — primary OOM vector on a forwarding relay. Client-side interim drop is preserved verbatim alongside. |
| **F16** | `validate.js` | NEW `validateChannel` whitelisting `channel ∈ {system, mic, default}`; junk → `'default'` + `valid:false` flag | 00b finding #16 (LOW): unvalidated channel = log injection + `:`-identity parse quirk. Fallback matches the server's default for a missing field. |
| **F17** | note only (README + here) | Not code in the core: server.js's Deepgram connect-timeout body (4939–4962) strikes pool health with no `authed` guard. The core doesn't own that timer; the Phase 5 session layer MUST gate the timer body on session liveness before calling `markKeyFailed`/`markFailed`. | 00b finding #17 — documented, deferred to the layer that owns the timer, as instructed. |
| DI (non-behavioral) | all modules | Factories + injected `now()/random()/timers/logger/onAlert/speechClient` instead of module singletons, env reads, `tgAlert`, and the global `speechClient` | Phase constraint (two pools must coexist; no env at import; no Supabase/Telegram in core). Default values match server.js exactly; tests cover two-instance independence. |
| Omission (non-behavioral) | `providerHealth.js` | `markHealthy` drops server.js's `gemini429Tracker.delete(provider)` line | That tracker is AI-chat state that stays on Railway; STT slots never appear in it. No STT behavior change. |

## 3. Test inventory + results

`cd natively-api && node --test packages/stt-relay-core/tests/*.test.mjs` → **197/197 pass, 0 fail** (Node v25, also satisfies the package's node>=20 floor). No network, no live keys — injectable clocks/mocks throughout.

| Suite | Tests | Covers |
|---|---|---|
| `circularBuffer.test.mjs` | 12 | write/wrap/read-all, oversized-tail, byte accounting, exact-fill writePos reset, 30s-prebuffer realism, no-`clear()` surface |
| `pcmEnergy.test.mjs` | 6 | silence=0, known sine RMS (A/√2), DC, odd-byte floor, 230-threshold gate |
| `deepgramPool.test.mjs` | 16 | dedupe, rotation, exclude, cooldown expiry boundaries, single-identity immunity (2–4 strikes), ≥5 single-identity cool, legacy no-sk, spreader delay math/jitter bounds/factor cap 20/pending decrement, two-pool independence |
| `deepgramRouter.test.mjs` | 14 | full deny-list matrix (+ regional variants, case), en-* normalization, auto/multi, URL params for rates/channels (exact string), chirp_2 tables, `normaliseDetectedLang` |
| `providerHealth.test.mjs` | 19 | classification matrix (transient/out_of_credits/auth/HTTP/gRPC/EL), multi-identity gating (single identity can't kill pool), channel-suffix strip, reason-guarded restore timers, no-downgrade lock, msUntilMidnight, instance independence |
| `sttPicker.test.mjs` | 14 | chain order, skip-unhealthy, key-cooldown skip, all-down→null, forward-only, live health flips |
| `transcripts.test.mjs` | 12 | exact JSON shapes incl. `full_text` key ABSENT on interim (wire-byte equality with server.js's `undefined`), all 16 error constants, fatal set, close codes/reasons, conditional `message`/`reason`/`resets_at` keys |
| `metrics.test.mjs` | 17 | billable matrix (<30s free, 31s→1min, 91s→2min, floor/round), trial exact seconds + 600 cap constant, live estimator, close billing (pure DG / wall-clock / C6 flaps / P2-4 substitute / fallback-under-30s bills), §6.1 field set |
| `backpressure.test.mjs` | 8 | 1MB strict-`>` drop, custom limits, F10 send/drop/kill bands + edge values |
| `validate.test.mjs` | 9 | clamp matrices (incl. NaN/string/Infinity), regex source equality, F16 whitelist (incl. injection strings), 64KB strict-`>`, byte-budget/prebuffer formulas |
| `safeLog.test.mjs` | 8 | hashIP parity vs crypto, no-raw-input-ever sweep (substring scan), short-token full mask, sessionId channel-suffix compatibility |
| `elevenLabsClient.test.mjs` | 11 | URL pinned/auto, header, 4KB framing + base64 round-trip exactness, final-commit frame, real-zero keepalive sizing per rate, session_started gate, transcript parsing + lang fallback chain, timing constants |
| `googleRollingSession.test.mjs` | 18 | windowing math (window bytes below/at cap), roll cadence, MIN_BYTES gate, in-flight cap=2, RMS gate (silence never reaches GCP), partial/stability-final/overflow/silence-final flows, request shape (chirp_2/us-central1/LINEAR16), low-conf reject, backpressure partial drop, lang detect once, gRPC fatal/transient classification, cleanup commit + dedup — all against a mock client |
| `parity.test.mjs` | 33 | see §4 |

**Regression gates:**
- `node --check` on all 16 src files + 14 test files: pass.
- Existing offline suites `node --test tests/unit-fixes.test.mjs tests/flash-model-picker.test.mjs`: **56/56 pass** (expected 56).

## 4. How parity is enforced

`tests/parity.test.mjs` opens `natively-api/server.js` **at test runtime**, extracts the literal tables/constants/blocks via anchored regexes, and asserts the core's copies match:

- tables: `NOVA_2_ONLY_LANGS`, `AUTO_DETECT_LANGS` (order-sensitive — `find()` semantics), `CHIRP2_LANG_MAP`, `CHIRP2_UNSUPPORTED`
- thresholds: key-pool strike gates (incl. EL's missing ≥5 gate), spreader 800/400/20, health 3-strike/2-identity/5-min, RMS 230, window/roll/stable/in-flight/timeout constants, EL 12s/10s/8s/100ms/cap-3, 1MB backpressure, 64KB frame, 200-frame auth queue, 4h TTL, 2× byte budget, 30s prebuffer, DNS 30s TTL
- structures: Deepgram listen params (names **and** order), transcript/status JSON shapes (incl. `full_text: … : undefined` on interim), close-code call sites, billing math bodies (C6/P2-4/shouldBill/liveBillable), clamps + `WS_LANG_RE` source equality, classifier regexes, gRPC codes, hashIP/msUntilMidnight bodies, every `ERR` string present verbatim
- the `extract()` helper **throws** when a pattern is missing, so a refactor that moves/renames a block fails loudly rather than passing silently.

Any future edit to these regions of server.js breaks the suite → the core must be consciously re-synced (or the divergence documented). This is the permanent merge gate per docs/01 §16.5 until conformance suites are retargeted in Phase 9.

## 5. server.js untouched — verification

```
$ git -C natively-api status --short
?? packages/
```

Only the new `packages/` tree is untracked; `server.js` (and everything else) is clean. The parity suite additionally asserts the live file still contains the audited monolith markers.

## 6. Consumption plan

1. **Now (Phase 2):** core sits beside server.js, consumed by nothing. server.js keeps its inline copies — the deployed Railway path is unchanged and remains the emergency fallback (docs/01 §16.1).
2. **Phase 4:** remaining MUST-FIX integrations land inside the core (F4 incremental Google submission flag, F11 billed-through cursor, F12/F13 session-layer fixes) per docs/01 §4 notes.
3. **Phase 5:** the relay binary imports `@natively/stt-relay-core` for admission, provider chain, metering shapes, and the client contract; composes the session orchestration (connect/failover/probes/close) from the core's classifiers + builders, honoring the F17 note.
4. **Phase 9:** the existing STT integration suites (`stt-comprehensive`, `stt-fixes`, `stt-health-system`, `key-pool`) are retargeted at the relay — the behavioral conformance gate on top of this package's unit parity.
5. **Post-rollout (optional, after 100% + 2-week soak only):** server.js's `/v1/transcribe` may be re-pointed at the core. Until then it is intentionally duplicated; `parity.test.mjs` is the drift alarm.
