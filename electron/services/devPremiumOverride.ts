import { app } from 'electron';

export function isDevPremiumOverrideEnabled(): boolean {
  return !app.isPackaged
    && process.env.NODE_ENV === 'development'
    && process.env.NATIVELY_DEV_PREMIUM === '1';
}

export function getDevPlanOverride(): string | null {
  if (!isDevPremiumOverrideEnabled()) return null;
  return process.env.NATIVELY_DEV_PLAN ?? 'ultra';
}
