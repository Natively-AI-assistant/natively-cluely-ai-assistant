# Natively — Backend (natively-api) Security & Stability Audit (Phase 3)

_Production-hardening audit, 2026-07-11._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; the cited fix (a separate git submodule, unaffected
> by the branch incident) was independently re-verified still present.

**Important scoping note.** `natively-api/` is a **separate git submodule**
(`github.com/evinjohnn/natively-api`) deployed on Railway. Fixes here land in
that repo/deploy, not the desktop app. The STT relay (`services/stt-relay/`)
is a further separate service with its own Dockerfile.

All findings below were **verified against the real `server.js`** (~10.7k
LOC) by an adversarial verifier before action.

## Fixed

### [P2 — FIXED] Main WebSocket server had no `maxPayload` (100MB default)

**File:** `natively-api/server.js` (websocket registration).

**Problem.** `await app.register(websocket)` registered `@fastify/websocket`
with **no options**, so it inherited the `ws` `WebSocketServer` default
`maxPayload` of **100MB**. Every WS frame is fully assembled in the heap
**before** the app's own 64KB per-chunk guard (`processChunk`) can reject it.
A flood of oversized frames could balloon memory pre-decode. The STT
**relay** already caps this at 1MB (`services/stt-relay/src/server.js`); the
main server did not.

**Fix.** `await app.register(websocket, { options: { maxPayload: 1 << 20 } })`
— bounds the receive buffer at 1MB (matching the relay), well above
legitimate PCM frames (~3840B for 48kHz stereo/20ms). Oversized frames now
get a protocol-level 1009 close instead of a large allocation. `node --check`
passes.

**Note.** Dead sibling files `server_local.js` and `servertobeupgraded.js`
(not the deployed `"start": "node server.js"` entrypoint) share the same
omission but are **not deployed** — left as-is (dead code).

## Verified good — REFUTED claims (no fix needed)

### [REFUTED — P0 downgraded] `.env` "committed secrets"
`natively-api/.env` is **NOT git-tracked** and **NOT in git history**;
`natively-api/.gitignore` lists `.env`. The desktop repo's `.env` is likewise
gitignored. Real residual risk is local file hygiene + the desktop
`electron-builder` `files` array lacking an explicit `!**/.env` exclude
(fixed in Phase 4/8), not a committed leak.

### [REFUTED] Admin endpoints returning the key / weak auth
- `/admin/create-key` does return the freshly-generated `natively_sk_…` key
  in its response — **by design** for an admin-only endpoint.
- `/admin/resend-key` does **not** return the key (emails it via Resend).
- Both are gated by `checkAdminSecret` using SHA-256 + `timingSafeEqual`
  (length-safe, constant-time).
- `/admin/*` **is** rate-limited: the global limiter (120/min) only skips
  WebSocket upgrades — admin routes are bucketed by IP.
No missing control. (The only real risk is `ADMIN_SECRET` strength/rotation —
an ops concern, not a code bug.)

### [REFUTED] Forgeable trial tokens in prod
`TRIAL_JWT_SECRET` defaults to a dev value but the fatal `process.exit(1)`
fires when `NODE_ENV === 'production' || !!RAILWAY_ENVIRONMENT`. The
deployment is Railway (`railway.toml` present), which injects
`RAILWAY_ENVIRONMENT`, so a prod boot with a missing/default secret exits(1)
— the "NODE_ENV unset" gap is covered by the `RAILWAY_ENVIRONMENT`
disjunct. `parseTrialToken` additionally uses length-checked
`timingSafeEqual`.

## Noted for ops (not code fixes)

- `trustProxy` default is the safe `loopback/linklocal/uniquelocal`; the
  `NATIVELY_TRUST_PROXY_HOPS` escape hatch is documented-unsafe — **never
  set it** in production.
- STT relay `TRUST_PROXY_HEADER` must stay empty in production.
- Google Calendar OAuth proxy is auth-gated but has no per-user rate limit —
  a paid user could burn Google API quota. Low priority.
- `registerWebhookRoute` awaits the Supabase idempotency upsert before
  replying 200 (correct durability tradeoff); should be SLO'd so a slow
  Supabase incident doesn't trip Dodo's 15s webhook timeout.
