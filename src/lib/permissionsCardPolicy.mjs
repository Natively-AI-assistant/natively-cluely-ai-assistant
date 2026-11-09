// src/lib/permissionsCardPolicy.mjs
//
// How often the permissions card may come back as a startup card while a
// required permission is still missing (2026-11-09).
//
// The card returns at launch while a required permission needs attention
// (permissionAttentionPolicy.mjs). A Mac user who chose not to grant Screen
// Recording got the dimmed full-window card ~2 s into every launch, forever.
// Now: after the user closes it, it waits 7 days; after the third close it no
// longer comes back at launch. The in-meeting permission banners and Settings
// still offer the fix, and a meeting that fails to start for a missing
// permission still opens the card (App.tsx, permissionsRecoveryRequested).
// Granting the missing permissions clears the record, so a permission that
// breaks later starts afresh.
//
// The record lives in the main process (SettingsManager `permissionsCard`), so
// it survives restarts and updates and does not depend on the renderer's
// origin. Pure and platform-injectable (the check result carries `platform`):
// macOS needs the microphone and Screen Recording, Windows the microphone.

import { permissionsNeedAttention } from './permissionAttentionPolicy.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** After a close, the card stays away this long. */
export const PERMISSIONS_CARD_SNOOZE_MS = 7 * DAY_MS;

/** After this many closes it is no longer a startup card. */
export const PERMISSIONS_CARD_MAX_DISMISSALS = 3;

/** @returns {{ dismissals: number, lastDismissedAt: number | null }} */
export function emptyPermissionsCardRecord() {
  return { dismissals: 0, lastDismissedAt: null };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A stored record, with anything malformed read as never dismissed. */
export function normalizePermissionsCardRecord(raw) {
  if (!raw || typeof raw !== 'object') return emptyPermissionsCardRecord();
  const dismissals = isNum(raw.dismissals) && raw.dismissals > 0 ? Math.floor(raw.dismissals) : 0;
  const lastDismissedAt = isNum(raw.lastDismissedAt) ? raw.lastDismissedAt : null;
  return { dismissals, lastDismissedAt };
}

/**
 * Apply what happened: 'dismissed' (the user closed the card) or 'granted'
 * (every required permission is granted). Returns a NEW record.
 */
export function applyPermissionsCardEvent(record, event, now) {
  const r = normalizePermissionsCardRecord(record);
  if (event === 'granted') return emptyPermissionsCardRecord();
  if (event === 'dismissed') return { dismissals: r.dismissals + 1, lastDismissedAt: now };
  throw new Error(`unknown permissions card event: ${event}`);
}

/**
 * True while the card must not come back at launch: closed three times, or
 * closed less than 7 days ago. A clock set backwards only delays: the wait
 * ends 7 days after the stored time.
 */
export function permissionsCardSnoozed(record, now) {
  const r = normalizePermissionsCardRecord(record);
  if (r.dismissals >= PERMISSIONS_CARD_MAX_DISMISSALS) return true;
  return r.lastDismissedAt !== null && now < r.lastDismissedAt + PERMISSIONS_CARD_SNOOZE_MS;
}

/**
 * Every permission the platform requires is granted: macOS the microphone
 * and Screen Recording, Windows the microphone. Any other platform, or a
 * check that could not tell, is not "granted" (it never clears the record).
 *
 * @param {{ platform?: string, microphone?: string, screen?: string } | null | undefined} check
 */
export function requiredPermissionsGranted(check) {
  if (!check) return false;
  switch (check.platform) {
    case 'darwin':
      return check.microphone === 'granted' && check.screen === 'granted';
    case 'win32':
      return check.microphone === 'granted';
    default:
      return false;
  }
}

/**
 * Whether the launch check should bring the card back: a required permission
 * needs attention and the user has not put the card off.
 */
export function startupPermissionsAttention(check, record, now) {
  return permissionsNeedAttention(check) && !permissionsCardSnoozed(record, now);
}
