# Pre-Migration Review Findings — `/v1/transcribe` STT Path

> Companion to `00-current-server-audit.md`. Produced by independent code review of
> `natively-api/server.js` (focus: WS handler ~4186–6139 + supporting infra),
> `natively-api/migrations/001/002`, and `electron/audio/NativelyProSTT.ts`.
> These findings are **binding requirements** on the relay migration:
> the MUST-PRESERVE list is the client-compatibility contract; the MUST-FIX list
> enumerates weaknesses the new design must not replicate.

## Findings

| # | Sev | Title | Evidence | Migration impact |
|---|-----|-------|----------|------------------|
| 1 | CRITICAL | Full API key embedded in `sk` session id leaks into ~88 log lines and Telegram alerts | `server.js:5935`, `:4754` | Relays multiply log sinks; derive session ids from hash/key-id, audit alert payloads |
| 2 | CRITICAL | Mic/system pairing race double-bills meetings >5min when system closes first (`recentSystemChannels` set at auth, never refreshed at close) | `server.js:6066-6077`, `:5947-5950` | In-memory pairing is structurally broken across relay instances; move pairing state to control plane/DB |
| 3 | HIGH | Mic-only billing guard bypassable via heartbeat (<30s) system sessions | `server.js:6066-6077`, `:6109`, `:1965` | Bill mic by *overlap with a billed system session*, not recent presence |
| 4 | CRITICAL(cost) | Google rolling-recognize re-sends each audio second in up to ~16 overlapping 8s windows (500ms roll) | `server.js:1073-1076`, `:1254-1267` | ~30 MB/min egress at 16k mono vs 1.92 MB/min live; replace with incremental-suffix submission |
| 5 | HIGH | Billing only at socket close — crash/OOM loses entire in-flight session usage (up to 4h × N sessions) | `server.js:6078-6124`, `:122-127` | Relay must checkpoint billable seconds incrementally with idempotent upsert |
| 6 | HIGH | Usage write failures silent + non-idempotent; `increment_transcription_minutes` RPC uncapped and missing from migrations | `server.js:1966-1977`, `:6118-6122`, `migrations/001:24-51` | New schema must be migration-managed, idempotent (session-id keyed), alert on failure |
| 7 | HIGH | Quota TOCTOU: budget captured at auth from ≤30s-stale cache; N concurrent sessions overrun by N× | `server.js:5919`, `:5969`, `:4391-4400` | Control plane needs atomic quota reservation/lease |
| 8 | HIGH | `getIP` trusts `x-envoy-external-address` — Railway-specific, spoofable off-Railway | `server.js:1565-1573` | Relay proxy-trust must be deployment-config-driven |
| 9 | MEDIUM | Transcript content (user speech, 80–100 chars) and raw IPs logged at info level | `server.js:5205`, `:1130`, `:5676`, `:4349` | Debug-gate transcript logs; hash IPs on relays |
| 10 | MEDIUM | No provider-socket backpressure bound (`bufferedAmount` never checked on Deepgram/EL sends) | `server.js:4856`, `:5541-5554` | Primary OOM vector on a forwarding relay; cap + shed |
| 11 | MEDIUM | Replayed audio double-counts Deepgram billing seconds + duplicate transcripts | `server.js:5192`, `:5106-5112`, `:4432-4436` | Track billed-through cursor; exclude replayed ranges |
| 12 | MEDIUM | Session map entries leak on all-providers-down rejection path (cleanup gated on `sessionKey` set after rejection) | `server.js:5943-5958`, `:6032-6040` | Clean maps on every rejection path |
| 13 | MEDIUM | `switchToFallback` doesn't tear down in-flight shadow probes | `server.js:4745-4806` | Tear down probes at top of failover |
| 14 | MEDIUM | Egress amplifiers: accepts 8–48kHz × 1–2ch with no transcoding (6× vs 16k mono), dual streams 2×, EL base64+JSON ~+37% | `server.js:5961-5962`, `:5541-5553` | Normalize to 16kHz mono at relay ingress (flag-gated) |
| 15 | MEDIUM | Single-process failure domain: STT CPU + `uncaughtException→exit(1)` shared with payments/AI | `server.js:115-127`, `migrations/002:1-17` | The migration premise; make isolation an acceptance test |
| 16 | LOW | Auth-frame `channel` unvalidated (log injection, `:`-identity parse quirk) | `server.js:5886-5888`, `:946-948` | Whitelist `channel ∈ {system,mic,default}` |
| 17 | LOW | Deepgram connect-timeout strikes pool health after session close (no `authed` guard) | `server.js:4939-4962` | Guard timer body |
| 18 | LOW | Trial billing last-resort path is read-modify-write race | `server.js:1936-1951` | Single atomic path, no fallback ladder |
| 19 | LOW | Client reconnect flush burst (≤500 chunks sync) + server replay = thundering burst; existing storm dampers good — port them all | `NativelyProSTT.ts:525-541`, `server.js:577-592`, `:4284-4288` | Rate-limit flush; preserve every damper |
| 20 | LOW | Global WS ceiling counts handshaking sockets; per-IP cap 5 tight for NAT | `server.js:4218-4225`, `:4211-4216` | Per-region ceilings, separate pre-auth budget |

