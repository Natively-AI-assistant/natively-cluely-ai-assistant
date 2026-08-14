# `/dom` API contract (frozen)

This is the shared source of truth for the desktop `/dom` endpoint the extension
talks to. The desktop side lives in `electron/services/PhoneMirrorService.ts`
(PR #292, plus the window-targeting + session-gate fix) and is verified by a live
HTTP smoke test. The extension is a client of this contract.

## Endpoint

```
POST http://127.0.0.1:<port>/dom?t=<token>
```

| Field | Value |
|-------|-------|
| `port` | DEFAULT `4123`, probe range `4123..4134`. **Discovered at call time** by the extension via `GET /healthz` across the range — NOT stored as truth (the desktop port can drift between launches). The last-known port is kept only as a fast-path hint. |
| `token` | 32-char base64url string (`crypto.randomBytes(24).toString('base64url')`). The **extension token** is loopback-scoped, **persisted on the desktop (encrypted) and stable across restarts** — the extension pairs once, not every launch. It is **SEPARATE from the phone-mirror token** (the phone token is per-session and rides a plaintext-HTTP LAN QR; keeping them separate stops a sniffed LAN token from reaching `/dom`). `/dom` accepts ONLY the extension token; `/ws` accepts either. Regenerated only when the user clicks "Rotate token" (which cycles both and forces one deliberate extension re-pair). |
| `Origin` header | The browser sets `chrome-extension://<id>` automatically. Required for the CORS response to be readable. The desktop echoes `Access-Control-Allow-Origin` for origins matching `^chrome-extension://[a-p]{32}$` (structural) for `/dom`; the one-click `/pair` endpoint requires the EXACT extension ID. |
| `Content-Type` | `application/json` |
| Body | `{"dom": "<string>"}` — raw body hard cap **500,000 bytes** → `413` + socket destroyed. The server then truncates the string to **25,000 chars** (`DOM_CONTEXT_MAX_CHARS`). The extension caps at 25,000 chars before sending. |

## Responses

| Status | Meaning |
|--------|---------|
| `200 {"success":true}` | Accepted. Desktop fires IPC `dom-context-received` → renderer `window.lastCapturedDOM`. |
| `400 Bad Request` | Body wasn't JSON, or had no string `dom`. |
| `401 Pairing token missing or invalid.` | Bad/missing `?t`. This is the real auth gate. With a persisted desktop token this is now rare (only after a deliberate Rotate). The extension **re-resolves the port and retries once** before treating it as a genuine revocation; only a re-probed 401 drops the pairing. |
| `409 {"error":"no_active_session"}` | Natively is running and paired, but there is no active session/overlay to receive the context. The DOM is delivered to the overlay window (the only one that mounts `NativelyInterface`); when no overlay exists the route returns 409 instead of silently dropping. The extension surfaces "Start a Natively session, then capture again". |
| `405 Method Not Allowed` | Non-`POST`. |
| `413 Payload Too Large` | Raw body > 500 KB. |
| `429` | Rate limited (120 req / 60 s per IP). |
| `OPTIONS /dom → 204` | CORS preflight. `Access-Control-Allow-Origin` echoed only for valid `chrome-extension://[a-p]{32}` origins. |

## Auxiliary endpoints

### `GET /healthz` (no auth)
Returns `200 {"ok":true,"clients":N}`. No token, reveals no secret. The extension probes
this across ports `4123..4134` to **discover the live port** (and detect liveness).

### `POST /pair` (one-click pairing)
Hands the extension the token with no copy-paste. Strictly gated:
- **POST** (not GET — a Chrome MV3 service worker reliably sends `Origin` on POST but
  often omits it on GET, which would fail the exact-origin pin). **Loopback caller only**
  (never reachable off-box, even with `exposeOnLan`).
- **Origin must EXACTLY equal a pinned extension ID** (not the structural `[a-p]{32}`
  check). The desktop pins TWO IDs because the Chrome Web Store **re-signs** the published
  extension with Google's own key, giving it a DIFFERENT ID than the unpacked dev build:
    - `chrome-extension://lmhgnkbjnelmciecjkleaomjpejcgaln` — Chrome Web Store build.
    - `chrome-extension://macjecgdfliikhplbbdbpljomcigjnjg` — unpacked dev build
      (deterministic from the manifest `key`).
  Plus an optional `NATIVELY_DOM_EXTENSION_ID` override. A web page cannot forge a
  `chrome-extension://` origin; a different extension won't match any pinned ID.
- **Must be armed**: the user clicked "Connect browser extension" in Settings, which opens
  a 60-second window. **Single-use** — burns on first success.

| Status | Meaning |
|--------|---------|
| `200 {"token","port"}` | Paired. Extension stores the token. |
| `410 {"error":"not_armed"}` | Window not open/expired → user must click "Connect browser extension" in Settings. |
| `403 {"error":"forbidden"}` | Origin/loopback check failed. |

### `ws://127.0.0.1:<port>/ws?t=<token>` (v2 desktop-pull capture trigger)
The extension's service worker opens this WebSocket (same token as `/dom`) and sends a
hello frame `{"type":"hello","role":"extension","v":1}` so the desktop can target it. The
desktop pushes capture commands here; the extension acks over WS and POSTs the content to
`/dom`. This is how a **Natively global hotkey** triggers capture from any focused app
(the old `chrome.commands` hotkey only fired while Chrome was frontmost — removed in v2).

MV3 lifecycle: the SW is kept resident with a `chrome.alarms` 25s heartbeat that re-opens
the WS; it reconnects on close. If the SW is briefly dead, the desktop's short capture
timeout falls back to a screenshot — capture never silently no-ops.

**Desktop → extension** (only to `role:'extension'` clients):
| Message | Meaning |
|---|---|
| `{type:'capture-dom', reqId, tabId?}` | Capture the active tab (or `tabId`), POST to `/dom` with this `reqId`. |
| `{type:'list-tabs', reqId}` | Reply with the open-tab list (multi-tab picker). |

**Extension → desktop** (small control frames; content goes via `/dom`):
| Message | Meaning |
|---|---|
| `{type:'capture-ack', reqId, status:'started'|'posting'|'done'|'error', error?}` | Progress; `started` extends the desktop deadline, `error` fails it fast. |
| `{type:'tabs', reqId, tabs:[{id,title,url}]}` | The open-tab list. |

The `/dom` POST body gains optional `reqId` (correlation) and `meta:{title,url,source,pageType,firstLine}` (the desktop preview chip + capture confirmation). Both backward-compatible.

## Preconditions

- **Phone Mirror must be RUNNING.** `/dom` is a path on PhoneMirrorService's HTTP
  server. If Phone Mirror is off, the connection is refused (`fetch` rejects).
  The extension surfaces this as "Open Natively and enable Phone Mirror".
- **An active Natively session (overlay) must exist.** The DOM is delivered to the
  overlay window. With no active session the route returns `409` (see above); the
  extension tells the user to start a session first.
- **The desktop READS-AND-CLEARS** `window.lastCapturedDOM` on each "What to say".
  Therefore the extension pushes **exactly once per user intent** (one hotkey
  press or one popup "Capture" click). It NEVER auto-pushes on navigation and
  NEVER streams.

## MV3 / CORS notes

The JSON `POST` is a non-simple request, so Chrome sends an `OPTIONS` preflight,
which the desktop answers with `204`. The service worker just `fetch`es normally;
the browser supplies the `chrome-extension://` origin. `host_permissions` for
`http://127.0.0.1/*` is what lets the SW make this cross-origin loopback request.
