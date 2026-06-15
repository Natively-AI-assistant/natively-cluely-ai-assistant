# Phase 10 — Deploying the Regional STT Relays (Ops Runbook)

**Date:** 2026-06-13
**Status:** Deliverable — deploy configs + ops docs for the standalone regional relay
**Scope:** how to stand up, operate, observe, roll back, and tear down the
`us-relay` and `asia-relay` instances of `services/stt-relay`.
**Inputs (binding):** `docs/01-target-stt-relay-architecture.md` §13 (topology),
§14 (cost), §15 (rollout), §12 (observability); `docs/05-stt-relay-service.md`
(service layout, health endpoints, graceful drain, env vars);
`services/stt-relay/.env.example` (full env set);
`docs/04-relay-selection.md` §3.3 (the runtime kill switch).

**One-sentence summary:** Two cheap flat-bandwidth VPS (or Fly.io) relays sit
behind Caddy (auto-TLS), are reachable only on 80/443, verify a short-lived HMAC
token offline, drain gracefully on SIGTERM, and are fronted by Cloudflare
**grey-cloud (DNS-only)** records — with the control-plane kill switch as the
instant rollback to the unchanged Railway path.

---

## Artifacts produced by this phase

All under `natively-api/services/stt-relay/`:

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage, non-root, healthcheck image. **Build context = `natively-api/`** (the file: link needs both `services/stt-relay` and `packages/stt-relay-core`). |
| `.dockerignore` (service) + `natively-api/.dockerignore` (context root, authoritative) | Exclude `node_modules`, `.env`, tests, logs, VCS. |
| `deploy/docker-compose.example.yml` | Relay + Caddy; relay internal-only, Caddy public 80/443; `env_file: .env`; restart `unless-stopped`; mem limits. |
| `deploy/Caddyfile.example` | Auto-TLS reverse proxy, WS-aware, long-stream timeouts, security headers, grey-cloud note. |
| `deploy/nginx.example.conf` | Nginx alternative (WS upgrade headers + certbot). |
| `deploy/stt-relay.service` | systemd unit: dedicated user, `EnvironmentFile`, `Restart=on-failure`, `TimeoutStopSec=30` (aligned with `SHUTDOWN_GRACE_MS`), `MemoryMax`, hardening. |
| `deploy/healthcheck.sh` | Curls `/healthz` + `/readyz`, exits 0/1/2. |
| `deploy/fly.us.toml` / `deploy/fly.asia.toml` | Fly.io configs (iad/sin, WS concurrency, health checks). |
| `deploy/setup-vps.sh` | Idempotent Ubuntu bootstrap (Node/Docker, user, env template, unit/compose, ufw). |

---

## Deployment topology

```
                           ┌──────────────────────────────────────────────┐
                           │  Cloudflare DNS (GREY-CLOUD / DNS-ONLY)        │
                           │  us-relay.natively.software   A → <US VPS IP>  │
                           │  asia-relay.natively.software A → <ASIA VPS IP>│
                           └───────────────┬───────────────┬──────────────┘
            resolves to real IP            │               │   resolves to real IP
            (NOT proxied through CF)        │               │   (NOT proxied through CF)
                                           ▼               ▼
   ┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
   │  US VPS (Hetzner US, 2 vCPU / 4 GB)        │   │  ASIA VPS (Vultr/DO SGP, 2 vCPU / 4 GB)    │
   │                                            │   │                                            │
   │  ufw: 22, 80, 443 open  · 8080 internal    │   │  ufw: 22, 80, 443 open  · 8080 internal    │
   │                                            │   │                                            │
   │  :443 ┌─────────┐  http  ┌──────────────┐  │   │  :443 ┌─────────┐  http  ┌──────────────┐  │
   │ ─────▶│  Caddy  │───────▶│ stt-relay    │  │   │ ─────▶│  Caddy  │───────▶│ stt-relay    │  │
   │       │ auto-TLS│ :8080  │ REGION=us    │  │   │       │ auto-TLS│ :8080  │ REGION=asia  │  │
   │       └─────────┘        │ RELAY_ID=us-1│  │   │       └─────────┘        │RELAY_ID=asia1│  │
   │                          └──────┬───────┘  │   │                          └──────┬───────┘  │
   └───────────────────────────────┼──────────┘   └───────────────────────────────┼──────────┘
                                    │  (offline HMAC verify — no CP call on hot path)│
        ┌───────────────────────────┴────────────┐         ┌────────────────────────┴───────────┐
        ▼                                         ▼         ▼                                     ▼
   Deepgram / Google / ElevenLabs          Supabase (stt_* RPCs)              Deepgram / Google / ElevenLabs
   (provider chain, vendor egress)         (idempotent usage flush/finalize)  (provider chain, vendor egress)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Railway control plane (UNCHANGED /v1/transcribe = emergency fallback)                          │
   │   POST /v1/stt/session → auth + quota lease + region select + sign HMAC token (REGION-scoped)   │
   │   GET  /v1/stt/relays  → health-cached relay listing                                            │
   │   POST /admin/stt-relays/control → INSTANT kill switch (mode:railway), no deploy                │
   └──────────────────────────────────────────────────────────────────────────────────────────────┘

   Client fallback ladder: same relay (retry) → alt relay (re-POST session) → Railway legacy WS.
```

