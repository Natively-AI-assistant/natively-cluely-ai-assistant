export const REFINE_DIAGRAM_RULE: string;
export function refinementTouchesDesign(request: string | null | undefined): boolean;
export function preserveDiagramsInRefinement(
  previous: string | null | undefined,
  refined: string | null | undefined,
): { text: string; changed: boolean; restored: number };
