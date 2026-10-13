# Linux X11 Port — Product Requirements Document

**Status:** Draft  
**Owner:** TBD  
**Last updated:** 2026-05-26  
**Related ADR:** [0001-linux-x11-only](../adr/0001-linux-x11-only.md)  
**Related CCDD:** `tmp/collective-collaborative-deep-dive/2026-05-26_linux-x11-port/`

---

## Problem statement

Natively is a macOS/Windows-first Electron desktop assistant for live meeting transcription, screen understanding, and stealth overlay workflows. The repository contains partial Linux scaffolding (electron-builder Linux targets, CPAL microphone capture, shell-based screenshots), but the product is **not shippable on Linux** today.

The primary blocker is **system-audio capture**: `native-module/src/speaker/mod.rs` exposes a Rust fallback that always errors on non-macOS/non-Windows platforms, which breaks dual-channel meeting capture (microphone + remote participants). Secondary gaps include screenshot capture paths that bypass `desktopCapturer`, overlay behavior that lacks macOS NSPanel/CGEventTap equivalents, packaging omissions (native `.so` unpack, sqlite-vec Linux packages), macOS-only CI, and platform copy that references macOS permissions.

This PRD defines a phased plan to deliver a **production-quality Linux port targeting X11 sessions only**. Wayland is explicitly out of scope (see ADR 0001).

---

## Goals

1. Ship a Linux `.deb` build for x64 that supports the core meeting workflow: start meeting → capture mic + system audio → transcribe → overlay assistance → screenshots.
2. Implement real system-audio loopback on Linux via PulseAudio and/or PipeWire (see ADR 0001).
3. Provide functional screenshot capture on X11 using vetted shell tools with clear failure messages when tools are missing.
4. Deliver a usable transparent overlay on composited X11 (always-on-top, frameless window).
5. Register global shortcuts via Electron `globalShortcut` on X11 with Linux-appropriate error UX.
6. Fix packaging and CI so Linux artifacts build reproducibly and native modules load at runtime.
7. Branch user-facing copy and onboarding for Linux (no macOS System Settings references).

## Non-goals

- **Wayland support** (native or XWayland-only targeting). See ADR 0001.
- Feature parity with macOS stealth keyboard tap (CGEventTap) or NSPanel non-activating overlay semantics.
- ARM64 Linux release artifacts in v1 (x64 only for initial ship; arm64 may follow).
- Flatpak or Snap packaging in v1 (`.deb` only for x64, matching electron-builder config).
- Re-architecting the renderer or LLM pipeline for Linux.
- Solving every desktop environment edge case; v1 targets a defined support matrix (below).

---

## User personas and use cases

### Persona A — Remote interview candidate (Ubuntu + GNOME, X11)

Uses Natively during technical interviews on Zoom/Google Meet. Needs mic transcription plus **system audio** (interviewer voice from speakers/headphones). Expects global hotkeys (e.g. Ctrl+H screenshot) and a floating overlay that stays above the meeting window without stealing focus from the IDE.

### Persona B — Power user on i3/sway-compatible X11 stack (Xfce, KDE X11)

Runs minimal WM setups. Needs reliable global shortcuts, full-screen and selective screenshots without external GUI blocking the WM, and clear errors when `scrot`/`import`/`gnome-screenshot` are unavailable.

### Persona C — Self-hosting / privacy-focused developer

Builds from source on Linux. Needs `npm run app:build` (or documented Linux equivalent) to produce a working artifact, native module load without missing `.so`, and meeting-history RAG with sqlite-vec or documented JS fallback.

---

## Current state (verified in repo)

| Area | macOS/Windows | Linux today |
|------|---------------|-------------|
| System audio | CoreAudio / WASAPI loopback | Rust stub always errors (`speaker/mod.rs` fallback) |
| Microphone | CPAL | CPAL (likely works; needs validation) |
| Full screenshot | `desktopCapturer` | Shell: `gnome-screenshot` → `scrot` → `import` |
| Selective screenshot | `desktopCapturer` + stitch | Interactive shell selection only |
| Overlay | NSPanel + stealth keyboard | Generic transparent `BrowserWindow` |
| Global shortcuts | `globalShortcut` + macOS tap | `globalShortcut` only (no stealth tap) |
| Native packaging | `.node` + `.dylib` in asarUnpack | `.node` only; **no `*.so` in asarUnpack** |
| sqlite-vec | darwin arm64/x64 forced install | No Linux package in `ensure-sqlite-vec.js` |
| CI | macOS-only `build-smoke.yml` | No Linux lane |
| `app:build` | `NATIVELY_BUILD_ALL_MAC_ARCHES=1` hardcoded | No Linux release workflow documented |

