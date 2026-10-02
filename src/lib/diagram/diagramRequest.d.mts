/** The first four are the original system-design views; the rest are the nine-mode catalog (visualCatalog.mjs). */
export type DiagramView =
  | 'architecture' | 'sequence' | 'flowchart' | 'state'
  | 'decision' | 'er' | 'class' | 'mindmap' | 'timeline' | 'gantt' | 'dependency' | 'responsibility'
  | 'matrix' | 'chart' | 'chen' | 'automaton';
export type DiagramOperation = 'create' | 'update' | 'explain' | 'refine' | 'none';
export type DiagramOutput = 'text-and-diagram' | 'diagram-only' | 'source-only' | 'text-only';
/** What the visual's content rests on. */
export type DiagramBasis =
  | 'proposed-design' | 'meeting-reconstruction' | 'source-reconstruction'
  | 'evidence' | 'observed-data' | 'calculated' | 'scenario' | 'illustrative';
export type MissingInput = 'baseline' | 'rate' | 'period' | 'amounts';
export declare const MISSING_INPUTS: readonly MissingInput[];
export type VisualIntent = 'explain' | 'compare' | 'reconstruct' | 'propose' | 'calculate' | 'forecast' | 'update';
export type ChartIntent = 'forecast' | 'breakeven' | 'funnel' | 'trend' | 'breakdown' | 'comparison' | 'function' | 'quadrant' | 'generic';
/** A built-in mode template, 'custom' (a user mode on the General template), or 'unknown'. */
export type VisualMode = 'general' | 'looking-for-work' | 'technical-interview' | 'sales' | 'recruiting' | 'team-meet' | 'lecture' | 'seminar' | 'call-center' | 'custom' | 'unknown';

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
  /** What the answer is doing with the visual. Set when enabled. */
  intent?: VisualIntent;
  /** For view 'chart': what the chart is for. */
  chartIntent?: ChartIntent;
  /** The mode the decision was made for. */
  mode?: VisualMode;
  /** Eligible because of the task and the mode, not because it was asked for. */
  contextual?: boolean;
  /** For a calculation: what it needs, and which of those the request itself states. */
  inputs?: { needed: string[]; inRequest: string[]; missing?: MissingInput[] };
  /** A calculation input stated neither in the request nor in the conversation. */
  missingInput?: MissingInput;
  /**
   * How a follow-up refers to the artifact on the table: 'strong' names it or
   * one of its parts; 'weak' is a pronoun or a bare edit while it is in focus.
   */
  followUp?: 'strong' | 'weak';
  /** Set when the request was read by the Spanish / Russian / Chinese / Japanese rules. */
  language?: 'es' | 'ru' | 'zh' | 'ja';
  /** A flowchart asked for in swimlanes or as a tree. */
  layout?: 'lanes' | 'tree';
  /** The kind of artifact this one is drawn FROM ("show the chart as a table"). */
  parentFamily?: string | null;
  /**
   * Set only on a request that is NOT enabled: the rules could not place the
   * turn (Spanish, Russian, Chinese, Japanese), and this is the request it
   * would be if it is one. The contract built from it asks the model that
   * answers to decide. Nothing that routes, validates or remembers a diagram
   * turn reads it.
   */
  undecided?: DiagramRequest;
}

export interface ActiveDesignRef {
  artifactId?: string;
  /** 'mermaid' | 'chart' | 'notation'. */
  artifact?: string;
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
  /**
   * What was said in the conversation so far, when the caller can supply it. A
   * string (even an empty one) lets a calculation report inputs that were
   * stated nowhere; absent means the conversation is unknown.
   */
  material?: string | null;
  /**
   * The resolved built-in mode template (from the mode policy registry — never
   * a mode's display name), or 'custom'. Absent / unknown keeps the pre-catalog
   * behaviour: only an explicit request draws.
   */
  mode?: string | null;
}

export function resolveDiagramRequest(input?: ResolveDiagramRequestInput): DiagramRequest;
export function detectDiagramView(question: string | null | undefined): DiagramView | null;
export function detectVisualTask(question: string | null | undefined): { view: DiagramView; chartIntent?: ChartIntent; strong: boolean; named: boolean; implied: boolean } | null;
export const VISUAL_MODES: readonly string[];
export function normaliseVisualMode(mode: unknown): VisualMode;
export function modeSuggestsVisual(mode: unknown, view: string): boolean;
export function visualInputStatus(question: string | null | undefined, chartIntent: string | undefined, material?: string | null): { needed: string[]; inRequest: string[]; missing?: MissingInput[] } | null;
export function chartIntentOfSource(source: string | null | undefined): ChartIntent;
export function designVocabulary(mermaidSource: string | null | undefined): Set<string>;
export function refersToDesign(question: string | null | undefined, activeDesign: ActiveDesignRef | null | undefined): boolean;
export function viewFromDiagramType(type: string | null | undefined, source?: string | null): DiagramView;

/** The artifact's own multi-word names, lower-cased. */
export function designLabels(source: string | null | undefined): Set<string>;
/**
 * The titles of a diagram's groups or lanes (`subgraph Support`,
 * `subgraph ops ["Ops Team"]`), as lower-case words.
 */
export function designGroups(source: string | null | undefined): Set<string>;
