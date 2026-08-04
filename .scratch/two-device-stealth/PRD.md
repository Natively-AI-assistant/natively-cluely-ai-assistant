# PRD — Two-device stealth (USB Phone Mirror)

**Status:** `ready-for-agent`  
**Feature slug:** `two-device-stealth`  
**Grill:** `_workspace/grill-with-docs/01_question_log.md` (9/9 verified, Mode C)  
**Glossary (agentmemory):** `two-device-stealth-phased` · `phone-mirror-web-client-v1` · `usb-adb-reverse-path` · `phone-control-surface` · `two-device-stealth-desktop-compose` · `android-first-usb-v1` · `extension-orthogonal` · `two-device-stealth-non-goals` · `two-device-stealth-v1-done`  
**Audience:** `/to-tickets` then `/implement`  
**Prior art (do not re-litigate):** Phone Mirror HTTP/WS + web client · desktop undetectable / hideOverlay · stealth globals must stay · fork license bypass / skip-premium · InterviewMan retention ≠ this product

---

## Problem Statement

During monitored interviews, the user needs Natively’s answers off the shared laptop screen — InterviewMan-style **two-device stealth**: desktop listens and stays invisible; phone shows answers and controls. Today Phone Mirror already streams answers to a phone **browser** over LAN/loopback, but (1) there is no first-class “enter two-device stealth” that hides the desktop overlay while keeping the session alive, (2) USB is not a documented path — users are pushed toward Allow LAN / Wi‑Fi, and (3) there is no native Store app (and v1 should not build one). The fork owner wants Android USB (`adb reverse`) + Phone Mirror web client + desktop hide composition.

## Solution

Ship **two-device stealth** on the existing Phone Mirror stack:

1. **Phone control surface** gains enter / exit two-device stealth and end session (plus existing chat, actions, screenshot shutter).
2. **Desktop compose** on enter: engage undetectable + hide/collapse overlay; keep mic/STT, LLM, Phone Mirror server, and stealth global hotkeys; exit restores overlay per prior settings.
3. **USB path (Android-first):** document and surface `adb reverse` so the phone opens Mirror on `127.0.0.1` **without** `exposeOnLan`. LAN/QR remains optional Wi‑Fi fallback.
4. **Form factor v1:** existing inlined mobile web client (browser or thin WebView later) — not App Store native.
5. **Companion browser extension** stays orthogonal (DOM capture); phone never gets `/dom`.

Success = `two-device-stealth-v1-done`: Android via adb reverse without Allow LAN; hide overlay while answers stream to phone; chat/actions/screenshot work; exit restores; LAN QR still works; stealth globals remain registered.

## User Stories

1. As an interviewee, I want to put answers on my phone so my shared laptop screen stays clean.
2. As an interviewee, I want to enter two-device stealth from the phone so the desktop overlay hides without ending the session.
3. As an interviewee, I want to exit two-device stealth from the phone so the desktop overlay returns when I need it.
4. As an interviewee, I want to end the session from the phone so I can tear down without hunting the laptop UI.
5. As an interviewee, I want live AI answers to stream to the phone while desktop is hidden.
6. As an interviewee, I want phone chat to still reach the same LLM path as desktop.
7. As an interviewee, I want phone quick actions (What to Say, etc.) to match desktop hotkeys.
8. As an interviewee, I want a phone screenshot shutter that captures the desktop for AI without sending the bitmap to the phone.
9. As an Android user, I want to connect over USB with `adb reverse` so I do not enable Allow LAN on Wi‑Fi.
10. As an Android user, I want Sync settings to show the loopback pairing URL and copy-pasteable `adb reverse` instructions.
11. As an iOS user, I want to still use Phone Mirror via optional LAN/QR in v1 so I am not blocked waiting for iOS USB.
12. As a privacy-conscious user, I want the USB stealth path to keep Phone Mirror bound to loopback so the LAN bind confirmation is not required.
13. As a stealth user, I want undetectable / process disguise engaged when entering two-device stealth so screen-share risk stays low.
14. As a stealth user, I want global stealth hotkeys to keep working after enter so I am not locked out if the phone disconnects.
15. As a Phone Mirror user, I want existing LAN QR pairing to keep working as a Wi‑Fi fallback.
16. As a Phone Mirror user, I want the companion browser extension to keep working for DOM capture without being required for two-device stealth.
17. As a Phone Mirror user, I want phone and extension tokens to stay split so a phone token never reaches `/dom`.
18. As a Sync settings user, I want clear labeling that USB path ≠ Allow LAN so I do not confuse the two.
19. As a Help reader, I want two-device stealth steps documented (enable Mirror → adb reverse → open URL → enter stealth from phone).
20. As a fork maintainer, I want no native Store app in v1 so scope stays on Phone Mirror protocol.
21. As a fork maintainer, I want no scrcpy / pixel mirror so we do not ship screen mirroring.
22. As a fork maintainer, I want no cloud/relay pairing so traffic stays local.
23. As a fork maintainer, I want no second WebSocket protocol so phone keeps using Phone Mirror events/commands.
24. As a fork maintainer, I want skip-premium and license bypass untouched.
25. As an implementer, I want tests at the Phone Mirror phone-command seam so desktop compose is pinned without full UI e2e.
26. As a QA engineer, I want a checklist that matches `two-device-stealth-v1-done`.
27. As a product owner, I want InterviewMan ~10min retention explicitly out of scope so this is not confused with win-first memory work.
28. As a product owner, I want Hindsight companion work out of scope so “companion” stays Phone Mirror.
29. As a later-phase owner, I want native Store apps deferred but required to speak the same phone-token WS protocol.
30. As a map owner, I want this PRD `ready-for-agent` so tickets/implement can proceed without re-grilling.

