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

/** Mode row from desktop `status` / modes:list (ticket 17). */
export interface PhoneModeSummary {
  id: string;
  name: string;
  templateType: string;
}

/** Phone → desktop commands owned by ticket 20 (start / modes). */
export type SessionControlCommand =
  | { type: 'start-session' }
  | { type: 'modes'; op: 'list' }
  | { type: 'modes'; op: 'set'; modeId: string };

/** Session/stealth/mode snapshot from desktop `status` StreamEvent. */
export interface SessionStatus {
  sessionActive: boolean;
  stealthActive: boolean;
  modeId: string | null;
  modes: PhoneModeSummary[];
}

export type StreamEvent =
  | { type: 'history'; messages: PersistedMessage[] }
  | { type: 'user'; id: string; content: string; createdAt: string }
  | { type: 'token'; streamId: string; token: string }
  | { type: 'done'; streamId: string; content: string; createdAt: string }
  | { type: 'error'; streamId: string; message: string }
  | { type: 'assistant'; id: string; content: string; label: string; createdAt: string }
  | { type: 'ack'; action: string; message: string }
  | {
      type: 'status';
      sessionActive: boolean;
      stealthActive: boolean;
      modeId: string | null;
      modes?: PhoneModeSummary[];
    };

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