---

## Functional requirements by phase

### Phase 0 — Foundation and guardrails

| ID | Requirement |
|----|-------------|
| F0.1 | Detect X11 vs Wayland at startup; if Wayland session detected without usable X11 (`DISPLAY` unset or `WAYLAND_DISPLAY` only), show a blocking dialog with ADR rationale and exit or disable capture features. |
| F0.2 | Add CI job: `cargo check` / `napi build` for `x86_64-unknown-linux-gnu` and Electron smoke (`build` + `build:electron`) on `ubuntu-latest`. |
| F0.3 | Document Linux dev prerequisites (Rust, build-essential, Pulse/PipeWire dev libs, screenshot tools) in README or `docs/LOCAL_STT_NATIVELY_SETUP.md` companion. |
| F0.4 | Audit and fix Linux-specific permission/onboarding copy (no "System Settings → Privacy & Security"). |

### Phase 1 — P0 system audio (Pulse/PipeWire loopback)

| ID | Requirement |
|----|-------------|
| F1.1 | Replace `speaker/mod.rs` fallback with `speaker/linux.rs` implementing `SpeakerInput`, `SpeakerStream`, `list_output_devices`, `default_output_device_uid`. |
| F1.2 | Capture system audio via PulseAudio monitor source and/or PipeWire `pipewire-pulse` compatibility (single abstraction; document which APIs are used). |
| F1.3 | Meeting start with default output device succeeds on reference X11 machine: system-audio stream delivers non-zero PCM within 8 seconds. |
| F1.4 | Device list IPC returns at least one monitor/loopback device when audio is playing. |
| F1.5 | Graceful error when Pulse/PipeWire unavailable: user-visible message naming the missing service and install hint (e.g. `pipewire-pulse`, `pulseaudio`). |

### Phase 2 — Screenshot capture

| ID | Requirement |
|----|-------------|
| F2.1 | Full-screen screenshot on Linux produces a valid PNG in app-owned `userData` directory without user interaction. |
| F2.2 | Selective screenshot invokes interactive tool; Esc/cancel returns `{ cancelled: true }` to renderer (existing IPC contract). |
| F2.3 | When no screenshot tool is installed, error message lists install commands for at least one of: `gnome-screenshot`, `scrot`, `imagemagick` (`import`). |
| F2.4 | Path safety: shell commands only run for paths under `userData` (existing guard in `ScreenshotHelper.getScreenshotCommand`). |
| F2.5 | (Stretch) Evaluate `desktopCapturer` on X11 Electron build; if viable, prefer it over shell for non-interactive full-screen capture. |

### Phase 3 — Shell, overlay, and window behavior

| ID | Requirement |
|----|-------------|
| F3.1 | Overlay window: frameless, transparent, `alwaysOnTop`, `skipTaskbar` on Linux X11 (existing `WindowHelper` path). |
| F3.2 | On composited X11 (Compositor running), overlay background is visually transparent; on non-composited session, show one-time warning that transparency may not work. |
| F3.3 | Main window hide/show for screenshot capture completes within existing timing budget (40 ms Linux path in `withScreenshotCaptureSession`). |
| F3.4 | Content protection API: document Linux behavior (no-op or limited vs macOS). |

### Phase 4 — Global shortcuts and keyboard UX

| ID | Requirement |
|----|-------------|
| F4.1 | Default shortcuts use `CommandOrControl` mapping (existing `KeybindManager`); UI displays `Ctrl` not `⌘` on Linux. |
| F4.2 | When `globalShortcut.register` fails, show Linux-specific remediation (conflicting app, WM grabs) — not macOS Accessibility instructions. |
| F4.3 | Chat focus shortcut (Ctrl+Shift+Space) toggles overlay input when registration succeeds. |
| F4.4 | No dependency on macOS `StealthKeyboardManager` / CGEventTap for Linux code paths. |

### Phase 5 — Packaging and release engineering

| ID | Requirement |
|----|-------------|
| F5.1 | Add `**/*.so` to electron-builder `asarUnpack` alongside `**/*.node`. |
| F5.2 | Extend `scripts/ensure-sqlite-vec.js` with Linux x64 (and optionally arm64) packages, or document and test JS cosine fallback as acceptable for v1 with metric target. |
| F5.3 | Linux `app:build` script variant without `NATIVELY_BUILD_ALL_MAC_ARCHES`; produces `.deb` for x64. |
| F5.4 | GitHub Actions workflow (or extended smoke) builds Linux artifact on tag/release. |
| F5.5 | Native module loader resolves `index.linux-x64-gnu.node` from packaged layout (verify `electron/audio/nativeModuleLoader.ts` paths after pack). |

