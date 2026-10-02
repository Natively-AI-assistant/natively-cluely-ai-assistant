import type { DiagramRequest, DiagramView, DiagramOperation, DiagramOutput, DiagramBasis } from './diagramRequest.mjs';

export const DIAGRAM_CONTRACT_OPEN: string;
export const DIAGRAM_CONTRACT_CLOSE: string;
export const DIAGRAM_TARGETS: Readonly<{ minComponents: number; maxComponents: number; maxNodes: number; maxEdges: number }>;
export const ACTIVE_DESIGN_MAX_CHARS: number;

/** Everything a cached system prompt may know about a diagram turn. All enumerated. */
export interface DiagramPromptSignals {
  view: DiagramView;
  /** 'alternative' is set only by the brainstorm action over an active design. */
  operation: DiagramOperation | 'alternative';
  output: DiagramOutput;
  basis: DiagramBasis;
  withCode: boolean;
  hasParent: boolean;
  depth: 'brief' | 'detailed';
  /** Ids from diagramExamples.mjs (0–2). */
  exampleIds: string[];
  /** The built-in mode, present only when that mode adds a note for visuals. */
  mode?: string;
  /** For view 'chart': what the chart is for. */
  chartIntent?: string;
  /** A calculation input stated neither in the request nor in the conversation. */
  missingInput?: 'baseline' | 'rate' | 'period' | 'amounts';
  /** One of the four original views drawn for something that is not a system design. */
  general?: boolean;
  /** Nobody asked for the visual: the task implied it in this mode. */
  contextual?: boolean;
  /** How a follow-up refers to the artifact on the table. */
  followUp?: 'strong' | 'weak';
  layout?: 'lanes' | 'tree';
  ofChart?: boolean;
  /**
   * The rules could not place the turn: every text built from these signals is
   * conditional, and the model that answers decides whether it applies.
   */
  undecided?: boolean;
  /** With `undecided`: the drawing on the table is no longer what the conversation is on. */
  away?: boolean;
}

export interface ActiveDesignForPrompt {
  /** 'mermaid' | 'chart' | 'notation': which fence tag the source is quoted with. */
  artifact?: string;
  source?: string;
  view?: string;
  version?: number;
  question?: string;
}

export function wantsDetailedDesign(question: string | null | undefined): boolean;
export function diagramPromptSignals(
  request: DiagramRequest | null | undefined,
  options?: { question?: string | null; maxExamples?: number },
): DiagramPromptSignals | null;
export function renderDiagramContract(
  signals: DiagramPromptSignals | null | undefined,
  options?: { tier?: 'cloud' | 'local'; surface?: 'live' | 'chat' },
): string;
/** The table the app computed from a chart payload, as text for the model ('' when there is none or it is too large). */
export function chartValuesBlock(source: string): string;
export function renderDiagramTurnBlock(request: DiagramRequest | null | undefined, activeDesign: ActiveDesignForPrompt | null | undefined): string;
export function renderDiagramTurnNote(signals: DiagramPromptSignals | null | undefined): string;
export function hasDiagramContract(prompt: string | null | undefined): boolean;
export function appendDiagramContract(
  prompt: string | null | undefined,
  signals: DiagramPromptSignals | null | undefined,
  options?: { tier?: 'cloud' | 'local'; surface?: 'live' | 'chat' },
): string;
