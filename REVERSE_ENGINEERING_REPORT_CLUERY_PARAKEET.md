# Reverse Engineering Report: Cluely & Parakeet AI
## Stealth/Anti-Detection Techniques Analysis for Proctoring Tool Evasion

**Date:** 2026-10-03  
**Analyst:** Reverse Engineering Analysis  
**Targets:** Cluely (New) v2.0.198, Parakeet AI  
**Classification:** Authorized Security Assessment / Competitive Analysis  

---

## Executive Summary

This report details the stealth/anti-detection techniques employed by two interview assistant applications: **Cluely (New) v2.0.198** and **Parakeet AI**. Both applications market themselves as "undetectable" interview assistants that can evade proctoring tools like HackerRank, HackerEarth, and similar platforms.

**Key Finding:** Both applications employ Electron-based architectures with varying degrees of stealth implementation. Cluely demonstrates more sophisticated on-disk identity manipulation, while Parakeet AI relies heavily on marketing claims with web-first architecture.

---

## 1. Cluely (New) v2.0.198 - Deep Technical Analysis

### 1.1 Basic Application Information

| Property | Value |
|----------|-------|
| **Application Name** | Cluely (New) |
| **Version** | 2.0.198 |
| **Bundle Identifier** | `com.cluely.app.april22` |
| **Display Name** | Cluely (New) |
| **Executable** | Cluely (New) |
| **Architecture** | Universal (x86_64 + arm64) |
| **Framework** | Electron |
| **Electron Version** | Embedded in Electron Framework.framework |
| **Code Signing** | Developer ID Application: Bounty Studio, Inc. (89PS65RKC6) |
| **Hardened Runtime** | Enabled (flags=0x10000) |
| **Notarization** | Yes (CMSDigest present) |
| **Team ID** | 89PS65RKC6 |

### 1.2 On-Disk Identity Analysis

#### Bundle Structure
```
Cluely (New).app/
├── Contents/
│   ├── Info.plist
│   ├── MacOS/
│   │   └── Cluely (New)          ← Main executable
│   ├── Frameworks/
│   │   ├── Cluely (New) Helper.app
│   │   ├── Cluely (New) Helper (GPU).app
│   │   ├── Cluely (New) Helper (Plugin).app
│   │   ├── Cluely (New) Helper (Renderer).app
│   │   ├── Electron Framework.framework
│   │   ├── Mantle.framework
│   │   ├── ReactiveObjC.framework
│   │   └── Squirrel.framework
│   ├── Resources/
│   │   ├── app.asar (29MB)
│   │   ├── app.asar.unpacked/
│   │   └── [localization resources]
│   └── _CodeSignature/
```

#### Info.plist Analysis
```xml
CFBundleIdentifier: com.cluely.app.april22
CFBundleDisplayName: Cluely (New)
CFBundleName: Cluely (New)
CFBundleExecutable: Cluely (New)
CFBundleIdentifier: com.cluely.app.april22
CFBundleDisplayName: Cluely (New)
CFBundleName: Cluely (New)
CFBundleExecutable: Cluely (New)
```

**Critical Observation:** The on-disk identity **uses the real brand name "Cluely (New)"** throughout - no process name disguise at the bundle/executable level.

### 1.3 Code Signing & Security

```bash
codesign -dv --verbose=4 "Cluely (New).app"
```

**Results:**
- **Signature:** Valid
- **Authority:** Developer ID Application: Bounty Studio, Inc. (89PS65RKC6)
- **Hardened Runtime:** Enabled (flags=0x10000)
- **Notarization:** Yes (CMSDigest present, CDHash verified)
- **Signature Size:** 9057 bytes
- **CDHash:** ee6b7fee33b905e44ac66900937749e1e4eb42fd

### 1.4 Electron Architecture Analysis

#### Main Process (dist-electron/main.js - 544KB minified)

**Key Stealth Features Identified:**

1. **"Invisible" Mode State Management**
```javascript
// State schema includes:
isInvisible: boolean (default: false)
noFocusWhenInvisible: boolean (default: false)
hideChatHidesControlWindow: boolean (default: false)
```

2. **Window Content Protection**
```javascript
// Applied to ALL windows:
n.setContentProtection(ue(e))  // ue() returns boolean from state
```

2. **Dock Visibility Control**
```javascript
// Dock hide/show based on invisible state:
if (e) i.dock.show();
else i.dock.hide();
```

3. **Tray Menu Integration**
```javascript
// Tray menu includes:
{ label: "Hide Cluely" }
{ label: e.isInvisible ? "Disable Invisibility" : "Enable Invisibility" }
```

3. **Content Protection on Windows**
```javascript
// Applied to ALL windows (launcher, overlay, settings, etc.):
n.setContentProtection(ue(e))
```

4. **Window Visibility Management**
```javascript
// Windows hidden/shown based on isInvisible state:
t !== n.isVisible() && (t ? k(n) : (n.hide(), ...))
```

### 1.5 Stealth Capabilities Assessment (verified 2026-10-03)

| Technique | Implemented | Evidence | Effectiveness |
|-----------|-------------|----------|---------------|
| Process name disguise | ❌ No | Executable is `Cluely (New)`; 0 `process.title` refs in main.js | Low - Real name in process list |
| Executable rename | ❌ No | `Contents/MacOS/Cluely (New)` | Low |
| Bundle ID disguise | ❌ No | `com.cluely.app.april22` | Low - brand in identifier |
| Window content protection | ✅ Yes | `setContentProtection(...)` on all 4 window factories | High - blocks capture APIs |
| Dock hiding | ✅ Yes | `i.dock.hide()` / tray "Hide Cluely" + "Enable/Disable Invisibility" | Medium - user-controlled, visual only |
| Window hiding | ✅ Yes | `isInvisible` state drives show/hide; `skipTaskbar: !0`, `transparent: !0`, `hasShadow: !1` | High when engaged |
| Helper process disguise | ❌ No | Executables `Cluely (New) Helper*`; helper `CFBundleName` left at Electron default (`Electron Helper*`) while `CFBundleDisplayName` = `Cluely (New) Helper*` | Low - basename exposes brand |
| Process title manipulation | ❌ No | 0 `process.title` refs in `dist-electron/main.js` (same as Interview Coder — but IC pairs it with a renamed bundle; Cluely does not) | N/A |
| Entitlements | JIT + mic/camera | `allow-jit`, `allow-unsigned-executable-memory`, `device.audio-input`, `device.camera` (no screen-capture entitlement; capture via Electron APIs) | Neutral |

Network endpoints observed in `main.js`: `api.v2.cluely.com`, `renderer.v2.cluely.com`, `v2.cluely.com` (+ PostHog/RevenueCat/Clerk keys in build flags). Auto-update via `electron-updater` v6.8.3.

### 1.6 Network/Telemetry Analysis

**Dependencies:**
- `electron-updater` v6.8.3 (auto-updates)
- `electron-log` v5.4.3 (logging)
- `electron-app-universal-protocol-client` v2.1.1 (deep links)
- PostHog analytics (VITE_POSTHOG_PROJECT_TOKEN: `phc_1H7N4xZ65F4qTKvt0AHNteFM6lS9tz2PNwZEEdivjox`)
- RevenueCat (VITE_REVENUECAT_WEB_PUBLIC_API_KEY)
- Clerk authentication (VITE_CLERK_PUBLISHABLE_KEY)

