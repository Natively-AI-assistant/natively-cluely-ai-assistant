# WTA (live transcript) vs Manual chat — are they the same pipeline?

**Short answer: no.** They share the decision layer and the retrieval port, and diverge in prompt assembly and — critically — in **what they do when the evidence pack says "insufficient"**. That last difference is what makes *"introduce yourself, what are your AI projects"* refuse on live audio and answer correctly when typed.

Investigated 2026-08-28 by reading + executing the real modules. `file:line` against the working tree.

---

## What IS shared

| Layer | Shared? | Evidence |
|---|---|---|
| Decision layer (`decide()`) | **Yes, identical** | Executed both provenances over 5 intro-style questions × 3 modes: `retrieve`, `planned`, `questionTypes` match exactly for `manualQuestion` vs `transcriptQuestion`. The only decision-layer difference is `resolveQuestion`'s confidence (manual `1.0`, transcript `0.7` or the extractor's own — `orchestrator.ts:91-102`), which does not change routing here. |
| Retrieval port | **Yes** | WTA passes `retrieval: _ctx.port` (`IntelligenceEngine.ts:3061`) from `v3ModeRetrievalContext()`, the same helper that builds mode + profile + meeting ports and combines them (`:5227-5300`). Manual builds the same combination (`ipcHandlers.ts:1144-1245`). |
| `buildV3Prompt` bridge | Yes, both call it | WTA `IntelligenceEngine.ts:3015` (`surface: 'what-to-answer'`); manual `ipcHandlers.ts:1258` (`surface: 'manual-chat'`). |
| `EvidenceResolver` | Both use it | WTA `WhatToAnswerLLM.ts:505`; manual `ipcHandlers.ts:3229`. Both search **reference files only** — `getReferenceFiles(mode.id)` at `EvidenceResolver.ts:326`. Neither searches the profile. |

## What DIVERGES

### 1. The hard refusal — this is the reported bug

**WTA hard-returns a canned refusal before any generation:**

```ts
// WhatToAnswerLLM.ts:806-809
if (pack.answerPolicy === 'refuse_insufficient_evidence') {
    yield buildInsufficientPropertyAnswer({ property: pack.requestedProperty, sourceOwner: pack.sourceOwner });
    return;                       // <- no model call, no profile, no repair
}
```

**Manual chat treats the same pack as a *signal*, not a verdict.** It still generates, and the governed refusal only suppresses the *false-refusal repair*:

```ts
// ipcHandlers.ts:4751-4757
const governedRefusal = manualContextOsGeneration?.govern === true
  && manualContextOsGeneration?.evidencePack?.answerPolicy === 'refuse_insufficient_evidence';
const shouldRepair = hasStrongEvidence && !governedRefusal;
```

Its property-unsupported check runs **after** generation, against the produced answer (`ipcHandlers.ts:4870-4893`, gated on `trimmed.length >= 8`).

So: identical pack, opposite outcomes. WTA refuses without asking the model; manual asks the model and lets the answer stand.

### 2. The governed WTA turn BLANKS the candidate profile

```ts
// WhatToAnswerLLM.ts:811-814
typedModeContext = rendered;
typedCandidateProfile = '';     // <- the résumé/profile is explicitly cleared
```

For *"introduce yourself"* / *"what are your AI projects"* — questions answered **from the profile** — this removes the only source that could answer them, and then §1 refuses because the reference-file pack is empty.

### 3. The gate is MODE-shaped on WTA and TURN-shaped on manual

```ts
// WhatToAnswerLLM.ts:495  — is the MODE document-grounded?
const governedWtaTurn = Boolean(_cog?.govern && forceDocumentGrounding && isIntelligenceFlagEnabled('contextOsEvidencePackEnabled'));

// ipcHandlers.ts:3210     — does THIS TURN need reference files?
const needsReference = manualTurnSourceDecision.requiredEvidenceKinds.includes('reference_files');
```

WTA asks *"is this a doc-grounded mode?"*; manual asks *"does this question need documents?"* In a mode holding reference files, **every** WTA turn is governed — including profile questions that have nothing to do with the files.

