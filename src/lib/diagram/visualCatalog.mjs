// The capability registry: every kind of visual this app can produce, what it
// is written in, what draws it, and the rules a model is given for it.
//
// One table, read by the prompt contract (diagramContract.mjs), the docs and
// the tests, so "what do we support, and how is it written" has one answer.
// A kind is here only if it has: a renderer that was verified with the pinned
// libraries, a validation step, a prompt rule, and a fixture in the test suite.
// Mermaid being able to parse a family does not put it in this table.
//
//   renderer  'mermaid'   Mermaid source in a ```mermaid block (mermaidRenderer)
//             'chart'     a JSON payload in a ```natively-chart block
//                         (chartSpec → chartCompute → chartSvg)
//             'notation'  a JSON model in a ```natively-diagram block
//                         (chenEr, automaton)
//             'table'     an ordinary Markdown table, no block at all
//
// The four original system-design views (architecture, sequence, flowchart,
// state) keep their rule text in diagramContract.mjs unchanged; their entries
// here carry only the registry facts.

import { VISUAL_FENCE_TAG } from './fencedBlocks.mjs';

const MERMAID_PLAIN = 'Plain Mermaid only: no %%{init}%% directive, no frontmatter, no click or link statement, no HTML tag, no image or icon, no classDef or style line.';

