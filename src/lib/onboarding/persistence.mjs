/**
 * Persistence layer for the OnboardingOrchestrator.
 *
 * .mjs companion to persistence.ts. Stripped of TS type imports so it can be
 * exercised by `node --test` against `src/lib/onboarding/__tests__/`.
 */

const VERSION = '1.0';

const KEYS = {
  state:         'natively_onboarding_state_v1',
  version:       'natively_onboarding_version',
  legacySweepAt: 'natively_onboarding_legacy_sweep_at',
};

const LEGACY = {
  permsShown:           'natively_perms_shown_v1',
  seenModesOnboarding:  'natively_seen_modes_onboarding_v5',
  seenProfileOnboarding:'natively_seen_profile_onboarding_v1',
  launchCount:          'natively_launch_count_v2.7',
  appOpensCount:        'natively_app_opens_count',
  trialPromoTs:         'natively_trial_promo_ts',
  adsHistory:           'natively_ads_shown_history',
};

const LEGACY_SWEEP_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000;

export function buildDefaultState() {
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

export function loadState() {
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
        // Session-scoped fields — always reset on cold launch.
        homepageCurrentlyMounted: false,
        homepageMountedAt: null,
        appInForeground: true,
        meetingActive: false,
        skipped: new Set(parsed.skipped ?? []),
        queue: parsed.queue ?? [],
        lastShownTimes: parsed.lastShownTimes ?? {},
      };
    }
    const hydrated = hydrateFromLegacy(base);
    maybeSweepLegacyKeys();
    return hydrated;
  } catch (e) {
    console.warn('[OnboardingPersistence] loadState failed, using default:', e);
    return base;
  }
}

export function saveState(state) {
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

function hydrateFromLegacy(base) {
  const completed = { ...base.completed };
  const lastShownTimes = { ...base.lastShownTimes };

  if (localStorage.getItem(LEGACY.permsShown) === '1') {
    completed['permissions'] = Date.now();
  }
  if (localStorage.getItem(LEGACY.seenModesOnboarding) === 'true') {
    completed['modes_manager'] = Date.now();
  }
  if (localStorage.getItem(LEGACY.seenProfileOnboarding) === 'true') {
    completed['profile_intelligence'] = Date.now();
  }

  const trialTs = localStorage.getItem(LEGACY.trialPromoTs);
  if (trialTs) {
    const ts = parseInt(trialTs, 10);
    if (Number.isFinite(ts)) {
      completed['trial_promo'] = ts;
    }
  }

  const legacyLaunch = parseInt(localStorage.getItem(LEGACY.launchCount) || '0', 10);
  const legacyOpens = parseInt(localStorage.getItem(LEGACY.appOpensCount) || '0', 10);
  const startupCount = Math.max(
    Number.isFinite(legacyLaunch) ? legacyLaunch : 0,
    Number.isFinite(legacyOpens) ? legacyOpens : 0,
  );

  try {
    const adsRaw = localStorage.getItem(LEGACY.adsHistory);
    if (adsRaw) {
      const ads = JSON.parse(adsRaw);
      if (Array.isArray(ads)) {
        const now = Date.now();
        ads.forEach((id) => {
          lastShownTimes[id] = now;
        });
      }
    }
  } catch { /* malformed history — skip */ }

  return { ...base, completed, lastShownTimes, startupCount };
}

function maybeSweepLegacyKeys() {
  try {
    const lastSweep = parseInt(localStorage.getItem(KEYS.legacySweepAt) || '0', 10);
    const now = Date.now();
    if (lastSweep && now - lastSweep < LEGACY_SWEEP_INTERVAL_MS) return;

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

export function _clearAllForTests() {
  try {
    localStorage.removeItem(KEYS.state);
    localStorage.removeItem(KEYS.version);
    localStorage.removeItem(KEYS.legacySweepAt);
  } catch { /* ignore */ }
}