> Caveat: `requiredEvidenceKinds` is itself derived from the mode's **authority**, not the question text (`turnSourceDecision.ts:195-207` returns `required: ['reference_files']` for any `reference_files_*` authority), so manual also invokes the resolver in such a mode. The decisive difference remains §1 — manual does not let the resulting pack end the turn.

### 3b. THE MINIMAL ROOT CAUSE — WTA's copy of the governance gate is missing the `!v3OwnedTurn` guard

This is the sharpest statement of the bug, and it is a **duplicated-logic drift**, not a design decision.

`LLMHelper` guards Context OS pack governance on `!v3OwnedTurn` — when V3 already owns the turn, the legacy governance must not run:

```ts
// LLMHelper.ts:6656  (comment at :6651 — "WTA passes BOTH contextOsGeneration and a V3-composed …")
if (_cog && _cog.govern && !v3OwnedTurn && (forceDocumentGrounding || callerPreResolvedPack)
    && isIntelligenceFlagEnabled('contextOsEvidencePackEnabled')) {
```

The same guard also protects `shapeDocumentGroundedSystemPrompt` (`:5895`) and `forceDocumentGrounding` (`:6093`).

**`WhatToAnswerLLM`'s in-file copy has no such guard:**

```ts
// WhatToAnswerLLM.ts:495 — note the missing !v3OwnedTurn
const governedWtaTurn = Boolean(_cog?.govern && forceDocumentGrounding
    && isIntelligenceFlagEnabled('contextOsEvidencePackEnabled'));
```

And manual chat explicitly opts in to the protection (`ipcHandlers.ts:1469-1473`):

```ts
// v3Owned: LLMHelper must TRANSPORT this prompt, not rewrite it.
// Without it, a doc-grounded custom mode ran a second, ungoverned
// retrieval and injected it around V3's filtered evidence …
{ v3Owned: true },
```

So manual chat is `v3Owned` and skips legacy governance entirely; WTA runs its own ungoverned copy, reaches `refuse_insufficient_evidence`, and hard-returns. **Adding the same `!v3OwnedTurn` condition to `WhatToAnswerLLM.ts:495` is a candidate one-line fix** — but confirm it does not disable governance for legacy (non-V3) WTA turns, which still need it.

### 3c. Manual chat's V3 branch runs NO post-stream validators

Verified: `ipcHandlers.ts:1476-1560` (the V3 manual branch) contains no `validate*`, no false-refusal repair, no `detectUnsupportedDocumentAnswer` — only streamId supersession, the mode-identity-at-commit guard and the truncation flag. Every validator (`validateAnswerStructure`, `validateProfileEvidence`, `validateProfileOutput`, the false-refusal repair) lives only in the **legacy** branch, which the ask box does not take by default.

**Consequence:** the post-stream overwrite (`01-ROOT-CAUSES.md` RC7b) is **WTA-only on the default path**. Manual chat cannot overwrite a good answer with the refusal because it runs no validator at all. That is a second, independent reason "manual answers as expected" — and it also means the two surfaces have opposite risk profiles: WTA can destroy a correct answer, manual can ship an unvalidated one.

### 4. Prompt assembly differs

WTA composes through `PromptAssembler` with a `finalPromptOverride` system prompt (`WhatToAnswerLLM.ts:762, 829, 847`). Manual composes through the V3 `prompt-composer`. They are not the same assembly, so "same system prompt" is not a safe assumption on either path.

### 5. WTA is deadline-bounded in ways manual historically was not

`raceStreamWithDeadline` + `firstUsefulDeadlineMs` (`liveDeadlines.ts:56-77`) abort a slow stream; on timeout WTA emits *"I don't have enough context from the conversation to answer that yet."* (`IntelligenceEngine.ts:3391`) for `general_meeting_answer` / `lecture_answer`. The `viaServerCascade` comment at `liveDeadlines.ts:63-72` records that this ordering fix "had only ever been applied to the WTA path, never to manual chat" — the two have drifted here before. **A second, independent way to get a refusal-shaped answer on live audio only**, especially for a long intro answer.

