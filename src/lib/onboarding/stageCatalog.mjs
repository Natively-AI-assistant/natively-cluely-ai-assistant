/**
 * Stage catalog — .mjs companion to stageCatalog.ts.
 *
 * Stage configurations are pure data + functions, so we can mirror them
 * cleanly in .mjs for `node --test`.
 */

export const STAGE_ORDER = [
  'permissions',
  'browser_extension',
  'profile_intelligence',
  'modes_manager',
  'trial_promo',
  'ads',
  'review_prompt',
];

export const STAGES = [
  {
    id: 'permissions',
    order: 1,
    onceEver: false,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 2000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    skipWhen: (s) => (s.permsShown && !s.macTCCBlocked),
    reEligibility: (s) => s.macTCCBlocked,
  },
  {
    id: 'browser_extension',
    order: 2,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 5000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['permissions'],
    skipWhen: (s) => !s.extensionSupported || !s.isV2_8_OrNewer || s.extensionConnected,
    cooldownMs: () => 7 * 24 * 60 * 60 * 1000,
  },
  {
    id: 'profile_intelligence',
    order: 3,
    onceEver: true,
    isGateOnly: true,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 4000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['browser_extension'],
    skipWhen: (s) => s.hasProfile || s.isPremium || s.seenProfileOnboarding,
  },
  {
    id: 'modes_manager',
    order: 4,
    onceEver: true,
    isGateOnly: true,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 4000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['profile_intelligence'],
    skipWhen: (s) => s.seenModesOnboarding || s.activeModeSet,
  },
  {
    // Permanently skipped — commercial-surface-strip / ticket 03.
    id: 'trial_promo',
    order: 5,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 6000,
      requiresForeground: true,
      requiresMeetingInactive: true,
    },
    requiresStages: ['modes_manager'],
    skipWhen: () => true,
    cooldownMs: () => 21 * 24 * 60 * 60 * 1000,
  },
  {
    // Permanently skipped — commercial-surface-strip / ticket 05.
    id: 'ads',
    order: 6,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 10_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
      requiresStartupCount: 4,
    },
    requiresStages: ['quiet_window'],
    skipWhen: () => true,
    cooldownMs: () => 14 * 24 * 60 * 60 * 1000,
  },
  {
    // Permanently skipped — commercial-surface-strip / ticket 05.
    id: 'review_prompt',
    order: 7,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 10_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
      requiresStartupCount: 6,
      requiresTotalUsageMs: 45 * 60 * 1000,
    },
    requiresStages: ['ads'],
    skipWhen: () => true,
    cooldownMs: () => 90 * 24 * 60 * 60 * 1000,
  },
];

export const QUIET_WINDOW_STAGE = {
  id: 'quiet_window',
  order: 99,
  onceEver: true,
  isGateOnly: true,
  triggers: {},
  customPredicate: (ctx) => ctx.turnCount - (ctx.completed._turnCountAtQuietStart ?? 0) >= 3,
};