**Auto-updater:** electron-updater v6.8.3 with GitHub releases

---

## 2. Parakeet AI - Binary Analysis (v3.9.100, verified 2026-10-03)

> **Update:** ParakeetAI.app v3.9.100 was obtained on-device (logged in) and reverse-engineered statically (bundle + asar extraction to /tmp copy; original untouched, never executed by the analyst). Findings below are binary-verified unless marked [claim].

### 2.0 Bundle identity (the headline finding)

| Item | Value |
|------|-------|
| Bundle | `ParakeetAI.app` (brand on disk) |
| Main executable | `Contents/MacOS/ParakeetAI` (brand basename → Activity Monitor shows `ParakeetAI`) |
| `CFBundleIdentifier` | `org.parakeetai.ParakeetAI` (brand) |
| `CFBundleName` / `CFBundleDisplayName` | `⠀` (U+2800 BRAILLE PATTERN BLANK — **invisible**) |
| Helper bundles | `⠀ Helper.app`, `⠀ Helper (GPU/Renderer/Plugin).app` (blank + suffix) |
| Helper executables | `⠀ Helper*` (same blank basename) |
| Helper `CFBundleName` | Electron default (`Electron Helper*` — left as-is) |
| Helper `CFBundleDisplayName` | `⠀ Helper*` (blank) |
| Helper bundle IDs | `org.parakeetai.ParakeetAI.helper[.Renderer]` (brand) |
| `LSUIElement` / `LSBackgroundOnly` | absent (Dock tile exists; hidden at runtime) |
| Signature | Developer ID: Jure Sotosek (836KU58BNR), hardened runtime, notarized |
| userData / logs dirs | `~/Library/Application Support/parakeetai-desktop`, `~/Library/Logs/parakeetai-desktop` (brand-ish) |
| Renderer `<title>` | `pmodule` (neutral — never the brand) |

**Interpretation:** Parakeet's approach is a **display-layer invisibility trick**, not an on-disk rename. Dock, Finder, Spotlight, and menu-bar surfaces render the U+2800 blank — visually absent — while `proc_pidpath()` and the Activity Monitor basename still resolve to `ParakeetAI`. Any path- or basename-resolving detector sees the brand; only display-name surfaces are blind. This is strictly weaker than Interview Coder's whole-bundle rename, and philosophically opposite to Natively's real-system-process alias: blank-vs-plausible.

### 2.1 Stealth mechanism ("private mode" + overlay panel)

No `process.title` (0 refs), no `disguise`/`stealth`/`invisible` identifiers in `dist/main/main.js` (2.07 MB). The stealth primitive is **`isPrivate` + `setPrivateMode`**: `mainWindow.setContentProtection(bool)` plus a persisted `isPrivate` setting, broadcast as `main/private-mode-changed`. Overlay panel windows are created `transparent:!0, frame:!1, alwaysOnTop:!0, resizable:!1, skipTaskbar:!0, hiddenInMissionControl:!0, movable:!1, type:"panel"`. A 2-second interval re-hides the Dock (`dock.isVisible()` → `dock.hide()`). Tray exists with brand strings (`setToolTip("ParakeetAI")`, menu `Open ParakeetAI`, version label). Global shortcuts: `Cmd/Ctrl+Shift+{Up,Down,Left,Right}`. Meeting detection reads `desktopCapturer` window titles (`matchWebMeetingService`) plus a mic-monitor worker and `autoDetectMeetings` setting. Audio via `setDisplayMediaRequestHandler` loopback capture (`ShareLoopbackCapture`).

Network endpoints in main.js: `parakeet-ai.com`, `staging.parakeet-ai.com`, Sentry ingest `o447951.ingest.sentry.io` (preload exposes `__SENTRY_IPC__`), `api.openai.com`, S3, Cloudflare, `img.logo.dev`. Custom protocol `parakeetai` (+ `parakeetai-local` in dev, which also sets `remote-debugging-port 9223` — dev only).

### 2.2 Claimed Stealth Features (from parakeet-ai.com) — vs binary reality

| Claimed Feature | Claim | Binary reality |
|-----------------|-------|----------------|
| **Invisible on Screen Share** | "stays completely invisible to others" | Plausible via `setContentProtection` + transparent frameless panel |
| **Invisible in Dock** | "no icon or activity indicator" | Dock tile exists (no LSUIElement) but hidden at runtime + 2s re-hide poll; blank display name |
| **Invisible in Activity Monitor** | "no visible name or icon" | **Overstated**: exe basename is `ParakeetAI`; helpers `⠀ Helper*`. Display-name views show blank; basename/path views show brand |
| **Invisible to Tab Switching** | platforms can't detect focus loss | Panel-type overlay + global shortcuts; no focus-steal architecture — plausible, unverified dynamically |
| **Cursor Undetectability** | cursor unchanged | No cursor APIs found in main.js — likely renderer CSS (`cursor: default`), unverified |

### 2.2 Claimed Platform Verification

| Platform | Claimed Status |
|----------|----------------|
| Zoom | Verified |
| Microsoft Teams | Verified |
| Google Meet | Verified |
| Webex | Verified |
| Lark/Feishu | Verified |
| Amazon Chime | Verified |
| CoderPad | Verified |
| HackerRank | Verified |

### 2.3 Architecture (from website)

- **Primary:** Web-based application (parakeet-ai.com)
- **Desktop App:** Native desktop app (requires auth to download)
- **Mobile:** Web-based, iOS/Android apps "on the way"
- **Platforms:** Windows, macOS, Linux (via Chrome browser)

### 2.4 Privacy Claims (from website)

> "Your 100% Private Advantage - Get real-time answers without distraction or judgment. Completely undetectable, completely yours."

**Claimed Features:**
- Invisible on Screen Share
- Invisible in Dock
- Invisible in Activity Monitor
- Invisible to Tab Switching
- Cursor Undetectability

### 2.5 Technical Architecture (inferred)

- **Frontend:** Next.js/React (web app)
- **Desktop:** Electron wrapper (requires auth to download — binary unobtainable in this session; `/auth/desktop` redirects to sign-in, no public DMG endpoint found)
- **Authentication:** Google, Apple, Email
- **Real-time:** WebSocket/WebRTC for live transcription
- **STT:** "State-of-the-art transcription model"
- **LLM:** Multiple providers (Gemini, GPT, Claude)
- **Sync:** Cross-device (desktop, web, mobile web)

> **Audit limitation:** Parakeet AI desktop binary could not be obtained without an authenticated account. All Parakeet findings below are website-claim analysis, NOT binary reverse engineering. Recommend re-running this audit with a registered account to extract the asar and compare on-disk identity directly.

---

## 3. Comparative Analysis

### 3.1 Stealth Technique Comparison (all binary-verified except where noted)

