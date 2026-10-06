import type { FunnelEntitlement } from './funnelCatalog.mjs';

export function resolveEntitlement(s?: {
  licensed?: boolean;
  hasRealApiKey?: boolean;
  hasTrialToken?: boolean;
  trialExpired?: boolean;
  hasOwnAi?: boolean;
}): FunnelEntitlement;

export function usesLocalModel(defaultModel: string | null | undefined): boolean;

export function resolveMeetingAi(s?: { defaultModel?: string | null; hasOwnAi?: boolean }): 'natively' | 'own' | 'none';

export function localDay(nowMs: number): string;
export function minutesSince(then: number | string | null | undefined, nowMs: number): number | undefined;
export function daysSince(thenMs: number, nowMs: number): number;

export type TrialStartResult =
  | 'ok' | 'already_used' | 'already_used_expired' | 'ip_limit' | 'rate_limited'
  | 'hwid_unavailable' | 'network' | 'server_error';

export function mapTrialStartResult(r?: {
  hwidUnavailable?: boolean;
  threw?: boolean;
  status?: number;
  error?: string;
  body?: { ok?: boolean; expired?: boolean; already_used?: boolean };
}): TrialStartResult;

export function trialCardActionForChoice(choice: string): 'plan_standard' | 'plan_pro' | 'plan_max' | 'plan_ultra' | 'byok' | null;

export interface FunnelState {
  firstRunSent: boolean;
  lastActiveDay: string;
  trialStartedAt: number | null;
  byokExitAt: number | null;
  meetings: number;
}

export function normalizeFunnelState(raw: unknown): FunnelState;

export interface OpenMeeting {
  startedAt: number;
  seenAt: number;
  first: boolean;
  /** The launch that wrote it. */
  boot: string;
}

export function normalizeOpenMeeting(raw: unknown): OpenMeeting | null;
export function cutOffMeeting(open: OpenMeeting | null, bootId: string): { minutes: number; first: boolean } | null;

export function isFirstRun(s: {
  firstRunSent: boolean;
  installCreatedAtMs: number;
  nowMs: number;
  windowMs?: number;
}): boolean;
