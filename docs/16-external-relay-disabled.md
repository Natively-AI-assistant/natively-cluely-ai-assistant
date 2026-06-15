# 16 — External STT Relays Temporarily Disabled (Railway-only mode)

**Change type:** Operational simplification (NOT a rollback). One master feature flag forces all
STT traffic back through the existing Railway server. **No relay code, migrations, or architecture
removed** — everything is preserved and dormant, re-enabled by flipping one flag.

**Rationale:** Current Railway egress cost is low enough that maintaining two external VPS relays
isn't justified yet. The relay infrastructure is a future investment that stays in the repo.

**Default state:** `STT_EXTERNAL_RELAY_ENABLED=false` → external US/Asia relays bypassed.

---

## A. Files changed

| File | Change |
|------|--------|
| `natively-api/server.js` | **Additive only (726 insertions, 0 deletions).** Added the `STT_EXTERNAL_RELAY_ENABLED` master flag, seeded it into `sttRelayRuntime`, gated `selectRelay` behind it (OFF → forced `target:'railway'`), gated background `/healthz` probing behind it, exposed it in `/v1/stt/relays` + `/admin/stt-relays`, and made it runtime-flippable via `/admin/stt-relays/control`. |
| `natively-api/tests/stt-external-relay-bypass.test.mjs` | **NEW** — 11 tests proving the bypass (offline source checks + live integration: OFF→Railway, ON→relay). |
| `natively-api/tests/stt-session-endpoint.test.mjs` | `RELAY_ENV` now sets `STT_EXTERNAL_RELAY_ENABLED:'true'` (these tests exercise relay routing). |
| `natively-api/tests/stt-relays-routes.test.mjs` | Same `RELAY_ENV` addition + updated the admin-shape + source assertions for the new flag. |
| `natively-api/tests/stt-quota-lease.test.mjs` | Same `RELAY_ENV` addition (the lease only applies to relay sessions). |

**Client (Electron): intentionally NOT changed.** The server-side switch is authoritative — when
external relays are off, `/v1/stt/session` returns the Railway URL as `relay_ws_url` with no relay
fallback, so the client's `buildFallbackChain` collapses to `[RAILWAY_URL]` and it connects directly
to Railway regardless of its own `regionalSttRelayEnabled` flag (which itself already defaults false).
Defense in depth, no client release required.

## B. Relay code PRESERVED (dormant, not removed)

All of the following remain in the repository, fully intact:

- `packages/stt-relay-core/` — the entire shared core (token sign/verify, selection, health, provider
  pools/router, billing math, etc.) — **277 tests still pass, untouched.**
- `services/stt-relay/` — the standalone relay service — **106 tests still pass, untouched.**
- `migrations/003_stt_durable_billing.sql` + `004_stt_quota_lease.sql` — **kept** (25 logic tests pass).
- `server.js`: `signSessionToken`, `selectRelay`, `createRelayHealthTracker`, `stt_reserve_session`
  wiring, `GET /v1/stt/relays`, `GET /admin/stt-relays`, `POST /admin/stt-relays/control`,
  `STT_RELAY_ENABLE_PERCENT`, `STT_SESSION_TOKEN_SECRET`, `STT_QUOTA_LEASE_ENABLED`, the reaper — all present.
- The rollout framework, relay telemetry (`[STTEvent]`/Axiom), and relay config structures — all present.

## C. Relay code BYPASSED (the exact short-circuits)

1. **Routing decision** (`server.js` `/v1/stt/session`): `selectRelay({...})` is now only called when
   `sttRelayRuntime.external_relay_enabled` is true. When false, the selection is the literal
   `{ target: 'railway', reason: 'external_relay_disabled', bucket: -1 }`. → relay URLs ignored,
   selection ignored, health ignored for routing. The downstream code already fully supports
   `target === 'railway'` (it skips the quota lease, returns the Railway URL, emits a railway-mode event).
2. **Background health probing**: `startBackgroundChecks()` is gated on the master switch, so no
   `/healthz` fetches or health-change alerts fire for dormant VPS relays. (The tracker object stays
   instantiated and available to the admin routes — just not polling.)
3. **Fallback-rate accounting**: `external_relay_disabled` is in the `railwayReasons` set, so these
   deliberate-Railway creates are never miscounted as "unhealthy relay fallback" in telemetry.

