export function normalizeActionKey(actionKey: string): string;

export function shouldDedupeOverlayAction(params: {
  actionKey: string;
  lastActionKey: string | null;
  lastAtMs: number | null;
  nowMs: number;
  windowMs?: number;
}): boolean;

export function collapseConsecutiveDuplicateSystemMessages<T extends { role: string; text: string; intent?: string }>(
  messages: T[],
): T[];
