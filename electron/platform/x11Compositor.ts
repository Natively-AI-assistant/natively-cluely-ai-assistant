/**
 * X11 compositor detection for overlay transparency warnings (F3.2).
 */
import { execFileSync } from 'node:child_process';

export interface CompositorInfo {
  isComposited: boolean;
  compositorName: string | null;
}

/** Opaque fallback when X11 has no compositor (transparent windows render black). */
export const LINUX_OPAQUE_WINDOW_BG = '#1a1a1a';

export interface LinuxWindowChrome {
  transparent: boolean;
  backgroundColor: string;
  /** True when transparency was disabled because no compositor was detected. */
  useOpaqueFallback: boolean;
}

export type CompositorWarningCallback = (info: CompositorInfo) => void;

let warningCallback: CompositorWarningCallback | null = null;
let warningEmitted = false;

/** EWMH compositor-manager atoms (S0 is most common; S1+ used on multi-screen setups). */
export const NET_WM_CM_ROOT_PROPS = [
  '_NET_WM_CM_S0',
  '_NET_WM_CM_S1',
  '_NET_WM_CM_S2',
] as const;

/** Process names for common X11 compositors / compositing WMs (detection only — never start one). */
export const KNOWN_COMPOSITOR_PROCESSES = [
  'picom',
  'compton',
  'xcompmgr',
  'xfwm4',
  'marco',
  'kwin_x11',
  'kwin',
  'mutter',
  'compiz',
  'unagi',
] as const;

function runQuiet(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/** True when xprop output references a valid X11 window id. */
export function xpropIndicatesWindow(output: string): boolean {
  if (!output.trim()) return false;
  return /window id #/i.test(output) || /\b0x[0-9a-f]+\b/i.test(output);
}

function hasXdpyinfoComposite(): boolean {
  const compositeExt = runQuiet('xdpyinfo', ['-ext', 'COMPOSITE']);
  return /Composite\s+version/i.test(compositeExt);
}

function hasNetWmCmOwner(): { hit: boolean; atom: string | null } {
  for (const atom of NET_WM_CM_ROOT_PROPS) {
    const cmOwner = runQuiet('xprop', ['-root', atom]);
    if (xpropIndicatesWindow(cmOwner)) {
      return { hit: true, atom };
    }
  }
  return { hit: false, atom: null };
}

function hasNetSupportingWmCheck(): boolean {
  const out = runQuiet('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK']);
  return xpropIndicatesWindow(out);
}

function findRunningCompositorProcess(): string | null {
  for (const name of KNOWN_COMPOSITOR_PROCESSES) {
    const exact = runQuiet('pgrep', ['-x', name]);
    if (exact.trim()) return name;
  }
  for (const pattern of ['picom', 'compton', 'xcompmgr', 'kwin']) {
    const out = runQuiet('pgrep', ['-f', pattern]);
    const first = out.trim().split('\n')[0];
    if (first) return pattern;
  }
  return null;
}

/** xcompmgr binary responds to -V (installed); paired with a running xcompmgr process via pgrep above. */
function xcompmgrBinaryAvailable(): boolean {
  const out = runQuiet('xcompmgr', ['-V']);
  return /xcompmgr/i.test(out);
}

/**
 * Detect whether an X11 compositor is active (required for transparent overlay).
 * Uses several independent signals; any hit means compositing is available.
 */
export function detectX11Compositor(): CompositorInfo {
  if (process.platform !== 'linux') {
    return { isComposited: true, compositorName: null };
  }

  if (!process.env.DISPLAY) {
    return { isComposited: false, compositorName: null };
  }

  if (hasXdpyinfoComposite()) {
    return { isComposited: true, compositorName: 'xdpyinfo COMPOSITE' };
  }

  const cm = hasNetWmCmOwner();
  if (cm.hit) {
    return { isComposited: true, compositorName: cm.atom ?? 'X11 compositor' };
  }

  if (hasNetSupportingWmCheck()) {
    return { isComposited: true, compositorName: '_NET_SUPPORTING_WM_CHECK' };
  }

  const proc = findRunningCompositorProcess();
  if (proc) {
    return { isComposited: true, compositorName: proc };
  }

  if (xcompmgrBinaryAvailable() && runQuiet('pgrep', ['-f', 'xcompmgr']).trim()) {
    return { isComposited: true, compositorName: 'xcompmgr' };
  }

  return {
    isComposited: false,
    compositorName: null,
  };
}

export function isCompositorAvailable(info?: CompositorInfo): boolean {
  return (info ?? detectX11Compositor()).isComposited;
}

/**
 * Linux-only window chrome: overlay needs a compositor for transparency.
 * Launcher is always opaque; overlay falls back to opaque when compositor is missing.
 */
export function resolveLinuxWindowChrome(
  windowType: 'launcher' | 'overlay',
  info?: CompositorInfo,
): LinuxWindowChrome {
  const compositor = info ?? detectX11Compositor();
  const useOpaqueFallback = !compositor.isComposited;

  if (windowType === 'launcher') {
    return {
      transparent: false,
      backgroundColor: LINUX_OPAQUE_WINDOW_BG,
      useOpaqueFallback,
    };
  }

  if (useOpaqueFallback) {
    return {
      transparent: false,
      backgroundColor: LINUX_OPAQUE_WINDOW_BG,
      useOpaqueFallback: true,
    };
  }

  return {
    transparent: true,
    backgroundColor: '#00000000',
    useOpaqueFallback: false,
  };
}

export function setCompositorWarningCallback(cb: CompositorWarningCallback | null): void {
  warningCallback = cb;
}

export function maybeEmitCompositorWarning(info?: CompositorInfo): void {
  const resolved = info ?? detectX11Compositor();
  if (warningEmitted || resolved.isComposited || !warningCallback) return;
  warningEmitted = true;
  warningCallback(resolved);
}

export function resetCompositorWarningStateForTests(): void {
  warningEmitted = false;
}
