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
}

export interface ActiveDesignForPrompt {
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
export function renderDiagramTurnBlock(request: DiagramRequest | null | undefined, activeDesign: ActiveDesignForPrompt | null | undefined): string;
export function renderDiagramTurnNote(signals: DiagramPromptSignals | null | undefined): string;
export function hasDiagramContract(prompt: string | null | undefined): boolean;
export function appendDiagramContract(
  prompt: string | null | undefined,
  signals: DiagramPromptSignals | null | undefined,
  options?: { tier?: 'cloud' | 'local'; surface?: 'live' | 'chat' },
): string;
