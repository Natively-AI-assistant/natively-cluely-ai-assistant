// The diagram output contract: the text every prompt path sends when a turn
// asks for a system design or a diagram.
//
// Two pieces, kept apart on purpose:
//
//   renderDiagramContract(signals)   STATIC. Built only from enumerated signals
//                                    (view, operation, output, basis, depth,
//                                    example ids), so it is safe in a cached /
//                                    registered system prompt — the number of
//                                    distinct texts is bounded.
//
//   renderDiagramTurnBlock(...)      DYNAMIC. The design already on the table
//                                    (its Mermaid source). Goes in the turn's
//                                    user content, never in the system prompt.
//
// One generation produces the whole answer — explanation and Mermaid in the
// same stream. Nothing here asks for a second model call.

import { DIAGRAM_EXAMPLES, selectDiagramExamples, renderDiagramExamplesBlock } from './diagramExamples.mjs';
import { visualKind, isLegacyView, fenceTagForView, visualModeNote, CHART_INTENT_RULE, FLOWCHART_LAYOUTS } from './visualCatalog.mjs';
import { VISUAL_FENCE_TAG } from './fencedBlocks.mjs';
import { normaliseChartSpec } from './chartSpec.mjs';
import { formatNumber } from './chartCompute.mjs';

export const DIAGRAM_CONTRACT_OPEN = '<diagram_contract>';
export const DIAGRAM_CONTRACT_CLOSE = '</diagram_contract>';

/** Targets stated to the model. The renderer's hard limits are larger (diagramPolicy). */
export const DIAGRAM_TARGETS = Object.freeze({ minComponents: 5, maxComponents: 10, maxNodes: 12, maxEdges: 20 });

/** Longest active-design source handed back to the model on a follow-up. */
export const ACTIVE_DESIGN_MAX_CHARS = 4000;
/** A chart or notation payload is handed back whole: this is its own source limit. */
const ACTIVE_PAYLOAD_MAX_CHARS = 12000;

const DETAILED_RE =
  /\b(?:detailed|in[- ]depth|thorough|comprehensive|complete|full|deep[- ]dive)\b[^.?!]{0,30}\b(?:design|architecture|walk-?through|answer|breakdown|explanation)\b|\bdeep dive\b|\bgo deep\b|\bin (?:full )?detail\b|\bwalk me through (?:the|your) (?:whole|full|entire)\b/i;

/** Did the user ask for the long, structured version? */
export function wantsDetailedDesign(question) {
  return DETAILED_RE.test(String(question ?? ''));
}

/**
 * Translate a resolved request into the bounded signal set a system prompt may
 * carry. Returns null when no contract applies to the turn.
 *
 * @param {import('./diagramRequest.mjs').DiagramRequest} request
 * @param {{ question?: string | null, maxExamples?: number }} [options]
 */
export function diagramPromptSignals(request, options = {}) {
  if (!request || !request.enabled) return null;
  const freshDesign = request.operation === 'create' && !request.parentArtifactId;
  const legacy = isLegacyView(request.view);
  // A reference example teaches representation. For the original design views
  // it rides only a proposed design (unchanged); for the catalog it also rides
  // a reconstruction, because the notation is what is being taught.
  const wantsExamples = freshDesign && request.output !== 'text-only' && (legacy ? request.basis === 'proposed-design' : true);
  const maxExamples = Number.isFinite(options.maxExamples) ? options.maxExamples : 1;
  // A calculation whose input nobody stated gets no reference: its numbers
  // are the ones a model reaches for (seen live: a 10,000 baseline, borrowed).
  const exampleIds = wantsExamples && !request.missingInput
    ? selectDiagramExamples({ question: options.question ?? '', view: request.view, mode: request.mode, chartIntent: request.chartIntent, max: maxExamples }).map((e) => e.id)
    : [];
  const signals = {
    view: request.view,
    operation: request.operation,
    output: request.output,
    basis: request.basis,
    withCode: request.withCode === true,
    hasParent: Boolean(request.parentArtifactId),
    depth: wantsDetailedDesign(options.question) ? 'detailed' : 'brief',
    exampleIds,
  };
  // Bounded additions, present only when they change the text: the built-in
  // mode (nine values), and what a chart turn is for (nine values).
  if (visualModeNote(request.mode)) signals.mode = request.mode;
  if (request.view === 'chart') signals.chartIntent = request.chartIntent || 'generic';
  if (request.missingInput && MISSING_INPUT_WORDS[request.missingInput]) signals.missingInput = request.missingInput;
  // Bounded additions again, each present only when it changes the text:
  //  - `general`: one of the four original views drawn for something that is
  //    not a system design ("draw the water cycle as a flowchart");
  //  - `contextual`: nobody asked for the visual, the task only implied it;
  //  - `followUp`: how the turn refers to the artifact on the table.
  //    An architecture is a system whoever asks for it; a sequence, a process
  //    or a state machine may be of anything.
  if (legacy && freshDesign && request.view !== 'architecture' && GENERAL_REASONS.has(request.reason)) signals.general = true;
  // A follow-up on a process flowchart (a workflow, a troubleshooting tree):
  // the thing on the table is not a system, so it is not edited in the words
  // of a system design ("5 to 10 components for a first design").
  if (legacy && request.parentArtifactId && request.view === 'flowchart' && request.operation !== 'alternative') signals.general = true;
  if (request.contextual === true) signals.contextual = true;
  if (request.parentArtifactId && (request.followUp === 'weak' || request.followUp === 'strong')) signals.followUp = request.followUp;
  //  - `layout`: a flowchart asked for in swimlanes or as a tree;
  //  - `ofChart`: a table that is the chart on the table, as numbers.
  if (request.view === 'flowchart' && (request.layout === 'lanes' || request.layout === 'tree')) signals.layout = request.layout;
  if (request.view === 'matrix' && request.parentArtifactId && request.parentFamily === 'chart') signals.ofChart = true;
  return signals;
}

