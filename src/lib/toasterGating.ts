/**
 * Centralized utility to manage display rules and gating for all toasters.
 *
 * Rules:
 * 1. Never show more than one toaster in a single app start (session-level gate).
 * 2. If a toaster was shown, do not show it again until the app has been opened at least 5 times
 *    OR at least 24 hours have passed since it was last shown.
 *
 * @deprecated The OnboardingOrchestrator (src/lib/onboarding/orchestrator.ts) now owns
 * sequencing, eligibility evaluation, and cooldown tracking. The legacy helpers below
 * remain functional so existing call sites keep working — they delegate internally to
 * the orchestrator where applicable. New code should NOT use these helpers; instead
 * declare stages in src/lib/onboarding/stageCatalog.ts.
 */

const OPENS_COUNT_KEY = 'natively_app_opens_count';
const SESSION_OPEN_TRACKED_KEY = 'natively_session_open_tracked';
const SESSION_TOASTER_SHOWN_KEY = 'natively_session_toaster_shown';

/**
 * Tracks the app open event. Should be called exactly once during app initialization.
 */
export function trackAppOpen(): number {
  try {
    const isTracked = sessionStorage.getItem(SESSION_OPEN_TRACKED_KEY) === 'true';
    let currentOpens = parseInt(localStorage.getItem(OPENS_COUNT_KEY) || '0', 10);
    
    if (!isTracked) {
      currentOpens += 1;
      localStorage.setItem(OPENS_COUNT_KEY, currentOpens.toString());
      sessionStorage.setItem(SESSION_OPEN_TRACKED_KEY, 'true');
    }
    
    return currentOpens;
  } catch (e) {
    console.warn('[ToasterGating] Failed to track app open:', e);
    return 0;
  }
}

/**
 * Returns the current total number of app opens.
 */
export function getAppOpensCount(): number {
  try {
    return parseInt(localStorage.getItem(OPENS_COUNT_KEY) || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Checks if a specific toaster is allowed to be shown right now.
 *
 * @deprecated Prefer the OnboardingOrchestrator's stage catalog. This legacy helper
 * is retained only for backward compatibility with existing call sites.
 *
 * @param toasterId Unique identifier for the toaster (e.g. 'trial_promo', 'support', 'permissions', or ad IDs)
 * @returns true if allowed, false if gated
 */
export function isToasterAllowed(toasterId: string): boolean {
  try {
    // 1. Session-level gate: maximum 1 toaster per app start
    const sessionToasterShown = sessionStorage.getItem(SESSION_TOASTER_SHOWN_KEY) === 'true';
    if (sessionToasterShown) {
      if (import.meta.env.DEV) {
        console.log(`[ToasterGating] Show blocked for '${toasterId}': Another toaster was already shown in this session.`);
      }
      return false;
    }

    // 2. Cooldown gate: 24 hours OR 5 app opens since this toaster was last shown
    const lastShownTimeStr = localStorage.getItem(`last_shown_time_${toasterId}`);
    const lastShownOpensStr = localStorage.getItem(`last_shown_opens_${toasterId}`);

    if (lastShownTimeStr) {
      const lastShownTime = parseInt(lastShownTimeStr, 10);
      const lastShownOpens = parseInt(lastShownOpensStr || '0', 10);
      const currentOpens = getAppOpensCount();
      const now = Date.now();

      const timeElapsedMs = now - lastShownTime;
      const opensElapsed = currentOpens - lastShownOpens;

      const oneDayMs = 24 * 60 * 60 * 1000;
      const hoursRemaining = Math.max(0, (oneDayMs - timeElapsedMs) / (1000 * 60 * 60));
      const opensRemaining = Math.max(0, 5 - opensElapsed);

      // Must satisfy at least one condition: 24h passed OR 5 opens passed.
      // If BOTH are false, it's gated.
      if (timeElapsedMs < oneDayMs && opensElapsed < 5) {
        if (import.meta.env.DEV) {
          console.log(
            `[ToasterGating] Show blocked for '${toasterId}': Cooldown active. ` +
            `Needs ${hoursRemaining.toFixed(1)}h more or ${opensRemaining} more app opens.`
          );
        }
        return false;
      }
    }

    return true;
  } catch (e) {
    console.warn(`[ToasterGating] Error checking availability for '${toasterId}':`, e);
    return true; // Fallback to allowing if storage is broken
  }
}

/**
 * Marks a toaster as shown, updating session and persistent cooldown records.
 *
 * @deprecated Prefer the OnboardingOrchestrator's markDismissed/markSkipped.
 *
 * @param toasterId Unique identifier for the toaster
 */
export function markToasterAsShown(toasterId: string): void {
  try {
    const currentOpens = getAppOpensCount();
    const now = Date.now();

    sessionStorage.setItem(SESSION_TOASTER_SHOWN_KEY, 'true');
    localStorage.setItem(`last_shown_time_${toasterId}`, now.toString());
    localStorage.setItem(`last_shown_opens_${toasterId}`, currentOpens.toString());
    
    console.log(`[ToasterGating] Registered show for '${toasterId}' (Open #${currentOpens})`);
  } catch (e) {
    console.warn(`[ToasterGating] Error marking toaster '${toasterId}' as shown:`, e);
  }
}
