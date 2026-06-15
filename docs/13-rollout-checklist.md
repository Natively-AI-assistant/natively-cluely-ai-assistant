# Phase 13 — STT Relay Migration: Final Wiring Verification + Rollout Checklist

**Date:** 2026-06-13
**Status:** Code COMPLETE + verified (13/13 wiring checks green, 480 tests). Awaiting the manual
operational steps (VPS / DNS / secrets / migration / reaper / Railway env / relay deploy) — see
**Blocked-on-access** below.
**Inputs (binding):** `docs/01` §15 (rollout plan) / §16 (migration safety invariants),
`docs/04` §3.3 (admin kill switch), `docs/06` §7 (reaper), `docs/07` (client flags),
`docs/10` (deploy runbook), `docs/12` (final review — MEDIUM-1/3/4 + the F7 gap).

---

## Current state (one paragraph)

**Everything that can be code-blocked is done, reviewed, and green.** The control plane
(`/v1/stt/session`, `/v1/stt/relays`, `/admin/stt-relays`, `/admin/stt-relays/control`) ships in
`natively-api/server.js` as **540 additive insertions, 0 deletions** — the legacy `/v1/transcribe`
WS path is byte-for-byte untouched and remains the always-on emergency fallback. The standalone
relay (`services/stt-relay`) boots, serves `/healthz`/`/readyz`/`/metrics`, verifies HMAC session
tokens offline, runs the full provider chain via the shared `packages/stt-relay-core`, flushes/finalizes
billing idempotently to Supabase, and drains gracefully on SIGTERM (all verified live in this phase).
The Electron client integration is flag-gated and **default OFF** — with the flag off the app is
byte-for-byte the legacy direct-Railway behavior. Migration `003_stt_durable_billing.sql` defines the
tables, the idempotent RPCs, the reaper, and the GRANTs, and re-exports the legacy
`increment_transcription_minutes` without changing it. **All safe defaults are in place**
(`STT_RELAY_ENABLE_PERCENT=0`, kill switch off-but-instant, 16k-mono clamps, Railway fallback always
present, client `regionalSttRelayEnabled=false`). What remains is purely **operational** and requires
credentials/infra access this repo cannot perform: provision 2 VPS, set DNS, generate+set the HMAC
secret, apply the migration, schedule the reaper, set the Railway env, deploy the relays — then walk
the staged percent ramp. **The CRITICAL billing-bypass defect found in Phase 12 is fixed and locked by
a regression guard; the F7 atomic quota lease is now BUILT (`migrations/004_stt_quota_lease.sql`,
`stt_reserve_session`), which LIFTS the former 25% STOP gate — the ramp can proceed to 100% once
migration 004 is applied (see §12).**

## Blocked-on-access (the team must do these by hand — NOT code-blockable)

These need credentials, infra, DNS, or deploy access. None can be completed from the repo:

1. **Provision 2 VPS** — Hetzner US (`us-relay`, 2 vCPU/4 GB) + Vultr/DO SGP (`asia-relay`, 2 vCPU/4 GB).
2. **Set DNS** — grey-cloud (DNS-only) A records `us-relay` / `asia-relay` → the VPS IPv4s.
3. **Generate + set the HMAC secret** — `STT_SESSION_TOKEN_SECRET`, byte-identical on both relays AND the Railway control plane.
4. **Apply migration `003_stt_durable_billing.sql`** to the prod Supabase project (SQL editor) — **BEFORE** deploying any relay (MEDIUM-3).
4b. **Apply migration `004_stt_quota_lease.sql`** (after 003) — activates the F7 atomic quota lease. Required to ramp past 25% (§12); the control plane degrades gracefully to the snapshot until it is applied, so it can be applied after the server deploys.
5. **Schedule the reaper** — pg_cron `stt_reconcile_abandoned` every 5 min, OR wire the control-plane sweep (MEDIUM-4). One of the two is a rollout prerequisite.
6. **Set the Railway control-plane env** — `STT_SESSION_TOKEN_SECRET`, `STT_RELAY_US_URL`, `STT_RELAY_ASIA_URL`, `STT_RELAY_ENABLE_PERCENT=0`, health knobs.
7. **Deploy the relays** — US + Asia, with the full env checklist (§7) and provider keys.
8. **(App release)** — ship the desktop build with the client relay flags OFF; enable server-side first.

---

## TASK 1 — Final wiring verification (13/13, with evidence)

All test commands below were run in this phase under Node v25.9.0. Counts are exact per-suite.
"file:line" refers to `natively-api/` for code and repo-root `docs/`/`electron/` where noted.