function typeRule(view, layout) {
  if (view === 'flowchart' && layout === 'lanes') {
    return 'Type: `flowchart LR`, drawn as SWIMLANES. One `subgraph` per lane, titled with who does the work (a person, a team or a system): subgraph sales["Sales"] … end. Each step is a node inside the lane of whoever does it; an arrow that crosses lanes is a handoff, labelled with what is handed over. Two to five lanes, in the order the work first reaches them. Never a step outside a lane.';
  }
  if (view === 'flowchart' && layout === 'tree') {
    return 'Type: `flowchart TD`, drawn as a TREE. One root at the top; every other node has exactly one parent and one arrow coming in, from its parent. No cross links, no cycles, and no arrow labels unless the relation was stated. Siblings are the things at the same level.';
  }
  switch (view) {
    case 'sequence':
      return 'Type: `sequenceDiagram`. Declare the participants first, at most six, with short names. Order the messages by how the system calls itself, not by who spoke first. Show the failure branch with alt / else when there is one.';
    case 'state':
      return 'Type: `stateDiagram-v2`. Name the event on every transition and include the failure and cancel states. It is a visual model, not a formal proof.';
    case 'flowchart':
      return 'Type: `flowchart TD`, top to bottom, with each decision as its own node.';
    default:
      return 'Type: `flowchart LR`. Use `subgraph` only for a boundary the question states or that you name as an assumption.';
  }
}

function basisRule(basis) {
  if (basis === 'meeting-reconstruction') {
    return 'This diagram RECONSTRUCTS what was said in the conversation. Draw only components and connections someone described. When something was not agreed, put its status in the label: "Kafka (proposed)", "Redis (rejected)", "Auth (unknown)". "Maybe Kafka" is a proposal, not a decision. If the conversation does not describe a system, say so in one sentence and draw only what is known.';
  }
  if (basis === 'source-reconstruction') {
    return 'This diagram RECONSTRUCTS the actual system from the evidence in this turn (documents, files, the screen). Draw only what the evidence shows, mark anything you infer as "(assumed)", and name what is unknown. If the evidence does not describe the architecture, say so plainly and do not substitute a generic design.';
  }
  return 'The diagram shows a PROPOSED design. Do not imply the other person agreed to it.';
}

const DIAGRAM_RULES = (view, layout) => `Diagram rules:
- ${typeRule(view, layout)}
- Size: ${DIAGRAM_TARGETS.minComponents} to ${DIAGRAM_TARGETS.maxComponents} meaningful components for a first design, never more than ${DIAGRAM_TARGETS.maxNodes} nodes or ${DIAGRAM_TARGETS.maxEdges} connections. Leave out infrastructure the question does not need.
- Node ids are short ASCII words (letters, digits, underscore), never a Mermaid keyword (end, graph, subgraph, class, style, click, call): write social_graph, not graph. Labels are short and in double quotes: api["API Service"]. One node per component, never two nodes for the same thing.
- Label a connection with its protocol, event or condition when that matters, in one to three words: api -->|"enqueue"| queue.
- It is shown in a small card, so keep it readable at a glance: node labels of at most three words, no path longer than five nodes, and the fewest components that answer the question.
- Plain Mermaid only: no %%{init}%% directive, no frontmatter, no click or link statement, no HTML tag, no image or icon, no classDef or style line.`;

const HONESTY_RULES = (basis) => `Honesty rules:
- ${basisRule(basis)}
- Never present an invented number (users, requests per second, regions, latency, an SLA) as a stated requirement. If you need one, write it as "Assuming …".
- A requirement nobody stated may be an explicitly labelled assumption. Do not stop to ask a clarifying question first unless the user asked for one.`;

function explanationStep(signals, surface) {
  if (signals.depth === 'detailed') {
    return 'A structured explanation, because the user asked for a detailed design: requirements and assumptions, the components and what each owns, the data flow, scaling and reliability, and the tradeoffs. Short labelled sections are fine here.';
  }
  if (surface === 'chat') {
    return 'A brief explanation: the main components and how data flows, what happens at scale or on failure, and the main tradeoff. A few short labelled lines are fine; keep it compact.';
  }
  return 'A brief explanation in plain spoken sentences: the main components and how data flows, what happens at scale or on failure, and the main tradeoff. Short enough to say aloud. No headings.';
}

function codeStep(signals) {
  return signals.withCode
    ? '\nThe turn ALSO asks for code. After the diagram and its explanation, give the code in its own fenced block tagged with its programming language, following the coding rules in this prompt. Keep both the diagram and the code. Mermaid is a diagram, never code to run or test.'
    : '';
}

function examplesBlock(signals) {
  if (!signals.exampleIds || signals.exampleIds.length === 0) return '';
  const examples = signals.exampleIds.map((id) => DIAGRAM_EXAMPLES.find((e) => e.id === id)).filter(Boolean);
  const block = renderDiagramExamplesBlock(examples);
  if (!block) return '';
  // A reference that had facts to draw from reads, to a model with none, as
  // "draw something like this anyway" (seen live: a placeholder career timeline).
  const caveat = FACT_BASES.has(signals.basis) && !signals.hasParent && !isLegacyView(signals.view)
    ? '\nThe reference had its facts in front of it. When this turn has none, its shape does not apply: answer without a block.'
    : '';
  return `\n\n${block}${caveat}`;
}

