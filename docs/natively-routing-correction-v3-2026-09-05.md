# Correction: V3 is the main answer system, and the audit said otherwise

Written 2026-09-05, correcting `docs/natively-current-routing-map.md` and `docs/natively-current-modes.md`.

## What the audit got wrong

Phase 1 reported that the live prompt path is `electron/llm/promptSystemV2.ts`, on the strength of finding `promptSystemV2: { default: true }` in `intelligenceFlags.ts`.

That flag default is real. The conclusion drawn from it is not.

Context Intelligence V3 is the main answer system. Its flag lives in `electron/context-intelligence/contracts/flag.ts` with `DEFAULT_ENABLED = true`, and the comment above that constant is explicit: "ROLLOUT: flipped to `true` on 2026-07-30 at the owner's direction, V3 is the main answer system, not an opt-in."

Prompt System v2 is the fallback. Its own flag description in `intelligenceFlags.ts` says so, and I quoted the surrounding lines in the audit without reading this one: it covers "the Context-Intelligence-V3-null fallback plus the surfaces V3 never adopted".

So the ordering is V3 first, V2 when V3 returns null, legacy constants when the V2 flag is off.

## Why the audit missed it

V3's flag is deliberately not in `intelligenceFlags.ts`, and the module says why in its header. Twenty of the sixty-two flags in that registry resolve differently in development than in production, and that split is how `composePrompt` came to be built, tested, and never executed for a user. V3's flag module refuses to import the registry so it cannot inherit a development-only default.

That is a good decision. It also means a search of the flag registry, which is what I did, cannot find the most important flag in the system. The lesson generalises: in this codebase the absence of a flag from `intelligenceFlags.ts` is not evidence the feature is unflagged or inactive.

## What V3 actually decides

V3 is not a prompt composer with a routing bolt-on. It is a routing system, and it already owns several of the axes the proposed `IntentFrame` was going to introduce.

| V3 type | Values | Corresponding IntentFrame axis |
|---|---|---|
| `QuestionType` | 17, from `PERSONAL_EXPERIENCE` to `CODING_TASK` to `AMBIGUOUS` | roughly `task` plus `mode_intent` |
| `SourceType` | 10, from `RESUME` to `SCREEN_CONTEXT` | `grounding`, at finer resolution |
| `GroundingPolicy` | `STRICT_SOURCE_ONLY`, `SOURCE_FIRST`, `OPEN_KNOWLEDGE`, `ASK_BEFORE_FALLBACK` | no equivalent; strictness was not modelled |
| `RetrievalPath` | `FAST`, `GROUNDED`, `VERIFICATION` | `capabilities.retrieval` |
| `Answerability` | `FULL`, `PARTIAL`, `NONE`, `CONFLICTING` | no equivalent |

`electron/context-intelligence/question/turn-classifier.ts` describes its own job as deciding "WHAT a turn is asking and WHETHER retrieval should run at all". That is most of what the campaign proposed to build.

It is also deterministic on purpose. Its header cites two rules from the V3 architecture document: section 32.7 forbids using a language model for deterministic policy decisions without evidence that it improves quality, and section 22.6 forbids an expensive multi-agent router on every uncertain question.

## What V3 does not decide, and why that matters

V3 has no notion of whether Natively should speak at all. There is no `needs_response`, no silence decision, nothing equivalent anywhere in the module.

That is deliberate, and `IntelligenceEngine.buildV3ForTranscriptSurface` says why: "No resolvable question (the genuinely proactive case) returns null and the surface keeps its legacy behaviour, proactivity is the product feature, and degrading it into no-evidence disclosures would be adoption theatre."

So V3 takes the turn when a question resolves confidently, and hands back everything else. The turns it hands back are the proactive ones: the ambient live audio where nobody asked anything and the system has to decide by itself whether there is something worth saying.

Those are exactly the turns where the measured waste is. 6.1% of live generations end in a silence string, and 95.9% of those land on a fallthrough answer type. A turn that resolves to a confident question does not end in "Nothing actionable right now".

## What this means for the campaign

The premise was "replace the intent classifier". That was the wrong frame, and the corrected one is narrower and much better supported.

The proposed router should not replace V3 and should not duplicate it. `grounding`, `capabilities.retrieval` and most of `task` already have a deterministic owner that is live in production and better developed than anything this benchmark measured.

What the router should own is the axis V3 deliberately left open: whether to respond at all, on the proactive turns V3 declines. That is a single axis rather than eleven, it is the axis with the measured product payoff, and it is the axis where the benchmark's best candidate is furthest ahead of the incumbent (66.3 against 4.4).

Two consequences follow.

The `IntentFrame` in PR 5 is wider than it needs to be. It should either narrow to the axes V3 does not own, or be explicit that most of its axes are populated FROM V3 rather than predicted. Leaving it as it stands invites a second opinion on decisions that already have an owner, which is the same criticism the Phase 1 audit made of the existing system.

The benchmark is still the right evidence, and now for a sharper reason. V3's own rules require evidence before a learned model replaces a deterministic one. The benchmark provides exactly that, for exactly one axis: the deterministic incumbent on `needs_response` is the regex tier, which fires on 7.7% of turns, and the learned candidate reaches 66.3 macro F1 where zero-shot NLI reaches 23.5.

## What is not corrected

The Phase 5 results stand. Every candidate was measured on the same corpus against the same labels, and none of the measurements involved the prompt path.

The audit's other findings stand: two intent classifiers on the legacy path, the Recruiting channel inversion, the silence share, the mode grounding defaults. None of them depended on which composer runs.

The count of classifiers changes from two to three. `turn-classifier.ts` is the third, it is deterministic rather than learned, and it is the one that actually runs first.
