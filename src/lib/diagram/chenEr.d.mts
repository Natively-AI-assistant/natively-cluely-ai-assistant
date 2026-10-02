export const CHEN_SPEC_VERSION: number;
export const CHEN_LIMITS: Readonly<Record<string, number>>;

export interface ChenAttribute {
  name: string;
  key: boolean;
  partialKey: boolean;
  multivalued: boolean;
  derived: boolean;
  components: string[];
}
export interface ChenModel {
  v: number;
  title: string;
  entities: Array<{ name: string; weak: boolean; attributes: ChenAttribute[] }>;
  relationships: Array<{
    name: string;
    identifying: boolean;
    attributes: ChenAttribute[];
    participants: Array<{ entity: string; cardinality: '' | '1' | 'N' | 'M'; participation: 'total' | 'partial' | 'unknown'; role: string }>;
  }>;
  /** Constraints nobody stated. Drawn without a mark; never defaulted. */
  unknowns: string[];
  notes: string[];
}

export function validateChenEr(spec: unknown): { ok: true; model: ChenModel } | { ok: false; code: string; message: string };
export function describeChenEr(model: ChenModel): string;
export function renderChenErSvg(
  model: ChenModel,
  colors?: { text: string; muted: string; nodeFill: string; stroke: string; groupFill: string; accent: string; dark: boolean },
): { svg: string; width: number; height: number };
