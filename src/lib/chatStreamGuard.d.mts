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
): {
  honor: boolean;
  activeId: number | null;
  activeSource: string | null;
  /**
   * CR-01: set when the done is NOT honored but belongs to a request the LOCAL
   * surface started. The caller must stop its own processing indicator without
   * finalizing the active row, or the spinner runs forever.
   */
  release: boolean;
};

export function resolveLiveAnswerBatch(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { accept: boolean; activeId: number | null };

export function resolveChatStreamSurfaceError(
  activeSource: string | null | undefined,
  incomingSource: string | null | undefined,
): { release: boolean };