| # | What works / exists | Evidence (file:line or test) | Result |
|---|---|---|---|
| 1 | **Railway old `/v1/transcribe` still works (untouched)** | `git diff --numstat HEAD -- server.js` = **`540  0  server.js`** (540 insertions, **0 deletions**); handler `server.js:4737` + the guard comment `server.js:4201` ("byte-for-byte untouched and remains the fallback"). Offline regression: `node --test tests/unit-fixes.test.mjs tests/flash-model-picker.test.mjs` → **56/56 pass** (41 + 15). | ✅ |
| 2 | **New `/v1/stt/session` works** | `node --test tests/stt-session-endpoint.test.mjs` → **18/18 pass** (spawns the real control plane against the live `.env` Supabase; paid happy path verifies the signed token + clamps, percent=0→railway, 401/402 vocab). | ✅ |
| 3 | **Relay service works locally** | Booted: `STT_SESSION_TOKEN_SECRET=test REGION=us DEEPGRAM_API_KEY=fake PORT=8091 node src/index.js`. `curl /healthz` → `{"status":"ok","relay_id":"us-1","region":"us"}`; `curl /readyz` → `200 {"status":"ready"}`; `curl /metrics` → full JSON counters (`deepgram_keys_available:1`, `active_sessions:0`, `draining:false`). SIGTERM → drained + exited 0 (graceful). | ✅ |
| 4 | **App can use the new session flow** | `npm run build:electron` then `node --test electron/audio/__tests__/Relay*.test.mjs` → **44/44 pass** (RelaySessionResolve 20, RelayAuthFrameSelection 6, RelayFallbackLadder 9, RelayFlagGate 9). Covers session-create snake→camel mapping, request body, auth-frame selection. | ✅ |
| 5 | **App can fall back to Railway** | `RelayFallbackLadder.test.mjs`: asserts the chain walk relay → alternate → railway (advance after 2 same-relay fails; token-fatal immediate advance; terminal-rung stick; railway-strip only when `sttRailwayFallbackEnabled=false`). Part of the 44/44 above. | ✅ |
| 6 | **Feature flags can disable relays** | Server: `STT_RELAY_KILL_SWITCH` (`server.js:4216`, runtime `:4255`) + `STT_RELAY_ENABLE_PERCENT` default 0 (`server.js:4214`); `tests/stt-relays-routes.test.mjs` "control route: kill switch flips live → session endpoint returns railway → restore" passes (**20/20**). Client: Phase-7 unchanged-behavior test **`electron/audio/__tests__/RelayFallbackLadder.test.mjs:141`** ("flag OFF: resolver never called, connect() dials BACKEND_URL, legacy frame") — `maybeResolveRelayTarget()` returns false synchronously, `target` stays null. | ✅ |
| 7 | **Region selection works** | `node --test packages/stt-relay-core/tests/relaySelection.test.mjs` → **26/26**; `node --test tests/stt-relays-routes.test.mjs` → **20/20** (force_region, latency-probe lowest-RTT-wins / ignored-when-disabled, geo map, health override → alternate → railway). | ✅ |
| 8 | **Usage billing works** | Migration logic: `node --test migrations/__tests__/stt_billing_logic.test.mjs` → **15/15** (delta telescoping == old one-shot total across `[30…7199]`s; mic/system pairing refund; trial 600s cap; idempotent finalize). Relay billing: `services/stt-relay/tests/billing.test.mjs` → 5/5, incl. the **Phase-12 user_id regression guard** (`billing.test.mjs:41-42`: finalize row must carry `auth_type:'api_key'` + the durable UUID from `sub_id` — null = 100% billing loss). | ✅ |
| 9 | **Metrics are emitted** | `node --test services/stt-relay/tests/telemetry-fields.test.mjs` → **7/7** (session_summary fields, `usage_flush_failed`/`usage_finalize_failed` on retry-queue park, `auth_type:'api_key'`). Live `/metrics` scrape confirmed in #3. | ✅ |
| 10 | **Docs complete** | `docs/00, 00b, 01–12` all present (14 files: `00-current-server-audit`, `00b-pre-migration-review-findings`, `01-target-stt-relay-architecture`, `02-stt-core-extraction`, `03-relay-session-token`, `04-relay-selection`, `05-stt-relay-service`, `06-durable-stt-billing`, `07-client-integration`, `08-observability`, `09-cost-guards`, `10-deploy-regional-relays`, `11-testing-load-testing`, `12-code-review-security-reliability`) + this `13-rollout-checklist`. | ✅ |
| 11 | **Env examples complete** | `services/stt-relay/.env.example` carries all vars: identity (`PORT`,`REGION`,`RELAY_ID`,`PUBLIC_RELAY_URL`), `SUPABASE_*`, `STT_SESSION_TOKEN_SECRET(+_PREV)`, `DEEPGRAM_API_KEY(_1..5)`, `GOOGLE_CREDENTIALS_JSON`+`GCP_PROJECT_ID`, `ELEVENLABS_API_KEY(_1..5)`, obs (`AXIOM_*`,`SENTRY_DSN`,`POSTHOG_*`), caps (`MAX_*`,`PROVIDER_BUFFER_CAP_BYTES`), chain toggles, bandwidth guards (`REJECT_HIGH_BANDWIDTH_AUDIO`,`ALLOW_STEREO`,`ALLOW_48KHZ`), `TRUST_PROXY_HEADER`, `USAGE_FLUSH_INTERVAL_MS`, `EGRESS_WARN_GB`, `LOG_TRANSCRIPTS`, `SHUTDOWN_GRACE_MS`. | ✅ |
| 12 | **Deployment configs complete** | `services/stt-relay/Dockerfile` + `deploy/`: `docker-compose.example.yml`, `Caddyfile.example`, `nginx.example.conf`, `stt-relay.service`, `healthcheck.sh`, `setup-vps.sh`, `fly.us.toml`, `fly.asia.toml`. | ✅ |
| 13 | **Tests complete (480 total)** | core **277** + relay-service **106** + session-endpoint **18** + relays-routes **20** + migration **15** + electron-relay **44** = **480**. (Core suite is 277/277 when run isolated/sequentially; under heavy parallel load one fake-timer background-tick assertion in `relayHealth.test.mjs:326` can race — confirmed flaky-not-real: `node --test packages/stt-relay-core/tests/relayHealth.test.mjs` alone → **26/26**.) | ✅ |