The control plane signs a token whose `region` claim the relay verifies against
its own `REGION`; a `us` token will not authenticate on `asia-relay` and vice
versa, so DNS-only steering plus the control-plane region selection is the load
balancer (docs/01 §13 — finer control than DNS TTLs).

---

## Per-VPS sizing recommendation

The relay is **I/O-bound**, not CPU-bound (it shuttles PCM frames and parses
small JSON transcripts). The dominant resource is **memory per live session**:

| Component | Per-session memory |
|---|---|
| 30s prebuffer / replay `CircularBuffer` at 16 kHz mono s16le | 16000 × 2 B × 30 s ≈ **0.96 MB** |
| Provider socket outbound buffer (F10 cap, `PROVIDER_BUFFER_CAP_BYTES`, default 4 MB **ceiling** — typically a few hundred KB in steady state) | ~0.3–1 MB typical, 4 MB worst-case-before-shed |
| JS objects, accumulators, transcript history, ws framing overhead | ~0.3–0.5 MB |
| **Steady-state total per session** | **≈ 1.5–2.5 MB** (worst-case spike ≈ 5–6 MB if a provider buffer is saturated pre-shed) |

Reasoning to a box size (target the steady state; the F10 shed/kill guards cap
the worst case):

| Concurrent sessions | Session memory (≈2 MB ea) | + Node baseline/heap (~120 MB) + OS/Caddy (~250 MB) | **Recommended VPS** |
|---|---|---|---|
| up to ~50 | ~100 MB | ~470 MB | **2 vCPU / 2 GB** (`mem_limit 512m`) |
| up to ~120 | ~240 MB | ~610 MB | **2 vCPU / 4 GB** (`mem_limit 512m–768m`) ← default |
| up to ~200 (`MAX_CONCURRENT_WS` default) | ~400 MB | ~770 MB | **2 vCPU / 4 GB**, raise `mem_limit` to **1g** |

**Recommendation:** a **2 vCPU / 4 GB** VPS per region (Hetzner CPX21-class US,
Vultr/DO 2 vCPU SGP) comfortably runs the default `MAX_CONCURRENT_WS=200` with
the compose/systemd `mem_limit` set to **512m–1g**. This matches docs/01 §13
("2 vCPU/4 GB is ample"). Scale horizontally (a second relay box + a second
`RELAY_ID` behind the same hostname, or a Cloudflare LB pool — §10) before
scaling a single box past ~200 sessions; CPU only becomes a factor during heavy
ElevenLabs base64 framing or Google incremental-suffix fallback, which the cost
guards already bound.

---

## Env-var checklist per relay

Read once at boot by `src/config.js` (validated/clamped/fail-fast). Full table in
`docs/05-stt-relay-service.md` §7 and `services/stt-relay/.env.example`.

