export type AnswerSegment =
  | { type: 'markdown'; key: string; text: string }
  | { type: 'diagram'; artifact: 'mermaid' | 'chart' | 'notation'; key: string; diagramIndex: number; source: string; info: string; complete: boolean; description: string };

export function splitAnswerForDiagrams(text: string | null | undefined, options?: { streaming?: boolean }): AnswerSegment[];
