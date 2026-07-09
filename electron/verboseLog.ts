/**
 * verboseLog.ts
 * Module-level singleton flag for verbose/debug logging.
 * Import isVerboseLogging() anywhere in the electron main process to gate
 * diagnostic logs. The flag is toggled via AppState.setVerboseLogging() which
 * persists it through SettingsManager.
 */

// Default ON (2026-07-09) — debug logs are essential for diagnosing the
// "user launches the app and it dies" class of crashes that leave only a
// short stack. The persisted setting `verboseLogging` still wins at
// AppState construction time, so a user who explicitly turns it off stays
// off. Env override NATIVELY_VERBOSE_LOGGING=0 also disables it.
let _verbose = !process.env.NATIVELY_VERBOSE_LOGGING || process.env.NATIVELY_VERBOSE_LOGGING !== '0';

export const isVerboseLogging = (): boolean => _verbose;
export const setVerboseLoggingFlag = (enabled: boolean): void => {
  _verbose = enabled;
};