**MUST be set (relay won't serve without these):**

| Var | Why required |
|---|---|
| `REGION` | `us` \| `asia`. **Boot fails fast** if unset/invalid. Drives the token `region` claim check + telemetry tags. |
| `STT_SESSION_TOKEN_SECRET` | Shared HMAC secret with the control plane. **Boot fails fast** if unset. Must be byte-identical to Railway's `STT_SESSION_TOKEN_SECRET`. |
| `DEEPGRAM_API_KEY` (≥1, optionally `_1.._5`) | Primary provider. **`/readyz` returns 503** with no Deepgram key, so the control plane won't route sessions here. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Durable usage flush/finalize. Technically the relay BOOTS without them (flush no-ops with a warn), but **usage/billing is then lost** — treat as required in prod. The service-role key must be scoped to the `stt_*` tables/RPCs only. |

**Strongly recommended (region identity + provider chain + observability):**

| Var | Default | Note |
|---|---|---|
| `RELAY_ID` | `${REGION}-1` | logs/metrics/telemetry tag; set explicitly when running >1 box per region. |
| `PUBLIC_RELAY_URL` | `''` | advisory; e.g. `wss://us-relay.natively.software/v1/transcribe`. |
| `TRUST_PROXY_HEADER` | `''` | set to `x-forwarded-for` when behind Caddy/Nginx/Fly (F8). |
| `ELEVENLABS_API_KEY` (+`_1..5`) | `[]` | third provider arm (`ENABLE_ELEVENLABS_FALLBACK=true`). |
| `GOOGLE_CREDENTIALS_JSON` + `GCP_PROJECT_ID` | `''` | Google STT (chirp_2) fallback arm. Needs `@google-cloud/speech` in the image (it is — see Docker §). |
| `AXIOM_TOKEN` (+`AXIOM_DATASET=stt-relay`) | `''` | structured event shipping. |
| `SENTRY_DSN` | `''` | error/release health. |
| `POSTHOG_API_KEY` (+`POSTHOG_HOST`) | `''` | relay-side events (client events are separate — §15). |

**Optional (cost/cap tuning — sane defaults already set):** `MAX_CONCURRENT_WS`,
`MAX_WS_PER_IP`, `MAX_SESSIONS_PER_IDENTITY`, `MAX_SESSION_SECONDS`,
`MAX_BYTES_PER_SESSION`, `MAX_RECONNECTS_PER_SESSION`, `MAX_REPLAY_SECONDS`,
`PROVIDER_BUFFER_CAP_BYTES`, `ENABLE_GOOGLE_STT_FALLBACK`,
`ENABLE_SILENCE_WATCHDOG`, `REJECT_HIGH_BANDWIDTH_AUDIO`, `ALLOW_STEREO`,
`ALLOW_48KHZ`, `USAGE_FLUSH_INTERVAL_MS`, `EGRESS_WARN_GB`, `LOG_TRANSCRIPTS`,
`SHUTDOWN_GRACE_MS`, `STT_SESSION_TOKEN_SECRET_PREV` (rotation only).

---

## 1. US relay setup (step-by-step)

Two supported paths. Both end with a relay reachable at
`wss://us-relay.natively.software/v1/transcribe`.

### Path A — Docker (recommended for parity with Fly)

```bash
# On the US VPS, with the repo (or a tarball of natively-api/) present:
sudo REGION=us MODE=docker bash services/stt-relay/deploy/setup-vps.sh \
     --src /path/to/natively-api --site us-relay.natively.software

# Populate secrets (the script wrote a 0600 template):
sudo nano /etc/natively/stt-relay.env       # set STT_SESSION_TOKEN_SECRET, DEEPGRAM_API_KEY, SUPABASE_*

# Build + start (context = natively-api/, file: link resolvable):
cd /opt/natively/stt-relay/services/stt-relay/deploy
CADDY_SITE=us-relay.natively.software docker compose -f docker-compose.example.yml up -d --build

# Verify:
bash /opt/natively/stt-relay/services/stt-relay/deploy/healthcheck.sh
curl -fsS https://us-relay.natively.software/healthz
```

Manual image build (no compose):

```bash
cd natively-api
docker build -f services/stt-relay/Dockerfile -t natively-stt-relay .
# context is "." == natively-api/ — it contains BOTH services/stt-relay and packages/stt-relay-core.
```

### Path B — bare-metal Node + systemd

```bash
sudo REGION=us MODE=systemd bash services/stt-relay/deploy/setup-vps.sh \
     --src /path/to/natively-api --site us-relay.natively.software
# installs Node 20 + Caddy, syncs the tree to /opt/natively/stt-relay, npm ci
# (with @google-cloud/speech), writes /etc/natively/stt-relay.env template,
# installs+enables stt-relay.service, configures ufw.

sudo nano /etc/natively/stt-relay.env       # set the required secrets
sudo systemctl start stt-relay
sudo systemctl reload caddy
journalctl -u stt-relay -f                   # watch the structured JSON boot banner
```

---

## 2. Singapore relay setup

Identical to §1, **changing only the region inputs** — the image/config are
region-agnostic; region is pure env:

```bash
# Docker:
sudo REGION=asia MODE=docker bash services/stt-relay/deploy/setup-vps.sh \
     --src /path/to/natively-api --site asia-relay.natively.software
# systemd:
sudo REGION=asia MODE=systemd bash services/stt-relay/deploy/setup-vps.sh \
     --src /path/to/natively-api --site asia-relay.natively.software
```

Region differences that matter:

- `REGION=asia`, `RELAY_ID=asia-1`, `PUBLIC_RELAY_URL=wss://asia-relay.natively.software/v1/transcribe` (the template writes these for you).
- `CADDY_SITE=asia-relay.natively.software` (drives the cert + vhost).
- **Same** `STT_SESSION_TOKEN_SECRET`, **same** Deepgram/EL/Google keys, **same**
  `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` as US — the token secret in particular
  MUST match across both relays and the control plane.
- **Egress budget is tighter** in SGP (docs/01 §14: ~1 TB included vs US's 20 TB).
  Set `EGRESS_WARN_GB` (e.g. `800`) on the asia relay so the one-shot
  `egress_threshold_warning` fires before overage. Confirm Deepgram RTT from
  `sin` vs Mumbai before committing the region (docs/01 §13).

---

## 3. DNS records

Create two records in the `natively.software` zone:

| Type | Name | Value | Proxy | TTL |
|---|---|---|---|---|
| `A` | `us-relay` | `<US VPS IPv4>` | **DNS only (grey cloud)** | Auto / 300 |
| `AAAA` | `us-relay` | `<US VPS IPv6>` (if the box has one) | **DNS only** | Auto / 300 |
| `A` | `asia-relay` | `<ASIA VPS IPv4>` | **DNS only (grey cloud)** | Auto / 300 |
| `AAAA` | `asia-relay` | `<ASIA VPS IPv6>` (if any) | **DNS only** | Auto / 300 |

**The client DNS resolver is IPv4-only** (`electron/audio/dnsHelpers.ts`, docs/01
§5.6) — an `A` record is mandatory; `AAAA` is optional/advisory. Both Hetzner and
Vultr/DO publish A records.

### Why grey-cloud (DNS-only), not orange-cloud (proxied)

This is the single most important DNS decision (docs/01 §13):

1. **TLS issuance** — Caddy/certbot complete the ACME challenge against the box's
   **real IP** on 80/443. Orange-cloud proxying intercepts the challenge and the
   cert never issues (or you'd have to delegate to CF's cert + origin certs).
2. **Audio path** — orange-cloud routes **every PCM byte** through Cloudflare,
   re-introducing exactly the middleman hop this migration removes: added
   latency, WS under CF's proxy/timeout limits, and (on paid LB/Argo paths)
   re-created per-GB cost.

DNS-only means the client connects straight to the VPS; Cloudflare is only an
authoritative nameserver here.

---

## 4. TLS

**Caddy (default):** fully automatic. On first request to the configured site
address, Caddy obtains a Let's Encrypt cert (HTTP-01/TLS-ALPN) and auto-renews.
Nothing to do beyond pointing DNS (grey-cloud) at the box and opening 80/443.
Validate the config with `caddy validate --config /etc/caddy/Caddyfile`.

**Nginx + certbot (alternative):** see `deploy/nginx.example.conf` header.
One-time per host:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d us-relay.natively.software --redirect -m ops@natively.software --agree-tos
# certbot edits the server block in place + installs an auto-renewal systemd timer.
sudo nginx -t && sudo systemctl reload nginx
```

Both terminate TLS at the proxy; the relay speaks plain HTTP/WS on `localhost:8080`.

---

## 5. Firewall (ufw)

`setup-vps.sh` configures this; to do it manually:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp          # SSH (lock to your admin IP in prod if possible)
sudo ufw allow 80/tcp          # ACME challenge + HTTP→HTTPS redirect
sudo ufw allow 443/tcp         # Caddy/Nginx public TLS
sudo ufw enable
```

**The relay port 8080 is deliberately NOT opened.** The relay binds `0.0.0.0:8080`
inside the box but only Caddy/Nginx (loopback) reaches it; ufw default-deny keeps
8080 off the public interface. Verify from outside the box:

```bash
# from your laptop — should TIME OUT / be refused:
curl -m 5 http://<VPS_IP>:8080/healthz || echo "good: 8080 not public"
# should succeed (via Caddy):
curl -fsS https://us-relay.natively.software/healthz
```

(Docker note: `expose` in compose publishes 8080 only on the compose network, not
the host — no host `ports:` mapping exists for the relay, so it is never bound on
the public interface regardless of ufw.)

---

## 6. Docker compose

`deploy/docker-compose.example.yml` runs two services: `relay` (internal-only)
and `caddy` (public 80/443). Key facts:

- **Build-context caveat:** `build.context` points to `../../..` (= `natively-api/`)
  and `build.dockerfile` is `services/stt-relay/Dockerfile`, because the relay's
  `file:../../packages/stt-relay-core` link needs both trees in the context. The
  equivalent manual build is
  `docker build -f services/stt-relay/Dockerfile -t natively-stt-relay natively-api/`.
- **`env_file: .env`** — all config + secrets come from a gitignored `.env` next
  to the compose file. The bootstrap symlinks it to `/etc/natively/stt-relay.env`.
- **Relay not public:** the relay uses `expose: ["8080"]` (compose-network only),
  **no host `ports:`**. Only Caddy maps `80:80`/`443:443`.
- **`restart: unless-stopped`**, `stop_grace_period: 30s` (≥ `SHUTDOWN_GRACE_MS`
  20s so the drain completes), `mem_limit: 512m` (raise to 1g near capacity),
  `depends_on: relay (service_healthy)` for Caddy.

```bash
# up:
CADDY_SITE=us-relay.natively.software docker compose -f docker-compose.example.yml up -d --build
# down (graceful — relay drains in-flight sessions within stop_grace_period):
docker compose -f docker-compose.example.yml down
# tail logs:
docker compose -f docker-compose.example.yml logs -f relay
```

**Same compose, US vs Asia** — change only `.env` (`REGION`, `RELAY_ID`,
`PUBLIC_RELAY_URL`) and `CADDY_SITE`. Nothing in the compose file is region-specific.

---

## 7. systemd restart policy

`deploy/stt-relay.service` (bare-metal path):

- Runs `node src/index.js` as the unprivileged `natively` user from
  `WorkingDirectory=/opt/natively/stt-relay/services/stt-relay`.
- `EnvironmentFile=/etc/natively/stt-relay.env` (0600 root:natively).
- `Restart=on-failure`, `RestartSec=3`, `StartLimitBurst=5`/`StartLimitIntervalSec=60`
  (back off a crash loop instead of hammering vendors). A clean drain exits 0 →
  **no** restart; `uncaughtException` exits 1 → restart.
- **Graceful-stop alignment:** `KillSignal=SIGTERM` + `TimeoutStopSec=30`. The
  relay drains on SIGTERM (close `1001 server_restart` → flush usage → finalize →
  exit 0) bounded by `SHUTDOWN_GRACE_MS` (default **20000 ms**). `TimeoutStopSec`
  (30s) is deliberately **> SHUTDOWN_GRACE_MS** so the drain always finishes before
  systemd escalates to SIGKILL.
- `MemoryHigh=448M` / `MemoryMax=512M` cgroup guard; hardening
  (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, restricted address
  families, etc.).

```bash
sudo systemctl restart stt-relay        # triggers a graceful drain of the old PID
sudo systemctl stop stt-relay           # SIGTERM → drain → exit 0 within 30s
journalctl -u stt-relay -f              # structured JSON logs
```

> If you change `SHUTDOWN_GRACE_MS` above ~25s, raise `TimeoutStopSec` (and the
> compose `stop_grace_period` / Fly `kill_timeout`) to stay strictly larger.

---

## 8. Health checks

| Endpoint | Meaning | Who probes it |
|---|---|---|
| `GET /healthz` | **Liveness.** Always `200 {status:'ok', relay_id, region, uptime_s}` when the process is up + event loop responsive. | Docker `HEALTHCHECK`, systemd `ExecStartPost`, container orchestrators. A `/healthz` failure means *restart the process*. |
| `GET /readyz` | **Readiness.** `200 {status:'ready'}` only if: token secret present AND ≥1 Deepgram key available AND (Supabase configured ⇒ client constructed) AND live sessions < `MAX_CONCURRENT_WS` AND **not draining**. Else `503 {status:'not_ready', reasons[]}`. | The control-plane health checker + any LB. A `/readyz` 503 means *stop sending NEW sessions here* (route to the other region); in-flight sessions continue. Do **not** restart on a 503 alone. |
| `GET /metrics` | JSON counters (active sessions, by-provider, per-IP map size, usage-queue depth, provider health, deepgram-keys-available, close-code histogram, bytes, draining) — no secrets/PII. | Prometheus scrape / dashboards. |

`deploy/healthcheck.sh` curls both and distinguishes the cases:

```bash
bash deploy/healthcheck.sh                                   # localhost:8080
RELAY_URL=https://us-relay.natively.software bash deploy/healthcheck.sh
# exit 0 = live + ready ; exit 1 = DOWN (restart) ; exit 2 = alive but not ready (route away)
```

**Why the distinction matters for the LB:** a draining relay (during a deploy) is
*alive* (`/healthz` 200) but *not ready* (`/readyz` 503). The control plane sheds
new sessions to the healthy region while the draining relay finishes its in-flight
work — a graceful, lossless rollout. Restarting on a 503 would kill that.

---

## 9. Cloudflare DNS

| Setting | Value | Why |
|---|---|---|
| Record type | `A` (required) + `AAAA` (optional) | client resolver is IPv4-only (§3). |
| Proxy status | **DNS only (grey cloud)** | TLS issuance + keep audio off CF's proxy (§3). |
| TTL | `Auto` (CF ≈ 300s) or `300` | short enough to re-point quickly during a rollback (§11), long enough to avoid resolver churn. |
| Names | `us-relay.natively.software`, `asia-relay.natively.software` | match `CADDY_SITE` / certbot `-d` / the control plane's `STT_RELAY_US_URL`/`STT_RELAY_ASIA_URL`. |

After creating records, confirm they resolve to the VPS (not a CF proxy IP):

```bash
dig +short A us-relay.natively.software      # → the VPS IPv4, NOT 104.x/172.x CF ranges
dig +short A asia-relay.natively.software
```

---

## 10. Optional Cloudflare Load Balancer (later)

**We deliberately START DNS-only** and add an LB only when DNS-level failover or
multi-box-per-region pooling is actually needed (docs/01 §13). Rationale: the
control plane's health cache (`GET /v1/stt/relays`, 15s TTL) + the client fallback
ladder already ARE the load balancer, with finer, faster control than DNS TTLs —
and DNS-only keeps audio off Cloudflare's network (no per-GB cost, no proxy
limits). Adding the LB before it's needed re-introduces a CF hop and ~$5+/mo for
no benefit.

When/if you do add it (e.g. two boxes per region, or active-passive failover):

- **Pools:** `pool-us` (origin = US VPS IP[s]), `pool-asia` (origin = ASIA VPS
  IP[s]). One origin per box; add a second box to a pool to scale a region.
- **Monitor:** HTTPS health check to **`/healthz`** (liveness; use `/readyz` only
  if you want the LB to also shed on not-ready — but then a deploy-drain ejects the
  origin, which the client ladder already handles, so `/healthz` is usually right),
  interval ~15s, expect `200`.
- **Geo-steering:** steer NA/SA/EU → `pool-us`, APAC → `pool-asia`, with the other
  pool as failover. This duplicates the control plane's region selection at the DNS
  edge; keep the control plane authoritative and treat the LB as belt-and-suspenders.
- **WebSocket support:** Cloudflare LB supports WS, **but** turning the LB on means
  the hostname becomes **orange-cloud (proxied)** — re-introducing the CF audio hop
  and its costs/limits. Only accept that trade for the failover/pooling benefit, and
  re-measure latency + egress cost (§14) afterward.
- **Cost:** Cloudflare LB ≈ $5+/mo base (docs/01 §14) + proxied-traffic
  implications. Negligible vs the VPS savings, but non-zero — hence "later, only
  if needed."

---

## 11. Rollback (layered)

Rollback is layered, fastest-first. **No client redeploy is ever needed** — the
client already caches a `fallback_chain` ending at Railway.

1. **Instant kill switch (control plane, seconds, no deploy)** — the primary
   rollback. POST the runtime control route (docs/04 §3.3):

   ```bash
   curl -X POST https://api.natively.software/admin/stt-relays/control \
     -H "x-admin-secret: $ADMIN_SECRET" -H 'content-type: application/json' \
     -d '{"kill_switch": true}'
   # → next POST /v1/stt/session returns {mode:"railway"}; new sessions take the
   #   UNCHANGED Railway /v1/transcribe path. In-flight relay sessions finish or
   #   drain (1001). Runtime overrides are NOT persisted — also set
   #   STT_RELAY_KILL_SWITCH=1 in the Railway env to survive a restart.
   ```

   To roll back ONE region only, steer away instead of killing globally:
   `{"force_region": "us"}` (pins everyone to US while asia is investigated), or
   drop the bad region's URL env so `GET /v1/stt/relays` marks it permanently
   unhealthy.

2. **Reduce/zero the rollout** — `STT_RELAY_ENABLE_PERCENT=0` (Railway env, or
   `{"enable_percent": 0}` via the control route) sends all relay-eligible users
   back to Railway deterministically without the hard kill-switch semantics.

3. **Stop the relay process** (if a specific box is misbehaving) — graceful:
   `sudo systemctl stop stt-relay` (or `docker compose down`). Existing sessions
   get `1001` and reconnect via the ladder; `/readyz` was already 503 so the
   control plane stopped routing new sessions first.

4. **Revert DNS** (last resort, slowest) — only if the box itself is compromised
   and you can't reach it: lower the record TTL ahead of time, then point
   `us-relay`/`asia-relay` away or delete it. With kill-switch already engaged,
   new sessions never resolve the relay anyway, so DNS revert is rarely on the
   critical path.

**Order of operations for an incident:** kill switch (1) → confirm Railway-fallback
share rises and relay session-creates drop (PostHog/Axiom) → then stop/inspect the
relay (3) → fix → re-enable percent (2) → drop the kill switch.

---

## 12. Secret rotation

### `STT_SESSION_TOKEN_SECRET` (dual-key, zero-downtime)

The relay verifies tokens against `STT_SESSION_TOKEN_SECRET` **and** (during a
window) `STT_SESSION_TOKEN_SECRET_PREV`. The control plane **signs** with its
single current secret. The invariant to preserve: **the control plane must never
sign with a secret the relays don't yet accept.** So always teach the relays the
new secret BEFORE the control plane starts signing with it. Order (zero-downtime):

1. **Relays accept BOTH (new primary, old prev).** On every relay set
   `STT_SESSION_TOKEN_SECRET=<new>` and `STT_SESSION_TOKEN_SECRET_PREV=<old>`,
   then deploy/restart. Relays now verify NEW-signed tokens (primary) **and**
   still verify OLD-signed tokens (prev). The control plane is still signing with
   OLD at this point — those tokens verify via the prev slot, so nothing breaks.
2. **Flip the control plane to sign NEW.** Set the Railway control plane's
   `STT_SESSION_TOKEN_SECRET=<new>`. Every freshly minted token is now NEW-signed
   and verifies immediately against the relays' primary slot. Tokens minted just
   before the flip (OLD-signed, TTL ≤ 300s) still verify via prev.
3. **Drop PREV.** After one token-TTL window (≥5–10 min, so every OLD-signed token
   has expired), unset `STT_SESSION_TOKEN_SECRET_PREV` on every relay and
   deploy/restart. OLD-signed tokens are now rejected (`invalid_key_format` →
   client re-POSTs session → gets a NEW-signed token). Rotation complete; both
   relays and the control plane hold only `<new>`.

> At no point is a freshly-signed token un-verifiable: the relays learn NEW (step 1)
> strictly before the control plane signs NEW (step 2), and keep OLD as prev until
> every OLD token has expired (step 3). Roll the steps back (re-add PREV, re-sign
> OLD) if anything looks wrong mid-rotation.

### Provider keys (Deepgram / ElevenLabs / Google / Supabase)

These are verify-free on the relay (used to dial vendors), so rotation is simple
and per-relay:

- **Deepgram/ElevenLabs:** add the new key as `DEEPGRAM_API_KEY_5` (or any free
  pooled slot) alongside the old, deploy, confirm `/metrics`
  `deepgram_keys_available` reflects it, then remove the old key on the next
  deploy. The pool tolerates a mix.
- **Google:** swap `GOOGLE_CREDENTIALS_JSON` (single-line service-account JSON) +
  `GCP_PROJECT_ID`, deploy. Invalid creds boot the Google slot disabled (chain
  degrades to deepgram→elevenlabs), so a bad rotation is non-fatal.
- **Supabase service-role key:** rotate in Supabase, update
  `SUPABASE_SERVICE_KEY` on every relay, deploy. The relay reconstructs its client
  at boot. Keep the key scoped to `stt_*` only.

Rotate **all relays together** so the control plane and relays never disagree on
the token secret.

---

## 13. Sentry release

- Set `SENTRY_DSN` per relay (optional; no-op when unset). Tags: `relay_id`,
  `region`, `release`. **No PII** — session ids only, no raw keys, no transcript
  text, hashed IPs (F1/F9).
- **Version source:** the boot banner + Sentry release use
  `npm_package_version` (the systemd unit sets `Environment=npm_package_version=0.1.0`;
  `npm start`/Docker `CMD node src/index.js` inherits it from package.json when run
  via npm, else falls back to `0.1.0`). Bump `services/stt-relay/package.json`
  `version` on each release so deploys are distinguishable.
- **Tag a release on deploy** (CI or manual):

  ```bash
  REL="stt-relay@$(node -p "require('./services/stt-relay/package.json').version")-$(git rev-parse --short HEAD)"
  sentry-cli releases new "$REL"
  sentry-cli releases set-commits "$REL" --auto
  sentry-cli releases finalize "$REL"
  # then set the same REL string as the relay's `release` (via SENTRY_RELEASE env
  # if you wire it, or rely on package.json version + the commit in the deploy log).
  ```

  Release health (crash-free sessions) then attributes regressions to the exact
  build per region.

---

## 14. Axiom dataset

- Set `AXIOM_TOKEN` + `AXIOM_DATASET=stt-relay` per relay (optional; silent no-op
  when unset). The relay ships **batched, ≤1 event/session/flush** (never
  per-chunk): `session_summary` (on finalize), `provider_error`, `cost_guard`,
  `health_event` (docs/01 §12).
- **Dataset name:** `stt-relay` for relay-emitted events. Keep both regions on the
  same dataset and filter by the `region`/`relay_id` fields (every event carries
  them) so you can compare US vs Asia in one query.
- **Control-plane logs (Phase 8):** the Railway control plane drains its logs to
  Axiom separately (the Railway → Axiom log drain). Those land in the control
  plane's own dataset (e.g. `natively-api` / `railway`), **not** `stt-relay` —
  keep them distinct so relay session events and control-plane request logs don't
  intermix. Cross-reference by `session_id`.
- **Verify ingestion:** after starting a relay and running one session, query the
  `stt-relay` dataset for a `session_summary` event with the matching
  `relay_id`/`region` in the last few minutes. No events for a configured token ⇒
  check `AXIOM_TOKEN` scope (ingest permission on `stt-relay`).

---

## 15. PostHog events verification

- **Client events (Phase 7)** are emitted by the Electron app, not the relay:
  `stt_relay_selected {region, mode}`, `stt_relay_connected {region, ms}`,
  `stt_relay_failed {region, stage, code}`, `stt_fallback_used {from, to}`,
  `stt_first_transcript_bucket {<1s,1-2s,2-5s,>5s}` (docs/01 §5.5, §12).
- **The relay's own** `POSTHOG_API_KEY` (optional) is for any relay-side event
  shipping; the rollout funnel that matters is the **client** funnel.
- **Confirm they land:** in PostHog, build a funnel
  `stt_relay_selected → stt_relay_connected → stt_first_transcript_bucket`,
  filtered by `region`. During dogfood/1% you should see:
  - `stt_relay_selected {mode:"relay"}` for relay-eligible users (vs `mode:"railway"`
    when kill switch on / 0%);
  - `stt_relay_connected` following selection with a small `ms`;
  - `stt_fallback_used` rare (the ladder is exercised only on failure).
  A whole class missing (e.g. zero `stt_relay_connected` after `selected`) points
  at DNS/region routing/captive-portal issues the server can't see — exactly what
  the client funnel is for.

---

## 16. Confirming the relay is receiving traffic

Three independent signals:

**a) `/metrics` (live, no auth needed for read — but it's behind Caddy):**

```bash
curl -fsS https://us-relay.natively.software/metrics | python3 -m json.tool
# look for:  active_sessions > 0,  sessions_by_provider.deepgram > 0,
#            bytes_in_total / bytes_out_to_deepgram_total climbing,
#            deepgram_keys_available >= 1,  draining=false
```

**b) Axiom `session_summary` events** — query the `stt-relay` dataset for recent
events with this `relay_id`; a steady trickle on finalize confirms real sessions
completing (and carries the billed seconds, close code, provider used).