const PRECEDENCE =
  'This contract decides the shape of the answer. It outranks every default answer shape, section template, sentence count and word limit stated anywhere else in this prompt or in the turn; those limits still govern the prose and never the diagram. A fenced `mermaid` block is required output here, not optional decoration.';

/**
 * The static contract for a turn.
 *
 * @param {NonNullable<ReturnType<typeof diagramPromptSignals>>} signals
 * @param {{ tier?: 'cloud' | 'local', surface?: 'live' | 'chat' }} [options]
 */
export function renderDiagramContract(signals, options = {}) {
  if (!signals) return '';
  const tier = options.tier === 'local' ? 'local' : 'cloud';
  const surface = options.surface === 'chat' ? 'chat' : 'live';
  // A system design in one of the four original views is told exactly what it
  // always was. Anything else — including those views drawn for something
  // that is not a system — gets the catalog body for its kind.
  const legacy = isLegacyView(signals.view) && signals.general !== true;
  let body;
  if (legacy) body = tier === 'local' ? localBody(signals) : cloudBody(signals, surface);
  else body = tier === 'local' ? catalogLocalBody(signals) : catalogBody(signals, surface);
  if (signals.hasParent && signals.operation !== 'alternative') body = `${body}\n${NOT_ABOUT_IT}`;
  // What the mode adds for something drawn (which sources, what is never invented).
  const modeNote = visualModeNote(signals.mode);
  if (modeNote && drawsSomething(signals)) body = `${body}\n\n${modeNote}`;
  // Last, so it is the freshest rule: an input nobody stated.
  if (!isLegacyView(signals.view) && drawsSomething(signals)) body = `${body}${missingInputRule(signals)}`;
  // Reference examples cost tokens a small local model cannot spare.
  const examples = tier === 'local' ? '' : examplesBlock(signals);
  return `${DIAGRAM_CONTRACT_OPEN}\n${body}${examples}\n${DIAGRAM_CONTRACT_CLOSE}`;
}

function drawsSomething(signals) {
  return signals.operation !== 'explain' && signals.operation !== 'refine' && signals.output !== 'text-only';
}

// ── the wider catalog (ER, class, charts, timelines, …) ─────────────────────
//
// One body for every non-system-design visual. It is assembled from the
// capability registry (visualCatalog.mjs), so a model only ever sees the rules
// of the ONE kind this turn needs.

function catalogHonesty(signals) {
  const { basis, view } = signals;
  const isChart = view === 'chart';
  // A table of the chart's own numbers states nothing new: its honesty is the chart's.
  if (signals.ofChart) {
    return `Honesty rules:
- The numbers are the chart's own, computed by the app from the inputs the chart states. Add none, and change none.
- If the chart is a projection or a scenario, the table is one too: say so in the sentence after it, and never present the numbers as results or as a promise.`;
  }
  let first;
  if (basis === 'meeting-reconstruction') {
    first = 'This RECONSTRUCTS what was said in the conversation. Include only what someone actually described, and put the status of anything unsettled in its label: "(proposed)", "(rejected)", "(unknown)". If the conversation does not contain it, say so in one sentence instead of filling it in.';
  } else if (basis === 'source-reconstruction') {
    first = 'This RECONSTRUCTS what the evidence in this turn shows (documents, files, the screen). Include only what the evidence shows, mark anything you infer as "(assumed)", and name what is unreadable or missing. If the evidence does not contain it, do NOT output the block: say so plainly. A generic or placeholder one is worse than none.';
  } else if (basis === 'evidence') {
    first = `This shows FACTS about the people and the work in this conversation. Include only what the conversation and the material in this turn actually contain; anything you add from general knowledge is marked "(suggested)". If the facts it needs are not there at all, do NOT output the block: ${signals.contextual ? 'answer the question in words instead' : 'say in one sentence what is missing and ask for it'}. A placeholder drawing of generic or made-up items is worse than none.`;
  } else if (basis === 'scenario') {
    first = 'This is a SCENARIO: arithmetic on stated inputs under stated assumptions. List the assumptions in "assumptions", say in the prose that it is a scenario, and never present it as a prediction, a promise, or proof that one thing caused another.';
  } else if (basis === 'observed-data') {
    first = `These are meant to be REAL numbers. Every value must come from the conversation or the evidence in this turn, with where it came from in "source" or "sources". If the numbers are not there, do not chart and do not estimate: ${signals.contextual ? 'answer the question in words instead, without mentioning a chart' : 'say which numbers are missing'}.`;
  } else if (basis === 'calculated') {
    first = 'The values follow from the formula alone. Do not add data points of your own.';
  } else if (basis === 'illustrative') {
    first = isChart
      ? 'The user asked for an EXAMPLE. Use plainly made-up values, set "status" to "illustrative", and say in the prose that the numbers are illustrative. Never present them as this conversation\'s real figures.'
      : 'The user asked for an EXAMPLE. Say in the opening sentence that it is an illustrative example, and never present it as this conversation\'s real situation.';
  } else {
    first = 'This is a PROPOSED structure. Do not present it as something the other person agreed to, or as how things already are.';
  }
  return `Honesty rules:
- ${first}
- Never present an invented number, date, name or commitment as something that was stated. If you need one, write it as "Assuming …".
- Passing the notation rules makes it drawable, not true: draw only what you can support.`;
}

/** Requests for a drawing that are not a request for a system design. */
const GENERAL_REASONS = new Set(['explicit_request', 'explicit_visual', 'contextual_visual']);

