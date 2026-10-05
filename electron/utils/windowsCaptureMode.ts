/**
 * Which screen-capture invisibility the OS can actually deliver.
 *
 * Two Windows APIs exist: WDA_EXCLUDEFROMCAPTURE (the window is skipped
 * entirely — captures show whatever is underneath) and WDA_MONITOR (the
 * window shows as a black box — contents hidden, but a suspicious rectangle
 * remains). Before Windows 10 build 19041 the exclusion call is accepted but
 * BEHAVES as the black box, so knowing which mode we're in matters: an app
 * that assumes exclusion everywhere silently ships black boxes on old builds.
 * (Same threshold LockedIn AI gates on: WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD.)
 *
 * macOS has no such split: NSWindowSharingNone excludes on every supported
 * release, so darwin is always 'excluded'.
 *
 * Pure (no electron import; platform + version injected) so both branches
 * are unit-testable from any OS. See __tests__/windowsCaptureMode.test.mjs.
 */

export type WindowsCaptureMode = 'excluded' | 'blacked_out' | 'unknown' | 'unsupported';

/** First Windows 10 build where exclusion truly excludes. */
export const WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD = 19041;

export function resolveWindowsCaptureMode(
  platform: NodeJS.Platform,
  systemVersion?: string,
): WindowsCaptureMode {
  if (platform === 'darwin') return 'excluded';
  if (platform !== 'win32') return 'unsupported';
  // Electron's process.getSystemVersion() on Windows reports "10.0.<build>".
  const build = parseInt(String(systemVersion ?? '').split('.')[2], 10);
  if (!Number.isFinite(build)) return 'unknown';
  return build >= WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD ? 'excluded' : 'blacked_out';
}