/** @type {Readonly<Record<string, { view: string, name: string, article: string, renderer: 'mermaid' | 'chart' | 'notation' | 'table', header?: string, legacy?: boolean, rules?: string, after?: string, fallback: string }>>} */
export const VISUAL_CATALOG = Object.freeze({
  // The four original views. A SYSTEM DESIGN in one of them is told what it
  // always was (diagramContract's own text: components, scale, failure, the
  // tradeoff). `rules` and `after` are for everything else drawn in these
  // shapes — the water cycle, a TCP handshake, how a request gets approved —
  // which is not a system and must not be answered like one.
  architecture: {
    view: 'architecture', name: 'diagram of the parts and how they connect', article: 'a', renderer: 'mermaid', header: 'flowchart LR', legacy: true,
    fallback: 'a description of the parts and how they connect',
    rules: `- Type: \`flowchart LR\`. One box per part, labelled in double quotes; label an arrow with what moves across it, in one to three words.
- Draw the parts the question is about, and no more than ten. Do not add infrastructure, scale or failure handling nobody asked about.
- Node ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style). One node per part.
- Plain Mermaid only: no %%{init}%% directive, no click or link statement, no HTML tag, no classDef or style line.`,
    after: 'Then two or three sentences on how the parts work together.',
  },
  sequence: {
    view: 'sequence', name: 'sequence diagram', article: 'a', renderer: 'mermaid', header: 'sequenceDiagram', legacy: true,
    fallback: 'the steps listed in order',
    rules: `- Type: \`sequenceDiagram\`. Declare each participant once (participant C as Client), at most six. One arrow per message in the order it happens: ->> for a request, -->> for a reply, each with a short label.
- Show the exchange the question is about, start to finish, and nothing after it. Use alt, opt or loop only for a case the question raises.
- Plain Mermaid only: no %%{init}%% directive, no link or links statement, no HTML tag.`,
    after: 'Then two or three sentences: what the exchange achieves, and the step that matters most.',
  },
  flowchart: {
    view: 'flowchart', name: 'process flowchart', article: 'a', renderer: 'mermaid', header: 'flowchart TD', legacy: true,
    fallback: 'the steps as a numbered list',
    rules: `- Type: \`flowchart TD\`. One box per step, in the order the steps happen; start and end are rounded: start(["Start"]). A choice is a diamond with a labelled arrow for each answer.
- Four to ten steps, each label at most five words. Only steps that belong to this process.
- Node ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style); labels in double quotes.
- Plain Mermaid only: no %%{init}%% directive, no click or link statement, no HTML tag, no classDef or style line.`,
    after: 'Then two or three sentences: what the process does from start to finish, and where it can branch.',
  },
  state: {
    view: 'state', name: 'state diagram', article: 'a', renderer: 'mermaid', header: 'stateDiagram-v2', legacy: true,
    fallback: 'the states and what moves between them, as a list',
    rules: `- Type: \`stateDiagram-v2\`. Start with [*] --> FirstState. One line per transition, labelled with what causes it: Paid --> Shipped: dispatched.
- Only the states the thing really has, named as nouns or adjectives in CamelCase. Do not add a failure or cancelled state unless it is part of what was asked.
- Plain Mermaid only: no %%{init}%% directive, no HTML tag, no classDef or style line.`,
    after: 'Then two or three sentences: the usual path through the states, and what causes each change.',
  },

  decision: {
    view: 'decision',
    name: 'decision tree',
    article: 'a',
    renderer: 'mermaid',
    header: 'flowchart TD',
    rules: `- Type: \`flowchart TD\`. Start and end are rounded: start(["Start"]). A step is a rectangle. Every check is a diamond that asks a question with a small set of answers: check{"Light blinking?"}; a diamond is a test, never a noun.
- Label every branch out of a diamond with its answer: check -->|"yes"| next. Every path ends in an outcome: resolved, a named escalation, or an explicit "unknown: check …".
- Use only the checks, conditions and outcomes the conversation or the evidence gives. A branch nobody described is left out or marked "(not covered)".
- At most twelve nodes; node labels of at most five words. Node ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style, click, call).
- ${MERMAID_PLAIN}`,
    after: 'Then one or two sentences: where to start, and which check decides the outcome.',
    fallback: 'the checks as a numbered list with the outcome of each answer',
  },

  er: {
    view: 'er',
    name: 'entity–relationship diagram',
    article: 'an',
    renderer: 'mermaid',
    header: 'erDiagram',
    rules: `- Type: \`erDiagram\` (crow's-foot notation). Give an entity its attributes in a block: ORDER { int order_id PK }. Mark PK, FK or UK only where that is known, or where you state it as your design choice.
- A relationship line has a marker at EACH end, and each marker describes the entity NEXT TO IT, as seen from the other entity. CUSTOMER ||..o{ ORDER : places means: one ORDER belongs to exactly one CUSTOMER, and one CUSTOMER has zero or many ORDERs. Right-end markers: || exactly one, o| zero or one, o{ zero or many, |{ one or many. Left-end markers mirror them: ||, |o, }o, }|. Check both directions before you write the line.
- The line itself: \`..\` (dashed) when the child has its own key and only refers to the parent — this is the usual foreign key. \`--\` (solid) only for an identifying relationship, where the parent's key is part of the child's key.
- A many-to-many relationship stays ONE line (}o..o{) in a conceptual model. Add a junction table only for a physical schema or when asked, and say it is your design choice.
- A cardinality or an optionality nobody stated is not guessed into the diagram. Draw what is known and name the open constraint in one line under the diagram.
- Only the entities the question needs. There is no minimum size: two entities is a complete answer when two were asked for.
- ${MERMAID_PLAIN}`,
    after: 'Then read each relationship back in plain words, in both directions, one short line each, and name any constraint that is still open.',
    fallback: 'the entities, their keys and each relationship in words',
  },

  class: {
    view: 'class',
    name: 'class diagram',
    article: 'a',
    renderer: 'mermaid',
    header: 'classDiagram',
    rules: `- Type: \`classDiagram\`. Attributes and methods go inside the class: class Spot { +int number +isFree() bool }. Visibility: + public, - private, # protected. Mark <<interface>> or <<abstract>> inside the class it applies to.
- The relationship symbol sits at the END it describes. Vehicle <|-- Car: Car inherits from Vehicle (triangle at the parent). Vehicle <|.. Car: Car implements the interface. ParkingLot *-- Level: composition, a Level cannot exist without its ParkingLot (filled diamond at the whole). Level o-- Spot: aggregation (hollow diamond at the whole). A --> B: A refers to B. A ..> B: A depends on B.
- Multiplicity goes in quotes at each end where it matters: ParkingLot "1" *-- "1..*" Level.
- Only the classes the question needs, at most ten, and only the members that matter to the design.
- ${MERMAID_PLAIN}`,
    after: 'Then two or three sentences: the main responsibilities, and why each relationship is inheritance, composition or a plain reference.',
    fallback: 'the classes, their members and relationships as a list',
  },

  dependency: {
    view: 'dependency',
    name: 'dependency map',
    article: 'a',
    renderer: 'mermaid',
    header: 'flowchart LR',
    rules: `- Type: \`flowchart LR\`. One node per item (a task, a claim, a piece of work), with a short quoted label.
- EVERY arrow is labelled with what it means, and all arrows use one direction convention: a -->|"blocks"| b means b cannot proceed until a is done. Use distinct labels for distinct relations: "blocks", "needs", "supports", "contradicts". A blocker and an ordinary prerequisite are different labels.
- Draw only the relations that were stated. A relation that is suspected, not stated, is written as "(unconfirmed)" in its label.
- At most twelve nodes. Node ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style, click, call).
- ${MERMAID_PLAIN}`,
    after: 'Then one sentence stating the arrow convention, and one naming what is currently blocked.',
    fallback: 'each item with what it is waiting on',
  },

  responsibility: {
    view: 'responsibility',
    name: 'responsibility map',
    article: 'a',
    renderer: 'mermaid',
    header: 'flowchart TD',
    rules: `- Type: \`flowchart TD\`. Nodes are people, roles or teams, with a short quoted label.
- EVERY arrow is labelled with the relation it shows: "owns", "approves", "reports to", "hands off to", "escalates to", "influences", "interviews". An unlabelled arrow would read as a reporting line, so there are none.
- Draw only relations that were stated. Never infer who manages whom or who has authority. An unknown owner is a node that says so: unknown_owner["Owner: unknown"].
- At most twelve nodes. Node ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style, click, call).
- ${MERMAID_PLAIN}`,
    after: 'Then one or two sentences: who decides, and what is still unassigned or unknown.',
    fallback: 'each person or team with what they own or approve',
  },

  mindmap: {
    view: 'mindmap',
    name: 'mind map',
    article: 'a',
    renderer: 'mermaid',
    header: 'mindmap',
    rules: `- Type: \`mindmap\`. The first indented line is the central topic; children are indented under their parent. Plain text nodes only: no shapes, no icons, no markdown.
- A mind map shows what belongs under what. It does not show cause or order; do not use it for a process.
- At most three levels and fourteen nodes; node labels of at most four words. Group only ideas that were actually raised.`,
    after: 'Then one or two sentences on how the groups relate.',
    fallback: 'the topics as a nested list',
  },

  timeline: {
    view: 'timeline',
    name: 'timeline',
    article: 'a',
    renderer: 'mermaid',
    header: 'timeline',
    rules: `- Type: \`timeline\`. An optional \`title\` line, then one line per period: 2021 : Joined Acme as engineer. Add a second event to the same period with a line that starts with a colon.
- Use only dates and an order that the conversation or the evidence gives. A period label may be a date, a year or a stated relative time ("Week 1"); never invent a date.
- If the events have no dates at all, do not use a timeline: give them as an ordered list and say the dates are not known.
- At most ten periods; each event at most eight words.`,
    after: 'Then one sentence on the overall arc, and one on any date that is uncertain.',
    fallback: 'the events as an ordered list',
  },

  gantt: {
    view: 'gantt',
    name: 'schedule',
    article: 'a',
    renderer: 'mermaid',
    header: 'gantt',
    rules: `- Type: \`gantt\`, then \`dateFormat YYYY-MM-DD\`. Group tasks under \`section\` lines. A task: Pilot :p1, 2026-10-05, 5d. A task that follows another: Rollout :r1, after p1, 10d. A milestone: Review :milestone, after r1, 0d.
- Every date and duration is one that was stated, or one you name as an estimate in the sentence before the block. If there are no real dates, do not invent a calendar: use relative milestones in a timeline or a process instead.
- Do not add \`axisFormat\`, \`click\` or \`todayMarker\`. At most twelve tasks.`,
    after: 'Then one or two sentences: what is confirmed, what is an estimate, and what the plan depends on. A schedule drawn here is not a commitment.',
    fallback: 'the tasks in order with their dates or durations',
  },

  matrix: {
    view: 'matrix',
    name: 'comparison table',
    article: 'a',
    renderer: 'table',
    rules: `- Write an ordinary Markdown table, not a fenced block. One row per item being compared or per requirement; one column per option or per kind of evidence.
- A cell holds what is known, in a few words. A cell nobody has evidence for says "unknown" — never a guess, and never a score that was not given.
- For requirements against evidence, use the columns: Requirement | Evidence | Status | Source, with Status one of: supported, partial, unknown. Missing evidence is not evidence of absence, and the table does not say so.
- Keep facts and preferences in separate columns or rows. At most eight rows and five columns.`,
    after: 'Then one or two sentences: what the table shows clearly, and what still needs evidence.',
    fallback: 'the comparison as a short list',
  },

  chart: {
    view: 'chart',
    name: 'chart',
    article: 'a',
    renderer: 'chart',
    rules: `- Write the chart as ONE fenced code block tagged \`natively-chart\` holding a single JSON object. The app draws it and does every calculation itself: you give inputs, never computed results.
- Fields: "type" ("line", "bar", "grouped-bar", "stacked-bar", "scatter", "waterfall", "heatmap", "funnel", "pie" or "quadrant"), "title", "x": {"label", "kind": "time" | "category" | "number", "values": […]}, "y": {"label", "unit"}, "series": [{"name", "status", "values": […], "source"}] with one value per x value, "assumptions": […], "sources": […].
- "status" says what the numbers are: "observed" (real data, with its "source"), "calculated" (with a "derivation"), "scenario" (with "assumptions"), or "illustrative" (a made-up example, shown labelled as one). A value that is not known is null, never 0.
- Other shapes take "status" at the top level: funnel → "stages": [{"label", "value"}] and "cohort"; pie → "parts": [{"label", "value"}] and "whole" (what the parts add up to); waterfall → "steps": [{"label", "value", "kind": "start" | "delta" | "total"}]; heatmap → "rows", "cols", "cells"; scatter and quadrant → "points": [{"label", "x", "y"}], and a quadrant also needs "quadrant": {"rubric", "xMin", "xMax", "yMin", "yMax", "labels"}.
- For anything computed, give "compute" instead of values: {"kind": "compound_growth", "baseline", "ratePercent", "period", "periods"} for constant NET growth per period; {"kind": "growth_with_churn", "baseline", "growthPercent", "churnPercent", "period", "periods"} when growth and churn are given separately; {"kind": "break_even", "initialCost", "periodSaving", "period", "periods"}; {"kind": "cumulative_net", "initialCost", "periodValues", "period"}; {"kind": "function", "expression", "min", "max"}. "compute" may be a list of up to four, to compare scenarios. "period" is day, week, month, quarter or year.
- Every number is one from the conversation, from the evidence in this turn, or a stated assumption. Never invent a baseline, a rate, a price, a count or a result. If a number the chart needs is missing, do NOT output a chart: say in one sentence which number is missing and answer in words.
- Compare like with like: one unit, one period and one cohort per axis. A line needs an ordered axis (time or a number); a pie needs parts of one stated whole.
- Do not quote calculated values in the prose: the chart and its table show them exactly.`,
    after: 'Then one or two sentences: what the chart shows and what it rests on. A scenario is arithmetic on its assumptions, never a prediction, a promise or a claim about cause.',
    fallback: 'the numbers as a short table',
  },

  chen: {
    view: 'chen',
    name: 'Chen-notation entity–relationship diagram',
    article: 'a',
    renderer: 'notation',
    rules: `- Write the model as ONE fenced code block tagged \`natively-diagram\` holding a single JSON object; the app draws real Chen notation from it (rectangles, diamonds, ovals). Do not use Mermaid for Chen notation.
- Shape: {"kind": "chen-er", "title": "…", "entities": [{"name": "Order", "attributes": [{"name": "order_id", "key": true}, {"name": "total", "derived": true}, {"name": "phones", "multivalued": true}, {"name": "address", "components": ["street", "city"]}]}], "relationships": [{"name": "places", "participants": [{"entity": "Customer", "cardinality": "1", "participation": "partial"}, {"entity": "Order", "cardinality": "N", "participation": "total"}]}]}
- "cardinality" is "1", "N" or "M" and belongs to that participant: Customer "1" and Order "N" means one customer, many orders. "participation": "total" means every instance takes part (drawn as a double line); "partial" means it is optional.
- A cardinality or a participation nobody stated is LEFT OUT of the JSON. It is then drawn without the mark and listed as open. Never guess one.
- A weak entity has "weak": true, a "partialKey": true attribute instead of a key, and a relationship to its owner marked "identifying": true. A relationship among three entities lists three participants. A relationship of an entity with itself lists it twice, each with a "role". A relationship may have its own "attributes".
- Only the entities the question needs; at most eight.`,
    after: 'Then read each relationship back in plain words, and name any constraint that is still open.',
    fallback: 'the entities, attributes and relationships in words',
  },

  automaton: {
    view: 'automaton',
    name: 'finite automaton',
    article: 'a',
    renderer: 'notation',
    rules: `- Write the automaton as ONE fenced code block tagged \`natively-diagram\` holding a single JSON object; the app checks it and draws it in standard notation (start arrow, double circle for accepting states). Do not use a Mermaid state diagram for an automaton.
- Shape: {"kind": "automaton", "type": "dfa", "title": "…", "alphabet": ["a", "b"], "states": ["q0", "q1"], "start": "q0", "accepting": ["q1"], "transitions": [{"from": "q0", "symbol": "a", "to": "q1"}]}
- "type" is "dfa" or "nfa". A DFA has exactly one target for every state and symbol and no ε-moves: give every state a transition on every symbol, adding a dead state if the language needs one. In an NFA "to" may be a list, and an ε-move is written "symbol": "ε".
- Every symbol on a transition is in "alphabet". Every state named anywhere is in "states".
- At most twelve states.`,
    after: 'Then two or three sentences: what each state remembers, and why exactly the strings of the language reach an accepting state.',
    fallback: 'the transition table in words',
  },
});

