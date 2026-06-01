# Transcript-Aware Negotiation Intent Routing

**Date:** 2026-06-01
**Status:** Implemented (Phase 1 + Phase 2), reviewed, tested.

## Problem

Intent for each user question was classified **per-utterance** with no
conversational memory. In a live salary conversation, follow-up turns that carry
no salary keyword in isolation — "what are your expectations?", "give me the
number", "tell me your range", and the typo'd "what do you think about the
slalary" — did **not** trigger the negotiation/salary intelligence. Only a turn
literally containing "salary" did.

Negotiation is a **conversational state**, not a property of a single sentence.
The right signal is the rolling transcript, not the lone utterance.

## Two failure modes (they need different fixes)

1. **Real meeting** (interviewer speaking): the `NegotiationConversationTracker`
   is already fed interviewer STT (`main.ts` → `feedInterviewerUtterance`) and
   tracks a phase machine. Comp talk is detected here, and the existing
   stickiness keys on `tracker.isActive()`. **This path mostly worked.**
2. **Typed chat** (the user's tested case): the tracker is **never fed**, and the
   orchestrator's classifier saw only the bare question string — the 180s
   transcript never reached it. **This was the real gap.**

## Phase 1 — transcript comp-hint (the high-leverage change)

- `textHasCompEvidence(text)` (exported from `NegotiationConversationTracker.ts`)
  scans for a `$`/`Nk` salary amount (reusing `SALARY_PATTERNS` + `normalizeAmount`,
  20k–5M bounds) **or** a tight comp keyword (`COMP_KEYWORD_RE`). Called **only**
  on interviewer turns.
- App layer (`main.ts`) reads `intelligenceManager.getContext(180)`, filters to
  the **last 1–2 interviewer-role turns**, and registers
  `orchestrator.setConversationContextProvider(fn)` returning
  `{ recentInterviewerComp, lastInterviewerTurn }`. The premium package never
  imports app-layer state — same callback-injection pattern as `setEmbedFn`.
  (We scan only the last 1–2 interviewer turns, **not** the whole 180s window —
  scanning everything caused topic-bleed where behavioral/fit questions inherited
  comp routing.)
- `classifyIntentWithContext(question, ctx)` gained `recentInterviewerComp`. A
  comp thread is "live" if `negotiationActive || recentIntentWasNegotiation ||
  recentInterviewerComp`. A confident base intent **always wins**; only an
  ambiguous (GENERAL) turn that carries an affirmative follow-up signal sticks to
  NEGOTIATION. Behavioral/fit asks ("why am I a good fit") never stick.
- **Decay:** `_nonCompTurnsSinceNegotiation` + `NEGOTIATION_DECAY_TURNS = 2`.
  Stickiness drops after 2 intervening substantive non-comp turns — not just the
  4-minute wall-clock window. Reset at all three `negotiationTracker.reset()`
  sites.

## Phase 2 — garbled/typo comp rescue (deterministic)

- `looksLikeGarbledComp(question)`: deterministic Levenshtein distance (1 for
  words < 8 chars, 2 for ≥ 8) against `FUZZY_COMP_WORDS`
  (salary / compensation / remuneration / negotiate / negotiation), gated to
  tokens that are **not** an exact comp keyword. Catches "slalary", "salery",
  "compensaton", "negocation".
- `processQuestion`: a GENERAL turn where `looksLikeGarbledComp` is true is
  upgraded to NEGOTIATION.

### Why not an SLM? (we tried — it failed)

The first Phase-2 design routed near-misses to a zero-shot SLM
(`Xenova/mobilebert-uncased-mnli`) for a final semantic call, on the hypothesis
that "slalary" embeds near "salary". **Empirically tested against the real
model:**

| Input | comp score | result |
|---|---|---|
| "what do you think about the slalary" | **0.18** | ❌ missed |
| "what is your salery expectation" | 0.48 | ❌ missed (below threshold) |
| "what is a hashmap" | **0.82** | ❌ **false positive** |

The deterministic edit-distance gate scored **10/10 on real typos with 0 false
positives** across a 133-word technical/interview vocabulary (including traps:
salad, celery, salami, singular, similar). The SLM was **removed entirely** — it
was slower, unreliable on the actual garble, and dangerous on unrelated terms.

**Lesson:** test the model before trusting a plausible-sounding embedding
hypothesis.

## Files

- `premium/electron/knowledge/NegotiationConversationTracker.ts` — `textHasCompEvidence`, `COMP_KEYWORD_RE`
- `premium/electron/knowledge/IntentClassifier.ts` — `recentInterviewerComp` ctx, `looksLikeGarbledComp`, `levenshtein`, `FUZZY_COMP_WORDS`
- `premium/electron/knowledge/KnowledgeOrchestrator.ts` — `setConversationContextProvider`, decay counter, Phase-2 rescue in `processQuestion`
- `electron/main.ts` — provider registration reading `getContext(180)`

## Tests

- `electron/services/__tests__/TranscriptAwareIntentRouting.test.mjs` (13) — stateless classifier + comp-evidence + fuzzy gate (incl. 133-word zero-FP vocab assertion)
- `electron/services/__tests__/TranscriptIntentRoutingIntegration.test.mjs` (4) — real `KnowledgeOrchestrator` + in-memory SQLite + ingested resume: provider flips follow-ups, decay drops stickiness, "slalary" rescued, throwing provider swallowed
- `electron/services/__tests__/NegotiationStickinessAndCircuitBreaker.test.mjs` (24) — prior stickiness + circuit-breaker fixes

## Known limitation

The transcript hint reads **finalized** transcript turns (`getContext(180)`), not
interim STT partials. If an interviewer's comp turn hasn't finalized when the
candidate's follow-up arrives, that single follow-up may miss the hint. In
practice the interviewer's turn has usually finalized by the time the candidate
responds, and any correctly-spelled comp turn activates the thread for subsequent
follow-ups.
