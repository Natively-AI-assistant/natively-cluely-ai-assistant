import type { FeedItem, StreamEvent } from './types';

export interface LiveStream {
  streamId: string;
  content: string;
  createdAt: string;
}

export interface FeedState {
  items: FeedItem[];
  live: LiveStream | null;
}

export const initialFeedState: FeedState = {
  items: [],
  live: null,
};

function messageItem(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string,
  label?: string,
  live?: boolean,
): FeedItem {
  return { kind: 'message', id, role, content, createdAt, label, live };
}

/** Apply a StreamEvent to feed state (pure; mirrors phoneMirrorClient handleEvent). */
export function applyStreamEvent(state: FeedState, event: StreamEvent): FeedState {
  switch (event.type) {
    case 'history': {
      return {
        live: null,
        items: event.messages.map((m) =>
          messageItem(m.id, m.role, m.content, m.createdAt, m.label),
        ),
      };
    }
    case 'user': {
      return {
        ...state,
        items: [
          ...state.items,
          messageItem(event.id, 'user', event.content, event.createdAt),
        ],
      };
    }
    case 'token': {
      const live =
        state.live && state.live.streamId === event.streamId
          ? {
              ...state.live,
              content: state.live.content + event.token,
            }
          : {
              streamId: event.streamId,
              content: event.token,
              createdAt: new Date().toISOString(),
            };
      return { ...state, live };
    }
    case 'done': {
      const content =
        event.content ||
        (state.live && state.live.streamId === event.streamId ? state.live.content : '');
      const createdAt =
        event.createdAt ||
        (state.live && state.live.streamId === event.streamId
          ? state.live.createdAt
          : new Date().toISOString());
      if (!content && !(state.live && state.live.streamId === event.streamId)) {
        return { ...state, live: null };
      }
      return {
        live: null,
        items: [
          ...state.items,
          messageItem(`a:${event.streamId}`, 'assistant', content, createdAt),
        ],
      };
    }
    case 'error': {
      const prefix =
        state.live && state.live.streamId === event.streamId
          ? state.live.content
          : '';
      const content = prefix
        ? `${prefix}\n\n[error: ${event.message}]`
        : `[error: ${event.message}]`;
      return {
        live: null,
        items: [
          ...state.items,
          {
            kind: 'error',
            id: `err:${event.streamId}:${Date.now()}`,
            streamId: event.streamId,
            message: content,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case 'assistant': {
      return {
        ...state,
        items: [
          ...state.items,
          messageItem(event.id, 'assistant', event.content, event.createdAt, event.label),
        ],
      };
    }
    case 'ack':
      // Ticket 18: stream feed only; ack toasts deferred to later tickets.
      return state;
    default:
      return state;
  }
}

/** Flatten state into a list for FlatList (includes live card). */
export function feedItemsForDisplay(state: FeedState): FeedItem[] {
  if (!state.live) return state.items;
  return [
    ...state.items,
    messageItem(
      `live:${state.live.streamId}`,
      'assistant',
      state.live.content,
      state.live.createdAt,
      undefined,
      true,
    ),
  ];
}