**Bonus end-to-end proof (not in the 13 but run this phase):**
`node scripts/verify-stt-relay-rollout.mjs` → **9/9 PASS** (selection → token sign → relay boot → healthz
→ readyz → WS connect → token verify → real PCM fixture transcript → usage finalize/flush wired).
`node scripts/load-test-stt-relay.mjs --max=10 --duration=3` → tiers 1+10 zero errors, cost model validated.

---

## TASK 2 — Rollout checklist

> Conventions: `[ ]` = an action to take. `$ADMIN_SECRET` is the control plane's `x-admin-secret`.
> All admin calls hit the Railway control plane. "CP" = control plane (Railway). cwd for code commands
> is `natively-api/` unless noted. **No app redeploy is ever needed to roll back** (the kill switch +
> percent are runtime/env on the CP; the client already caches a Railway-terminated fallback chain).

### 1. Local validation checklist

Run from `natively-api/` (Node 20+). All four suites + both ops scripts must be green.

- [ ] **Core suite** — `node --test packages/stt-relay-core/tests/*.test.mjs` → expect **277/277**.
      (If the one `relayHealth` background-tick test flakes under parallel load, re-run it alone:
      `node --test packages/stt-relay-core/tests/relayHealth.test.mjs` → **26/26**.)
- [ ] **Relay service** — `cd services/stt-relay && node --test tests/*.test.mjs` → expect **106/106**.
- [ ] **Control-plane endpoints** — `node --test tests/stt-session-endpoint.test.mjs tests/stt-relays-routes.test.mjs`
      → expect **18/18** + **20/20** (these spawn the CP against your `.env` Supabase; the integration tier
      skips cleanly if Supabase env is absent).
- [ ] **Migration logic** — `node --test migrations/__tests__/stt_billing_logic.test.mjs` → expect **15/15**.
- [ ] **Regression (legacy path untouched)** — `node --test tests/unit-fixes.test.mjs tests/flash-model-picker.test.mjs`
      → expect **56/56**.
- [ ] **Client** — from repo root: `npm run build:electron && node --test electron/audio/__tests__/Relay*.test.mjs`
      → expect **44/44**.
- [ ] **Boot the relay locally** —
      `cd services/stt-relay && STT_SESSION_TOKEN_SECRET=test REGION=us DEEPGRAM_API_KEY=fake PORT=8091 node src/index.js`
      then in another shell: `curl -fsS localhost:8091/healthz`, `curl -fsS localhost:8091/readyz`,
      `curl -fsS localhost:8091/metrics | python3 -m json.tool`. Then `kill -TERM <pid>` and confirm a clean drain.
- [ ] **Self-contained rollout verify** — `node scripts/verify-stt-relay-rollout.mjs` → **RESULT: PASS (9 steps, 0 failures)**.
- [ ] **Load test** — `node scripts/load-test-stt-relay.mjs --max=50 --duration=10` → **RESULT: PASS (all tiers clean, zero crashes)**;
      eyeball p95 first-transcript and peak RSS per tier.

### 2. Staging checklist

- [ ] **Apply migration 003 to a STAGING Supabase FIRST** (MEDIUM-3 — migration before relay):
      open the staging project SQL editor, paste all of `migrations/003_stt_durable_billing.sql`, **Run**
      (idempotent; safe to re-run).