**c) End-to-end smoke against `/v1/transcribe`** with a **real control-plane-issued
token** (the relay verifies offline; you cannot hand-craft one without the HMAC
secret, which is the point):

```bash
# 1) Mint a session token from the control plane (uses a valid key/trial token):
TOKEN_JSON=$(curl -fsS -X POST https://api.natively.software/v1/stt/session \
  -H 'content-type: application/json' \
  -d '{"key":"<a valid api key>","channel":"system","region":"us"}')
TOKEN=$(echo "$TOKEN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
RELAY=$(echo "$TOKEN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["relay_url"])')

# 2) Connect + send the auth frame, then a little silence, and read frames.
#    Using wscat (npm i -g wscat):
wscat -c "$RELAY"
# > paste:  {"session_token":"<TOKEN>","sample_rate":16000,"language":"en-US","audio_channels":1,"channel":"system"}
# expect:   {"status":"connected","provider":"deepgram","quota":{...}}
#    (then send binary PCM to see transcripts; the connected frame alone proves
#     offline token verify + provider connect succeeded.)
```

A minimal Node smoke (no wscat) is equivalent: open `ws` to `relay_url`, send the
JSON auth frame, assert the first message is `{"status":"connected"}`. If you get
`invalid_key_format` the token is bad/expired/wrong-region; `auth_required` means
you sent a legacy `key`-only frame; `auth_timeout` means you didn't send the JSON
frame within 5s.