---

## Why the reported case fails

In an interview-mock session with a mode that holds reference files:

1. The interviewer says *"introduce yourself, what are your AI projects"* → captured via system audio, extracted as a transcript question.
2. The mode is document-grounded → `governedWtaTurn` is true (§3), regardless of the question being about the profile.
3. `EvidenceResolver` searches **reference files only** (`EvidenceResolver.ts:326`) → nothing about the user's identity → `answerPolicy: 'refuse_insufficient_evidence'`.
4. `typedCandidateProfile = ''` (§2) removes the résumé that *could* have answered.
5. §1 yields the canned refusal and **returns — the model is never called**.

Typed into manual chat, the same question reaches generation with the profile present, so it answers normally.

Note this is a **third** independent refusal mechanism, distinct from the two in `01-ROOT-CAUSES.md`: the claim-authority gate (RC1) and the post-stream validator overwrite (RC7b). All three produce refusal-shaped output; only RC7b overwrites an answer that already streamed.

## What to verify next

- **Which mode was active** in the user's mock session. If it was `technical-interview` (seeded `profile_only`), `forceDocumentGrounding` is false and §1–§3 do **not** apply — the failure would then be §5 (deadline) or the H6 validator. Confirm from the `[WhatToAnswerLLM] Active mode grounding` log line before fixing.
- Whether `contextOsEvidencePackEnabled` is on in that build — §1–§3 all require it.
- The extracted question text from ASR: `extractLatestQuestion` may split *"introduce yourself, what are your AI projects"* into a fragment that classifies differently from the full sentence.

## Independent code review — ten findings

A `/code-review high` pass over both pipelines. It reached §3b independently and added nine more. Verification column is mine.

| # | Sev | Location | Defect | Verified |
|---|---|---|---|---|
| 1 | HIGH | `WhatToAnswerLLM.ts:798` | The pack-refusal block is **not gated on the V3 prompt**. V3's port can return real evidence and compose a prompt while the legacy pack resolves `refuse_insufficient_evidence` — WTA hard-refuses at 798/806 and the V3 prompt (not consulted until `:1008`) is never sent. `v3Owned: true` was set at `:1081` for exactly this reason one layer down, but never applied to the in-file copy. | **Yes** — §3b; `LLMHelper.ts:6656` has `!v3OwnedTurn`, `WhatToAnswerLLM.ts:495` does not |
| 2 | HIGH | `IntelligenceEngine.ts:3899`→`:3983` | The doc-grounded validator re-retrieves via the **legacy** block and overwrites the streamed answer, but under V3 the answer was grounded in `_v3p.user` (`WhatToAnswerLLM.ts:1047`) — a different evidence set. The gate exempts coding and attached images but **not** `requestSnapshot.v3Prompt`. | **Yes** — RC7b in `01-ROOT-CAUSES.md`, sharpened: the missing V3 exemption is the bug |
| 3 | HIGH | `IntelligenceEngine.ts:3054`, `WhatToAnswerLLM.ts:829` | **DOM capture and screen OCR text are dropped entirely.** `domContext` is never passed to `buildV3Prompt`, and `hasScreenContext` is `Boolean(options?.screenContext) \|\| imagePaths?.length > 0` — the DOM transport is not in that predicate. Their only carrier is `packet`, which `_v3p.user` discards. | **Yes** — confirmed the predicate omits `domContext`; it is rendered only into `packet` (`:670`) |
| 4 | MED-HIGH | `WhatToAnswerLLM.ts:791` | `declineYieldsToAttachedImages` receives only `hasAttachedImages`; `hasScreenText` (the DOM+OCR union at `:229`) is never consulted, so the screenshot exemption does not extend to the other two screen transports. | Not re-verified |
| 5 | MED-HIGH | `IntelligenceEngine.ts:4124` | The WTA-only profile repair validates against `candidateProfile`, which under V3 **was never sent**. Worse: in a mode with empty `profileSources`, an honest decline trips `false_no_access_refusal` and the repair regenerates from the full `candidateProfile` — **re-opening a source V3 deliberately did not authorize**. | Not re-verified — flagged as the most security-relevant of the ten |
| 6 | MED | `WhatToAnswerLLM.ts:539` | Up to **6 s of pre-first-token latency** spent on a mode-context retrieval V3 then discards (`forceDocumentGrounding` bypasses the prefetch). Also declares an outbound `reference_files` scope for content never dispatched (`:956`). | Not re-verified |
| 7 | MED | `IntelligenceEngine.ts:3079` | `promptInstruction` (custom actions) has **no V3 carrier** — rendered only into `intentContext`→`packet`. The action silently behaves as a plain press while the UI says it ran. | Not re-verified |
| 8 | MED | `IntelligenceEngine.ts:3157` | The live spoken surface ships the **manual-chat answer contract**, not `what_to_say`. Lost: "output only the exact words to say", and the Team Meet voice overlay rule (`promptSystemV2.ts:495`) that keys on `what_to_say`/`assist` — so **the overlay can start answering other attendees' chatter**. | Not re-verified |
| 9 | MED | `WhatToAnswerLLM.ts:321` | The AnswerPlan contract and `<repeat_press_directive>` reach the model only via `packet`, so V3 discards both — while the engine still applies its scaffold/stream-hold gates for a six-section answer the prompt never asked for. | Not re-verified |
| 10 | LOW | `orchestrator.ts:153` | `questionSource`/`questionConfidence` are plumbed end-to-end and **never consumed** — `decide()` uses only `q.resolved`, and the trace recomputes `resolutionConfidence` from `req.manualQuestion`. The documented defense against low-confidence ASR extractions does not exist. | **Yes** — `q.source`/`q.confidence` appear nowhere; only `resolutionConfidence: req.manualQuestion ? 1 : 0.7` at `:795` |