export const VISUAL_VIEWS = Object.freeze(Object.keys(VISUAL_CATALOG));

/** The registry entry for a view; architecture when the view is not known. */
/**
 * A flowchart laid out a particular way. Not views of their own: the block is
 * an ordinary Mermaid flowchart (lanes are subgraphs, a tree is top-down
 * with one parent per node), so the source policy, the renderer and the card
 * need nothing new. Only the wording of the contract differs.
 */
export const FLOWCHART_LAYOUTS = Object.freeze({
  lanes: Object.freeze({
    name: 'swimlane diagram',
    article: 'a',
    fallback: 'who does each step, in order',
    rules: `- Type: \`flowchart LR\`, drawn as SWIMLANES. One \`subgraph\` per lane, titled with who does the work (a person, a team or a system): subgraph sales["Sales"] … end. Two to five lanes, in the order the work first reaches them.
- Each step is one box inside the lane of whoever does it, in the order the steps happen. An arrow that crosses lanes is a handoff: label it with what is handed over. Never a step outside a lane.
- Four to twelve steps, each label at most five words. Only lanes and steps that belong to this process; a lane or a step nobody described is left out, not invented.
- Node ids and lane ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style); labels and lane titles in double quotes.
- ${MERMAID_PLAIN}`,
    after: 'Then two or three sentences: who does what, and where the handoffs are.',
  }),
  tree: Object.freeze({
    name: 'tree diagram',
    article: 'a',
    fallback: 'the levels as a nested list',
    rules: `- Type: \`flowchart TD\`, drawn as a TREE. One root at the top; every other node has exactly one parent and one arrow coming in, from that parent. No cross links and no cycles.
- Arrows are unlabelled unless the relation was stated ("reports to"). Things at the same level are siblings under the same parent.
- At most fifteen nodes, each label at most four words. Only what was named, or what the subject is known to contain; a level nobody named is left out, not invented.
- Node ids are short ASCII words, never a Mermaid keyword (end, graph, subgraph, class, style); labels in double quotes.
- ${MERMAID_PLAIN}`,
    after: 'Then one or two sentences: what sits at the top, and how it breaks down.',
  }),
});