- [ ] **Deploy ONE relay to a staging VPS** per `docs/10` §1 (Docker or systemd):
      `sudo REGION=us MODE=docker bash services/stt-relay/deploy/setup-vps.sh --src /path/to/natively-api --site us-relay-staging.natively.software`,
      then populate `/etc/natively/stt-relay.env` (token secret, a Deepgram **test** key, the staging
      `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`), bring it up, and `curl -fsS https://us-relay-staging…/healthz`.
- [ ] **Set the staging CP env**: `STT_RELAY_US_URL=wss://us-relay-staging.natively.software/v1/transcribe`,
      `STT_SESSION_TOKEN_SECRET=<same as the relay>`, `STT_RELAY_ENABLE_PERCENT=0`.
- [ ] **Force relay for internal keys only** (percent stays 0): flip via the admin control route for a
      controlled dogfood — `curl -X POST https://<staging-cp>/admin/stt-relays/control -H "x-admin-secret: $ADMIN_SECRET" -H 'content-type: application/json' -d '{"force_region":"us","enable_percent":100}'`
      (or use a `STT_RELAY_ALLOWLIST` of internal key-ids if wired). Restore to `{"enable_percent":0}` after the dogfood.
- [ ] **Run the live verifier**:
      `CONTROL_PLANE_URL=https://<staging-cp> NATIVELY_API_KEY=<a paid staging key> node scripts/verify-stt-relay-rollout.mjs --live`
      → expect PASS through `/v1/stt/relays` → `/v1/stt/session` → WS connect → fixture transcript.
- [ ] **F15 isolation kill-test** (invariant §16.6 — must pass before stage 3): under a little load,
      `kill -9` the staging relay process (or `docker kill`). Confirm: (a) the CP stays up and
      `/v1/transcribe` still serves (`curl` a legacy session or chat route), (b) AI chat / webhooks
      unaffected, (c) the client recovers via the ladder onto Railway, (d) after ≤5 min the reaper
      finalizes the killed session (`status='abandoned'`, last checkpoint applied — ≤60s loss).

### 3. Production deploy checklist (ORDER MATTERS — do these in sequence)

> **The order is load-bearing.** Migration before relay (else the RPC-missing fallback parks usage in a
> bounded retry queue, MEDIUM-3). Reaper scheduled before relying on F5 (MEDIUM-4). Secret on relays
> before the CP signs with it (`docs/10` §12). Keep percent 0 until you start the ramp (§12).

- [ ] **1) Apply migration 003 to PROD Supabase** — SQL editor → paste all of
      `migrations/003_stt_durable_billing.sql` → **Run**. Verify per §5 below.
- [ ] **2) Schedule the reaper** (MEDIUM-4 — pick ONE):
   - **Option A — pg_cron (preferred):** in the prod SQL editor, run the §9 block from the migration
     (it is commented at the bottom of `003_stt_durable_billing.sql`, lines 623–627). Exact SQL:
     ```sql
     DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
         PERFORM cron.schedule('stt_reaper', '*/5 * * * *', $cron$ SELECT stt_reconcile_abandoned(300); $cron$);
       END IF;
     END $$;
     ```
     (Migration default is `*/2`; `*/5` = "every 5 min" per the brief — either is fine, ≤ the 300s threshold.)
     Verify: `SELECT jobname, schedule FROM cron.job WHERE jobname='stt_reaper';`
   - **Option B — control-plane reaper (if pg_cron is absent):** set the Railway env
     `STT_REAPER_INTERVAL_MS=120000` (and optionally `STT_REAPER_ABANDON_AFTER_SECONDS=300`). The
     control plane then calls `stt_reconcile_abandoned` on that interval (implemented in `server.js`,
     unref'd, self-disables + logs once if the RPC is missing). Default is `0` (off) so it never
     races a pg_cron schedule — enable exactly one. Both are idempotent, so running both is harmless
     but redundant. Verify in Railway logs: `[STTReaper] control-plane reconcile every 120000ms`.
- [ ] **3) Generate `STT_SESSION_TOKEN_SECRET`** (strong random):
      ```bash
      openssl rand -hex 48
      ```
      Store it in the secret manager; it goes on **both relays AND the CP**, byte-identical.
- [ ] **4) Deploy US + Asia relays** (`docs/10` §1–§2). Each relay's `/etc/natively/stt-relay.env` MUST set
      the full **Relay env checklist (§7)**. Confirm each: `curl -fsS https://us-relay…/healthz` and `/readyz`.
