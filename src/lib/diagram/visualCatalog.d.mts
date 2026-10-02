export interface VisualKindInfo {
  view: string;
  /** "entity–relationship diagram", "chart", … */
  name: string;
  article: 'a' | 'an';
  /** What draws it: Mermaid, the chart adapter, a notation adapter, or nothing (a Markdown table). */
  renderer: 'mermaid' | 'chart' | 'notation' | 'table';
  /** Mermaid header, for Mermaid kinds. */
  header?: string;
  /** One of the four original system-design views (rule text lives in diagramContract.mjs). */
  legacy?: boolean;
  /** The rules a model is given for this kind. */
  rules?: string;
  /** What follows the visual in the answer. */
  after?: string;
  /** What is given instead when no visual is wanted or possible. */
  fallback: string;
}
export const VISUAL_CATALOG: Readonly<Record<string, VisualKindInfo>>;
export const VISUAL_VIEWS: readonly string[];
export function visualKind(view: string | null | undefined): VisualKindInfo;
export function isLegacyView(view: string | null | undefined): boolean;
/** 'mermaid' | 'natively-chart' | 'natively-diagram', or '' for a Markdown table. */
export function fenceTagForView(view: string | null | undefined): string;
export const CHART_INTENT_RULE: Readonly<Record<string, string>>;
export const FLOWCHART_LAYOUTS: Readonly<Record<'lanes' | 'tree', Readonly<{ name: string; article: string; fallback: string; rules: string; after: string }>>>;
export const VISUAL_MODE_NOTES: Readonly<Record<string, string>>;
export function visualModeNote(mode: string | null | undefined): string;