// A follow-up contract is in force because the turn LOOKED like it was about
// the artifact on the table. When it is not ("is this a remote role?" right
// after a diagram), the model has to be free to just answer.
const NOT_ABOUT_IT =
  'If the turn is plainly about something else and not about what is on the table, ignore this contract and <active_design> entirely and answer the question as you normally would.';

// What a calculation lacks, in the words the model and the user are given.
const MISSING_INPUT_WORDS = {
  baseline: 'a starting value',
  rate: 'a growth rate',
  period: 'the period the rate applies to, or how far ahead to look',
  amounts: 'the cost and the saving per period',
};

function missingInputRule(signals) {
  const words = MISSING_INPUT_WORDS[signals.missingInput];
  if (!words) return '';
  // (A question about a projection asks for the calculation whether or not
  // it names a chart, so the missing input is asked for either way.)
  return `\n\nCHECKED BEFORE THIS TURN: the request does not state ${words}, and none was found in the conversation so far. If the material in this turn does state it, use exactly that and say where it comes from. Otherwise output NO \`natively-chart\` block at all: say that the calculation needs ${words}, and ask for it. Never supply one of your own, not even as an illustration, a sample or a placeholder.`;
}

// Bases where the visual states facts: with no facts, the answer is prose only.
const FACT_BASES = new Set(['evidence', 'meeting-reconstruction', 'source-reconstruction', 'observed-data']);

function catalogArtifactStep(signals, tag) {
  const step = catalogArtifactStepText(signals, tag);
  if (!FACT_BASES.has(signals.basis) || signals.hasParent) return step;
  // Asked for a visual that cannot be drawn: say what is missing. Not asked
  // for one (the task only implied it): the person wants their answer, not a
  // question back about a chart they never mentioned.
  const without = signals.contextual
    ? 'Just answer in words; do not mention a chart or missing data.'
    : 'Say what is missing and ask for it.';
  return `${step} ONLY when the facts it needs are in the conversation or the material in this turn. When they are not, skip this step entirely: no block, no table, no placeholder, no outline of generic stages. ${without}`;
}

function catalogArtifactStepText(signals, tag) {
  const kind = kindFor(signals);
  if (signals.ofChart) return 'The Markdown table: the rows under "Values" in <active_design>, copied exactly. It comes early, before the explanation.';
  if (kind.renderer === 'table') return 'The comparison as a Markdown table. It comes early, before the explanation.';
  if (kind.renderer === 'chart') return 'One fenced code block tagged `natively-chart` holding the chart as JSON. It comes early, before the explanation. Exactly one chart unless the user asked for more.';
  if (kind.renderer === 'notation') return `One fenced code block tagged \`natively-diagram\` holding the ${kind.name} as JSON. It comes early, before the explanation.`;
  return `One fenced code block tagged \`${tag}\` holding the complete ${kind.name}. It comes early, before the explanation. Exactly one block unless the user asked for more than one view.`;
}

// "Show the chart as a table": the app computed those numbers and drew them.
// A model that recalculated a compound-growth forecast would print a table
// that disagrees with the chart beside it, so the rows are handed over (see
// `chartValuesBlock`) and the table is a copy.
const CHART_TABLE_RULES = `- This table is the chart already on the table, as numbers. The values the app computed and drew are listed under "Values" in <active_design> in the turn: copy them exactly. The same column names, the same row labels, the same numbers, in the same order, every row.
- Do not recalculate, round, extend, or add a row or a column of your own.
- Write an ordinary Markdown table, not a fenced block: the header row, then the separator row (| --- | --- |), then one row per line, exactly as "Values" is written.
- If <active_design> holds no "Values", say that the numbers cannot be listed here and output no table.`;
const CHART_TABLE_KIND = Object.freeze({
  name: 'table of the chart\u2019s numbers',
  article: 'a',
  rules: CHART_TABLE_RULES,
  after: 'Then one sentence on what the numbers show, quoting no number that is not in the table.',
  fallback: 'the numbers as a short list, copied from "Values"',
});

/** The catalog entry for this turn: the view's own, or the chart-as-table variant. */
function kindFor(signals) {
  const kind = visualKind(signals.view);
  if (signals.ofChart) return { ...kind, ...CHART_TABLE_KIND };
  if (signals.view === 'flowchart' && signals.layout && FLOWCHART_LAYOUTS[signals.layout]) return { ...kind, ...FLOWCHART_LAYOUTS[signals.layout] };
  return kind;
}

function catalogRules(signals) {
  const kind = kindFor(signals);
  // An example the user asked for may use made-up inputs; a projection of
  // their own numbers may not.
  const example = signals.basis === 'illustrative' && (signals.chartIntent === 'forecast' || signals.chartIntent === 'breakeven');
  const rule = example
    ? 'This turn is an EXAMPLE calculation. Use "compute" as for a real one. An input the user did not give may be a plainly made-up round number: list each made-up input in "assumptions" with the word "illustrative", and say in the prose that the numbers are an example.'
    : CHART_INTENT_RULE[signals.chartIntent] || CHART_INTENT_RULE.generic;
  const intent = signals.view === 'chart' ? `\n- ${rule}` : '';
  return `Rules for the ${kind.name}:\n${kind.rules}${intent}`;
}

