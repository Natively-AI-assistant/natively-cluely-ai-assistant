export type DiagramView = 'architecture' | 'sequence' | 'flowchart' | 'state';
export type DiagramOperation = 'create' | 'update' | 'explain' | 'refine' | 'none';
export type DiagramOutput = 'text-and-diagram' | 'diagram-only' | 'source-only' | 'text-only';
export type DiagramBasis = 'proposed-design' | 'meeting-reconstruction' | 'source-reconstruction';

export interface DiagramRequest {
  /** The diagram contract applies to this turn. */
  enabled: boolean;
  view: DiagramView;
  operation: DiagramOperation;
  output: DiagramOutput;
  basis: DiagramBasis;
  /** The design this turn updates or shows another view of. */
  parentArtifactId?: string;
  /** The turn also asks for code; both artifacts are kept. */
  withCode: boolean;
  /** The user asked for a diagram in so many words. */
  explicit: boolean;
  /** Give the model the current design as turn context. */
  attachActiveDesign: boolean;
  /** Short machine-readable reason, for tests and traces. Never shown. */
  reason: string;
}

export interface ActiveDesignRef {
  artifactId?: string;
  view?: string;
  source?: string;
  /** False once a code answer has followed the design: a bare "this" then means the code. */
  foreground?: boolean;
}

export interface ResolveDiagramRequestInput {
  question?: string | null;
  /** AnswerPlanner's route for the turn, when the caller has one. */
  answerType?: string | null;
  /** V3 classifier types; only used to see the code half of a mixed ask. */
  questionTypes?: readonly string[] | null;
  activeDesign?: ActiveDesignRef | null;
  /** false turns every diagram decision off (the feature switch). */
  featureEnabled?: boolean;
  /** The user's standing instructions ("no diagrams"). */
  userInstructions?: string | null;
  /** An accepted system-design action: treat the turn as a design ask. */
  forceDesign?: boolean;
  /** A screenshot, captured page or screen context is attached to the turn. */
  hasVisualContext?: boolean;
}

export function resolveDiagramRequest(input?: ResolveDiagramRequestInput): DiagramRequest;
export function detectDiagramView(question: string | null | undefined): DiagramView | null;
export function designVocabulary(mermaidSource: string | null | undefined): Set<string>;
export function refersToDesign(question: string | null | undefined, activeDesign: ActiveDesignRef | null | undefined): boolean;
export function viewFromDiagramType(type: string | null | undefined): DiagramView;