- [ ] **5) Set the Railway CP env** (Railway dashboard) — keep **percent 0**:
      `STT_SESSION_TOKEN_SECRET=<same secret>`, `STT_RELAY_US_URL=wss://us-relay.natively.software/v1/transcribe`,
      `STT_RELAY_ASIA_URL=wss://asia-relay.natively.software/v1/transcribe`, **`STT_RELAY_ENABLE_PERCENT=0`**,
      `STT_RELAY_KILL_SWITCH=0`, `STT_RELAY_DEFAULT_REGION=us`, `STT_RELAY_HEALTH_TIMEOUT_MS=2500`,
      `STT_RELAY_HEALTH_CACHE_MS=15000`, `STT_RELAY_HEALTH_CHECK_INTERVAL_MS=30000`,
      `STT_SESSION_TOKEN_TTL_SECONDS=180` (and confirm `STT_RELAY_RAILWAY_FALLBACK_URL` is the default
      `wss://api.natively.software/v1/transcribe`). Redeploy the CP.
- [ ] **6) Verify both relays show healthy** — `curl -fsS https://api.natively.software/admin/stt-relays -H "x-admin-secret: $ADMIN_SECRET" | python3 -m json.tool` → both regions `healthy:true`,
      `configured:true`; or `GET /v1/stt/relays` (with a key) shows both with a non-null `latency_ms`.
- [ ] **7) Keep `STT_RELAY_ENABLE_PERCENT=0`** — everyone is on Railway. Do not ramp until §12.

### 4. DNS checklist

- [ ] Create `A` record `us-relay` → `<US VPS IPv4>`, **DNS only (grey cloud)**, TTL Auto/300.
- [ ] Create `A` record `asia-relay` → `<ASIA VPS IPv4>`, **DNS only (grey cloud)**, TTL Auto/300.
- [ ] (Optional) `AAAA` records if the boxes have IPv6 — advisory only (the client resolver is IPv4-only).
- [ ] **Grey-cloud is mandatory** — orange-cloud proxying breaks ACME TLS issuance AND routes every PCM
      byte through Cloudflare (the exact hop we are removing). `docs/10` §3/§9.
- [ ] **TLS via Caddy** — Caddy auto-issues Let's Encrypt certs on first request once DNS points at the box
      and 80/443 are open. (Nginx alternative: `certbot --nginx -d us-relay.natively.software`.)
- [ ] **Verify resolution + TLS**:
      `dig +short A us-relay.natively.software` (→ the VPS IP, **not** a 104.x/172.x CF range) and
      `curl -fsS https://us-relay.natively.software/healthz` (and asia). Confirm 8080 is NOT public:
      `curl -m 5 http://<VPS_IP>:8080/healthz || echo "good: 8080 not public"`.

### 5. Supabase migration checklist

- [ ] **Apply** `migrations/003_stt_durable_billing.sql` in the SQL editor (idempotent — `CREATE … IF NOT EXISTS` / `CREATE OR REPLACE`).
- [ ] **Verify tables exist** —
      `SELECT to_regclass('public.stt_sessions'), to_regclass('public.stt_usage_events'), to_regclass('public.relay_health_events');`
      → all three non-null. (Defined at migration lines 90 / 150 / 166.)
- [ ] **Verify RPCs exist** —
      `SELECT proname FROM pg_proc WHERE proname IN ('stt_flush_usage','stt_finalize_session','stt_reconcile_abandoned','stt_apply_billing_delta','increment_transcription_minutes');`
      → all five present. (Lines 242 / 380 / 559 / 188 / 82.)
- [ ] **Verify GRANTs to `service_role`** — the migration's GRANT block (lines 608–612) executes the
      `GRANT EXECUTE … TO service_role` for each RPC + `GRANT SELECT,INSERT[,UPDATE]` on the three tables.
      Spot-check: `SELECT has_function_privilege('service_role','stt_flush_usage(text,int,jsonb)','execute');` → `t`.
- [ ] **Schedule the reaper** — §3 step 2 (pg_cron `stt_reaper`, or the control-plane call).
- [ ] **Confirm the legacy RPCs are untouched** — `increment_transcription_minutes` is re-exported
      byte-for-byte (capture-only, F6) and `increment_trial_stt_seconds` is **not modified** by this
      migration (grep confirms one reference in the migration = the re-export of minutes only; the legacy
      `/v1/transcribe` close-time billing keeps calling both directly). A session is one path or the
      other — never billed by both (invariant §16.4).
- [ ] **(Optional) live smoke** — run the manual flush/replay/finalize/finalize-again sequence in
      `docs/06` §10.2 against a throwaway `st_manual_*` session id, then delete the test rows.

### 6. Railway env checklist (production-safe values)

Set on the Railway control-plane service, then redeploy:

