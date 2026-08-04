# Code patterns — Mobile companion via USB / InterviewMan-like stealth phone UI

**Topic:** Phone app that shows assistant answers + controls the session via USB tether to desktop Electron (InterviewMan Stealth Mode analogue: desktop listens/hides; phone shows UI + answers + screenshot trigger)  
**Workspace:** `/Users/son.do/natively-cluely-ai-assistant/`  
**Date:** 2026-08-03  
**Scope:** Read-only pattern harvest (PhoneMirror, stealth, companions, USB/ADB/scrcpy)

---

## Relevant Files

### Core Phone Mirror (transport + protocol)

| File | Description |
|------|-------------|
| `electron/services/PhoneMirrorService.ts` | Singleton HTTP + WebSocket server (default port `4123`, probe `4123..4134`). Binds `127.0.0.1` or `0.0.0.0` (LAN). Serves phone HTML, `/ws`, `/dom`, `/pair`, `/healthz`. Dual tokens: per-session **phone** token (QR/LAN) vs persisted **extension** token (loopback `/dom`). Publishes stream events; receives phone commands. |
| `electron/services/phoneMirrorClient.ts` | Inlined mobile web client (`PHONE_MIRROR_HTML`) titled "Natively Mirror". Browser UI: chat feed, quick-action buttons, screenshot shutter. Connects `ws(s)://host/ws?t=<phoneToken>`. No native iOS/Android app. |
| `electron/ipcHandlers.ts` (~9557–10225) | IPC: enable/disable/LAN/rotate/arm-extension/list-tabs/capture/auto-context. Status fan-out; `onPhoneCommand` routes `action` → `global-shortcut`, `chat` → LLM stream + mirror, `screenshot` → desktop capture (image stays on PC). |
| `electron/preload.ts` + `src/types/electron.d.ts` | Exposes `phoneMirror*` APIs and `PhoneMirrorInfo` / DOM meta types to renderer. |
| `src/components/settings/PhoneMirrorSettings.tsx` | Settings → **Sync** UI: enable, QR/URL pairing, Allow LAN (Wi‑Fi wording), browser-extension arm/pair, browser-context opts. |
| `src/components/SettingsOverlay.tsx` | Tab id `phone-mirror`, nav label `Sync`; mounts `PhoneMirrorSettings`. Overlay opacity comment-labeled "(Stealth Mode)". |
| `electron/main.ts` | Boot auto-start via `shouldStartPhoneMirrorOnBoot` + `phoneMirrorEnabled`; `NATIVELY_DISABLE_PHONE_MIRROR=1` kill switch; dispose on quit; capture hotkey falls back to screenshot when extension asleep. |
| `electron/services/SettingsManager.ts` | Persists `phoneMirrorEnabled`, `phoneMirrorExposeOnLan`. |
| `electron/services/__tests__/PhoneMirror*.test.mjs` | Kill-switch, extension v2, browser-context, phone-chat route tests. |

### Companion browser extension (not a phone app)

| File | Description |
|------|-------------|
| `natively-browser/` (esp. `README.md`, `CONTRACT.md`, `src/service-worker.ts`) | MV3 **Page Context** extension: loopback-only WS + `/dom` POST. Desktop-pull capture (`⌘/Ctrl+Shift+Y`). Not a mobile companion; pairs into the same PhoneMirror HTTP server. |
| `src/components/NativelyInterface.tsx` (~636–783, ~3454, ~3915) | Consumes DOM from extension; phone-mirror auto-context / incoming-chat sync with overlay. |
| `src/components/settings/HelpSettings.tsx` §10 / §14 | Help: Phone Mirror (LAN/Wi‑Fi) + Companion Browser Extension setup. |
| `electron/services/context/PromptAssembler.ts` | Treats companion-extension DOM as untrusted context. |

### Desktop "stealth" (orthogonal to phone display)

| File | Description |
|------|-------------|
| `electron/services/StealthKeyboardManager.ts` | macOS CGEventTap **stealth typing**: type into Natively without stealing OS focus from Zoom/browser. |
| `native-module/src/stealth_window.rs` | Native NSPanel / stealth window attributes. |
| `electron/WindowHelper.ts` | Undetectable/overlay: click-through passthrough, stealth show, dock/taskbar hygiene. |
| `electron/main.ts` (~6409+, stealth-tap IPC, undetectable dock) | Process disguise / undetectable mode; stealth shortcuts dispatch without focus. |
| `src/lib/overlayStealthFocusGuards.mjs` | Renderer guards around stealth focus behavior. |
| `src/components/SettingsOverlay.tsx` | Undetectable toggle, Interface Opacity ("More Stealth"), Toggle Stealth Typing keybind. |
| `src/components/settings/HelpSettings.tsx` §11 | "Stealth & Window Control" = opacity + mouse pass-through + screen-share undetectability — **not** phone UI. |

