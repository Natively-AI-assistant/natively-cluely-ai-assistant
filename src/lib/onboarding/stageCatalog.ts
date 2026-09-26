/**
 * Stage catalog — every card the launcher's orchestrator can show (toaster
 * policy, docs/superpowers/specs/2026-09-26-toaster-policy-design.md).
 *
 * Order matters: stages are evaluated front-to-back and the first eligible
 * wins (single-slot invariant), so the promotional stages' order IS their
 * priority. A stage that names a `card` also obeys the card ledger (strikes,
 * retirement, day one, the 72 h budget, one card of its class per launch);
 * those rules live in the orchestrator and src/lib/cards/cardPolicy.mjs. The
 * predicates here only say whether a card is relevant to this user at all.
 *
 * Card stages decide by customPredicate, never skipWhen: an auto-skip is
 * persisted, and a card that becomes relevant later (a key removed, a plan
 * changed) must be able to come back.
 */

import type { Ctx, StageConfig, ToasterId, UserState, Triggers } from './orchestrator';
import { entryOf } from '../cards/cardPolicy.mjs';

/**
 * Engagement policy for the review prompt, mirrored from the review ledger
 * (electron/services/ReviewPromptLogic.ts, and its backend twin in
 * natively-api/reviews.js). Restated here because this module is renderer-side
 * and cannot import from electron/ — the ReviewPromptLogic header already
 * documents that this trio must be kept in sync.
 *
 * WHY THIS IS A PREDICATE AND NOT `triggers`. The ledger's rule is
 * "N sessions OR M minutes" — either one qualifies. The orchestrator ANDs every
 * trigger it is given, so expressing this as requiresStartupCount +
 * requiresTotalUsageMs silently changed the policy to "N sessions AND M
 * minutes", a strictly harder gate. That is what shipped: the catalog demanded
 * 6 startups AND 45 minutes while the ledger asked for 3 OR 30, so the ledger's
 * thresholds were dead in production and tuning them moved nothing.
 */
export const REVIEW_PROMPT_MIN_SESSIONS = 3;
export const REVIEW_PROMPT_MIN_USAGE_MS = 30 * 60 * 1000;

/**
 * Real app launches: the card ledger's main-process count once it has loaded
 * (the orchestrator's own startupCount also counts renderer reloads).
 */
export function launchesOf(ctx: Ctx): number {
  return ctx.userState?.cardLedger?.launchCount ?? ctx.startupCount;
}

/** True once the user is engaged enough to be asked — sessions OR usage. */
export function reviewEngagementMet(ctx: Ctx): boolean {
  return launchesOf(ctx) >= REVIEW_PROMPT_MIN_SESSIONS
    || ctx.totalUsageMs >= REVIEW_PROMPT_MIN_USAGE_MS;
}

/** Support asks only engaged users: 10 AI questions or 10 launches. */
export const SUPPORT_MIN_TURNS = 10;
export const SUPPORT_MIN_LAUNCHES = 10;

/** Max/Ultra is offered to Pro users who have used this much of a quota. */
export const MAX_ULTRA_QUOTA_PCT = 80;

const home = (ms: number): Triggers => ({
  requiresHomepageMounted: true,
  requiresHomepageDuration: ms,
  requiresForeground: true,
  requiresMeetingInactive: true,
});

const hasNoKeys = (s: UserState) => !s.hasNativelyKey && !s.hasOwnAiKey;

/** No promotional card during a free trial, none for Max/Ultra subscribers. */
const promoAudience = (s: UserState) => !s.hasTrialToken && s.planTier !== 'max' && s.planTier !== 'ultra';

export const STAGE_ORDER: ToasterId[] = [
  'permissions',
  'trial_promo',
  'natively_api_new',
  'browser_extension',
  'profile_intelligence',
  'modes_manager',
  'max_ultra',
  'natively_api_existing',
  'profile_ad',
  'jd_ad',
  'review_prompt',
  'support',
];

