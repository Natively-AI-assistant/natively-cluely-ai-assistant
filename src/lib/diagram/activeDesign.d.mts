export const ACTIVE_DESIGN_TTL_MS: number;
export const SAME_DESIGN_OVERLAP: number;

export interface ActiveDesign {
  /** Stable id of this version, e.g. "design-2.v3". */
  artifactId: string;
  /** Shared by every version of the same design. */
  lineageId: string;
  /** The version this one replaced, when it is an update. */
  parentArtifactId?: string;
  version: number;
  view: string;
  /** Mermaid family: 'flowchart' | 'sequence' | 'state' | 'class' | 'er'. */
  type: string;
  source: string;
  /** What the design was first drawn for, when known. */
  question?: string;
  /** False once a code answer has followed it: a bare "this" then means the code. */
  foreground: boolean;
  updatedAt: number;
}

export interface ActiveDesignState {
  get(): ActiveDesign | null;
  noteDesignQuestion(question: string | null | undefined): void;
  observeAnswer(answer: string | null | undefined): ActiveDesign | null;
  applyRepair(originalSource: string, repairedSource: string): boolean;
  clear(): void;
}

export function createActiveDesignState(options?: { now?: () => number; ttlMs?: number }): ActiveDesignState;
export function designOverlap(sourceA: string, sourceB: string): number;
export function latestDiagramInAnswer(answer: string | null | undefined): { source: string; type: string; view: string } | null;
export function activeDesignFromHistory(
  turns: ReadonlyArray<{ role?: string; text?: string; content?: string; answer?: string }> | null | undefined,
): { artifactId: string; view: string; type: string; source: string; version: number; foreground: boolean } | null;
export function answerHasCodeBlock(answer: string | null | undefined): boolean;