### Other "companion" surfaces (do not confuse)

| File | Description |
|------|-------------|
| `src/components/settings/IntelligenceSettings.tsx` | **Hindsight** LTM "companion app" / companion server (separate install, not Phone Mirror). |
| Onboarding `*.mjs` companions | Test/module dual files — unrelated to mobile. |

### Grep negatives (topic-critical)

| Search | Result |
|--------|--------|
| `adb`, `scrcpy`, USB tether, React Native / Expo / Flutter app | **No** mobile-native companion, ADB bridge, or scrcpy integration in product code. |
| USB hits | Mic USB hot-plug / forensic "USB camera" corpus — unrelated to phone mirror. |
| InterviewMan | Prior grill docs = **custom SD prompt / sim**, not a phone stealth product in this repo. |

---

## Potential Contradictions

1. **USB tether companion vs actual transport** — Desired InterviewMan-like flow (USB phone app ↔ desktop) does **not** exist. Phone surface is a **mobile browser** talking **HTTP/WS** to the desktop. Default bind is **loopback**; remote phones need **Allow LAN** (`0.0.0.0`) on a shared IP network (docs say Wi‑Fi/Ethernet). No ADB/USB serial/scrcpy path. USB tethering might *coincidentally* work only if the OS exposes a routable interface the LAN binder picks up — **not designed or documented** as USB companion mode.

2. **Help says "watch" / viewer; code is full remote control** — `HelpSettings` §10: "watch … live transcript and AI answers." Client + IPC also support **chat**, **quick actions** (What to Say, Code Hint, Clarify, … via `global-shortcut`), and **screenshot shutter** (desktop capture; image never sent to phone). Phone is a **control surface**, not viewer-only.

3. **"Stealth" ≠ phone display surface** — Product stealth = undetectable/dock-hide, opacity, mouse passthrough, stealth-typing tap. Phone Mirror is the **anti-stealth display**: put answers on a second screen so the shared desktop can stay clean. InterviewMan-style "desktop hides, phone shows" is only partially approximated: desktop can be undetectable/hidden; phone is a **browser page**, not a dedicated stealth app over USB.

4. **i18n vs settings reality** — `src/i18n.tsx` string: "Phone Mirror runs on your local network…" while default is **loopback only** until LAN is enabled (`PhoneMirrorSettings` / Help correctly say loopback default).

5. **LAN copy vs bind semantics** — UI warns "same Wi‑Fi"; bind is any non-loopback interface when `exposeOnLan`. Ethernet/VPN filtering is heuristic in LAN-URL detection, not USB-aware.

6. **"Companion" overload** — (a) browser extension, (b) Hindsight companion server/app, (c) phone web client, (d) overlay companion windows in `main.ts`. A "mobile companion app" ask collides with three existing meanings; only (c) is phone-facing, and it is not a store app.

7. **Screenshot direction** — Phone "Capture" triggers **desktop** screenshot for AI queue; it does **not** mirror desktop pixels or phone camera to the phone UI (ack-only card). Opposite of screen-mirroring tools (scrcpy).

8. **Token split vs shared `/ws`** — Phone token cannot hit `/dom`; extension token is loopback-scoped. But `/ws` accepts either token (`CONTRACT.md`) — phone and extension share the same upgrade path with role separation after `hello`.

9. **Settings tab vs feature name** — Nav label **Sync**, tab id `phone-mirror`, header "Sync" / "Enable Phone Mirror", help "Phone Mirror", HTML title "Natively Mirror". Easy to miss in settings.

10. **InterviewMan naming in workspace** — Prior `_workspace/grill-with-docs` "InterviewMan" threads are about **SD custom prompts / sim parity**, not InterviewMan Stealth Mode phone hardware. Do not treat those docs as phone-companion architecture.

---

## Naming Inconsistencies

| Label | What it actually is | Collision risk |
|-------|---------------------|----------------|
| **Phone Mirror** | Desktop local HTTP/WS server + mobile **web** client | Sounds like OS screen mirror / scrcpy |
| **Sync** (settings nav) | Same as Phone Mirror settings tab | Sounds like cloud sync / Hindsight |
| **Natively Mirror** | HTML `<title>` of phone client | Third marketing name for same feature |
| **companion extension** / **Page Context** / **natively-browser** | Chrome MV3 DOM capture client | "Companion" ≠ phone app |
| **companion app** (Hindsight UI) | Separate LTM server install | Same word, different product |
| **Stealth Mode** (opacity comment / "More Stealth") | Overlay opacity / undetectability / typing tap | Not the phone UI; InterviewMan "Stealth Mode" means phone display |
| **stealth-tap** / **StealthKeyboardManager** | CGEventTap typing into overlay | Not phone remote |
| **undetectable** / **Process Disguise** | Screen-share / dock stealth | Closest desktop half of InterviewMan split; not paired to USB phone |
| **Expose on LAN** vs **Allow LAN access** | Same setting (`phoneMirrorExposeOnLan`) | Help vs Settings wording differ |
| **phone token** vs **extToken** | Two secrets on one server | "Pairing token" in UI often conflates both |
| **InterviewMan** (prior grills) | External SD prompt / sim | Not this repo's phone mirror |

