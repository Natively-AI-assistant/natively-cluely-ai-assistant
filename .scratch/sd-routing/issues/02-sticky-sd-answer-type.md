# 02 — Sticky SD session promotes answerType

**What to build:** When sticky SD session is armed, non-coding / non-DSA turns classify as `system_design_answer` so speakable DF template + strip apply mid-interview. Explicit coding/DSA pivot still leaves SD.

**Blocked by:** None — can start immediately (coordinate with 01 on AnswerPlanner; prefer land after or with 01 on same branch if contention).

**Surfaces:** llm, IntelligenceEngine / WTA prepare

**FE can start?:** n/a

**Status:** done

- [x] Armed sticky SD + clarifier-like utterance → `system_design_answer`
- [x] Armed sticky + “implement two sum” / write-code → coding/DSA not SD
- [x] Unarmed session unchanged for non-SD utterances
- [x] Tests pass without full Electron UI
