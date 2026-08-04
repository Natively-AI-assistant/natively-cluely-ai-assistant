import { app, BrowserWindow, Menu, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppState } from './main';
import { KeybindManager } from './services/KeybindManager';

const isEnvDev = process.env.NODE_ENV === 'development';
const isPackaged = app.isPackaged;
const inAppBundle = process.execPath.includes('.app/') || process.execPath.includes('.app\\');

console.log(
  `[WindowHelper] isEnvDev: ${isEnvDev}, isPackaged: ${isPackaged}, inAppBundle: ${inAppBundle}`,
);

// Force production mode if running as packaged app or inside app bundle
const isDev = isEnvDev && !isPackaged;
const overlayResizeTracePath = '/tmp/natively-overlay-resize-trace.log';

function traceOverlayResize(event: string, data: Record<string, unknown>): void {
  if (!isDev) return;
  try {
    fs.appendFileSync(
      overlayResizeTracePath,
      `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`,
    );
  } catch {
    // Dev-only diagnostics must never affect overlay behavior.
  }
}

const startUrl = isDev
  ? 'http://localhost:5180'
  : `file://${path.join(__dirname, '../../dist/index.html')}`;

export class WindowHelper {
  private launcherWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private isWindowVisible: boolean = false;
  // Position/Size tracking for Launcher
  private launcherPosition: { x: number; y: number } | null = null;
  private launcherSize: { width: number; height: number } | null = null;
  private overlayBounds: Electron.Rectangle | null = null;
  // ── Overlay auxiliary windows (hug-at-rest, phase 2) ────────────────────
  // The TopPill and the resize toggle live in their OWN tiny BrowserWindows,
  // so the main overlay window can shrink to exactly the shell card. This
  // kills the last permanent dead-click zones a single rectangular window
  // could never avoid: the transparent strips beside the narrow centered
  // pill, the pill↔shell gap row, and it restores the toggle's floating
  // outside-the-corner placement (it overlays the desktop in a 36px window of
  // its own instead of forcing the main window to keep a gutter).
  private pillWindow: BrowserWindow | null = null;
  private toggleWindow: BrowserWindow | null = null;
  // Pill content size as reported by its renderer (w-fit). Fallback covers
  // the first frames before the first report.
  private pillSize: { width: number; height: number } = { width: 200, height: 44 };
  // Re-entrancy guard for group-move syncing: our own programmatic
  // setBounds/setPosition calls fire 'move' events on the very windows we are
  // positioning; without the guard, overlay→pill and pill→overlay mirroring
  // would feed back into each other.
  private auxSyncing = false;
  // ── Welded overlay group (macOS) ────────────────────────────────────────
  // When enabled, the pill and toggle become real AppKit CHILD windows of the
  // overlay (setParentWindow). AppKit then moves them with the parent inside
  // the SAME window-server transaction, so the group physically cannot come
  // apart — which the event-mirroring fallback can never achieve, because the
  // follower is always one compositor transaction behind the natively-dragged
  // window.
  //
  // Measured on Electron 43 / macOS (see the probes in the session that added
  // this): children follow the parent by the exact same delta; moving a CHILD
  // does NOT move the parent and fires ZERO parent 'move' events (so the
  // "AppKit child-window double-move feedback" this file previously warned
  // about does not arise once the manual mirroring below is skipped);
  // alwaysOnTop / contentProtection / visibleOnAllWorkspaces all survive
  // parenting; and parenting applied at creation survives hide/show cycles.
  //
  // ASYMMETRY THAT MATTERS: parent.hide() DOES hide the children, but
  // parent.show() does NOT re-show them. applyOverlayAuxVisibility() is what
  // covers that, so it is required whether or not this is enabled.
  //
  // macOS only: on win32 setParentWindow is OWNER semantics — owned windows do
  // not move with the owner — so Windows keeps the event-mirroring path
  // untouched.
  //
  // Kill switch: NATIVELY_OVERLAY_WINDOW_GROUP=0 falls back to mirroring.
  private overlayGroupWelded = false;
  // ── Managed group drag (macOS AND Windows) ──────────────────────────────
  // Distinct from welding, which is the macOS-only AppKit mechanism above.
  // "Drag-managed" means the PILL no longer uses an OS drag region: it streams
  // pointer deltas to main, which moves the group. Both platforms need this,
  // for different reasons:
  //   • macOS: the pill is an AppKit CHILD, and a natively-dragged child moves
  //     alone (propagation is parent→child only), so it must drag its parent.
  //   • Windows: there is no weld to break, but `-webkit-app-region: drag`
  //     enters the modal move loop (WM_SYSCOMMAND/SC_MOVE), which occupies the
  //     message pump for the duration of the drag — the follower window's
  //     moves get serviced around that loop instead of at refresh rate. Moving
  //     every window ourselves, from one tick, bypasses the modal loop
  //     entirely and puts all the moves in the same DWM composition frame.
  // Kill switch: NATIVELY_OVERLAY_GROUP_DRAG=0 restores the OS drag region.
  private overlayGroupDragManaged = false;
  // True between a pill drag's first delta and its release. Suppresses the
  // settle-clamp so it cannot fire mid-drag (the 'moved' event is emitted for
  // our own programmatic setPosition calls too).
  private overlayGroupDragging = false;
  // Shell origin captured at drag start; every frame's target is derived from
  // it plus the pointer's TOTAL offset, so a clamped frame drops nothing.
  private groupDragOrigin: { x: number; y: number } | null = null;
  // Renderer-reported "there are messages" flag — the toggle is only shown
  // once there is content (mirrors the old `messages.length > 0` gate).
  private toggleHasContent = false;
  // The panel's LIVE right edge, in px from the overlay window's left edge —
  // streamed by the renderer as the width spring runs so the toggle window
  // rides the panel's top-right corner frame-by-frame (the pre-aux-window
  // behavior, where a MotionValue did the riding inside one window). Default
  // = collapsed panel right edge inside the fixed window: (732 + 600) / 2.
  private togglePanelRight = 666;
  // Hover gate for the fixed window's transparent side margins (collapsed
  // state): true (default, safe) = window interactive; false = pointer is
  // over a transparent margin → click-through. See syncOverlayInteractionPolicy.
  private overlayHoverInteractive = true;
  // ── Overlay popover (settings / model-selector dropdown) coordination ───
  // Which overlay-anchored popovers are currently open. Non-empty → the
  // click-catcher window is shown so a click ANYWHERE outside Natively's
  // windows dismisses them (the app's did-resign-active close path is dead in
  // overlay mode: the nonactivating NSPanel never makes the app active, so it
  // can never resign it).
  private overlayPopoversOpen = new Set<'settings' | 'model'>();
  // Full-display transparent window shown just BELOW the Natively windows
  // while a popover is open. Any mousedown on it (i.e. outside Natively's
  // painted windows) dismisses the popovers — standard menu semantics (the
  // dismissing click is consumed). Lazily created.
  private popoverCatcher: BrowserWindow | null = null;
  // Last UI state broadcast by the overlay renderer, replayed to an aux
  // window when it (re)loads after the broadcast happened.
  private lastOverlayUiState: unknown = null;
  // Track current window mode (persists even when overlay is hidden via Cmd+B)
  private currentWindowMode: 'launcher' | 'overlay' = 'launcher';

  private appState: AppState;
  private contentProtection: boolean = false;
  private opacityTimeout: NodeJS.Timeout | null = null;
  private lastLauncherShowInactive: boolean | null = null;
  // Tracks whether the launcher window's native vibrancy/background/shadow
  // are currently in their "preview" (transparent) state — see
  // setLauncherOpacityPreview().
  private launcherOpacityPreviewActive: boolean = false;

  // Constants
  // FIXED OVERLAY WINDOW WIDTH — the OS window is BORN at this width, SHOWN at
  // this width, and NEVER width-resized for the lifetime of the overlay. It
  // MUST equal the renderer's SHELL_WIDTH_EXPANDED (NativelyInterface.tsx):
  // the panel animates 600↔732 purely in CSS, CENTERED (mx-auto) inside this
  // fixed window. (It used to be 780 — wider than the expanded panel — purely
  // to leave a gutter for the floating resize toggle; the toggle now lives in
  // its own aux window, so the fixed width is exactly the expanded panel.)
  //
  // WHY FIXED (the original resize jump/flicker fix, reinstated): Chromium
  // does not sync a programmatic setBounds to renderer paint on macOS, so any
  // width setBounds that moves painted pixels (X-origin moves, or content
  // recentering after the resize) flashes for one frame — and per-frame width
  // resizes of a transparent blurred window re-raster + flicker. A fixed
  // width means there is NO width setBounds at all: the panel's center is
  // pixel-stable (symmetric CSS growth), and the pill aux window centered
  // over this window is pixel-STATIONARY across expand/collapse.
  //
  // Dead-click strips: when the shell is collapsed (600 in a 732 window) the
  // 66px transparent side margins are inside this window's rect. They are
  // made CLICK-THROUGH by the hover gate (setOverlayHoverInteractive): the
  // window is interactive by default, and flips to
  // setIgnoreMouseEvents(true, {forward:true}) only while the renderer
  // reports the pointer over a transparent margin. The panel area itself is
  // always interactive, so app-region dragging can never deadlock (the flaw
  // that killed the earlier hover-gate attempt — it defaulted to ignore).
  private static readonly OVERLAY_DEFAULT_WIDTH = 732;
  private static readonly OVERLAY_MIN_HEIGHT = 216;
  // Gap between the pill window's bottom edge and the shell window's top edge
  // — matches the old in-window `gap-2` (8px) spacing.
  private static readonly PILL_GAP = 8;
  // Vertical room reserved above the shell's default position for the pill
  // stack (fallback pill height 44 + PILL_GAP), so the pill lands where the
  // old single window's top edge used to be.
  private static readonly PILL_STACK_OFFSET = 52;
  // The toggle window is a small square hosting the 28px round button with
  // margin for its hover scale (×1.06) — button centered in the window.
  private static readonly TOGGLE_WINDOW_SIZE = 36;
  // The button CENTER sits this many px outside the shell's top-right corner
  // along the 45° bisector — the original gutter-era placement, now hosted in
  // its own window floating over the desktop.
  private static readonly TOGGLE_DIAGONAL_GAP = 8;
  // Vertical offset for the meeting overlay's initial position, expressed as
  // a fraction of the screen's work-area height. 0.035 places the top edge
  // ~37 px below the work-area top on a 1055-tall display — comfortably
  // below the menu bar with visible breathing room.
  private static readonly OVERLAY_DEFAULT_TOP_RATIO = 0.035;

  // Movement variables (apply to active window)
  private step: number = 20;

  constructor(appState: AppState) {
    this.appState = appState;
  }

  private getDisplayWorkArea(bounds?: Electron.Rectangle): Electron.Rectangle {
    if (bounds) {
      return screen.getDisplayMatching(bounds).workArea;
    }
    if (this.overlayBounds) {
      return screen.getDisplayMatching(this.overlayBounds).workArea;
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return screen.getDisplayMatching(this.overlayWindow.getBounds()).workArea;
    }
    return screen.getPrimaryDisplay().workArea;
  }

  public setContentProtection(enable: boolean): void {
    // Dedupe: setContentProtection is called from multiple paths (settings IPC,
    // every switchToOverlay/switchToLauncher show, the Windows mute-on-Win+Tab
    // workaround). Repeated identical calls trigger DWM affinity churn on
    // Windows that can leave the HWND in a transient black/blank frame state
    // for a few hundred ms. No-op when nothing actually changes.
    if (this.contentProtection === enable) return;
    this.contentProtection = enable;
    this.applyContentProtection(enable);
  }

