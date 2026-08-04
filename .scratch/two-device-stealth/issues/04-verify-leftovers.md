# 04 — Two-device stealth verify + leftovers

**What to build:** Walk the `two-device-stealth-v1-done` checklist end-to-end on Android USB (or documented simulator of adb reverse + phone browser), fix leftover copy contradictions (“watch only”, i18n LAN-only strings), and confirm stealth globals + extension orthogonality still hold.

**Blocked by:** 01 — Two-device stealth session via phone command; 02 — Phone Mirror web UI for two-device stealth; 03 — Android USB adb-reverse pairing UX

**Surfaces:** electron, ui, docs/help

**FE can start?:** n/a — integration/verify ticket

**Status:** ready-for-agent — manual Android device walkthrough remaining; automated contracts cover 01–03

**Parent:** [PRD — Two-device stealth](../PRD.md)

- [ ] Android (or equivalent) opens Mirror via adb reverse without Allow LAN
- [ ] Enter stealth hides desktop overlay while answers still stream to phone
- [ ] Chat, quick actions, screenshot shutter work during stealth
- [ ] Exit restores desktop UI; End tears down cleanly
- [ ] Optional LAN QR still works
- [ ] Stealth global hotkeys still registered after enter
- [ ] Extension still pairs/captures without being required for phone stealth
- [x] Blatant “viewer-only” / LAN-only copy fixed where it contradicts phone-control-surface (Help + Sync USB panel)