function catalogBody(signals, surface) {
  const { view, operation, output } = signals;
  const kind = kindFor(signals);
  const tag = fenceTagForView(view);
  const block = tag ? `\`${tag}\` block` : 'table';
  // Where the visual states facts, it is owed only when the facts exist: a
  // model told a block is "required" draws a placeholder rather than none.
  const owed = FACT_BASES.has(signals.basis) && !signals.hasParent
    ? `The ${block} is required output here when the facts it needs are present, and forbidden when they are not: an answer that says what is missing, with no ${block}, is then the correct and complete answer.`
    : `The ${block} is required output here unless these rules tell you not to produce one.`;
  const precedence = tag
    ? `This contract decides the shape of the answer. It outranks every default answer shape, section template, sentence count and word limit stated anywhere else in this prompt or in the turn; those limits still govern the prose and never the ${block}. ${owed}`
    : 'This contract decides the shape of the answer. It outranks every default answer shape, section template, sentence count and word limit stated anywhere else in this prompt or in the turn; those limits govern the prose and never the table.';

  if (operation === 'explain' || (output === 'text-only' && signals.hasParent)) {
    const values = view === 'chart'
      ? '\nWhen you state a value from it, quote it from "Values" in <active_design>: those are what the app computed and drew. Do not recalculate them. A value that list does not hold (a later period, another rate) was not computed here: say so, and give it only as your own estimate, called one.'
      : '';
    return `This turn is a question about the ${kind.name} already on the table, given in <active_design> in the turn.
Answer the question in prose, grounded in what it actually contains. Do NOT output a ${block} or any other visual; the one on screen stays exactly as it is. If the honest answer is that it must change, say what would change in one sentence.${values}`;
  }

  if (operation === 'refine') {
    return `The previous answer contains a ${kind.name}: a fenced ${block} (also given in <active_design> in the turn when present). The user asked to change the WORDING of the answer (shorter, simpler, rephrased), not the ${kind.name}.
Apply the request to the prose only. Reproduce the ${block} exactly as given, character for character, in the same place in the answer. Do not add, remove, round, rename or reorder anything inside it.`;
  }

  if (output === 'text-only') {
    return `This turn would normally get ${kind.article} ${kind.name}, and the user asked for NO visual.
Do not output a fenced ${tag || 'visual'} block, a table drawn with characters, or any other diagram or chart. Give ${kind.fallback} in plain prose.

${catalogHonesty(signals)}`;
  }

  if (output === 'source-only' && tag) {
    return `The user asked for the SOURCE TEXT only, not a drawing.
Output exactly one fenced code block whose info string is \`${tag} source\`, containing the complete ${kind.name}. No sentence before it and none after it.${signals.hasParent ? ' The current one is given in <active_design> in the turn; start from it.' : ''}

${catalogRules(signals)}

${catalogHonesty(signals)}`;
  }

  if (output === 'diagram-only') {
    return `The user asked for the ${kind.name} only.
Output exactly ${tag ? `one fenced code block tagged \`${tag}\`` : 'the Markdown table'}. No sentence before it and none after it.${signals.hasParent ? ' The current one is given in <active_design> in the turn; start from it.' : ''}

${catalogRules(signals)}

${catalogHonesty(signals)}`;
  }

  if (operation === 'update') {
    return `This turn changes the ${kind.name} already on the table. Its current source is given in <active_design> in the turn. ${precedence}

Answer in this order:
1. One sentence: what changes.
2. The FULL updated ${block}. Start from the current one, keep everything that does not change exactly as it is, and apply only the requested change${view === 'chart' ? ' (for a calculation: change the one input that was asked about, nothing else)' : ''}. Never answer with a fragment or a diff.
3. One sentence on what the change does${view === 'chart' ? ', without quoting calculated values' : ''}.

${catalogRules(signals)}

${catalogHonesty(signals)}`;
  }

  const lead = signals.ofChart
    ? `This turn asks for the chart that is already on the table as a table of its numbers. The chart and the values the app computed from it are given in <active_design> in the turn. ${precedence}`
    : signals.hasParent
    ? `This turn asks for ${kind.article} ${kind.name} of what is already on the table, given in <active_design> in the turn. Show THAT subject, under the same names; do not invent a different one. ${precedence}`
    : `This turn asks for ${kind.article} ${kind.name}. ${precedence} If the turn turns out not to need one at all, ignore this block.`;

  const explain = surface === 'chat' || signals.depth === 'detailed'
    ? kind.after
    : `${kind.after} Plain spoken sentences, short enough to say aloud. No headings.`;

  return `${lead}

Answer in this order:
1. One or two sentences: the direct answer to what was asked.
2. ${catalogArtifactStep(signals, tag)}
3. ${explain}${codeStep(signals)}

${catalogRules(signals)}

${catalogHonesty(signals)}`;
}

function catalogLocalBody(signals) {
  const { view, operation, output } = signals;
  const kind = kindFor(signals);
  const tag = fenceTagForView(view);
  const block = tag ? `\`${tag}\` block` : 'Markdown table';
  if (operation === 'explain' || (output === 'text-only' && signals.hasParent)) return `Answer the question about the ${kind.name} in <active_design> in prose. Do not output a ${block}.${view === 'chart' ? ' Quote values from "Values" there; do not recalculate them.' : ''}`;
  if (operation === 'refine') return `Change only the wording of the previous answer. Copy the ${block} from <active_design> exactly, unchanged, into the same place.`;
  if (output === 'text-only') return `No visual wanted: give ${kind.fallback} in prose. Do not invent numbers, dates or names.`;
  const honesty = 'Never invent a number, a date or a name; if something needed is missing, say so instead of drawing it.';
  // What it is drawn from, when it is drawn from what is on the table.
  const from = signals.hasParent && operation !== 'update' ? ' It is of what is already on the table, given in <active_design>: the same subject, under the same names.' : '';
  // "Diagram only" and "just the source" hold on a small model too.
  if (output === 'source-only' && tag) return `Output only one fenced block with the info string \`${tag} source\` holding the complete ${kind.name}. No other text.${from}\n${catalogRules(signals)}\n${honesty}`;
  if (output === 'diagram-only') return `Output only ${tag ? `one fenced ${block}` : 'the Markdown table'} with the ${kind.name}. No other text.${from}\n${catalogRules(signals)}\n${honesty}`;
  const code = signals.withCode ? ' Then the code that was asked for, in its own fenced block with its language tag.' : '';
  const lead = operation === 'update'
    ? `Update the ${kind.name} in <active_design>: one sentence on what changes, then the FULL updated ${block} with only that change, then one sentence on its effect.${code}`
    : `Visual turn. This shape outranks any sentence or word limit, which applies to the prose only. Answer in this order: one or two sentences answering the question; then ${tag ? `one fenced ${block}` : 'a Markdown table'} with the ${kind.name}; then two plain sentences on what it shows.${from}${code}`;
  return `${lead}\n${catalogRules(signals)}\n${honesty}`;
}

