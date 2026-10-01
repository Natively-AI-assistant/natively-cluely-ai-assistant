# System-design diagrams

When a turn asks for a system design or a diagram, Natively answers with a short
explanation and a Mermaid block **in the same generation**, and draws that block
as a diagram card as soon as its closing fence arrives — while the rest of the
answer is still streaming.

This document is the flow map, the usage note and the reference for the pieces
in `src/lib/diagram/`, `src/components/diagram/` and
`electron/services/diagram/`.

## Try it

1. Start a session and open the overlay. Mode does not matter (General,
   Technical Interview, Team Meet, a custom mode).
2. Type **“Design a notification service with retries”** in the overlay's box
   (or have it asked aloud and press What to Answer).
3. The first sentence streams, then a **Diagram** card appears and the rest of
   the answer continues underneath it.
4. Refine it from a different entry point: say or type **“Add a dead-letter
   queue”**, **“Show the delivery sequence”**, **“Why do we need the queue?”**,
   or press the shorten action.
5. The card has **Diagram / Source**, copy, zoom, fit and export (SVG, PNG,
   `.mmd`). Pinch or ⌘/Ctrl + wheel zooms; a plain wheel always scrolls the chat.

Switch: **Settings › Intelligence › Notes & answers › Design diagrams**
(default on). Env override: `NATIVELY_SYSTEM_DESIGN_DIAGRAMS=0|1`.

## What decides that a turn gets a diagram

One pure resolver, `src/lib/diagram/diagramRequest.mjs`, used by every route.
It returns `{ enabled, view, operation, output, basis, parentArtifactId,
withCode, attachActiveDesign }`.

| Turn | Result |
| --- | --- |
| “Design a URL shortener”, “How would you architect a chat app…”, “Design Twitter” | create · architecture |
| “Show the authentication sequence”, “Draw an order lifecycle as a state machine” | create · sequence / state (explicit ask, need not be an interview question) |
| “Turn the system we just discussed into an architecture diagram” | create · basis = meeting reconstruction |
| “Draw our actual architecture from the doc” / “draw this” over a screenshot | create · basis = source reconstruction |
| “Implement a rate limiter in Python”, “What is caching?”, “Have you built distributed systems?”, “What is the architecture of a flower?” | no diagram |
| “Design a payment system and implement the idempotency handler” | diagram **and** code (`withCode`) |
| “no diagram” / “explain only” · “diagram only” · “just the Mermaid source” | text-only · diagram-only · source-only |
| With a design on the table: “Add Redis between…”, “Make this multi-region”, “Replace Kafka with RabbitMQ”, “How does this scale to ten million users?” | update |
| “Show it as a sequence diagram”, “Show the write path only” | another view of the same design |
| “Why do we need the queue?” | explain — prose, the diagram stays as it is |
| “Make your answer shorter” | refine — prose changes, the diagram is preserved |
| “Design a parking lot” | a fresh design, not a continuation |
| “Now write the worker in TypeScript” | code, grounded in the design; no diagram |

Rules worth knowing:

- **Mode never decides.** Mode sets voice and sources; the words of the turn
  decide whether it is a design task.
- **Mermaid is not code.** A diagram turn is never a coding answer type: no
  coding template, no execution, no verification spec, no “verified” badge.
- **Follow-ups need a design on the table.** Without one, “add Redis…” is an
  ordinary turn.
- **The router's keyword verdict does not override a design follow-up.**
  `AnswerPlanner` reads “queue”, “cache” and “add” as coding; with a design on
  the table it asks `isDesignFollowUpTurn` and routes the turn as
  `system_design_answer`, so every later stage agrees.
- **After a code answer, a bare “this” means the code.** The design stays on
  the table (it can still be named: “the design”, “the retry queue”), but
  “why is this O(n)?” is not about it.

## The contract and where it travels

`src/lib/diagram/diagramContract.mjs` holds the text. Two parts, kept apart:

- `renderDiagramContract(signals)` — **static**, built from enumerated signals
  and example ids. Safe in the registered/cached system prompt.
- `renderDiagramTurnBlock(request, activeDesign)` — **dynamic**, the design on
  the table (`<active_design>` with its Mermaid). Goes in the turn's user
  content, never the system prompt.

Default shape for a new design: one or two sentences (approach + assumptions),
then one fenced `mermaid` block, then a brief explanation (components, data
flow, scale/failure, tradeoff). The old seven-section template is not sent
beside it (`AnswerPlanner` swaps it for a line that defers to the contract).

`electron/llm/diagramPromptSignals.ts` is the main-process resolver every prompt
surface calls. Each active path carries the contract **exactly once**
(`withDiagramContract` never adds a second copy):

| Route | How it reaches the provider |
| --- | --- |
| What to Answer (button, hotkey), V3 on (default) | `IntelligenceEngine` resolves once → v2 persona (`diagram:` signals, action `answer`) + V3 composer `diagramTurn` section |
| What to Answer, V3 off | `WhatToAnswerLLM` reads the same decision from the request snapshot → v2 base prompt + turn block appended to the envelope |
| Auto Answer (prefetch, adopted or not) | the same `runWhatShouldISay`; nothing is shown or recorded until adopted |
| Typed overlay chat / launcher chat, V3 | `gemini-chat-stream` → persona + composer, as above |
| Typed chat, legacy branch · phone chat | `resolveManualChatBasePrompt(…, diagramTurn)` + turn block on `context` |
| Engine manual answer (`runManualAnswer`) | `AnswerLLM.generate(…, diagramTurn)` — the contract is appended to the V3 system |
| LLMHelper self-composed fallbacks | `diagram:` signals from `routeOptions.answerType` (fresh asks only; this transport has no session) |
| Follow-up / refine (`runFollowUp`) | preservation rule in the prompt **and** a deterministic check on the finished text |
| Brainstorm with a design on the table | `alternativeDesignTurn` → “alternatives + the one to pick, drawn” |
| Accepted `system_design_prompt` action | its instruction is `SYSTEM_DESIGN_ACTION_INSTRUCTION`; the engine treats it as a design ask |
| Direct Assist (typed, STT, screenshot) | its own `requestBuilder`: the same resolver and contract; the design comes from the history the overlay sent |
| Screenshot / DOM capture | `hasVisualContext` → “draw this” reconstructs what is shown |

Recap, follow-up-question lists, titles and summaries never carry it.

## Streaming, rendering, and when the diagram appears

```
provider tokens ─▶ queueToken ─▶ arrived text
                                   │  a ```mermaid fence opens:
                                   │   • the stream switches to the React path (any intent)
                                   │   • Mermaid starts loading (lazy chunk)
paced reveal (≈400 chars/s) ───────┤
                                   │  reveal reaches the block  ─▶ FAST-FORWARD to the end
                                   │                               of what has arrived of it
                                   ▼
                    DiagramArtifact card
                      fence still open  → “Generating diagram…” (Source tab shows lines)
                      closing fence     → policy → Mermaid parse → render → sanitise → <img>
                      prose after it    → continues at the normal pace
