// Which OS grant system audio capture needs before it can start.
//
// macOS 14.2+: the native module captures through a Core Audio process tap
// (core_audio.rs: device-bound from 14.4, global on 14.2 and 14.3). A tap needs
// the "System Audio Recording" grant (NSAudioCaptureUsageDescription), which
// macOS asks for itself when the tap first starts. It does NOT need Screen
// Recording. Only the ScreenCaptureKit fallback does. (A Screen Recording grant
// also covers system audio, so either grant lets the tap capture.)
// Before this, every start path refused system audio when Screen Recording was
// denied, so a user who had declined Screen Recording (or allowed only
// "System Audio Recording Only") got mic-only meetings on a Mac whose tap
// worked. Interview Coder's audiotee helper never checks Screen Recording.
//
// macOS below 14.2: ScreenCaptureKit is the only path, so Screen Recording.
// Windows: WASAPI loopback, no OS grant.

export type SystemAudioGrant = 'screen-recording' | 'system-audio-recording' | 'none';

/** "14.2.1" → true for 14.2+. Unparseable → false (keep the Screen Recording gate). */
export function macOSAtLeast(version: string, major: number, minor: number): boolean {
  const m = /^(\d+)(?:\.(\d+))?/.exec(String(version ?? '').trim());
  if (!m) return false;
  const maj = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return maj > major || (maj === major && min >= minor);
}

export function systemAudioGrant(platform: NodeJS.Platform, osVersion: string): SystemAudioGrant {
  switch (platform) {
    case 'darwin':
      return macOSAtLeast(osVersion, 14, 2) ? 'system-audio-recording' : 'screen-recording';
    case 'win32':
      return 'none';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Whether a sustained run of exact-zero system audio can be blamed on a lost
 * Screen Recording grant. Only for the ScreenCaptureKit backend: the Core Audio
 * tap's own grant is System Audio Recording, so the Screen Recording banner
 * there would send the user to the wrong switch (see the next two helpers).
 */
export function zeroFillMeansScreenRecordingLost(activeBackend: string): boolean {
  return activeBackend === 'sck';
}

/**
 * Whether the Core Audio tap is blocked by the System Audio Recording grant.
 * `audioRecording` comes from the native getSystemAudioRecordingPermission()
 * (a private TCC read; "unknown" when it cannot tell or was never asked). Only
 * an explicit "denied" counts, and only while Screen Recording is not granted:
 * a Screen Recording grant covers system audio too (on this development Mac
 * the tap captured with Screen Recording granted and System Audio Recording
 * never asked).
 */
export function systemAudioRecordingBlocked(audioRecording: string, screenRecording: string): boolean {
  return audioRecording === 'denied' && screenRecording !== 'granted';
}

/** The tap's sustained silence is explained by that block. */
export function zeroFillMeansSystemAudioRecordingDenied(activeBackend: string, audioRecording: string, screenRecording: string): boolean {
  return activeBackend === 'coreaudio' && systemAudioRecordingBlocked(audioRecording, screenRecording);
}
