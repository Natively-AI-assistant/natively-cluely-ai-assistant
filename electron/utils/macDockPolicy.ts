// macOS Dock-tile policy: exactly ONE Natively tile in normal mode, NONE in
// undetectable mode.
//
// Every rule here was measured on the real build (2026-09-23, Electron 43.1.0,
// packaged-like bundle without LSUIElement, Dock tiles counted through the
// Accessibility API). Users reported 2-3 Natively icons in the Dock, and an
// icon that stayed visible with undetectable mode on. Three causes:
//
//   1. BrowserWindow.setVisibleOnAllWorkspaces() transforms the process type
//      itself unless skipTransformProcessType is passed: visibleOnFullScreen:true
//      runs Browser::DockHide() and false runs DockShow() (native_window_mac.mm).
//      Every overlay-family window called it, so startup flipped
//      regular→UIElement→regular several times in ~350ms, and Electron's own
//      DockHide() comment says such bursts leave "multiple dock icons of the app
//      left in system". The transform only exists so a plain NSWindow can float
//      over another app's fullscreen Space; every window that calls it is a
//      type:'panel' NSPanel on macOS (the cropper became one for this), and
//      panels do that without it (measured: a panel with
//      skipTransformProcessType stays on screen over a fullscreen app while the
//      app is 'regular'; a plain NSWindow does not).
//   2. A startup setActivationPolicy('accessory') … ('regular') round-trip added
//      the same churn. As shipped: 4 tiles at startup, 2 left after quit. With
//      skipTransformProcessType and no round-trip: 1 tile.
//   3. process.title on macOS goes through libuv's darwin-proctitle.c, which
//      calls _LSApplicationCheckIn with the main bundle's Info.plist. That
//      re-registers the app as a Foreground app, so a HIDDEN Dock tile comes
//      straight back (even for an LSUIElement bundle).
//
// Pure module by design: no electron import, platform injectable — both
// platform branches are unit-testable from either OS (see
// __tests__/macDockPolicy.test.mjs). Windows counterpart for the taskbar:
// windowsFocusPolicy.ts / WindowHelper.syncLauncherTaskbarForStealth.

/** Structural subset of BrowserWindow this policy needs. */
export interface WorkspaceVisibilityWindowLike {
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean },
  ): void;
}

/**
 * setVisibleOnAllWorkspaces WITHOUT Electron's activation-policy flip.
 *
 * The ONLY place in electron/ allowed to call the raw API (a source guard in
 * the test enforces it). Dock visibility belongs to app.dock.hide()/show() and
 * the self-verifying enforcement loop in main.ts, never to window creation.
 * No-op off macOS/Linux per Electron; callers gate on darwin anyway.
 */
export function setVisibleOnAllWorkspacesKeepingDock(
  win: WorkspaceVisibilityWindowLike,
  visible: boolean,
  visibleOnFullScreen: boolean,
): void {
  win.setVisibleOnAllWorkspaces(visible, { visibleOnFullScreen, skipTransformProcessType: true });
}

/**
 * Whether startup must promote the app to the 'regular' activation policy.
 *
 * Only to ADD a missing tile, once: the dev Electron.app is patched to
 * LSUIElement=1 (scripts/patch-electron-plist.js) and is born without one.
 * A packaged bundle is born 'regular', so promoting again is pure churn.
 * Undetectable mode must never gain a tile, and Windows has no activation
 * policy (its taskbar follows skipTaskbar).
 */
export function shouldPromoteToRegularAtStartup(
  platform: NodeJS.Platform,
  undetectable: boolean,
  dockVisible: boolean,
): boolean {
  return platform === 'darwin' && !undetectable && !dockVisible;
}

export interface DisguiseTitlePlan {
  /** Schedule the delayed process.title re-asserts (+200/+1000/+5000ms). */
  scheduleReasserts: boolean;
  /** Skip the write when process.title already holds the disguise name. */
  skipUnchangedWrite: boolean;
  /** Re-drive the Dock back to hidden right after a title write. */
  reassertStealthAfterWrite: boolean;
}

/**
 * How _applyDisguise may write process.title.
 *
 * The write itself stays — the disguise name is what Activity Monitor shows,
 * and undetectable mode is when the disguise matters. On macOS with the Dock
 * hidden, though, each write unhides the tile (cause 3 above), so:
 *   - skip the delayed re-asserts: they land after any enforcement has
 *     finished (the +5000ms one left the icon up for the rest of the session);
 *   - skip an identical rewrite: the undetectable startup path writes the title
 *     BEFORE it hides the born tile, because born tile → hide → title write →
 *     re-hide within ~150ms left a duplicate tile up (measured);
 *   - re-hide after any write that still happens.
 * On Windows process.title is only the console title: behaviour unchanged.
 */
export function planDisguiseTitleWrites(
  platform: NodeJS.Platform,
  undetectable: boolean,
): DisguiseTitlePlan {
  const dockMustStayHidden = platform === 'darwin' && undetectable;
  return {
    scheduleReasserts: !dockMustStayHidden,
    skipUnchangedWrite: dockMustStayHidden,
    reassertStealthAfterWrite: dockMustStayHidden,
  };
}

// Self-verifying Dock enforcement budget (main.ts _enforceDockState).
// Electron's Browser::DockHide() is a silent no-op for 1 s after any DockShow()
// (browser_mac.mm, base::Seconds(1)), so the retries must keep going past that
// second or a show landing mid-loop is never corrected. Measured on the real
// build: a fast OFF→ON toggle had three hides ignored before the fourth took.
// Identified in PR #595.
export const ELECTRON_DOCK_HIDE_GUARD_MS = 1000;
export const DOCK_ENFORCE_INTERVAL_MS = 130;
/** 10 × 130 ms = 1.3 s > the 1 s guard. */
export const DOCK_ENFORCE_MAX_ATTEMPTS = 10;
/** Startup waits out the launcher's ready-to-show as well (~2.3 s). */
export const DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS = 18;
