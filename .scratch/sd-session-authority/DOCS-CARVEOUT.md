# Docs carve-out — SdSessionAuthority vs SPEC 03 / SPEC 09

**Status:** authoritative for implementers until SPECs are amended in-tree  
**Parent:** [PRD — SdSessionAuthority](./PRD.md) · ticket [05-leave-ti-freeze-docs](./issues/05-leave-ti-freeze-docs.md)  
**Note:** `sd-requirements-grilling` SPECs 03 / 09 may lag; **this PRD + note win** if wording conflicts.

## SPEC 03 — “Non-SD inert” carve-out

**Prior SPEC 03 wording:** phase derivation, prompt gating, and structural hard-block apply only to `system_design_answer`; other answer types ignore this machinery.

**Amended intent (SdSessionAuthority):**

- Non–`system_design_answer` turns stay **gate-inert unless** `SdSessionAuthority` says the session is open **and** mode is Technical Interview (`shouldArmGate`).
- When `shouldArmGate` is true, clarifier / `general_meeting_answer` turns still run Requirements prepare, stamp `sdPhase`, and (downstream tickets) structural / strip consumers arm from authority + stamped phase.
- LESSON allowlist and deep-dive pack/merge remain **`system_design_answer`-typed** (unchanged).
- Representation D, reset B, enforcement C, and gate-close rules are unchanged.

Short form: **inert unless session open (and TI)** — not “always inert on non-SD answerType.”

## SPEC 09 — Freeze on leave Technical Interview

**Prior SPEC 09:** ModesManager must not own the artifact; meeting end clears live working copy; new-SD-problem reset refreshes identity/gate. Mode switch was already “do not clear” in SessionTracker, but leave-TI freeze was not named as an authority/lifecycle rule.

**Amended intent:**

- **Leave TI (mode switch away from Technical Interview):** authority is **inert immediately** (`shouldArmGate === false`). The live Requirements **working copy is frozen** — retained on SessionTracker, **not** cleared — so re-entering TI in the **same meeting** resumes the sticky `problemKey` / open session.
- **Meeting end:** still clears the live working copy per existing durable-storage rules (DB checkpoint may remain as history only).
- **New SD problem:** still resets / replaces sticky identity and re-opens the gate (phase-state reset B).

## Code seams

- Derive: `electron/llm/sdSessionAuthority.ts` → `{ sessionOpen, shouldArmGate, sdPhase, problemKey }`
- Freeze: `SessionTracker.clearSessionContext()` must not call `clearSdRequirementsLive()`
- Clear live: `clearMeetingMetadata` / `clearSdRequirementsLive` / session `reset`
- Tier 0: `electron/llm/__tests__/SdSessionAuthorityLeaveTiFreezeTier0.test.mjs`
