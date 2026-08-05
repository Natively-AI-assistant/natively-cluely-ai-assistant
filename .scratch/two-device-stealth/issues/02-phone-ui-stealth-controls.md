# 02 — Phone Mirror web UI for two-device stealth

**What to build:** The Phone Mirror mobile web client exposes clear **Enter stealth**, **Exit stealth**, and **End session** controls that send the ticket-01 commands, show ack/error feedback, and still keep chat / quick actions / screenshot shutter.

**Blocked by:** 01 — Two-device stealth session via phone command

**Surfaces:** ui (phoneMirrorClient), electron (protocol already from 01)

**FE can start?:** yes — after 01 command/ack contract (can develop against mocks until desktop lands).

**Status:** done

**Parent:** [PRD — Two-device stealth](../PRD.md)

- [x] Enter / Exit / End controls visible on the phone Mirror UI when connected
- [x] Controls send the ticket-01 command shapes (not generic unrelated shortcuts)
- [x] UI reflects success/failure from ack events
- [x] Existing chat, quick actions, and screenshot shutter still work
- [x] No screenshot bitmap rendered on the phone
