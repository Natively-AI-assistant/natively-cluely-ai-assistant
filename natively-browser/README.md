# Natively Page Context — companion browser extension

A minimal, privacy-correct Manifest V3 extension that sends the **active tab's
readable content** to your local Natively desktop app, **once, on demand**. It
never runs in the background, never auto-captures, and only ever talks to your
own machine over loopback.

It is part of the [Natively](../) monorepo and is licensed under the
**Natively Personal Use Source License v1.0**, same as the desktop app. Source
lives in this directory (`natively-browser/`).

## How it works

Capture is triggered from the **Natively desktop app** (a global hotkey that works
from any focused app — including while you're looking at the Natively overlay, not
the browser). The desktop pushes a "capture" command to the extension over a
loopback WebSocket; the extension grabs the active tab and posts the content back:

```
Natively desktop hotkey (default ⌘/Ctrl+Shift+Y, owned by the desktop app)
   → desktop pushes {capture-dom} over  ws://127.0.0.1:<port>/ws?t=<token>
   → service worker picks the right tab and injects the content-script (on demand)
   → content-script runs Mozilla Readability → clean title + text + verbatim code
     (or innerText fallback); selection-first if you highlighted something
   → service worker POSTs it to  http://127.0.0.1:<port>/dom?t=<token>
   → desktop shows a "Captured: <title>" chip, consumed once by the next "What to say"
```

If the extension isn't reachable (e.g. you're not in a browser), the desktop falls
back to a **screenshot + vision** automatically — one hotkey, the right capture.

You can also capture manually from the popup ("Capture this page") while Chrome is
focused.

The **service worker is the only component that holds the pairing token** and the
only one that touches the network. The content script (which runs inside an
untrusted page) never receives the token, so a malicious page cannot exfiltrate
it. See [`CONTRACT.md`](./CONTRACT.md) for the `/dom` + `/ws` + `/pair` API.

## Permissions (and why each is minimal)

| Permission | Why |
|------------|-----|
| `activeTab` | Read the current tab only when capture is invoked. |
| `scripting` | Inject the content script programmatically — no persistent/static content scripts, no `<all_urls>`. |
| `tabs` | Resolve which tab to capture (the one you were last on) when the browser isn't the focused OS app, and list tabs for the desktop's tab picker. |
| `storage` | Persist the pairing token (`chrome.storage.local`) and track the last-active tab (`chrome.storage.session`). |
| `alarms` | A 25s heartbeat that keeps the MV3 service worker resident so it can receive the desktop's capture push. |
| `host_permissions: http://127.0.0.1/*`, `http://localhost/*`, `ws://127.0.0.1/*` | Let the service worker make the cross-origin loopback `fetch`/WebSocket to the desktop. **Loopback only** — the extension cannot reach any public site's network. |

There is **no `<all_urls>`** and **no persistent content script**. Extraction
code is injected via `chrome.scripting.executeScript` into the active tab only,
when a capture is triggered.

## Build

```bash
cd natively-browser
npm install
npm run build       # → dist/  (esbuild, same toolchain as the desktop app)
```

Other scripts:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # compiles pure modules to dist-test/ then runs node --test
```

## Dev-load (unpacked)

1. `npm run build`
2. Open `chrome://extensions`
3. Toggle **Developer mode** (top right)
4. Click **Load unpacked** → select `natively-browser/dist`
5. The extension ID will be **`macjecgdfliikhplbbdbpljomcigjnjg`** (pinned, see below).

## Pair (once — the token is persisted, so you don't re-pair every launch)

**One-click (recommended):**
1. In Natively desktop: **Settings → Phone Mirror** → enable, then in the
   **Browser Extension** card click **Connect browser extension** (opens a 60s
   window).
2. Click the extension's toolbar icon → **Connect to Natively**. Done — a green
   dot ("Connected — capture ready") means the capture WebSocket is live.

**Manual fallback:** in the same desktop card, copy the `port:token` string, then
in the popup expand **Pair manually instead** and paste it.

The pairing token is persisted (encrypted) on the desktop and the live port is
auto-discovered, so the extension stays paired across desktop restarts and port
changes. You only re-pair if you click **Rotate token** in Settings.

## Capture

- **From the desktop (primary):** press the Natively capture hotkey
  (**`⌘/Ctrl+Shift+Y`** by default, configurable in Natively's keybindings). This
  works from any focused app — including the Natively overlay. If the browser
  isn't reachable, the desktop takes a screenshot instead.
- **From the popup:** click the toolbar icon → **Capture this page** (works while
  Chrome is focused).

Each capture pushes **once**. The desktop shows a "Captured: \<title\>" chip and
consumes it on the next "What to say".

## Re-pairing / troubleshooting

- **"Pairing expired"** (amber dot): you clicked **Rotate token** in Settings (the
  deliberate security reset). Re-pair via **Connect to Natively**.
- **"Open Natively and enable Phone Mirror"** (red dot): Phone Mirror is off. The
  port is auto-discovered (`4123..4134`), so a port change alone does **not**
  require re-pairing — just make sure Phone Mirror is running.
- **Capture falls back to a screenshot** even on a web page: the service worker may
  have been asleep at the moment you pressed the hotkey. Click a Chrome tab or the
  toolbar icon once to wake it, then capture again. The desktop log shows the
  reason (`extension capture-ack: ...`).
- **"Cannot capture browser/internal pages"**: `chrome://`, `about:`, and the
  extension's own pages can't be scripted — switch to a normal web page.

## Deterministic extension ID (the `key` field)

The manifest pins a public `key`, which gives the **unpacked dev build** a stable
ID: `macjecgdfliikhplbbdbpljomcigjnjg`. NOTE: the **Chrome Web Store re-signs the
published extension with Google's own key**, so the store build has a DIFFERENT,
also-stable ID: `lmhgnkbjnelmciecjkleaomjpejcgaln`. The desktop `/pair` endpoint
**exact-pins BOTH** (the store ID for normal users, the dev ID for contributors);
`/dom` uses the looser structural `[a-p]{32}` origin check. CORS responses are only
readable by the exact requesting origin — a different extension, even one that
obtained the token, can't read replies cross-origin. Contributors building from
source with yet another unpacked ID can override via the `NATIVELY_DOM_EXTENSION_ID`
env var.

The `key` was generated from a 2048-bit RSA keypair:

```bash
# 1. Generate the private key (KEEP SECRET — gitignored as extension-private-key.pem)
openssl genrsa 2048 > extension-private-key.pem

# 2. The manifest "key" is the base64 of the DER public key:
openssl rsa -in extension-private-key.pem -pubout -outform DER | openssl base64 -A

# 3. The resulting extension ID (sha256 of the DER public key, first 16 bytes,
#    each hex nibble mapped 0-9a-f → a-p):
openssl rsa -in extension-private-key.pem -pubout -outform DER \
  | openssl dgst -sha256 -binary | xxd -p -c256 | head -c32 | tr '0-9a-f' 'a-p'
```

The **public** key is safe to commit (it only fixes the ID). The **private** key
is gitignored; it's needed to produce a `.crx` with a matching ID for the Web
Store / self-hosted distribution. Regenerate it and update the manifest `key`
(and the desktop's origin pin, if/when it's exact-pinned) to rotate the ID.

## License

Licensed under the [Natively Personal Use Source License v1.0](../LICENSE).
Bundles [Mozilla Readability](https://github.com/mozilla/readability) (MIT); its
license attribution is emitted to `dist/content-script.js.LEGAL.txt` by the
build.
