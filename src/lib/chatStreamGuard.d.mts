export function resolveChatStreamToken(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { accept: boolean; activeId: number | null };

export function resolveChatStreamDone(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { honor: boolean; activeId: number | null };

export function resolveLiveAnswerBatch(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { accept: boolean; activeId: number | null };
