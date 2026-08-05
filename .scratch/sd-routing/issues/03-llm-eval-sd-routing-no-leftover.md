# 03 — llm-eval sd-routing suite (no leftover)

**What to build:** Eval suite covering **every** `sd-route-*` decision (positives, title-form, false friends, scale-ask, sticky, fuzzy). Regression gate for deterministic expectations; live/capability where needed. **No ungated leftover** path. Runner exits NO-SHIP if regression fails.

**Blocked by:** 01 — Deterministic SD routing matrix; 02 — Sticky SD session promotes answerType

**Surfaces:** evals / llm

**FE can start?:** no

**Status:** done

- [x] Cases exist for each grilled `sd-route-*` term (including sticky + false friends)
- [x] Regression gate SHIP on green matrix; NO-SHIP when a positive is broken
- [x] Fuzzy/ASR paraphrases present (capability or regression with documented trials)
- [x] npm script documented; no production leftover without a case