**Finding 10 corroborates the executed result at the top of this file.** I measured identical decisions for manual vs transcript; #10 explains why — the provenance fields are dead. It also means the manual-vs-transcript split is **not** a source of WTA refusals today, contrary to the rationale comment at `IntelligenceEngine.ts:3034-3040`.

**The unifying pattern across 1, 2, 3, 5, 7, 8 and 9:** when V3 composes, `_v3p.user` replaces `packet.userMessage` — so **everything whose only carrier is `packet` silently disappears**, while WTA-only post-stream layers keep validating against the legacy blocks that were never sent. That is one architectural fault with seven symptoms, and it is the thing to fix rather than seven patches.

The reviewer also cleared two candidates: the `profileSourceCount` manual-vs-engine mismatch (always equal in practice) and an apparent scope bypass in the profile repair (`LLMHelper.ts:552/567` sniffs `<candidate_` and infers the scope).

## Divergence in the OTHER direction (manual is the degraded side)

- **Renderer chat history is dropped on manual chat.** `NativelyInterface.tsx:6349` builds `conversationContextForSubmit` (`:6370`) and passes it as `context`, but the V3 short-circuit consumes only `message` — so it falls back to `conversation-state-store` (populated at `ipcHandlers.ts:1591`). WTA *does* thread a live window (`conversationSummary: _ctx.conversationWindow(90)`).
- **No validators on manual's V3 branch** (§3c) means an unvalidated answer can ship there.
- **`personaBase`:** manual resolves `action: 'answer'` **with `chatSurface: true`**; WTA resolves it without. Neither ships `what_to_say` on the default path, so the spoken-words contract is absent from the live overlay while manual at least gets its chat layout.

*(These three come from the code-review agent and are reported as its conclusions; I verified §3c directly, not the other two.)*

## Suggested direction (not yet decided)

Make WTA's governed refusal behave like manual's: treat `refuse_insufficient_evidence` as a signal that suppresses repair, not as a hard return — and do not blank `typedCandidateProfile` when the turn's own claims are profile-shaped. Both are small, but they change live answer behaviour, so they belong behind a flag with the same dev/test/prod default (`contracts/flag.ts` header).
