/**
 * Local Phone Mirror stream types (parity with electron/services/PhoneMirrorService.ts).
 * Kept inside mobile/ so the Electron desktop package is untouched.
 */

export type MessageRole = 'user' | 'assistant';

export interface PersistedMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  label?: string;
}

export type StreamEvent =
  | { type: 'history'; messages: PersistedMessage[] }
  | { type: 'user'; id: string; content: string; createdAt: string }
  | { type: 'token'; streamId: string; token: string }
  | { type: 'done'; streamId: string; content: string; createdAt: string }
  | { type: 'error'; streamId: string; message: string }
  | { type: 'assistant'; id: string; content: string; label: string; createdAt: string }
  | { type: 'ack'; action: string; message: string };

/** Feed item shown in the UI (history + live stream). */
export type FeedItem =
  | {
      kind: 'message';
      id: string;
      role: MessageRole;
      content: string;
      createdAt: string;
      label?: string;
      live?: boolean;
    }
  | {
      kind: 'error';
      id: string;
      streamId: string;
      message: string;
      createdAt: string;
    };

export interface PairingConfig {
  host: string;
  port: string;
  phoneToken: string;
}

export const TOKEN_ROTATED_CLOSE_CODE = 4401;
