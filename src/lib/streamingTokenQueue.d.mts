export function shouldFlushPreviousStream(
  activeIntent: string | null,
  incomingIntent: string,
  activeMsgId: string | null,
): boolean;

export function resolveStreamingMessageId(
  messages: Array<{ id: string; role: string; intent?: string; isStreaming?: boolean }>,
  activeMsgId: string | null,
  intent: string,
  idFactory: () => string,
): string;

export function applyFirstStreamingToken<T extends { id: string; role: string; text: string; intent?: string; isStreaming?: boolean }>(
  messages: T[],
  params: { id: string; token: string; intent: string },
): T[];

export function commitStreamingFlush<T extends { id: string; text: string; isStreaming?: boolean }>(
  messages: T[],
  msgId: string,
  text: string,
): T[];

export function finalizeImperativeStreamMessages<T extends { id: string; role?: string; text: string; intent?: string; isStreaming?: boolean }>(
  messages: T[],
  params: { msgId: string | null; intent?: string; bufferedText: string; finalText?: string | null },
): T[];
