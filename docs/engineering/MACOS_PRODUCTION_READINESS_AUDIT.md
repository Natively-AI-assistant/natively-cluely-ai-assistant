# macOS Production Readiness Audit — Natively

**Status:** LIVING DOCUMENT — updated after every phase.
**Started:** 2026-05-29
**Owner of last edit:** Claude Code (autopilot)
**App version:** 2.6.0
**Goal:** Make Natively behave like a real, Developer ID-signed + notarized production macOS desktop app — not a hacked ad-hoc local build. Cover signing/notarization, permissions/TCC, overlay/visibility toggle reliability, audio capture stability, premium/Natively-API gating, startup performance, and UX reliability.

---

## 0. How to read this document

- **Section 1** is the prioritized file map (what to touch, in what order, and why).
- **Section 2** is the per-area findings (confirmed issues, suspected issues, evidence).
- **Section 3** is the running phase log (high-level; the granular restart-safe log lives in `MACOS_PRODUCTION_FIX_PROGRESS.md`).
- The human-facing before/after report lives at repo root in `fixreport.md`.

Three docs are kept in sync after every phase:
1. `docs/engineering/MACOS_PRODUCTION_READINESS_AUDIT.md` (this file — analysis + map)
2. `docs/engineering/MACOS_PRODUCTION_FIX_PROGRESS.md` (restart-safe tracker)
3. `fixreport.md` (human review report)

---

## 1. Priority file map

Priority legend: **P0** = ship-blocker / money / security. **P1** = major UX/perf. **P2** = diagnostics/tests. **P3** = polish.

### P0 — Premium & Natively API (money path)
| File | Role | Why P0 |
|------|------|--------|
| `premium/electron/services/LicenseManager.ts` | License validation, plan resolution | Core paid gating. Offline/failed-check degradation, key redaction. |
| `electron/premium/featureGate.ts` | Runtime probe for premium modules | Decides whether paid code loads at all. |
| `src/premium/index.tsx` | Renderer-side premium component loader (Vite glob) | Controls premium UI surfacing + ad campaigns. |
| `src/components/settings/NativelyApiSettings.tsx` | Natively API key UI | Key entry/validation/redaction. |
| `src/components/settings/NativelyProSettings.tsx` | Pro plan UI | Plan separation, upgrade copy. |
| `electron/audio/NativelyProSTT.ts` | Pro-tier hosted STT | Gated capability; failure messaging. |
| `electron/services/CredentialsManager.ts` | Secret storage (keytar) | Key persistence + redaction. |
| `electron/services/RateLimiter.ts` | API quota | Quota-exhausted vs failure separation. |
| `natively-api/server.js` + `natively-api/lib/*` | Backend license/activation | Source of truth for plan→feature mapping (read-only reference). |

### P0 — Signing / Notarization / Entitlements / Permissions
| File | Role | Why P0 |
|------|------|--------|
| `package.json` (`build` block) | electron-builder config | `identity: null`, `hardenedRuntime: false`, no notarize hook → **cannot notarize**. |
| `scripts/ad-hoc-sign.js` | afterPack ad-hoc signer | Silently ad-hoc-signs *production* artifacts; uses deprecated `--deep`. |
| `assets/entitlements.mac.plist` | Hardened runtime entitlements | Must match notarization requirements (mic, screen-capture, JIT). |
| `scripts/patch-electron-plist.js` | Dev Electron.app Info.plist patcher | Dev-only TCC usage strings; correct, keep. |
| `scripts/build-native.js` | Rust native module build | `.node` signing under hardened runtime. |
| `electron/main.ts` | App lifecycle, activation policy, permission rechecks | TCC recheck timing, dock registration. |

### P0 — Overlay / Stealth / Visibility toggle
| File | Role | Why P0 |
|------|------|--------|
| `electron/WindowHelper.ts` | Window show/hide/opacity/content-protection/always-on-top | Fast-toggle race; 1s-invisible bug. |
| `native-module/src/stealth_window.rs` | Native stealth window ops | Native call latency vs UI state. |
| `electron/services/StealthKeyboardManager.ts` | Keyboard tap / block-input | Stealth state coupling. |
| `electron/services/KeybindManager.ts` | Global shortcut registration | Toggle entry point, concurrent calls. |
| `electron/ipcHandlers.ts` | IPC for visibility/stealth/toggle | Must return reliable success/failure. |
| `src/components/ui/TopPill.tsx`, `src/components/NativelyInterface.tsx` | Renderer toggle UI | Renderer state vs main desync. |

### P0 — Audio capture reliability
| File | Role |
|------|------|
| `electron/audio/MicrophoneCapture.ts`, `electron/audio/SystemAudioCapture.ts` | Capture lifecycle |
| `electron/audio/nativeModuleLoader.ts` | Native module load |
| `electron/audio/{Deepgram,OpenAI,Soniox,Google,Rest,NativelyPro}*STT.ts` | STT providers start/stop |
| `native-module/src/{microphone.rs,speaker/*.rs}` | Native capture |

### P1 — Startup performance & window lifecycle
| File | Role |
|------|------|
| `src/main.tsx`, `src/App.tsx`, `src/components/StartupSequence.tsx` | Renderer boot |
| `electron/main.ts` | Main process boot ordering |
| `electron/{SettingsWindowHelper,ModelSelectorWindowHelper,CropperWindowHelper}.ts` | Secondary windows |
| `electron/rag/*`, `electron/audio/whisper/*`, `resources/models/*` | Heavy init to defer |

### P2 — Telemetry / diagnostics / logging
| File | Role |
|------|------|
| `electron/verboseLog.ts` | Central logging + redaction |
| `electron/services/telemetry/*` | Event emission |

