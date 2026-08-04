# 01 — Two-device stealth session via phone command

**What to build:** From a phone Mirror WebSocket command, the user can **enter** two-device stealth (desktop overlay hides / undetectable engages; mic, LLM, Phone Mirror, and stealth globals keep running), **exit** (overlay restores), and **end** (session teardown via existing end path). Phone receives acks. No new native app; no LAN required for this ticket.

**Blocked by:** None — can start immediately.

**Surfaces:** electron (PhoneMirrorService commands, AppState/WindowHelper compose, IPC phone-command router)

**FE can start?:** yes — after command shape + ack contract land (phone HTML can stub buttons against the protocol).

**Status:** done

**Parent:** [PRD — Two-device stealth](../PRD.md)

- [x] Phone can send enter / exit / end two-device stealth commands over the existing Phone Mirror WS
- [x] Enter hides/collapses overlay and engages undetectable without stopping Phone Mirror or unregistering stealth globals
- [x] Exit restores overlay / undetectable per enter-captured state (or documented defaults)
- [x] End exits stealth if active and uses existing session end/teardown path
- [x] Phone receives ack (and failure ack) StreamEvents for these actions
- [x] Automated test at the phone-command seam pins enter/exit(/end) behavior