```

- The source is generated live by the model; the diagram is drawn **once**, when
  the block is complete. Mermaid is never called per token.
- The fast-forward (`fastForwardDiagramReveal`) is the one explicit exception
  to paced reveal. Text before the block is never skipped; text after it is
  never revealed early.
- An update keeps the previous valid version on screen, dimmed, with “Updating
  diagram…”, until the new one draws.
- Dispatch is by the block's own `mermaid` tag (`fencedBlocks.mjs`), never by
  the action name and never by guessing at untagged code.

### Validation stages

1. **Policy** (`diagramPolicy.mjs`, no DOM): supported family (flowchart/graph,
   sequence, state, class, ER), size limits, no remote images/icons, no script
   URLs, no active HTML. Config directives, frontmatter and click/link
   statements are *removed from what is rendered*; the stored source is
   untouched.
2. **Parse** — Mermaid's own parser, same pinned version that renders.
3. **Render** — layout and SVG.
4. **Output** — DOMPurify (SVG profile) + `isSafeDiagramSvg`.

A diagram that draws is a *drawable* diagram. Nothing here claims the
architecture is correct.

### Repair

Only for a **completed** block that failed stage 2 or 3, only on the newest live
answer, and at most **one** automatic attempt per diagram (plus a cap of 6 per
10 minutes across all diagrams, enforced in the main process). The request
carries the diagram and a bounded parser message — not the meeting, not the
prose. The repaired block must itself draw before it replaces anything, and it
replaces only the exact broken source. A cut-off or cancelled block, a policy
rejection, a replayed answer and a stopped answer never trigger one. “Try to
fix” on the fallback card is a deliberate manual attempt.

## State: the design on the table

`src/lib/diagram/activeDesign.mjs`, one instance on the shared `SessionTracker`
— so typed chat, What to Answer, Auto Answer, follow-ups and the phone all read
and write the same design.

- Set by any recorded answer that contains a valid diagram; an answer without
  one leaves it untouched.
- An update is a **new version** (`design-1.v2`, parent `design-1.v1`); earlier
  answers are never rewritten.
- Cleared on a new meeting, a mode switch and a session reset; expires after 30
  quiet minutes.
- It is conversation data: when the transcript scope is withheld (Settings › AI
  Providers › Privacy) it is treated as absent.
- Direct Assist records nothing in the main process, so its design is derived
  from the history the overlay sends with each request.

## History, exports, Phone Mirror

- **Saved answers** store the answer Markdown, Mermaid source included
  (`ai_interactions.ai_response`). No SVG is persisted and no schema changed;
  the saved-meeting view redraws from source with the same card
  (`DiagramAwareMarkdown`). Copy and text export keep the fenced Mermaid.
- **Export**: `diagram:export` validates the payload in the main process (inert
  SVG / real PNG / bounded text) and writes it. In Undetectable mode it saves
  straight to Downloads instead of opening a system save dialog.
- **Phone Mirror**: the main process has no DOM, so `PhoneDiagramBroker` asks an
  app window to draw the diagram (light palette), re-checks the SVG, and the
  phone receives an `<img>` data URL plus the collapsed source. Until it is
  drawn — or if it cannot be — the phone shows the source.

## The example library

`src/lib/diagram/diagramExamples.mjs`, six reviewed examples. One is attached to
a fresh design turn by default (0–2 via `NATIVELY_DIAGRAM_EXAMPLES`), chosen
locally by view and topic words — no embeddings, no extra model call.

Entry format:

```js
{
  id: 'notification-jobs',            // stable id (the prompt registry keys on it)
  view: 'architecture',               // architecture | sequence | flowchart | state
  topics: ['notification', 'retry'],  // lower-case words/phrases for the selector
  question: 'Design a notification service with retries.',
  constraints: ['…what the asker stated…'],
  assumptions: ['Assumed: …'],        // always labelled; never a stated requirement
  rationale: 'One or two sentences on why the diagram has this shape.',
  mermaid: 'flowchart LR\n    …',     // 5–10 components, ≤12 nodes, ≤20 edges
}
```

To add one: append the entry, bump `DIAGRAM_EXAMPLES_VERSION`, run
`npm run test:diagram`. The suite fails if the example does not pass policy,
exceeds the size the contract asks for, presents a number as a requirement, or
does not parse and render with the pinned Mermaid.

## Timing

Content-free marks per answer (`diagramTimings.mjs`): request accepted, first
token, first text visible, block complete (receipt), block revealed, diagram
visible, answer complete, plus parse/render/cold-load milliseconds and the
repair outcome. Read them in a running app with
`window.__nativelyDiagramTimings()`.

## Tests

| Command | What it runs |
| --- | --- |
| `npm run test:diagram` | everything below |
| `npm run test:lib` | pure modules: parser (incl. random chunk partitions), policy, resolver, contract, examples, active design, repair, refine, viewport, stream decisions, timings |
| `npm run test:diagram:wiring` | real engine + planner + composer, provider stubbed, V3 on and off: the dispatched prompt per route |
| `npm run test:diagram:render` | the renderer in real Chromium with the pinned Mermaid |
| `npm run test:diagram:card` | the card component in real Chromium |
| `npm run test:diagram:overlay` | the real overlay component (Vite dev server + Playwright Chromium, `electronAPI` stubbed): a streamed design answer draws its card mid-stream, final-text replacement, discard, cut-off, code and mixed answers, feature off. Needs a Playwright Chromium on the machine; exits 2 when there is none |
| `npm run test:diagram:live` | **opt-in, calls a real model** (needs `DEEPSEEK_API_KEY` in `.env`; not part of `test:diagram`). The real engine and the real `LLMHelper` ask DeepSeek 12 design questions, 3 follow-ups, a refinement, 3 controls and one repair; every token is recorded with its arrival time, then replayed into the real overlay to prove each diagram the model wrote is drawn by the pinned Mermaid. Prints first-token / diagram-on-screen / answer-done times and the scale each drawing is shown at |

## Limits

- Rendering cannot be interrupted mid-layout (Mermaid lays out on the calling
  thread). Work is bounded by the policy limits instead; the wait has a timeout
  and a late result is cached, not shown.
- `architecture-beta`, C4, mindmap, gantt, pie and the other families are
  rejected by policy.
- The old deterministic lecture extractor (`DiagramIntelligenceService`,
  `diagram:generate`, flag `diagramIntelligence`) is untouched and still has no
  UI caller. It is not part of this feature and its bracket-count check is not
  used to accept a diagram here.

## What a real model taught us (DeepSeek `deepseek-flash`, 2026-10-01)

Recorded with `npm run test:diagram:live`. Each of these is now covered by a test.

- **A node called `graph`.** The model named the "Social Graph" node `graph`, a
  Mermaid keyword, and the diagram did not parse. Twelve words do this in a
  flowchart (measured against the pinned Mermaid: `graph`, `end`, `subgraph`,
  `flowchart`, `class`, `classDef`, `style`, `click`, `linkStyle`, `call`,
  `href`, `interpolate`). `renameReservedFlowchartIds` (diagramPolicy) renames
  such an id locally before rendering, so no repair call is spent; the contract
  also tells the model not to do it. The Source tab, Copy and the `.mmd` export
  hand out the renamed source, so what the user takes away draws elsewhere.
- **Unreadable drawings.** The first round produced 7–11 node diagrams up to
  1,800 px wide, shown at 31–77% of natural size in the 85% answer column. Three
  changes brought the same questions to 50–100%: the drawing spans the full row
  (prose keeps its 85% measure, so nothing rewraps), Mermaid's spacing is
  compact, and the contract says the card is small (short labels, no path
  longer than five nodes, at most six sequence participants).
- **A repair that fixed one error of two.** Mermaid reports one parse error at a
  time; shown only that message the model fixed that line and left a second
  broken line in place. The repair prompt now says the message names only the
  first problem; the live repair then fixed both, three runs out of three.
- **A repair answer of `undefined`** left the card on "Fixing diagram…" forever.
  It is now a failed repair with the normal fallback.
- **Speed.** DeepSeek's whole answer arrives within two to five seconds of the
  question, so Mermaid's first load mattered: it is now started at idle priority
  when the user first asks for an answer, not when the fence opens.
- **Not a design turn, by decision:** "Walk me through the request flow when a
  user logs in with Google OAuth" gets a prose answer. Asking for the picture
  ("draw it as a sequence diagram") gets one.