### Phase 6 — Polish and support matrix validation

| ID | Requirement |
|----|-------------|
| F6.1 | README badge and download section include Linux X11 with explicit Wayland exclusion. |
| F6.2 | Manual QA pass on reference distros (below). |
| F6.3 | Install ping and telemetry include `platform: linux` without regression. |
| F6.4 | Help/onboarding: Linux permission steps (mic via portal/prompt; no Screen Recording TCC analog). |

---

## Non-functional requirements

### Performance

- System-audio + mic combined capture: end-to-end STT latency within 150% of macOS baseline on reference hardware (same model/provider).
- Screenshot capture: full-screen shell path completes in ≤ 3 s on 1080p X11 session.
- Overlay show/hide: ≤ 200 ms perceived delay.

### Security

- Screenshot shell commands: no user-controlled path segments; maintain `userData` prefix check.
- No broadened IPC surface for Linux; reuse existing meeting/screenshot channels.
- Document that Linux lacks macOS-style TCC; mic access follows Electron/Chromium portal prompts.

### Supported platforms (v1)

| Dimension | In scope | Out of scope |
|-----------|----------|--------------|
| Display server | **X11** (`DISPLAY` set, Xorg or XWayland-backed X11 client) | Native **Wayland** sessions |
| Architecture | x86_64 | arm64 (later), 32-bit |
| Distros (reference QA) | Ubuntu 22.04/24.04 LTS (GNOME/Xorg or X11 session), Fedora 40+ (X11 session), Debian 12 | Exotic or non-glibc-only without explicit port |
| Desktop environments | GNOME (X11), KDE Plasma (X11), Xfce | Pure tiling WMs — best-effort only |
| Audio stack | PipeWire + pipewire-pulse, PulseAudio | JACK-only without Pulse bridge |
| Compositor | Required for overlay transparency | Non-composited X — degraded UX accepted with warning |

---

## Success metrics

| Metric | Target |
|--------|--------|
| Meeting start success rate (mic + system audio) on reference Ubuntu X11 | ≥ 95% in QA matrix |
| System-audio non-silent within 8 s | ≥ 90% when media is playing |
| Full screenshot success when ≥1 tool installed | 100% |
| Linux CI green on every PR | 100% |
| Critical user journeys without macOS-only strings | 100% (onboarding, settings, errors) |
| GitHub release artifact installs and launches | `.deb` on Ubuntu 22.04/24.04 |

---

## Dependencies

- Rust toolchain + `napi-rs` build for Linux gnu target.
- PulseAudio and/or PipeWire with monitor/loopback sources (runtime).
- At least one of: `gnome-screenshot`, `scrot`, or ImageMagick `import` (runtime, user-installable).
- X11 compositor for overlay transparency (Mutter, KWin, Xfce compositor, picom, etc.).
- Electron 22+ Linux build behavior for `globalShortcut` on X11 (validate against pinned Electron version in repo).
- Optional: upstream `sqlite-vec` Linux prebuilds for native vector search.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PipeWire vs Pulse API differences | Audio fails on some distros | Single abstraction; test Ubuntu + Fedora; clear runtime detection |
| Screenshot tool absence | Broken screen understanding | Pre-flight check + install hints; consider bundling static scrot in extraResources |
| WM grabs global shortcuts | Hotkeys fail on i3/etc. | Document limitations; settings to rebind |
| No stealth keyboard on Linux | Parity gap vs macOS | Document in ADR; Ctrl+Shift+Space still via globalShortcut |
| Electron X11 deprecation long-term | Future maintenance | ADR records X11-only v1; revisit Wayland in separate initiative |
| sqlite-vec no Linux binary | Slower RAG | JS fallback already exists; measure and accept or vendor .so |

---

## Out of scope (explicit)

- Native Wayland protocols (`wl_shm`, `xdg-desktop-portal` screencast as primary path).
- XWayland-only detection as a supported "mode" (users may run under XWayland if `DISPLAY` works, but we do not test Wayland-native sessions).
- macOS-style screen-recording permission UX on Linux.
- Windows/Linux parity for SCK experimental toggle.
- Auto-update Linux channel (can follow after first stable Linux release).

---

## Acceptance criteria checklist

Use this list for release sign-off and test authoring. Each item must be verifiable by automated test, scripted check, or documented manual QA step.

### Platform gate

- [ ] **AC-G1:** On Ubuntu 22.04/24.04 with `echo $XDG_SESSION_TYPE` → `x11`, app launches to main window without crash.
- [ ] **AC-G2:** On Ubuntu with `XDG_SESSION_TYPE=wayland` and no functional X11 for Electron, app shows Wayland unsupported message within 10 s of launch (per F0.1).
- [ ] **AC-G3:** `npm run build:electron && npm test` passes on Linux CI job.

