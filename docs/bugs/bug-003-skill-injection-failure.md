# Bug 003 — Skill Injection Ignored in V3 Engine (v2.8.5+)

## User Report (Telegram)

> *"Did anyone try skill injection in 2.8.5? Does it work? For me it just goes like plain prompt like instead of the skill"*

---

## Root Cause

### V3 system prompt silently discards the active skill block

**File:** [`electron/llm/WhatToAnswerLLM.ts`](../../electron/llm/WhatToAnswerLLM.ts) — line 813

```typescript
// CURRENT (broken):
const _wtaSystemPrompt = _v3p?.system ?? finalPromptOverride;
```

**Execution path:**

1. A skill is selected → its `promptBlock` is appended to `finalPromptOverride` earlier in the flow.
2. The V3 Context Intelligence engine runs and sets `_v3p` (a structured prompt object that includes `_v3p.system`).
3. The line above prefers `_v3p.system` via `??` — because `_v3p` is defined (not nullish), `finalPromptOverride` (which contains the skill instructions) is **silently discarded**.
4. The LLM receives a generic V3 system prompt with no skill instructions.

### Why `??` is wrong here

`??` (nullish coalescing) only falls back when the left side is `null` or `undefined`. Since `_v3p` is always a truthy object when V3 is active, the right-hand side (`finalPromptOverride` with the skill) is never reached.

---

## Proposed Fix

**File:** [`electron/llm/WhatToAnswerLLM.ts`](../../electron/llm/WhatToAnswerLLM.ts) — line 813

```diff
- const _wtaSystemPrompt = _v3p?.system ?? finalPromptOverride;
+ let _wtaSystemPrompt = _v3p?.system ?? finalPromptOverride;
+ if (_v3p && activeSkill) {
+   // Append the skill block after the V3 system prompt so V3 routing
+   // context is preserved while skill instructions still reach the LLM.
+   _wtaSystemPrompt = `${_v3p.system}\n\n## ACTIVE SKILL\n${activeSkill.promptBlock}`;
+ }
```

**Why append instead of replace:**  
`_v3p.system` carries routing context (source authority, evidence pack summaries) that the LLM needs to answer correctly. Replacing it entirely with `finalPromptOverride` would regress V3 source-authority routing. Appending the skill as a clearly-delimited section preserves both.

---

## Additional Risk: Skill Block in `finalPromptOverride` Missed in Non-V3 Path

When `_v3p` is `undefined` (V3 disabled), the `??` correctly falls back to `finalPromptOverride`. This path works today but should be verified to still include `activeSkill.promptBlock` — confirm the upstream code that builds `finalPromptOverride` always appends the skill before this point.

---

## Blast Radius

| Symbol | Confirmed Dependents | Notes |
|---|---|---|
| `WhatToAnswerLLM` class | `electron/llm/index.ts` (×2 refs) | Only 1 confirmed importer — low blast radius |
| `_wtaSystemPrompt` (local variable) | Scoped to `WhatToAnswerLLM` class | No external exposure |
| `activeSkill` parameter | Internal to `WhatToAnswerLLM.generateStream` | Already propagated correctly to the call site |

**Existing test to validate:**  
- [`electron/services/__tests__/Issue303SkillInvocation.test.mjs`](../../electron/services/__tests__/Issue303SkillInvocation.test.mjs)
  - Currently checks `source.indexOf('skillPromptBlock')` 
  - Must be extended or verified to cover the V3-active path (i.e., when `_v3p` is defined)

---

## Safe-Change Checklist

- [ ] Fix applied in `WhatToAnswerLLM.ts` (append skill block when both `_v3p` and `activeSkill` are present)
- [ ] Confirm `finalPromptOverride` still has skill block for non-V3 path
- [ ] `Issue303SkillInvocation.test.mjs` extended to cover V3-active scenario
- [ ] Manual smoke-test: create a skill, enable it, ask a question → verify skill instructions appear in response
- [ ] Verify no regression for non-skill V3 answers (V3 system prompt should be unchanged when `activeSkill` is null)
