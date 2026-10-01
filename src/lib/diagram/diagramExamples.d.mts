export interface DiagramExample {
  id: string;
  view: 'architecture' | 'sequence' | 'flowchart' | 'state';
  topics: string[];
  question: string;
  constraints: string[];
  assumptions: string[];
  rationale: string;
  mermaid: string;
}

export const DIAGRAM_EXAMPLES_VERSION: number;
export const DIAGRAM_EXAMPLE_TOKEN_BUDGET: number;
export const DIAGRAM_EXAMPLES: readonly DiagramExample[];
export function renderDiagramExample(example: DiagramExample): string;
export function selectDiagramExamples(input?: { question?: string; view?: string; max?: number; tokenBudget?: number }): DiagramExample[];
export function renderDiagramExamplesBlock(examples: readonly DiagramExample[] | null | undefined): string;