### System audio (P0)

- [ ] **AC-A1:** Starting a meeting with default audio devices does not return error containing `Unsupported platform: system audio capture`.
- [ ] **AC-A2:** With YouTube playing on default output, system-audio RMS or chunk counter exceeds silence threshold within 8 s (automated or scripted QA).
- [ ] **AC-A3:** `list_output_devices` returns ≥ 1 entry on machine with active Pulse/PipeWire sinks.
- [ ] **AC-A4:** With PulseAudio stopped and PipeWire unavailable, meeting start shows error mentioning audio server/install — not a Rust panic.
- [ ] **AC-A5:** Mic-only fallback: if system audio fails, user sees distinct warning and mic transcription still runs (existing behavior preserved).

### Screenshots

- [ ] **AC-S1:** With `scrot` installed, full screenshot hotkey writes PNG under `userData` and IPC returns valid preview.
- [ ] **AC-S2:** Selective screenshot cancel (Esc) returns `{ cancelled: true }` without throwing.
- [ ] **AC-S3:** With all screenshot tools removed, error message includes at least one install suggestion string (`apt install scrot` or equivalent).
- [ ] **AC-S4:** Screenshot path outside `userData` is rejected (unit test on `getScreenshotCommand` guard).

### Overlay and window

- [ ] **AC-O1:** Overlay opens via IPC `show-overlay`; window is visible and `alwaysOnTop` on X11 composited session (manual or Playwright screenshot diff).
- [ ] **AC-O2:** Non-composited X11 session shows transparency warning once per session (manual QA log).

### Shortcuts

- [ ] **AC-K1:** Settings and empty-state hints show `Ctrl` modifier on Linux, not `⌘`.
- [ ] **AC-K2:** Failed global shortcut registration shows message without "System Settings" or "Accessibility" macOS strings.
- [ ] **AC-K3:** Rebind screenshot shortcut in settings; new accelerator triggers capture (manual QA).

### Packaging

- [ ] **AC-P1:** Linux x64 `.deb` from CI installs, launches, and loads native module (`index.linux-x64-gnu.node` present in unpacked asar).
- [ ] **AC-P2:** Packaged app does not fail with `error while loading shared libraries` for bundled `.so` (verify after F5.1).
- [ ] **AC-P3:** Meeting persistence works; if sqlite-vec Linux unavailable, log states JS fallback and search returns results (existing VectorStore behavior).

### Copy and onboarding

- [ ] **AC-C1:** Help/onboarding contains zero occurrences of `System Settings → Privacy & Security` when `platform === 'linux'`.
- [ ] **AC-C2:** README lists Linux X11 as supported and links to this PRD/ADR; Wayland listed as unsupported.

---

## Implementation phases summary

| Phase | Name | Primary deliverable | Exit criterion |
|-------|------|---------------------|----------------|
| 0 | Foundation | Linux CI, session detection, copy audit | CI green; Wayland gate works |
| 1 | P0 audio | `speaker/linux.rs` loopback | AC-A1–A5 pass |
| 2 | Capture | Screenshot reliability + errors | AC-S1–S4 pass |
| 3 | Shell/overlay | Compositor detection, overlay QA | AC-O1–O2 pass |
| 4 | Shortcuts | Linux shortcut UX | AC-K1–K3 pass |
| 5 | Packaging | asarUnpack, sqlite-vec, release build | AC-P1–P3 pass |
| 6 | Polish | README, QA matrix, release | All acceptance criteria checked |

---

## Open questions

1. **Minimum audio backend:** PulseAudio-only v1 vs PipeWire-native API — needs spike on Fedora 40+ and Ubuntu 24.04 default stacks.
2. **Screenshot default:** Keep shell-first or invest in `desktopCapturer` on Linux Electron — needs spike on target Electron version.
3. **sqlite-vec v1:** Ship with JS fallback only on Linux, or block release until Linux vec0 extension loads?
4. **Auto-update:** Enable `electron-updater` for Linux `.deb` in v1 or manual download only?
5. **Legal/distribution:** Third-party license for bundling `scrot` or ImageMagick binaries in the `.deb` package.

---

## References

- `native-module/src/speaker/mod.rs` — current Linux stub
- `electron/ScreenshotHelper.ts` — Linux shell screenshot path
- `electron/WindowHelper.ts` — overlay window construction
- `package.json` — electron-builder Linux targets, asarUnpack
- `scripts/ensure-sqlite-vec.js` — darwin-only vec packages
- `.github/workflows/build-smoke.yml` — macOS-only CI
- `CROSS_PLATFORM_AUDIT.md` — platform copy contamination findings
