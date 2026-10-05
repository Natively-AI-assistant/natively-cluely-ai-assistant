import type { ChartTable } from './chartSpec.mjs';

export type VisualArtifactKind = 'mermaid' | 'chart' | 'notation';
export const VISUAL_FENCE_LANGS: Readonly<Record<string, VisualArtifactKind>>;
export const VISUAL_FENCE_TAG: Readonly<Record<VisualArtifactKind, string>>;
export const NOTATION_KINDS: readonly string[];

interface CompiledCommon {
  ok: true;
  artifact: 'chart' | 'notation';
  /** Product-facing view name: 'chart' | 'chen' | 'automaton'. */
  view: string;
  /** Card title. */
  label: string;
  /** The artifact's own title, when it has one. */
  title: string;
  /** Plain-language description (alt text, the phone's fallback). */
  description: string;
  /** "Scenario", "Illustrative", … */
  badges: string[];
  /** What was corrected, and what is unknown. */
  notes: string[];
  assumptions: string[];
  sources: string[];
  table: ChartTable | { columns: string[]; rows: string[][] } | null;
  exports: { json: string; csv?: string };
}
export type CompiledVisual =
  | (CompiledCommon & { renderer: 'svg'; svg: string; width: number; height: number })
  | (CompiledCommon & { renderer: 'mermaid'; mermaid: string })
  | { ok: false; stage: 'spec'; code: string; message: string; missing?: string[] };

export function compileVisualSource(
  kind: 'chart' | 'notation',
  source: string,
  colors?: { text: string; muted: string; nodeFill: string; stroke: string; groupFill: string; accent: string; dark: boolean },
): CompiledVisual;
export function visualSourceSummary(kind: 'chart' | 'notation', source: string): { ok: boolean; view: string; words: string[] };
export function checkVisualSource(kind: 'chart' | 'notation', source: string): { ok: true; view: string; type: string } | { ok: false; code: string };
export const PHONE_VISUAL_COLORS: Readonly<{ text: string; muted: string; nodeFill: string; stroke: string; groupFill: string; accent: string; dark: boolean }>;