function cloudBody(signals, surface) {
  const { view, operation, output, basis } = signals;

  if (operation === 'explain' || (output === 'text-only' && signals.hasParent)) {
    return `This turn is a question about the design already on the table. Its current diagram is given in <active_design> in the turn.
Answer the question in prose, grounded in that design: name the components it actually has. Do NOT output a mermaid block or any other diagram; the diagram on screen stays exactly as it is. If the honest answer is that the design must change, say what would change in one sentence.`;
  }

  if (operation === 'refine') {
    return `The previous answer contains a diagram: a fenced \`mermaid\` block (also given in <active_design> in the turn when present). The user asked to change the WORDING of the answer (shorter, simpler, rephrased), not the design.
Apply the request to the prose only. Reproduce the mermaid block exactly as given, character for character, in the same place in the answer. Do not add, remove, rename or reorder anything inside it.`;
  }

  if (output === 'text-only') {
    return `This turn asks for a system design, and the user asked for NO diagram.
Do not output a mermaid block, ASCII art or any other diagram. Give the design in prose: the approach and its assumptions, the main components and how data flows, what happens at scale or on failure, and the main tradeoff.${codeStep(signals)}

${HONESTY_RULES(basis)}`;
  }

  if (output === 'source-only') {
    return `The user asked for the Mermaid SOURCE TEXT only, not a drawing.
Output exactly one fenced code block whose info string is \`mermaid source\`, containing the complete Mermaid text. No sentence before it and none after it.${signals.hasParent ? ' The current design is given in <active_design> in the turn; start from it.' : ''}

${DIAGRAM_RULES(view, signals.layout)}

${HONESTY_RULES(basis)}`;
  }

  if (output === 'diagram-only') {
    return `The user asked for the diagram only.
Output exactly one fenced code block tagged \`mermaid\` containing the complete diagram. No sentence before it and none after it. Put assumptions in node or edge labels if they matter.${signals.hasParent ? ' The current design is given in <active_design> in the turn; start from it.' : ''}

${DIAGRAM_RULES(view, signals.layout)}

${HONESTY_RULES(basis)}`;
  }

  if (operation === 'alternative') {
    return `The active task is a system design; its current diagram is given in <active_design> in the turn. This turn asks for alternatives to it. ${PRECEDENCE}

Answer in this order:
1. Two or three genuinely different approaches, one or two sentences each, with the tradeoff that separates it from the current design.
2. One fenced code block tagged \`mermaid\` drawing the ONE alternative you would pick. Reuse the current design's component names where the component is the same.
3. One sentence on when you would stay with the current design instead.

${DIAGRAM_RULES(view, signals.layout)}

${HONESTY_RULES(basis)}`;
  }

  if (operation === 'update') {
    return `This turn changes the design already on the table. Its current diagram is given in <active_design> in the turn. ${PRECEDENCE}

Answer in this order:
1. One sentence: what changes and why.
2. The FULL updated diagram in one fenced code block tagged \`mermaid\`. Start from the current diagram, keep every node id and label that does not change, and apply only the requested change. Never answer with a fragment or a diff.
3. One or two sentences on what the change costs or buys.${codeStep(signals)}

${DIAGRAM_RULES(view, signals.layout)}

${HONESTY_RULES(basis)}`;
  }

  const lead = signals.hasParent
    ? `This turn asks for another view of the design already on the table, given in <active_design> in the turn. Draw the requested view of THAT system: the same components under the same names. Do not design a different system. ${PRECEDENCE}`
    : `This turn asks for a system design or a diagram. ${PRECEDENCE} If the turn turns out not to be about a design or a diagram at all, ignore this block.`;

  return `${lead}

Answer in this order:
1. One or two sentences: the approach, and the assumptions it rests on.
2. One fenced code block tagged \`mermaid\` holding the complete diagram. It comes early, before the detailed explanation. Exactly one mermaid block unless the user asked for more than one view.
3. ${explanationStep(signals, surface)}${codeStep(signals)}

${DIAGRAM_RULES(view, signals.layout)}

${HONESTY_RULES(basis)}`;
}

