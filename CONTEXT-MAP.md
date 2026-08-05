# Context Map

## Contexts

- [Commercial surface strip](./CONTEXT.md) — fork monetization chrome removal; Pro unlock / BYOK kept
- [Speakable system design](./docs/speakable-sd/CONTEXT.md) — SD interview answers as read-aloud Delivery Framework talk (no DSA code dumps); includes **SD route** terms for `system_design_answer` classification

## Relationships

- **Speakable SD ↔ Technical Interview mode** — Speakable contract applies whenever WTA `answerType` is `system_design_answer` (product TI + T2 SUT). Coding/DSA contract stays on coding answer types only. **SD route** decisions define when that answerType fires.
- **Speakable SD ↔ Dual-agent sim** — T2 FULL_RAW/casual tone strings and interviewer prompts must match the speakable glossary; candidate-led showcase remains sim-only (SPEC 09).
- **SD route sticky ↔ SdSessionAuthority** — Armed sticky SD session promotes non-coding clarifiers to `system_design_answer` (ADR 0005); sticky exclusions block nego/identity/meeting-admin; problemKey alone is insufficient. Parallel SD-intention promote covers regex misses.
- **Commercial strip** — orthogonal; no shared terms with speakable SD.
