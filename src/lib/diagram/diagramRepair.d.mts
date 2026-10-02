export const DIAGRAM_REPAIR_LIMITS: Readonly<{
  maxSourceChars: number;
  maxDiagnosticChars: number;
  automaticPerSource: number;
  automaticPerWindow: number;
  manualPerWindow: number;
  windowMs: number;
}>;
export const REPAIRABLE_STAGES: readonly string[];
export const DIAGRAM_REPAIR_SYSTEM_PROMPT: string;
export function isRepairableStage(stage: string | null | undefined): boolean;
export function buildDiagramRepairRequest(input: { source: string; diagnostic?: string; stage?: string }): { system: string; user: string } | null;
export function extractRepairedDiagram(
  output: string | null | undefined,
  originalSource: string,
): { ok: true; source: string } | { ok: false; reason: 'empty' | 'unchanged' | 'policy' | 'too_large' };
export function createRepairBudget(options?: {
  now?: () => number;
  limits?: Partial<{ automaticPerSource: number; automaticPerWindow: number; windowMs: number }>;
}): {
  take(source: string, opts?: { manual?: boolean }): { allowed: true } | { allowed: false; reason: 'already_tried' | 'rate_limited' };
  used(): number;
};
