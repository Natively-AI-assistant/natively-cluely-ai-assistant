export interface DiagramExample {
  id: string;
  /** A view from visualCatalog.mjs. */
  view: string;
  /** 'mermaid' (default) | 'natively-chart' | 'natively-diagram' | 'table'. */
  fence?: 'mermaid' | 'natively-chart' | 'natively-diagram' | 'table';
  /** Built-in modes the example is most at home in. Present on catalog (version 2) entries. */
  modes?: string[];
  chartIntent?: string;
  topics: string[];
  question: string;
  constraints: string[];
  assumptions: string[];
  rationale: string;
  /** Mermaid source (Mermaid entries). */
  mermaid?: string;
  /** Block content of a chart / notation / table entry. */
  body?: string;
}

export const DIAGRAM_EXAMPLES_VERSION: number;
export const DIAGRAM_EXAMPLE_TOKEN_BUDGET: number;
export const DIAGRAM_EXAMPLES: readonly DiagramExample[];
export function renderDiagramExample(example: DiagramExample): string;
export function selectDiagramExamples(input?: { question?: string; view?: string; mode?: string; chartIntent?: string; max?: number; tokenBudget?: number }): DiagramExample[];
export function renderDiagramExamplesBlock(examples: readonly DiagramExample[] | null | undefined): string;
