# Seminar Mode — User Guide

**Campaign 3 (fix/answer-policy-engine) · 2026-07-19** — Seminar Mode is the 8th built-in mode, shipped with the Answer Policy Engine.

---

## What it is

Seminar Mode is **strict file-grounded Q&A** for presentations, thesis defenses, paper walkthroughs, and panel Q&A. Every answer must either:

1. **Cite the source file + section/heading**, or
2. **Acknowledge explicitly that the answer is not in the reference files**, then answer from general knowledge with a visible "from general knowledge" label.

The mode **never refuses** an off-document question. It just labels the answer honestly so the audience can tell where it came from.

---

## How it differs from the other 7 modes

| Mode | Strictness | Off-document Q → | Source label |
|---|---|---|---|
| General | Flexible | General knowledge (no label) | none |
| Sales | Flexible | Sales-conversation reply | none |
| Recruiting | Flexible | Meeting-recap reply | none |
| Team Meet | Flexible | Meeting-recap reply | none |
| Looking for work | Flexible | Profile-grounded reply | none |
| Technical Interview | Flexible | Profile-grounded reply | none |
| Lecture | Flexible | Reference-file-grounded reply | none |
| **Seminar** | **Strict** | **"Not in your reference files — from general knowledge:" preamble** | **always visible** |

Seminar Mode's differentiator is **source transparency** — every answer carries a badge telling the user where the content came from. The model is held to a higher standard of attribution, but is never blocked from answering.

---

## When to use it

- **Paper walkthrough**: load the paper as a reference file. Ask "What is the main contribution?" — get a grounded answer with citation. Ask "What are the limitations?" — if the paper doesn't discuss them, the answer is labeled "not from your reference files — from general knowledge".
- **Thesis defense prep**: load the thesis. Practice questions get answered with section references. Questions about related work not covered in the thesis get the off-document preamble.
- **Lecture Q&A**: load the slide deck. Student questions about the material get cited answers. Questions about prerequisite knowledge not in the deck get labeled general-knowledge answers.
- **Panel discussion**: load the agenda/briefing. Substantive panel questions get grounded; off-script questions get labeled.

## When NOT to use it

- **Open-ended creative work**: Seminar is strict by design. Brainstorming or exploratory conversation is better served by General Mode.
- **Real-time coaching during a live interview**: Use Looking-for-Work or Technical Interview instead — they have interview-specific voice coaching.
- **Meeting summarization**: Use Team Meet — it has meeting-recap shape baked in.

---

## The five micro-suite questions, validated

The Answer Policy Engine's acceptance suite (5 cases, run live against real Electron + real backend) verifies Seminar Mode's behavior on the core identity/JD/general axis:

| Case | Question | Expected behavior | Verified |
|---|---|---|---|
| C3M-001 | "What's your name?" | Identity answer, candidate-voice, no bio dump | ✅ |
| C3M-002 | "What is the job regarding?" | JD-grounded answer with role + company | ✅ |
| C3M-003 | "What skills are required?" | JD requirements surfaced | ✅ |
| C3M-004 | "Why should we hire you?" | Grounded pitch (resume + JD mixed) | ✅ |
| C3M-005 | "What's your salary expectation?" | Negotiation-safe deflection, no bio dump | ✅ |

5/5, zero hallucination flags, zero false refusals. These are the regression gate for any future Answer Policy Engine change.

---

## How it works under the hood

Seminar Mode emits a `groundingProfile` with the strictest preset:

```ts
{
  evidencePreference: 'required',
  onNoEvidence: 'say_not_found_then_answer_general',
  labelStyle: 'badge',
}
```

The TurnPlanner's 4-tier resolution order (iter12):

1. **Tier 1:** `sourceContract.groundingProfile` (per-mode override) — if your mode has an explicit profile set, that wins.
2. **Tier 2:** `sourceContract.templateType === 'seminar'` — when the mode is Seminar, this is the trigger (no env flag needed post iter12).
3. **Tier 3:** `NATIVELY_SEMINAR_MODE` env flag — legacy migration window.
4. **Tier 4:** `DEFAULT_GROUNDING_PROFILE` — the 7 built-in modes.

