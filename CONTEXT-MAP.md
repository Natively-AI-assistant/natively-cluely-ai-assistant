# Context Map

## Contexts

- [Commercial surface strip](./CONTEXT.md) — fork monetization chrome removal; Pro unlock / BYOK kept
- [Speakable system design](./docs/speakable-sd/CONTEXT.md) — SD interview answers as read-aloud Delivery Framework talk (no DSA code dumps); includes **SD route** terms for `system_design_answer` classification
- [Natively iOS Stealth Mode client](./docs/standalone-ios/CONTEXT.md) — InterviewMan-like phone client paired with desktop via Phone Mirror (not standalone listen→LLM)
- [InterviewMan listen parity](./docs/interviewman-listen/CONTEXT.md) — desktop always-on live STT, red-square transport, triangle end-meeting, Settings live-STT sandbox; phone STT source + control via Phone Mirror (see `.scratch/interviewman-listen/`)

## Relationships

- **Speakable SD ↔ Technical Interview mode** — Speakable contract applies whenever WTA `answerType` is `system_design_answer` (product TI + T2 SUT). Coding/DSA contract stays on coding answer types only. **SD route** decisions define when that answerType fires.
- **Speakable SD ↔ Dual-agent sim** — T2 FULL_RAW/casual tone strings and interviewer prompts must match the speakable glossary; candidate-led showcase remains sim-only (SPEC 09).
- **SD route sticky ↔ SdSessionAuthority** — Armed sticky SD session promotes non-coding clarifiers to `system_design_answer` (ADR 0005); sticky exclusions block nego/identity/meeting-admin; problemKey alone is insufficient. Parallel SD-intention promote covers regex misses.
- **Commercial strip** — orthogonal; no shared terms with speakable SD.
- **iOS Stealth Mode client ↔ desktop / Phone Mirror** — same **phone-mirror-protocol**; desktop is **desktop-session-host**. Native app is the Store-client phase deferred by `.scratch/two-device-stealth/`.
- **iOS Stealth Mode client ↔ Speakable SD / LESSON corpus** — no on-phone corpus fetch; grounding stays on desktop before answers stream to the phone.
- **iOS Stealth Mode client ↔ Commercial strip** — companion monetization unresolved (ticket 11); desktop BYOK/license-bypass unchanged.
- **InterviewMan listen ↔ iOS Stealth Mode client** — phone may be a **phone-stt-source** and **phone-control-surface** on Phone Mirror (ADR 0015); desktop remains LLM/planner host (ADR 0011 amended, not replaced). Desktop owns **listen-transport-arming** projection and answer generation.
- **InterviewMan listen ↔ Speakable SD** — orthogonal; “session” in sticky SD ≠ meeting listen transport.
- **InterviewMan listen ↔ Commercial strip** — orthogonal.
