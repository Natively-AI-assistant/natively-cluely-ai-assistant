# 05 — Leave-TI freeze + docs carve-out note

**What to build:** Leaving Technical Interview makes SdSessionAuthority inert immediately while freezing the meeting’s Requirements working copy (not clearing it), so re-entering TI can resume the sticky problem. Meeting-end clear and new-SD-problem reset stay as today. Record the SPEC 03 “non-SD inert” carve-out and the freeze-on-leave-TI note so docs match behavior.

**Blocked by:** 01 — Authority derive + prepare arming on GM

**Status:** done

**Parent:** [PRD — SdSessionAuthority](../PRD.md)

- [x] Leave TI → `shouldArmGate` false immediately (no prepare/WTA gate arming)
- [x] Leave TI → live Requirements artifact retained (frozen), not cleared
- [x] Re-enter TI with same meeting → sticky `problemKey` / session open resumes
- [x] Meeting end still clears live working copy per existing durable-storage rules
- [x] New-SD-problem reset still replaces identity and re-opens the gate
- [x] Short docs note amending SPEC 03 non-SD inert (“unless session open”) and SPEC 09 freeze-on-leave-TI; behavior in PRD remains authoritative if specs lag
- [x] Tier 0 or focused test for inert-on-leave-TI + artifact retained