  private applyContentProtection(enable: boolean): void {
    const windows = [
      this.launcherWindow,
      this.overlayWindow,
      this.pillWindow,
      this.toggleWindow,
      this.popoverCatcher,
    ];
    windows.forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.setContentProtection(enable);
      }
    });
  }

  // Force-reapply the CURRENT content-protection state to every live window,
  // bypassing the dedupe guard in setContentProtection(). Needed because
  // app.dock.hide()/show() flips the macOS activation policy, which makes
  // WindowServer re-evaluate each NSWindow and can silently reset its
  // sharingType (the NSWindowSharingNone flag setContentProtection set). The
  // in-memory `this.contentProtection` is still correct, so the normal setter
  // would no-op — we must push the value to the OS again unconditionally.
  public reassertContentProtection(): void {
    this.applyContentProtection(this.contentProtection);
  }

  public setWindowDimensions(width: number, height: number): void {
    const activeWindow = this.getMainWindow(); // Gets currently focused/relevant window
    if (!activeWindow || activeWindow.isDestroyed()) return;

    const [currentX, currentY] = activeWindow.getPosition();
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const newWidth = Math.min(width, maxAllowedWidth);
    const newHeight = Math.ceil(height);
    const maxX = workArea.width - newWidth;
    const newX = Math.min(Math.max(currentX, 0), maxX);

    activeWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight,
    });

    // Update internal tracking if it's launcher
    if (activeWindow === this.launcherWindow) {
      this.launcherSize = { width: newWidth, height: newHeight };
      this.launcherPosition = { x: newX, y: currentY };
    }
  }

  // Dedicated method for overlay window resizing - decoupled from launcher
  public setOverlayDimensions(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const currentX = currentBounds.x;
    const currentY = currentBounds.y;
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth); // min 300, max 90%
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight); // min 1, max 90%
    const maxX = workArea.x + workArea.width - newWidth;
    const maxY = workArea.y + workArea.height - newHeight;
    const newX = Math.min(Math.max(currentX, workArea.x), maxX);
    const newY = Math.min(Math.max(currentY, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      return;
    }

    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
  }

  // X-ANCHORED overlay resize: the window's X origin (and the panel's screen
  // position — the panel is left-anchored in the window) NEVER moves across a
  // width change; only the RIGHT edge grows or shrinks. Because Chromium does
  // not sync setBounds to renderer paint on macOS, any resize that moves
  // painted pixels flashes for one frame — but a right-edge-only change
  // touches exclusively transparent region (expand: not yet painted; collapse:
  // already vacated by the settled CSS spring), so it is artifact-free.
  // Serves the 'update-content-dimensions-centered' IPC channel (historical
  // name kept to avoid churn across preload/renderer typings).
  // EDGE CASE: if the grown window would overflow the work area's right edge,
  // the X clamp below shifts the window left — that one case can show a
  // one-frame shift, same as any clamped move always could.
  public setOverlayDimensionsAnchored(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth);
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight);
    traceOverlayResize('setOverlayDimensionsAnchored:request', {
      requested: { width, height },
      currentBounds,
      currentContentSize,
      workArea,
      maxAllowed: { width: maxAllowedWidth, height: maxAllowedHeight },
      computed: { width: newWidth, height: newHeight },
      clampedHeight: newHeight !== height,
    });

    // X-anchored: the origin stays put; only the right edge moves.
    const desiredX = currentBounds.x;

    const maxX = workArea.x + workArea.width - newWidth;
    const newX = Math.min(Math.max(desiredX, workArea.x), maxX);
    const maxY = workArea.y + workArea.height - newHeight;
    const newY = Math.min(Math.max(currentBounds.y, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      traceOverlayResize('setOverlayDimensionsAnchored:noop', {
        requested: { width, height },
        currentBounds,
        currentContentSize,
        computed: { x: newX, y: newY, width: newWidth, height: newHeight },
      });
      return;
    }

    // Atomic frame change: a single setBounds avoids the 1-frame split where
    // the OS window has the new size but the old origin (or vice versa), which
    // is what causes the shell to visibly slide and snap during code-expansion.
    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
    traceOverlayResize('setOverlayDimensionsAnchored:applied', {
      requested: { width, height },
      appliedBounds: this.overlayBounds,
      contentSizeAfter: this.overlayWindow.getContentSize(),
    });
  }

  // NOTE: the overlay window is a FIXED WIDTH (OVERLAY_DEFAULT_WIDTH = 732)
  // for its entire visible lifetime; the renderer always reports that fixed
  // width, so every report here is height-only (width delta 0) — top-anchored,
  // X never moves, no width setBounds ever. The expand/contract animation is
  // CSS-only in the renderer (panel tweens 600↔732 centered inside the fixed
  // window). See NativelyInterface.startTransition for the renderer side.

  public createWindow(): void {
    if (this.launcherWindow !== null) return; // Already created

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    // Fixed dimensions per user request
    const width = 1200;
    const height = 800;

    // Calculate centered X, and top-centered Y (5% from top)
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    // Ensure y is at least workArea.y (don't go offscreen top)
    const topMargin = Math.round(workArea.height * 0.05);
    const y = Math.round(workArea.y + topMargin);

    // --- 1. Create Launcher Window ---
    const isMac = process.platform === 'darwin';

    const launcherSettings: Electron.BrowserWindowConstructorOptions = {
      width: width,
      height: height,
      x: x,
      y: y,
      minWidth: 600,
      minHeight: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
        webSecurity: !isDev, // DEBUG: Disable web security only in dev
      },
      show: false, // DEBUG: Force show -> Fixed white screen, now relies on ready-to-show
      // Platform-specific frame settings
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: false, titleBarOverlay: false, autoHideMenuBar: true }),
      ...(isMac
        ? { vibrancy: 'under-window' as const, visualEffectState: 'followWindow' as const }
        : {}),
      transparent: isMac,
      hasShadow: true,
      // The launcher starts with the black logo splash. Use a black native
      // background too so macOS doesn't show a grey/white transparent-window
      // flash before the renderer paints.
      backgroundColor: '#000000',
      focusable: true,
      resizable: true,
      movable: true,
      center: true,
      icon: (() => {
        const isMac = process.platform === 'darwin';
        const isWin = process.platform === 'win32';
        const mode = this.appState.getDisguise();

        if (mode === 'none') {
          if (isMac) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'natively.icns')
              : path.resolve(__dirname, '../../assets/natively.icns');
          } else if (isWin) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'assets/icons/win/icon.ico')
              : path.resolve(__dirname, '../../assets/icons/win/icon.ico');
          } else {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'assets', 'icon.png')
              : path.resolve(__dirname, '../../assets/icon.png');
          }
        }

        // Disguise mode icons. Only the three known disguise modes map to a
        // fake icon; any unexpected value falls through to 'none' above, so we
        // never silently paint a terminal icon for an unrecognized mode.
        let iconName: string | null = null;
        if (mode === 'terminal') iconName = 'terminal.png';
        if (mode === 'settings') iconName = 'settings.png';
        if (mode === 'activity') iconName = 'activity.png';
        if (!iconName) {
          // Defensive: unknown mode — use the real app icon, matching 'none'.
          if (isMac) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'natively.icns')
              : path.resolve(__dirname, '../../assets/natively.icns');
          } else if (isWin) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'assets/icons/win/icon.ico')
              : path.resolve(__dirname, '../../assets/icons/win/icon.ico');
          }
          return app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.resolve(__dirname, '../../assets/icon.png');
        }

        const platformDir = isWin ? 'win' : 'mac';
        return app.isPackaged
          ? path.join(process.resourcesPath, `assets/fakeicon/${platformDir}/${iconName}`)
          : path.resolve(__dirname, `../../assets/fakeicon/${platformDir}/${iconName}`);
      })(),
    };

    console.log(`[WindowHelper] Icon Path: ${launcherSettings.icon}`);
    console.log(`[WindowHelper] Start URL: ${startUrl}`);

    try {
      this.launcherWindow = new BrowserWindow(launcherSettings);
      this.appState.recordNativeOomTrace('launcher-window-created', {
        window: 'launcher',
        webContentsId: this.launcherWindow.webContents.id,
        rendererPid: this.launcherWindow.webContents.getOSProcessId(),
      });
      console.log('[WindowHelper] BrowserWindow created successfully');
    } catch (err) {
      console.error('[WindowHelper] Failed to create BrowserWindow:', err);
      return;
    }

    this.launcherWindow.setContentProtection(this.contentProtection);

    // A/B KILL-SWITCH (2026-07-10): NATIVELY_DISABLE_ONBOARDING_ORCH=1 appends
    // ?noorch=1, which makes App.tsx skip orch.start() entirely (no drain loop,
    // no onboarding toasters). The onboarding orchestrator's drain loop was
    // bisected to the 2026-07-04 native-memory-leak regression; this switch lets
    // the same build be run with the orchestrator ON vs OFF to confirm the leak
    // source in the field. The loop is now setTimeout-based (fixed), so this is
    // a confirmation/rollback lever, not the fix itself.
    const noOrchSuffix = process.env.NATIVELY_DISABLE_ONBOARDING_ORCH === '1' ? '&noorch=1' : '';
    if (noOrchSuffix) console.warn('[LeakTest] NATIVELY_DISABLE_ONBOARDING_ORCH=1 → launcher with ?noorch=1 (onboarding orchestrator OFF)');

    // DEV-ONLY launcher mount isolation for native-OOM bisection. This preserves
    // the launcher shell and normal production behavior while allowing a valid
    // Vite run to exclude either onboarding alone, all root-level surfaces, or
    // (via 'shell') skip the React root entirely (src/main.tsx).
    const requestedIsolation = process.env.NATIVELY_LAUNCHER_ISOLATION;
    const launcherIsolation = isDev && (
      requestedIsolation === 'shell' ||
      requestedIsolation === 'onboarding' ||
      requestedIsolation === 'global-surfaces' ||
      requestedIsolation === 'permissions-toaster' ||
      requestedIsolation === 'no-modals'
    ) ? requestedIsolation : '';
    const isolationSuffix = launcherIsolation ? `&isolate=${launcherIsolation}` : '';
    if (launcherIsolation) {
      this.appState.recordNativeOomTrace('launcher-isolation-selected', {
        window: 'launcher',
        isolation: launcherIsolation,
      });
      console.warn(`[LeakTest] NATIVELY_LAUNCHER_ISOLATION=${launcherIsolation} → launcher isolation enabled`);
    }

    // The review modal deliberately force-opens in development for UI iteration.
    // This switch keeps every other launcher surface unchanged while excluding
    // only that dev convenience mount during a native-memory A/B run.
    const reviewOffSuffix = isDev && process.env.NATIVELY_DISABLE_DEV_REVIEW === '1' ? '&review=off' : '';
    if (reviewOffSuffix) console.warn('[LeakTest] NATIVELY_DISABLE_DEV_REVIEW=1 → dev review modal disabled');

    const launcherUrl = `${startUrl}?window=launcher${noOrchSuffix}${isolationSuffix}${reviewOffSuffix}`;

    this.launcherWindow
      .loadURL(launcherUrl)
      .then(() => console.log('[WindowHelper] loadURL success'))
      .catch((e) => {
        console.error('[WindowHelper] Failed to load URL:', e);
      });

    let launcherLoadRetries = 0;
    const MAX_LAUNCHER_LOAD_RETRIES = 10;
    this.launcherWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error(`[WindowHelper] did-fail-load: ${errorCode} ${errorDescription}`);
      // DEV SELF-HEAL (2026-07-10): in dev, the renderer loads from the Vite
      // server at http://localhost:5180. If that server is momentarily
      // unavailable (a slow first `npm start`, an HMR reconnect, or a stale
      // server from a prior run being replaced), the load fails and — with no
      // retry — the window stays permanently black (its native backgroundColor).
      // That is the "loads fine the first time, then stuck at the logo/black
      // screen on subsequent launches" symptom on Windows dev. A bounded retry
      // converts "permanent black" into "black for ~1s, then loads."
      //
      // errorCode -3 = ERR_ABORTED (a superseded/intentional nav — do NOT retry).
      if (isDev && errorCode !== -3 && launcherLoadRetries < MAX_LAUNCHER_LOAD_RETRIES) {
        launcherLoadRetries += 1;
        console.warn(`[WindowHelper] dev: retrying launcher load (${launcherLoadRetries}/${MAX_LAUNCHER_LOAD_RETRIES}) in 1s…`);
        setTimeout(() => {
          if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
            this.launcherWindow.loadURL(launcherUrl).catch(() => { /* next did-fail-load retries */ });
          }
        }, 1000);
      }
    });

    // Reset the retry counter once a load actually succeeds, so a LATER
    // transient failure (e.g. an HMR blip mid-session) gets its own fresh
    // retry budget instead of being starved by earlier retries.
    this.launcherWindow.webContents.on('did-finish-load', () => {
      launcherLoadRetries = 0;
      const launcher = this.launcherWindow;
      if (!launcher || launcher.isDestroyed()) return;
      const rendererPid = launcher.webContents.getOSProcessId();
      this.appState.recordNativeOomTrace('launcher-did-finish-load', {
        window: 'launcher',
        webContentsId: launcher.webContents.id,
        rendererPid,
      });
      this.appState.armNativeOomContentTrace(rendererPid);
    });

    // Pipe renderer-side diagnostics into the main-process log file. Without
    // this, a "stuck at logo" hang or a renderer crash leaves NO trace in
    // ~/Documents/natively_debug.log — the renderer's console, uncaught JS
    // errors, crashes, and hangs are otherwise invisible to us. This is the
    // difference between "the app is stuck and we can't tell why" and a log
    // line naming the exact failing module/line on the user's machine.
    this.attachRendererDiagnostics(this.launcherWindow, 'launcher');

    // DIAGNOSTIC (2026-07-11): NATIVELY_OPEN_DEVTOOLS=1 force-opens the launcher
    // DevTools DETACHED (survives a renderer hang, unlike an in-window panel).
    // For debugging the "window appears then freezes / renderer not responsive"
    // report: open the Performance tab and record during the freeze — a single
    // long yellow Scripting block = a JS main-thread loop; a flat gap with no JS
    // = a compositor/GPU stall (the software-compositing blur path). Detached so
    // it stays usable even when the launcher renderer stops pumping its loop.
    if (process.env.NATIVELY_OPEN_DEVTOOLS === '1') {
      try {
        this.launcherWindow.webContents.openDevTools({ mode: 'detach' });
        console.warn('[Diag] NATIVELY_OPEN_DEVTOOLS=1 → launcher DevTools opened (detached)');
      } catch (e: any) {
        console.warn('[Diag] openDevTools failed:', e?.message || e);
      }
    }

    // --- 2. Create Overlay Window (Hidden initially) ---
    // Always start centered on the primary display so the OS (macOS NSUserDefaults /
    // Windows DWM) cannot restore the previous session's cached window position.
    // The in-memory `overlayBounds` is already null here, so `switchToOverlay()`
    // will also fall back to centered logic — but providing explicit x/y in the
    // constructor is the only reliable guard against OS-level position persistence.
    const overlayDefaultX = Math.floor(
      workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2,
    );
    // + PILL_STACK_OFFSET: the pill lives in its own window ABOVE this one,
    // so the shell starts one pill-stack lower to leave it room — the pill
    // then lands where the old single window's top edge used to be.
    const overlayDefaultY = Math.floor(
      workArea.y +
        workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO +
        WindowHelper.PILL_STACK_OFFSET,
    );

    const overlaySettings: Electron.BrowserWindowConstructorOptions = {
      width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
      height: 1,
      x: overlayDefaultX,
      y: overlayDefaultY,
      minWidth: 300,
      minHeight: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
      },
      show: false,
      frame: false, // Frameless
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      resizable: false, // Enforce automatic resizing only
      movable: true,
      skipTaskbar: true, // Don't show separately in dock/taskbar
      hasShadow: false, // Prevent shadow from adding perceived size/artifacts
      // macOS NSPanel + nonactivating: lets the overlay become the key window
      // (and receive keystrokes for the chat input) without activating Natively
      // in the dock / menu bar / screen-share, so the user's foreground app
      // stays "in front." Required for the chat:focusInput stealth-typing path.
      // Windows/Linux fall back to a regular focusable window.
      ...(isMac ? { type: 'panel' as const } : {}),
    };

    this.overlayWindow = new BrowserWindow(overlaySettings);
    this.overlayWindow.setContentProtection(this.contentProtection);
    // Apply the current mouse-interaction policy to the NEW window. Without
    // this, a window (re)created while stealth passthrough is ON would start
    // fully interactive — silently breaking passthrough until the next toggle.
    this.syncOverlayInteractionPolicy();

    // Register the overlay as the sole recipient of CGEventTap captured-key
    // broadcasts. Without this, captured keystrokes fan out to ALL windows
    // (settings, cropper, etc.) — silent privacy/security exposure.
    if (process.platform === 'darwin') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
        StealthKeyboardManager.getInstance().setOverlayWindow(this.overlayWindow);
      } catch (e) {
        console.error('[WindowHelper] failed to register overlay with StealthKeyboardManager:', e);
      }
    }

    if (process.platform === 'darwin') {
      this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayWindow.setHiddenInMissionControl(true);
      this.overlayWindow.setAlwaysOnTop(true, 'floating');

      // Apply Spotlight/Alfred-grade stealth attributes that Electron does not
      // expose: becomesKeyOnlyIfNeeded (clicks on buttons / surfaces don't
      // promote the panel to key window → user's foreground app keeps key
      // state in the dock, menu bar, screen-share, focus-followers),
      // hidesOnDeactivate=NO, and the right collectionBehavior. Without this,
      // ANY click on the overlay (button, input, anywhere) activates Natively
      // and dims the user's foreground app — even with type:'panel' set.
      //
      // DEFERRED to `ready-to-show`: getNativeWindowHandle() returns the
      // NSView pointer immediately after `new BrowserWindow`, but the view's
      // [NSView window] may briefly be nil before Electron finishes attaching
      // the view to its NSWindow. Calling now races and the Rust side returns
      // "NSView has no associated NSWindow" → silent fallback to plain panel.
      // ready-to-show fires AFTER the NSWindow is attached and the renderer
      // has performed its first paint, so the window is guaranteed live.
      //
      // Optional: requires the rebuilt native module (npm run build:native).
      // If the binary predates this method we silently skip; clicks will still
      // soft-activate the panel as before but type:'panel' alone keeps the
      // dock icon out of the way. Existing users see no regression.
      this.overlayWindow.once('ready-to-show', () => {
        if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { loadNativeModule } = require('./audio/nativeModuleLoader');
          const native = loadNativeModule();
          if (native && typeof native.applyStealthToWindow === 'function') {
            native.applyStealthToWindow(this.overlayWindow.getNativeWindowHandle());
            console.log('[WindowHelper] Applied stealth NSPanel attributes to overlay');
          } else {
            console.warn(
              '[WindowHelper] applyStealthToWindow unavailable — rebuild native module (npm run build:native) for full stealth',
            );
          }
        } catch (e) {
          console.error('[WindowHelper] Failed to apply stealth attributes:', e);
        }
      });
    } else if (process.platform === 'win32') {
      // 'floating' level (HWND_TOPMOST baseline) is not enough to render above
      // fullscreen browser windows (F11). 'screen-saver' uses a higher TOPMOST
      // priority that wins against window-mode fullscreen apps. macOS uses
      // visibleOnFullScreen above; Windows has no equivalent flag, so the level
      // itself is what controls fullscreen visibility. See issue #167.
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.overlayWindow.loadURL(`${startUrl}?window=overlay`).catch((e) => {
      console.error('[WindowHelper] Failed to load Overlay URL:', e);
    });

    this.attachRendererDiagnostics(this.overlayWindow, 'overlay');

    // --- 2b. Overlay auxiliary windows (pill + resize toggle) ---
    this.createOverlayAuxWindows(startUrl);

    // --- 3. Startup Sequence ---
    this.launcherWindow.once('ready-to-show', () => {
      this.switchToLauncher();
      this.isWindowVisible = true;
    });

    this.setupWindowListeners();
  }

  /**
   * Route a window's renderer-side diagnostics into the main-process log so a
   * "stuck at logo" hang or a renderer crash is diagnosable from
   * ~/Documents/natively_debug.log alone — no DevTools, no remote debugging.
   *
   * Captures, per window:
   *   - console-message      → renderer console output (React errors, warnings,
   *                            our own console.error from ErrorBoundary etc.).
   *                            Levels: 0=verbose 1=info 2=warning 3=error; we
   *                            only forward warning+error to keep the log lean.
   *   - render-process-gone  → the actual CRASH signal (SIGSEGV/OOM/killed).
   *                            Names the reason + exitCode — this is what tells
   *                            us "the renderer died" vs "the renderer hung".
   *   - unresponsive         → the HANG signal ("stuck at logo"): the renderer
   *                            stopped pumping its event loop. Paired with
   *                            'responsive' so we can see if it recovered.
   *   - did-finish-load / dom-ready → positive proof the React bundle actually
   *                            evaluated (the log previously had no such marker,
   *                            so we couldn't tell mount-failure from hang).
   *   - preload-error        → a throw inside preload.js (would leave the
   *                            renderer with no window.electronAPI → white/stuck
   *                            screen with no other trace).
   */
  private attachRendererDiagnostics(win: BrowserWindow, tag: string): void {
    try {
      const wc = win.webContents;

      wc.on('did-finish-load', () => {
        console.log(`[Renderer:${tag}] did-finish-load (bundle evaluated)`);
        // The Interface Opacity live-preview (see setLauncherOpacityPreview)
        // toggles the launcher window's native vibrancy/background/shadow
        // outside of React — those native properties survive a same-window
        // reload (e.g. the render-process-gone auto-recovery path in
        // main.ts), but the fresh renderer always boots with its preview
        // React state at rest (not mid-drag). Force the native state back to
        // "not previewing" on every load so a crash/reload mid-drag can never
        // leave the window stuck transparent/shadowless.
        if (tag === 'launcher') {
          this.setLauncherOpacityPreview(false);
        }
      });

      wc.on('dom-ready', () => {
        console.log(`[Renderer:${tag}] dom-ready`);
      });

      // console-message event: Electron changed this signature in v35. Old API
      // (≤34) passed positional args (event, level:number, message, line,
      // sourceId); new API (≥35) passes a single Event object with string
      // `level` ('info'|'warning'|'error'|'debug'), `message`, `lineNumber`,
      // `sourceId`. Support BOTH so this works whether or not the Electron bump
      // is merged. Only surface warning+ to avoid flooding the log.
      wc.on('console-message', (...args: any[]) => {
        let label: 'WARN' | 'ERROR' | null = null;
        let message = '';
        let line: number | undefined;
        let sourceId: unknown;
        const first = args[0];
        if (first && typeof first === 'object' && ('level' in first) && typeof first.level === 'string') {
          // New (≥35) object form.
          const lvl = first.level as string;
          if (lvl !== 'warning' && lvl !== 'error') return;
          label = lvl === 'error' ? 'ERROR' : 'WARN';
          message = first.message ?? '';
          line = first.lineNumber;
          sourceId = first.sourceId;
        } else {
          // Old (≤34) positional form: (event, level, message, line, sourceId).
          const level = args[1] as number;
          if (typeof level !== 'number' || level < 2) return;
          label = level === 3 ? 'ERROR' : 'WARN';
          message = args[2] ?? '';
          line = args[3];
          sourceId = args[4];
        }
        // sourceId can be a long file:// path; keep only the tail for readability.
        const src = typeof sourceId === 'string' ? sourceId.split('/').pop() : sourceId;
        console.error(`[Renderer:${tag}] console.${label} ${message} (${src}:${line})`);
      });

      wc.on('render-process-gone', (_event, details) => {
        if (tag === 'launcher') {
          this.appState.recordNativeOomTrace('launcher-render-process-gone', {
            window: 'launcher',
            webContentsId: wc.id,
            rendererPid: wc.getOSProcessId(),
            reason: typeof details?.reason === 'string' ? details.reason : 'unknown',
            exitCode: typeof details?.exitCode === 'number' ? details.exitCode : 0,
          });
          this.appState.stopNativeOomContentTrace('launcher-render-process-gone');
        }
        console.error(
          `[Renderer:${tag}] RENDER-PROCESS-GONE reason=${details?.reason} exitCode=${details?.exitCode}`,
        );
      });

      wc.on('preload-error', (_event, preloadPath, error) => {
        console.error(
          `[Renderer:${tag}] PRELOAD-ERROR in ${preloadPath}: ${error?.stack || error?.message || String(error)}`,
        );
      });

      win.on('unresponsive', () => {
        console.error(`[Renderer:${tag}] UNRESPONSIVE — renderer stopped pumping its event loop (hang / "stuck at logo")`);
      });

      win.on('responsive', () => {
        console.log(`[Renderer:${tag}] responsive again (recovered from hang)`);
      });
    } catch (e) {
      // Diagnostics attachment must never break window creation.
      console.warn(`[WindowHelper] attachRendererDiagnostics(${tag}) failed (non-fatal):`, e);
    }
  }

  private setupWindowListeners(): void {
    if (!this.launcherWindow) return;

    // Suppress Windows system context menu on right-click (title bar)
    this.launcherWindow.on('system-context-menu', (e, point) => {
      e.preventDefault();
      if (!this.appState.getUndetectable()) {
        this.showContextMenu(this.launcherWindow!, point);
      }
    });

    this.launcherWindow.on('move', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherPosition = { x: bounds.x, y: bounds.y };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    this.launcherWindow.on('resize', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherSize = { width: bounds.width, height: bounds.height };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    // On Windows/Linux: intercept close and hide to tray instead of quitting,
    // unless the app is actually quitting (e.g. from tray "Quit" menu).
    //
    // DEV EXCEPTION (2026-07-10): in dev, hide-to-tray leaves a headless
    // electron process alive after you close the window. When you then Ctrl+C
    // the `npm start` terminal, Windows does not reliably deliver SIGINT/SIGTERM
    // to that GUI process, so it survives as a ZOMBIE holding the single-instance
    // lock, port 5180, and open natively.db-wal/-shm handles. The NEXT `npm start`
    // then either self-exits on the lost lock or loads a dead dev server →
    // "loads once, then stuck at logo/black forever." In dev we therefore let a
    // window close actually quit the app, so no zombie survives between runs.
    if (process.platform !== 'darwin') {
      this.launcherWindow.on('close', (e) => {
        if (isDev) {
          // Let the close proceed and quit — no hide-to-tray in dev.
          this.appState.setQuitting(true);
          return;
        }
        if (!this.appState.isQuitting()) {
          e.preventDefault();
          this.launcherWindow?.hide();
          this.isWindowVisible = false;
        }
      });

      // Sync maximize state to renderer so WindowControls stays in sync (Windows/Linux only)
      this.launcherWindow.on('maximize', () => {
        const launcher = this.launcherWindow;
      if (launcher && !launcher.isDestroyed()) {
        this.appState.recordNativeOomOutboundIpc(launcher.webContents.id, 'window-maximized-changed', [true]);
        launcher.webContents.send('window-maximized-changed', true);
      }
      });
      this.launcherWindow.on('unmaximize', () => {
        const launcher = this.launcherWindow;
      if (launcher && !launcher.isDestroyed()) {
        this.appState.recordNativeOomOutboundIpc(launcher.webContents.id, 'window-maximized-changed', [false]);
        launcher.webContents.send('window-maximized-changed', false);
      }
      });
    }

    this.launcherWindow.on('closed', () => {
      this.appState.recordNativeOomTrace('launcher-window-closed', { window: 'launcher' });
      this.appState.stopNativeOomContentTrace('launcher-window-closed');
      this.launcherWindow = null;
      // Reset so a later launcher recreation doesn't inherit a stale "preview
      // active" flag with no corresponding transparent/vibrancy-off window.
      this.launcherOpacityPreviewActive = false;
      // If launcher closes, we should probably quit app or close overlay
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close();
      }
      this.overlayWindow = null;
      this.isWindowVisible = false;
    });

    // Listen for overlay close (e.g. Cmd+W). Never truly destroy it — either
    // hide it (during a meeting) or switch back to launcher (between meetings).
    if (this.overlayWindow) {
      this.overlayWindow.on('move', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
        }
      });

      this.overlayWindow.on('resize', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
        }
      });

      this.overlayWindow.on('system-context-menu', (e, point) => {
        e.preventDefault();
        if (!this.appState.getUndetectable()) {
          this.showContextMenu(this.overlayWindow!, point);
        }
      });

      // Re-assert always-on-top on blur (Windows only). Screen-sharing tools
      // (Zoom, Lark, Teams, etc.) hook the DWM compositor and can demote even
      // HWND_TOPMOST windows below their shared content layer. Re-applying the
      // 'screen-saver' level on every blur keeps the overlay above the share
      // surface. Skipped on macOS — re-asserting setAlwaysOnTop there triggers
      // [NSApp activate], which steals focus from the underlying app. See #130.
      if (process.platform === 'win32') {
        this.overlayWindow.on('blur', () => {
          if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
          if (!this.overlayWindow.isVisible()) return;
          this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        });
      }

      this.overlayWindow.on('close', (e) => {
        if (this.overlayWindow?.isVisible()) {
          e.preventDefault();
          if (this.appState.getIsMeetingActive()) {
            // Meeting running — just hide the overlay; user can resume from the
            // launcher's "Meeting ongoing" button which calls setWindowMode('overlay').
            this.hideOverlay();
          } else {
            this.switchToLauncher();
          }
        }
      });
    }
  }

  // Helper to get whichever window should be treated as "Main" for IPC
  public getMainWindow(): BrowserWindow | null {
    if (this.currentWindowMode === 'overlay' && this.overlayWindow) {
      return this.overlayWindow;
    }
    return this.launcherWindow;
  }

  // Specific getters if needed
  public getLauncherWindow(): BrowserWindow | null {
    return this.launcherWindow;
  }
  public getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }
  public getCurrentWindowMode(): 'launcher' | 'overlay' {
    return this.currentWindowMode;
  }

  // Clears the remembered overlay position so the next switchToOverlay() call
  // opens at the default centered position (called on new meeting start).
  public resetOverlayPosition(): void {
    this.overlayBounds = null;
    console.log('[WindowHelper] Overlay position reset to default for next meeting.');
  }

  public getLastOverlayBounds(): Electron.Rectangle | null {
    // If no in-memory bounds exist, return null to signify no user-initiated movement.
    if (this.overlayBounds) return { ...this.overlayBounds };
    return null;
  }

  public getLastOverlayDisplayId(): number | null {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return null;
    const bounds = this.overlayWindow.getBounds();
    return screen.getDisplayMatching(bounds).id;
  }

  public isVisible(): boolean {
    return this.isWindowVisible;
  }

  public isMainWindowMaximized(): boolean {
    const win = this.launcherWindow;
    return !!win && !win.isDestroyed() && win.isMaximized();
  }

  public hideMainWindow(): void {
    // Do NOT call setOpacity(0) before hide() on macOS — it causes WindowServer to
    // re-register the app as a regular window, breaking undetectable/stealth mode
    // (fixed in v2.0.8, regressed when opacity was re-added for screenshot flash).
    // Screenshot capture already waits 80ms after hide() for compositor flush.
    if (process.platform === 'win32') {
      this.launcherWindow?.setOpacity(0);
      this.overlayWindow?.setOpacity(0);
      // Aux windows carry the same on-screen chrome (pill/toggle) that used
      // to live inside the shielded overlay window — zero them too so a
      // capture frame during the hide can't leak them.
      this.pillWindow?.setOpacity(0);
      this.toggleWindow?.setOpacity(0);
    }
    this.launcherWindow?.hide();
    // Hide the aux chrome explicitly and BEFORE the overlay body. This path
    // feeds screenshot capture, which waits a fixed 80ms after hide() for the
    // compositor to flush; an event-chained pill hide spends part of that
    // budget on an extra hop and can leak the pill into the captured frame.
    this.applyOverlayAuxVisibility(false);
    this.overlayWindow?.hide();
    this.lastLauncherShowInactive = null;
    this.isWindowVisible = false;
  }

  // Apply the click-through (mouse passthrough) policy on the overlay window.
  // TWO inputs:
  //   • overlayMousePassthrough (master stealth toggle) — when ON the whole
  //     group (overlay + pill + toggle) is fully click-through.
  //   • overlayHoverInteractive (renderer hover hit-test) — when the pointer
  //     is over one of the fixed window's transparent side margins (collapsed
  //     state, 66px each side) the overlay alone goes click-through with
  //     forward:true, so those margins don't swallow clicks meant for apps
  //     beneath. See OVERLAY_DEFAULT_WIDTH for the geometry.
  //
  // Why this hover gate does NOT deadlock drags (the failure that killed an
  // earlier hover-gate attempt): the DEFAULT state is interactive, and the
  // hit-test only disables interactivity while the pointer is over a
  // transparent margin — never over the painted panel or its drag regions.
  // forward:true keeps mousemove streaming while ignored, so crossing back
  // over the panel re-arms interactivity before a click can land. The earlier
  // attempt defaulted to IGNORE before any hit-test had run, which ate the
  // first click on the drag handle.
  public syncOverlayInteractionPolicy(quiet = false): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const passthrough = this.appState.getOverlayMousePassthrough();
    // The pill and toggle windows follow ONLY the stealth passthrough — they
    // are fully painted (no transparent margins), so the hover gate never
    // applies to them.
    const auxWindows = [this.pillWindow, this.toggleWindow].filter(
      (w): w is BrowserWindow => !!w && !w.isDestroyed(),
    );
    // Hover gate (margins click-through) requires forward:true, which Linux
    // does not support — there the margins stay interactive (dead-click), the
    // pre-gate behavior.
    const forwardSupported = process.platform !== 'linux';
    const overlayIgnore = passthrough || (forwardSupported && !this.overlayHoverInteractive);

    if (overlayIgnore) {
      // forward: true — pointer events are still delivered to the OS layer
      // beneath, AND mousemove keeps streaming to the renderer, which is what
      // lets the hover hit-test flip the window back to interactive before
      // the pointer reaches the painted panel.
      // NOTE: We intentionally do NOT call setFocusable(false) here.
      //
      // Rationale: setIgnoreMouseEvents() alone is sufficient for transparent
      // mouse behaviour.  Setting focusable=false when the overlay is the only
      // visible window makes macOS treat the app as having NO active windows.
      // In that state, macOS may stop delivering Carbon/IOKit global hotkey
      // events to the process — silently breaking every globalShortcut binding.
      // Keeping the window focusable costs nothing.
      this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      this.overlayWindow.setIgnoreMouseEvents(false);
      // Restore full interactivity when capturing clicks.
      this.overlayWindow.setFocusable(true);
    }
    auxWindows.forEach((w) => {
      if (passthrough) {
        w.setIgnoreMouseEvents(true, { forward: true });
      } else {
        w.setIgnoreMouseEvents(false);
        w.setFocusable(true);
      }
    });
    if (!quiet) {
      console.log(
        `[WindowHelper] Overlay interaction policy: passthrough=${passthrough} hoverInteractive=${this.overlayHoverInteractive}`,
      );
    }
  }

  // Renderer hover hit-test → margins click-through. Called on every
  // interactive↔margin boundary crossing (state changes only, not per
  // mousemove), so `quiet` keeps the log usable.
  public setOverlayHoverInteractive(interactive: boolean): void {
    if (this.overlayHoverInteractive === interactive) return;
    this.overlayHoverInteractive = interactive;
    this.syncOverlayInteractionPolicy(true);
  }

  // Renderer-streamed live panel right edge (px from the overlay window's
  // left edge) — repositions the toggle window so it rides the panel's
  // top-right corner during the width spring.
  public setOverlayToggleAnchor(panelRight: number): void {
    if (!Number.isFinite(panelRight)) return;
    const clamped = Math.max(0, Math.min(Math.round(panelRight), 10_000));
    if (clamped === this.togglePanelRight) return;
    this.togglePanelRight = clamped;
    this.positionToggleWindow();
    // The panel's left margin moved too (symmetric growth) — any open
    // settings/model-selector dropdown is anchored to the PANEL, so it rides
    // the width spring exactly like the toggle does.
    this.repositionOverlayPopovers();
  }

  // The panel's live LEFT margin inside the fixed window: (732 - panelW)/2,
  // derived from the streamed togglePanelRight = (732 + panelW)/2. Popover
  // anchors are stored relative to the panel, not the window, so they follow
  // the symmetric width spring.
  public getOverlayPanelLeftMargin(): number {
    return Math.max(0, WindowHelper.OVERLAY_DEFAULT_WIDTH - this.togglePanelRight);
  }

  // Re-anchor any open overlay popovers (settings / model-selector) to the
  // overlay's current bounds + live panel margin. Called on overlay
  // move/resize and on every panel-width anchor update.
  private repositionOverlayPopovers(): void {
    if (this.overlayPopoversOpen.size === 0) return;
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const margin = this.getOverlayPanelLeftMargin();
    this.appState.settingsWindowHelper?.repositionForOverlay?.(bounds, margin);
    this.appState.modelSelectorWindowHelper?.repositionForOverlay?.(bounds, margin);
    // Keep the catcher covering the display the overlay lives on (drag across
    // displays while a popover is open).
    this.syncPopoverCatcher();
  }

  // Called by SettingsWindowHelper / ModelSelectorWindowHelper whenever an
  // overlay-anchored popover opens or closes. Drives the click-catcher.
  public notifyOverlayPopover(kind: 'settings' | 'model', open: boolean): void {
    const before = this.overlayPopoversOpen.size;
    if (open) this.overlayPopoversOpen.add(kind);
    else this.overlayPopoversOpen.delete(kind);
    if (this.overlayPopoversOpen.size !== before || open) this.syncPopoverCatcher();
  }

  // Close both dropdowns (catcher click, aux-window click, overlay hide).
  public dismissOverlayPopovers(opts?: { settings?: boolean; model?: boolean }): void {
    const closeSettings = opts?.settings !== false;
    const closeModel = opts?.model !== false;
    if (closeSettings) {
      const w = this.appState.settingsWindowHelper?.getSettingsWindow();
      if (w && !w.isDestroyed() && w.isVisible()) this.appState.settingsWindowHelper.closeWindow();
    }
    if (closeModel) {
      const w = this.appState.modelSelectorWindowHelper?.getWindow();
      if (w && !w.isDestroyed() && w.isVisible()) this.appState.modelSelectorWindowHelper.hideWindow();
    }
  }

  public getPopoverCatcherWindow(): BrowserWindow | null {
    return this.popoverCatcher;
  }

  private syncPopoverCatcher(): void {
    const overlay = this.overlayWindow;
    const overlayVisible = !!overlay && !overlay.isDestroyed() && overlay.isVisible();
    const want = overlayVisible && this.overlayPopoversOpen.size > 0;

    if (!want) {
      if (this.popoverCatcher && !this.popoverCatcher.isDestroyed() && this.popoverCatcher.isVisible()) {
        this.popoverCatcher.hide();
      }
      return;
    }

    if (!this.popoverCatcher || this.popoverCatcher.isDestroyed()) {
      this.createPopoverCatcher();
    }
    const catcher = this.popoverCatcher;
    if (!catcher || catcher.isDestroyed()) return;

    // Cover the FULL bounds of the display the overlay sits on (not just the
    // work area — a click on the Dock strip should also dismiss).
    const display = screen.getDisplayMatching(overlay!.getBounds());
    catcher.setBounds(display.bounds);
    if (!catcher.isVisible()) catcher.showInactive();
    // Same-level windows stack by recency — re-assert the Natively windows
    // above the catcher (macOS already orders it below via relativeLevel -1;
    // this covers Windows and any level fallback).
    for (const w of [
      this.overlayWindow,
      this.pillWindow,
      this.toggleWindow,
      this.appState.settingsWindowHelper?.getSettingsWindow?.(),
      this.appState.modelSelectorWindowHelper?.getWindow?.(),
    ]) {
      if (w && !w.isDestroyed() && w.isVisible()) {
        try {
          w.moveTop();
        } catch {
          /* moveTop can throw on wayland; ordering is cosmetic there */
        }
      }
    }
  }

  private createPopoverCatcher(): void {
    const isMac = process.platform === 'darwin';
    this.popoverCatcher = new BrowserWindow({
      width: 100,
      height: 100,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      // Never focusable: it must consume exactly one dismissing click without
      // stealing focus from the user's foreground app.
      focusable: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      ...(isMac ? { type: 'panel' as const } : {}),
    });
    this.popoverCatcher.setContentProtection(this.contentProtection);
    if (isMac) {
      this.popoverCatcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.popoverCatcher.setHiddenInMissionControl(true);
      // relativeLevel -1: below the other 'floating' Natively windows, above
      // normal app windows — clicks on Natively still hit Natively; clicks
      // anywhere else hit the catcher.
      this.popoverCatcher.setAlwaysOnTop(true, 'floating', -1);
    }
    // Minimal self-contained page: one capture-phase mousedown → dismiss IPC.
    // The app preload runs on data: URLs, so window.electronAPI is available.
    const page =
      '<!doctype html><html><body style="margin:0;width:100vw;height:100vh;background:transparent">' +
      '<script>window.addEventListener("mousedown",function(){' +
      'window.electronAPI&&window.electronAPI.dismissOverlayPopovers&&window.electronAPI.dismissOverlayPopovers()' +
      '},true)</script></body></html>';
    this.popoverCatcher
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
      .catch((e) => console.error('[WindowHelper] popover catcher load failed:', e));
    this.popoverCatcher.on('closed', () => {
      this.popoverCatcher = null;
    });
  }

  // ── Overlay auxiliary windows (pill + resize toggle) ──────────────────────
  // Each is a tiny frameless transparent panel with the same stealth
  // characteristics as the overlay. Coordination model (no setParentWindow —
  // explicit event mirroring works identically on macOS and Windows and
  // avoids AppKit child-window double-move feedback during pill drags):
  //   • overlay 'move'/'resize'  → reposition pill + toggle around the new
  //     bounds (covers user drags of the shell, arrow-key nudges, and every
  //     programmatic setBounds — width changes reposition the toggle, which
  //     tracks the RIGHT edge).
  //   • pill 'move' (its draggable-area drags ONLY the pill's own OS window)
  //     → move the overlay so the group follows the pill, then the toggle.
  //   • overlay 'show'/'hide'    → mirror visibility (toggle additionally
  //     gated on the renderer-reported hasContent flag).
  //   • `auxSyncing` guards every programmatic move against event feedback.
  private createOverlayAuxWindows(startUrl: string): void {
    if (!this.overlayWindow) return;
    if (this.pillWindow || this.toggleWindow) return; // already created

    const isMac = process.platform === 'darwin';
    const auxSettings = (movable: boolean): Electron.BrowserWindowConstructorOptions => ({
      width: 10,
      height: 10,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      resizable: false,
      movable,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      // Same nonactivating-panel treatment as the overlay: clicking the pill's
      // buttons must not activate Natively over the user's foreground app.
      ...(isMac ? { type: 'panel' as const } : {}),
    });

    this.pillWindow = new BrowserWindow(auxSettings(true));
    this.toggleWindow = new BrowserWindow(auxSettings(false));

    // Weld the group via real AppKit child windows (macOS only) — see the
    // overlayGroupWelded field comment for the measured semantics. Applied
    // here, at creation, while all three are still hidden: verified to take
    // effect on first show and to survive later hide/show cycles.
    this.overlayGroupWelded = isMac && process.env.NATIVELY_OVERLAY_WINDOW_GROUP !== '0';
    if (this.overlayGroupWelded) {
      this.pillWindow.setParentWindow(this.overlayWindow);
      this.toggleWindow.setParentWindow(this.overlayWindow);
      console.log('[WindowHelper] Overlay group welded (pill/toggle are child windows)');
    }
    // Managed drag is wanted on BOTH desktop platforms (see the field comment).
    // On macOS it is implied by welding — a welded pill MUST drag its parent —
    // so it cannot be switched off independently there without tearing the
    // group apart on the first drag.
    this.overlayGroupDragManaged =
      this.overlayGroupWelded ||
      (process.platform === 'win32' && process.env.NATIVELY_OVERLAY_GROUP_DRAG !== '0');
    console.log(
      `[WindowHelper] Overlay group drag: managed=${this.overlayGroupDragManaged} welded=${this.overlayGroupWelded}`,
    );

    const auxPairs: Array<[BrowserWindow, string]> = [
      [this.pillWindow, 'overlay-pill'],
      [this.toggleWindow, 'overlay-toggle'],
    ];
    for (const [win, name] of auxPairs) {
      win.setContentProtection(this.contentProtection);
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setHiddenInMissionControl(true);
        win.setAlwaysOnTop(true, 'floating');
        win.once('ready-to-show', () => {
          if (win.isDestroyed()) return;
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadNativeModule } = require('./audio/nativeModuleLoader');
            const native = loadNativeModule();
            if (native && typeof native.applyStealthToWindow === 'function') {
              native.applyStealthToWindow(win.getNativeWindowHandle());
            }
          } catch {
            // Non-fatal: type:'panel' alone still keeps the dock out of the way.
          }
        });
      } else if (process.platform === 'win32') {
        win.setAlwaysOnTop(true, 'screen-saver');
      }
      win.loadURL(`${startUrl}?window=${name}`).catch((e) => {
        console.error(`[WindowHelper] Failed to load ${name} URL:`, e);
      });
      this.attachRendererDiagnostics(win, name);
      // Replay the last UI-state broadcast once the aux renderer is live — it
      // may finish loading after the overlay's first broadcast.
      win.webContents.on('did-finish-load', () => {
        if (this.lastOverlayUiState !== null && !win.isDestroyed()) {
          win.webContents.send('overlay-ui-state', this.lastOverlayUiState);
        }
      });
      win.on('closed', () => {
        if (this.pillWindow === win) this.pillWindow = null;
        if (this.toggleWindow === win) this.toggleWindow = null;
      });
    }

    // Group sync — see the coordination model comment above.
    this.overlayWindow.on('move', () => {
      // Welded: AppKit already moved the children in the same transaction as
      // the parent. Re-positioning them here would be a second, LATER move —
      // exactly the one-transaction lag this mode exists to remove — and
      // during a native drag it would fight the window-server drag loop.
      if (!this.overlayGroupWelded && !this.auxSyncing) this.positionOverlayAuxWindows();
      this.repositionOverlayPopovers();
    });
    // Welded mode gives up per-frame pill clamping (the pill can no longer be
    // clamped independently without unwelding it from the shell), so re-assert
    // the work-area constraint on the WHOLE group once the drag settles.
    // macOS 'moved' fires after the move completes, so this costs nothing
    // mid-drag. Moving the shell carries the children with it, preserving the
    // weld — which is the point: the group clamps as one entity.
    this.overlayWindow.on('moved', () => {
      if (this.overlayGroupWelded && !this.auxSyncing && !this.overlayGroupDragging) {
        this.clampOverlayGroupIntoWorkArea();
      }
    });
    this.overlayWindow.on('resize', () => {
      if (!this.auxSyncing) this.positionOverlayAuxWindows();
      this.repositionOverlayPopovers();
    });
    this.overlayWindow.on('show', () => {
      // Safe default on every show: interactive until the renderer's hover
      // hit-test says the pointer is over a transparent margin.
      this.overlayHoverInteractive = true;
      this.syncOverlayInteractionPolicy(true);
      this.syncOverlayAuxVisibility();
    });
    this.overlayWindow.on('hide', () => {
      this.syncOverlayAuxVisibility();
      // A hidden overlay must not leave orphaned dropdowns (or the click
      // catcher) floating over the desktop.
      this.dismissOverlayPopovers();
      this.syncPopoverCatcher();
    });
    // Renderer (re)load resets the hover-gate handshake: the fresh renderer's
    // hit-test resends its verdict on mount, but until then the safe state is
    // interactive — a latched non-interactive state from a crashed renderer
    // would otherwise leave the panel click-through with no recovery path.
    this.overlayWindow.webContents.on('did-finish-load', () => {
      this.overlayHoverInteractive = true;
      this.syncOverlayInteractionPolicy(true);
    });
    this.overlayWindow.on('closed', () => {
      for (const w of [this.pillWindow, this.toggleWindow]) {
        if (w && !w.isDestroyed()) w.close();
      }
      this.pillWindow = null;
      this.toggleWindow = null;
    });

    this.pillWindow.on('move', () => {
      // Drag-managed (macOS and Windows): the pill's OS drag region is off and
      // it drives the group through moveOverlayGroupTo instead, so a user drag
      // never lands here — only our own setBounds calls do. Reverse-mirroring
      // those would move the overlay from a move we just made, which on macOS
      // double-moves the welded child (the "double-move feedback" the old
      // comment warned about) and on Windows fights the managed drag.
      if (this.overlayGroupDragManaged) return;
      if (this.auxSyncing) return;
      const pill = this.pillWindow;
      const overlay = this.overlayWindow;
      if (!pill || pill.isDestroyed() || !overlay || overlay.isDestroyed()) return;
      const p = pill.getBounds();
      const o = overlay.getBounds();
      // The overlay follows so the pill keeps its "centered, PILL_GAP above
      // the shell" relationship — from the user's hand the whole group moves.
      const targetX = Math.round(p.x + p.width / 2 - o.width / 2);
      const targetY = p.y + p.height + WindowHelper.PILL_GAP;
      // 1px tolerance: centering rounds (odd width deltas), so the forward and
      // reverse computations can disagree by 1px. Without the tolerance that
      // disagreement could ping-pong pill↔overlay into a slow positional
      // drift if a platform ever delivers our own programmatic move events
      // asynchronously (outside the auxSyncing guard window).
      if (Math.abs(targetX - o.x) <= 1 && Math.abs(targetY - o.y) <= 1) return;
      this.auxSyncing = true;
      try {
        overlay.setPosition(targetX, targetY);
        this.overlayBounds = overlay.getBounds();
        this.positionToggleWindow();
      } finally {
        this.auxSyncing = false;
      }
    });
  }

  // Place the pill (centered above the shell) and the toggle (outside the
  // shell's top-right corner) around the overlay's current bounds.
  private positionOverlayAuxWindows(): void {
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) return;
    const o = overlay.getBounds();
    const workArea = this.getDisplayWorkArea(o);
    const pill = this.pillWindow;
    if (pill && !pill.isDestroyed()) {
      const { width: pw, height: ph } = this.pillSize;
      // Clamp into the work area: the old single-window layout could never
      // lose the pill (it lived inside the OS-constrained window), but as a
      // separate window above the shell it would slide under the menu bar
      // when the user drags the shell to the top of the screen. Clamping
      // keeps the End-meeting/Show buttons reachable (the pill then overlaps
      // the shell's top edge instead of vanishing).
      // Do NOT clamp the pill independently while welded, or while a managed
      // group drag is in flight: displacing it relative to the shell is
      // precisely the "group came apart" artifact those modes remove. The same
      // constraint is enforced on the whole group instead — continuously by
      // AppKit when welded, and at drag release by
      // clampOverlayGroupIntoWorkArea(). Outside those cases (the legacy
      // mirroring path) the independent clamp still applies, since there the
      // pill genuinely can outlive the shell's work area.
      const rigidToShell = this.overlayGroupWelded || this.overlayGroupDragging;
      const idealX = Math.round(o.x + (o.width - pw) / 2);
      const idealY = o.y - WindowHelper.PILL_GAP - ph;
      const px = rigidToShell
        ? idealX
        : Math.min(Math.max(idealX, workArea.x), workArea.x + workArea.width - pw);
      const py = rigidToShell ? idealY : Math.max(idealY, workArea.y);
      this.auxSyncing = true;
      try {
        pill.setBounds({ x: px, y: py, width: pw, height: ph });
      } finally {
        this.auxSyncing = false;
      }
    }
    this.positionToggleWindow();
  }

  private positionToggleWindow(): void {
    const toggle = this.toggleWindow;
    const overlay = this.overlayWindow;
    if (!toggle || toggle.isDestroyed() || !overlay || overlay.isDestroyed()) return;
    const o = overlay.getBounds();
    const workArea = this.getDisplayWorkArea(o);
    const S = WindowHelper.TOGGLE_WINDOW_SIZE;
    const d = WindowHelper.TOGGLE_DIAGONAL_GAP;
    // Button CENTER = PANEL top-right corner + (d, -d): d px outside the
    // corner on the 45° bisector. The corner's x is the renderer-streamed
    // LIVE panel right edge (togglePanelRight — the panel is narrower than
    // the fixed window while collapsed and animates inside it), so the button
    // rides the corner through the whole width spring, exactly like the old
    // single-window MotionValue did. Clamped into the work area so the
    // button tucks inward instead of clipping off-screen when the shell sits
    // flush against a screen edge (the role RESIZE_BTN_EDGE_MARGIN played in
    // the single-window design).
    const x = Math.min(
      Math.max(Math.round(o.x + this.togglePanelRight + d - S / 2), workArea.x),
      workArea.x + workArea.width - S,
    );
    const y = Math.max(Math.round(o.y - d - S / 2), workArea.y);
    toggle.setBounds({ x, y, width: S, height: S });
  }

  // ── Welded-group geometry ────────────────────────────────────────────────
  // The group's true top edge is the PILL's top, not the shell's: the pill
  // sits PILL_GAP above the shell. Both operations below move only the SHELL
  // (the parent) — AppKit carries the pill and toggle along in the same
  // transaction, so the group never comes apart.

  // Where the shell may sit so that the whole group stays inside the work
  // area. Returns the clamped shell origin for a requested one.
  private clampedGroupOrigin(x: number, y: number): { x: number; y: number } {
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) return { x, y };
    const o = overlay.getBounds();
    const workArea = this.getDisplayWorkArea({ ...o, x, y });
    const pillH = this.pillSize.height;
    // Top: leave room for the pill above the shell, so the End-meeting and
    // Show buttons can never slide under the menu bar.
    const minY = workArea.y + WindowHelper.PILL_GAP + pillH;
    const maxY = workArea.y + workArea.height - o.height;
    // Horizontal: the shell is the widest member, so clamping it covers the
    // pill (narrower, centered). The toggle is allowed to overhang — it is
    // decorative chrome and already tucks inward via positionToggleWindow.
    const minX = workArea.x;
    const maxX = workArea.x + workArea.width - o.width;
    return {
      x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX))),
      y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY))),
    };
  }

  private clampOverlayGroupIntoWorkArea(): void {
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) return;
    const o = overlay.getBounds();
    const { x, y } = this.clampedGroupOrigin(o.x, o.y);
    if (x === o.x && y === o.y) return;
    this.auxSyncing = true;
    try {
      overlay.setPosition(x, y);
      this.overlayBounds = overlay.getBounds();
      this.positionToggleWindow();
    } finally {
      this.auxSyncing = false;
    }
  }

  // Pill renderer → main: drag the GROUP by a pointer delta.
  //
  // In welded mode the pill's `-webkit-app-region: drag` is disabled: a child
  // window dragged natively moves ALONE (AppKit propagates parent→child, never
  // child→parent), which would tear the group apart — the exact bug this mode
  // fixes. So the pill drags its PARENT instead, and the children ride along
  // for free. The trade is that a pill drag now costs a renderer→main hop, so
  // the whole group trails the cursor slightly; it can no longer come apart,
  // which is what "one entity" has to mean.
  // ANCHOR-BASED, not delta-based, and CLAMPED every frame. Both choices are
  // load-bearing and were arrived at by measurement:
  //
  //  • Anchoring (target = origin-at-drag-start + total pointer offset) is what
  //    makes per-frame clamping safe. With deltas, a clamped frame silently
  //    drops movement, so the window desyncs from the cursor and jumps when the
  //    pointer comes back — the rubber-band. With an anchor there is nothing to
  //    drop: the moment the pointer returns to a legal position the target is
  //    legal again, exactly in step with the hand.
  //  • Clamping every frame keeps BOTH windows inside the work area, which is
  //    what actually prevents the group from walking apart. macOS refuses to
  //    place a window fully off-screen, and the shell and pill hit that limit
  //    at different moments (different widths), so any scheme that lets them
  //    leave the screen accumulates a permanent offset — measured at ~295px
  //    over a long drag, with BOTH delta-offsetting and re-deriving. Never
  //    going off-screen is the only version that holds on a platform whose
  //    constraining behaviour we cannot test.
  //
  // Clamping continuously costs no reachable end state: endOverlayGroupDrag
  // already snapped the group fully into the work area on release, so this
  // only removes an illegal transient.
  public beginOverlayGroupDrag(): void {
    if (!this.overlayGroupDragManaged) return;
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed()) return;
    const o = overlay.getBounds();
    this.groupDragOrigin = { x: o.x, y: o.y };
    this.overlayGroupDragging = true;
  }

  public moveOverlayGroupTo(offsetX: number, offsetY: number): void {
    if (!this.overlayGroupDragManaged) return;
    const overlay = this.overlayWindow;
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    // A move without a start (renderer reloaded mid-drag) anchors here.
    if (!this.groupDragOrigin) this.beginOverlayGroupDrag();
    const origin = this.groupDragOrigin;
    if (!origin) return;
    const target = this.clampedGroupOrigin(origin.x + offsetX, origin.y + offsetY);
    const o = overlay.getBounds();
    if (target.x === o.x && target.y === o.y) return;
    this.overlayGroupDragging = true;
    this.auxSyncing = true;
    try {
      overlay.setPosition(target.x, target.y);
      const moved = overlay.getBounds();
      this.overlayBounds = moved;
      // WELDED (macOS): AppKit already carried the pill in the same
      // transaction — touching it here would DOUBLE the delta.
      // NOT WELDED (Windows): nothing carries it, so re-derive its position
      // from the shell's ACTUAL bounds every frame.
      //
      // Re-derive, do NOT accumulate deltas. Applying "the delta the shell just
      // moved" to the pill's own position looks equivalent and is not: if the
      // OS constrains either window (macOS pins a window being driven fully
      // off-screen; the two windows hit that limit at different moments
      // because they have different widths), a delta offset banks the error
      // permanently and the group walks apart — measured at 294px over a long
      // drag. Re-deriving makes every frame self-correcting: one constrained
      // frame is a transient, not a permanent offset.
      if (!this.overlayGroupWelded) this.positionOverlayAuxWindows();
      // The toggle is recomputed from the shell's bounds on both platforms:
      // its offset tracks the panel's live right edge (the width spring), so a
      // raw delta would freeze it mid-animation.
      this.positionToggleWindow();
    } finally {
      this.auxSyncing = false;
    }
    this.repositionOverlayPopovers();
  }

  public endOverlayGroupDrag(): void {
    if (!this.overlayGroupDragManaged) return;
    this.overlayGroupDragging = false;
    this.groupDragOrigin = null;
    this.clampOverlayGroupIntoWorkArea();
    // Settle point: re-place the children from the shell's final bounds, so a
    // drag that ran into a screen-edge constraint cannot leave the offsets
    // stale (see applyOverlayAuxVisibility for why this is needed and why it
    // cannot feed back into the parent).
    this.positionOverlayAuxWindows();
    this.repositionOverlayPopovers();
  }

  // Tells the pill renderer whether to run its own drag (and therefore switch
  // OFF its OS drag region). True on macOS (welded) and Windows (modal-loop
  // bypass); false only when a kill switch is set.
  public isOverlayGroupDragManaged(): boolean {
    return this.overlayGroupDragManaged;
  }

  public isOverlayGroupWelded(): boolean {
    return this.overlayGroupWelded;
  }

  // Drive the aux chrome's visibility directly. showInactive() always — the
  // aux chrome must never steal focus from the user's foreground app.
  //
  // Every show/hide call site calls this EXPLICITLY, in the same synchronous
  // block as the overlay's own show/hide, rather than relying on the overlay's
  // 'show'/'hide' events alone. Those events are the backstop (they still fire
  // for OS-driven and third-party visibility changes), but as the primary
  // mechanism they cost an extra step: switchToLauncher hides the overlay
  // AFTER showing the launcher, so an event-driven pill hide landed one hop
  // later still — leaving the always-on-top pill stranded on top of the
  // already-painted launcher ("the pill disappears after the launcher
  // appears"). Passing `want` explicitly also lets a caller hide the chrome
  // while the overlay is still visible, which the derived form cannot express.
  private applyOverlayAuxVisibility(want: boolean): void {
    if (want) this.positionOverlayAuxWindows();
    const apply = (win: BrowserWindow | null, show: boolean) => {
      if (!win || win.isDestroyed()) return;
      if (show && !win.isVisible()) win.showInactive();
      else if (!show && win.isVisible()) win.hide();
    };
    apply(this.pillWindow, want);
    apply(this.toggleWindow, want && this.toggleHasContent);
    // Re-assert exact geometry AFTER the show, not just before it.
    //
    // Measured: macOS constrains a window's frame back onto the screen when it
    // is ORDERED IN, for a position that was set while it was hidden. (A
    // VISIBLE window is not constrained — it can be moved far off-screen
    // freely, which is why a live drag does not drift.) The overlay is hidden
    // and re-shown constantly (Cmd+B, meeting start/end), and it can be parked
    // partly off-screen before a hide — so the shell can silently shift on
    // show while the children, being hidden, do not follow. That leaves the
    // welded offsets stale.
    //
    // Re-placing children from the parent's ACTUAL post-show bounds makes the
    // group self-correcting. Safe by construction: moving a child never moves
    // the parent and fires no parent 'move' event (measured), so this cannot
    // feed back.
    if (want) this.positionOverlayAuxWindows();
  }

  // Mirror overlay visibility onto the aux windows (derives `want` from the
  // overlay's live visibility — safe only when the overlay is not mid-swap).
  private syncOverlayAuxVisibility(): void {
    const overlay = this.overlayWindow;
    this.applyOverlayAuxVisibility(!!overlay && !overlay.isDestroyed() && overlay.isVisible());
  }

  // Pill renderer reports its w-fit content size (ResizeObserver → IPC).
  public setPillWindowSize(width: number, height: number): void {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (w === this.pillSize.width && h === this.pillSize.height) return;
    this.pillSize = { width: w, height: h };
    this.positionOverlayAuxWindows();
  }

  public getPillWindow(): BrowserWindow | null {
    return this.pillWindow;
  }

  public getToggleWindow(): BrowserWindow | null {
    return this.toggleWindow;
  }

  // Overlay renderer → aux windows: UI-state broadcast (expanded/shellWide/
  // theme/opacity/hasContent). Cached for aux (re)loads; hasContent also
  // gates the toggle window's visibility.
  public setOverlayUiState(state: { hasContent?: boolean } & Record<string, unknown>): void {
    this.lastOverlayUiState = state;
    this.toggleHasContent = !!state?.hasContent;
    for (const w of [this.pillWindow, this.toggleWindow]) {
      if (w && !w.isDestroyed()) w.webContents.send('overlay-ui-state', state);
    }
    this.syncOverlayAuxVisibility();
  }

  // Aux windows → overlay renderer: user actions (toggle-width, end-meeting,
  // toggle-expand).
  public forwardOverlayUiAction(action: unknown): void {
    const overlay = this.overlayWindow;
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('overlay-ui-action', action);
    }
  }

  // Show overlay directly without going through full switchToOverlay flow.
  // Used by IPC handlers to show the overlay independently.
  public showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    // Restore opacity in case it was zeroed by hideMainWindow() before a screenshot.
    this.overlayWindow.setOpacity(1);
    this.pillWindow?.setOpacity(1);
    this.toggleWindow?.setOpacity(1);

    // Re-assert z-order on Windows before showing — same DWM demotion risk as
    // switchToOverlay(). Must come before show()/showInactive() so the window
    // lands at the correct level on first paint (issue #136).
    if (process.platform === 'win32') {
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (this.appState.getOverlayMousePassthrough()) {
      // In passthrough/stealth mode: appear on screen without stealing OS focus.
      // The underlying app (Zoom, browser, etc.) must keep focus.
      this.overlayWindow.showInactive();
    } else {
      // Normal interactive mode: show and focus so the user can click/type.
      this.overlayWindow.showInactive();
      // Bring to front without a full app-activate (avoids dock bounce on macOS).
      // setAlwaysOnTop is already set at creation; a focus() call alone is safe.
      this.overlayWindow.focus();
    }
    // Explicit, same-block aux show — see switchToOverlay.
    this.applyOverlayAuxVisibility(true);
  }

  // Hide overlay directly without switching to launcher.
  // Used by IPC handlers to hide the overlay independently.
  public hideOverlay(): void {
    // Aux chrome first, in the same block: the pill/toggle are always-on-top,
    // so a body-then-pill sequence leaves them briefly floating alone.
    this.applyOverlayAuxVisibility(false);
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
  }

  // Settings > Interface Opacity: while the user holds the slider, the
  // renderer already hides every settings/launcher DOM layer (see
  // startPreviewingOpacity() in SettingsOverlay.tsx) so only the opacity
  // slider card and the mockup preview remain painted. That is not enough on
  // its own — the launcher BrowserWindow's macOS `vibrancy: 'under-window'`
  // paints an NSVisualEffectView material independent of any DOM content, so
  // the "empty" areas behind the hidden DOM still rendered as an opaque-ish
  // dark surface instead of the real desktop, defeating the point of a live
  // preview. `transparent` itself is a creation-time-only BrowserWindow
  // option (Electron cannot toggle it after construction), but vibrancy and
  // backgroundColor ARE mutable at runtime, so this flips only those two for
  // the duration of the hold.
  //
  // macOS-only: on Windows/Linux the launcher window is created with
  // `transparent: false` (see createWindow()), so there is no runtime call
  // that makes it see-through — the preview there stays boxed in the
  // window's opaque backgroundColor. Fixing that would require creating the
  // launcher as an always-transparent window, which the product wants only
  // for the in-meeting overlay, not the main dashboard.
  public setLauncherOpacityPreview(active: boolean): void {
    if (process.platform !== 'darwin') return;
    if (!this.launcherWindow || this.launcherWindow.isDestroyed()) return;
    // Only short-circuit the "start previewing" case when already previewing
    // — that branch is the one worth deduping (60fps drag ticks etc. never
    // call this, but a defensive dedupe costs nothing). The "stop
    // previewing" branch must NOT be gated the same way: its values are
    // exactly this window's construction defaults, so re-applying them is
    // always idempotent, and it's the only path that can resync a window
    // whose state disagrees with the flag (e.g. after the did-finish-load
    // resync below runs while the flag was stuck at `true` from a crash
    // mid-drag — see that handler's comment).
    if (active && this.launcherOpacityPreviewActive) return;

    if (active) {
      this.launcherWindow.setVibrancy(null);
      this.launcherWindow.setBackgroundColor('#00000000');
      // macOS renders a native drop shadow from the transparent window's own
      // painted alpha. With vibrancy off, the mockup preview's rgba surfaces
      // are exactly that painted alpha — so as the slider pushes opacity up,
      // the OS draws a soft shadow around the mockup that stacks on top of
      // the mockup's own CSS shadows/border. The real overlay window
      // (createWindow()'s overlaySettings) is `hasShadow: false` for this
      // same reason; the launcher only needs it off for the duration of
      // this preview, since normal launcher UI still wants its window shadow.
      this.launcherWindow.setHasShadow(false);
    } else {
      // Must match the values createWindow() applies at construction.
      this.launcherWindow.setVibrancy('under-window');
      this.launcherWindow.setBackgroundColor('#000000');
      this.launcherWindow.setHasShadow(true);
    }
    this.launcherOpacityPreviewActive = active;
  }

  public showMainWindow(inactive?: boolean): void {
    // Show the window corresponding to the current mode
    if (this.currentWindowMode === 'overlay') {
      this.switchToOverlay(inactive);
    } else {
      this.switchToLauncher(inactive);
    }
  }

  public toggleMainWindow(): void {
    if (this.isWindowVisible) {
      this.hideMainWindow();
    } else {
      // Always show without stealing focus — Natively is a ghost overlay.
      // The user is in another app; show the window on top but leave OS focus alone.
      // They can click the window to focus it if they need to type.
      this.showMainWindow(true);
    }
  }

  public toggleOverlayWindow(): void {
    this.toggleMainWindow();
  }

  public centerAndShowWindow(): void {
    // If a meeting is active (overlay mode), bring the overlay up instead of the
    // launcher — switching to the launcher during a meeting would expose it in the
    // taskbar/dock and break stealth.
    const stealthShow = this.appState.getUndetectable();
    if (this.currentWindowMode === 'overlay') {
      // In undetectable mode, show without stealing focus from the foreground app.
      this.switchToOverlay(stealthShow ? true : undefined);
    } else {
      this.switchToLauncher(stealthShow ? true : undefined);
      this.launcherWindow?.center();
    }
  }

  // --- Swapping Logic ---

  public switchToOverlay(inactive?: boolean): void {
    console.log(`[WindowHelper] Switching to OVERLAY (inactive: ${!!inactive})`);
    this.currentWindowMode = 'overlay';
    KeybindManager.getInstance().setMode('overlay'); // Adapted from public PR #123 — verify premium interaction

    // Show Overlay FIRST
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      const currentBounds = this.overlayWindow.getBounds();
      const savedBounds = this.overlayBounds
        ? {
            ...this.overlayBounds,
            height: Math.max(this.overlayBounds.height, WindowHelper.OVERLAY_MIN_HEIGHT),
          }
        : null;
      const workArea = this.getDisplayWorkArea(savedBounds ?? currentBounds);
      const maxAllowedWidth = Math.floor(workArea.width * 0.9);
      const maxAllowedHeight = Math.floor(workArea.height * 0.9);
      const targetBounds = savedBounds
        ? {
            x: Math.min(
              Math.max(savedBounds.x, workArea.x),
              workArea.x + workArea.width - Math.min(savedBounds.width, maxAllowedWidth),
            ),
            y: Math.min(
              Math.max(savedBounds.y, workArea.y),
              workArea.y + workArea.height - Math.min(savedBounds.height, maxAllowedHeight),
            ),
            width: Math.min(savedBounds.width, maxAllowedWidth),
            height: Math.min(savedBounds.height, maxAllowedHeight),
          }
        : {
            x: Math.floor(workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2),
            y: Math.floor(
              workArea.y +
                workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO +
                WindowHelper.PILL_STACK_OFFSET,
            ),
            width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
            height: Math.max(
              Math.min(currentBounds.height, maxAllowedHeight),
              WindowHelper.OVERLAY_MIN_HEIGHT,
            ),
          };

      this.overlayWindow.setBounds(targetBounds);
      this.overlayBounds = this.overlayWindow.getBounds();
      this.appState.recordNativeOomOutboundIpc(this.overlayWindow.webContents.id, 'ensure-expanded', []);
      this.overlayWindow.webContents.send('ensure-expanded');
      // `ensure-expanded` guarantees the overlay renderer comes up expanded,
      // but the PILL only learns that after a renderer→main→pill round trip,
      // and its collapse gate is a 0.22s opacity fade (OverlayAuxWindows).
      // The overlay window/renderer is reused across meetings, so a session
      // that ended collapsed (Cmd+B) leaves the pill's cached state at
      // expanded:false — it would then show at opacity 0 and fade in a quarter
      // second AFTER the body ("the pill appears at a different time than the
      // main body"). Pre-apply the same expansion to the cached state and push
      // it now, so the pill's first painted frame is already expanded.
      this.setOverlayUiState({
        ...((this.lastOverlayUiState as Record<string, unknown> | null) ?? {}),
        expanded: true,
      });

      // Restore opacity before showing (it may have been zeroed by hideMainWindow).
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Show at 0 opacity first to prevent frame leak.
        // The aux windows (pill/toggle) show via the overlay's 'show' event,
        // so shield them the same way — they carry the same on-screen chrome.
        this.overlayWindow.setOpacity(0);
        this.pillWindow?.setOpacity(0);
        this.toggleWindow?.setOpacity(0);
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        // Bring the aux chrome up in the SAME block as the body, while it is
        // still shielded at opacity 0 — the timer below un-shields all three
        // together. Showing it here rather than waiting for the overlay's
        // 'show' event keeps pill and body on one visual transition; doing it
        // after the timer would flash the pill through content protection.
        this.applyOverlayAuxVisibility(true);
        this.overlayWindow.setContentProtection(true);
        // Small delay to ensure Windows DWM processes the flag before making it opaque

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.setOpacity(1);
            this.pillWindow?.setOpacity(1);
            this.toggleWindow?.setOpacity(1);
            // Re-assert z-order on Windows — DWM can silently demote the HWND after hide/show
            this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
            if (!inactive) this.overlayWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
        this.overlayWindow.setOpacity(1);
        this.pillWindow?.setOpacity(1);
        this.toggleWindow?.setOpacity(1);
        this.overlayWindow.setContentProtection(this.contentProtection);
        // Re-assert z-order BEFORE show on Windows — DWM processes setAlwaysOnTop
        // synchronously, so calling it before show() ensures the window lands at the
        // correct z-level on first paint. Calling it after focus() would leave a brief
        // window where the HWND is focused at the wrong z-level (issue #136).
        // Skipped on macOS — calling setAlwaysOnTop triggers [NSApp activate] which
        // steals focus from Zoom/browser even when showInactive() was used.
        if (process.platform === 'win32') {
          this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        // Same synchronous block as the body's show (see the win32 branch) so
        // pill and shell land on one compositor commit instead of the body
        // first and the pill an event-hop later.
        this.applyOverlayAuxVisibility(true);
        // Only grab focus for explicit user-initiated shows (not shortcut/ghost shows)
        if (!inactive) this.overlayWindow.focus();
      }
      this.isWindowVisible = true;
    }

    // Hide Launcher SECOND
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.hide();
      this.lastLauncherShowInactive = null;
    }
  }

  public switchToLauncher(inactive?: boolean): void {
    const requestedInactive = !!inactive;
    console.log(`[WindowHelper] Switching to LAUNCHER (inactive: ${requestedInactive})`);
    const wasLauncher = this.currentWindowMode === 'launcher';
    this.currentWindowMode = 'launcher';
    KeybindManager.getInstance().setMode('launcher'); // Adapted from public PR #123 — verify premium interaction

    const launcherAlreadyVisible =
      !!this.launcherWindow &&
      !this.launcherWindow.isDestroyed() &&
      this.launcherWindow.isVisible() &&
      this.isWindowVisible;
    const overlayAlreadyHidden =
      !this.overlayWindow ||
      this.overlayWindow.isDestroyed() ||
      !this.overlayWindow.isVisible();

    // Cold-start can call switchToLauncher twice (launcher ready-to-show plus
    // startup convergence paths). If the launcher is already visible with the
    // same focus semantics and the overlay is already hidden, skip repeated
    // opacity/show/focus work so Chromium/WindowServer don't repaint mid-animation.
    if (
      wasLauncher &&
      launcherAlreadyVisible &&
      overlayAlreadyHidden &&
      this.lastLauncherShowInactive === requestedInactive
    ) {
      console.log('[WindowHelper] Launcher already visible; skipping duplicate show');
      return;
    }

    // Hide the overlay's floating chrome FIRST — before the launcher show.
    // The pill and toggle are always-on-top windows; the launcher is a regular
    // one, so any frame in which both are up paints the pill OVER the launcher.
    // Chaining their hide off the overlay's 'hide' event put them two steps
    // behind the launcher show (show launcher → hide overlay → 'hide' → hide
    // pill), which is exactly the reported "pill lingers after Stop drops us
    // on the launcher". Hiding them here does NOT open a no-window-visible gap
    // (which is what "Show Launcher FIRST" guards against): the overlay body
    // is still up until the "Hide Overlay SECOND" block below.
    this.applyOverlayAuxVisibility(false);

    // Show Launcher FIRST
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Show at 0 opacity first
        this.launcherWindow.setOpacity(0);
        if (inactive) this.launcherWindow.showInactive();
        else this.launcherWindow.show();
        this.launcherWindow.setContentProtection(true);

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
            this.launcherWindow.setOpacity(1);
            if (!inactive) this.launcherWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
        this.launcherWindow.setOpacity(1);
        this.launcherWindow.setContentProtection(this.contentProtection);
        if (inactive) this.launcherWindow.showInactive();
        else this.launcherWindow.show();
        if (!inactive) this.launcherWindow.focus();
      }
      this.lastLauncherShowInactive = requestedInactive;
      this.isWindowVisible = true;
    }

    // Hide Overlay SECOND
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }

    // ─── EXPLICITLY ACTIVATE THE APP ON OVERLAY→LAUNCHER SWAPS ─────────────
    // During a meeting Natively is NOT the active macOS app: the overlay is a
    // non-activating panel (type:'panel' + becomesKeyOnlyIfNeeded) so the
    // user's meeting app stays foreground. show()+focus() above cannot
    // reliably foreground us from that state — Focus() uses
    // activateIgnoringOtherApps:NO (never activates while another app is
    // active) and on macOS 14+ cooperative activation the system may deny
    // Show()'s self-activation from a background app. Hiding the always-on-top
    // overlay then removes our only visible surface, so Stop-meeting left the
    // regular-level launcher behind the meeting app ("app goes to background,
    // Cmd+B to recover"). app.focus with steal is the documented API for
    // making the app active. Gates: `!inactive` preserves ghost/showInactive
    // never-steal-focus invariants; `!wasLauncher` restricts to user-initiated
    // overlay→launcher swaps (cold-start ready-to-show has currentWindowMode
    // already 'launcher', so no focus-steal at launch); `!getUndetectable()`
    // because app activation re-reveals the dock tile and would fight the
    // _enforceDockState loop — the stealth path is handled by
    // reassertUndetectableStealth() below.
    if (
      process.platform === 'darwin' &&
      !inactive &&
      !wasLauncher &&
      !this.appState.getUndetectable()
    ) {
      app.focus({ steal: true });
    }

    // ─── RE-ASSERT STEALTH AFTER THE ACTIVATING SHOW ───────────────────────
    // The launcher is a REGULAR macOS window (no `type: 'panel'`, no
    // skipTaskbar). show()+focus() above re-activates the app as a foreground
    // app, which on macOS re-registers it and REVEALS the dock tile that
    // app.dock.hide() had suppressed — silently breaking undetectable mode.
    // This is the root cause of "the Natively icon appears in the dock after
    // Stop meeting" (endMeeting swaps overlay→launcher via this method). It is
    // intermittent because macOS coalesces/drops activation-policy changes.
    //
    // Fix it HERE — at the single choke point every launcher show funnels
    // through (Stop meeting, screenshot restore, cold-start convergence) — so no
    // caller can leak the tile. reassertUndetectableStealth() no-ops unless we
    // are on darwin AND currently undetectable, and drives the dock back to
    // hidden through the self-verifying _enforceDockState() loop (polls the OS
    // ground truth app.dock.isVisible() and retries until it sticks), so a
    // dropped or late dock op cannot defeat it. `inactive` shows (showInactive,
    // no focus) don't foreground the app, but we re-assert anyway: it's cheap,
    // idempotent, and guards against macOS revealing the tile on a bare show.
    if (process.platform === 'darwin' && this.appState.getUndetectable()) {
      this.appState.reassertUndetectableStealth();
    }
  }

  // Simplified setWindowMode that just calls switchers
  public setWindowMode(mode: 'launcher' | 'overlay', inactive?: boolean): void {
    if (mode === 'launcher') {
      this.switchToLauncher(inactive);
    } else {
      this.switchToOverlay(inactive);
    }
  }

  // --- Window Movement (Applies to Overlay mostly, but generalized to active) ---
  private moveActiveWindow(dx: number, dy: number): void {
    const win = this.getMainWindow();
    if (!win) return;

    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }

  public moveWindowRight(): void {
    this.moveActiveWindow(this.step, 0);
  }
  public moveWindowLeft(): void {
    this.moveActiveWindow(-this.step, 0);
  }
  public moveWindowDown(): void {
    this.moveActiveWindow(0, this.step);
  }
  public moveWindowUp(): void {
    this.moveActiveWindow(0, -this.step);
  }

  private showContextMenu(win: BrowserWindow, point: { x: number; y: number }): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Developer Console',
        click: () => {
          win.webContents.toggleDevTools();
        },
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win, x: point.x, y: point.y });
  }

  public minimizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    win.minimize();
  }

  public maximizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  public closeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    // On Windows/Linux the 'close' event listener intercepts this
    // and hides to tray unless the app is actually quitting.
    win.close();
  }
}
