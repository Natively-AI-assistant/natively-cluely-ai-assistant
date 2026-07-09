/**
 * Stage catalog — declarative configs for the 8 orchestrated onboarding stages
 * (10 entries incl. quiet_window).
 *
 * Order matters: stages are evaluated front-to-back by the orchestrator, and
 * the first eligible wins (single-slot invariant). The quiet_window is
 * inserted dynamically after trial_promo dismisses, so it is not in this
 * static catalog.
 */

import type { Ctx, StageConfig, ToasterId } from './orchestrator';

export const STAGE_ORDER: ToasterId[] = [
  'permissions',
  'browser_extension',
  'profile_intelligence',
  'modes_manager',
  'trial_promo',
  'support',
  'ads',
  'review_prompt',
];

export const STAGES: StageConfig[] = [
  // ──────────────────────────────────────────────────────────────
  // 1. Permissions — first launch OR returning mac user with revoked TCC
  // ──────────────────────────────────────────────────────────────
  {
    id: 'permissions',
    order: 1,
    onceEver: false, // can re-fire if mac TCC is denied
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 2_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    skipWhen: (s) =>
      // Skip if fully resolved
      (s.permsShown && !s.macTCCBlocked),
    reEligibility: (s) => s.macTCCBlocked,
  },

  // ──────────────────────────────────────────────────────────────
  // 2. Browser extension — gates on permissions + next-launch semantics
  // ──────────────────────────────────────────────────────────────
  {
    id: 'browser_extension',
    order: 2,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 5_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['permissions'],
    skipWhen: (s) =>
      !s.extensionSupported ||
      !s.isV2_8_OrNewer ||
      s.extensionConnected,
    cooldownMs: () => 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  // ──────────────────────────────────────────────────────────────
  // 3. Profile intelligence — after browser ext seen/skipped
  // ──────────────────────────────────────────────────────────────
  {
    id: 'profile_intelligence',
    order: 3,
    onceEver: true,
    isGateOnly: true, // UI is the Launcher's header icon popover, not this stage
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 4_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['browser_extension'],
    skipWhen: (s) =>
      s.hasProfile ||
      s.isPremium ||
      s.seenProfileOnboarding,
  },

  // ──────────────────────────────────────────────────────────────
  // 4. Modes manager — after profile seen/skipped
  // ──────────────────────────────────────────────────────────────
  {
    id: 'modes_manager',
    order: 4,
    onceEver: true,
    isGateOnly: true, // UI is the Launcher's header icon popover, not this stage
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 4_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['profile_intelligence'],
    skipWhen: (s) =>
      s.seenModesOnboarding ||
      s.activeModeSet,
  },

  // ──────────────────────────────────────────────────────────────
  // 5. Trial promo — after modes seen/skipped
  // ──────────────────────────────────────────────────────────────
  {
    id: 'trial_promo',
    order: 5,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 6_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['modes_manager'],
    skipWhen: (s) =>
      s.hasNativelyKey ||
      s.hasTrialToken ||
      s.isPremium,
    cooldownMs: () => 21 * 24 * 60 * 60 * 1000, // 21 days
    reEligibility: (s) => !s.hasNativelyKey && !s.hasTrialToken && !s.isPremium,
  },

  // ──────────────────────────────────────────────────────────────
  // 6. Support — after quiet_window resolves
  // ──────────────────────────────────────────────────────────────
  {
    id: 'support',
    order: 6,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 10_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['quiet_window'],
    skipWhen: (s) => !s.donationShouldShow || s.isPremium,
    customPredicate: (ctx: Ctx) =>
      // Trigger after enough engagement: 10 turns OR 10 successful startups
      ctx.turnCount >= 10 || ctx.startupCount >= 10,
    cooldownMs: () => 14 * 24 * 60 * 60 * 1000, // 14 days
  },

  // ──────────────────────────────────────────────────────────────
  // 7. Ads — useAdCampaigns rotation. After support seen/skipped.
  // ──────────────────────────────────────────────────────────────
  {
    id: 'ads',
    order: 7,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 10_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
      requiresStartupCount: 4,
    },
    requiresStages: ['support'],
    skipWhen: (s) => s.isPremium,
    cooldownMs: () => 14 * 24 * 60 * 60 * 1000, // 14 days
  },

  // ──────────────────────────────────────────────────────────────
  // 8. Review prompt — late-stage engagement gate
  // ──────────────────────────────────────────────────────────────
  {
    id: 'review_prompt',
    order: 8,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 10_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
      requiresStartupCount: 6,
      requiresTotalUsageMs: 45 * 60 * 1000, // 45 minutes
    },
    requiresStages: ['ads'],
    cooldownMs: () => 90 * 24 * 60 * 60 * 1000, // 90 days
  },
];

// ─── Quiet window stage ───────────────────────────────────────────
// Inserted dynamically after trial_promo dismisses. Resolves on 3 user turns
// via customPredicate. No React component — pure orchestrator gate.

export const QUIET_WINDOW_STAGE: StageConfig = {
  id: 'quiet_window',
  order: 99, // not used in static ordering
  isGateOnly: true, // No UI — auto-resolves once predicate is satisfied
  triggers: {},
  customPredicate: (ctx: Ctx) => {
    const baseline = ctx.completed['_turnCountAtQuietStart'] ?? 0;
    return ctx.turnCount - baseline >= 3;
  },
};