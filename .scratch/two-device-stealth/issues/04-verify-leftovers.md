# 04 — iPhone-first two-device stealth (Safari)

**What to build:** Make two-device stealth **reliably usable on iPhone first**. Primary path: same Wi‑Fi (or Mac↔iPhone USB Personal Hotspot / Internet Sharing network) → Allow LAN → open Mirror in Safari → Enter stealth. There is **no** iOS equivalent of `adb reverse`; do not block on USB-localhost. Android USB remains a later ticket.

**Blocked by:** 01 — Two-device stealth session via phone command; 02 — Phone Mirror web UI for two-device stealth

**Surfaces:** ui (PhoneMirrorSettings, Help), docs; light electron only if LAN/USB-iface discovery copy needs it

**FE can start?:** yes

**Status:** ready-for-agent

**Parent:** [PRD — Two-device stealth](../PRD.md)

- [x] Sync / Help lead with **iPhone** steps (Enable Mirror → Allow LAN → scan QR / open URL in Safari → Enter stealth)
- [x] Android `adb reverse` copy is clearly secondary / “later / advanced,” not the headline path
- [ ] iPhone Safari can connect, stream answers, Enter/Exit stealth, End session
- [x] Optional note for USB cable users: enable Internet Sharing / hotspot so phone can reach Mac LAN IP (not localhost)
- [ ] Stealth globals still registered; extension still optional
- [x] Android USB E2E deferred (see ticket 05)
