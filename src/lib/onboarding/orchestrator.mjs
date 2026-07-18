/**
 * OnboardingOrchestrator — .mjs companion exposing the pure decision-engine
 * function for unit tests under `node --test`.
 *
 * The full class (with the drain loop, pub/sub, event bus) lives in
 * orchestrator.ts. This file re-implements ONLY the pure `shouldShowToaster`
 * predicate so tests can exercise it without DOM polyfills.
 *
 * ⚠️ DO NOT re-add a `getOrchestrator()` / stateful-orchestrator export here.
 * History (bisected 2026-07-10): this file used to export a NO-OP
 * `getOrchestrator()` "for test/static contexts". Because the app imported the
 * orchestrator with an UNQUALIFIED specifier (`'./onboarding/orchestrator'`)
 * and Vite's default `resolve.extensions` puts `.mjs` BEFORE `.ts`, the
 * PACKAGED bundle silently resolved THIS no-op stub instead of the real
 * orchestrator.ts class. Result: `orch.start()` did nothing, no toaster ever
 * showed, and the stub's `getSnapshot()` returned a fresh object literal every
 * call → `useSyncExternalStore` infinite-render → "Maximum update depth" →
 * blank/black launcher (the "stuck at startup" field bug). It was only masked
 * later by adding explicit `.ts` extensions + a `vite.config.mts`
 * `resolve.extensions` override (commit 6f32a64). Keeping a stateful export
 * here re-arms that footgun: if either guardrail regresses, the shadow returns
 * SILENTLY. By exporting only the pure function, a shadowing regression instead
 * fails LOUD — `getOrchestrator is not a function` at import — which is what we
 * want. The real singleton lives exclusively in orchestrator.ts.
 */

/**
 * Pure decision function — given a stage config and a context, returns whether
 * the toaster should fire. Mirrors `OnboardingOrchestrator.shouldShowToaster`.
 */
export function shouldShowToaster(config, ctx) {
  // 1. Hard skip — user-state
  if (config.skipWhen && config.skipWhen(ctx.userState)) return false;

  // 2. Already done forever
  if (
    config.onceEver &&
    ctx.completed[config.id] &&
    !(config.reEligibility && config.reEligibility(ctx.userState, ctx.completed))
  ) {
    return false;
  }

  // 3. Cooldown
  const lastShown = ctx.lastShownTimes[config.id] ?? 0;
  const cooldownMs = config.cooldownMs ? config.cooldownMs(ctx.userState) : 0;
  if (cooldownMs > 0 && ctx.now - lastShown < cooldownMs) return false;

  // 4. Prerequisites
  if (config.requiresStages) {
    for (const dep of config.requiresStages) {
      if (!ctx.completed[dep] && !ctx.skipped.has(dep)) return false;
    }
  }

  // 5. Soft triggers
  const t = config.triggers || {};
  if (t.requiresHomepageMounted && !ctx.homepageCurrentlyMounted) return false;
  if (t.requiresHomepageDuration != null && ctx.homepageMountedFor < t.requiresHomepageDuration) return false;
  if (t.requiresStartupCount != null && ctx.startupCount < t.requiresStartupCount) return false;
  if (t.requiresTurnCount != null && ctx.turnCount < t.requiresTurnCount) return false;
  if (t.requiresTotalUsageMs != null && ctx.totalUsageMs < t.requiresTotalUsageMs) return false;
  if (t.requiresForeground && !ctx.appInForeground) return false;
  if (t.requiresMeetingInactive && ctx.meetingActive) return false;

  // 6. Custom predicate
  if (config.customPredicate && !config.customPredicate(ctx)) return false;

  return true;
}

/**
 * Default UserState — mirrors orchestrator.ts's DEFAULT_USER_STATE for tests
 * that build a Ctx without the full class. Pure data, safe to export.
 */
export const DEFAULT_USER_STATE = {
  isPremium: false,
  hasProfile: false,
  hasNativelyKey: false,
  hasTrialToken: false,
  extensionConnected: false,
  extensionSupported: true,
  permsShown: false,
  macTCCBlocked: false,
  seenProfileOnboarding: false,
  seenModesOnboarding: false,
  activeModeSet: false,
  donationShouldShow: false,
  isV2_8_OrNewer: true,
};

// NOTE: a stateful `getOrchestrator()` export was DELIBERATELY REMOVED here
// (2026-07-10) — see the file header. The real, only orchestrator singleton
// is `getOrchestrator()` in orchestrator.ts. Re-adding one here silently
// shadows it in the Vite bundle and reintroduces the blank-launcher bug.