export function visualKind(view) {
  return VISUAL_CATALOG[view] || VISUAL_CATALOG.architecture;
}

/** Is this one of the four original system-design views (whose contract text is unchanged)? */
export function isLegacyView(view) {
  return !VISUAL_CATALOG[view] || VISUAL_CATALOG[view].legacy === true;
}

/** The fence tag a view is written with, or '' for a Markdown table. */
export function fenceTagForView(view) {
  const kind = visualKind(view);
  return kind.renderer === 'table' ? '' : VISUAL_FENCE_TAG[kind.renderer === 'chart' ? 'chart' : kind.renderer === 'notation' ? 'notation' : 'mermaid'];
}

// ── what a chart turn is for ────────────────────────────────────────────────

/** One sentence that points a chart turn at the right shape and calculation. Static per intent. */
export const CHART_INTENT_RULE = Object.freeze({
  forecast:
    'This turn is a projection. Use "compute" with "compound_growth" (the rate is the NET rate per period), or "growth_with_churn" when growth and churn were given separately. It needs a starting value, a rate, the period the rate applies to and a number of periods: if any of them was not given, do not chart — name what is missing. Title it as a scenario at that rate.',
  breakeven:
    'This turn is a cost or savings calculation. Use "compute" with "break_even" (an up-front cost and a constant saving per period) or "cumulative_net" (a value per period). It needs the cost, the saving and how many periods to look at: if one was not given, do not chart — name what is missing. Savings are not revenue; say which this is.',
  funnel:
    'This turn compares stage counts. Use "type": "funnel" with a count for EVERY stage, all counting the same cohort over the same time window, and state that cohort in "cohort". Without counts this is a process, not a funnel: draw the stages as a flowchart instead and say the counts are not available.',
  trend:
    'This turn shows how something changed. Use "line" for a value over ordered time, bars for separate categories. It needs real observations with their period and unit; one value is not a trend.',
  breakdown:
    'This turn splits a total. Use bars, or "pie" only when the parts are mutually exclusive shares of one stated whole. Keep one currency or unit and one period.',
  comparison:
    'This turn compares quantities. Use "grouped-bar" with one series per thing compared, in one unit. If the things are not comparable numbers, use a table instead.',
  quadrant:
    'This turn places items on two scored axes. Use "quadrant" only with real scores and the rubric they came from in "quadrant.rubric". An item with no score is listed without "x" and "y", never given a position. Without scores, use a table.',
  function:
    'This turn plots a function. Use "compute" with "function" and the range to plot. It is exact arithmetic; do not add data points.',
  generic: 'Pick the chart type from what the numbers are: a line for ordered time, bars for categories, a funnel for stage counts.',
});

