export const REFINE_DIAGRAM_RULE: string;
export const REFINE_VISUAL_RULE: string;
/** The rule for a previous answer's visual blocks; '' when it has none. */
export function refineRuleFor(previousAnswer: string | null | undefined): string;
export function refinementTouchesDesign(request: string | null | undefined): boolean;
export function preserveDiagramsInRefinement(
  previous: string | null | undefined,
  refined: string | null | undefined,
): { text: string; changed: boolean; restored: number };