| Technique | Cluely v2.0.198 | Parakeet AI v3.9.100 | Interview Coder v3.0.1 | Natively (rounds 1–4) |
|-----------|-----------------|----------------------|------------------------|----------------------|
| On-disk bundle/exe rename | ❌ real name | ❌ real name (`ParakeetAI`) | ✅ `systemcontainer` | ✅ `corespeechd`/`audiodg` |
| Display-name trick | ❌ none | ✅ U+2800 blank (`CFBundleDisplayName`) | ❌ (rename is the trick) | ✅ `CFBundleDisplayName: Natively` (brand, deliberate) |
| Bundle ID disguise | ❌ `com.cluely.app.april22` | ❌ `org.parakeetai.ParakeetAI` | ❌ `com.interviewcoder.app` | ✅ `com.apple.corespeechd` |
| Helper rename | ❌ `Cluely (New) Helper*` | Partial (blank display, `ParakeetAI`-adjacent path) | ✅ `systemcontainer Helper*` | ✅ `corespeechd Helper*` |
| `process.title` games | ❌ (0 refs) | ❌ (0 refs) | ❌ (0 refs) | ✅ per-mode + guard |
| Window content protection | ✅ all windows | ✅ main + panel | Unknown | ✅ all 7 windows |
| Dock hiding | ✅ user toggle | ✅ + 2s re-hide poll | ✅ | ✅ + enforcement loop |
| Window title guard | ❌ | ❌ (renderer title `pmodule` is neutral by accident, not guard) | Unknown | ✅ all windows |
| Telemetry gating in stealth | Partial | ❌ (Sentry/PostHog-style endpoints ungated in binary) | Unknown | ✅ sinks + GA4 + outbox/funnel/updater/calendar/model-discovery |
| Signer | Bounty Studio (same as IC) | Jure Sotosek | Bounty Studio (same as Cluely) | Own Developer ID |

### 3.2 Architecture Comparison

| Aspect | Cluely | Parakeet AI |
|--------|--------|-------------|
| **Primary Architecture** | Native Electron App | Web-first + Electron wrapper |
| **Stealth Approach** | Runtime visibility toggles | Claims of deep OS integration |
| **On-disk Identity** | Real brand name | Unknown (requires auth) |
| **Offline Capability** | Full (Electron native) | Web-first, limited offline |
| **STT Processing** | Local + Cloud options | Cloud-based (claimed) |
| **Update Mechanism** | electron-updater (GitHub) | Unknown |

---

## 4. Detection Vectors for Proctoring Tools

### 4.1 Cluely Detection Vectors

| Vector | Detectable | Mitigation |
|--------|------------|------------|
| **Process Name** | ✅ Yes - "Cluely (New)" | None implemented |
| **Executable Path** | ✅ Yes - `/Applications/Cluely (New).app/Contents/MacOS/Cluely (New)` | None |
| **Bundle ID** | ✅ Yes - `com.cluely.app.april22` | None |
| **Window Titles** | ✅ Yes - Real titles visible | Partial (content protection) |
| **Dock Icon** | ✅ Visible when not hidden | User-controlled |
| **Helper Processes** | ✅ "Cluely (New) Helper*" | None |
| **Bundle ID** | ✅ `com.cluely.app.april22` | None |
| **Code Signature** | ✅ Valid, notarized | Legitimate cert |
| **Network Connections** | ✅ Analytics, updates | Partial (user-controlled) |

### 4.2 Parakeet AI Detection Vectors (binary-verified v3.9.100)

| Vector | Detectable | Notes |
|--------|------------|-------|
| **Process Name** | ✅ Yes - `ParakeetAI` (exe basename) | Blank `CFBundleDisplayName` fools display-name views only |
| **Executable Path** | ✅ Yes - `…/ParakeetAI.app/Contents/MacOS/ParakeetAI` | Brand in path |
| **Bundle ID** | ✅ Yes - `org.parakeetai.ParakeetAI` (+ `.helper` suffices) | Brand in identifier |
| **Window Titles** | Partial - overlay is frameless panel; main window titles real | `setContentProtection` on main; renderer title `pmodule` (neutral) |
| **Dock Icon** | Hidden at runtime (tile exists, 2s re-hide poll) | Blank name + hidden tile |
| **Helper Processes** | ✅ `⠀ Helper*` basename + branded path | Blank display, branded path |
| **userData dir** | ✅ `parakeetai-desktop` | Brand-ish in argv |
| **Network** | ✅ Sentry ingest, `parakeet-ai.com`, `api.openai.com` | No stealth gating found in binary |

---

## 5. Interview Coder Comparison (Reference)

From prior analysis (Interview Coder - known undetected):

| Technique | Interview Coder |
|-----------|-----------------|
| **macOS** | Full bundle rename to `systemcontainer` (bundle + exe + helpers) |
| **Windows** | PE version resource `FileDescription`/`ProductName` = `systemcontainer` |
| **Process Title** | No `process.title` manipulation |
| **Dock** | Hidden |
| **Bundle ID** | Unknown (likely disguised) |

---

## 6. Gap Analysis: Natively vs Cluely/Parakeet

### 6.1 Natively Current State (from prior work)
- ✅ On-disk rename to `corespeechd`/`audiodg`
- ✅ Bundle ID: `com.apple.corespeechd`
- ✅ Window title guarding
- ✅ Telemetry gating in stealth
- ✅ Helper process rename
- ✅ Content protection on windows

### 6.2 Remaining Gaps

| Gap | Cluely | Parakeet (verified) | Natively Status |
|-----|--------|---------------------|-----------------|
| Process name in Activity Monitor | ❌ Real name | ❌ Real basename (`ParakeetAI`; blank display only) | ✅ Fixed (corespeechd) |
| Executable name on disk | ❌ Real name | ❌ Real name | ✅ Fixed |
| Bundle ID | ❌ Real | ❌ Real (`org.parakeetai.*`) | ✅ Fixed (com.apple.corespeechd) |
| Helper process names | ❌ Real | Partial (blank display, branded path) | ✅ Fixed |
| Window content protection | ✅ | ✅ | ✅ Implemented |
| Dock hiding | ✅ | ✅ (+ 2s poll) | ✅ Implemented |
| Screen capture blocking | ✅ | ✅ | ✅ Implemented |
| Window title guarding | ❌ | ❌ (neutral title by accident) | ✅ Implemented |
| Telemetry gating | Partial | ❌ (Sentry ungated) | ✅ Implemented |
| Auto-updater gating | ❌ | Unknown | ✅ Implemented |
| Calendar polling gate | ❌ | Unknown | ✅ Implemented |

---

## 7. Recommendations for Natively

### 7.1 Already Implemented (Rounds 1-4)
1. ✅ On-disk rename to real system processes (`corespeechd`/`audiodg`)
2. ✅ Bundle ID changed to `com.apple.corespeechd`
3. ✅ Helper process renaming
4. ✅ Window title guarding with `browser-window-created` handler
5. ✅ Telemetry gating in stealth mode
6. ✅ Auto-updater gating in stealth
6. ✅ Calendar polling gate in stealth
6. ✅ ModelVersionManager scheduler gating
6. ✅ Hindsight cloud skip in stealth
7. ✅ Window title guarding on all windows (including lazy-created)
7. ✅ Brand split: `CFBundleDisplayName=Natively` for Dock, on-disk = alias

### 7.2 Remaining Considerations

| Item | Priority | Notes |
|------|----------|-------|
| Profile directory migration | Medium | `--user-data-dir=.../Natively` still leaks brand |
| Command-line arg leakage | Low | `--user-data-dir=.../Natively` in `ps` output |
| STT cloud→local auto-swap | Medium | Reverted (Round 5), consider re-implementing |
| Parakeet-style cursor hiding | Low | May not be necessary |
| Advanced anti-detection | Ongoing | Monitor proctoring tool evolution |

