/**
 * Persistence layer for the OnboardingOrchestrator.
 *
 * Owns localStorage keys for the orchestrated onboarding flow. Hydrates from
 * legacy keys (natively_perms_shown_v1, natively_seen_modes_onboarding_v5,
 * natively_seen_profile_onboarding_v1, natively_launch_count_v2.7,
 * natively_trial_promo_ts) so users upgrading from pre-orchestrator builds
 * don't see stale toasters replay.
 *
 * Pure functions — no React, no DOM mutations beyond localStorage. Safe to
 * call from anywhere.
 */

import type { OrchestratorState } from './orchestrator';

const VERSION = '1.0';

const KEYS = {
  state:        'natively_onboarding_state_v1',
  version:      'natively_onboarding_version',
  legacySweepAt:'natively_onboarding_legacy_sweep_at',
} as const;

// Legacy keys from the pre-orchestrator app.
const LEGACY = {
  permsShown:           'natively_perms_shown_v1',
  seenModesOnboarding:  'natively_seen_modes_onboarding_v5',
  seenProfileOnboarding:'natively_seen_profile_onboarding_v1',
  launchCount:          'natively_launch_count_v2.7',
  appOpensCount:        'natively_app_opens_count',
  trialPromoTs:         'natively_trial_promo_ts', // read but never written (legacy bug)
  adsHistory:           'natively_ads_shown_history',
} as const;

const LEGACY_SWEEP_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/**
 * Builds the default orchestrator state.
 * - All counters start at 0.
 * - Completed log is empty.
 * - Skipped set is empty.
 * - Active toaster is null.
 * - Queue is empty (will be filled by the stage catalog on init).
 */
export function buildDefaultState(): OrchestratorState {
  return {
    version: VERSION,
    startupCount: 0,
    totalUsageMs: 0,
    turnCount: 0,
    homepageMountedAt: null,
    homepageFrozenAt: null,
    homepageCurrentlyMounted: false,
    appInForeground: true,
    meetingActive: false,
    queue: [],
    completed: {},
    skipped: new Set(),
    activeToasterId: null,
    lastShownTimes: {},
  };
}

/**
 * Loads persisted state. If the version is missing or differs from current,
 * hydrates from legacy keys (forward migration) and returns a fresh state.
 * If no legacy state exists either, returns the default state.
 */
export function loadState(): OrchestratorState {
  const base = buildDefaultState();

  try {
    const raw = localStorage.getItem(KEYS.state);
    const version = localStorage.getItem(KEYS.version);

    if (raw && version === VERSION) {
      const parsed = JSON.parse(raw);
      // Crash recovery: if the prior session died with an active toaster,
      // that toaster is stale. Mark it as completed (timestamp of recovery)
      // and clear the slot so the orchestrator re-evaluates from a clean state.
      const recoveredCompleted = { ...(parsed.completed ?? {}) };
      let recoveredActive = parsed.activeToasterId ?? null;
      if (recoveredActive) {
        console.log(
          '[OnboardingPersistence] Recovered from crash with active toaster:',
          recoveredActive,
          '— auto-completing.',
        );
        recoveredCompleted[recoveredActive] = Date.now();
        recoveredActive = null;
      }
      return {
        ...base,
        ...parsed,
        completed: recoveredCompleted,
        activeToasterId: recoveredActive,
        // Session-scoped fields — always reset on cold launch. These use
        // performance.now() (per-process) or track runtime UI state.
        homepageCurrentlyMounted: false,
        homepageMountedAt: null,
        appInForeground: true,
        meetingActive: false,
        // Set objects don't survive JSON round-trip; rehydrate
        skipped: new Set(parsed.skipped ?? []),
        queue: parsed.queue ?? [],
        lastShownTimes: parsed.lastShownTimes ?? {},
      };
    }

    // Either no prior orchestrator state, or version mismatch.
    // Hydrate from legacy keys.
    const hydrated = hydrateFromLegacy(base);
    maybeSweepLegacyKeys();
    return hydrated;
  } catch (e) {
    console.warn('[OnboardingPersistence] loadState failed, using default:', e);
    return base;
  }
}

/**
 * Persists the current state. Should be called on every tick.
 */
