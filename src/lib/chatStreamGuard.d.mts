export function resolveChatStreamToken(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
  /** Surface owning the currently-adopted stream. Absent → legacy 'desktop'. */
  activeSource?: string | null,
  /** Surface of the incoming token. Absent → legacy 'desktop'. */
  incomingSource?: string | null,
): { accept: boolean; activeId: number | null; activeSource: string | null };

export function resolveChatStreamDone(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
  activeSource?: string | null,
  incomingSource?: string | null,
): { honor: boolean; activeId: number | null; activeSource: string | null };

export function resolveLiveAnswerBatch(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { accept: boolean; activeId: number | null };
