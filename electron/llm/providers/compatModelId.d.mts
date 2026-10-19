export const OPENAI_COMPAT_PREFIX: string;

export function compatModelId(instanceId: string, model: string): string;

export function parseCompatModelId(
  modelId: string | null | undefined,
): { instanceId: string; model: string } | null;
