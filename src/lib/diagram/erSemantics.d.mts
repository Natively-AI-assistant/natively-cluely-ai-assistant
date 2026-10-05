export interface ErRelationship {
  left: string;
  right: string;
  /** [min, max] of the LEFT entity related to one RIGHT entity. max is Infinity for "many". */
  leftPerRight: [number, number];
  /** [min, max] of the RIGHT entity related to one LEFT entity. */
  rightPerLeft: [number, number];
  identifying: boolean;
  label: string;
}
export interface ErAnalysis {
  isEr: boolean;
  entities: Array<{ name: string; attributes: Array<{ type: string; name: string; keys: string[] }> }>;
  relationships: ErRelationship[];
  notes: string[];
}
export function cardinalityWords(range: [number, number]): string;
export function analyseErDiagram(source: unknown): ErAnalysis;
export function describeErDiagram(analysis: ErAnalysis | null | undefined): string;