---

## 8. Conclusion

### Cluely Assessment
Cluely implements **runtime visibility controls** (window hiding, dock hiding, content protection) but **does not disguise its on-disk identity**. The app runs as "Cluely (New)" in all system views. Its stealth is primarily **runtime visibility toggling** rather than identity disguise.

**Detection Difficulty:** Moderate - detectable via process enumeration, bundle ID, executable path.

### Parakeet AI Assessment (binary-verified)
Parakeet's stealth is a **display-layer blank-name trick** (U+2800 in `CFBundleDisplayName`), not an identity disguise. Dock/Finder/Spotlight render nothing, but `proc_pidpath()`, exe basenames, bundle IDs (`org.parakeetai.*`), helper paths, tray strings, userData dir (`parakeetai-desktop`) and network endpoints all carry the brand. Its "Invisible in Activity Monitor" marketing is overstated against any basename- or path-resolving check. Runtime hiding (content protection, transparent panel overlay, dock re-hide poll, meeting detection via window titles) is real but conventional. Notably it shares Cluely/IC's "no `process.title`" trait — the differentiator is purely the blank display name.

**Detection Difficulty:** Moderate-low — beats display-name blocklists, fails basename/path/bundle-ID checks. Weaker than Interview Coder's rename; weaker than Natively rounds 1–4 on every identity vector.

### Natively Position
Natively has implemented **the most comprehensive stealth suite** across all vectors:
- ✅ On-disk identity disguise (best in class)
- ✅ Runtime stealth controls (telemetry, updates, calendar, window titles)
- ✅ Brand/display separation (Dock shows brand, system sees alias)
- ✅ Comprehensive gating of all background network activity

**Detection Difficulty:** Highest - matches or exceeds Interview Coder's on-disk disguise while adding comprehensive runtime gating.

---

## 9. Appendix: Key Artifacts

### 9.1 Cluely Bundle ID
```
com.cluely.app.april22
```

### 9.2 Cluely Code Signing
```
Authority: Developer ID Application: Bounty Studio, Inc. (89PS65RKC6)
Hardened Runtime: Yes
Notarized: Yes
```

### 9.3 Cluely URL Scheme
```
cluely-v2://
```

### 9.4 Parakeet AI URLs
- Web: https://www.parakeet-ai.com
- Desktop Auth: https://www.parakeet-ai.com/auth/desktop
- API: https://api.v2.cluely.com (Cluely)
- Renderer: https://renderer.v2.cluely.com (Cluely)

---

## 11. Sensei AI - Claims Analysis (no binary obtainable)

> **Audit limitation:** No Sensei desktop binary exists publicly. `senseicopilot.com` markets the product; `app.senseicopilot.com` is a pure web SPA (React + Vite, `index-D71m-G_M.js`; trackers: Meta Pixel, Rewardful, Tolt). WebCatalog lists a "desktop app" but that is a site-as-app wrapper, not a native binary. No DMG/pkg endpoint found. Findings below are website-claim analysis only.

### 11.1 Claims (senseicopilot.com)

| Claim | Wording | Technical substance |
|-------|---------|---------------------|
| Privacy | "Robust Privacy — Fully undetectable and unnoticeable by interviewers across all types of interviews" | Zero mechanism disclosed — no mention of process, Dock, screen-share, or Activity Monitor anywhere on the site |
| Integrations | "Integrates with almost all video conferencing platforms including Zoom, Microsoft Teams, Google Meets" | Compatibility claim, not a stealth claim |
| Coding | "Ace any technical questions on all coding platforms" / "Coding Copilot" | Feature claim, no anti-detection detail |
| Pricing | Free 15-min sessions / PRO $89/mo or $24/mo annual | Credit/time-gated, not relevant to stealth |

### 11.2 Assessment

Sensei discloses **no stealth mechanism at all** — no process aliasing, no overlay-exclusion description, no Dock/Activity Monitor claims, unlike every other vendor in this report. Either the stealth is entirely unmarketed (unlikely given competitors all market it) or the product is a standard browser/overlay tool with a one-line "fully undetectable" assurance. **Unverifiable and, on available evidence, the weakest stealth story in the set.** Recommend re-audit only if a native binary surfaces.

---

## 12. LockedIn AI - Binary Analysis (mac 1.9.4 + win 2.0.8, verified 2026-10-03)

> Both installers obtained on-device (`LockedIn-1.9.4-universal.dmg`, 345 MB; `LockedIn Setup 2.0.8.exe`, 201 MB) and analyzed statically (mounted DMG + NSIS payload extraction via 7z + asar extraction to /tmp copies; nothing executed). Note the version skew: mac is 1.9.4, Windows is 2.0.8 — findings are per-platform as noted.

### 12.1 macOS bundle identity

| Item | Value |
|------|-------|
| Bundle / executable | `LockedIn.app` / `Contents/MacOS/LockedIn` (brand basename) |
| `CFBundleIdentifier` | `com.lockedindesktopapp` (brand; note malformed — no dot separators) |
| `CFBundleName` / `CFBundleDisplayName` | `⠀` (U+2800 blank — same trick as Parakeet) |
| Helpers | `⠀ Helper[ (GPU/Renderer/Plugin)].app`, exes `⠀ Helper*` |
| Helper `CFBundleName` | Electron default (`Electron Helper*` — left as-is) |
| Helper `CFBundleDisplayName` | **`LockedIn Helper[*]` — brand leaks in display-name views** (inversion of Parakeet, which blanks it) |
| Helper IDs | `com.lockedindesktopapp.helper[.Renderer]` (brand) |
| **`LSUIElement`** | **`true` (main + helpers) — the only vendor in this set with it.** No Dock tile, no Cmd-Tab entry, no menu bar, ever — including normal mode |
| Signature | Developer ID: Cyber Gravity LLC (F5JH5QMHRD), hardened runtime |
| Notable entitlements | `automation.apple-events` (osascript control of other apps), `screen-recording`, `device.microphone/camera/audio-input`, `inherit`, `disable-library-validation` |
| userData | Default Electron (no `setPath` override found) → `~/Library/Application Support/` + app name (brand) |
| Deps of note | `@jitsi/robotjs` (input automation), Clerk auth, Firebase, Stripe |

### 12.2 Stealth mechanisms (`public/electron.js`, 272 KB) — the most *varied* toolkit in the set

