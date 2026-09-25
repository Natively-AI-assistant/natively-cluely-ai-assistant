// src/lib/permissionAttentionPolicy.mjs
//
// When the permissions card comes back after the first launch (2026-09-25).
// It returns only when a REQUIRED permission is missing and the user can fix
// it: microphone + Screen Recording on macOS, the microphone alone on Windows
// (screen capture has no permission gate there). A reinstall that keeps the
// app data, or a future version that needs a new permission, is caught by the
// same rule: the missing permission is what brings the card back.
//
// Pure and platform-injectable, so both branches are testable without
// mutating process.platform (CLAUDE.md). Shared by the launcher (App.tsx) and
// the `permissions:check` IPC handler.

import { classifyMicStatus } from './micPermissionPolicy.mjs';

/**
 * True when the card should come back: a required permission is missing and
 * the user can do something about it.
 *
 * - macOS 'restricted' is MDM / parental controls: not user-fixable, so the
 *   first-launch card already said so and it does not return every launch.
 * - Windows 'restricted' is the device-wide microphone switch and 'denied' the
 *   per-app switch: both user-fixable in the privacy panel, so they do.
 *   Windows 'not-determined' is what a FAILED status query leaves behind
 *   (micPermissionPolicy.mjs), not a user choice, so it does not.
 * - 'unknown' means the check could not tell; never nag on a guess.
 *
 * @param {{ platform?: string, microphone?: string, screen?: string } | null | undefined} check
 *   The `permissions:check` result.
 * @returns {boolean}
 */
export function permissionsNeedAttention(check) {
  if (!check || !check.microphone) return false;
  const { platform, microphone, screen } = check;

  if (platform === 'darwin') {
    const mic = classifyMicStatus(platform, microphone);
    const micFixable = !mic.usable && mic.remedy !== 'policy';
    const screenFixable = screen === 'denied' || screen === 'not-determined';
    return micFixable || screenFixable;
  }

  if (platform === 'win32') {
    return microphone === 'denied' || microphone === 'restricted';
  }

  return false;
}

/**
 * macOS Screen Recording status for `permissions:check`.
 *
 * getMediaAccessStatus('screen') often reports a real grant as 'denied' or
 * 'not-determined' until the process relaunches, so any status other than
 * 'granted' / 'restricted' is checked with a capture probe: if a screen can be
 * enumerated, the permission is effectively granted. The probe can hang on
 * TCC, so it races a deadline; a timeout keeps the raw status, matching the
 * meeting path (main.ts resolveMacScreenCaptureCapability treats the same
 * timeout as blocked), so the card agrees with what a meeting will do.
 *
 * @param {string} rawStatus getMediaAccessStatus('screen')
 * @param {() => Promise<boolean>} probeCapturable resolves true when a screen source can be captured
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export async function resolveMacScreenStatus(rawStatus, probeCapturable, { timeoutMs = 5000 } = {}) {
  if (rawStatus === 'granted' || rawStatus === 'restricted') return rawStatus;

  let timer;
  try {
    const capturable = await Promise.race([
      probeCapturable(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    return capturable ? 'granted' : rawStatus;
  } catch {
    return rawStatus;
  } finally {
    clearTimeout(timer);
  }
}
