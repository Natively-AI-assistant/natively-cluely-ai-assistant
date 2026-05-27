# Linux X11 System Audio — Rust/JS Contract

**Status:** v1 contract for Wave 1 `audio-rust` + `audio-js`  
**Related:** [linux-x11-port-PRD](../plans/linux-x11-port-PRD.md), [ADR 0001](../adr/0001-linux-x11-only.md)

---

## Overview

System audio on Linux uses PulseAudio-compatible monitor sources (PipeWire via `pipewire-pulse`). The Rust `native-module` exposes the same NAPI surface as macOS/Windows; JS loads `index.linux-x64-gnu.node` via `nativeModuleLoader.ts`.

---

## NAPI surface (unchanged across platforms)

| Export | Type | Notes |
|--------|------|-------|
| `SystemAudioCapture` | class | Constructor `(deviceId?: string \| null)` |
| `getOutputDevices()` | fn → `{id,name}[]` | Linux: monitor source IDs |
| `getDefaultOutputDeviceId()` | fn → string | Linux: default sink monitor UID |
| `getSampleRate()` | method | Actual capture rate after stream start |
| `start(callback, onSpeechEnded?)` | method | `(err, chunk: Buffer)` per napi tsfn |
| `stop()` | method | Stops capture thread |

---

## Device ID format (Linux)

| Field | Format | Example |
|-------|--------|---------|
| Monitor source name | `{sink_name}.monitor` | `@DEFAULT_SINK@.monitor` or `alsa_output.pci-0000_00_1f.3.analog-stereo.monitor` |
| Default sentinel | `"default"` or empty | Resolved to default sink monitor at stream start |
| `list_output_devices` tuple | `(id, display_name)` | id = monitor source name; name includes `" Monitor"` suffix |

JS passes device IDs from settings IPC unchanged. Empty/`default` → Rust resolves default sink monitor.

---

## Sample rate

- Capture runs at the PulseAudio stream sample spec (typically **48000 Hz** stereo → downmixed/mono f32 in ring buffer).
- `SpeakerStream::sample_rate()` returns the negotiated rate after successful `stream()` init.
- JS `SystemAudioCapture.getSampleRate()` polls native after lazy init.

---

## Error codes (Rust → JS)

NAPI surfaces stable codes as `Error.message` (see `native-module/src/speaker/error.rs`). JS maps codes in `mapLinuxSystemAudioError` — never keyword-matches free-form strings.

| Condition | Code |
|-----------|------|
| Pulse not running / connect failed | `PULSE_NOT_AVAILABLE` |
| Context or device list timeout | `INIT_TIMEOUT` |
| Monitor stream connect/read failure | `STREAM_CONNECT_FAILED` |
| Unsupported platform stub | `UNSUPPORTED_PLATFORM` |
| Init/stream consumer missing | `CONSUMER_MISSING` |
| Double `start()` | `CAPTURE_ALREADY_RUNNING` |
| Unclassified native failure | `CAPTURE_THREAD_FAILED` |
| `.node` missing (JS-only) | `NATIVE_MODULE_NOT_LOADED` |

User-facing copy comes from `formatPermissionMessage('linux-audio-server-missing')` or `'system-audio-stuck'` per code.

---

## Mic-only fallback (AC-A5)

When `SpeakerInput::new()` or `stream()` returns Err on Linux:

1. JS emits distinct warning (not macOS Screen Recording copy).
2. Mic transcription continues if microphone path succeeds.
3. No silent fallback — errors propagate to renderer.

---

## Build / load paths

| Layout | Path |
|--------|------|
| Dev | `{appPath}/native-module/index.linux-x64-gnu.node` |
| Packaged | `{resourcesPath}/app.asar.unpacked/native-module/index.linux-x64-gnu.node` |

Bundled `.so` dependencies must appear in `asarUnpack` (`**/*.so`) for dlopen at runtime.

---

## Dependencies (build)

- `libpulse-dev` (Ubuntu/Debian) for `libpulse-binding`
- Runtime: PulseAudio or PipeWire with `pipewire-pulse` compatibility layer

---

## Out of scope (v1)

- PipeWire-native loopback API (Wave 3 spike)
- JACK-only without Pulse bridge
- Wayland portal audio