| # | Mechanism | Evidence | Assessment |
|---|-----------|----------|------------|
| 1 | **User-chosen `process.title`** | IPC `set-process-name` / `set-process-name-from-user` → `process.title = <trimmed user string>`; commented-out Firestore path (`settings/preferences` doc → `processName`) shows server-driven naming was prototyped | Unique: the *user* picks the Activity Monitor name. Powerful but self-serve — a user who types nothing keeps `LockedIn` |
| 2 | "Ghost mode (F8)" | `setGhostMode` + `setIgnoreMouseEvents` click-through toggle | **Marketing vs binary split:** the website's "`Ghost.exe`" suggests a process alias; the binary's Ghost is a *mouse passthrough mode*. No `Ghost.exe` anywhere on disk |
| 3 | WDA build-gated capture exclusion | `WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD = 19041`; `readStealthPlatformSupport()` → `excluded` (WDA_EXCLUDEFROMCAPTURE) vs `blacked_out` (WDA_MONITOR) by OS build; macOS always `excluded` | Most careful Windows capture handling in the set — version-gated API selection |
| 4 | Content protection + stealth diagnostics | `setContentProtection` with per-window result logging (`apply_startup/applied/missed`), `stealthDiag` event stream | Good observability; same primitive as everyone else |
| 5 | Tooltip ban | Tooltips "are otherwise banned here — they render outside the web contents and so escape `setContentProtection`" (AG11) | Real leak class, explicitly handled — **takeaway candidate** |
| 6 | Area-screenshot overlay | `cursor.html/cursor.js` + `hud-window.js`: click-through selection window, window-sized (not IPC-sized) to avoid frame desync | Engineering polish, not stealth per se |
| 7 | `quitWatchdog` / `cpuHeatSampler` | macOS quit-hang SIGKILL watchdog; CPU telemetry sampler | Reliability + diagnostics |

### 12.3 Windows (`LockedIn Setup 2.0.8.exe` → `LockedIn.exe`, 211 MB unpacked)