The source badge is computed by `SourceBadge.computeSourceBadge()` (electron/llm/SourceBadge.ts) and rendered under each suggestion in the overlay. The visible pill text matches the answer's grounding source.

---

## The "not in your reference files" preamble

When Seminar Mode answers a question that isn't in the loaded reference files, the model prepends:

> Not in your reference files — from general knowledge: [answer]

This is explicit, not a refusal. The user sees:
- The model is engaging with their question.
- The model is being honest about the source.
- The answer is still useful.

The intent: in a presentation or defense, an off-script question that the model can't ground in the materials is preferable to either silence (a refusal) or a confident-sounding fabrication. The preamble is the trust-builder.

---

## The visible badge

Every Seminar-mode answer carries a small pill under the suggestion text:

| Badge text | Meaning |
|---|---|
| `From: Resume` | Answer grounded in the candidate's resume (interview prep use case) |
| `From: Job description` | Answer grounded in the JD |
| `From: Reference files` | Answer grounded in the loaded slides/paper/deck |
| `Mixed: Resume + Job description` | Answer draws on both |
| `Mixed: ...` | Other multi-source combos |
| `General knowledge` | Off-document answer (no reference file evidence) |
| `Not in your reference files — from general knowledge:` | Seminar Mode preamble for off-doc answers |

The badge appears under every answer, not just Seminar Mode's. It's the Answer Policy Engine's universal source-transparency signal (founder §2.6).

---

## Engineering notes

- **Tests:** 70/70 unit tests pass across 5 suites (TurnPlanner core, matrix, PromptBuilder, SourceBadge, Seminar). The 5/5 micro-suite regression check passes after every change.
- **Strictness is enforced, never blocks:** Seminar Mode is the strictest profile, but it never refuses. It always answers. The `onNoEvidence: 'say_not_found_then_answer_general'` is the explicit anti-refusal invariant.
- **Per-mode contracts win over env flags:** Iter12 added a 4-tier resolution order so a mode's persisted `groundingProfile` (or `templateType === 'seminar'`) overrides the global `NATIVELY_SEMINAR_MODE` env flag. Migration window: both paths work.
- **Source badges are end-to-end:** Engine computes from TurnPlan → main process forwards → preload types → renderer renders. Backward-compatible: legacy emitters that don't carry the label fall back to "General knowledge" in the UI.

---

## Related files

- `electron/llm/TurnPlanner.ts` — `planTurn()` is the single per-turn decision site.
- `electron/llm/SourceBadge.ts` — `computeSourceBadge()` + `computeEngineSourceLabel()` for the overlay.
- `electron/llm/ProfileJitPromptBuilder.ts` — emits the `<seeder_leash>` directive when `seedCandidateBackground=false`.
- `electron/services/ModesManager.ts` — `MODE_TEMPLATES` Seminar entry; `TEMPLATE_SYSTEM_PROMPTS.seminar` wired to `MODE_SEMINAR_PROMPT`.
- `electron/llm/prompts.ts` — `MODE_SEMINAR_PROMPT` (file-grounded Q&A prompt).
- `electron/services/modeSourceContract.ts` — `groundingProfile` schema migration (iter4).
- `electron/services/__tests__/ModeSeminarGroundingProfile.test.mjs` — 9/9 Seminar wiring tests.
- `electron/llm/__tests__/TurnPlanner.test.mjs` — 20/20 (incl. 4-tier resolution).
- `electron/llm/__tests__/TurnPlannerMatrix.test.mjs` — 14/14 (founder §5 behavior matrix).
- `traces3/final-report.md` — campaign-final architecture + commit inventory.

---

## Future work (deferred)

- **Live 250ms Evidence Probe** — matrix-tested but not live-wired. Currently the evidence probe is scattered across orchestrators (EvidenceResolver, EvidenceOrchestrator, etc.). The TurnPlanner emits the probe order; the resolver doesn't yet execute it as a single 250ms-deadlined parallel unit (founder §2.2).
- **Coding cards** — precompute approach/signature/complexity cards for uploaded coding problems. The probe would match against these for instant "this is problem X, approach: Y" answers (founder §2.4).
- **40q grounding + 19q thesis regression suites** — deferred due to Acct1 weekly budget. Will resume when the weekly quota resets.