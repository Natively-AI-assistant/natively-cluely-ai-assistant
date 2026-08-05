/**
 * Stage catalog — declarative configs for orchestrated onboarding stages
 * (entries incl. quiet_window inserted dynamically).
 *
 * Order matters: stages are evaluated front-to-back by the orchestrator, and
 * the first eligible wins (single-slot invariant). The quiet_window is
 * inserted dynamically after trial_promo would complete (legacy path;
 * trial_promo is now permanently skipped), so it is not in this static catalog.
 */

import type { Ctx, StageConfig, ToasterId } from './orchestrator';

export const STAGE_ORDER: ToasterId[] = [
  'permissions',
  'browser_extension',
  'profile_intelligence',
  'modes_manager',
  'trial_promo',
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
  // 5. Trial promo — permanently skipped (commercial-surface-strip / ticket 03).
  // Kept registered so persisted queues stay valid; skipWhen always auto-skips.
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
    skipWhen: () => true,
    cooldownMs: () => 21 * 24 * 60 * 60 * 1000, // 21 days
  },

  // ──────────────────────────────────────────────────────────────
  // 6. Ads — permanently skipped (commercial-surface-strip / ticket 05).
  // Kept registered so persisted queues stay valid; skipWhen always
  // auto-skips. Premium useAdCampaigns stubs remain no-op (skip-premium).
  // (support / donation stage removed — commercial-surface-strip #02)
  // ──────────────────────────────────────────────────────────────
  {
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
    cooldownMs: () => 14 * 24 * 60 * 60 * 1000, // 14 days
  },

  // ──────────────────────────────────────────────────────────────
  // 7. Review prompt — permanently skipped (commercial-surface-strip / ticket 05).
  // ──────────────────────────────────────────────────────────────
  {
    id: 'review_prompt',
    order: 7,
    triggers: {
      requiresHomepageMounted: true,
      requiresHomepageDuration: 10_000,
      requiresForeground: true,
      requiresMeetingInactive: true,
      requiresStartupCount: 6,
      requiresTotalUsageMs: 45 * 60 * 1000, // 45 minutes
    },
    requiresStages: ['ads'],
    skipWhen: () => true,
    cooldownMs: () => 90 * 24 * 60 * 60 * 1000, // 90 days
  },
];

// ─── Quiet window stage ───────────────────────────────────────────
// Inserted dynamically after trial_promo completes (legacy; trial_promo is
// permanently skipped so this gate is rarely inserted). Resolves on 3 user
// turns via customPredicate. No React component — pure orchestrator gate.

export const QUIET_WINDOW_STAGE: StageConfig = {
  id: 'quiet_window',
  order: 99, // not used in static ordering
  // onceEver is load-bearing: without it, a persisted queue that still contains
  // quiet_window (common after commercial-surface-strip left it in localStorage)
  // re-completes the gate on every drain tick → completeToaster → notify →
  // ensureDraining(delay=0) → tick forever, wedging the launcher on the splash
  // logo (native RSS climbs to multi-GB). See scripts/diag-stuck-at-logo.mjs.
  onceEver: true,
  isGateOnly: true, // No UI — auto-resolves once predicate is satisfied
  // MUST be onceEver like every other gate-only stage (profile_intelligence,
  // modes_manager). Without it, evaluateAndDispatch()'s auto-complete branch
  // re-completes this stage on EVERY pass of its `do { … } while (progressMade
  // && !activeToasterId)` drain loop: completeToaster() records completion, but
  // shouldShowToaster() only suppresses a completed stage when `onceEver` is set
  // (see orchestrator.ts step 2), so without it the stage stays eligible, keeps
  // setting progressMade=true, and the loop spins synchronously forever — each
  // pass calling persist()+notify(), churning unbounded native memory. That
  // pegged the launcher renderer's main thread and grew its RSS to ~9 GB before
  // an exitCode-5 OOM crash (2026-07-19). It resolves exactly once (3 user turns
  // after trial_promo), so once-ever is also the correct semantics.
  triggers: {},
  customPredicate: (ctx: Ctx) => {
    const baseline = ctx.completed['_turnCountAtQuietStart'] ?? 0;
    return ctx.turnCount - baseline >= 3;
  },
};