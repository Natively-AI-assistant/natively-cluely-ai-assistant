export type ApiPlanKey = 'standard' | 'pro' | 'max' | 'ultra';
export type BillingCycle = 'monthly' | 'yearly';
export type ProPackId = 'pack_light' | 'pack_heavy';

export const API_PLAN_PRICES: Readonly<Record<ApiPlanKey, Readonly<{ monthly: number; yearly: number }>>>;
export const YEARLY_MONTHS_FREE: number;
export const PRO_PACKS: ReadonlyArray<Readonly<{ id: ProPackId; name: string; price: number; hours: number; days: number }>>;

export function isPackPlan(plan: unknown): boolean;
export function apiPlanLabel(plan: string | null | undefined): string | null;
export function apiPlanPrice(planKey: string, cycle: BillingCycle): string | null;
export function formatMeetingTime(seconds: number | null | undefined): string;

export interface PackStatus {
  hoursKnown: boolean;
  secondsTotal: number | null;
  secondsLeft: number | null;
  usedPercent: number;
  endsAt: string | null;
  ended: boolean;
  endedReason: 'hours_used' | 'window_closed' | string | null;
}
export function packStatus(
  pack: {
    seconds_total?: number | null;
    seconds_used?: number | null;
    seconds_left?: number | null;
    ends_at?: string | null;
    ended?: boolean;
    ended_reason?: string | null;
  } | null | undefined,
  now?: number,
): PackStatus | null;

export interface PackBlock {
  plan?: string | null;
  seconds_total?: number | null;
  seconds_used?: number | null;
  seconds_left?: number | null;
  ends_at?: string | null;
  ended?: boolean;
  ended_reason?: string | null;
}
export function endedPackFromRefusal(
  answer: { ok?: boolean; error?: string; reason?: string; pack_ended_reason?: string | null; pack?: PackBlock | null } | null | undefined,
  lastKnown: { plan?: string; billing_period?: string; pack?: PackBlock | null } | null | undefined,
): { plan: string | null; pack: PackBlock & { ended: true; ended_reason: string | null } } | null;
export function packMeetingBucket(
  pack: PackBlock | null | undefined,
  thresholdPct?: number,
  now?: number,
): { label: string; detail: string; pct: number } | null;
