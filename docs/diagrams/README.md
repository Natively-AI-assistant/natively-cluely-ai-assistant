# Diagrams and charts

When a turn asks for a system design, a diagram, a data model, a chart or a
calculation that is clearer drawn, Natively answers with a short explanation
and one visual block **in the same generation**, and draws that block as a card
as soon as its closing fence arrives — while the rest of the answer is still
streaming.

There are three kinds of block, each with its own fence tag:

| Tag | Holds | Drawn by |
| --- | --- | --- |
| `mermaid` | Mermaid source | the pinned Mermaid (11.17.2), sanitised, shown as an image |
| `natively-chart` | one JSON object: a typed chart | `chartSpec.mjs` (checks, calculations) → `chartSvg.mjs` (SVG) — no Mermaid, no chart library |
| `natively-diagram` | one JSON object: a notation model (`chen-er`, `automaton`) | `chenEr.mjs` (own SVG) · `automaton.mjs` (checked, then compiled to Mermaid this app writes) |

A comparison that is clearer as rows and columns is an ordinary Markdown table.

This document is the flow map, the usage note and the reference for the pieces
in `src/lib/diagram/`, `src/components/diagram/` and
`electron/services/diagram/`. The first half covers system-design diagrams (the
original feature); **[The nine-mode catalog](#the-nine-mode-catalog)** covers
everything added on top of it.

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

More to try, in any mode (each is an explicit request):

- **“Draw an ER diagram for customers, orders and payments”** — crow's-foot
  data model, read back in words under the picture.
- **“What would revenue look like from $10,000 at 5% monthly growth over three
  months?”** — a Forecast card whose numbers the app computed (10,500 · 11,025 ·
  11,576.25). Then **“make it 3%”**.
- **“Construct the DFA over a and b that accepts strings ending in ab”**,
  **“Draw customers and orders in Chen notation”**.
- A chart card has **Chart / Data** tabs and exports SVG, PNG, CSV and JSON.

Switch: **Settings › Intelligence › Notes & answers › Diagrams and charts**
(default on; off shows every visual block as plain code). Env override:
`NATIVELY_SYSTEM_DESIGN_DIAGRAMS=0|1`.

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

- **Mode never decides a system design.** Mode sets voice and sources; the
  words of the turn decide whether it is a design task. (For the wider catalog
  a mode decides exactly one thing: whether a task that only *implies* a visual
  gets one unasked. See below.)
- **Mermaid is not code.** A diagram turn is never a coding answer type: no
  coding template, no execution, no verification spec, no “verified” badge.
- **Swimlanes and trees are flowcharts with a layout.** “Show the swimlanes
  for …”, “put it in swim lanes”, “show the org structure as a tree”, “show
  the hierarchy”: `view: 'flowchart'` with `layout: 'lanes' | 'tree'`. Only
  when a verb that shows or draws governs it; “decision tree”, “class
  hierarchy” and “org chart” keep their own views.
- **A chart as a table is a copy.** “Show the chart as a table”, “can I see
  that as a table?”: a table view whose parent is the chart, filled from the
  values the app computed. A chart word gives way to a different kind of
  visual it is being turned into; one chart as another (“the funnel as a bar
  chart”) stays an edit of the chart.
- **A visual named inside another thing's phrase is one that exists.** “Create
  a ticket about the diagram”, “a summary of the chart”, “a copy of the
  timeline” draw nothing. A visual wanted in a document (“a pie chart in the
  QBR deck”, “in the board pack”) is a remark about the document.
- **Other languages.** Spanish, Russian, Chinese and Japanese are read by
  `diagramRequestI18n.mjs`, only where the English rules found nothing. They
  are much weaker than the English rules: on unseen sentences they miss
  between a quarter and well over a third of real requests and follow-ups
  (see “How well the decision rules do”).
- **Follow-ups need a design on the table.** Without one, “add Redis…” is an
  ordinary turn.
- **The router's keyword verdict does not override a design follow-up.**
  `AnswerPlanner` reads “queue”, “cache” and “add” as coding; with a design on
  the table it asks `isDesignFollowUpTurn` and routes the turn as
  `system_design_answer`, so every later stage agrees.
- **A visual is asked for by the mood of the sentence, not by its words.** It
  is asked for by an instruction (“draw the auth flow”, “hey, first, draw …”,
  “someone draw the architecture please”), by a request (“can you chart revenue
  by month”, “would you mind drawing …”, “could that be drawn as a state
  machine?”, “I'd like a diagram”, “how about a diagram?”), or by a bare
  fragment that is nothing but the thing (“timeline of the French Revolution”,
  “Gantt chart for the release”, “with a diagram please”). A statement that
  mentions one is not a request (“normally we just show the customer a bar
  chart”, “the org chart is outdated”, “I like the chart you sent”); neither is
  an idiom (“draw up the contract”, “draw the line”), a question about a person
  (“can you illustrate how you handled conflict?”), a question about whether
  one exists (“do we have a Gantt chart for this?”), or what was said before
  the request (“we are on a tight timeline, can you start Monday?”).
- **A task implies a visual only when the task is what is asked.** “Where are
  deals dropping out?” draws the funnel in Sales. “Who owns the rollout plan?”,
  “why is the schedule slipping?” and “where is the schema documented?” ask
  about the thing and get an answer in words. Never on a coding route, never of
  a person (“you”), never when a short answer was asked for.
- **A design ask designs software.** “Design a URL shortener”, “design Twitter”,
  “how would you architect …”. Not “design the checkout page”, “design the app
  icon” (a designer's work), not “how do you build a sales pipeline” (people),
  and not a sentence that only contains the words (“I work in product and
  design systems for a living”).
- **A follow-up needs evidence that it is about the artifact.**
  - *Strong* (works even when the conversation has moved on): the sentence
    names the artifact (“the diagram”, “the chart”), one of its own multi-word
    names (“the notification queue”), a value it holds (“is 5% realistic?”,
    “where does 10,000 come from?”), or one of its component words in a design
    context — an edit of it, a word a design is discussed in, or a how/why
    question (“why do we need the queue?”, “take out Stripe”). One common word
    is not enough: “when is the payment due?”, “did the email go out?”.
  - *Weak* (only while it is in focus): an edit said in a design word (“add a
    cache”, “make it multi-region”, “we should also have a CDN”), a verb done
    to the drawing itself (“simplify it”, “halve it”), a how/why question of
    “this” (“how does this scale?”, “walk me through it”), or a question that
    is asked of designs (“where's the bottleneck?”, “what are the tradeoffs?”).
    “Move it to Thursday”, “make it quick”, “add that to the notes”, “does that
    work for everyone?” are none of these.
  - With a chart in focus, a change to an input said as a change redraws it
    (“and at 8%?”, “start from 25,000 instead”, “go out two years”); a sentence
    that merely contains a number or a duration does not (“the contract is for
    12 months”).
  - A sentence about a person or a calendar is never a follow-up (“is this a
    remote role?”, “can you hear me?”, “move it to Thursday”) — but “walk me
    through it” and “I want to add a cache” are not about the speaker.
- **The design is in focus only while the conversation is on it.** A turn that
  follows up on it keeps it there — and so does an answer that talks about its
  own parts by name, whatever the question was. An answer with no visual to a
  turn about something else moves it to the background, where only a strong
  reference reaches it.
- **A coding question after a design stays a coding question.** “Merge two
  sorted arrays” is not rerouted because a queue was drawn ten minutes ago; on
  a coding route a component word is a variable unless a structural verb acts
  on it (“replace Stripe with Adyen”).
- **The router saying “system design” never restarts a design that is on the
  table.** Only the words of a fresh ask do (“design a parking lot”).
- **Every follow-up contract has a way out.** The decision is made from words;
  the model sees the conversation. A follow-up contract ends with: if the turn
  is plainly about something else, ignore the contract and the quoted design and
  answer normally.

## The nine-mode catalog

Everything in this section is decided by the same resolver and travels in the
same contract as a system-design diagram. Nothing is a second model call.

### The request descriptor

`resolveDiagramRequest` returns, besides the fields above:

| Field | Values | Meaning |
| --- | --- | --- |
| `view` | `architecture` `sequence` `flowchart` `state` · `decision` `er` `class` `dependency` `responsibility` `mindmap` `timeline` `gantt` · `matrix` · `chart` · `chen` `automaton` | which visual |
| `intent` | `explain` `compare` `reconstruct` `propose` `calculate` `forecast` `update` | what the visual is for — separate from the answer type the planner chose |
| `chartIntent` | `forecast` `breakeven` `funnel` `trend` `breakdown` `comparison` `quadrant` `function` `generic` | for `view: chart` |
| `basis` | `proposed-design` `meeting-reconstruction` `source-reconstruction` `evidence` `observed-data` `calculated` `scenario` `illustrative` | what the content may rest on |
| `mode` | one of the nine template ids, `custom`, `unknown` | the mode's **template**, never its display name |
| `explicit` / `contextual` | booleans | asked for · implied by the task in a mode where it is relevant |
| `inputs`, `missingInput` | see [Calculations](#calculations-the-app-does-the-arithmetic) | what a calculation needs and which of it nobody stated |

Precedence, first match wins:

1. An explicit request or output preference (“draw…”, “as a chart”, “no diagram”, “just the source”).
2. A follow-up on the artifact on the table (“make it 3%”, “why is the last month higher?”).
3. A task that names or implies a visual.
4. Mode relevance — only for (3) when the visual was *implied*, not asked for.

What counts as asked for:

- A visual verb where a verb goes: “draw”, “show”, “plot the funnel”, “chart the
  response times”, “can you graph our signups”, “model users, orders and
  payments”. A noun is not a verb: “did you see the chart I sent?” asks for
  nothing.
- A notation named outright (“DFA for strings ending in ab”, “ER diagram for
  customers and orders”) — except in a question *about* the thing (“is the ERD
  up to date?”, “what is a DFA?”).
- “…with a diagram”, “…as a flowchart”.

What never counts:

- A catalog word inside a system-design ask names the system: “Design Twitter's
  home timeline”, “a stock chart service”, “a funnel tracking system”, “a class
  diagram editor” stay architecture diagrams. The exception is a data or object
  model that is itself the thing designed (“design the data model for…”).
- “graph” as a data structure, “plots” in a coding question, “chart a path”.
- A word that merely names a visual does not *imply* one: “is the forecast
  still on track?” gets a yes or a no. Only task phrases imply (“where are deals
  dropping out?”, “when do we break even?”).

`tests/diagram/mode-catalog.mjs` pins all of this: 76 catalog requests,
21 questions that want words, 49 system-design asks containing a catalog word,
and 28 ordinary questions containing one.

### What each mode makes relevant

Any mode draws any supported visual **when asked**. The table is what a mode
draws for a task that only implies it. Lecture and Seminar are explicit-only
(or from an accepted action card): a lecture is being listened to, not
annotated.

| Mode | Implied visuals it will draw | Representative requests | What the mode adds to the contract |
| --- | --- | --- | --- |
| General | process, decision tree, comparison table, mind map, timeline, schedule, dependency and responsibility maps, charts | “Map how a request gets approved” · “Organize the ideas we discussed” · “Show how the budget is split” | nothing (a custom mode behaves as General) |
| Looking for work | timeline, process, comparison table, schedule, lifecycle, charts | “Summarize my career progression” · “Map my experience to this job” · “Plan interview preparation” | facts come only from the résumé or profile and what the user said; never an invented title, date, employer or number; the spoken answer comes first. (A line addressed to “you” is the interviewer speaking: it is answered aloud, not drawn.) |
| Technical Interview | state, process, **ER (crow's foot)**, **class**, **Chen**, **automaton**, comparison table. (No chart unasked: “what about when the array grows by 50%?” is not a forecast. An architecture or a sequence comes from a design ask, in any mode, not from this table.) | “Model users, orders, and payments” · “Design the objects for a parking lot” · “Construct this DFA” | nothing |
| Sales | process (current → proposed), **forecast**, **break-even**, **funnel**, trend, responsibility map, decision tree, schedule, comparison table | “What would revenue look like at 5% monthly growth?” · “Where are deals dropping out?” · “Show the expected savings and break-even” | claims, prices and results only from the product material and the conversation; never an invented price, uplift or commitment; the customer's process as described, the proposal marked as proposed; a projection is a scenario, never a promise |
| Recruiting | evidence table, timeline, process, funnel, responsibility map, schedule | “Map this candidate's experience to the role” · “Which requirements need follow-up evidence?” | evidence only from the candidate's own material and the interview, requirements only from the job description; show what is still unknown; no scoring of personality, emotion, protected characteristics or overall suitability |
| Team Meet | dependency map, schedule, process, decision tree, ER, class, timeline, responsibility map, comparison table, charts | “Show which work blocks which” · “Show release milestones” · “Compare effort and impact” | reconstruct what was said; decided, proposed, rejected and open kept distinct; an owner or date shown as unknown rather than guessed |
| Lecture | *(explicit only)* mind map, process, lifecycle, sequence, ER, class, automaton, function plot, timeline | “Organize these concepts” · “Show the DFA or NFA for this language” · “Plot this equation” | the lecture's own terms and notation; anything added is labelled an illustration |
| Seminar | *(explicit only)* method flowchart, framework map, claim-and-evidence map, comparison table, result chart, study schedule | “Draw the method described in this paper” · “Compare the baselines and proposed method” | only what the reference material supports, with its citations; a missing detail stays missing; general knowledge is labelled and never presented as the paper's result |
| Call Center | decision tree, case status, responsibility map, resolution journey, timeline, bill and trend charts | “Walk me through diagnosing this issue” · “Explain the refund or eligibility path” | policy steps, eligibility, amounts and timelines only from the authorised material and the customer's verified details; a check is “done” only if done on this call; never an invented exception, refund or deadline |

Mode identity is the mode's `templateType`, validated against the mode policy
registry (`registerVisualModeProvider`, registered by `ModesManager`). A user
mode called “Sales” built on the General template is `custom`: it gets General's
relevance and no Sales note.

### Notation and family matrix

| Visual | How it is drawn | Notation it actually carries | Not carried |
| --- | --- | --- | --- |
| Architecture, process, decision tree, dependency map, responsibility map | Mermaid `flowchart` | boxes, decisions, labelled arrows, groups | BPMN pools/gateways/events; formal DFD symbols |
| **Swimlanes** | Mermaid `flowchart LR`, one `subgraph` per lane (`layout: 'lanes'`) | lanes titled with who does the work, steps inside their lane, labelled handoffs across lanes | BPMN pools, message flows, events |
| **Tree / hierarchy** | Mermaid `flowchart TD`, one parent per node (`layout: 'tree'`) | a root, levels, parent→child arrows | cross links, weights |
| Sequence | Mermaid `sequenceDiagram` | participants, sync/async messages, alt/loop/opt | — |
| State / lifecycle | Mermaid `stateDiagram-v2` | states, transitions with triggers, start/end, composite states | — |
| **ER, crow's foot** | Mermaid `erDiagram` | exactly-one `\|\|`, zero-or-one `o\|`, zero-or-many `o{`, one-or-many `\|{`; **solid line = identifying, dashed = non-identifying**; PK / FK / UK attribute keys | EER specialization/generalization, categories (unions) |
| **ER, Chen** | own SVG from a checked model (`chenEr.mjs`) | entity rectangle, **weak entity** double rectangle, relationship diamond, **identifying relationship** double diamond, attribute oval, **key** underlined, **partial key** dashed underline, **multivalued** double oval, **derived** dashed oval, composite attributes, **total participation** double line, 1 / N / M cardinalities, roles | EER; (min,max) notation; n-ary relationships above three participants |
| **Class** | Mermaid `classDiagram` | visibility, attributes, operations, inheritance, realization, composition, aggregation, association, dependency, multiplicities | object diagrams, packages, OCL |
| **DFA / NFA** | checked model (`automaton.mjs`) → Mermaid flowchart this app writes | start arrow, states, **double-circle accepting states**, labelled transitions, ε for an NFA | PDA, Turing machines, Mealy/Moore outputs |
| Mind map | Mermaid `mindmap` | a root and branches | — |
| Timeline | Mermaid `timeline` | periods and events, sections | — |
| Schedule | Mermaid `gantt` | tasks with dates or durations, `after` dependencies, milestones, sections (today marker off) | resource levelling, critical path |
| Comparison / evidence table | Markdown table | rows, columns, a status column | — |
| **A chart as a table** | Markdown table copied from the values the app computed (`chartValuesBlock`) | exactly the rows the chart draws and the CSV export writes | — |
| **Charts**: line, bar, grouped bar, stacked bar, scatter, waterfall, heatmap, funnel (stage counts), pie, quadrant | typed JSON → own SVG | see [Charts](#charts-a-typed-payload-not-chart-code) | dual axes, log scales, error bars, box plots, area charts, maps, Sankey |

**Refused on purpose** (shown as “This diagram type is not supported here.”
with the source one tap away, never silently turned into something else):
Mermaid `pie`, `xychart-beta`, `quadrantChart`, `sankey-beta`, `journey`,
`kanban`, `requirementDiagram`, `C4*`, `architecture-beta`, `gitGraph`,
`block-beta`, `packet-beta`, `zenuml`. Anything with numbers goes through
`natively-chart`, where the numbers are checked.

An unsupported notation is never passed off as supported: a request for an EER
specialization, a BPMN diagram, a circuit or a formal DFD gets what the contract
tells the model to say — that this notation is not drawn here — plus the closest
supported form *named as such* (a crow's-foot ER, a process flowchart) or prose.

Checks the notation itself gets, beyond “it parses”:

- **Crow's foot** (`erSemantics.mjs`): every relationship is read back in both
  directions in the card's alt text (“Each ORDER relates to exactly one
  CUSTOMER; each CUSTOMER relates to zero or many ORDER”), and a solid line into
  a child that has its own primary key — or a dashed line into a child keyed by
  its parent — is pointed out under the drawing.
- **Chen** (`validateChenEr`): a weak entity needs an identifying relationship
  to an owner and total participation in it; a partial key belongs only to a
  weak entity; an identifying relationship needs a weak participant; a
  constraint nobody stated is listed under the drawing as “Not stated, so not
  drawn”, never guessed.
- **Automata** (`validateAutomaton`): a DFA with two targets for one symbol, an
  ε-transition in a DFA, a symbol outside the alphabet or an unknown state is
  refused with the reason. An incomplete DFA is drawn with a note. The Source
  tab shows the transition table.

### Charts: a typed payload, not chart code

````
```natively-chart
{"v":1,"type":"line","title":"Monthly revenue at 5% net growth",
 "x":{"label":"Month"},"y":{"label":"Revenue","unit":"USD"},
 "compute":{"kind":"compound_growth","baseline":10000,"ratePercent":5,"period":"month","periods":3},
 "assumptions":["Net growth stays at 5% every month"]}
```
````

Every series (or the chart, for the single-series types) says what its numbers
**are**, and each status has a price:

| `status` | Requires | Shown as |
| --- | --- | --- |
| `observed` | a `source` | plain line/bars; the source printed inside the image |
| `calculated` | a `derivation`, or a `compute` block | “Calculated” badge |
| `scenario` | `assumptions` | “Scenario” badge, dashed line / hatched bars from the first projected value |
| `illustrative` | — (the user asked for an example) | “Illustrative” badge |

A payload with no status is refused, with two narrow exceptions: naming a source
*is* the claim that the data is observed; and a calculation that calls its own
input made up (“illustrative $10,000 baseline, not your actual figure”) is
stamped Illustrative whatever else it says.

The adapter also keeps the picture honest, and records each correction in the
card's notes: bars start at zero unless `y.min` comes with a `y.minReason`; a
line over unordered categories becomes bars; a single observation becomes a bar;
a pie needs a `whole` and non-negative parts or becomes bars, and is refused if
its parts do not add up to a stated total; stacked bars refuse negative values;
series that share an axis must share a unit; a shaded band is a scenario range
unless it is declared a confidence interval with its level and source; a funnel
is labelled “Stage counts”, and a later stage larger than an earlier one, or a
cohort that was not stated, is said under the drawing.

#### Calculations: the app does the arithmetic

The model supplies **inputs**; `chartCompute.mjs` (`CALC_VERSION = 1`) computes
the values. A model never types a computed number into a chart.

| `compute.kind` | Inputs | Refuses |
| --- | --- | --- |
| `compound_growth` | `baseline`, `ratePercent` (net, per `period`), `period`, `periods` | a missing input (names it); a rate given as a fraction *and* a percent; a rate period that differs from the chart period; a churn figure alongside a rate already called net |
| `growth_with_churn` | `baseline`, a gross growth rate and a churn rate per `period`, `periods` | a missing input (names it) |
| `cumulative_net` | `periodValues` (or one value and `periods`) | a missing input |
| `break_even` | `initialCost`, `periodSaving`, `period`, `periods` | a missing input. Reports “Paid back in month 5.” or “Not paid back within N months.” |
| `function` | `expression` in one variable, `from`, `to` | anything but numbers, the variable, `+ − × ÷ ^`, parentheses and `sin cos tan exp ln log sqrt abs` (own parser — no `eval`) |

A funnel's stage conversion (each stage as a percentage of the previous one) is
computed by the chart adapter itself. `percentageChange` (refuses a zero
denominator), `percentagePointChange` and `weightedPipeline` (no default
probability) are in `chartCompute.mjs` and tested, but no chart requests them
yet.

The Sales fixture: $10,000 at 5% net monthly growth → **10,500 · 11,025 ·
11,576.25**. “Change growth to 3%” changes that one input (→ 10,300 · 10,609 ·
10,927.27); the model is told to change nothing else, and the previous chart
stays on screen until the new one has drawn. Rounding is half away from zero at
two decimals; each period is computed from the unrounded baseline
(`baseline × (1 + rate)^t`), never from the previous rounded value.

**A calculation whose input nobody stated is not drawn.** Three layers:

1. *Before the model is called.* The session registers a reader for what was
   said (`registerConversationTextProvider`). If the request states no starting
   value / rate / period (or, for a break-even, no amounts) and none appears in
   the conversation — digits, “$12.5k”, or spelled out by speech-to-text (“ten
   thousand dollars”) — the contract ends with a `CHECKED BEFORE THIS TURN` rule
   and the turn repeats it; no reference example is attached, so there is no
   number to borrow. The model may still use a value it finds in the material
   of the turn (a document the reader cannot see), and must say where it is.
2. *In the payload.* `"baseline": null` — or any missing input — is refused by
   the adapter: the card reads “This forecast needs a starting value.” and
   offers the payload. No repair is requested: a model could only invent it.
3. *In the picture.* A baseline the payload itself calls illustrative is stamped
   Illustrative.

What this does **not** do: check that a stated number is the *right* number.
Provenance is what the payload declares, plus the “was any such value stated”
check above; it is not matched value by value against the transcript.

### Facts versus proposals

| `basis` | When | The model is told |
| --- | --- | --- |
| `proposed-design` | a design, a data model, general knowledge (“a timeline of the French Revolution”) | this is a proposal; do not present it as agreed |
| `meeting-reconstruction` | “…we discussed”, an accepted action card | only what was said; unsettled things carry “(proposed)”, “(rejected)”, “(unknown)” |
| `source-reconstruction` | “from the doc / this paper / my résumé / the screen” | only what the evidence shows; if it is not there, **no block** |
| `evidence` | a timeline, evidence table, dependency, responsibility map or schedule about *these* people and *this* work (the five people-and-work modes, or “my / our / this …” in any mode) | facts only; general knowledge is marked “(suggested)”; with no facts, **no block** — say what is missing |
| `observed-data` | a chart of real numbers | every value from the conversation or the evidence, with its source; otherwise do not chart |
| `scenario` | forecast, break-even | arithmetic on stated inputs; never a prediction or a promise |
| `calculated` | a function plot | the formula alone |
| `illustrative` | “show me an example…” | made-up values, labelled as such |

For the fact bases the block is “required when the facts are present and
forbidden when they are not”. As a last line of defence, a finished flowchart,
timeline or mind map in which **every** node is a placeholder (“Method
(unknown)”, “Dates not provided”) is not drawn at all — not in the overlay, not
in saved answers, not on the phone — and never becomes the artifact on the
table. One real node keeps the drawing.

### The artifact on the table

The “active design” is now any visual: its record carries `artifact`
(`mermaid` | `chart` | `notation`) and the turn block quotes it under its own
fence tag (`<active_design view="chart" version="2">`). Lineage requires the same
kind: “make it 3%” after a forecast is version 2 of that chart; a chart after an
architecture diagram starts a new lineage. Explain, update, another view and
refine work as for a design. With a chart on the table, a new rate or horizon
(“and at 8%?”) redraws it. A request for a *different kind* of visual of what is
on the table (“show it as a table”) is a fresh artifact that is handed the old
one to work from; a different kind of visual of something else (“add a
comparison table”) is simply a fresh request.

Refine (“shorten”) puts back any visual block the model changed, unless the
refinement was about the numbers or the structure (“add a cache layer”, “use
Kafka instead”, “redo it at 8%” — but not “make it 50% shorter”). Blocks are
matched by content, not position: a diagram returned in an untagged fence is
retagged in place rather than duplicated, and a new chart placed above the kept
diagram is left alone.

### Action cards

`DynamicActionDetector` offers a visual only when the structure or the data is
in the conversation, under the real mode ids: *Map the workflow*, *Draw the data
model*, *Plot these figures*, *Compare the scenarios*, *Show the dependencies*,
*Map the troubleshooting steps*, *Show the timeline*, *Organize the concepts*.
They never outrank a mode-specific trigger. Accepting one is an explicit request
whose basis is the conversation — it is resolved against the conversation, never
against the design that happens to be on the table.

Each offer needs the structure itself, not one of its words: a workflow needs an
opening step and two more step markers (not “first of all … then”); dependencies
need work waiting on work (not “it depends on the weather”); a timeline needs
three years, or two with a dated event (“joined … in 2018 and moved to … in
2023”); figures need a series of something measured (three figures, or two tied
to named periods — not “$50 a month or $500 a year”, not “$5 for coffee, $10
for lunch”); a scenario needs a rate or an amount (not “what if we push the
call to 2 pm”). *Structure system design* is offered in the technical interview
mode when a design is actually asked for (“Design a URL shortener.”). With
“Diagrams and charts” switched off, no card offers a drawing.

### Routes

Every route in the table under [The contract and where it
travels](#the-contract-and-where-it-travels) carries the catalog the same way.
Two things differ from a system design:

- A catalog visual that the keyword planner reads as **coding** (“model users,
  orders and payments”) is moved to the neutral answer route — never streamed,
  validated or verified as code, and never sent down the system-design route.
- The original four views (`architecture`, `sequence`, `flowchart`, `state`)
  are told exactly what they were told before the catalog existed; the catalog
  body is used only for the new views.

### Exports

| Artifact | SVG | PNG | Source | Data |
| --- | --- | --- | --- | --- |
| Mermaid diagram | ✓ | ✓ | `.mmd` | — |
| Chart | ✓ | ✓ | — | `.csv` (the table, then status, assumptions and sources; formula-injection guarded, BOM + CRLF) and `.json` (the payload as written **plus** what was computed and `calc.version`) |
| Chen ER, automaton | ✓ | ✓ | — | `.json` (the checked model) |

Copy on a chart copies the CSV. Formats are validated again in the main process
before a byte is written.

### Prompt budget

One contract per request, holding the rules of the **one** kind the turn needs,
the mode note when something is drawn, and at most one reference example of the
same view (22 in the library; 0–2 by `NATIVELY_DIAGRAM_EXAMPLES`). Measured on
the wire against DeepSeek: the system prompt is about 27,100 characters with a
catalog contract and 23,200 without (median; largest seen 30,300). The signals
that select the text are bounded enums, so the registered system prompt stays
cacheable; nothing from the question or the conversation is in it.

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
| Answer button, spoken question (Direct Assist off) | the overlay sends `{ skipSystemPrompt, liveQuestion }`; `gemini-chat-stream` resolves the turn with the session's design, puts the design block on `context` and hands the decision to the transport as `routeOptions.diagramSignals`, which the self-composed prompt uses instead of deciding alone. The meeting search (`rag:query-live`) steps aside for a drawing turn that was asked for. A drawing OF the conversation (“draw what we discussed”) is also handed the meeting's recent speech (`withMeetingSpeechForDiagramTurn`: about ten minutes, 6,000 characters, the assistant's own suggestions left out), and only where the provider-scope policy lets the transcript be sent |
| A question about a PAST meeting (`MeetingChatOverlay`, `skipSystemPrompt` without `liveQuestion`) | fresh asks only: the live session's design is not that meeting's |
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
   sequence, state, class, ER, mind map, timeline, gantt), size limits, no
   remote images/icons, no script URLs, no active HTML. Config directives,
   frontmatter and click/link statements are *removed from what is rendered*;
   the stored source is untouched. A chart or notation block is checked by its
   own adapter instead (`compileVisualSource`): schema, limits, status rules,
   calculation inputs.
2. **Parse** — Mermaid's own parser, same pinned version that renders.
3. **Render** — layout and SVG.
4. **Output** — DOMPurify (SVG profile) + `isSafeDiagramSvg`.

A diagram that draws is a *drawable* diagram. Nothing here claims the
architecture is correct. Chart and Chen images are generated by this app as
text-only SVG (every label escaped) and shown the same way: an `<img>` with a
data URL, never markup in the page.

### Repair

Only for a **completed** block that failed stage 2 or 3, only on the newest live
answer, and at most **one** automatic attempt per diagram (plus a cap of 6 per
10 minutes across all diagrams, enforced in the main process). The request
carries the diagram and a bounded parser message — not the meeting, not the
prose. The repaired block must itself draw before it replaces anything, and it
replaces only the exact broken source. A cut-off or cancelled block, a policy
rejection, a replayed answer and a stopped answer never trigger one. “Try to
fix” on the fallback card is a deliberate manual attempt; manual attempts have
their own cap (20 per 10 minutes), and at most three repair calls run at once.
A repair that lands while the answer is still being revealed is kept (the
repaired source is re-applied to every later frame and to the sealed row). A
diagram is transcript-scope data: with that scope withheld from cloud providers
it is repaired by a model on this device or not at all.

Post-answer repairs and regenerations of the *answer* (not the diagram) are
capped on their prose only: a fenced block does not count towards the cap, a
stream is never stopped inside one, and a result that ends inside an unclosed
block is discarded rather than replacing a complete answer.

Repair is for Mermaid syntax only. A chart or notation block that fails its
checks is never sent to a model — a missing input or a contradiction is not
something a model can fix without inventing — and shows its reason instead.

## State: the design on the table

`src/lib/diagram/activeDesign.mjs`, one instance on the shared `SessionTracker`
— so typed chat, What to Answer, Auto Answer, follow-ups and the phone all read
and write the same design.

- Set by any recorded answer that contains a valid diagram (the last valid
  block — except that an answer drawing the system and then a view of it keeps
  the system). An answer without one keeps the design but, unless the turn was a
  follow-up on it, moves it out of focus (see the rules above).
- An update is a **new version** (`design-1.v2`, parent `design-1.v1`); earlier
  answers are never rewritten.
- Cleared on a new meeting, a mode switch and a session reset; expires after 30
  minutes without a turn about it (a follow-up refreshes the clock).
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

`src/lib/diagram/diagramExamples.mjs`, 22 reviewed examples: six system designs
and sixteen for the catalog (ER, class, forecast, break-even, stage counts,
observed trend, troubleshooting tree, career timeline, rollout schedule, mind
map, blockers, buying roles, requirements-to-evidence table, research method,
Chen, DFA). One is attached to a fresh turn by default (0–2 via
`NATIVELY_DIAGRAM_EXAMPLES`), chosen locally by view, mode and topic words — no
embeddings, no extra model call. A catalog view only ever takes an example of
its own view. A calculation whose input was stated nowhere takes none, and the
forecast example's numbers are deliberately unlike anything a user is likely to
say (a model once borrowed a round 10,000 from it).

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

A catalog entry has `fence` (`mermaid` | `natively-chart` | `natively-diagram` |
`table`), `body` instead of `mermaid`, and optionally `modes` and `chartIntent`.

To add one: append the entry, bump `DIAGRAM_EXAMPLES_VERSION`, run
`npm run test:diagram`. The suite fails if the example does not pass its own
checks (policy or adapter), exceeds the size the contract asks for, uses a
number that is not in its own question, presents a number as a requirement, or
does not render.

## Timing

Content-free marks per answer (`diagramTimings.mjs`): request accepted, first
token, first text visible, block complete (receipt), block revealed, diagram
visible, answer complete, plus parse/render/cold-load milliseconds and the
repair outcome. Read them in a running app with
`window.__nativelyDiagramTimings()`.

Measured 2026-10-01 with `npm run test:diagram:live` (DeepSeek `deepseek-flash`
through the real engine, 40 turns: 14 system-design, 19 catalog, 6 controls, and
one refinement; then every recorded stream replayed into the real overlay in
headless Chromium on an M-series Mac). One provider call per turn in every case.

| | p50 | p95 |
| --- | --- | --- |
| First token (all 40 turns) | 0.78 s | 1.25 s |
| First token — turns with no visual (controls) | 0.75 s | 1.18 s |
| Visual block complete on the wire (27 turns) | 1.41 s | 2.06 s |
| Closing fence → drawn on screen (21 first drawings) | 0.23 s | 0.47 s |
| Visual on screen, from the question | 1.51 s | 2.21 s |
| Answer complete — system design | 1.99 s | 5.22 s |
| Answer complete — catalog | 1.52 s | 2.31 s |

Charts and Chen diagrams draw in 30–200 ms after their fence (no Mermaid);
Mermaid families take 120–540 ms. First token is the same with and without a
visual contract. The draw times are this machine's headless Chromium, not the
app window's; the token times are the provider's on that day.

## Tests

| Command | What it runs |
| --- | --- |
| `npm run test:diagram` | the pure modules, the main-process tests, and the wiring and render checks below (not card, overlay or live) |
| `npm run test:lib` | pure modules (1,038 tests under `src/lib/diagram`): parser (incl. random chunk partitions), policy, resolver, contract, examples, active design, repair, refine, viewport, stream decisions, timings — and for the catalog: `chartCompute` (the fixtures above, rounding, every refusal), `chartSpec` (statuses, corrections, limits, CSV), `notation` (Chen, automata, crow's-foot reading), `visualCatalog` (every catalog request in every mode, negatives, system-design asks, missing inputs, contract text and budget), `visualBlocks` (the three fence tags through the stream parser) |
| `node --test electron/services/__tests__/VisualCatalogWiring2026_10_01.test.mjs` | built bundles: mode identity from the template, one contract per request in every mode persona, planner route, session artifact, the conversation reader, Phone Mirror (charts and Chen drawn in main), JSON/CSV export, action offers |
| `node --test electron/services/__tests__/DiagramReviewFixes2026_10_01.test.mjs` | built bundles, one block per defect found in the 2026-10-01 review: focus and the toucher, coding questions after a design, action cards, Brainstorm, fence-aware repair caps, the final clean-up, the knowledge intercept, long-prompt replay, Direct Assist (request-only decision, small-model budget, withheld history), warn-once |
| `npm run test:diagram:wiring` | real engine + planner + composer, provider stubbed, V3 on and off: the dispatched prompt per route. `e2e-diagram.cjs` (system design, 78 checks) and `e2e-visual-catalog.cjs` (catalog, 137 checks: forecast → “make it 3%” → explain → refine, missing baseline, per-mode requests, custom modes, Direct Assist, feature off) |
| `npm run test:diagram:render` | the renderer in real Chromium with the pinned Mermaid: every Mermaid example, the new families and their fix-ups, the refused families, chart and Chen SVG as images |
| `npm run test:diagram:card` | the card component in real Chromium (92 checks): streaming, fit, zoom, export, theme, repair, updates — and chart, Chen, DFA and ER cards: Chart/Data tabs, the data table, CSV/JSON export, missing input with no repair, hostile labels, placeholder-only diagrams |
| `npm run test:diagram:overlay` | the real overlay component (Vite dev server + Playwright Chromium, `electronAPI` stubbed, 64 checks): a streamed answer draws its card mid-stream, final-text replacement, discard, cut-off, code and mixed answers, a chart then its update, a refused chart, Chen, DFA, chart beside code, placeholder-only diagram, feature off. Needs a Playwright Chromium on the machine; exits 2 when there is none |
| `npm run test:diagram:live` | **opt-in, calls a real model** (needs `DEEPSEEK_API_KEY` in `.env`; not part of `test:diagram`). The real engine and the real `LLMHelper` ask DeepSeek the system-design set (12 questions, 3 follow-ups, a refinement, 3 controls, one repair) and the catalog set (`--suite=catalog`: 16 scenarios across all nine modes with what was said beforehand, 3 controls), and **judges each turn from the committed answer** — the computed values, the stage counts, whether the DFA accepts exactly the right strings, whether nothing was drawn when nothing should be. Every token is recorded with its arrival time, then replayed into the real overlay to prove each visual is drawn. Prints the timing table above |

## Limits

- Rendering cannot be interrupted mid-layout (Mermaid lays out on the calling
  thread). Work is bounded by the policy limits instead; the wait has a timeout
  and a late result is cached, not shown.
- Mermaid's numeric and beta families (pie, xychart, quadrant, sankey, journey,
  kanban, requirement, C4, architecture-beta, …) are rejected by policy; see the
  notation matrix for what is drawn instead and what is not drawn at all.
- **Not available:** EER specialization/generalization; BPMN; formal DFD;
  circuits; UML beyond class, sequence and state; pushdown automata and Turing
  machines; n-ary Chen relationships above three participants; dual-axis,
  log-scale, box-plot, error-bar and area charts; maps.
- **No hover tooltips or interactive chart elements.** Every visual is an
  `<img>`; exact values are in the labels, the Data tab and the alt text.
- **Provenance is declared, not proven.** A chart's source and a table's
  “Source” column are what the model wrote. The app checks that a status is
  backed (a source, assumptions, a derivation), that calculation inputs were
  stated *somewhere*, and nothing more.
- **The “was it stated” check reads English number words and digits.** A
  starting value spelled out in another language is not recognised; the model is
  then told none was found but may still use one it sees in the turn.
- **Mode relevance is a fixed table**, not learned: a task phrase the catalog
  does not list draws only when asked.
- A tall ER or class diagram is fitted to the card and can be small at first;
  zoom and fit are on the card.
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

## What a real model taught us, second round (the catalog, 2026-10-01)

Recorded with `npm run test:diagram:live` after the catalog was built; each is
now covered by a deterministic test. Final run: 34 of 34 judged turns right.

- **“Design Twitter's home timeline” came back as a Mermaid timeline.** The
  catalog's nouns had taken over system-design asks: of fifty design questions
  containing a catalog word (chart, graph, timeline, funnel, schema, class) —
  fourteen had changed view. A catalog word inside a design ask now names the
  system; all forty-nine that should be unchanged are, and the fiftieth
  (“design the data model for…”) is an ER diagram on purpose.
- **“Find the shortest path in a weighted graph” was handed the chart
  contract.** The generic words counted as a request on their own, and the
  “visual verb” test was satisfied by the noun itself. Verbs and noun-verbs are
  now told apart; twenty-eight such questions are pinned.
- **A forecast on a borrowed baseline.** Asked “what would revenue look like at
  5% monthly growth?” with no starting value anywhere, the model once charted
  10,000 — the reference example's number — and called it illustrative. The
  three layers under [Calculations](#calculations-the-app-does-the-arithmetic)
  came from this; afterwards it asked for the number in eight runs of eight.
- **A chart refused for a missing word.** A pie with `sources` and no `status`
  was refused. Naming a source is now read as “observed”.
- **A calculation written inside a series** (`{"name":…,"compute":{…}}`) was
  refused as “no values”. It is read like a top-level one.
- **Drawing the gap.** With no career history, the model drew a timeline of
  “Dates not provided”; with no paper, a flowchart of “Method (unknown)”. The
  `evidence` basis, the “forbidden when the facts are not there” wording and the
  placeholder check came from this. The wording alone got it right in most runs,
  not all; the placeholder check covers the rest.
- **An em dash in an example row** came back as a stray comma in a table cell
  (the answer clean-up rewrites dashes). Examples no longer contain one.
- **Complexity counted attribute lines.** An ER diagram of three entities was
  reported as 13 nodes; entities and relationships are counted now.

## Reviews and measurements (2026-10-01 / 02)

The finished feature was reviewed three times by independent reviewers who ran
the real modules, and the decision rules were then measured three times on
sentences written by reviewers who had not seen the rules, their tests or these
docs. Every finding was fixed with a test that fails without the fix.

### What the reviews found, by area

- **Decision rules** (`diagramRequest.mjs`). The first version treated a
  drawing verb anywhere plus a catalog word anywhere as a request, and a design
  on the table as "in focus" for half an hour. It was rewritten twice. The
  rules as they stand are described under “Rules worth knowing”. Also fixed
  along the way: “no diagram” in its negated and indirect forms; “code only” no
  longer drops the code; “real-time”, “existing” and “current” no longer turn a
  fresh design into a reconstruction; a named diagram outranks the generic word
  “chart”; hyphenated names; a chart that is only reshaped keeps its kind and
  its basis; another KIND of drawing of the same thing is a view of it, not an
  edit; speech-to-text noise (fillers, repeated words, false starts, dropped
  apostrophes) is removed before any rule reads the sentence.
- **A pattern that could hang.** A starred group of overlapping lead-ins
  (“could you please” is one prefix or two) took time doubling with every
  repetition: 12 s on 476 characters. Lead-ins are now stripped by a bounded
  loop. Two patterns in the source policy were cubic on a run of spaces (about
  90 s at the size cap) and were replaced by linear code. Both are pinned by
  timing tests at the caps.
- **Focus** (`activeDesign.mjs`, `SessionTracker`, `IntelligenceEngine`). A turn
  that follows up keeps the design in focus; so does an answer that talks about
  its own parts by name; every real turn says which it is, so a follow-up that
  was resolved and never answered leaves no mark. Brainstorm offers alternatives
  only while the design is the task; a prefetched answer marks nothing until it
  is shown; the planner and the resolver agree on “draw this again”; the router
  saying “system design” never restarts a design that is on the table.
- **Contract** (`diagramContract.mjs`). The way out on every follow-up; a
  process, a lifecycle or a troubleshooting tree is not told to discuss scale
  and failure (its view is read from its source: top-down or with a decision is
  a process); a chart payload is quoted whole or flagged as cut; the quoted
  block cannot be closed or escaped by its own content; a reference example
  only for the matching kind of chart; the short local-model contract honours
  “diagram only”, says where the artifact is, and asks for code that was asked
  for.
- **Charts and notation.** Totals judged on exact values and rounded once;
  contradictory or out-of-range inputs refused rather than “corrected”; no
  recursion or unbounded loops on hostile numbers; labels that collide are
  dropped rather than overlapped; lone surrogates and control characters can no
  longer make an image that fails to load. Fuzzed with 29,000 hostile payloads:
  no hang, no throw, no ill-formed SVG.
- **Card and stream.** A repair during the reveal is kept — also when the final
  text differs from the streamed text, and also in the main process when the
  repair is accepted before the answer is recorded; a no-break space no longer
  breaks the image; an image that cannot be decoded falls back; the card has its
  own error boundary; the previous version stays until the new one is drawn; the
  lead of a diagram answer is never repainted as raw Markdown and never blanks
  back to “Thinking…”; the chat overlays show no stray fence fragments; every
  gate reads a fence line the way the scanner does; a fence on a list item's
  line is a fence, and a sentence about fences is not; keyboard tab switching
  and panning; the off switch is remembered across launches and retried if its
  first read fails.
- **Source and SVG policy.** Only real `click` / sequence `link` statements are
  removed, by diagram type; a “placeholder” diagram is hidden only when nothing
  in it says anything; a web address in a label is text (a URL shortener can be
  drawn) while one in a `style`, `click` or image shape is still refused; a
  comparison (`retries<max and online = true`) is not an event handler; a
  renamed keyword id is renamed in `style` / `class` / `subgraph` too; rendered
  SVG is judged tag by tag (element name with any namespace prefix, handler and
  `src` attributes after a space, a slash or a quote, link targets), and a
  quoted local reference (`url("#arrow")`) is allowed.
- **Main process.** The final clean-up no longer flattens a comparison table or
  ignores `~~~` fences; the knowledge intercept keeps the contract when it
  replaces the system prompt; Direct Assist decides on the request alone, fits
  the contract inside the model's input, and does not refer to a design the
  provider will not be sent; answer repairs are capped on prose only, never cut
  a block, and keep the contract inside a v2 prompt; a long-prompt repair keeps
  the design; the self-composed fallback decides from the question, not the
  conversation; suggestion cards respect the switch, need the structure itself
  rather than one of its words, and the system-design card is offered under the
  real mode id; export names are safe on Windows, never hidden, and a silent
  save never overwrites; the phone falls back to the other window, fails
  instead of waiting for ever, and says “cut off” for a finished answer whose
  block never closed.
- **Failures are visible.** The first failure of each kind inside the diagram
  decision is logged once (`[diagrams] … failed`).

### How well the decision rules do, measured on unseen sentences

Each measurement: a reviewer wrote and froze the sentences (with the outcome a
listener would expect) before running the function, without reading the rules,
their tests or this document. “Must not” = ordinary talk, with and without an
artifact on the table, that must not draw or be claimed as a follow-up. “Must”
= requests and follow-ups that must be acted on.

| Measurement | Sentences | “Must not” wrong | “Must” missed | Slow inputs |
| --- | --- | --- | --- | --- |
| 1 — after the first rewrite | 501 | 9 of 278 (3.2%) | 74 of 223 (33%) | **a hang** (seconds on ~450 chars) |
| 2 — after the rework that followed | 675 | 4 of 357 (1.1%) | 59 of 318 (18.6%) | none over 100 ms |
| 3 — after the pass that followed | 509 | 7 of 262 (2.7%) | 32 of 247 (13.0%) | none over 100 ms |
| 4 — new ground: turns of several sentences, a state machine, a Gantt chart | 456 | 7 of 222 (3.2%) | 46 of 234 (19.7%) | none over 100 ms |
| 5 | 451 | 12 of 224 (5.4%; 3.7% without the rows the reviewer marked borderline) | 24 of 227 (10.6%) | none over 100 ms |
| 6 — after the 22 known misses were fixed and swimlanes, trees and the chart table were added | 599 | 8 of 309 (2.6%); four would have redrawn a diagram | 35 of 290 (12.1%) | none over 100 ms |
| 7 — the last one, after the fixes that followed the sixth | 476 | 5 of 244 (2.0%); two would have redrawn a diagram | 24 of 232 (10.3%) | none over 100 ms |

The same, for Spanish, Russian, Chinese and Japanese together (`diagramRequestI18n.mjs`):

| Measurement | Sentences | “Must not” wrong | “Must” missed | Slow inputs |
| --- | --- | --- | --- | --- |
| 1 — the first version | 388 | 3 of 196 (1.5%); found afterwards: Japanese 書いて “write” read as “draw” | 34 of 192 (17.7%); Chinese follow-ups 6 of 14 | none over 100 ms warm |
| 2 — after the fixes that followed the first | 424 | 7 of 212 (3.3%); with the drawing's labels quoted, 11 of 212 (5.2%); none would have redrawn | 29 of 200 (14.5%); with labels quoted, 19 of 200 (9.5%) | a long unbroken run of katakana: 240–400 ms |
| 3 — the last one, after an independent read of the rules had been acted on (a new domain, charts and flowcharts on the table as well) | 220 | 5 of 88 (5.7%); one would have drawn (画重点, “mark the key points”) | 35 of 132 (26.5%) | none over 100 ms |
| …the same 220 sentences on the rules as they stood before that read | 220 | 12 of 88 (13.6%); two would have drawn | 36 of 132 (27.3%) | — |
| 4 — after the fixes that followed the third (another new domain, a different author) | 220 | 1 of 88 (1.1%); it drew (负责画原型图, “my job was drawing prototypes”) | 38 of 132 (28.8%) | none over 100 ms |
| 5 — after the fixes that followed the fourth; a set written to be harder (regional speech, nicknames for parts, edits in the vocabulary of drawing, requests split over two sentences) | 220 | 8 of 88 (9.1%); five drew | 50 of 132 (37.9%), and 8 more attached or drawn as the wrong thing (an edit read as a question, a table of a chart read as an edit of the chart, the wrong kind of diagram) | none over 100 ms |
| …the same 220 sentences on the rules as committed before that whole round (`db008cb2`) | 220 | the same 8 of 88 | 60 of 132 (45.5%) | — |

Read it as: **on English sentences it has never seen, the rules wrongly draw
or attach to about 1 ordinary line in 40–50, and miss about 1 real request or
follow-up in 10. In the four other languages they are wrong on between 1 line
in 90 and 1 in 11, depending on the set, and miss between a quarter and well
over a third of real requests and follow-ups: 26.5%, 28.8% and 37.9% on the
last three unseen sets.** The English numbers did not converge to zero and
will not: each new reviewer brings phrasings and kinds of diagram the rules
have not met.

The four-language numbers are not converging at all. Everything changed in
the round between the two — the misses of the fourth set fixed by pattern
(about 36 rows, with no change to any earlier sentence), lanes, the Russian
compound, the Spanish verb-first statement — recovered ten rows on the fifth:
the same fifth set misses 60 of 132 on the rules before that round and 50
after. What people actually say —
nicknames for parts (“платёжка”, “锁控那块”), edits in the vocabulary of
drawing (“обведи рамкой”, “点線にしといて”, “标一下 MQTT”), regional forms
(“hágame un favor y me pinta ahí…”, “してくれへん？”), a request split over two
sentences — is a long tail that hand-written rules in four languages reach one
pattern at a time. A miss costs an answer in words where a drawing or an
answer about the drawing was wanted; a wrong draw puts a contract on a turn
that wanted words, which is why the eight wrong rows of the fifth set were
fixed and its fifty misses were listed, not chased. **Recognising these turns
well needs a different mechanism — a model that reads the turn — not more
rules.** That is a product decision (a second model call, or a conditional
contract on turns the rules cannot place) and has not been built.

The last measurement in each table is the figure for the rules as they stood
before its own fixes; what was fixed after it — in English the two sentences
that would have redrawn a diagram, in the other languages the eight wrong rows
of the fifth set and “not a chart — a table” — has not been measured on unseen
sentences.

After each measurement its real defects were fixed and its sentences became
regression tests (`tests/diagram/heldout-2026-10-02.mjs`,
`heldout-2-2026-10-02.json`, `heldout-3…` to `heldout-7-2026-10-02.mjs`,
`i18n-heldout-2026-10-02.mjs`, `i18n-heldout-2-2026-10-02.mjs`,
`i18n-heldout-3-2026-10-02.mjs`, `i18n-heldout-4-2026-10-02.mjs`,
`i18n-heldout-5-2026-10-02.mjs`, `i18n-review-2026-10-02.mjs`,
`review-round2.mjs`: about 5,300 sentences), with the rows that are still not
met listed by name in `resolverPrecision.test.mjs` and
`diagramRequestI18n.test.mjs` — as decisions where they are decisions, and as
known misses where they are misses. On sentences the rules have already seen
they score close to 100%, which says nothing.

What the later measurements changed:

- **A turn of several sentences.** The rules read a turn from its first word.
  When the turn as a whole asks for nothing, each sentence is now heard on its
  own (“Okay, that makes sense. Add a cache in front of the store.”). A
  follow-up that names nothing (“make it 5%”) is taken only when nothing but an
  acknowledgement stands before it: after “Sarah is on leave until the 12th.”,
  “it” has something else to mean.
- **An edit is judged by its own object.** A word or a name shared with the
  diagram is not enough: “remove the *hold* music”, “put the caller *on hold*”,
  “I need a *copy* of the signed contract”, “remove Dan from the *email*
  thread”, “add a step to the onboarding checklist” edit something else. The
  head of the object (its last word), what it is “of”, and where it goes decide.
- **Schedules and state machines have their own words**: “push … back by a
  week”, “what's on the critical path?”, “which states are terminal?”, “can a
  claim go from Submitted directly to Approved?” (only when one of the two is a
  state of the diagram).
- **A chart is not named by its machinery** (`"kind":"compound_growth"`), and
  everyday time and money words (“months”, “growth”, “plan”) reach a chart in
  the background only with “the” before them.
- **Speech**: a leading “er”, “like” before a question word, a doubled
  “whats whats”, “would you mind adding …”.

What the numbers mean in use. A wrong “must not” attaches a contract (and
sometimes the design) to a turn that had nothing to do with it; the contract
says to ignore itself in that case. A missed “must” is answered in words, with
no drawing; the user can ask in so many words (“draw that”), which the rules
catch far more reliably than they catch an implication. Misses concentrate in
unasked visuals — deliberately conservative — and in phrasings no rule
anticipated. This is a rule system, not a classifier: it will keep missing
some phrasings.

### The last review (2026-10-02): wiring, default-on, everyone

A final read-only review traced the switch and every route. Confirmed by
reading: the flag defaults to on from one literal, every reader goes through
the same function (a new install, an upgrade without the key and a corrupt
settings file all read as on), the toggle is live in both directions, nothing
is gated by licence, trial, tier, provider, model or OS, and no route attaches
the contract twice. What it found, and what was done:

- **The Answer button's spoken question did not see the design on the table**
  (it composes its own prompt), and in a meeting with indexed chunks the
  meeting search answered a drawing request in prose. Fixed: see Routes.
- **Chart numbers written as text** (`"baseline":"10000"`) were refused as
  missing. They are read as numbers where a number belongs; category labels
  that look like numbers stay labels; “10k” and “about 10000” are still refused.
- **A node called `link`, `click` or `style`** with an address in its label was
  refused as a link statement. It is a node when a shape or an arrow follows.
- **Rendered SVG**: an address hidden behind CSS escapes (`\75rl(`) or
  `image-set()` is refused; a `<style>` block may not name an outside address.
- **Non-English requests did not draw** unless the planner routed the turn as
  a system design: the rules read English, and the app ships ru/zh/ja/es.
  Fixed afterwards: see “Six follow-ups” below.
- **The save dialog opened behind the frontmost app.** Seen on macOS: the
  overlay never takes focus, so Export looked like it did nothing while “Save
  diagram” sat behind the user's meeting app. Now, per platform
  (`saveDialogPlacement`): macOS brings the app forward first; Windows makes
  the dialog owned by the overlay window, so it opens above it. Undetectable
  mode is unchanged (no dialog, a silent save to Downloads). Watched on macOS
  afterwards (below); the Windows branch has not been run.
- **A one-frame blank at the switch to the card path.** The on-screen text was
  wiped a frame before React repainted it. The text now stays until React
  replaces it. Proven afterwards (below).
- **With the switch off the product is not byte-identical to before**: answer
  repairs are capped on prose only and a repair cut inside a fence is dropped
  rather than used; the final clean-up protects `~~~` fences; a saved answer
  that is one mermaid block is shown as a code card rather than a code hero.
  These are fixes that apply with or without drawings.
- **Suggestion cards** for visuals now appear in modes that had none (Team
  Meet, Call Center, Technical Interview, Looking for work, Seminar). Intended;
  it is the change a user who never asks for a drawing will notice.
- **Committing**: about 30 files of the catalog are untracked (`git status`).
  A commit made with `git commit -a` would leave them out and not build.

### Six follow-ups (2026-10-02)

The review above ended with six things left open. Each was then closed, or
closed as far as this machine allows; what remains is said at the end.

**1. Requests in Spanish, Russian, Chinese and Japanese**
(`diagramRequestI18n.mjs`). The English rules decide first; only where they
find nothing is a turn in one of these four languages read by a much smaller
set of rules of its own, so no English decision can change because of it (the
English sentence sets, 3,550 sentences, resolve identically with and without
the module). The same principles, in a small vocabulary:

- a drawing is asked for by the mood of the sentence — an instruction, a
  request, a wish for a named visual — never by a statement, the past, a
  question about what a kind of diagram is, or after “sin diagrama” / “без
  схемы” / “不要画图” / “図はいらない”;
- a verb that can only mean drawing asks whatever its object; a verb that
  shows, makes or writes asks only when a visual is named (Japanese 書いて is
  “write” as well as “draw”: “議事録を書いて” draws nothing);
- “design a ‹software system›” is an architecture, and what is designed is the
  head noun in that language's order (“系统的logo” is a logo; “オフィスの入退室
  管理システム” is a system);
- a follow-up needs evidence: it names the drawing, or — in focus — uses a word
  a design is discussed in or one of the drawing's own labels (inflected in
  Russian, shortened in Chinese and Japanese). An edit that goes somewhere
  else (“añade el evento al calendario”) is not one, unless a label of the
  drawing is said whole.

Language is told by script (kana → Japanese, Han without kana → Chinese,
Cyrillic → Russian) and, for Spanish, by its letters or its small words.
Spanish is matched with accents folded (“Hágame”, “Añádele”, “disena”).
Not done in these languages: visuals nobody asked for, pronoun-only edits
(“hazlo más simple”), elliptical and capability questions, and reading the
inputs of a calculation out of the sentence (nothing is ever called “missing”;
the model decides). Any other language is not recognised at all.

**2. The save dialog.** Watched on macOS in the running app: with another app
in front, Export › SVG in the overlay made the app frontmost (checked by
process id) with the “Save diagram” window in front of everything; Cancel
wrote nothing. A side effect that stays: after the dialog closes, the app is
still the frontmost one — the user's meeting app is not brought back, which
the overlay otherwise never does to them. The Windows branch (the dialog owned
by the overlay window) is covered by a branch test and has not been run on
Windows; what to look at there is whether the dialog opens above the overlay
and whether a file name can be TYPED into it, since typing to the overlay
goes through the low-level keyboard hook and the overlay never activates.

**3. The one-frame blank.** Proven. The overlay check sampled the screen on a
timer, so it caught the blank only when a frame landed in the gap (once in
about twenty runs, and four times out of four it passed with the defect put
back). It now also observes every DOM change and asks whether the row is empty
once the task that changed it has finished — the point at which the browser is
free to paint. With the old wipe put back that check fails 3 runs of 3; with
the fix it passes 3 of 3. The same observer confirms the kept text is replaced
and not joined: the lead is never on screen twice.

**4. “Draw what we discussed”, said aloud.** The spoken question's own prompt
held the question and nothing of the meeting. Such a turn is now handed the
meeting's recent speech (see Routes). In the running app, with a design
described in injected speech: the request on the wire carried the contract
once, the speech once, all five components that had been described, and the
drawing came back with the undecided part marked as open. (Shown by calling
the route from the overlay's console with speech injected through the
development hook: this machine has no speech-to-text configured, so the Answer
button itself was not pressed. That first run read the rolling window, which
holds three minutes. With the durable reader that replaced it, speech dated
four and a half to six minutes before the question was on the wire — the
contract once, the speech once without the request itself, five of five
components — and the drawing came back.) The window is the last ten minutes or 6,000
characters of speech, newest kept: something described earlier than that is
not in it, where the meeting search would have found it.

**5. The 22 known misses of the fifth measurement.** 21 are met, each by a rule
about a kind of sentence, tested with sentences of that kind that were in no
measurement and with look-alikes that must keep meaning something else; the
last was a label its reviewer withdrew. Sibling sentences showed four of the
new rules to be incomplete, and four latent false positives turned up on the
way (“create a ticket about the diagram” drew a diagram; so did “make a
summary of the chart”).

**6. Swimlanes, trees, the chart as a table.** Swimlanes and trees are ordinary
Mermaid flowcharts with a layout (`request.layout`): one `subgraph` per lane,
or top-down with one parent per node. Nothing new reaches the renderer or the
source policy. They are drawn only when a verb that shows or draws governs
them: not from a statement, not from “store it as a tree”, and not where the
words are about code. (The app's keyword planner calls any “tree” a
data-structures question: “show the org structure as a tree” resolved
correctly in isolation and got no drawing in the engine. The engine harness
found that; a tree that is asked to be SHOWN, with nothing of code in the
words, is now a picture on that route too.) A chart as a table copies the
values the app computed (`chartValuesBlock`), handed over as a Markdown table
with its separator row — the first version in the app had the right numbers
and no table, because the rows it was told to copy exactly had no separator. A
question about a chart is handed the same values and told not to recalculate;
an edit of a chart is not handed them, because they are about to change. A
series longer than 61 rows is handed as every Nth row, first and last
included, and says so.

**And one thing the four languages brought with them.** Charts and Chen ER
diagrams are drawn by the app's own code, which sizes every box from an
estimate of text width. Chinese and Japanese were estimated correctly (a full
em per character). Cyrillic was counted as Latin and came out at 70–94% of its
real width, so a Russian label could overrun its box; it is now estimated a
little wide like the rest. The render check measures real widths in every
script, and draws charts and Chen ER diagrams labelled in Russian, Chinese and
Japanese with no label outside the drawing or on top of another.

### An independent read of the newest code (2026-10-02)

After the six follow-ups, a reviewer who had written none of it read the
newest paths — the spoken route, the meeting-search gate, the speech block,
the chart values, the four-language module, the save dialog — and proved what
it found with probes. Eleven findings a user would meet, ten smaller ones.
What was done:

- **A drawing turn left the previous meeting-search answer running**, and its
  text could land in the bubble of the answer that replaced it. The gate now
  runs after the still-streaming search answer has been stopped.
- **Recall questions were taken from the meeting search.** “What did John say
  about the API gateway?” named a part of the design, so it was answered from
  the diagram. A question about what was SAID is no longer a follow-up (in
  English and the four languages) unless it names the drawing itself, and the
  spoken route leaves the meeting search only for a drawing, a change, or a
  question that names the design or a part of it — not for one that only might
  be about it (“how does that work?”).
- **“Draw what we discussed” was handed three minutes, not ten.** The reader it
  used is evicted after 180 seconds whatever window is asked for. It now reads
  the durable transcript (`SessionTracker.getFormattedSpeech`), speech only,
  and drops the request itself from the end of it. Watched in the running app
  with speech dated up to six minutes earlier.
- **With the composed prompt (prompt system v2) turned off**, the spoken route
  got a design block and a speech block with no contract. It now gets nothing
  of a diagram turn, and the meeting search keeps the question.
- **Four languages: ordinary phrases named “the drawing”** — «по графику»
  (behind schedule), “el modelo de precios”, 这个方案, このモデル, 表格里. The
  drawing is now named by a word that can only be one, or by one that is the
  kind of drawing on the table (a 模型 only over an ER or class diagram).
- **Four languages: a fresh request about another subject was drawn as a view
  of the design on the table** (ログイン処理をシーケンス図で示して). “Of the one
  on the table” now needs it pointed at (“este diseño”, この図) or “it” while
  it is in focus.
- **“Show this chart as a table” redrew the chart** in all four languages; it
  now gets the same copy-the-values contract as in English. Another shape of
  the same chart is an edit of it.
- **Where a drawing comes from was never said** outside English: “draw what we
  discussed” proposed a design, an example chart was told “real numbers only”.
  The four languages now say reconstruction, source, illustration, scenario and
  function.
- **Statements read as requests**: Chinese verbs with their result and 了
  (画出了, 画好了), 画 inside 漫画 and 企画, one-character verbs inside other
  words (后来, 我要填, 出在), 画重点; Japanese 路線図, 天気図, 心電図,
  表に名前を書いて, 時系列で説明して, 描いてみた; Spanish “traza del error”.
- **Edits refused** when the new part's name is an everyday word (加一个邮件服务,
  メール通知サービスを追加して, “añade una cola para el correo”).
- **Everyday words as evidence** (clientes, шаги, 步骤, ステップ, クライアント):
  each now counts only for a drawing of the kind that has such things, or one
  whose label is that word.
- **An edit of a swimlane or tree diagram lost its layout.** A left-to-right
  swimlane diagram is stored as an architecture (its lanes are `subgraph`s, and
  so are an architecture's groups), so what it was asked for as is read from
  the question that made it.
- Smaller: English no longer read as Spanish for a shared word (“eliminate”);
  a chart's JSON keys are not its labels; a node id is a name only when the
  node has no label; the speech block is recognised by its own opening tag at
  the start of a line, and a design that quotes that tag has it neutralised.

Then the four-language rules were measured a third time (table above), and its
real defects fixed: regional and conditional verb forms (“me lo ponés”,
“necesitaría”, «можно …?»), 换成 and 麻烦来一个, questions with no asking word in
front when the clause names a part by its label, labels said shortened in
Chinese (“预约” and “药房” for two services), an edit that adds a part described
with an everyday word. Those fixes are not measured.

A last check of those fixes found four of them reopening what the read had
closed, and they were corrected (also unmeasured):

- “It” tied a fresh drawing to the design on the table wherever a pronoun
  stood (“…, eso es urgente”, 把这个招聘流程画成流程图). It now counts only as the
  object of the request (“muéstralo como…”, 把它画成…, これを…にして).
- The recall rule refused edits that cite the meeting (“añade la caché que
  mencionó Ana”, “add what was agreed for the gateway”). Recall is a question,
  from its first word; an edit that leads is an edit.
- Spanish “suma” (add up) was read as an edit; only “súmale” is.
- An org chart or tree is edited by placing something under one of its own
  names (“add a Platform team under Engineering”), which was not an edit at
  all; it is now, and keeps the tree layout.

The handover from a stopped search answer to a chat answer was read, not run:
a stopped live query sends no completion and no error event, and the overlay
finalises the old search bubble before it creates the new one — the same path
a second search question has always taken.

Left as found at the time (the first five were fixed afterwards: see “The
items left as found, done” below):

- “Usa el cliente la API actualmente” (a statement with the verb first) was
  read as an edit of the design in focus.
- A Russian label said abbreviated (“медкарт” for “База медицинских карт”) was
  not recognised.
- The speech block was withheld from a local model too when the transcript may
  not go to a cloud provider.
- The local-model overflow guard dropped lines from the head of the turn and
  did not know about blocks; an overflow could cut the design block in half.
- Direct Assist kept the design block when the contract did not fit the
  model's input; the block then referred to a contract that was not there.
- If the save dialog itself throws on macOS, the app has already been brought
  to the front. (Still so.)

What is still open after these six:

- Nothing has been run on Windows: the save dialog's Windows branch, labels in
  the four scripts with Windows fonts, and everything else in this document.
- The four-language rules are small and missed about one request or follow-up
  in four on what was then the last unseen set (two later sets: 28.8% and
  37.9%; see the tables above). In them, one word shared with a longer label is not
  evidence of a follow-up (so “cambia la factura de marzo” never redraws a
  design that has a “Servicio de Facturas”), which also means a part named by
  one word of its two-word label is reached only through a design word, the
  whole label, or the drawing being named.
- English misses that are known and listed by name in
  `resolverPrecision.test.mjs`: a non-native “I am having one doubt, why …”,
  “make the confirmation asynchronous” where the diagram says “Confirm”,
  “does the app talk to the planner directly?”, and those the reviewers
  themselves marked borderline or withdrew.
- A timing guard in the policy tests (“no pattern here is worse than linear …
  at the size cap”) failed once at 552 ms while the whole unit suite ran beside
  it, and passed alone and in six further full runs. Load, not a regression.

Left as it was, on purpose:

- A bold span that is still being revealed shows its `**` for a frame or two.
  Every streaming path in the overlay does this.
- The coding-verification correction stream is still capped by total length
  (`maybeVerifyCoding`); it belongs to the coding feature.
- The older action-trigger tables keyed `technical_interview`, `team_meeting`,
  `interview` and `negotiation` still never fire (no mode has those ids). Only
  the system-design offer was moved under the real id.
- Card strings go through `t()` but have no ru/zh/ja/es dictionary entries yet,
  like other recent strings. (Requests in those languages are recognised: see
  “Six follow-ups”.)
- “What's the X?” is a lookup and is answered in words even when X is a path or
  an order; a task has to ask for the structure (“what are the steps…”, “walk
  me through…”, “compare A and B on…”).
- In focus, a pronoun and “what happens…” is taken as a question about the
  design: answered in words with the design attached, never redrawn. (Not the
  “it” of the weather or the time: “what happens if it rains on the day of the
  offsite?” is nobody's design.)

### The items left as found, done (2026-10-02)

Seven things were still open after the independent read. What was done about
each, and what is still not known:

**Direct Assist: the design block and its contract go together.** The block
opens with “the starting point for this turn, as the diagram contract
describes”. When the contract did not fit the model's input the block was
sent alone, asking for a redraw with none of the rules a redraw is held to.
Now the block is left out with it; the drawing is still in the history the
prompt carries. In practice this is a chart edit on a small local model whose
prompt is already full: the short chart-edit contract is about 3,100
characters and such a prompt has about 2,900 left.

**A local model is never sent half of the design.** The overflow guard for a
model on this device cut lines off the top until the prompt fitted. On a
diagram turn that reached into `<active_design>`: the opening tag and the
first nodes gone, the rest kept. `electron/llm/localContextTrim.ts` now does
the cutting for all three places that trimmed by line (`callOllama`,
`streamWithOllama`, `fitContextForCurrentModel`): older context first; then the
oldest of what was said in the meeting, its wrapper and heading kept while any
of it is left; then the design, whole, with one line in its place saying it
did not fit; then, as before, from the top. For content with no drawing in it
the result is the old one, character for character (2,000 random prompts in
the test). Not run against a real Ollama: none is installed on the machine
this was written on.

**A model on this device is sent the design and what was said.** The
transcript scope (Settings › AI Providers › Privacy) says what may go to a
provider, and the transport already hands a local model everything. The
diagram code decided earlier and without asking, so with that scope off a
local model got no design on a follow-up and no speech for “draw what we
discussed”. `activeDesignShareable()` now also asks whether the selected model
runs on this device (a probe the engine registers; the V3 composer asks the
same question). The transport backstop was extended first: a prompt bound for
a provider loses `<conversation_so_far>` as well as `<active_design>` when the
scope is off, so a local model that turns out to be unreachable cannot hand
either to a provider. Seen end to end in the engine harness (V19), V3 on and
off: a provider gets no design block and no update contract; a local model
gets both, once each, and the edit is recorded as the next version. One thing
found on the way and left: on the default (V3) route the transcript EVIDENCE
is withheld from a local model too when that scope is off — that is the
privacy pipeline's own rule, not this feature's, and it is unchanged.

**The two sentences that were known wrong.** A Spanish verb first, then who
does it and what to (“usa el cliente la API”) states what something does; the
imperative has one object, then a preposition or a measure. A Russian compound
(“медкарт”, “техподдержка”) names the label whose two neighbouring words it
runs together.

**Lanes.** Found while testing the above: a lane is a `subgraph`, and nothing
read its title, so “What does the Support lane do?” over a swimlane diagram was
an unrelated turn. A lane called a lane (“the Finance lane”, “el carril de
Soporte”, “дорожка поддержки”, “财务泳道”, “経理のレーン”) is now a part of
the diagram, in focus or not; a group titled with more than one word is named
by its title. The department of that name in everyday talk (“who is in finance
this week?”) is not.

**The four languages.** The fourth measurement (table above) confirmed the
figure: 38 of 132 real requests and follow-ups missed. The misses fell into
patterns, and the rules now read each: a request that starts late in a spoken
sentence (found by a form addressed to the listener: an imperative with
“me”/“nos” on it, a request frame, “давай …”) — not one that is told or
reported; what a part of the drawing SHOULD do (“que pagos también mande…”,
“пусть … пишет в очередь”, “让支付服务往队列里发…”, “…ようにして”); whether the
design holds up, asked of “this” while it is in focus; a verb of change after
where it goes (“después del reembolso agregá un paso”); a chart changed by its
marks (“sort the bars”); Río de la Plata verb forms; Russian “-ка” and
diminutives; a part named by what is distinctive in its name in Chinese and
Japanese; a process step named by its words in a what-if; chart categories one
character long; “the same data as a table”. Each has its opposite in the
tests (`what the fourth four-language measurement found`).

The fifth measurement was taken after those fixes, on 220 more blind sentences
written to be harder: 8 of 88 wrong (five drew), 50 of 132 missed. None of the
eight came from the rules added in this round (the same eight are wrong on the
rules before it), and no row met before is missed now. The eight were then
fixed narrowly — a request quoted as something somebody said (“「図で説明して」
って言われた”), asked of the speaker (“我妈让我给她画个…”), the speaker's own plan
(“回头我自己用Excel做个柱状图”, “私のほうでまとめて作ります”), 図々しい, a recalled
figure, who runs a project, one phrase that is in two of a chart's labels —
each with its opposite in the tests.

One of the eight rows that were attached as the wrong thing was the complaint
this feature started the day with, said the way people say it: “グラフやなくて表で
見たいわ、同じ数字で” (not a chart, I want a table, same numbers) edited the
chart. A visual that is turned down where it stands — “グラフじゃなくて”, “不要
图表”, “no quiero el gráfico”, “вместо диаграммы” — is now not the one asked
for: with another named, that one is drawn (a table OF the chart when the
chart is what is on the table), and “no chart” no longer cancels a turn that
asks for a table instead. With nothing asked instead it is still “no drawing”.

The other forty-eight misses, and seven rows still met as the wrong thing, are
listed by id in `diagramRequestI18n.test.mjs` and were left: see the paragraph
under the tables above for why.

**Windows.** Still not run on a Windows machine, and not yet in CI either.
What is in place: the feature's unit suite sits under the `test:lib` glob and
its main-process tests under `npm test`'s, so the Windows leg of
`build-smoke.yml` will pick them up (`test:lib` is enforcing there, `npm test`
advisory); and the workflow now also runs the engine harness and the render and
card checks on both legs. The render check on the Windows leg is the first
place these drawings would be laid out with Windows fonts. None of it has
executed: the workflow runs on a pull request, on a push to `main`, or when
dispatched by hand (`gh workflow run build-smoke.yml --ref <branch>`) — pushing
the branch alone runs nothing.

Still open:

- Windows: nothing above has been seen running there. The save dialog's
  Windows branch (including typing a file name into it) needs a person.
- The four languages miss between a quarter and well over a third of real
  requests and follow-ups on unseen sentences (the tables above), and more
  rules do not close it. The fixes made after the fifth measurement are
  unmeasured.
- The local-model changes are tested as units and through the engine harness
  with a model stub, not against a real local model.

