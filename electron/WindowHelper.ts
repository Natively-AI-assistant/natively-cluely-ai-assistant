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
  // Track current window mode (persists even when overlay is hidden via Cmd+B)
  private currentWindowMode: 'launcher' | 'overlay' = 'launcher';

  private appState: AppState;
  private contentProtection: boolean = false;
  private opacityTimeout: NodeJS.Timeout | null = null;
  private lastLauncherShowInactive: boolean | null = null;

  // Constants
  // FIXED OVERLAY WINDOW WIDTH — the OS window is BORN at this width, SHOWN at
  // this width, and NEVER width-resized for the lifetime of the overlay. It
  // MUST equal the renderer's SHELL_WIDTH_EXPANDED (NativelyInterface.tsx).
  //
  // WHY FIXED (the third-and-final fix for the resize jump/flicker): the panel
  // animates 600↔780 purely in CSS, centered (mx-auto) inside this fixed 780
  // window. Because the OS window width never changes, its X origin never moves
  // — and the entire jump/flicker class of bugs was caused by a programmatic
  // width setBounds shifting X mid-animation while the renderer's repaint lagged
  // a frame behind (Chromium does not sync setBounds to renderer paint on
  // macOS). With a fixed width there is no width setBounds at all, so:
  //   • TopPill (centered in the fixed window) is pixel-stable.
  //   • No per-frame transparent-blur-window re-raster → zero flicker.
  // The startup-slide invariant still holds: window-created-width === shown-width
  // (both 780), so the first paint already sits at its final origin. When the
  // shell is collapsed (600 in a 780 window) the ~90px side margins are
  // transparent. The window is unconditionally interactive in non-stealth mode
  // (see syncOverlayInteractionPolicy) so the overlay can always be dragged
  // from the painted panel; the transparent margins remain dead-click zones
  // during collapsed mode — an acceptable cost for a draggable overlay.
  private static readonly OVERLAY_DEFAULT_WIDTH = 780;
  private static readonly OVERLAY_MIN_HEIGHT = 216;
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
    const windows = [this.launcherWindow, this.overlayWindow];
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

  // Variant of setOverlayDimensions that keeps the horizontal CENTER of the
  // window fixed across width changes. Used by code-expansion animations so
  // the shell (mx-auto centered) doesn't appear to jump sideways when the
  // window grows: window grows symmetrically (X shifts -widthDelta/2), and
  // mx-auto compensates by reducing margin equally — net visual movement = 0.
  public setOverlayDimensionsCentered(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth);
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight);
    traceOverlayResize('setOverlayDimensionsCentered:request', {
      requested: { width, height },
      currentBounds,
      currentContentSize,
      workArea,
      maxAllowed: { width: maxAllowedWidth, height: maxAllowedHeight },
      computed: { width: newWidth, height: newHeight },
      clampedHeight: newHeight !== height,
    });

    // Compute X so the content's horizontal center stays put across the resize.
    const widthDelta = newWidth - currentContentSize[0];
    const desiredX = currentBounds.x - Math.floor(widthDelta / 2);

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
      traceOverlayResize('setOverlayDimensionsCentered:noop', {
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
    traceOverlayResize('setOverlayDimensionsCentered:applied', {
      requested: { width, height },
      appliedBounds: this.overlayBounds,
      contentSizeAfter: this.overlayWindow.getContentSize(),
    });
  }

  // NOTE: the overlay window is a FIXED WIDTH (OVERLAY_DEFAULT_WIDTH = 780) for
  // its entire visible lifetime. The expand/contract animation is CSS-only in
  // the renderer (the panel tweens 600↔780 centered inside the fixed window).
  // The renderer therefore only ever reports `width: 780` to
  // setOverlayDimensionsCentered, so the width delta is always 0, X never moves,
  // and only HEIGHT ever changes (content/streaming growth). A height-only
  // setBounds is top-anchored and does not move X, so it cannot cause the
  // sideways jump. See NativelyInterface.startTransition (CSS-only) for the
  // renderer side of this contract.

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
              ? path.join(process.resourcesPath, 'icon.png')
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

    const launcherUrl = `${startUrl}?window=launcher${noOrchSuffix}`;

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
    const overlayDefaultY = Math.floor(
      workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO,
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
        this.launcherWindow?.webContents.send('window-maximized-changed', true);
      });
      this.launcherWindow.on('unmaximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', false);
      });
    }

    this.launcherWindow.on('closed', () => {
      this.launcherWindow = null;
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
    }
    this.launcherWindow?.hide();
    this.overlayWindow?.hide();
    this.lastLauncherShowInactive = null;
    this.isWindowVisible = false;
  }

  // Apply the click-through (mouse passthrough) policy on the overlay window.
  // The ONLY input is overlayMousePassthrough (master stealth toggle). When ON
  // the window is fully click-through (user is in another app / stealth mode);
  // otherwise it MUST be unconditionally interactive.
  //
  // Why no hover gate: setIgnoreMouseEvents(true) — with or without
  // `forward: true` — prevents the OS from engaging the Chromium
  // `app-region: drag` handler. A hover-gated system (renderer reports "pointer
  // is over the painted panel → flip to interactive") would deadlock drags: the
  // very first click on the drag handle, before any `mousemove` reports arrive,
  // would be passed through to the app beneath. The transparent side-margins
  // (~90px each side, collapsed shell inside a 780px window) remain dead-click
  // zones during collapsed mode — that is an acceptable cost for an overlay
  // that can actually be dragged.
  public syncOverlayInteractionPolicy(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const passthrough = this.appState.getOverlayMousePassthrough();

    if (passthrough) {
      // forward: true — pointer events are still delivered to the OS layer beneath.
      // NOTE: We intentionally do NOT call setFocusable(false) here.
      //
      // Rationale: setIgnoreMouseEvents() alone is sufficient for transparent
      // mouse behaviour.  Setting focusable=false when the overlay is the only
      // visible window makes macOS treat the app as having NO active windows.
      // In that state, macOS may stop delivering Carbon/IOKit global hotkey
      // events to the process — silently breaking every globalShortcut binding.
      // Keeping the window focusable costs nothing.
      this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log(`[WindowHelper] Overlay click-through ON (stealth passthrough=${passthrough})`);
    } else {
      this.overlayWindow.setIgnoreMouseEvents(false);
      // Restore full interactivity when capturing clicks.
      this.overlayWindow.setFocusable(true);
      console.log('[WindowHelper] Overlay click-through OFF (interactive)');
    }
  }

  // Show overlay directly without going through full switchToOverlay flow.
  // Used by IPC handlers to show the overlay independently.
  public showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    // Restore opacity in case it was zeroed by hideMainWindow() before a screenshot.
    this.overlayWindow.setOpacity(1);

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
  }

  // Hide overlay directly without switching to launcher.
  // Used by IPC handlers to hide the overlay independently.
  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
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
            y: Math.floor(workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO),
            width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
            height: Math.max(
              Math.min(currentBounds.height, maxAllowedHeight),
              WindowHelper.OVERLAY_MIN_HEIGHT,
            ),
          };

      this.overlayWindow.setBounds(targetBounds);
      this.overlayBounds = this.overlayWindow.getBounds();
      this.overlayWindow.webContents.send('ensure-expanded');

      // Restore opacity before showing (it may have been zeroed by hideMainWindow).
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Show at 0 opacity first to prevent frame leak
        this.overlayWindow.setOpacity(0);
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        this.overlayWindow.setContentProtection(true);
        // Small delay to ensure Windows DWM processes the flag before making it opaque

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.setOpacity(1);
            // Re-assert z-order on Windows — DWM can silently demote the HWND after hide/show
            this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
            if (!inactive) this.overlayWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
        this.overlayWindow.setOpacity(1);
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