// ── modes ───────────────────────────────────────────────────────────────────

/**
 * What a mode adds to the honesty rules of a visual. Static per built-in mode
 * (the template identity from the mode policy registry, never a display name).
 * Each restates, for something DRAWN, a rule the mode already holds for what
 * is SAID: which sources may be used, and what must not be invented.
 */
export const VISUAL_MODE_NOTES = Object.freeze({
  general: '',
  'technical-interview': '',
  'looking-for-work':
    'Mode: facts about the user\'s career, projects and results come only from their résumé or profile and from what they said. Never invent a title, a date, an employer or an achievement number; leave a missing date or metric out. The spoken answer comes first and the visual stays compact.',
  sales:
    'Mode: product claims, prices, discounts, timelines and results come only from the product material and from what was said in this conversation. Never invent a price, an uplift or a commitment. The customer\'s current process is drawn as described and your proposal is marked as proposed. A projection is a scenario under stated assumptions, never a promise of results.',
  recruiting:
    'Mode: evidence about the candidate comes only from the candidate\'s own material and this interview, and requirements only from the job description — never from the user\'s own résumé or profile. Show evidence and what is still unknown. Do not score personality, emotion, any protected characteristic or overall suitability, and do not rate the candidate unless the user supplied the scores.',
  'team-meet':
    'Mode: reconstruct what was actually said. Keep decided, proposed, rejected and open items distinct, and show an owner or a date as unknown rather than guessing it.',
  lecture:
    'Mode: follow the lecture\'s own terms and notation. Anything added that was not in the lecture is labelled as an illustration.',
  seminar:
    'Mode: draw only what the reference material supports, and keep its citations. A detail the source does not give stays missing. General knowledge is labelled as such and is never presented as the paper\'s own result.',
  'call-center':
    'Mode: policy steps, eligibility, amounts and timelines come only from the authorised product or policy material and the customer\'s verified details. A check is marked done only if it was done on this call. Never invent an exception, a refund amount or a deadline. Drawing a status does not change the ticket.',
});

/** The mode's note for a visual, or '' (custom and unknown modes have none). */
export function visualModeNote(mode) {
  return Object.prototype.hasOwnProperty.call(VISUAL_MODE_NOTES, mode) ? VISUAL_MODE_NOTES[mode] : '';
}
