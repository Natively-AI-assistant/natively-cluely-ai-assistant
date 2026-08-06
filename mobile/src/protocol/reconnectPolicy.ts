import { TOKEN_ROTATED_CLOSE_CODE } from './types';

export type CloseReason =
  | { kind: 'token_rotated'; message: string }
  | { kind: 'auth_rejected'; message: string }
  | { kind: 'transient'; message: string; reconnect: true };

export const INITIAL_RECONNECT_DELAY_MS = 800;
export const MAX_RECONNECT_DELAY_MS = 8000;
export const RECONNECT_GROWTH = 1.6;

/**
 * Decide whether to auto-reconnect after a WebSocket close.
 * Close code 4401 (token rotated) must never reconnect — avoids a reconnect storm.
 */
export function classifyClose(code: number, reason?: string): CloseReason {
  if (code === TOKEN_ROTATED_CLOSE_CODE) {
    return {
      kind: 'token_rotated',
      message:
        reason?.trim() ||
        'Pairing token rejected (rotated). Update the phone token and reconnect.',
    };
  }
  // Some stacks surface upgrade 401 as abnormal close without 4401.
  if (code === 1008 || code === 4001) {
    return {
      kind: 'auth_rejected',
      message: reason?.trim() || 'Authentication failed. Check host, port, and phone token.',
    };
  }
  return {
    kind: 'transient',
    message: reason?.trim() || `Disconnected (code ${code})`,
    reconnect: true,
  };
}

/** Whether the connection manager should schedule another connect attempt. */
export function shouldAutoReconnect(close: CloseReason): boolean {
  return close.kind === 'transient';
}

/** Next backoff delay (web client: 800ms → ≤8s exponential ×1.6). */
export function nextReconnectDelay(currentDelayMs: number): number {
  const capped = Math.min(Math.max(currentDelayMs, INITIAL_RECONNECT_DELAY_MS), MAX_RECONNECT_DELAY_MS);
  return Math.min(Math.round(capped * RECONNECT_GROWTH), MAX_RECONNECT_DELAY_MS);
}

/**
 * Classify a failed open (e.g. HTTP 401 before upgrade).
 * RN WebSocket often only fires error/close without status — callers pass a hint.
 */
export function classifyConnectFailure(hint?: { httpStatus?: number; message?: string }): CloseReason {
  if (hint?.httpStatus === 401) {
    return {
      kind: 'auth_rejected',
      message: 'Unauthorized (401). Pairing token is invalid — update token and try again.',
    };
  }
  const msg = hint?.message?.toLowerCase() ?? '';
  if (msg.includes('401') || msg.includes('unauthorized')) {
    return {
      kind: 'auth_rejected',
      message: 'Unauthorized. Pairing token is invalid — update token and try again.',
    };
  }
  return {
    kind: 'transient',
    message: hint?.message || 'Connection failed',
    reconnect: true,
  };
}
