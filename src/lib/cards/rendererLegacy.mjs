// src/lib/cards/rendererLegacy.mjs
//
// The launcher's pre-ledger card history, read once from its localStorage and
// sent to the main-process card ledger (cards:import-legacy), which migrates
// it with migrateLegacy (cardPolicy.mjs). Toaster policy spec §8.
//
// Only what the old code actually recorded: the onboarding orchestrator's
// state (counters, completion and show times per stage), the ad scheduler's
// per-ad show times and permanent dismissals, and the trial claim. The old
// stores kept no show COUNTS, so a known showing counts as one.

const STAGE_CARDS = ['browser_extension', 'trial_promo', 'support', 'review_prompt'];
const AD_CARDS = {
  natively_api: ['natively_api_new', 'natively_api_existing'],
  profile: ['profile_ad'],
  jd: ['jd_ad'],
  max_ultra_upgrade: ['max_ultra'],
};

const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readString(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {{ getItem(key: string): string | null }} storage usually window.localStorage
 * @returns {import('./cardPolicy.d.mts').LegacyCardHistory}
 */
export function collectRendererLegacy(storage) {
  const legacy = {};
  const stageShows = {};
  const times = [];

  const orch = readJson(storage, 'natively_onboarding_state_v1');
  if (orch && typeof orch === 'object') {
    if (Number.isInteger(orch.startupCount) && orch.startupCount > 0) legacy.startupCount = orch.startupCount;
    const completed = orch.completed && typeof orch.completed === 'object' ? orch.completed : {};
    const shown = orch.lastShownTimes && typeof orch.lastShownTimes === 'object' ? orch.lastShownTimes : {};
    for (const v of [...Object.values(completed), ...Object.values(shown)]) if (isTime(v)) times.push(v);
    for (const id of STAGE_CARDS) {
      if (isTime(shown[id])) stageShows[id] = { count: 1, lastShownAt: shown[id] };
    }
  }

  for (const [ad, cards] of Object.entries(AD_CARDS)) {
    const at = Number(readString(storage, `last_shown_time_${ad}`));
    if (!isTime(at)) continue;
    times.push(at);
    for (const id of cards) stageShows[id] = { count: 1, lastShownAt: at };
  }

  const dismissed = readJson(storage, 'natively_dismissed_campaigns');
  if (Array.isArray(dismissed)) {
    const ids = dismissed.filter((d) => typeof d === 'string');
    if (ids.length) legacy.dismissedAds = ids;
  }

  if (readString(storage, 'natively_trial_claimed') === 'true') legacy.trialClaimed = true;
  if (times.length) legacy.firstSeenAt = Math.min(...times);
  if (Object.keys(stageShows).length) legacy.stageShows = stageShows;
  return legacy;
}