---

## 17. Disabling relays / falling back to Railway

Ordered for zero user-visible disruption (Railway `/v1/transcribe` is byte-for-byte
unchanged and always available — migration invariant §16.2):

1. **Kill switch FIRST** (control plane): `POST /admin/stt-relays/control
   {"kill_switch": true}` (runtime, instant) **and** set
   `STT_RELAY_KILL_SWITCH=1` in the Railway env (survives a restart). New
   `POST /v1/stt/session` → `{mode:"railway"}`. This stops *new* relay sessions
   immediately.
2. **Zero the rollout** (defense in depth): `STT_RELAY_ENABLE_PERCENT=0` (Railway
   env). Even if the kill switch were cleared, 0% routes everyone to Railway
   deterministically.
3. **Confirm the client safety hatch** is intact: the
   `regional_stt_railway_fallback` (`sttRailwayFallbackEnabled`) client flag must
   be **true** (its default) so the ladder's step 3 (Railway) is reachable. Only
   ever set it false for deliberate relay-isolation testing — never during a
   real fallback.
4. **Let in-flight relay sessions drain** — they finish naturally, or
   `systemctl stop stt-relay` / `docker compose down` sends `1001 server_restart`
   and clients reconnect via the ladder onto Railway. `/readyz` is already 503 so
   no new sessions are routed mid-drain.
