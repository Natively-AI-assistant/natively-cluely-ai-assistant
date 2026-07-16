# Natively — Electron Security Audit (Phase 2)

_Production-hardening audit, 2026-07-11._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; the cited fix was independently re-verified present in
> the final working tree before this file was rewritten.

Scope: BrowserWindow creation, webPreferences, preload surface, IPC validation,
`shell.openExternal`, navigation, protocols, custom-provider execution.

## Baseline (verified good — no change needed)

| Control | Status | Evidence |
|---------|--------|----------|
| `nodeIntegration: false` on every window | ✅ | WindowHelper.ts, SettingsWindowHelper.ts, ModelSelectorWindowHelper.ts, CropperWindowHelper.ts |
| `contextIsolation: true` on every window | ✅ | same sites |
| `webSecurity` only disabled in dev | ✅ | WindowHelper.ts `webSecurity: !isDev` |
| Preload is a single shared typed bridge | ✅ | preload.ts contextBridge surface |
| `open-external` IPC validates scheme | ✅ | ipcHandlers.ts — allows only `https:` + macOS `x-apple.systempreferences:`; blocks everything else with a logged reason |
| Custom LLM provider URL is SSRF-guarded | ✅ | LLMHelper.ts `validateUrlForSsrf(url)` before the request |
| Custom-curl "shell injection" | ✅ **REFUTED** | `curlCommand` is parsed by `@bany/curl-to-json` into a config object and used via axios/fetch — never shell-`exec`ed |
| Streamed-LLM-HTML XSS via innerHTML | ✅ **REFUTED** | `NativelyInterface.tsx`: `node.innerHTML = DOMPurify.sanitize(marked.parse(...))` — DOMPurify (v3) imported with safe defaults, no weakening config anywhere; no `dangerouslySetInnerHTML` anywhere in `src/` |

## Findings & fixes

### [P1 — FIXED] SSRF via STT region / base-URL injection

**Problem.** The renderer-supplied Azure/IBM **region** and the OpenAI-STT
**base URL** were stored unvalidated and then interpolated into the
**hostname** of the app's own outbound, API-key-bearing STT request:

- `RestSTT.ts` `https://${region}.stt.speech.microsoft.com/...` (live path)
- `RestSTT.ts` `https://api.${region}.speech-to-text.watson.cloud.ibm.com/...`
- `ipcHandlers.ts` — same interpolation in `test-stt-connection`
- OpenAI STT base URL stored verbatim (`CredentialsManager.setOpenAiSttBaseUrl`)

A regressed/hostile renderer could set `region = "evil.com/x#"` (or a
loopback/private base URL) and redirect the user's STT key to an attacker
host. The custom **LLM** provider URL was already SSRF-guarded; STT was the
open gap.

**Fix.**
- New validators in `electron/utils/curlUtils.ts`:
  - `isValidSttRegion()` — accepts only real region slugs
    `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤40 chars; empty allowed (default region).
  - `validateSttBaseUrl()` — reuses the existing `validateUrlForSsrf()`
    (blocks loopback/private/non-HTTPS).
- Enforced at every boundary:
  - IPC setters `set-azure-region`, `set-ibmwatson-region`,
    `set-openai-stt-base-url` — reject with a clear error, never silently
    store.
  - `test-stt-connection` (defense in depth) rejects a bad region before
    building the URL.
  - `RestSTT` constructor (defense in depth) drops a malformed region → falls
    back to the safe default region.
- **Test**: `electron/utils/__tests__/sttEndpointValidation.test.mjs` — 28
  cases (real slugs pass; host-injection payloads and private/loopback URLs
  blocked).

## Deferred (documented, not fixed this pass)

### [P2 — defense-in-depth, not applied] Missing window-level navigation guards

No `setWindowOpenHandler`/`will-navigate`/`will-redirect` guard exists on any
BrowserWindow. With `contextIsolation` on and a restrictive CSP,
exploitability is low, but a renderer compromise or errant `window.open` isn't
blocked at the window layer. Adding a `setWindowOpenHandler` returning `{
action: 'deny' }` (routing safe URLs through the already-hardened
`open-external`) plus a `will-navigate` origin guard is the right shape, but
needs care not to break the dev-server URL retry and OAuth flows — deferred
to a dedicated follow-up rather than rushed mid-audit.

### [P2/P3 — defense-in-depth] `__e2e__:*` handlers incl. `enable-pro`

`ipcHandlers.ts` registers the E2E harness only when `process.env.NATIVELY_E2E === '1'`.
Verified this env var is set only in `scripts/e2e/*` harnesses, never in any
build/packaging path. Reclassified from an initial P0 concern to
defense-in-depth. Recommend adding a packaged-build assertion that
`NATIVELY_E2E` is unset in production (tracked under Phase 8/10 follow-ups).

## Working-tree stray (flagged to user during the session, not fixed)

`index.html` had an uncommitted local `<script src="http://localhost:7331/inject.js">`
dev timeline injector at the start of this session — not committed, and the
CSP would block it in prod anyway (`connect-src`/`script-src` don't list
`localhost:7331`). Left untouched as clearly the user's own local dev
tooling; flagged directly to the user rather than silently modified.