export const STAGES: StageConfig[] = [
  // ── Essential ─────────────────────────────────────────────────
  // Permissions — first launch, then only when a required permission needs
  // attention (src/lib/permissionAttentionPolicy.mjs).
  {
    id: 'permissions',
    order: 1,
    onceEver: false, // comes back while a required permission needs attention
    triggers: home(2_000),
    skipWhen: (s) =>
      // Skip if fully resolved
      (s.permsShown && !s.permissionsNeedAttention),
    reEligibility: (s) => s.permissionsNeedAttention,
    reopensWhenReEligible: true,
  },

  // ── Onboarding (day 1 allowed, one per launch) ────────────────
  // Free-trial promo: for someone with no way to get an answer yet.
  {
    id: 'trial_promo',
    order: 2,
    card: 'trial_promo',
    triggers: home(6_000),
    requiresStages: ['permissions'],
    customPredicate: ({ userState: s }) =>
      hasNoKeys(s) && !s.isPremium && !s.trialClaimed && !s.hasTrialToken,
  },

  // Natively API "Skip the setup": the same need, once the trial is not an
  // option (used, or its promo retired), so the two are never both offered.
  {
    id: 'natively_api_new',
    order: 3,
    card: 'natively_api_new',
    triggers: home(6_000),
    requiresStages: ['permissions'],
    customPredicate: ({ userState: s }) =>
      hasNoKeys(s) && !s.isPremium && !s.hasTrialToken
      && (s.trialClaimed || (!!s.cardLedger && entryOf(s.cardLedger, 'trial_promo').retired)),
  },

  // Browser extension: until it is connected (read live).
  {
    id: 'browser_extension',
    order: 4,
    card: 'browser_extension',
    triggers: home(5_000),
    requiresStages: ['permissions'],
    customPredicate: ({ userState: s }) => s.extensionSupported && !s.extensionConnected,
  },

  // ── Gate-only markers (no UI; kept for their persisted completion) ──
  {
    id: 'profile_intelligence',
    order: 5,
    onceEver: true,
    isGateOnly: true, // UI is the Launcher's header icon popover, not this stage
    triggers: home(4_000),
    requiresStages: ['browser_extension'],
    skipWhen: (s) =>
      s.hasProfile ||
      s.isPremium ||
      s.seenProfileOnboarding,
  },
  {
    id: 'modes_manager',
    order: 6,
    onceEver: true,
    isGateOnly: true, // UI is the Launcher's header icon popover, not this stage
    triggers: home(4_000),
    requiresStages: ['profile_intelligence'],
    skipWhen: (s) =>
      s.seenModesOnboarding ||
      s.activeModeSet,
  },

  // ── Promotional (1 per 72 h, from 24 h after first launch; order = priority) ──
  {
    id: 'max_ultra',
    order: 10,
    card: 'max_ultra',
    triggers: home(10_000),
    customPredicate: ({ userState: s }) =>
      promoAudience(s) && s.planTier === 'pro' && s.nativelyQuotaPct >= MAX_ULTRA_QUOTA_PCT,
  },
  {
    id: 'natively_api_existing',
    order: 11,
    card: 'natively_api_existing',
    triggers: home(10_000),
    customPredicate: ({ userState: s }) =>
      promoAudience(s) && s.hasOwnAiKey && !s.hasNativelyKey && !s.isPremium,
  },
  {
    id: 'profile_ad',
    order: 12,
    card: 'profile_ad',
    triggers: home(10_000),
    customPredicate: ({ userState: s }) => promoAudience(s) && !s.isPremium && !s.hasProfile,
  },
  {
    id: 'jd_ad',
    order: 13,
    card: 'jd_ad',
    triggers: home(10_000),
    customPredicate: ({ userState: s }) => promoAudience(s) && !s.isPremium && s.hasProfile && !s.hasJD,
  },
  {
    id: 'review_prompt',
    order: 14,
    card: 'review_prompt',
    triggers: home(10_000),
    // Engagement is a predicate, not `triggers`: the orchestrator ANDs triggers
    // and the policy is "sessions OR usage" (see reviewEngagementMet).
    customPredicate: (ctx) => promoAudience(ctx.userState) && reviewEngagementMet(ctx),
  },
  {
    id: 'support',
    order: 15,
    card: 'support',
    triggers: home(10_000),
    customPredicate: (ctx) =>
      promoAudience(ctx.userState) && !ctx.userState.isPremium
      && (ctx.turnCount >= SUPPORT_MIN_TURNS || launchesOf(ctx) >= SUPPORT_MIN_LAUNCHES),
  },
];

// ─── Quiet window stage ───────────────────────────────────────────
// Inserted dynamically after trial_promo dismisses. Resolves on 3 user turns
// via customPredicate. No React component — pure orchestrator gate.

export const QUIET_WINDOW_STAGE: StageConfig = {
  id: 'quiet_window',
  order: 99, // not used in static ordering
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
  onceEver: true,
  triggers: {},
  customPredicate: (ctx: Ctx) => {
    const baseline = ctx.completed['_turnCountAtQuietStart'] ?? 0;
    return ctx.turnCount - baseline >= 3;
  },
};