/**
 * The one action on the overlay's audio warning banner, per platform.
 *
 * The banner used to fall back to toggleSettingsWindow() everywhere a macOS
 * privacy deep link did not apply: every Windows warning, and macOS device
 * faults. That opens the overlay's quick-settings popover, which has no audio,
 * speech-to-text or permission settings, and with no anchor it opens at its
 * off-screen parking spot (-10000, -10000). Live-tested on Windows 2026-09-26:
 * "Open Settings" on Microphone Is Silent, the 12 s no-audio watchdog and the
 * speech-to-text failure all did nothing visible.
 *
 * Returns one of:
 *   { type: 'external', url, pane }  macOS System Settings privacy pane (unchanged)
 *   { type: 'mic-privacy' }          Windows Settings → Privacy → Microphone (openMicSettings;
 *                                    ms-settings: itself is blocked by openExternal's allowlist)
 *   { type: 'settings-tab', tab }    Natively Settings, launcher, on that tab
 */

const MAC_MIC_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const MAC_SCREEN_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * @param {{ platform: string, kind: string, channel?: string, titleKey?: string, message?: string }} w
 */
export function audioWarningAction(w) {
  const title = String(w.titleKey ?? '').toLowerCase();
  const message = String(w.message ?? '');
  // A speech-to-text provider that failed to start is a provider/API-key
  // problem, fixed in Settings → Audio, on either platform. On the mic channel
  // it used to open the macOS Microphone privacy pane: a permission it isn't.
  if (/speech-to-text|stt provider|api key/i.test(message) && !title.includes('microphone')) {
    return { type: 'settings-tab', tab: 'audio' };
  }

  if (w.platform === 'darwin') {
    // macOS routing, unchanged: the title names the pane when it can; else the
    // channel decides (an absent channel is compared with === 'system').
    const isMicTitle = title.includes('microphone');
    const isScreenTitle = title.includes('screen recording');
    const isDeviceFault = title.includes('same device');
    const wantsMic = isMicTitle
      || (!isScreenTitle && !isDeviceFault && w.kind === 'audio-capture-failure' && w.channel === 'mic');
    const wantsScreen = !wantsMic && !isDeviceFault
      && (isScreenTitle || w.kind === 'screen-recording-permission' || w.channel === 'system');
    if (wantsMic) return { type: 'external', url: MAC_MIC_PANE, pane: 'microphone' };
    if (wantsScreen) return { type: 'external', url: MAC_SCREEN_PANE, pane: 'screen' };
    return { type: 'settings-tab', tab: 'audio' };
  }

  if (w.platform === 'win32' && title.includes('microphone')) {
    // "Microphone Is Silent" / "Microphone Blocked": the text sends the user to
    // Windows Settings → Privacy → Microphone, so the button goes there.
    return { type: 'mic-privacy' };
  }
  // Device, capture and watchdog faults: pick or check a device in Natively.
  return { type: 'settings-tab', tab: 'audio' };
}