### P2/P3 — Tests & docs
| File | Role |
|------|------|
| `electron/services/__tests__/*`, `electron/audio/__tests__/*`, `electron/llm/__tests__/*` | Node test suites |
| `electron/test/*`, `tests/e2e/*` | Edge/E2E |

---

## 2. Findings by area

### 2.1 Signing / Notarization — CONFIRMED GAPS (P0)

Evidence from `package.json` `build.mac` and `scripts/ad-hoc-sign.js`:

| # | Gap | Evidence | Impact | Notarizable? |
|---|-----|----------|--------|--------------|
| S1 | **Hardened Runtime disabled** | `"hardenedRuntime": false` | Apple notarization **requires** hardened runtime. Build can never be notarized as-is. | ❌ blocker |
| S2 | **No signing identity** | `"identity": null` | Forces ad-hoc; ad-hoc binaries cannot be notarized and have no stable Team ID. | ❌ blocker |
| S3 | **Ad-hoc signs production artifacts** | `afterPack: ad-hoc-sign.js` runs `codesign --sign -` | Production zip/dmg ship ad-hoc-signed → Gatekeeper "damaged/unverified", TCC perms unstable across builds. | ❌ blocker |
| S4 | **No notarization/staple hook** | `@electron/notarize` in devDeps but no `afterSign`/`notarize` config | Even with identity, nothing uploads for notarization or staples the ticket. | ❌ blocker |
| S5 | **Generic appId** | `"appId": "com.electron.meeting-notes"` | Stale Electron-sample-style bundle id; unprofessional, risks TCC collision with other Electron apps. Changing it later resets TCC. | ⚠️ decision |
| S6 | **`--deep` signing** | `codesign --force --deep` | `--deep` is deprecated by Apple and notoriously breaks nested signatures; correct approach signs inside-out (electron-builder does this natively when given an identity). | ⚠️ |
| S7 | **xattr/quarantine assumptions** | (to verify in README/install docs) | Any "run `xattr -cr`" user instruction implies the build isn't properly notarized. | ⚠️ |

**Root-cause synthesis:** the build is intentionally ad-hoc for local distribution. To go production we need: a real Developer ID Application certificate, hardened runtime ON, entitlements applied by electron-builder (not a manual `--deep` pass), an `afterSign` notarize+staple step, and a stable professional appId. Most of this can be **wired up and validated structurally locally**; the actual cert + notarization upload **requires the paid Apple Developer Program account** (documented as a hard external dependency).

### 2.2 Premium / Natively API — STRUCTURE MAPPED (audit pending Phase 2)
- Premium ships as a **git submodule** (`premium/`). Open-source builds omit it; `featureGate.ts` probes via `require()` and `src/premium/index.tsx` via Vite `import.meta.glob` with null fallbacks. This is a clean optional-module pattern.
- Plan tiers referenced in code: API plans (Standard/Pro/Max/Ultra) vs desktop **Lifetime Pro**. Separation correctness + offline degradation + key redaction to be verified in Phase 2.
- `natively-api/` is the authoritative backend (license check, activation, webhooks). Treat as read-only reference.

### 2.3 Toggle / Visibility — SUSPECTED (investigation dispatched Phase 3)
- Symptom: rapid toggling desyncs; ~5s wait "fixes" it → race between renderer state, main-process window ops, and native stealth calls. ~1s invisible window during on/off.
- Hypotheses to confirm: concurrent toggle calls (no serialization/lock), IPC handlers not returning reliable success/failure, native Rust call latency exceeding UI update, conflicting `setOpacity`/`hide`/`setContentProtection`/`setIgnoreMouseEvents`/`setVisibleOnAllWorkspaces` ordering, unmount/remount flicker.

### 2.4 Audio — prior work exists
- Extensive prior hardening (see `AUDIO_RELIABILITY_REPORT.md`, memory `audio_*`). Phase 4 verifies serialization of start/stop, no dangling streams on rapid toggle, distinct error states, no stuck "listening".

### 2.5 Startup performance — SUSPECTED (Phase 5)
- Janky startup animation + slow renderer boot. Inspect heavy synchronous imports, model/native-module load on boot, premium/license check blocking first paint.

---

## 3. Phase log (summary)

| Phase | Area | Status | Date |
|-------|------|--------|------|
| 0 | Repo scan, priority map, docs | ✅ done | 2026-05-29 |
| 1 | Signing/notarization/entitlements/permissions | ✅ done (reviewed; live notarization needs Apple cert) | 2026-05-29 |
| 2 | Premium + Natively API gating | ✅ F4 fixed + tested (money path otherwise sound; F5/F7 UX follow-ups) | 2026-05-29 |
| 3 | Toggle/visibility/stealth state machine | ✅ RC-2 desync fixed + tested (1s-flicker + queue = GUI follow-ups) | 2026-05-29 |
| 4 | Audio capture reliability | ✅ bug1 (stuck-watchdog) + bug2 (in-flight init abort/AbortController) BOTH fixed+tested (12/12 lifecycle) | 2026-05-29 |
| 5 | Startup performance + window lifecycle | ✅ unused startup font removed; 4 bigger wins documented (need GUI/profiling) | 2026-05-29 |
| 6 | Telemetry/logging redaction | ✅ audit found NO secret leaks (verification done in Phase 2) | 2026-05-29 |
| 7 | Final review + QA + reports | ✅ per-phase reviews done; consolidated (see fixreport) | 2026-05-29 |

See `MACOS_PRODUCTION_FIX_PROGRESS.md` for granular, restart-safe detail.
