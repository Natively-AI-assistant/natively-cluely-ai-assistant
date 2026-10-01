import type { FunnelProps } from './funnelCatalog.mjs';

export const FUNNEL_QUEUE_MAX: number;
export const FUNNEL_BATCH: number;
export const FUNNEL_MAX_AGE_MS: number;
export const FUNNEL_DEDUPE_MS: number;
export const FUNNEL_BACKOFF_MS: readonly number[];

export interface FunnelQueue {
  events: Array<Record<string, unknown>>;
  attempt: number;
  nextAttemptAt: number;
}

export function funnelIdentityHeaders(
  credentials: { trialToken?: string; apiKey?: string } | undefined,
): Record<string, string>;

export function parseFunnelQueue(text: string | null | undefined): FunnelQueue;

export type FunnelTrackResult = 'queued' | 'disabled' | 'invalid' | 'no_install' | 'duplicate' | 'error';

export interface FunnelClientDeps {
  load: () => string | null;
  save: (text: string) => boolean;
  fetchImpl: typeof fetch;
  endpoint: string;
  now: () => number;
  newId: () => string;
  installId: () => string | undefined;
  appVersion: () => string | undefined;
  platform: string;
  appSessionId?: string;
  isEnabled: () => boolean;
  getEntitlement?: () => string | undefined;
  deviceId?: () => string | undefined;
  getCredentials?: () => { trialToken?: string; apiKey?: string } | undefined;
  ensureInstallToken?: (installId: string) => Promise<{ token?: string; skipped?: string; failed?: string }>;
  invalidateInstallToken?: (installId: string) => void;
  random?: () => number;
  log?: { warn: (...args: unknown[]) => void };
}

export interface FunnelClient {
  track(eventType: string, props?: FunnelProps): FunnelTrackResult;
  dispatchOnce(): Promise<{ sent: number; delivered?: number; rejected?: number; failed?: string; skipped?: string }>;
  pending(): number;
  stats(): Record<string, number>;
}

export function createFunnelClient(deps: FunnelClientDeps): FunnelClient;
