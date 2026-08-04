# 03 — Android USB adb-reverse pairing UX

**What to build:** Sync / Phone Mirror settings teach the **usb-adb-reverse-path**: when Mirror is enabled, always show the loopback pairing URL and copy-pasteable `adb reverse` instructions so an Android phone can open Mirror on `127.0.0.1` without Allow LAN. LAN/QR remains optional fallback.

**Blocked by:** None — can start immediately (parallel with 01).

**Surfaces:** ui (PhoneMirrorSettings, Help), electron (PhoneMirrorInfo already has loopbackUrl)

**FE can start?:** yes — no protocol change required.

**Status:** done

**Parent:** [PRD — Two-device stealth](../PRD.md)

- [x] With Mirror enabled and LAN off, Sync shows loopback URL usable after `adb reverse`
- [x] Copy-pasteable `adb reverse tcp:<port> tcp:<port>` (port from live Mirror info)
- [x] Copy clarifies USB path does not require Allow LAN
- [x] Allow LAN / QR Wi‑Fi path still available and unchanged in behavior
- [x] Help section documents Android-first USB steps for two-device stealth
