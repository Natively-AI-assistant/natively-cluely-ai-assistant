# Phase 3 — Mode Policy Spec

**Status:** COMPLETE (contract). **Date:** 2026-07-29

---

## 1. The problem this replaces

Mode is currently reinterpreted at **~95 branch sites across ~30 files**, and **eight files hold their own copy of the mode-id list** — five as plain string sets with no compile-time link to `ModeTemplateType`. That is why adding the 8th mode (`seminar`) compiled cleanly while silently disabling its routing in six places, and why an unvalidated `templateType` can create a mode with **no system prompt at all**.

**The registry below is the single source of truth. A mode id that is not in it does not exist.**

---

## 2. Contract

```ts
interface ModePolicy {
  id: string;
  version: string;                 // bumped on any behavioural change; recorded in every trace
  name: string;
  purpose: string;

  allowedSourceTypes: SourceType[];
  sourcePriorities: Partial<Record<SourceType, number>>;

  groundingPolicy: GroundingPolicy;
  fallbackPolicy: FallbackPolicy;
  capabilityPolicy: CapabilityPolicy;
  answerStyle: AnswerStylePolicy;

  retrievalPolicy: {
    enabled: boolean;
    maximumAttempts: 2;
    maximumCandidates: number;
    maximumAcceptedEvidence: number;
    verificationThreshold: number;
  };

  contextBudget: {
    evidenceTokens: number; conversationTokens: number;
    transcriptTokens: number; screenTokens: number;
  };

  citations: 'HIDDEN' | 'OPTIONAL' | 'VISIBLE';
}
```

### 2.1 Exhaustiveness is enforced at compile time

The registry is typed `Record<ModeId, ModePolicy>` — **not** `Partial<Record<...>>` and not a bare array. Adding a mode id without a policy must be a **type error**, because the current failure mode is precisely that it isn't one.

Custom modes **compile into this same contract**. There is no separate custom-mode answer architecture (§11).

---

## 3. Registry

All eight built-in modes. `seminar` is included and its UI-unreachability is treated as the bug it is.

| Mode | Grounding | Allowed sources | Gen. knowledge | Notes |
|------|-----------|-----------------|----------------|-------|
| `general` | OPEN_KNOWLEDGE | reference, transcript, conversation, screen | yes | Auto-seeded, undeletable |
| `sales` | SOURCE_FIRST | reference (product/pricing), transcript, screen, conversation | yes | **Never invent pricing, commitments, or customer statements** |
| `recruiting` | SOURCE_FIRST | candidate files, JD, reference, transcript, conversation | yes | Candidate resume ≠ the user's resume — distinct source types |
| `team-meet` | OPEN_KNOWLEDGE | transcript, reference, screen, conversation | yes | Meeting statements/decisions require transcript evidence |
| `looking-for-work` | SOURCE_FIRST | resume, JD, profile facts, reference, conversation | yes | JD may shape emphasis, **never** prove experience |
| `technical-interview` | SOURCE_FIRST | resume, JD, project files, coding samples, screen, conversation | yes | Coding questions take the fast path |
| `lecture` | SOURCE_FIRST | lecture refs, slides, transcript, conversation | yes (definitions) | Lecture-specific claims require evidence |
| `seminar` | SOURCE_FIRST + `documentClaims: STRICT` | seminar doc, slides, supporting refs, transcript | definitions only | `onNoEvidence: say_not_found_then_answer_general` — **labels, never refuses** |

### 3.1 Two modes named in the brief that do not exist

`thesis` and `coding-interview` are **not modes** in this codebase — verified across all DB migrations; they appear only as retrieval keywords and a screen classification. They are **not** being created. Thesis defence is served by `seminar` (which already carries the strict profile); coding interviews by `technical-interview`.

Creating them would add two more entries to the ~95 branch sites for no behavioural gain.

---

## 4. Resolution order

Exactly one path, replacing the current three-way precedence plus an undocumented global env override:

```
1. mode.sourceContract.groundingProfile   (explicit per-mode override)
2. registry[modeId]                       (the table above)
3. hard failure                           (NOT "mode-blind")
```

**`NATIVELY_SEMINAR_MODE` is retired.** A global env var that silently forces every mode into the strict profile is a per-user config decision wearing a deployment flag's clothes.

**Unknown mode id ⇒ throw.** Today it yields empty note sections and an empty system prompt — failing open. The new registry fails closed, and `modes:create` validates `templateType` against the registry before insert.

---

## 5. The backend must stop inferring mode from prompt text

`natively-api` has no mode registry and selects models by regex-matching English prose in the client's system prompt (`/spoken voice in a live (?:job|technical) interview/i`). Rewording one sentence in `prompts.ts` silently downgrades both interview modes.

**Contract:** the client sends `modeId` and `modePolicyVersion` as **structured request fields**. The server routes on those. The regex is deleted once the client ships the fields.

Until then the coupling is documented in `08_MIGRATION_PLAN.md` as a cross-repo migration step, **not** silently inherited.

---

## 6. Capability policy

```ts
interface CapabilityPolicy {
  explainSourceContent: boolean; summarize: boolean; compareSources: boolean;
  directEvidenceInference: boolean; calculateFromEvidence: boolean;
  generatePseudocode: boolean; generateCode: boolean;
  critique: boolean; brainstorm: boolean; suggestImprovements: boolean;
  makeRecommendations: boolean;
  useGeneralTechnicalKnowledge: boolean; useGeneralIndustryKnowledge: boolean;
  hypotheticalExamples: boolean;
  unsupportedPersonalClaims: 'REFUSE' | 'DISCLOSE_GAP';
  externalSuggestionDisclosure: 'NONE' | 'WHEN_SOURCE_SPECIFIC' | 'ALWAYS';
}
```

Strict grounding must not block valid transformations. A `seminar` mode over a document describing an algorithm but containing no code still permits explanation, summary, pseudocode, and code **derived from the documented algorithm** — while blocking unsupported findings and external facts presented as document content.

---

## 7. Custom modes

`customModeSourceEnforcement` currently defaults **OFF**, and custom modes without a clear single-source policy fall back to `general_mixed` = everything allowed. That is the opposite of the required default.

**Contract:** a custom mode compiles to a `ModePolicy` at creation. If its source policy cannot be determined, it inherits `general`'s policy **explicitly and visibly** — not a permissive fallback, and never silently.
