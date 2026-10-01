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

export const DIAGRAM_CONTRACT_OPEN = '<diagram_contract>';
export const DIAGRAM_CONTRACT_CLOSE = '</diagram_contract>';

/** Targets stated to the model. The renderer's hard limits are larger (diagramPolicy). */
export const DIAGRAM_TARGETS = Object.freeze({ minComponents: 5, maxComponents: 10, maxNodes: 12, maxEdges: 20 });

/** Longest active-design source handed back to the model on a follow-up. */
export const ACTIVE_DESIGN_MAX_CHARS = 4000;

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
  const wantsExamples = freshDesign && request.basis === 'proposed-design' && request.output !== 'text-only';
  const maxExamples = Number.isFinite(options.maxExamples) ? options.maxExamples : 1;
  const exampleIds = wantsExamples
    ? selectDiagramExamples({ question: options.question ?? '', view: request.view, max: maxExamples }).map((e) => e.id)
    : [];
  return {
    view: request.view,
    operation: request.operation,
    output: request.output,
    basis: request.basis,
    withCode: request.withCode === true,
    hasParent: Boolean(request.parentArtifactId),
    depth: wantsDetailedDesign(options.question) ? 'detailed' : 'brief',
    exampleIds,
  };
}

function typeRule(view) {
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

const DIAGRAM_RULES = (view) => `Diagram rules:
- ${typeRule(view)}
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
  return block ? `\n\n${block}` : '';
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
  const body = tier === 'local' ? localBody(signals) : cloudBody(signals, surface);
  // Reference examples cost tokens a small local model cannot spare.
  const examples = tier === 'local' ? '' : examplesBlock(signals);
  return `${DIAGRAM_CONTRACT_OPEN}\n${body}${examples}\n${DIAGRAM_CONTRACT_CLOSE}`;
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

${DIAGRAM_RULES(view)}

${HONESTY_RULES(basis)}`;
  }

  if (output === 'diagram-only') {
    return `The user asked for the diagram only.
Output exactly one fenced code block tagged \`mermaid\` containing the complete diagram. No sentence before it and none after it. Put assumptions in node or edge labels if they matter.${signals.hasParent ? ' The current design is given in <active_design> in the turn; start from it.' : ''}

${DIAGRAM_RULES(view)}

${HONESTY_RULES(basis)}`;
  }

  if (operation === 'alternative') {
    return `The active task is a system design; its current diagram is given in <active_design> in the turn. This turn asks for alternatives to it. ${PRECEDENCE}

Answer in this order:
1. Two or three genuinely different approaches, one or two sentences each, with the tradeoff that separates it from the current design.
2. One fenced code block tagged \`mermaid\` drawing the ONE alternative you would pick. Reuse the current design's component names where the component is the same.
3. One sentence on when you would stay with the current design instead.

${DIAGRAM_RULES(view)}

${HONESTY_RULES(basis)}`;
  }

  if (operation === 'update') {
    return `This turn changes the design already on the table. Its current diagram is given in <active_design> in the turn. ${PRECEDENCE}

Answer in this order:
1. One sentence: what changes and why.
2. The FULL updated diagram in one fenced code block tagged \`mermaid\`. Start from the current diagram, keep every node id and label that does not change, and apply only the requested change. Never answer with a fragment or a diff.
3. One or two sentences on what the change costs or buys.${codeStep(signals)}

${DIAGRAM_RULES(view)}

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

${DIAGRAM_RULES(view)}

${HONESTY_RULES(basis)}`;
}

// Small local models follow one short paragraph better than numbered laws.
function localBody(signals) {
  const { view, operation, output, basis } = signals;
  const type = view === 'sequence' ? 'sequenceDiagram' : view === 'state' ? 'stateDiagram-v2' : view === 'flowchart' ? 'flowchart TD' : 'flowchart LR';
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

function clampSource(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length <= ACTIVE_DESIGN_MAX_CHARS) return text;
  // Cut on a line boundary so the model never sees half a statement.
  const cut = text.slice(0, ACTIVE_DESIGN_MAX_CHARS);
  const lastNewline = cut.lastIndexOf('\n');
  return (lastNewline > 0 ? cut.slice(0, lastNewline) : cut).trimEnd();
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
  const source = clampSource(activeDesign.source);
  if (!source) return '';
  const about = activeDesign.question ? `\nIt was drawn for: ${String(activeDesign.question).replace(/\s+/g, ' ').trim().slice(0, 200)}` : '';
  const note = request.enabled
    ? 'This is the design currently on the table. It is the starting point for this turn, as the diagram contract describes.'
    : 'This is the design currently on the table. The request refers to it: keep component names consistent with it. Do not redraw it.';
  // Fence chosen so it can never be closed by a line inside the source.
  const fence = source.includes('```') ? '~~~~' : '```';
  return `<active_design view="${activeDesign.view || request.view}" version="${Number(activeDesign.version) || 1}">
${note}${about}
${fence}mermaid
${source}
${fence}
</active_design>`;
}

/**
 * One line for the turn's user content, next to the question: says the system
 * prompt's diagram contract is in force for THIS turn and what that means for
 * any length limit stated beside it. Static per signal set.
 */
export function renderDiagramTurnNote(signals) {
  if (!signals) return '';
  const drawsDiagram = signals.output !== 'text-only' && signals.operation !== 'explain';
  if (!drawsDiagram) {
    return 'The diagram contract in the system prompt applies to this turn: answer in prose and do not output a diagram.';
  }
  if (signals.operation === 'refine') {
    return 'The diagram contract in the system prompt applies to this turn: change the wording only and keep the Mermaid block exactly as it is. Any sentence or word limit governs the prose, never the block.';
  }
  return 'The diagram contract in the system prompt applies to this turn. Any sentence or word limit, here or in the rules, governs the prose around the Mermaid block and never the block itself.';
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