| Var | Production value | Why |
|---|---|---|
| `STT_SESSION_TOKEN_SECRET` | `<openssl rand -hex 48>` | shared HMAC; identical to both relays |
| `STT_RELAY_US_URL` | `wss://us-relay.natively.software/v1/transcribe` | US relay endpoint |
| `STT_RELAY_ASIA_URL` | `wss://asia-relay.natively.software/v1/transcribe` | Asia relay endpoint |
| `STT_RELAY_RAILWAY_FALLBACK_URL` | `wss://api.natively.software/v1/transcribe` (default) | always-present emergency path |
| **`STT_RELAY_ENABLE_PERCENT`** | **`0`** | rollout OFF until the ramp (§12) |
| `STT_QUOTA_LEASE_ENABLED` | `true` (default) | F7 atomic quota lease (migration 004). Leaves the snapshot path if `0`/`false`; gracefully no-ops to the snapshot if the RPC is missing. Required active to ramp past 25%. |
| `STT_RELAY_KILL_SWITCH` | `0` | off, but instant to flip |
| `STT_RELAY_DEFAULT_REGION` | `us` | unknown-geo default |
| `STT_RELAY_FORCE_REGION` | (unset) | dogfood only |
| `STT_RELAY_HEALTH_TIMEOUT_MS` | `2500` | per-probe timeout |
| `STT_RELAY_HEALTH_CACHE_MS` | `15000` | probe-cache TTL |
| `STT_RELAY_HEALTH_CHECK_INTERVAL_MS` | `30000` | background `/healthz` interval |
| `STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES` | `true` | honor client RTT hints |
| `STT_SESSION_TOKEN_TTL_SECONDS` | `180` | token TTL (clamped 120–300) |
| `STT_MAX_SAMPLE_RATE` | `16000` | canonical clamp |
| `STT_MAX_CHANNELS` | `1` | canonical clamp |
| `STT_ALLOW_STEREO_PERCENT` | `0` | stereo cohort OFF |
| `STT_ALLOW_DUAL_STREAM_PERCENT` | `0` | dual-stream cohort OFF |

### 7. Relay env checklist (per VPS — `/etc/natively/stt-relay.env`, 0600)

From `services/stt-relay/.env.example`. **REQUIRED** = relay won't serve correctly without it.

- [ ] **`REGION`** — REQUIRED — `us` or `asia` (boot fails fast otherwise; drives the token region-claim check).
- [ ] **`STT_SESSION_TOKEN_SECRET`** — REQUIRED — byte-identical to the CP + the other relay (boot fails fast).
- [ ] **`DEEPGRAM_API_KEY`** (+ optionally `_1.._5`) — REQUIRED — `/readyz` 503s with no key, so the CP won't route here.
- [ ] **`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`** — REQUIRED in prod — durable usage flush/finalize
      (boots without, but usage/billing is then lost). Key scoped to `stt_*` only.
- [ ] `RELAY_ID` — default `${REGION}-1`; set explicitly if >1 box/region.
- [ ] `PUBLIC_RELAY_URL` — advisory, e.g. `wss://us-relay.natively.software/v1/transcribe`.
- [ ] `TRUST_PROXY_HEADER` — `x-forwarded-for` when behind Caddy/Nginx (F8); empty = raw socket.
- [ ] `ELEVENLABS_API_KEY` (+`_1..5`) — third provider arm (`ENABLE_ELEVENLABS_FALLBACK=true`).
- [ ] `GOOGLE_CREDENTIALS_JSON` + `GCP_PROJECT_ID` — Google STT fallback arm.
- [ ] `AXIOM_TOKEN` + `AXIOM_DATASET=stt-relay`, `SENTRY_DSN`, `POSTHOG_API_KEY`(+`POSTHOG_HOST`) — observability.
- [ ] Caps/guards (sane defaults already): `MAX_CONCURRENT_WS=200`, `MAX_WS_PER_IP=5`,
      `MAX_SESSIONS_PER_IDENTITY=4`, `MAX_SESSION_SECONDS=14400`, `PROVIDER_BUFFER_CAP_BYTES`,
      `USAGE_FLUSH_INTERVAL_MS=45000`, `SHUTDOWN_GRACE_MS=20000`.
- [ ] Bandwidth guards: `REJECT_HIGH_BANDWIDTH_AUDIO=true`, `ALLOW_STEREO=false`, `ALLOW_48KHZ=false`.
- [ ] `EGRESS_WARN_GB` — set ~`800` on the **asia** relay (tighter included traffic); `0`/high on US.
- [ ] `STT_SESSION_TOKEN_SECRET_PREV` — only during a rotation window (`docs/10` §12).

### 8. App release checklist

- [ ] Confirm client flags are **default OFF** in `SettingsManager`: `regionalSttRelayEnabled=false`,
      `regionalSttRelayPercent=0`, `forceSttRelayRegion=null`, `sttRailwayFallbackEnabled=true` (default — keeps the net).
- [ ] **Ship the build with flags OFF.** A shipped client with the flag off is byte-for-byte the legacy
      direct-Railway path (proven by `RelayFallbackLadder.test.mjs:141`). No user is on the relay yet.
- [ ] **Enable server-side first.** The relay turns on via the CP rollout (`STT_RELAY_ENABLE_PERCENT`),
      not a client redeploy. The client's own gate is **in addition** — both must agree; the server stays
      authoritative.
