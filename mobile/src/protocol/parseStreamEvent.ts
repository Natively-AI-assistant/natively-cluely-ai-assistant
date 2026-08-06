import type { PersistedMessage, PhoneModeSummary, StreamEvent } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parsePersistedMessage(raw: unknown): PersistedMessage | null {
  if (!isRecord(raw)) return null;
  const role = raw.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const id = asString(raw.id);
  const content = asString(raw.content);
  const createdAt = asString(raw.createdAt, new Date().toISOString());
  if (!id) return null;
  const msg: PersistedMessage = { id, role, content, createdAt };
  if (typeof raw.label === 'string' && raw.label) msg.label = raw.label;
  return msg;
}

function parseModeSummary(raw: unknown): PhoneModeSummary | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id).trim();
  if (!id) return null;
  return {
    id,
    name: asString(raw.name, id),
    templateType: asString(raw.templateType),
  };
}

/**
 * Parse a JSON payload into a StreamEvent.
 * Unknown / malformed frames return null (ignore, matching web client).
 */
export function parseStreamEvent(raw: unknown): StreamEvent | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'history': {
      if (!Array.isArray(raw.messages)) return null;
      const messages: PersistedMessage[] = [];
      for (const item of raw.messages) {
        const msg = parsePersistedMessage(item);
        if (msg) messages.push(msg);
      }
      return { type: 'history', messages };
    }
    case 'user': {
      const id = asString(raw.id);
      const content = asString(raw.content);
      if (!id) return null;
      return {
        type: 'user',
        id,
        content,
        createdAt: asString(raw.createdAt, new Date().toISOString()),
      };
    }
    case 'token': {
      const streamId = asString(raw.streamId);
      if (!streamId) return null;
      return { type: 'token', streamId, token: asString(raw.token) };
    }
    case 'done': {
      const streamId = asString(raw.streamId);
      if (!streamId) return null;
      return {
        type: 'done',
        streamId,
        content: asString(raw.content),
        createdAt: asString(raw.createdAt, new Date().toISOString()),
      };
    }
    case 'error': {
      const streamId = asString(raw.streamId);
      if (!streamId) return null;
      return {
        type: 'error',
        streamId,
        message: asString(raw.message, 'stream failed'),
      };
    }
    case 'assistant': {
      const id = asString(raw.id);
      if (!id) return null;
      return {
        type: 'assistant',
        id,
        content: asString(raw.content),
        label: asString(raw.label),
        createdAt: asString(raw.createdAt, new Date().toISOString()),
      };
    }
    case 'ack': {
      return {
        type: 'ack',
        action: asString(raw.action),
        message: asString(raw.message),
      };
    }
    case 'status': {
      if (typeof raw.sessionActive !== 'boolean' || typeof raw.stealthActive !== 'boolean') {
        return null;
      }
      const modeId =
        raw.modeId === null || raw.modeId === undefined
          ? null
          : typeof raw.modeId === 'string'
            ? raw.modeId
            : null;
      const event: StreamEvent = {
        type: 'status',
        sessionActive: raw.sessionActive,
        stealthActive: raw.stealthActive,
        modeId,
      };
      if (Array.isArray(raw.modes)) {
        const modes: PhoneModeSummary[] = [];
        for (const item of raw.modes) {
          const mode = parseModeSummary(item);
          if (mode) modes.push(mode);
        }
        event.modes = modes;
      }
      return event;
    }
    default:
      return null;
  }
}

/** Parse a WebSocket message data string. */
export function parseStreamEventFromData(data: string): StreamEvent | null {
  try {
    return parseStreamEvent(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
}