// Small local models follow one short paragraph better than numbered laws.
function localBody(signals) {
  const { view, operation, output, basis } = signals;
  const type = view === 'sequence' ? 'sequenceDiagram'
    : view === 'state' ? 'stateDiagram-v2'
    : view === 'flowchart' && signals.layout === 'lanes' ? 'flowchart LR (swimlanes: one `subgraph` per person, team or system, each step inside the lane of whoever does it, arrows across lanes for handoffs)'
    : view === 'flowchart' && signals.layout === 'tree' ? 'flowchart TD (a tree: one root, every other node under exactly one parent, no cross links)'
    : view === 'flowchart' ? 'flowchart TD' : 'flowchart LR';
  const honesty = basis === 'proposed-design'
    ? 'This is a proposed design; write any number nobody stated as "Assuming …".'
    : 'Draw only what the conversation or evidence actually describes; mark the rest "(assumed)" or "(proposed)".';

  if (operation === 'explain' || (output === 'text-only' && signals.hasParent)) {
    return 'Answer the question about the design in <active_design> in prose. Do not output a mermaid block.';
  }
  if (operation === 'refine') {
    return 'Change only the wording of the previous answer. Copy the mermaid block from <active_design> exactly, unchanged, into the same place.';
  }
  if (output === 'text-only') {
    return `System design turn, no diagram wanted: describe the approach, components, data flow, scaling and the main tradeoff in prose. No mermaid block. ${honesty}`;
  }
  if (output === 'source-only') {
    return `Output only one fenced block with the info string \`mermaid source\` holding a ${type} diagram. No other text. Short quoted labels, at most ${DIAGRAM_TARGETS.maxNodes} nodes. ${honesty}`;
  }
  if (output === 'diagram-only') {
    return `Output only one fenced \`mermaid\` block holding a ${type} diagram. No other text. Short quoted labels, at most ${DIAGRAM_TARGETS.maxNodes} nodes, no directives, no HTML. ${honesty}`;
  }
  if (operation === 'alternative') {
    return `Give two or three different approaches to the design in <active_design>, one sentence each with its tradeoff, then ONE fenced \`mermaid\` block (${type}) drawing the alternative you would pick. ${honesty}`;
  }
  if (operation === 'update') {
    return `Update the design in <active_design>: one sentence on what changes, then the FULL updated diagram in one fenced \`mermaid\` block (${type}, same node ids where unchanged), then one sentence on the tradeoff. ${honesty}`;
  }
  return `Diagram turn. This shape outranks any sentence or word limit, which applies to the prose only. Answer in this order: one or two sentences on the approach and assumptions; then one fenced \`mermaid\` block with a ${type} diagram (${DIAGRAM_TARGETS.minComponents}-${DIAGRAM_TARGETS.maxComponents} components, short ASCII ids, short labels in double quotes like api["API Service"], no directives, no HTML, no styling); then two or three plain sentences on data flow, scaling and the main tradeoff.${signals.hasParent ? ' Draw the system in <active_design>, same component names.' : ''}${signals.withCode ? ' Then the requested code in its own fenced block tagged with its language.' : ''} ${honesty}`;
}

/**
 * The artifact as it is handed back, and whether it had to be cut.
 * A chart or notation payload is JSON: half of one is not a payload, so it is
 * given whole (its own adapter caps it at a size that fits) or not at all.
 */
function clampSource(source, artifact) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n').trim();
  if (artifact === 'chart' || artifact === 'notation') return { text: text.length <= ACTIVE_PAYLOAD_MAX_CHARS ? text : '', truncated: false };
  if (text.length <= ACTIVE_DESIGN_MAX_CHARS) return { text, truncated: false };
  // Cut on a line boundary so the model never sees half a statement.
  const cut = text.slice(0, ACTIVE_DESIGN_MAX_CHARS);
  const lastNewline = cut.lastIndexOf('\n');
  return { text: (lastNewline > 0 ? cut.slice(0, lastNewline) : cut).trimEnd(), truncated: true };
}

/**
 * The dynamic block for the turn's user content: the design on the table.
 * Returns '' when the request does not need it.
 *
 * @param {import('./diagramRequest.mjs').DiagramRequest} request
 * @param {{ source?: string, view?: string, version?: number, question?: string } | null | undefined} activeDesign
 */
