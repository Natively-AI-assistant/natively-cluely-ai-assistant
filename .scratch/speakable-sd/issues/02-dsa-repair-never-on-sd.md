# 02 — DSA repair never on SD

**What to build:** System-design answers never receive coding/DSA repair injection (no Code/Dry Run/Complexity placeholders or repair markers). Coding and DSA answer types still get repair as today.

**Blocked by:** None — can start immediately.

**Surfaces:** llm (AnswerValidator / repair gate)

**FE can start?:** n/a

**Status:** done

- [x] Repair path runs only when the answer type is coding/DSA
- [x] `system_design_answer` (and other non-coding types) never emit DSA repair markers
- [x] Existing coding repair tests remain green