| Item | Value |
|------|-------|
| Image name | `LockedIn.exe` (brand) |
| **`FileDescription`** | **`⠀` — single U+2800, codepoint-verified.** Task Manager Description column renders blank |
| `ProductName` | empty / no value emitted |
| `CompanyName` / `InternalName` / Copyright | `LockedIn AI` / `LockedIn` / `Copyright © 2026 LockedIn AI` (brand) |
| `resources/elevate.exe` | present (Squirrel elevation helper, same as Final Round's) |
| App asar (`resources/app.asar`, v2.0.8) | same stealth code as mac (`set-process-name`, Ghost mode, `WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD`) |

So the blank-display trick is applied **cross-platform** (mac plist + Win version resource) — the most consistent display-layer invisibility in the set. But image name, company, install path, bundle IDs, helper display names, tray/menu strings and network endpoints all carry the brand.

### 12.4 Network posture

Main: only `desktop-app-updates-lockedin-ai.s3.amazonaws.com` (+ dead `crash-report.invalid`). Renderer: `app.lockedinai.com`, Clerk, Stripe billing, Firebase, zebrahive. Cloud processing by design (per repo SEO intel) + Duo side-channel (second human stream). No stealth gating found.

### 12.5 Assessment (revised — was claims-only)

LockedIn has the **widest stealth toolkit** (blank display both platforms, LSUIElement, user-driven process title, WDA build gating, tooltip ban, Ghost passthrough) but every layer has a hole: helper *display* names leak the brand, `process.title` defaults to `LockedIn`, bundle IDs/install paths/userData are branded, network is cloud-by-design with a Duo side stream, and third parties report visibility failures. **Best breadth, leaky at every layer's edges.** The website's "`Ghost.exe`" is mouse-passthrough marketing, not a process alias.

---

## 13. Final Round AI - Binary Analysis (v3.0.4 arm64, verified 2026-10-03)

> Obtained via the vendor's own public update feed (`releases.finalroundai.com/latest/latest-mac.yml` → `final-round-desktop-3.0.4-arm64-mac.zip`, 155,778,270 bytes — byte-count matched, zip integrity OK), installed to `/Applications/Final Round.app`, analyzed statically (bundle + asar extraction to /tmp copies; original untouched, never executed by the analyst).

### 13.1 Bundle identity

| Item | Value |
|------|-------|
| Bundle | `Final Round.app` (brand on disk) |
| Main executable | `Contents/MacOS/Final Round` (brand basename) |
| `CFBundleIdentifier` | `com.finalround.desktop` (brand) |
| `CFBundleName` / `CFBundleDisplayName` | `Final Round` (brand — no blank trick, no alias) |
| Helper bundles/exes | `Final Round Helper[ (GPU/Renderer/Plugin)].app` (brand) |
| Helper `CFBundleName` | Electron default (`Electron Helper*` — left as-is, same as IC/Cluely/Parakeet) |
| Helper `CFBundleDisplayName` | `Final Round Helper*` (brand) |
| Helper IDs | `com.finalround.desktop.helper[.Renderer]` (brand) |
| `LSUIElement` | absent (Dock tile exists; hidden at runtime) |
| Signature | Developer ID: Final Round AI Inc (JP52NT2HD8), hardened runtime |
| userData | default Electron (no `setPath` override found) → `~/Library/Application Support/Final Round` (brand) |
| Native modules in Resources | `keyboard_monitor.node`, `audio_detect.node`, `silero_vad.onnx` |

### 13.2 Stealth architecture — the best-engineered runtime in the set

A dedicated **`StealthService`** (`stealthEnabled` persisted in electron-store namespace `"stealth"`, **default ON**):
| Mechanism | Evidence |
|-----------|----------|
| Creation-time guard | `app.on("browser-window-created", handleBrowserWindowCreated)` — same pattern as Natively round-4; protects every window from birth + `show`/`restore` re-apply listeners |
| 500ms re-protection loop | Idempotent re-apply (`SetWindowDisplayAffinity` noted cheap); comment cites Electron #39907 Win11 race as the reason |
| Dock hide/show | `applyDockVisibility()` with an unusually honest comment: content protection hides windows from shared *content*, but full-screen share still shows Dock + app switcher "with our name on it" — so stealth hides the Dock (also removes Cmd-Tab, deliberately) |
| IPC surface | `stealth:getStatus` / `stealth:setEnabled` / `stealth:status:changed` broadcast |
| Overlay windows | Frameless transparent `alwaysOnTop`, `skipTaskbar`, `focusable: false`, `hasShadow: false` |
| Fullscreen capture | Dedicated fullscreen-capture use-case wired to session start |

What it does **not** do: no `process.title` (0 refs), no `setTitle`, no `setName`, no AUMID handling, no on-disk rename of any kind.

### 13.3 Windows (`final-round-desktop-3.0.4-setup.exe` → `finalround.exe`, 211 MB unpacked, verified 2026-10-03)

| Item | Value |
|------|-------|
| Image name | `finalround.exe` (brand) |
| `FileDescription` | `Final Round` (brand — **no disguise**, unlike IC's `systemcontainer`) |
| `CompanyName` / `InternalName` / Copyright | `FinalRound AI` / `finalround` / `Copyright © 2026 FinalRound AI` (brand) |
| `OriginalFilename` | empty |
| `resources/elevate.exe` | present (Squirrel elevation helper — also shipped by LockedIn) |
| Renderer titles | `Final Round AI`, `Capture Halo`, `Intro` (brand) |
| userData | default Electron → `~/Library/Application Support/Final Round` (brand) |

So Final Round's Windows story is fully branded at every layer — the StealthService is a runtime-only construct on both platforms.

### 13.3 Network posture — ungated

Endpoints in main.js: `prod-finalroundai.frai.pro` (+ geo variant), `releases.finalroundai.com` (updater), `us.i.posthog.com`, Corgi fingerprint (`metrics.corgilabs.ai` + embedded API key), Sentry DSN (`o451066…@ingest.us.sentry.io`), GCS, Clerk (`clerk.finalroundai.com`). No stealth-conditional gating of any of these was found — stealth toggles *protection*, not *egress*. The `@fingerprint/agent` dependency + Corgi fingerprinting is unique in this set (device fingerprint beamed to a third party).

### 13.4 Assessment

Final Round has the **best-engineered runtime stealth** of any app in this report — a real service with persistence, creation-time hooks, a re-protection loop with a documented race rationale, dock handling that names the exact leak, and fullscreen-capture integration. But its **on-disk identity is fully branded** (bundle, exe, helpers, bundle ID, userData), and its network posture is ungated with a device-fingerprinting third party. It is the inverse of Natively's round-4 shape: superb runtime, zero identity work.

---

## 14. Final Seven-Way Ranking (identity vectors, hardest first to detect)

| Rank | App | On-disk identity | Display layer | Bundle ID | Network posture | Verdict |
|------|-----|------------------|---------------|-----------|-----------------|---------|
| 1 | **Natively (r1–4)** | Real system process alias | Brand display (deliberate split) | Plausible Apple ID | Gated in stealth | Hardest — rename + gating |
| 2 | **Interview Coder** | Neutral rename (`systemcontainer`) | Same rename | Real brand ID | Unknown | Strong on-disk, ID leaks brand |
| 3 | **LockedIn AI** | Real name | Blank both platforms (mac plist + Win `FileDescription` U+2800) + LSUIElement + user `process.title` | Real brand ID (+ malformed, helper display leak) | Cloud-by-design + Duo stream | Widest toolkit, leaky edges |
| 4 | **Final Round AI** | Real name | Real name | Real brand ID | Ungated + fingerprinting | Best runtime service, zero identity work |
| 5 | **Parakeet AI** | Real name | Blank (U+2800, mac only verified) | Real brand ID | Ungated Sentry | Beats display lists only |
| 6 | **Cluely** | Real name | Real name | Real brand ID | Analytics/update traffic | Runtime toggles only |
| — | **Sensei AI** | No binary (web SPA) | N/A | N/A | Web trackers (Pixel/Rewardful) | No stealth story at all |

LockedIn vs Final Round is dimension-dependent: LockedIn covers more identity surfaces (blank display both platforms, LSUIElement kills Dock/Cmd-Tab structurally, user-controlled process title, build-gated WDA); Final Round has the deeper runtime service (persisted default-on, re-protection loop, fullscreen integration) but concedes every identity surface including renderer titles. Against a basename/path proctor both fail identically; against display/taskbar enumeration LockedIn hides more.

---

## 15. Feature Takeaways for Natively (steal-worthy, ordered by payoff)

| # | Source | Idea | Fit with Natively | Cost |
|---|--------|------|-------------------|------|
| 1 | LockedIn | **User-chosen process title** (settings field → `process.title`, validated/trimmed) | Direct fit: Natively already writes per-mode titles; a user override is a small IPC + settings key. Closes the "my threat model names a specific allowlisted process" case | Low |
| 2 | FR + LockedIn | **Re-protection loop as backstop** (FR 500ms idempotent re-apply; LockedIn per-window result logging) | Natively's creation-hook held in testing, but the loop bounds worst-case exposure if the hook ever silently fails (FR cites a real Electron Win11 race). Idempotent guard makes it safe | Low |
| 3 | LockedIn | **Tooltip ban** (tooltips render outside webContents → escape content protection) | Audit Natively's tooltips/menus against capture; ban or re-parent any that leak | Low–Medium (audit first) |
| 4 | LockedIn | **WDA build-gated exclusion** (`WDA_EXCLUDEFROMCAPTURE` vs `WDA_MONITOR` by OS build, macOS always excluded) | Check what Natively's Windows content-protection path resolves to on old builds; adopt the gate if it assumes exclusion unconditionally | Low (investigate first) |
| 5 | LockedIn | **`LSUIElement`-class option** (no Dock/Cmd-Tab/menu ever) | Conflicts with the brand-split decision (Dock shows Natively by design in normal mode). Only viable as a stealth-mode-only Info.plist toggle + relaunch — heavy machinery for what the dock-hide loop already does | High, conflicts with brand |
| 6 | Parakeet | **2s Dock re-hide poll** | Natively's `_enforceDockState` loop already does this against OS ground truth — no action, confirmed parity | None (have it) |
| 7 | LockedIn | `quitWatchdog` (macOS quit-hang SIGKILL), `cpuHeatSampler` (perf diagnostics) | Reliability/diagnostics hygiene, not stealth — borrow the pattern if quit hangs ever surface | Low, opportunistic |
| — | FR | Sentry/Corgi fingerprinting, Duo-style human stream, `keyboard_monitor.node` scope | **Explicitly not recommended** — network exfil + privacy liability, opposite of the local-first posture | — |

---

---

## 17. Proctoring Apps: How They Detect (HackerEarth SmartBrowser Binary Analysis, verified 2026-10-03)

> Source: `HackerEarth/desktop-test-app` v1.0.3-beta (public GitHub), `SmartBrowser-arm64-1.0.3.dmg` (108 MB) mounted + asar extracted to /tmp copy; bundle triaged (codesign, PlistBuddy, entitlements); main JS `dist/main.bundle.js` (64 KB) analyzed statically. Original untouched, never executed.

### 17.1 Bundle identity (fully branded — proctors don't hide)

| Item | Value |
|------|-------|
| Bundle / exe / helpers | `SmartBrowser.app` / `SmartBrowser` / `SmartBrowser Helper*` |
| Bundle ID | `com.hackerearth.SmartBrowser` (helpers `.helper`) |
| Helper `CFBundleName` | Electron default (same pattern as every vendor) |
| Signature | HackerEarth Inc. (TQFP2QQB3M), hardened runtime |
| Entitlements | `screen-capture` temp exception, apple-events automation, mic/camera, JIT |

### 17.2 Detection mechanisms (the part that matters for Natively)

| # | Mechanism | Implementation (evidence) | What it sees |
|---|-----------|---------------------------|--------------|
| 1 | **Open-window enumeration (darwin)** | `desktopCapturer.getSources({types:["window","screen"]})`; allowlist `["Electron","SmartBrowser","HackerEarth","Entire screen"]`; anything else → `open-applications.html` block screen | **Window/source NAMES** (window titles + owning-app names) |
| 2 | **Open-window enumeration (win32)** | `active-win` `getOpenWindows()` → `owner.name` vs same allowlist | **Owner app names** (+ pid/path available in the struct) |
| 3 | **VM detection** | Process-name scan for VirtualBox/VMware/Hyper-V → `virtual-machine.html` + quit | VM process names |
| 4 | **External monitor** | `screen.getAllDisplays()` — >1 display or offset bounds → 10s logout + quit | Display topology |
| 5 | **Shortcut suppression** | In-app `before-input-event` (ctrl/alt/shift/meta combos) + external `disable_shortcuts.exe` (pyinstaller'd Python `keyboard` lib: kills Ctrl+Alt+Esc, Ctrl+Shift+Esc, Alt+Tab, Win key) | Key combos, OS-level on Windows |
| 6 | **Focus tracking** | Preload MutationObserver + click listeners → `from-test-window-preload` IPC; `active-win` focus data | Window blur/focus loss |
| 7 | **Logout/test-end detection** | webContents URL watch (`logout/`, ghost paths) → quit in 500ms | Navigation |
| 8 | **CDP snooping** | `webContents.debugger.attach("1.3")` + `Network.responseReceived` body reads | Test-state API traffic |
| 9 | **Screenshots/recordings** | Random webcam snapshots, screen recording, keystroke code-player (per trycontrol.app; employer-switched) | Everything visible |
| 10 | **Copy/paste + devtools** | Editor-level clipboard block, devtools disabled (`devTools:!1`) | Clipboard, debugger |

Notably **absent** (v1.0.3): no `ps`/`tasklist`/`NSWorkspace` process enumeration, no bundle-ID checks, no executable-path checks anywhere in the bundle. The `systeminformation` and `sudo-prompt` deps are required but never invoked in main (dead or renderer-side).

### 17.4 v3.1.1: dedicated stealth-interview-app detection (verified 2026-10-03)

> A second, newer installer (`smart-browser-installer.dmg`, SmartBrowser **v3.1.1**, Electron Forge, `dist/main/index.js` 1.5 MB) was obtained and analyzed. It adds exactly what the v1.0.3 analysis found missing: **process-level enumeration aimed at stealth interview apps**.

| # | Mechanism (v3.1.1) | Implementation (evidence) | What it sees |
|---|-------------------|---------------------------|--------------|
| 1 | **`detectStealthInterviewApps()`** | Runs in `checkHostEnvironment` alongside `detectVirtualMachine` + `detectRemoteAccess`; returns `{detected, findings: [{toolId, displayName, signal: "running_process", actionable}], probeErrors}` | Named stealth tools as a category |
| 2 | **darwin process list** | `ps -ax -o command=` → `executableNameFromDarwinPsCommand` (basename of the command path) | **Executable basenames** |
| 3 | **win32 process list** | Path-aware `listWindowsProcessMatchTexts` + `tasklist /fo csv` fallback (`parseWindowsProcessCsv`: name, PID, **executablePath**) | Names **+ full paths** |
| 4 | **Substring matching** | `matchesStealthInterviewApp`: normalized lowercase, whitespace-stripped `includes()` both directions | Any name/path *containing* a pattern |
| 5 | **Server-delivered policy** | Firebase Remote Config (`restricted_apps_policy`, `smartbrowserpolicy0001`); per-platform, categories (`remote_sharing` vs stealth vs process-level), `actionable` flags | **No static blocklist in the bundle** — patterns arrive per exam, like HackerRank |
| 6 | **RDP/remote-access check** | `RDP_TOOL_ID`, `RDP_DISPLAY_NAME`, `active_session` signal | Remote desktop sessions |
| 7 | **VM check (hardened)** | darwin `system_profiler SPHardwareDataType`; win32 PowerShell `Win32_ComputerSystem` CIM manufacturer/model (VirtualBox/VMware/QEMU/Xen/Parallels) | VM vendor strings |
| 8 | **Machine UUID** | Windows registry `MachineGuid`, macOS `IOPlatformUUID` | Device fingerprint |
| 9 | **CDP debugger** | `debugger.attach("1.3")` for ANR stack capture + Network interception on `hackerearth.com/*` | Renderer hangs, API traffic |
| 10 | **Overlay window** | New `overlay_window` renderer surface (absent in v1.0.3) | — |

No `cluely`/`natively`/`parakeet`/`finalround`/`lockedin`/`interviewcoder`/`corespeechd`/`systemcontainer`/`audiodg` strings exist anywhere in the bundle — **all tool patterns are server-delivered**, so absence today proves nothing about tomorrow.

### 17.5 What this means for Natively (updated)

HackerEarth v3.1.1 detects by **process basenames + executable paths + window names + focus**, with server-side patterns:
- ✅ `corespeechd` basename contains no known-tool substring; `…/corespeechd.app/Contents/MacOS/corespeechd` path contains none either. The `userData` argv string (`…/Natively`) is **not** scanned — enumeration reads process commands/paths, and the app binary path is clean.
- ✅ Overlay disguise titles + title guard hold for the window-name surface (unchanged from v1.0.3).
- ⚠️ **Substring matching cuts both ways**: any future server pattern like `speech`, `helper`, or `monitor` would match `corespeechd` / `corespeechd Helper` / `monitor-view`-class names instantly. The alias is clean against *tool-name* patterns but lives closer to generic-word patterns than a random string would. Worth re-checking if HackerEarth ever publishes a pattern list.
- ⚠️ Focus discipline + keystroke surfaces unchanged from v1.0.3 analysis.

### 17.3 What this means for Natively

HackerEarth SmartBrowser detects by **window names and focus**, not by process identity:
- ✅ Natively's overlay windows carry disguise titles in stealth (`Terminal`/`System Settings`/`Activity Monitor`) — none match a blocklist, and the title guard keeps the brand out.
- ✅ `corespeechd` exe/helpers pass any name-based check trivially.
- ⚠️ **Window-count surface**: an extra visible overlay window exists while screen-sharing. Content protection excludes Natively's own windows from captures, but SmartBrowser's enumeration sees *names*, not pixels — a window literally titled `Activity Monitor` during a coding test is camouflage, not invisibility. Plausible-deniability holds only if the title is context-plausible.
- ⚠️ **Focus discipline**: clicking the overlay (reading answers) fires blur on the test window — the preload focus tracker and `active-win` both record it. No disguise fixes behavior; this is a usage-discipline surface.
- ⚠️ **Keystroke code-player**: records keystrokes on programming questions — typed activity with no corresponding editor input is anomalous regardless of stealth.

---

## 18. Micro1 (Zara + Ava) — Web Proctoring Analysis (no binary exists)

> Micro1's interviews run entirely in the browser (Zara AI avatar + Monaco editor, camera + screen-share on throughout). There is no desktop app — WebCatalog's "desktop app" is a site wrapper. Analysis from first-hand technical + UX walkthroughs (aitrainer.work, Sept–Oct 2026).

| # | Mechanism (Ava anti-cheat) | How it works | Natively implication |
|---|---------------------------|--------------|----------------------|
| 1 | **Gaze tracking** | Eye-dart detection (second monitor, phone look-downs) → "Focus Violation" | Behavioral — no software countermeasure exists or should |
| 2 | **Tab-switch / focus lock** | Browser focus lock; Cmd+Tab or outside clicks recorded | Same focus-discipline surface as HackerEarth |
| 3 | **Extension code-injection detection** | Scans for AI-copilot *browser extension* injection → auto-fail | **Architecturally out of reach for a desktop overlay**: Natively injects nothing into the browser DOM. This check cannot see it by construction |
| 4 | **Integrity score (70% floor)** | Gaze + tab + extension signals fused; below 70% = auto-reject regardless of answers | Score-based, not blocklist-based — partial signals accumulate |
| 5 | **Clipboard disabled** | No paste in the Monaco editor | Same as HackerEarth |
| 6 | **VAD interruption** | Zara treats silence/re-reading as turn-end and moves on | Interview-dynamics note, not stealth |

**Key architectural point:** Ava hunts *browser extensions*, not desktop processes. A desktop overlay that never touches the browser is invisible to its primary code detector. The remaining exposure is behavioral (gaze, focus) plus screen-share pixels (covered by content protection).

---

## 19. Pearson OnVUE — Binary Analysis (v26.19.69, verified 2026-10-03)

> Source: `~/Downloads/OnVUE.app` (Electron, bundle ID `com.electron.onvue`), unpacked asar analyzed statically (readable JS, not minified); original untouched, never executed. Package: `Pearson-VUE/OP_Onvue`.

### 19.1 Bundle identity (fully branded, hardened, notarized-class signing)

| Item | Value |
|------|-------|
| Bundle / exe / helpers | `OnVUE.app` / `OnVUE` / `OnVUE Helper*` |
| Bundle ID | `com.electron.onvue` (Electron-default style, brand-adjacent) |
| Helpers | `CFBundleName` Electron default, DisplayName `OnVUE Helper*`, IDs `com.electron.onvue.helper` |
| Signature | Developer ID: NCS PEARSON INC (Y75Z7G683Y), hardened runtime |
| Entitlements | apple-events automation, JIT/unsigned-mem, mic/camera/audio-input |

### 19.2 Detection architecture — three layers, the third unobtainable statically

| Layer | Mechanism (evidence) | What it sees |
|-------|---------------------|--------------|
| 1. **BrowserLock child process** | `browser-lock.service.js` downloads `browser-lock.zip` per session (arch-specific URL, 3 attempts), extracts `Pearson VUE Browser Lock.app` / `BrowserLock.exe`, spawns it with server-minted params (locale, token, tempFilePath, launch mode). Pre-check mode runs it in background: it **writes illegal processes to a file and exits (code 13)** | Full process scan — internals live in the downloaded binary, not in this bundle |
| 2. **In-app monitors** | Clipboard watcher (250ms, access-code regex only — not general snooping); 60s candidate-service state polling; focus/blur routing; webrtc + screen-capture windows streaming to the proctor; candidate-warning popups | Clipboard access codes, session state, focus, live screen + webcam |
| 3. **Human proctor** | Check-in flow, close-all-apps gate, desk/room inspection over webcam; can cancel + forfeit fee live | Everything a human sees — the layer no software defeats |

Launch params (incl. the illegal-process check toggle and shutdown-file path) are minted server-side per exam (`getBrowserLockLaunchParameters`), so the blocklist is **exam-specific and server-delivered** — there is no static list to extract from this bundle.

### 19.3 Assessment (revised — was rules-only)

OnVUE is two different problems: a conventional Electron lockdown shell (fully branded, no disguise of its own) plus a **server-delivered scanner binary whose blocklist is per-exam and invisible statically**. Against layer 1, Natively's `corespeechd` identity is as clean as anything can be without knowing the list. Against layer 3, the standing verdict holds unchanged: **do not run Natively here** — a human saying "close everything, show me your desk" ends the discussion.

---

## 20. HackerRank Desktop — Status + Prior Findings

> The HackerRank.app copy previously on this machine (v0.51.0, `com.hackerrank.app`, fully reversed earlier in this session) is **no longer installed** — but the **`HackerRank-latest-arm64.dmg` (161 MB) now in ~/Downloads mounts the identical v0.51.0** (`com.hackerrank.app`, asar byte-identical at 208,960,595 bytes, signer Interviewstreet Incorporation 9JMZ878247). Prior findings re-verified against the mounted image; a live re-test needs a test invite (no public DMG exists — this copy came from a test link).

Recap of verified mechanisms (v0.51.0 asar):
- **Process enumeration** via native `get_processes` (Rust module: `proc_listpids`-class listing) — reads comm/path per PID.
- **Window enumeration** via `open_windows` (CGWindowList: owner name/PID, title, bounds, flags) — the `Er` blocklist matches process-name substrings: `cluely`, `CoreSpeech Helper`, `corespeechd_helper`, `InterviewMan`, remote-desktop tools; plus `Mr`/`Ar` exe/title regexes (getscreen, parsecd, DWAgent, iperius…).
- **TCC scan** — screen-recording-capable apps enumerated by bundleId/execPath (`matchTccClientsToProcesses`).
- **Kill switch** — `killProcesses` by PID for flagged apps; `closeAllApps` on detection during kiosk mode.
- **Self-protection gap** — no self-PID exclusion found in the scan path (it can see itself; filtering happens downstream).

**Natively posture vs HackerRank:** `corespeechd` basename is NOT in the `Er` list (`corespeechd_helper` is — Natively has no such process); `com.apple.corespeechd` bundle ID is not blocklisted; overlay titles are disguised. The residual risks are the same two as everywhere: focus discipline and the `Natively` userData argv string.

---

## 21. Proctor-Side Ranking (what actually catches a disguised app)

| Rank | Proctor | Detection depth | Natively exposure |
|------|---------|-----------------|-------------------|
| 1 | **Pearson OnVUE** | Human watches screen + room, close-all-apps gate | Total — do not run it here |
| 2 | **HackerRank Desktop** | Native proc + window enumeration, blocklists, kill switch, TCC scan | Low — names/IDs clean; focus + argv residuals |
| 3 | **HackerEarth SmartBrowser (v3.1.1)** | Dedicated `detectStealthInterviewApps`: ps-basename (mac) + path-aware (win) substring matching, server-delivered Firebase patterns, RDP/VM/machine-UUID, CDP snooping | Low — names/paths clean today; server patterns can change silently; focus discipline is the surface |
| 4 | **Micro1 (Ava)** | Browser-only: gaze, focus, extension-injection scan | Minimal — desktop overlay is architecturally out of scope; behavior only |

---

## 22. Disclaimer

This analysis was conducted on locally installed applications in an authorized environment. All reverse engineering was performed on legally obtained software (Cluely (New) v2.0.198, pre-installed; ParakeetAI.app v3.9.100, installed and logged-in; Final Round.app v3.0.4 arm64 + `final-round-desktop-3.0.4-setup.exe` from the vendor's public feed; LockedIn.app v1.9.4 from mounted DMG + `LockedIn Setup 2.0.8.exe` NSIS payload; HackerEarth SmartBrowser v1.0.3 arm64 from the vendor's public GitHub releases; OnVUE.app v26.19.69 found in ~/Downloads, unpacked-asar analysis; asar/binary extractions to /tmp copies — originals untouched, nothing executed by the analyst) for the purpose of competitive security analysis and product improvement. Sensei AI has no public desktop binary (web SPA only); Micro1 is browser-only by design — those sections are rules/claims analysis with counter-evidence, clearly marked as unverified. HackerRank findings recap earlier same-session analysis (binary currently uninstalled). No redistribution, cracking, or unauthorized access was performed.

**Report Generated:** 2026-10-03 (extended with Parakeet binary §2, Sensei §11, LockedIn binary §12, Final Round binary §13 + Windows, ranking §14, takeaways §15, proctor analysis §17–§21 incl. OnVUE binary §19, SmartBrowser v3.1.1 §17.4, HackerRank DMG re-verify §20)
**Verification status:** Cluely + Parakeet + Final Round (mac + win) + LockedIn (mac + win) + HackerEarth SmartBrowser (v1.0.3 + v3.1.1) + Pearson OnVUE findings verified against live bundles/installers (codesign, PlistBuddy, asar/NSIS/DMG extraction, PE version-resource parsing, grep over main JS). HackerRank v0.51.0 DMG re-verified byte-identical. Sensei/Micro1 have no obtainable binaries — rules/claims analysis. Interview Coder values from case `ic-stealth` evidence E-001/E-002.
**Classification:** Internal - Competitive Analysis