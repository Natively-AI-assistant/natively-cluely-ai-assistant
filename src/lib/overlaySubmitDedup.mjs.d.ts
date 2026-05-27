export function normalizeSubmitText(text: string): string;

export function shouldDedupeManualSubmit(params: {
  text: string;
  lastText: string | null;
  lastAtMs: number | null;
  nowMs: number;
  windowMs?: number;
}): boolean;
