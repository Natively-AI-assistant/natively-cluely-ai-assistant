# ADR 0001: Target Linux X11 Only (Exclude Wayland)

**Status:** Accepted  
**Date:** 2026-05-26  
**Deciders:** Engineering (CCDD Linux port session)  
**Related PRD:** [linux-x11-port-PRD](../plans/linux-x11-port-PRD.md)

---

## Context

Natively is an Electron desktop application with deep OS integration: system-audio loopback, global shortcuts, transparent always-on-top overlay, and screenshot capture. macOS and Windows implementations rely on mature, platform-specific APIs (CoreAudio tap, WASAPI loopback, NSPanel, CGEventTap, `desktopCapturer`).

Linux support today is incomplete scaffolding:

- **System audio** is a Rust stub that always errors (`native-module/src/speaker/mod.rs`).
- **Screenshots** use external shell tools rather than `desktopCapturer` on the Linux code path.
- **Overlay** uses a generic transparent Electron window without macOS NSPanel semantics.
- **Packaging/CI** are macOS-centric (`asarUnpack` lacks `*.so`, sqlite-vec helper is darwin-only, CI runs on `macos-latest` only).

Linux desktop environments are split between **X11** and **Wayland**. Wayland restricts legacy capabilities (global input grabs, arbitrary screen capture, legacy `_NET_WM` behaviors) in favor of security-oriented protocols (`xdg-desktop-portal`, `zwp_keyboard_shortcuts_inhibit_v1`, etc.). Electron's support matrix and behavior differ between X11 and Wayland sessions.

The team needs a bounded first Linux release that can ship in finite time without re-implementing every feature through portal-based Wayland APIs.

---

## Decision

**We will target Linux sessions running X11 only for the initial Linux port (v1). Native Wayland sessions are out of scope.**

Concretely:

1. **Supported:** Users running an X11 session (`DISPLAY` set, typically `XDG_SESSION_TYPE=x11`), including applications running as XWayland clients under a Wayland compositor *only when* Electron operates as an X11 client with functional X11 APIs.
2. **Unsupported:** Users on a native Wayland session where Electron/Chromium runs as a Wayland client without reliable X11 fallbacks for required features (global shortcuts, capture, overlay).
3. **Product behavior:** Detect unsupported session at startup; show explicit messaging referencing this ADR and the PRD; do not silently degrade critical paths.
4. **Engineering investment:** Implement Linux-specific audio (PulseAudio/PipeWire loopback), screenshot shell path hardening, overlay on composited X11, packaging, and CI — not a parallel Wayland portal implementation in v1.

---

## Consequences

### Positive

- **Reduced scope:** Avoids xdg-desktop-portal screencast, Wayland-specific shortcut inhibition, and multi-compositor QA matrix in v1.
- **Reuse of Electron patterns:** `globalShortcut`, transparent `BrowserWindow`, and existing Linux screenshot shell path align with X11-era assumptions.
- **Faster time-to-ship:** Team focuses on one display-server contract (X11 + compositor) and one audio loopback stack (Pulse/PipeWire via established monitor APIs).
- **Clear user expectations:** Documentation states X11 requirement; support burden is bounded.

### Negative

- **Growing Wayland adoption:** Default sessions on Fedora, Ubuntu, and GNOME increasingly prefer Wayland; X11-only excludes a rising share of users until a follow-up initiative.
- **XWayland ambiguity:** Some users may expect support while on Wayland; detection and messaging must be careful to avoid false positives/negatives.
- **Technical debt:** A future Wayland port requires separate ADR(s) and likely portal-based capture/shortcut design.
- **Distributor friction:** Some distros de-emphasize X11 packages; users may need to install an X11 session or switch session type at login.

---

## Alternatives considered

### Alternative A — Full native Wayland support

Implement capture, shortcuts, and overlay using Wayland protocols and `xdg-desktop-portal` (screencast, remote desktop, file chooser, etc.).

**Rejected for v1:** High engineering cost; Electron abstraction gaps; broad compositor-specific behavior (GNOME, KDE, wlroots); duplicates work before P0 system-audio is solved on any Linux stack.

### Alternative B — XWayland-only (run app exclusively under XWayland on Wayland)

Force `GDK_BACKEND=x11` / Electron flags so the app always runs as an XWayland client.

**Rejected as primary strategy:** Does not guarantee global shortcuts, capture, or overlay behavior across compositors; still requires XWayland and user confusion when features fail on pure Wayland. May be documented as best-effort for advanced users, not a support commitment.

### Alternative C — Dual X11 + Wayland support in v1

Ship both code paths with feature flags.

**Rejected for v1:** Doubles QA matrix and implementation surface; team size and current macOS/Windows parity work do not justify parallel tracks.

### Alternative D — Defer Linux entirely

**Rejected:** Community demand, existing partial scaffolding, and open-source positioning warrant a bounded Linux release with explicit limits.

---

## Technical implications

### Session detection

- Read `XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`, and `DISPLAY` at startup.
- If native Wayland without usable X11 for Electron, block or degrade with user-visible explanation (see PRD F0.1, AC-G2).
- Log session type in diagnostics/install ping for support.

### Audio (PulseAudio / PipeWire)

- System-audio loopback will use **PulseAudio-compatible APIs** (monitor sources of sinks).
- On PipeWire-default distros, target **`pipewire-pulse`** compatibility layer rather than a separate PipeWire-native v1 implementation unless spike proves necessary.
- CPAL microphone path remains cross-platform; validate Linux input device enumeration separately from loopback.
- Implication: user must have a running PulseAudio or PipeWire-pulse stack; JACK-only systems need manual Pulse bridge — document in PRD support matrix.

### Overlay and compositor

- Transparent frameless overlay requires an **X11 compositor** (Mutter/Xorg, KWin, Xfce compositor, picom, etc.).
- Without compositor, window may render incorrectly; PRD requires one-time warning (AC-O2).
- No NSPanel non-activating behavior; overlay may activate app — accepted parity gap.

### Screenshots

- v1 retains shell-tool path (`gnome-screenshot`, `scrot`, `import`) for Linux in `ScreenshotHelper.ts`.
- Wayland-native screencast via portal is **not** implemented; X11 full-screen capture does not depend on portal.
- Optional follow-up: evaluate `desktopCapturer` on X11 Electron before investing in portal screencast.

### Global shortcuts

- Electron `globalShortcut` on X11 uses traditional grabs; behavior varies by WM (document i3/sway limitations under X11).
- macOS CGEventTap stealth path remains macOS-only (`native-module/src/keyboard_tap.rs`, `StealthKeyboardManager.ts`).

### Packaging and CI

- Linux CI and release artifacts (`.deb`) validated on **ubuntu-latest** with X11 or xvfb-based smoke where headless.
- `asarUnpack` must include `*.so` for native modules.
- sqlite-vec: add Linux packages or accept JS fallback per PRD open question.

---

## Compliance and review

- This ADR should be reviewed when:
  - Electron declares breaking changes for X11 on Linux.
  - Wayland session share among target users exceeds an agreed threshold (e.g. 50% of Linux download telemetry).
  - A sponsor or distro mandates Wayland-only.

- Supersedes: none (first Linux platform ADR).

---

## References

- PRD: [docs/plans/linux-x11-port-PRD.md](../plans/linux-x11-port-PRD.md)
- CCDD artifacts: `tmp/collective-collaborative-deep-dive/2026-05-26_linux-x11-port/`
- Code: `native-module/src/speaker/mod.rs`, `electron/ScreenshotHelper.ts`, `electron/WindowHelper.ts`