- [ ] To enable a client cohort once the server is ramping: flip `regionalSttRelayEnabled=true` and set
      `regionalSttRelayPercent` (the client gate is deterministic + monotonic per key). For dogfood, set
      `forceSttRelayRegion`. Never set `sttRailwayFallbackEnabled=false` except for deliberate relay-isolation QA.

### 9. Monitoring checklist (arm before the ramp)

- [ ] **Axiom** — confirm the `stt-relay` dataset is receiving `session_summary` events (query for a recent
      event with the matching `relay_id`/`region` after one session). `provider_error` / `cost_guard` /
      `health_event` also land here. Control-plane logs go to a separate dataset — cross-ref by `session_id`.
- [ ] **Sentry** — confirm relay errors arrive tagged `relay_id`/`region`/`release`; no PII (session ids only).
- [ ] **PostHog** — confirm the client funnel `stt_relay_selected → stt_relay_connected → stt_first_transcript_bucket`
      (filtered by `region`); `stt_fallback_used` should be rare.
- [ ] **Alerts armed** (`docs/08`/`docs/01` §12): Relay down (`/readyz` >60s), Both relays down,
      **Railway-fallback share >10%** while percent>0, Egress projection >80% of included TB, Key pool exhausted,
      Usage-flush failures (>3 consecutive — billing!), p95 first-transcript >2500ms, Reconciliation backlog (>25 abandoned).
- [ ] **Watch during the ramp**: `railway_fallback_rate`, egress vs budget, **p95 first-transcript**,
      `stt_usage_flush_total{outcome=error}` ≈ 0, reconciliation backlog ≈ 0, zero relay crashes/new Sentry classes.

### 10. Rollback checklist (LAYERED — fastest first; **no app redeploy for a–c**)

- [ ] **a) Instant kill switch (seconds, no deploy)** —
      ```bash
      curl -X POST https://api.natively.software/admin/stt-relays/control \
        -H "x-admin-secret: $ADMIN_SECRET" -H 'content-type: application/json' \
        -d '{"kill_switch": true}'
      ```
      → next `POST /v1/stt/session` returns `{mode:"railway"}`; new sessions take the unchanged Railway
      path; in-flight relay sessions finish/drain (1001). Also set `STT_RELAY_KILL_SWITCH=1` in the Railway
      env so it survives a restart (runtime overrides are not persisted).
- [ ] **b) Zero the rollout** — `STT_RELAY_ENABLE_PERCENT=0` (Railway env) or `{"enable_percent":0}` via the
      control route → all relay-eligible users go back to Railway deterministically, without the hard kill semantics.
- [ ] **c) Client safety hatch stays intact** — `sttRailwayFallbackEnabled` must remain **true** (its default)
      so in-flight clients fall through the ladder to Railway. (Never flip it false except for QA.)
- [ ] **d) Stop the relay process / revert DNS (last resort)** — `sudo systemctl stop stt-relay` /
      `docker compose down` (graceful 1001 → clients reconnect to Railway), then revert DNS only if the box
      itself is compromised. With the kill switch on, new sessions never resolve a relay anyway.

**Incident order:** kill switch (a) → confirm Railway-fallback share rises + relay creates drop (PostHog/Axiom)
→ stop/inspect the relay (d) → fix → re-enable percent (b) → drop the kill switch.

### 11. Post-deploy validation checklist

- [ ] **Issue a test session against prod** —
      `CONTROL_PLANE_URL=https://api.natively.software NATIVELY_API_KEY=<a paid key> node scripts/verify-stt-relay-rollout.mjs --live`
      (or temporarily force-route your own key via `{"force_region":"us","enable_percent":100}` and restore to 0 after).
      → PASS through select → connect → fixture transcript.
- [ ] **Confirm the durable row** — `SELECT session_id, status, billable_seconds, billed_seconds, last_seq FROM stt_sessions ORDER BY created_at DESC LIMIT 1;`
      → a fresh `finalized` row with `billable_seconds > 0`.
- [ ] **Confirm the counter moved by the right amount** — compare `api_keys.transcription_minutes_used`
      (paid: + `round(total_seconds/60)`) or `free_trials.stt_seconds_used` (trial: + exact seconds, capped 600)
      before/after the test session. Must match the session's `billed_seconds`.
- [ ] **Confirm reconciliation** — kill a session mid-stream (`kill -9` the relay or drop the WS), wait ≥5 min,
      and confirm the reaper finalized it: `SELECT status, billed_seconds FROM stt_sessions WHERE session_id='<that id>';`
      → `status='abandoned'`, last checkpoint applied (≤60s loss). Then `SELECT count(*) FROM stt_sessions WHERE status='active' AND updated_at < now() - interval '5 min';` → 0 (no leak).

