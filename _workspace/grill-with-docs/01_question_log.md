# Question Log — Mobile companion / InterviewMan-like USB stealth

Topic: Build a mobile companion so Natively can be used in InterviewMan-style stealth mode via USB (desktop listens/hides; phone shows answers + controls).  
Mode: **C** (auto-advance; switched from A on “C, auto mode the rest”)  
Budget: **20**  
Research: `00_context.md`, `00_code_patterns.md`, `00_memory.md`

## Prior context (locked, not re-litigated)

- Phone Mirror already exists: desktop HTTP/WS (`:4123`) + mobile **web** client (`phoneMirrorClient.ts`) + QR/LAN pairing; default loopback, optional LAN
- No native iOS/Android app, no ADB/USB tether path in product code
- "Stealth" in-repo = desktop undetectable / opacity / passthrough / stealth-typing — **not** the InterviewMan "phone shows UI" sense
- Prior "InterviewMan" memory = retention competitor (~10min context), **not** mobile stealth product
- Fork: license bypass, skip-premium, Natively identity kept; commercial strip is separate

## Branch Tree

- [x] 1. Product intent — InterviewMan Stealth Mode parity vs extend Phone Mirror
- [x] 2. Form factor — native Store app vs web/PWA on existing Phone Mirror protocol
- [x] 3. Transport — USB-first topology (tether / adb reverse / USB networking) vs LAN / both
- [x] 4. Control surface — what the phone owns (answers, chat, actions, screenshot, hide/end)
- [x] 5. Desktop composition — hide/undetectable overlay when phone session active?
- [x] 6. Platforms — iOS, Android, or one first
- [x] 7. Companion extension relationship — keep, require, or orthogonal
- [x] 8. Non-goals / leftovers
- [x] 9. Success criteria for v1

## Summary

- Branches: **9** · Verified: **9** · Unresolved: **0**
- Soft hint: not primarily LLM-prompt work → **`/tdd`** for protocol/UI/IPC; optional later `/llm-eval` only if phone answer quality becomes a seam
- Next on main flow: **`/to-spec`** (multi-surface: PhoneMirrorService + phone client + desktop compose + docs), then optional **`/to-tickets`**, or **`/implement`**. Say **export** to write CONTEXT.md / ADR.

## Questions

### Q1 — Product intent
**Answer:** **two-device-stealth-phased (C):** v1 = InterviewMan-like UX via extending Phone Mirror + USB path + desktop-hide composition; native Store apps later on same protocol. Name UX **two-device stealth**.  
**Verdict:** VERIFIED  
**Branch:** 1 ✓

### Q2 — Form factor
**Answer:** **phone-mirror-web-client-v1:** existing `PHONE_MIRROR_HTML` via mobile browser / optional thin WebView; not App Store native in v1.  
**Verdict:** VERIFIED  
**Branch:** 2 ✓

### Q3 — Transport
**Answer (retry 1 after VAGUE):** **usb-adb-reverse-path:** Android `adb reverse` → phone `127.0.0.1:<port>` while desktop stays loopback; no `exposeOnLan`. LAN/QR optional Wi‑Fi fallback. Tether/RNDIS and iOS USB not v1 primary.  
**Verdict:** VERIFIED  
**Branch:** 3 ✓

### Q4 — Control surface
**Answer:** **phone-control-surface:** full remote control (stream, chat, actions, screenshot ack, enter/exit two-device stealth, end session); no pixel mirror; bitmaps stay on PC.  
**Verdict:** VERIFIED  
**Branch:** 4 ✓

### Q5 — Desktop composition
**Answer:** **two-device-stealth-desktop-compose:** engage undetectable + hide/collapse overlay; keep mic/LLM/Phone Mirror/stealth globals; phone is primary UI; exit restores.  
**Verdict:** VERIFIED  
**Branch:** 5 ✓

### Q6 — Platforms
**Answer:** **android-first-usb-v1:** web client any browser; documented USB path Android-first via adb reverse; iOS via LAN/QR in v1.  
**Verdict:** VERIFIED  
**Branch:** 6 ✓

### Q7 — Extension relationship
**Answer:** **extension-orthogonal:** keep Page Context extension + token split; not required for phone two-device stealth; phone never gets `/dom`.  
**Verdict:** VERIFIED  
**Branch:** 7 ✓

### Q8 — Non-goals
**Answer:** **two-device-stealth-non-goals:** no native apps, iOS USB, scrcpy, cloud relay, second protocol, screenshot bitmaps to phone, Hindsight, premium reopen, breaking stealth globals, InterviewMan retention model. Leftovers OK: LAN QR, “watch” help copy, Sync rename.  
**Verdict:** VERIFIED  
**Branch:** 8 ✓

### Q9 — Success criteria
**Answer:** **two-device-stealth-v1-done:** adb reverse without LAN; hide overlay while answers on phone; chat/actions/screenshot work; exit restores; LAN QR still works; stealth globals stay.  
**Verdict:** VERIFIED  
**Branch:** 9 ✓
