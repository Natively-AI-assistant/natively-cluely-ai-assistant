# Natively API Audit — 2026-05-04

Server lives in `natively-api/` (single ~6k-line `server.js` + `lib/queryClassifier.js`). Submodule with public remote `github.com/evinjohnn/natively-api`. All path:line refs are inside `natively-api/`.

## Critical (fix now)

- **Telegram bot webhook accepts spoofed requests** — `server.js:4693-4831`. `/webhooks/telegram` only checks `message.chat.id === TG_CHAT`. Chat IDs are not secrets; anyone POSTing `{message:{chat:{id:TG_CHAT},text:"/subscribers"}}` triggers the handler, which queries `api_keys` + `pro_licenses` and returns full email/plan/status to Telegram. **Fix:** require `X-Telegram-Bot-Api-Secret-Token` header equal to a `TG_WEBHOOK_SECRET` env, set the same value via `setWebhook`.

- **Raw API keys in logs** — `server.js:4371`. `sk = ${key}:${channel}` for paid users, then `session=${sk}` is logged in dozens of places (Deepgram, Google STT, ElevenLabs, billing, errors). Railway log retention = customer-key compromise. **Fix:** hash or truncate `key` before forming `sk`; e.g. `sk = ${key.slice(0,16)}…:${channel}`.

- **API keys committed to public repo** — `tests/exhaustion.test.mjs:12`, `tests/test-new-email.mjs:13`, `tests/stress-test.mjs:370,620`, `scratch/inspect_api_key.js:10`, `scratch/reset_stt.js:10`. Real-shaped 40-char keys (`natively_sk_HSSP1bxyjuWa934r7ysZsIUqttI9aypGgQWeHBUK` etc.) committed to the public submodule. **Fix:** rotate any of these still active in `api_keys`, move to `.env`, add to `.gitignore`, scrub git history.

## High

- **`TRIAL_JWT_SECRET` falls back to hardcoded string** — `server.js:1280-1284`. Default `'natively_dev_trial_secret_change_in_prod'` is checked into the repo; only `console.warn` if env unset. Any deploy missing the env lets an attacker forge `parseTrialToken` payloads with arbitrary `id`/`exp` and bypass HMAC, granting unlimited free quota. **Fix:** hard-fail (`process.exit(1)`) on missing `TRIAL_JWT_SECRET` in production.

- **Unauthenticated Google OAuth proxy** — `server.js:3040, 3063`. `/api/calendar/exchange` and `/api/calendar/refresh` accept `code`/`refresh_token` from anyone, exchange via `GOOGLE_CLIENT_SECRET`, return tokens raw. Lets anyone replay a stolen refresh_token through your server, hides their IP behind your egress, and burns Google quota. **Fix:** require valid API key / trial token, rate-limit per identity.

- **`/v1/chat/completions` swallows AI response on billing failure** — `server.js:2885-2899`. AI call succeeds, `billAI` throws, the outer `catch` returns 503 — user gets nothing AND nothing is billed. Provider credits burned, customer hits retry storm. **Fix:** mirror `/v1/chat`'s pattern (line 2845): try/catch billAI separately, always return content if AI call succeeded.

- **`process.on('unhandledRejection')` does not exit** — `server.js:47-49`. Promise rejections from background fire-and-forget code (webhook persistence, audit-field updates, marketing emails) leave the process in undefined state. Comment at line 50 says uncaught exceptions exit, but unhandled rejections silently log and continue. **Fix:** treat both the same; otherwise document why divergence is intentional.

## Medium

- **Webhook secret validation logs but doesn't fail-fast** — `server.js:104-111`. Missing secret prints `[FATAL]` to console but server still starts and silently rejects every Dodo webhook with 401. Revenue loss invisible until support ticket. **Fix:** `process.exit(1)` if either secret missing; or alert via Telegram on first webhook reject.

- **Deprecated `/webhooks/dodo` is unauthenticated and Telegram-spammable** — `server.js:4685-4690`. No signature check, fires `tgAlert` per request. Anyone hitting the URL can flood your Telegram channel. **Fix:** verify signature before alerting, or just delete the route.

- **Per-IP trial logs leak PII to Telegram** — `server.js:2610`. `tgAlert(...ip=${ip})` and similar console logs make raw user IPs durable in chat history + Railway logs. Same for HWID prefix at line 2610. **Fix:** hash IP before logging (you already compute `ipHash`).

- **`/v1/chat` accepts `images` with no per-image byte cap** — `server.js:2766-2768`. `slice(0,4)` caps count but each can fill the 4 MB body. Memory pressure / Groq Scout token blow-up under concurrent requests. **Fix:** validate `img.data.length` per image.

- **Per-route webhook idempotency Maps have no TTL eviction** — `server.js:4606`. `routeProcessedIds` only evicts on insertion-order overflow at `WEBHOOK_ID_MAX=10000`. A low-volume endpoint can keep entries from days ago indefinitely; not a bug, but `WEBHOOK_ID_TTL` is referenced and unused for memory cleanup. **Fix:** add to housekeeping sweep at `server.js:1005`.