export function saveState(state: OrchestratorState): void {
  try {
    const serialized = {
      ...state,
      skipped: Array.from(state.skipped),
    };
    localStorage.setItem(KEYS.state, JSON.stringify(serialized));
    localStorage.setItem(KEYS.version, VERSION);
  } catch (e) {
    console.warn('[OnboardingPersistence] saveState failed:', e);
  }
}

/**
 * Forward-migrates legacy localStorage keys into orchestrator state.
 * Idempotent — safe to call repeatedly.
 */
function hydrateFromLegacy(base: OrchestratorState): OrchestratorState {
  const completed = { ...base.completed };
  const lastShownTimes = { ...base.lastShownTimes };

  // 1. Permissions — once-ever
  if (localStorage.getItem(LEGACY.permsShown) === '1') {
    completed['permissions'] = Date.now();
  }

  // 2. Modes onboarding — once-ever
  if (localStorage.getItem(LEGACY.seenModesOnboarding) === 'true') {
    completed['modes_manager'] = Date.now();
  }

  // 3. Profile onboarding — once-ever
  if (localStorage.getItem(LEGACY.seenProfileOnboarding) === 'true') {
    completed['profile_intelligence'] = Date.now();
  }

  // 4. Trial promo — bug: legacy code wrote but never read. Migrate if present.
  const trialTs = localStorage.getItem(LEGACY.trialPromoTs);
  if (trialTs) {
    const ts = parseInt(trialTs, 10);
    if (Number.isFinite(ts)) {
      completed['trial_promo'] = ts;
    }
  }

  // 5. Startup count — take max of two legacy sources
  const legacyLaunch = parseInt(localStorage.getItem(LEGACY.launchCount) || '0', 10);
  const legacyOpens = parseInt(localStorage.getItem(LEGACY.appOpensCount) || '0', 10);
  const startupCount = Math.max(
    Number.isFinite(legacyLaunch) ? legacyLaunch : 0,
    Number.isFinite(legacyOpens) ? legacyOpens : 0,
  );

  // 6. Ad history — parse JSON array of ad IDs
  try {
    const adsRaw = localStorage.getItem(LEGACY.adsHistory);
    if (adsRaw) {
      const ads = JSON.parse(adsRaw);
      if (Array.isArray(ads)) {
        const now = Date.now();
        ads.forEach((id: string) => {
          lastShownTimes[id] = now;
        });
      }
    }
  } catch { /* malformed history — skip */ }

  return {
    ...base,
    completed,
    lastShownTimes,
    startupCount,
  };
}

/**
 * Periodically sweeps legacy localStorage keys once the orchestrator has been
 * active for 60 days. The 60-day grace period ensures a user who downgrades
 * mid-flight doesn't lose their state.
 */
function maybeSweepLegacyKeys(): void {
  try {
    const lastSweep = parseInt(localStorage.getItem(KEYS.legacySweepAt) || '0', 10);
    const now = Date.now();
    if (lastSweep && now - lastSweep < LEGACY_SWEEP_INTERVAL_MS) return;

    // Only sweep after 60 days since the user first hit the orchestrator code.
    // We don't have an install timestamp, so use the last shown time of any
    // toaster as a proxy — once the user has seen at least one orchestrated
    // toaster, they're committed to the new flow.
    const anyCompleted = Object.keys(
      JSON.parse(localStorage.getItem(KEYS.state) || '{}').completed || {},
    ).length > 0;
    if (!anyCompleted) return;

    localStorage.removeItem(LEGACY.trialPromoTs);
    localStorage.removeItem(LEGACY.permsShown);
    localStorage.removeItem(LEGACY.seenModesOnboarding);
    localStorage.removeItem(LEGACY.seenProfileOnboarding);
    localStorage.setItem(KEYS.legacySweepAt, now.toString());
  } catch { /* best-effort cleanup */ }
}

/**
 * Test helper — clears all orchestrator state including the version marker.
 * Used by unit tests to reset between runs. NEVER call from production code.
 */
export function _clearAllForTests(): void {
  try {
    localStorage.removeItem(KEYS.state);
    localStorage.removeItem(KEYS.version);
    localStorage.removeItem(KEYS.legacySweepAt);
  } catch { /* ignore */ }
}