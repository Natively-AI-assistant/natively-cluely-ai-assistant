// electron/llm/systemDesignAction.ts
//
// The exact instruction the system-design action card sends when the user
// accepts it. One constant, in a module with no imports, so the detector that
// offers the action (DynamicActionDetector) and the engine that recognises it
// (diagramPromptSignals.isSystemDesignActionInstruction) cannot drift apart.
//
// The wording matters twice over: it is what the model reads on the non-V3 and
// Direct Assist paths, and it says "system design" in plain words, which is
// what the shared diagram resolver looks for when the instruction arrives as
// text (Direct Assist carries it as the request's output instruction).
export const SYSTEM_DESIGN_ACTION_INSTRUCTION =
  'This is a system design question. Answer it as a design: state the approach and its assumptions, give the architecture as a diagram, then cover the components, data flow, scaling and tradeoffs briefly.';

// ── visual action cards (nine-mode catalog) ─────────────────────────────────
//
// Offered by DynamicActionDetector only when the conversation shows the
// STRUCTURE or DATA the visual needs (steps being listed, several figures with
// units, a blocker being named). Accepting one is an explicit request: its
// instruction is written so the shared visual resolver reads it as one ("draw
// … as a decision tree"), and every instruction says "from this conversation",
// which makes the visual a reconstruction of what was said, not a new proposal.
//
// Nothing here generates anything on its own, and nothing lowers an
// auto-answer threshold: these are offers.
export interface VisualAction {
  type: string;
  label: string;
  instruction: string;
}

export const VISUAL_ACTIONS: Readonly<Record<string, VisualAction>> = Object.freeze({
  workflow: {
    type: 'visual_workflow',
    label: 'Map the workflow',
    instruction: 'Draw the workflow from this conversation as a process flowchart. Use only the steps and conditions that were stated.',
  },
  dataModel: {
    type: 'visual_data_model',
    label: 'Draw the data model',
    instruction: 'Draw the data model from this conversation as an ER diagram. Use only the entities, keys and relationships that were stated.',
  },
  figures: {
    type: 'visual_figures',
    label: 'Plot these figures',
    instruction: 'Plot the figures from this conversation as a chart. Use only numbers that were stated, with their units and period.',
  },
  scenarios: {
    type: 'visual_scenarios',
    label: 'Compare the scenarios',
    instruction: 'Compare the scenarios from this conversation in a chart. Use only inputs that were stated, and name any that are missing instead of assuming them.',
  },
  dependencies: {
    type: 'visual_dependencies',
    label: 'Show the dependencies',
    instruction: 'Draw the dependencies from this conversation as a dependency map. Use only the blockers and prerequisites that were stated.',
  },
  troubleshooting: {
    type: 'visual_troubleshooting',
    label: 'Map the troubleshooting steps',
    instruction: 'Draw the troubleshooting steps from this conversation as a decision tree. Use only checks and outcomes that were stated or are in the support material.',
  },
  timeline: {
    type: 'visual_timeline',
    label: 'Show the timeline',
    instruction: 'Draw a timeline of the dated events from this conversation. Use only dates that were stated.',
  },
  concepts: {
    type: 'visual_concepts',
    label: 'Organize the concepts',
    instruction: 'Draw a mind map of the concepts from this conversation. Group only what was actually covered.',
  },
});

const VISUAL_ACTION_INSTRUCTIONS: ReadonlySet<string> = new Set(Object.values(VISUAL_ACTIONS).map((a) => a.instruction));

/** True when an accepted action's instruction is one of the visual action cards. */
export function isVisualActionInstruction(promptInstruction: string | null | undefined): boolean {
  return typeof promptInstruction === 'string' && VISUAL_ACTION_INSTRUCTIONS.has(promptInstruction.trim());
}