- **`/v1/embed` duplicates billing instead of using `billAI()`** — `server.js:2911-2916`. Calls `supabase.rpc('increment_ai_requests', ...)` directly + manual cache mutation. Drift risk: the `billAI` helper has trial-fallback logic and proper error paths; this path doesn't. **Fix:** call `billAI(auth)` (and reject trial users with 403 explicitly rather than relying on validateKey rejecting `__trial__`).

- **`gracefulShutdown` does not bound DB/HTTP work** — `server.js:5959-5985`. Awaits `app.close()` then sleeps 10 s; in-flight `setImmediate(() => handler(...))` from webhook ack at line 4672 is not tracked, can be cut mid-DB write on Railway redeploy → orphaned `pro_licenses`/`api_keys` rows. **Fix:** track pending webhook handlers, await them.

## Low / nits

- **`/health` is unauthenticated and reveals key-pool sizes + provider state** — `server.js:2442`. Useful info for an attacker timing pool-exhaustion abuse. Acceptable for ops; minimum: don't include numeric pool counts.

- **`getEmbedding` documentation contradicts implementation** — `server.js:2321-2336` claims `gemini-embedding-001` is primary; `2369-2376` calls `text-embedding-004` first. Pick one and align.

- **Validate-key audit-update race** — `server.js:1596-1605`. `total_requests = (user.total_requests||0)+1` is read-modify-write; concurrent requests lose counts. Counter is described as "rough" so OK; mention only because the comment says "fine for non-critical" but `last_used_at`/`last_used_ip` from concurrent requests can also race. Use `supabase.rpc('increment_total_requests', ...)`.

- **Provider 5-min recover timer races with `markFailed` re-entry** — `server.js:674-677, 643-646`. Calling `markFailed` again before recovery schedules a second `setTimeout`. Both eventually run; second overwrite is harmless but creates orphan handles. Use a single shared `disabledUntil` + lazy check on next request.

- **`validateKey`'s `keyCache` doesn't refresh `quota.resets_at` after `maybeResetQuota`** — `server.js:1572-1581`. The cached path returns the original `buildQuota(u)` snapshot. After a 30-s TTL the next miss re-fetches; transient stale `quota_resets_at` not exploitable but visible in `/v1/usage`.

- **`createGoogleSTTSession` buffers 30 s of PCM but uses 15 s in `BUFFER_BYTES`** — `server.js:803`. Comment says 15 s ring; the failover replay buffer at `server.js:4430` allocates 30 s. They're independent, but the comment-vs-code mismatch on the GoogleSTT ring would burn the next reader.

- **Trial fallback uses `auth.trial.ai_used` from cached snapshot** — `server.js:1413-1417`. If RPC missing, the conditional update writes `cached_value + 1` rather than `ai_used + 1`. Concurrent calls can still collide and over/undershoot. The `.lt('ai_used', 10)` guard mitigates but doesn't fix. Already documented inline at line 1469-1470.

## Dead code

- **`extractNewWords`** — `server.js:754-769`. Comment at line 795 says replaced by raw replace; function never called.
- **`isWebhookAlreadyProcessed` / `markWebhookProcessed` / global `processedWebhookIds`** — `server.js:488, 496, 529`. Replaced by per-route `routeProcessedIds` in `registerWebhookRoute`. Global Map is allocated and swept in housekeeping (line 1075-1080) but never read/written by handlers.
- **Top-level comment block at server.js:13-19** documents `DODO_STARTER_PRODUCT_ID` etc. but the actual env var read is `DODO_STARTER_PRODUCT_ID` at line 1112 (matches), `DODO_DEVELOPER_PRODUCT_ID` mentioned in comment is **never read** anywhere — the code uses `DODO_MAX_PRODUCT_ID`/`DODO_ULTRA_PRODUCT_ID` instead. Stale doc.
- **`hasAvailableElevenLabsKey` / `hasAvailableDeepgramKey`** — used (kept here only because the names look orphan-like; verified live).

## Notes

- **CORS `origin: true`** (line 116) reflects any Origin header. For an API consumed by an Electron app + native Rust client this is fine; mention only because a future browser SPA would need this tightened.
- **`app = Fastify({ trustProxy: true })`** trusts `X-Forwarded-For`. Correct on Railway; if the deploy ever moves behind a non-Envoy proxy that doesn't strip client-supplied XFF, IP-based DDoS / trial-rate gates can be spoofed.
- **`validateKey` issues a fire-and-forget audit-field UPDATE on every cache miss** (line 1596). At 30 s cache TTL × N keys × M restarts/redeploys this is a steady write storm; if you ever hit Supabase row-level write rate limits, cache for longer or batch writes.
- **WS `secondsUsed` accumulation only on `is_final`** (line 3808) is correct, but Deepgram occasionally emits multiple finals with overlapping `duration` after VAD glitches. Spot-check billing for sessions with high `forwarded` count and low transcript content.
- **`recordTavilyUsage` is fire-and-forget** (line 3008). On a Tavily 200-with-zero-results response we still bill the user 1 search credit. Confirm whether Tavily charges on empty results; if not, gate `billSearch` on `data.results?.length > 0`.
- Could not run the server end-to-end inside this audit — the bullets above are static-analysis level. Worth a smoke run with `TRIAL_JWT_SECRET` unset to confirm the trial-token bypass works as suspected.
