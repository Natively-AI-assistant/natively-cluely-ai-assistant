export const DEFAULT_REVIVE_COOLDOWN_MS: number;

export interface ReviveDecisionState {
  /** Session is still active (NOT stopped by the user). */
  isActive: boolean;
  /** Auto-reconnect flag; false after exhaustion OR after stop(). */
  shouldReconnect: boolean;
  /** A connect() attempt is already in flight. */
  isConnecting: boolean;
  /** A live socket already exists. */
  hasSocket: boolean;
  /** Timestamp (ms) when reconnect was exhausted; null/undefined if it wasn't. */
  exhaustedAt: number | null | undefined;
  /** Current time (ms). */
  now: number;
  /** Min gap since exhaustion before reviving. Defaults to DEFAULT_REVIVE_COOLDOWN_MS. */
  cooldownMs?: number;
}

export function shouldReviveExhaustedReconnect(state: ReviveDecisionState): boolean;
