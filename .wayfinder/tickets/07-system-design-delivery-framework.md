# Encode the hellointerview Delivery Framework into the system-design prompt

**Labels:** `wayfinder:task`
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)
**Blocked by:** 01, 03

## Question

The `<system_design>` block in `MODE_TECHNICAL_INTERVIEW_PROMPT` (`electron/llm/prompts.ts` ~line 2026) currently uses a generic 5-step skeleton (`Constraints → Architecture → Components → Tradeoffs → Scale`). Rewrite it to follow hellointerview's exact Delivery Framework so every system-design turn delivers in that structure deterministically.

## Scope

- Replace the `<system_design>` block AND the `SYSTEM DESIGN` line in `<output_contract>` (~line 2072) with the canonical hellointerview Delivery Framework:
  1. **Requirements** — functional (core features) + non-functional (scale/QPS, latency, consistency vs availability, durability)
  2. **Core Entities** — the main data objects the system operates on
  3. **API / Interface** — endpoint or method signatures satisfying the functional requirements
  4. *(optional)* **Data Flow** — only for data-processing-heavy systems (e.g. pipelines, analytics)
  5. **High-Level Design** — component architecture that satisfies the API
  6. **Deep Dives** — drill into bottlenecks, failure modes, and each non-functional requirement
- Keep it a spoken-voice skeleton consistent with the surrounding `<mode_definition>` (candidate's first person, glance-and-go)
- Do NOT branch for ML / infra variants — one canonical framework (per decision A). Variant nuance comes from retrieved lesson content (ticket 08).
- Prompt-only change; no new IPC, no storage. Deterministic delivery is the whole point.
- Verify: trigger a system-design question in technical-interview mode, confirm the answer walks the six steps in order.

## Dependency note

Blocked by 01 (gate bypass) + 03 (modes UI) only so that technical-interview mode is actually reachable in a non-licensed build to test the change. The prompt edit itself has no code dependency.

## Answer

Rewrote the `<system_design>` block and the `SYSTEM DESIGN:` line in `<output_contract>` in `electron/llm/prompts.ts` (`MODE_TECHNICAL_INTERVIEW_PROMPT`) to encode hellointerview's canonical Delivery Framework, in order.

### `<system_design>` — before

```
Clarify constraints first → high-level architecture → key components → tradeoffs → how it scales.

Start by asking (or stating assumed) constraints:
- Expected scale (QPS, users, data volume)
- Read-heavy vs write-heavy
- Consistency vs availability tradeoff

Then: diagram the components → drill into the hard parts → call out failure modes.
```

### `<system_design>` — after

```
Walk the hellointerview Delivery Framework in this exact order, thinking out loud the whole way:
Requirements → Core Entities → API / Interface → (optional) Data Flow → High-Level Design → Deep Dives.

1. Requirements — pin down functional first ("the core things it has to do are…"), then non-functional: scale/QPS, latency targets, consistency vs availability, durability, read/write ratio. State assumptions out loud if the interviewer didn't give numbers.
2. Core Entities — name the main data objects the system revolves around (the nouns everything hangs off).
3. API / Interface — the endpoints or method signatures that satisfy each functional requirement.
4. Data Flow (ONLY for data-processing-heavy systems — pipelines, analytics, streaming) — trace how data moves stage to stage. Skip this entirely for standard CRUD / product designs.
5. High-Level Design — the component architecture that satisfies the API; the primary boxes and arrows.
6. Deep Dives — drill into bottlenecks, failure modes, and each non-functional requirement in turn.
```

### `<output_contract>` `SYSTEM DESIGN:` line

- before: `- SYSTEM DESIGN: Constraints → Architecture → Components → Tradeoffs → Scale.`
- after: `- SYSTEM DESIGN: Requirements → Core Entities → API / Interface → (optional) Data Flow → High-Level Design → Deep Dives.`

The two blocks now agree on the same six-step order.

### Scope / decisions

- One canonical framework only — no ML / infra branches (variant nuance deferred to ticket 08 / retrieved content, per decision A).
- No new markdown headings: kept the block header-free (matching the surrounding prompt's rule that non-coding spoken answers avoid headers), expressed as the spoken delivery order + a numbered walk-through, first-person / glance-and-go consistent with `<mode_definition>` and `<formatting>`.
- Prompt-only change. Edited exactly the two targeted blocks in `electron/llm/prompts.ts`; no other prompt, block, or file touched.

### Verify

- `npx tsc -p electron/tsconfig.json --noEmit`: the only reachable tsc is a newer global version that rejects the project's pre-existing tsconfig options (`baseUrl`, `moduleResolution: node10` — TS5102 / TS5108). Those two config errors are unrelated to this change and pre-date it. No errors reported in `prompts.ts`.
- Inspection: edits changed string content only — no backticks or `${}` introduced, so the module's template literal / `.trim()` remains balanced.