### 12. Staged percent ramp (the go/no-go gates)

Deterministic + monotonic: raising the percent only ever **adds** users (the original cohort never reshuffles).
Each stage holds its soak before promotion. Rollback at every stage = §10 (kill switch, instant).

| Stage | EXACT change | Soak | Go/no-go gate (ALL must hold to promote) |
|---|---|---|---|
| **0. Internal force** | `{"force_region":"us","enable_percent":100}` for internal keys only (or `STT_RELAY_ALLOWLIST`), then **restore `{"enable_percent":0}`** | ≥20 real meetings | first-transcript p95 within ±20% of Railway; **zero billing mismatches** (manual `stt_sessions` reconciliation); both-channel (mic+system) region pinning verified; F15 kill-test passed in staging |
| **1. 1%** | `STT_RELAY_ENABLE_PERCENT=1` (env) | 48h | railway-fallback share **<5%** of relay-eligible; `stt_usage_flush_total{outcome=error}` rate **<0.1%**; no new Sentry classes; 1006 rate ≤ baseline; **billing reconciliation matches**; **zero relay crashes** |
| **2. 10%** | `=10` | 72h | stage-1 gates **+** egress projection within budget; asia p95 ≤ Railway baseline for Asia geos; reconciliation backlog ≈ 0 |
| **3. 50%** | `=50` | 1 week | capacity watermarks <60% peak; alert list quiet; support-ticket rate flat; egress within plan TB |
| **4. 100%** | `=100` | 2 weeks | all of the above sustained; only THEN may Railway `/v1/transcribe` be refactored/demoted (it stays deployed as the emergency path regardless — invariant §16.1) |

> **Go/no-go metric gates (every stage):** fallback rate < threshold (5% at 1%, tightening) · p95 first-transcript
> < 2500ms · billing reconciliation matches (sum of finalized `billable_seconds` deltas == counter deltas) ·
> zero relay crashes · monthly egress projection within the included-TB budget.

> ✅ **F7 gate — LIFTED (the lease is built).** The former hard cap at **`STT_RELAY_ENABLE_PERCENT=25`** is
> removed: the **`stt_reserve_session` atomic quota lease** (`migrations/004_stt_quota_lease.sql`, MEDIUM-1
> in `docs/12`, design in `docs/06 §11`) is implemented. Session-create now reserves the granted budget from
> a SHARED per-identity counter and the token carries the LEASE (not the ≤30s-stale snapshot), so N
> concurrent sessions on one key share the budget instead of each spending the full snapshot. The 50%/100%
> stages are **no longer blocked** on F7.
>
> **Precondition to ramp past 25%:** apply **migration 004** in Supabase (after migration 003) and confirm
> the lease is ACTIVE (no `quota_lease_degraded` events in the `[STTEvent]` drain — that event means the CP
> is falling back to the snapshot because the RPC is missing). The lease degrades gracefully, so the server
> can deploy before the migration; but do not exceed 25% until migration 004 is live and `quota_lease_degraded`
> is at zero. Re-verify the billing-reconciliation gate under a concurrency test (e.g. open several sessions
> on one key with a small remaining quota; total billed must not exceed the limit), then proceed to 50%/100%.

---

## Appendix — verification commands (copy/paste, run from `natively-api/`)

```bash
# 13/13 wiring (all green):
node --test packages/stt-relay-core/tests/*.test.mjs                 # 277
cd services/stt-relay && node --test tests/*.test.mjs ; cd ../..     # 106
node --test tests/stt-session-endpoint.test.mjs                      # 18
node --test tests/stt-relays-routes.test.mjs                         # 20
node --test migrations/__tests__/stt_billing_logic.test.mjs          # 15
node --test migrations/__tests__/stt_quota_lease_logic.test.mjs      # 10 (F7 lease invariants)
node --test tests/stt-quota-lease.test.mjs                           # 20 (F7 lease control plane)
node --test tests/unit-fixes.test.mjs tests/flash-model-picker.test.mjs  # 56 (legacy untouched)
git diff --numstat HEAD -- server.js                                 # 540  0  server.js

# client (from repo root):
npm run build:electron && node --test electron/audio/__tests__/Relay*.test.mjs   # 44

# end-to-end self-contained + load (from natively-api/):
node scripts/verify-stt-relay-rollout.mjs                            # 9/9 PASS
node scripts/load-test-stt-relay.mjs --max=50 --duration=10          # PASS, zero crashes

# boot the relay + curl the three endpoints:
cd services/stt-relay && STT_SESSION_TOKEN_SECRET=test REGION=us DEEPGRAM_API_KEY=fake PORT=8091 node src/index.js &
curl -fsS localhost:8091/healthz ; curl -fsS localhost:8091/readyz ; curl -fsS localhost:8091/metrics
```