## MUST-PRESERVE behaviors (client-compatibility contract)

The Electron client (`NativelyProSTT.ts`) hard-codes all of these:

1. **Auth handshake**: first WS message JSON `{ key | trial_token, sample_rate, language, language_alternates, audio_channels, channel }`; subsequent messages raw binary LINEAR16 PCM. `language:'auto'` triggers auto-detect. Trial sentinel key swaps to `trial_token` field (`NativelyProSTT.ts:342-347`).
2. **Transcript JSON shape**: interim `{ text, is_final:false, confidence }`; final `{ text, full_text:<cumulative>, is_final:true, confidence }` (`full_text` omitted on interims). Client keys on `msg.text`/`msg.is_final`/`msg.confidence` (`NativelyProSTT.ts:431-437`).
3. **Status vocabulary**: `{ status:'connected', provider, quota }` — gates `isConnected` + buffer flush (`NativelyProSTT.ts:392`); `{ status:'provider_switched', from, to, reason, has_replay }`; `{ language_detected:<bcp47> }` — client reconnects with the language pinned (send at most once/session).
4. **Error vocabulary (exact strings)**: FATAL on client: `auth_timeout`, `invalid_key_format`, `trial_expired`, `transcription_quota_exceeded` (`NativelyProSTT.ts:373-378`). Also: `auth_required`, `auth_must_be_json`, `invalid_trial_token`, `trial_not_found`, `trial_ended`, `ip_blocked`, `all_stt_providers_down`, `chunk_too_large`, `session_byte_budget_exceeded`, quota error carries `resets_at`. Any other error/close stays retryable.
5. **Close codes**: 1001 `server_restart` (reconnect immediately); 1008 too-many-connections/quota cutoff; 1013 at-capacity; 1009 auth-queue overflow.
6. **Reconnect takeover**: new connection with same `key:channel` terminates prior socket; old socket's close must not wipe new session's map entries.
7. **Billing semantics**: system + `default` bill; mic free when paired with system (fix mechanism, keep semantics); <30s sessions with no tracked speech free; paid = `max(1, round(seconds/60))` minutes; trial = exact seconds vs 600s cap; Deepgram bills speech duration (`p.duration` finals); fallback bills wall-clock incl. flap windows (C6) with pre-failover wall-clock substitute (P2-4).
8. **Mid-session quota watchdog**: cut at captured budget with `transcription_quota_exceeded` + close 1008.
9. **Replay/pre-buffer**: 30s preBuffer, full replay on failover, downtime-sized replay on reconnect, pre-auth chunk queue (≤200) drained into replay (P0-1); EL open→`session_started` gap flush (C1).
10. **Keep-alives**: 25s client ping; Deepgram `KeepAlive` JSON idle ≥5s; EL real-silence chunks at 10s idle; 5s auth timeout.
11. **Provider chain + error classification**: deepgram→googleSTT→elevenlabs forward-only; Deepgram upgrade HTTP-status classes (400=failover w/o pool strike; 401/403=rotate; 402=disable till midnight UTC); close-code taxonomy (1011 probe/fast-reconnect, late-1006 idle, 1000-idle reconnect); multi-identity strike gating with channel-suffix strip (`server.js:890-971`) — prevented a real global outage, port exactly.
12. **Input clamps**: sample_rate 8000–48000, channels 1–2, language regex, 64KB frame cap, per-session byte budget, per-IP + global ceilings.

## MUST-FIX in new design (do not carry over)

1. Raw API key as session identifier in logs/alerts (F1) — key-id/hash.
2. In-memory single-process pairing/billing state incl. close-ordering double-bill (F2) and heartbeat bypass (F3) — pairing/quota state to control plane.
3. Bill-only-at-close durability (F5) — incremental idempotent checkpoints.
4. Silent/non-idempotent/uncapped usage writes; missing STT migration (F6).
5. Quota TOCTOU across concurrent sessions (F7) — atomic lease.
6. Google rolling 16× amplification (F4) — incremental submission.
7. No provider-side backpressure bound (F10).
8. Replay double-billing / duplicate transcripts (F11) — billed-through cursor.
9. Railway-coupled `getIP` trust order (F8) — config-driven proxy trust.
10. Transcript text + raw IPs at info level (F9).
11. Accepting 48kHz stereo end-to-end (F14) — normalize at ingress.
12. Map leaks on rejection paths (F12); probe survival across failover (F13).
13. Shared failure domain with payments/AI (F15) — isolation acceptance test.