## Implementation Decisions

### Primary seam — Phone Mirror phone commands → desktop compose
- Extend the phone command bus so the phone can request **enter**, **exit**, and **end** for two-device stealth (dedicated command shape preferred over overloading generic `action` → `global-shortcut`, so stealth session control does not collide with shortcut ids).
- **Enter:** engage existing undetectable/hide composition; hide or fully collapse overlay from the shared screen; keep mic/STT, LLM, Phone Mirror server, and stealth global hotkeys registered; record session state so exit can restore.
- **Exit:** restore overlay visibility / undetectable per state captured at enter (or sensible defaults if enter never ran).
- **End:** exit two-device stealth if active and perform the same session teardown the product already uses for ending a meeting/session from desktop (do not invent a second teardown path).
- Publish `ack` StreamEvents to the phone for enter/exit/end (and failures).
- Do not send overlay pixels or screenshot bitmaps to the phone.

### Secondary seam — Phone Mirror web client UI
- Add phone UI controls for enter / exit / end on the existing inlined mobile web client.
- Keep chat, quick actions, and screenshot shutter behavior.
- Status copy should reflect connected + whether two-device stealth is active (via ack / future status event if needed).

### Tertiary seam — USB pairing UX (Android-first)
- When Phone Mirror is enabled, Sync settings always surfaces the **loopback** pairing URL (even when LAN is off).
- Provide copy-pasteable Android `adb reverse tcp:<port> tcp:<port>` instructions and “open this URL on the phone” guidance.
- Do not require `exposeOnLan` for the USB path; leave Allow LAN as optional Wi‑Fi fallback.
- iOS USB reverse is not v1 primary.

### Extension / tokens
- Keep phone token vs extension token split; extension remains loopback `/dom` + `/pair`.
- Two-device stealth must not require the extension.

### Testing seam (highest preferred)
- Prefer existing Phone Mirror service / phone-command integration tests: simulate phone commands and assert desktop compose side-effects via injectable/fake window helper or observed public status — not pixel snapshots.
- Settings USB copy can be covered lightly (string/URL presence) or manual AC if brittle.

## Testing Decisions

- Good tests assert external behavior through the phone-command / Phone Mirror public surface (enter hides overlay + keeps server running; exit restores; end tears down session; adb path does not flip LAN).
- Do not assert private WindowHelper call order beyond what is needed for the AC.
- Prior art: `PhoneMirror*.test.mjs`, `PhoneMirrorKillSwitch.test.mjs`, overlay hide tests under `electron/audio/__tests__/`.
- Prefer `/tdd` at the phone-command compose seam for ticket 01; UI tickets can add thinner client tests or manual AC.

## Out of Scope

- Native iOS/Android Store apps  
- iOS USB reverse as v1 primary  
- scrcpy / pixel mirroring to phone  
- Cloud/relay pairing; TLS redesign; second WS protocol  
- Shipping screenshot bitmaps to the phone  
- Hindsight companion work  
- Reopening premium submodule / paywall  
- Unregistering or mass-remapping stealth globals  
- InterviewMan-style ~10min retention model  
- Product rename / Sync tab rename (leftover OK)

## Further Notes

- Glossary name for the UX is **two-device stealth** — do not overload desktop “stealth typing” / “More Stealth” opacity.
- Prior InterviewMan in this repo meant SD prompt / retention competitor; this PRD means InterviewMan **Stealth Mode** product analogy only.
- Soft checkpoint: no separate EDD required; grill already locked decisions.
- Next: `.scratch/two-device-stealth/issues/` tracer tickets, then `/implement` on the frontier (solo default; ticket 01 first).

## Seams check (to-spec)

| Seam | Role |
|------|------|
| **Phone Mirror phone-command bus** | Primary — enter/exit/end + existing chat/action/screenshot |
| **Phone Mirror web client** | Secondary — buttons + status |
| **Sync settings loopback/USB copy** | Tertiary — adb reverse UX |
| **natively-browser extension** | Orthogonal — unchanged |

Preferred test height: phone-command → desktop compose (one seam).