5. **(Optional) stop the relay boxes** once traffic is confirmed on Railway
   (PostHog: `stt_relay_selected {mode:"railway"}` share ≈ 100%; relay `/metrics`
   `active_sessions` → 0). DNS can stay (harmless with the kill switch on) or be
   reverted last.

**Re-enabling** reverses the order: start relays → confirm `/readyz` ready →
raise `STT_RELAY_ENABLE_PERCENT` per the rollout stages (§15 in docs/01) → clear
the kill switch.

---

## Validation performed (this phase)

Offline-only environment (no Docker/Caddy/Nginx/systemd/flyctl/shellcheck
available; Node v25 only). What was checked vs deferred:

| Artifact | Validation run here | Result | Deferred to real infra |
|---|---|---|---|
| `deploy/healthcheck.sh` | `bash -n` | **PASS** | run against a live relay |
| `deploy/setup-vps.sh` | `bash -n` | **PASS** | full run on a fresh Ubuntu box (apt/Node/Caddy/Docker installs, ufw) |
| `docker-compose.example.yml` | parsed with `js-yaml`; asserted services, relay-has-no-public-`ports`, Caddy-`depends_on`-healthy, `stop_grace_period`, `mem_limit` | **VALID** | `docker compose config` / `up` |
| `fly.us.toml`, `fly.asia.toml` | parsed with `@iarna/toml`; asserted `app`/`primary_region`/`env.REGION`/`internal_port`/`force_https`/`min_machines`/`concurrency`/`checks`/`kill_*` | **VALID** (caught + fixed a real bug: `kill_signal`/`kill_timeout` were after `[[vm]]` → silently misnested; moved to top-level) | `fly deploy` / `fly config validate` |
| `Dockerfile` | structural review against the `file:` link layout + lockfile (`../../packages/stt-relay-core` resolution confirmed); manifests-first cache order; non-root `node` user; tini PID 1; HEALTHCHECK; multi-stage | reviewed | `docker build -f services/stt-relay/Dockerfile natively-api/` + `hadolint` |
| `Caddyfile.example` | structural review (env-var substitution, WS pass-through, long-stream timeouts, security headers, encode scoped to health paths) | reviewed | `caddy validate` |
| `nginx.example.conf` | structural review (Upgrade/Connection map, long `proxy_read_timeout`, certbot steps) | reviewed | `nginx -t` |
| `stt-relay.service` | structural review (`TimeoutStopSec` 30 > `SHUTDOWN_GRACE_MS` 20s, `Restart=on-failure`, `EnvironmentFile`, hardening) | reviewed | `systemd-analyze verify` |
| Secret scan | grep for key/cert/jwt patterns across all deploy files | **clean** (only `REPLACE_*` / `...` placeholders) | — |

**WS path note:** the relay's WebSocket route is `/v1/transcribe` (confirmed in
`src/server.js`), not `/ws`; Caddy/Nginx/Fly and the smoke test all target
`/v1/transcribe`.