## D. Runtime flow BEFORE this change (with relays enabled)

```
Desktop App
  → Railway  POST /v1/stt/session  (auth, quota, selectRelay → us|asia)
  → App connects WS to  us-relay / asia-relay  (external VPS hop)
  → Relay  → Deepgram → Google STT → ElevenLabs
  (fallback ladder: same relay → alternate relay → Railway)
```

## E. Runtime flow AFTER this change (`STT_EXTERNAL_RELAY_ENABLED=false`, the default)

```
Desktop App
  → Railway  POST /v1/stt/session  (auth, quota, forced target='railway' — NO selectRelay)
  → App connects WS to  Railway /v1/transcribe   (NO external relay hop)
  → Railway  → Deepgram → Google STT → ElevenLabs
```

The active transcription pipeline — **Deepgram Pool → Google Chirp fallback → ElevenLabs fallback** —
is **unchanged**: `/v1/transcribe` is byte-for-byte untouched (server.js diff is additive, 0 deletions),
and no Deepgram/Google/ElevenLabs logic was modified.

## F. Exact env variables required

### To run Railway-only (the new default — nothing to set)

`STT_EXTERNAL_RELAY_ENABLED` **defaults to false** when unset. So in the simplest case you set
**nothing** and all STT runs through Railway. If you want to be explicit:

```
STT_EXTERNAL_RELAY_ENABLED=false
```

These remain dormant (kept, ignored for routing while the master switch is off):
`STT_RELAY_US_URL`, `STT_RELAY_ASIA_URL`, `STT_RELAY_ENABLE_PERCENT`, `STT_RELAY_FORCE_REGION`,
`STT_RELAY_KILL_SWITCH`, `STT_SESSION_TOKEN_SECRET`, `STT_QUOTA_LEASE_ENABLED`, the health knobs.
They do not need to be unset — leaving them configured is harmless.

### Precedence (master switch is the top gate)

```
STT_EXTERNAL_RELAY_ENABLED=false   →  Railway only (ignores everything below)
STT_EXTERNAL_RELAY_ENABLED=true    →  then: kill_switch → enable_percent → force_region → geo → health
```

## G. How to RE-ENABLE the VPS relays later

Two ways:

**1. Permanent (env + restart) — the intended path:**
```
# On the Railway control plane:
STT_EXTERNAL_RELAY_ENABLED=true
STT_RELAY_US_URL=wss://us-relay.natively.software/v1/transcribe
STT_RELAY_ASIA_URL=wss://asia-relay.natively.software/v1/transcribe
STT_RELAY_ENABLE_PERCENT=<ramp 1→100 per docs/13>
# (STT_SESSION_TOKEN_SECRET must already match the relays)
```
Restart the service. Background health probing re-arms automatically. Then ramp
`STT_RELAY_ENABLE_PERCENT` per the staged rollout in `docs/13-rollout-checklist.md`.

**2. Temporary runtime flip (no redeploy) — for a live test:**
```
curl -X POST https://api.natively.software/admin/stt-relays/control \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"external_relay_enabled": true}'
```
Routing switches to relays on the next session-create. Note: a runtime flip does **not** auto-start
the background `/healthz` poller (that arms at boot) — for a sustained re-enable, use the env path so
health tracking is active. Runtime overrides are not persisted; a restart reverts to the env value.

**Verify it's back on:**
```
curl https://api.natively.software/v1/stt/relays -H "Authorization: Bearer $KEY"
# → { "external_relay_enabled": true, "relays": [...], ... }
```

---

## Verification (this change)

- `node --check server.js` → PASS; `server.js` diff = **726 insertions, 0 deletions** (`/v1/transcribe` untouched).
- Control-plane STT suites (incl. new bypass): **75/75 pass** (live integration against Supabase).
- Core **277/277**, relay service **106/106**, migrations **25/25**, offline regression **56/56** — all unchanged.
- `typecheck:electron` clean (client unmodified by this task).
- Live proof (integration tests): with `STT_RELAY_US_URL` + `STT_RELAY_ENABLE_PERCENT=100` configured but
  the master switch OFF, `/v1/stt/session` returns `selected_region:'railway'` + the Railway URL; flipping
  the switch ON returns `selected_region:'us'` + the relay URL. The switch is provably the top gate.
