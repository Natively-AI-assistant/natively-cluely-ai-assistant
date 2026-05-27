# Linux X11 Manual QA Matrix

**Scope:** v1 Linux port — **X11 only** ([ADR 0001](../adr/0001-linux-x11-only.md)). Native Wayland sessions are unsupported.

**Reference distros:** Ubuntu 22.04/24.04 (Xorg/X11 session), Fedora 40+ (X11 session)

---

## Pre-flight

| Check | Command / action | Pass |
|-------|------------------|------|
| X11 session | `echo $XDG_SESSION_TYPE` → `x11`, `echo $DISPLAY` set | ☐ |
| Compositor | Overlay transparency visible (not solid black) | ☐ |
| Pulse/PipeWire | `pactl info` or `systemctl --user status pipewire-pulse` | ☐ |
| Screenshot tool | `which scrot` or `gnome-screenshot` or `import` | ☐ |
| Native module | `native-module/index.linux-x64-gnu.node` exists after build | ☐ |

---

## Platform gate (AC-G1, AC-G2)

| ID | Step | Pass |
|----|------|------|
| AC-G1 | Launch on Ubuntu X11 — main window loads | ☐ |
| AC-G2 | Launch on Wayland-only session — unsupported message (Wave 2 wiring) | ☐ |

---

## System audio (AC-A1–A5)

| ID | Step | Pass |
|----|------|------|
| AC-A1 | Start meeting — no `Unsupported platform: system audio capture` | ☐ |
| AC-A2 | YouTube on default output — system audio chunks within 8s | ☐ |
| AC-A3 | Settings/device list shows ≥1 monitor device | ☐ |
| AC-A4 | Stop pulse — graceful error with install hint | ☐ |
| AC-A5 | System audio fail — mic-only warning, mic STT continues | ☐ |

---

## Screenshots (AC-S1–S4)

| ID | Step | Pass |
|----|------|------|
| AC-S1 | Full screenshot hotkey → PNG in userData | ☐ |
| AC-S2 | Selective Esc/cancel → `{ cancelled: true }` | ☐ |
| AC-S3 | No tools installed → install hint in error | ☐ |
| AC-S4 | Path guard unit test green | ☐ |

---

## Overlay (AC-O1–O2)

| ID | Step | Pass |
|----|------|------|
| AC-O1 | Overlay visible, alwaysOnTop on composited X11 | ☐ |
| AC-O2 | Non-composited X — one-time transparency warning | ☐ |

---

## Shortcuts (AC-K1–K3)

| ID | Step | Pass |
|----|------|------|
| AC-K1 | UI shows `Ctrl` not `⌘` on Linux | ☐ |
| AC-K2 | Failed registration — no macOS Accessibility copy | ☐ |
| AC-K3 | Rebind screenshot — new accelerator works | ☐ |

---

## Packaging (AC-P1–P3)

| ID | Step | Pass |
|----|------|------|
| AC-P1 | `.deb` installs and launches; loads `.node` from asar.unpacked | ☐ |
| AC-P2 | No missing `.so` at runtime (`ldd` smoke) | ☐ |
| AC-P3 | Meeting persistence; sqlite-vec JS fallback logged if native missing | ☐ |

---

## Copy (AC-C1–C2)

| ID | Step | Pass |
|----|------|------|
| AC-C1 | No `System Settings → Privacy & Security` on Linux onboarding | ☐ |
| AC-C2 | README states X11 supported, Wayland unsupported | ☐ |
