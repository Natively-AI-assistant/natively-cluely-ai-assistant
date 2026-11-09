// src/lib/updatePromptPolicy.mjs
//
// When the update card (UpdateModal.tsx, a dimmed full-window card) may open
// by itself (2026-11-09).
//
// Main announces an available update about 10 s after every launch. Closing
// the card used to be remembered in memory only, so the same version opened
// the card again on every launch. Now a close is kept as "version X closed at
// time T": the same version does not open the card by itself for 7 days, and
// a newer version opens it as usual. Starting the download (from Settings ›
// About) still shows its progress, whatever was closed.
//
// The record is this window's localStorage: the card lives in the launcher
// alone. Every access is guarded; no storage means nothing is remembered.
// Pure apart from the storage it is handed; no platform branches (the
// unsigned-macOS release-page path and the Windows installer path are
// UpdateBanner's and unchanged).

export const UPDATE_DISMISSAL_KEY = 'natively_update_dismissed_v1';

/** A closed version stays closed this long. */
export const UPDATE_DISMISS_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** "v3.1.0" and "3.1.0" are one version. */
export function normalizeUpdateVersion(version) {
  return typeof version === 'string' ? version.trim().replace(/^v/i, '') : '';
}

/** @returns {{ version: string, at: number } | null} */
export function readUpdateDismissal(storage) {
  try {
    const raw = storage?.getItem?.(UPDATE_DISMISSAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const version = normalizeUpdateVersion(parsed?.version);
    if (!version || typeof parsed?.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    return { version, at: parsed.at };
  } catch {
    return null;
  }
}

export function writeUpdateDismissal(storage, version, now) {
  const v = normalizeUpdateVersion(version);
  if (!v) return;
  try {
    storage?.setItem?.(UPDATE_DISMISSAL_KEY, JSON.stringify({ version: v, at: now }));
  } catch {
    /* not remembered: the card comes back next launch, as before */
  }
}

/**
 * True when this version was closed less than 7 days ago. A clock set
 * backwards only delays: the wait ends 7 days after the stored time.
 */
export function isUpdateDismissed(dismissal, version, now) {
  const v = normalizeUpdateVersion(version);
  if (!dismissal || !v || dismissal.version !== v) return false;
  return now < dismissal.at + UPDATE_DISMISS_SNOOZE_MS;
}
