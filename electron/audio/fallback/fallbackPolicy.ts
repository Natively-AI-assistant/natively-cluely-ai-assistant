// When microphone and system audio are captured by Chromium in a hidden window
// instead of the native module.
//
// Windows: whenever the native module did not load (missing VC++ runtime,
// antivirus quarantine, wrong architecture). Before this both channels were
// dead: the meeting started with a "Native audio engine unavailable" banner
// and no transcript. Interview Coder captures on Windows exactly this way
// (getUserMedia + getDisplayMedia with loopback audio).
// macOS: never in a shipped build: the native tap and ScreenCaptureKit paths
// stay the only ones there. A development build can force it with
// NATIVELY_FORCE_RENDERER_AUDIO=1 to exercise the fallback on a Mac (Chromium's
// loopback uses the Core Audio tap there from macOS 14.2).

export interface FallbackPolicyInput {
  platform: NodeJS.Platform;
  /** The native capture class this wrapper would use exists. */
  nativeAvailable: boolean;
  isPackaged: boolean;
  forceEnv: string | undefined;
}

export function useRendererCaptureFallback(input: FallbackPolicyInput): boolean {
  switch (input.platform) {
    case 'win32':
      return !input.nativeAvailable;
    case 'darwin':
      return !input.isPackaged && input.forceEnv === '1';
    default:
      return false;
  }
}

/** The policy for this process. Electron's app is read lazily: tests load this file under plain Node. */
export function rendererCaptureFallbackActive(nativeAvailable: boolean): boolean {
  let isPackaged = true;
  try {
    isPackaged = (require('electron') as typeof import('electron')).app?.isPackaged ?? true;
  } catch {
    /* not running inside Electron */
  }
  return useRendererCaptureFallback({
    platform: process.platform,
    nativeAvailable,
    isPackaged,
    forceEnv: process.env.NATIVELY_FORCE_RENDERER_AUDIO,
  });
}
