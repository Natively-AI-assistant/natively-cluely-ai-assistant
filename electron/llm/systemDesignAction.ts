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