---

## Existing Architecture Notes

### How PhoneMirrorService works

**Transport**
- Node `http.Server` + `ws` `WebSocketServer` (`noServer: true`, upgrade on same port).
- Bind: `127.0.0.1` (default) or `0.0.0.0` when `exposeOnLan`.
- Port: `4123` with probe range of 12.
- Phone clients get QR / `http://<lan-or-loopback>:<port>/?t=<phoneToken>` (plaintext HTTP on LAN).
- No TLS, no USB channel, no native push (APNs/FCM).

**Protocol (phone)**
- `GET /` → `PHONE_MIRROR_HTML` (token-gated).
- `GET /ws?t=<token>` → WebSocket.
- Desktop → phone `StreamEvent`: `history`, `user`, `token`, `done`, `error`, `assistant`, `ack`.
- Phone → desktop `PhoneCommand`: `{type:'chat', message}`, `{type:'action', action}`, `{type:'screenshot'}`.
- History replay (~40 msgs) + in-flight partial on connect.

**Protocol (extension — same server, different capability)**
- Loopback `POST /pair` (armed 60s, pinned extension origin) → persisted `extToken`.
- `POST /dom?t=<extToken>` → DOM context to overlay (never phone).
- Extension WS `hello` role → `capture-dom` / `list-tabs` push; content returns via `/dom`.
- Hotkey path: extension capture preferred; else screenshot fallback.

**What gets "mirrored"**
- **Mirrored to phone:** chat turns / streaming tokens / labeled assistant shortcuts / screenshot **acks** (not images).
- **Not mirrored:** desktop overlay pixels, mic audio, stealth keyboard stream, DOM page content (stays on desktop), screenshot bitmaps.

**Control path**
- Actions reuse desktop `global-shortcut` IPC (same as stealth hotkeys).
- Chat runs a dedicated phone stream path in `ipcHandlers` (parity gates with desktop where audited).
- Screenshot = remote shutter for `appState.takeScreenshot`.

### What companion exists today

| Surface | Exists? | Role |
|---------|---------|------|
| Native iOS/Android InterviewMan-like app | **No** | — |
| USB / ADB / scrcpy bridge | **No** | — |
| Mobile web "Natively Mirror" | **Yes** | Answers + chat + actions + screenshot trigger over LAN/loopback WS |
| Chrome companion extension | **Yes** | Browser DOM → desktop; shares PhoneMirror port |
| Hindsight companion server | **Yes** | Unrelated LTM |
| Desktop stealth (undetectable + opacity + passthrough + stealth type) | **Yes** | Hide/disguise desktop UI; independent of phone |

### "Stealth" here vs phone display surface

| Concept in this codebase | Meaning |
|--------------------------|---------|
| Undetectable / Process Disguise | Hide from screen share / dock; desktop meeting stealth |
| Overlay opacity / "More Stealth" | Make overlay hard to see on the shared screen |
| Mouse passthrough | Click-through overlay; control via hotkeys |
| Stealth typing (`StealthKeyboardManager`) | Type into Natively without focusing away from Zoom |
| Phone Mirror | **Second-screen answers + remote controls** so the primary display can stay stealthy |

**InterviewMan Stealth Mode analogue (desired):** desktop listens/hides; dedicated phone app over USB shows answers + shutter.  
**Closest existing composition:** undetectable/hidden overlay on desktop **plus** Phone Mirror web client on a phone **on the same LAN** (QR). Gap vs ask: no USB-first transport, no native app binary, phone UI is a browser page served by Electron, and "stealth" product language does not name Phone Mirror.

### Essential files to understand the topic

1. `electron/services/PhoneMirrorService.ts`  
2. `electron/services/phoneMirrorClient.ts`  
3. `electron/ipcHandlers.ts` (Phone Mirror IPC + `onPhoneCommand`)  
4. `src/components/settings/PhoneMirrorSettings.tsx`  
5. `natively-browser/CONTRACT.md` + `README.md`  
6. `electron/services/StealthKeyboardManager.ts` + Help §10–11 (stealth vs phone wording)  
)