export function renderDiagramTurnBlock(request, activeDesign) {
  if (!request || !request.attachActiveDesign || !activeDesign || !activeDesign.source) return '';
  const clamped = clampSource(activeDesign.source, activeDesign.artifact);
  // Nothing in the artifact's own text may close the wrapper it is quoted in,
  // open another one, or close the contract.
  const source = clamped.text.replace(/<(\/?)(active_design|diagram_contract|conversation_so_far)/gi, '<\u200b$1$2');
  if (!source) return '';
  const about = activeDesign.question ? `\nIt was drawn for: ${String(activeDesign.question).replace(/\s+/g, ' ').replace(/<\/?(?:active_design|diagram_contract)[^>]*>?/gi, '').trim().slice(0, 200)}` : '';
  // Told plainly: "keep every node" cannot be asked of a diagram shown in part.
  const partial = clamped.truncated ? '\nOnly the first part of it fits here. Describe a change to it in words rather than redrawing it from this part.' : '';
  const noun = activeDesign.artifact === 'chart' ? 'chart' : activeDesign.artifact === 'notation' ? 'diagram' : 'design';
  const note = request.enabled
    ? `This is the ${noun} currently on the table. It is the starting point for this turn, as the diagram contract describes.`
    : `This is the ${noun} currently on the table. The request refers to it: keep ${noun === 'chart' ? 'its names and numbers' : 'component names'} consistent with it. Do not redraw it.`;
  // What the app computed from a chart, for the turns that state its values:
  // a question about it, a table of it, a request that only refers to it. (Not
  // an edit: those values are about to change, and must not be quoted.)
  const values = activeDesign.artifact === 'chart' && (request.operation === 'explain' || request.view === 'matrix' || !request.enabled)
    ? chartValuesBlock(clamped.text)
    : '';
  // A fence that no line of the source can close: one backtick longer than
  // the longest run it holds. (Choosing between ``` and ~~~~ was closed early
  // by a source holding both.)
  const longestRun = (source.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  // Written with the tag it was written in: a chart payload is not Mermaid.
  const tag = VISUAL_FENCE_TAG[activeDesign.artifact] || 'mermaid';
  return `<active_design view="${activeDesign.view || request.view}" version="${Number(activeDesign.version) || 1}">
${note}${about}${partial}
${fence}${tag}
${source}
${fence}${values}
</active_design>`;
}

const CHART_VALUES_MAX_ROWS = 61;
const CHART_VALUES_MAX_COLS = 8;
const CHART_VALUES_MAX_CHARS = 4000;

/**
 * The table the app computed from a chart payload, as text for the model:
 * the same rows the card draws and the CSV export writes. '' when the payload
 * does not compile, holds no table, or is too large to quote whole (a part of
 * a table would be read as all of it).
 */
export function chartValuesBlock(source) {
  let result;
  try {
    result = normaliseChartSpec(source);
  } catch {
    return '';
  }
  const table = result && result.ok ? result.table : null;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return '';
  if (table.rows.length === 0 || table.columns.length < 2 || table.columns.length > CHART_VALUES_MAX_COLS) return '';
  // A long series (a ten-year monthly forecast, a plotted function) is quoted
  // as every Nth row, first and last included, and says so: told there were
  // "no values", a model answered that the numbers could not be listed.
  let rows = table.rows;
  let sampled = '';
  if (rows.length > CHART_VALUES_MAX_ROWS) {
    const step = Math.ceil((rows.length - 1) / (CHART_VALUES_MAX_ROWS - 1));
    const kept = rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
    sampled = ` These are every ${step}${step === 2 ? 'nd' : step === 3 ? 'rd' : 'th'} row of ${rows.length}, with the first and the last: say so when you use them, and give no value for a row that is not here.`;
    rows = kept;
  }
  // Nothing in a cell may end the row, close the wrapper, or pass for markup.
  const cell = (value) => (typeof value === 'number' ? formatNumber(value) : String(value ?? ''))
    .replace(/[|\n\r`]/g, ' ')
    .replace(/</g, '<\u200b')
    .trim()
    .slice(0, 60);
  // A Markdown table as it must be WRITTEN, separator row and all: asked to
  // copy these rows exactly, a model copies their form too, and a table with
  // no "| --- |" row under its header is shown as lines of pipes (seen in the
  // app, 2026-10-02: right numbers, no table).
  const lines = [
    `| ${table.columns.map(cell).join(' | ')} |`,
    `| ${table.columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
  const text = lines.join('\n');
  if (text.length > CHART_VALUES_MAX_CHARS) return '';
  return `\nValues (what the app computed from it and drew, as a Markdown table; quote these exactly, never recalculated or rounded differently).${sampled}\n${text}`;
}

/**
 * One line for the turn's user content, next to the question: says the system
 * prompt's diagram contract is in force for THIS turn and what that means for
 * any length limit stated beside it. Static per signal set.
 */
export function renderDiagramTurnNote(signals) {
  if (!signals) return '';
  if (!isLegacyView(signals.view)) return catalogTurnNote(signals);
  const drawsDiagram = signals.output !== 'text-only' && signals.operation !== 'explain';
  if (!drawsDiagram) {
    return 'The diagram contract in the system prompt applies to this turn: answer in prose and do not output a diagram.';
  }
  if (signals.operation === 'refine') {
    return 'The diagram contract in the system prompt applies to this turn: change the wording only and keep the Mermaid block exactly as it is. Any sentence or word limit governs the prose, never the block.';
  }
  return 'The diagram contract in the system prompt applies to this turn. Any sentence or word limit, here or in the rules, governs the prose around the Mermaid block and never the block itself.';
}

function catalogTurnNote(signals) {
  const tag = fenceTagForView(signals.view);
  const block = tag ? `\`${tag}\` block` : 'table';
  if (signals.output === 'text-only' || signals.operation === 'explain') {
    return 'The diagram contract in the system prompt applies to this turn: answer in prose and do not output a visual.';
  }
  if (signals.operation === 'refine') {
    return `The diagram contract in the system prompt applies to this turn: change the wording only and keep the ${block} exactly as it is. Any sentence or word limit governs the prose, never the ${block}.`;
  }
  if (signals.missingInput && MISSING_INPUT_WORDS[signals.missingInput]) {
    return `The diagram contract in the system prompt applies to this turn. Nobody has stated ${MISSING_INPUT_WORDS[signals.missingInput]}: unless the material above states it, ask for it and output no chart. Do not make one up.`;
  }
  return `The diagram contract in the system prompt applies to this turn. Any sentence or word limit, here or in the rules, governs the prose around the ${block} and never the ${block} itself.`;
}

/** True when a system prompt already carries the contract (exactly-once guard). */
export function hasDiagramContract(prompt) {
  return typeof prompt === 'string' && prompt.includes(DIAGRAM_CONTRACT_OPEN);
}

/**
 * Append the contract to a system prompt that was not composed by the v2
 * prompt system (a legacy fallback prompt, a V3-only system, Direct Assist).
 * A prompt that already carries one is returned unchanged.
 */
export function appendDiagramContract(prompt, signals, options = {}) {
  const base = String(prompt ?? '');
  if (!signals || hasDiagramContract(base)) return base;
  const contract = renderDiagramContract(signals, options);
  if (!contract) return base;
  return base ? `${base}\n\n${contract}` : contract;
}
