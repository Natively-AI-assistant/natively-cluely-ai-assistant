# SPEC 10 — Candidate ASCII HLD diagrams (sim-only)

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md) (amends diagram medium for SUT)  
**Grill:** ASCII replaces mermaid for candidate; interviewer may keep mermaid.

## Decision

- **Candidate (Natively SUT):** When presenting HLD, include ≥1 ASCII architecture diagram in a fenced ` ```text ` / ` ```ascii ` block using portable `+ - | / > v` characters. Lives in `turns[].text` (whiteboard-as-speech). **No** ` ```mermaid ` from the candidate.
- **Interviewer-agent:** Unchanged — optional mermaid attachments still allowed.
- **Schema:** No new attachment `kind` in this slice.
- **Assert:** T0 prompt-contract tests only; T2 does not fail the run if the model skips a diagram.

## Implementation

- Shared `CANDIDATE_ASCII_HLD_INSTRUCTION` wired into `CASUAL_SD_TONE_INSTRUCTION` and `FULL_RAW_SD_TONE_INSTRUCTION` (`scripts/lib/sd-interview-sim/liveSut.js`).
