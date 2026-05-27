/**
 * X11 vs Wayland session detection for Linux startup gating (ADR 0001).
 * Wired at startup in main.ts (Wave 2 `main-integration`).
 */

export type DisplaySessionType = 'x11' | 'wayland' | 'unknown';

export interface DisplaySessionInfo {
  sessionType: DisplaySessionType;
  isSupported: boolean;
  reason: string;
}

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Detect whether the current Linux session is supported for Natively v1 (X11 only).
 *
 * Logic per ADR 0001:
 * - X11 when DISPLAY is set and session is not native Wayland-only.
 * - Unsupported when native Wayland without usable X11 for Electron.
 */
export function detectDisplaySession(): DisplaySessionInfo {
  if (process.platform !== 'linux') {
    return {
      sessionType: 'unknown',
      isSupported: true,
      reason: 'Session gate applies to Linux only.',
    };
  }

  const xdgSession = readEnv('XDG_SESSION_TYPE')?.toLowerCase();
  const waylandDisplay = readEnv('WAYLAND_DISPLAY');
  const display = readEnv('DISPLAY');

  const hasDisplay = !!display;
  const hasWayland = !!waylandDisplay;
  const sessionSaysWayland = xdgSession === 'wayland';
  const sessionSaysX11 = xdgSession === 'x11' || xdgSession === 'xorg';

  if (sessionSaysX11 && hasDisplay) {
    return {
      sessionType: 'x11',
      isSupported: true,
      reason: 'X11 session detected (XDG_SESSION_TYPE=x11 with DISPLAY set).',
    };
  }

  if (hasDisplay && !sessionSaysWayland) {
    return {
      sessionType: 'x11',
      isSupported: true,
      reason: 'DISPLAY is set; treating as X11-compatible session.',
    };
  }

  if (sessionSaysWayland && hasWayland && !hasDisplay) {
    return {
      sessionType: 'wayland',
      isSupported: false,
      reason:
        'Native Wayland session detected without X11 (DISPLAY unset). Natively v1 supports X11 only — log out and choose an X11/Xorg session, or set up XWayland with DISPLAY.',
    };
  }

  if (sessionSaysWayland && hasDisplay) {
    return {
      sessionType: 'x11',
      isSupported: true,
      reason:
        'XWayland session detected (DISPLAY set under Wayland); treating as X11-compatible per ADR 0001.',
    };
  }

  if (!hasDisplay) {
    return {
      sessionType: 'unknown',
      isSupported: false,
      reason: 'No DISPLAY environment variable — X11 display server required for Natively on Linux.',
    };
  }

  return {
    sessionType: 'unknown',
    isSupported: true,
    reason: 'Could not classify session type; assuming X11-compatible because DISPLAY is set.',
  };
}
