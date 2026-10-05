import { BrowserWindow, screen, app } from "electron"
import path from "node:path"
import { attachNoActivate } from "./utils/windowsFocusPolicy"
import { setVisibleOnAllWorkspacesKeepingDock } from "./utils/macDockPolicy"
import { modelSelectorHeightBudget } from "./utils/modelSelectorHeightBudget"
import { allowRespawn, hasLiveRenderer, onRendererGone } from "./utils/rendererLiveness"

// Force production mode if running as packaged app — matches WindowHelper.ts's
// isDev predicate. A stray NODE_ENV=development in a packaged launch's
// environment must not point this window at a dev server that doesn't exist
// in a shipped build.
const isDev = process.env.NODE_ENV === "development" && !app.isPackaged

const startUrl = isDev
    ? DEV_SERVER_URL
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

import type { WindowHelper } from "./WindowHelper"
import { DEV_SERVER_URL } from './devServerUrl';

type WindowActivationOptions = {
    activate?: boolean
}

export class ModelSelectorWindowHelper {
    private window: BrowserWindow | null = null
    private contentProtection: boolean = false
    private opacityTimeout: NodeJS.Timeout | null = null;
    // Tallest the window may be where it now sits (see modelSelectorHeightBudget).
    private heightBudget: number = Number.POSITIVE_INFINITY;

    // Set once the app starts quitting: renderers going away then is the
    // teardown, and nothing must be rebuilt in its place.
    private quitting = false;

    constructor() {
        app.once('before-quit', () => { this.quitting = true })
    }

    private windowHelper: WindowHelper | null = null;

    // When opened from the MEETING OVERLAY: anchor stored relative to the
    // PANEL's left edge (the panel animates 600↔732 centered inside the
    // fixed overlay window) and the overlay's bottom edge, so the dropdown
    // follows drags, content-height growth, and the width spring. Driven by
    // WindowHelper.repositionOverlayPopovers().
    private overlayAnchor: { offsetXFromPanel: number; offsetY: number } | null = null;

    // When the window was last rebuilt after losing its renderer (allowRespawn).
    private respawnHistory: number[] = [];

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public getWindow(): BrowserWindow | null {
        return this.window
    }

    public preloadWindow(): void {
        if (!this.window || !hasLiveRenderer(this.window)) {
            this.createWindow(-10000, -10000, false);
        }
    }

    public showWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        // Not just isDestroyed(): a window whose renderer has died is still a
        // window, and showing it puts an empty rectangle on screen.
        if (!this.window || !hasLiveRenderer(this.window)) {
            this.createWindow(x, y, true, options)
            return
        }

        const activate = options.activate ?? true;

        // Set parent and align window settings
        const mainWin = this.windowHelper?.getMainWindow();
        const isOverlay = mainWin === this.windowHelper?.getOverlayWindow();

        if (mainWin && !mainWin.isDestroyed()) {
            this.window.setParentWindow(mainWin);
        }

        if (process.platform === "darwin") {
            // Align with parent window behavior. Runs on EVERY open, so the raw
            // API would hide the Dock tile on each overlay open and show it on
            // each launcher open — even in undetectable mode (utils/macDockPolicy.ts).
            setVisibleOnAllWorkspacesKeepingDock(this.window, isOverlay, isOverlay);
            // Only set alwaysOnTop if the value is actually changing — calling it unnecessarily
            // triggers NSApp activation on macOS, stealing focus from other apps.
            const currentAlwaysOnTop = this.window.isAlwaysOnTop();
            if (currentAlwaysOnTop !== isOverlay) {
                this.window.setAlwaysOnTop(isOverlay, "floating");
            }
            // Always hide from MC as it's a dropdown
            this.window.setHiddenInMissionControl(true);
        }

        // Standard dropdown positioning
        this.window.setPosition(Math.round(x), Math.round(y))
        // Budget BEFORE the on-screen clamp: a window already capped to the
        // room under it has nothing left for ensureVisibleOnScreen to push up.
        this.applyHeightBudget();
        this.ensureVisibleOnScreen();

        // Overlay-anchored open: remember the panel-relative offset (see field
        // comment). The click-outside catcher is armed further down, once the
        // window is on screen.
        if (isOverlay && mainWin && !mainWin.isDestroyed()) {
            const bounds = mainWin.getBounds();
            const margin = this.windowHelper?.getOverlayPanelLeftMargin?.() ?? 0;
            this.overlayAnchor = {
                offsetXFromPanel: x - bounds.x - margin,
                offsetY: y - (bounds.y + bounds.height),
            };
        } else {
            this.overlayAnchor = null;
        }

        if (process.platform === 'win32' && this.contentProtection) {
            this.window.setOpacity(0);
            if (activate) this.window.show(); else this.window.showInactive();
            this.window.setContentProtection(true);

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.setOpacity(1);
                    if (activate) this.window.focus();
                }
            }, 60);
        } else {
            this.window.setContentProtection(this.contentProtection);
            if (activate) this.window.show(); else this.window.showInactive();
            if (activate) this.window.focus();
        }
        // Arm the click-outside catcher AFTER the show, as the settings
        // dropdown does. The catcher re-raises Natively's visible windows
        // above itself (it has no window level to rely on outside macOS);
        // armed before the show, it skipped this window, and a click on a
        // model row could land on the catcher and only close the list.
        this.windowHelper?.notifyOverlayPopover?.('model', this.overlayAnchor !== null);
        // The window is reused, so the renderer never remounts: this is its
        // only cue to replay the open animation and scroll to the checked row.
        this.window.webContents.send('model-selector:shown');
    }

    // The renderer reports its panel size (update-content-dimensions) so the
    // window hugs it. Applied while hidden too: the list is loaded in the
    // pre-warmed offscreen window, and the first open must already be sized.
    // Only a visible window is pulled back onto the screen; the offscreen
    // pre-warm position must stay offscreen.
    public setContentSize(width: number, height: number): void {
        if (!this.window || this.window.isDestroyed()) return;
        const w = Math.round(Math.min(Math.max(width, 120), 480));
        const h = Math.round(Math.min(Math.max(height, 40), 560, this.heightBudget));
        // A panel taller than its budget has not heard the budget: it was sent
        // before the page was listening (a window shown as soon as it was
        // built). Say it again, or the window is trimmed and the list is not.
        if (height > this.heightBudget) {
            this.window.webContents.send('model-selector:height-budget', this.heightBudget);
        }
        const current = this.window.getBounds();
        if (current.width === w && current.height === h) return;
        this.window.setSize(w, h);
        if (this.window.isVisible()) this.ensureVisibleOnScreen();
    }

    // Measures the room under the window's current top edge, tells the
    // renderer (which shortens its list to fit) and trims the window now so
    // there is no frame where it overhangs the screen bottom.
    private applyHeightBudget(): void {
        if (!this.window || this.window.isDestroyed()) return;
        const { x, y, width, height } = this.window.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const budget = modelSelectorHeightBudget(display.workArea, y);
        if (budget !== this.heightBudget) {
            this.heightBudget = budget;
            this.window.webContents.send('model-selector:height-budget', budget);
        }
        if (height > budget) this.window.setSize(width, budget);
    }

    public hideWindow(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setParentWindow(null);
            this.window.hide();
            // Do NOT call mainWin.focus() here — the model selector is a floating dropdown.
            // Explicitly focusing the main window steals OS focus from whatever the user
            // had active (Zoom, browser, etc.) before opening the selector.
        }
        this.windowHelper?.notifyOverlayPopover?.('model', false);
    }

    // Overlay-anchored variant of positioning: x tracks the PANEL's left edge
    // (overlay.x + live margin), y tracks the overlay's bottom edge.
    public repositionForOverlay(overlayBounds: Electron.Rectangle, panelLeftMargin: number): void {
        if (!this.overlayAnchor) return;
        if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
        this.window.setPosition(
            Math.round(overlayBounds.x + panelLeftMargin + this.overlayAnchor.offsetXFromPanel),
            Math.round(overlayBounds.y + overlayBounds.height + this.overlayAnchor.offsetY),
        );
        // The overlay grew or moved: the room under the dropdown changed with it.
        this.applyHeightBudget();
    }

    public toggleWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        if (this.window && hasLiveRenderer(this.window)) {
            if (this.window.isVisible()) {
                this.hideWindow()
            } else {
                this.showWindow(x, y, options)
            }
        } else {
            this.createWindow(x, y, true, options)
        }
    }

    public closeWindow(): void {
        this.hideWindow();
    }

    // The picker's renderer is gone. Nothing reloads it (main.ts leaves this
    // window alone), so drop the window now and build its replacement the way
    // startup does: hidden, offscreen, list loaded. The next open is then the
    // same warm open as any other, instead of this empty window.
    private discardDeadWindow(win: BrowserWindow): void {
        if (this.window !== win) return;
        this.disposeWindow(win);
        // Never while quitting. Bounded: a renderer that dies on every start
        // is built on the next open instead of in a loop.
        if (!this.quitting && allowRespawn(this.respawnHistory, Date.now())) this.preloadWindow();
    }

    // Tears the window down and forgets it. Builds nothing.
    private disposeWindow(win: BrowserWindow): void {
        if (this.window === win) this.window = null;
        this.overlayAnchor = null;
        // The next window's renderer has not been told its budget.
        this.heightBudget = Number.POSITIVE_INFINITY;
        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = null;
        // Without this the full-display click catcher stays up behind a picker
        // that no longer exists, and swallows the next click anywhere.
        this.windowHelper?.notifyOverlayPopover?.('model', false);
        if (win.isDestroyed()) return;
        // Detach first, as hideWindow does: closing a window that is still
        // attached to the overlay can hand the overlay focus mid-meeting.
        try { win.setParentWindow(null) } catch { /* already detached */ }
        win.destroy();
    }

    private createWindow(
        x?: number,
        y?: number,
        showWhenReady: boolean = true,
        showOptions: WindowActivationOptions = {},
    ): void {
        const isMac = process.platform === 'darwin';
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            // Starting size only; the renderer reports the panel's real size
            // (setContentSize) as soon as it lays out.
            // Matches MODEL_SELECTOR_WIDTH in src/components/ui/modelSelectorLabelText.ts.
            width: 141,
            height: 240,
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js"),
                backgroundThrottling: false
            },
            // ROUND 3 FIX: type:'panel' makes this an NSPanel rather than a
            // regular NSWindow. Required for becomesKeyOnlyIfNeeded and
            // _setPreventsActivation: SPI calls in applyStealthToWindow to
            // actually take effect (those are NSPanel-only properties).
            // Without this, the previous applyStealthToWindow call was a
            // no-op and clicking the model selector still stole focus from
            // the user's foreground app.
            //
            // Close-on-outside is handled by the renderer's mousedown
            // capture handler (NativelyInterface.tsx) dispatching the
            // `model-selector:close-if-open` IPC, guarded against the
            // toggle button via `data-model-selector-toggle`.
            ...(isMac ? { type: 'panel' as const } : {}),
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        // A window left over with a dead renderer (the liveness check sent us
        // here before its render-process-gone callback ran) must not be leaked.
        if (this.window) this.disposeWindow(this.window)

        const win = new BrowserWindow(windowSettings)
        this.window = win
        onRendererGone(win, () => this.discardDeadWindow(win))
        // Windows counterpart of the NSPanel stealth attributes applied below
        // on macOS: WS_EX_NOACTIVATE so clicking the model selector mid-meeting
        // never steals foreground focus from the meeting app. Dismissal is the
        // overlay popover click-catcher (blur-close is intentionally not wired
        // here). No-op on macOS/Linux.
        attachNoActivate(this.window)

        if (process.platform === "darwin") {
            // Initial defaults - will be updated in showWindow
            this.window.setHiddenInMissionControl(true)
        }

        // Apply content protection for Undetectable Mode
        console.log(`[ModelSelectorWindowHelper] Creating window with Content Protection: ${this.contentProtection}`);
        this.window.setContentProtection(this.contentProtection)

        // Load with query param for routing
        const url = isDev
            ? `${startUrl}?window=model-selector`
            : `${startUrl}?window=model-selector`

        this.window.loadURL(url).catch(e => {
            console.error('[ModelSelectorWindowHelper] Failed to load URL:', e);
        });

        this.window.once('ready-to-show', () => {
            // Apply NSPanel stealth attributes BEFORE any show() so clicking
            // the model selector on the Natively overlay doesn't activate
            // Natively and dim the user's foreground app (Zoom/browser) mid
            // meeting. Without this, model-switch was a regular focusable
            // window and every interaction stole focus. Failure non-fatal.
            //
            // NOTE: model selector also uses `on('blur')` to auto-close
            // (line below). With panel-nonactivating + becomesKeyOnlyIfNeeded,
            // blur semantics are subtle — the window may not become key on
            // click and therefore never receives blur. If that proves
            // problematic, the close-on-blur handler should switch to a
            // click-outside listener registered on the parent overlay.
            if (process.platform === 'darwin' && this.window && !this.window.isDestroyed()) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.window.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[ModelSelectorWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showWhenReady) {
                this.showWindow(
                    this.window?.getBounds().x || 0,
                    this.window?.getBounds().y || 0,
                    showOptions,
                )
            }
        })

        // Close-on-blur is intentionally NOT wired up here. A per-window
        // blur listener fires on intra-app focus transfers (overlay ↔ panel),
        // which races with the toggle button's open path and produced the
        // historical "first click does nothing, second click opens" bug.
        // Three orthogonal close paths cover the legitimate cases instead:
        //   • renderer mousedown capture handler in NativelyInterface.tsx
        //     dispatches `model-selector:close-if-open` for overlay-internal
        //     outside clicks (guarded by data-model-selector-toggle).
        //   • main.ts subscribes to app.on('did-resign-active') (macOS) /
        //     'browser-window-blur' + getFocusedWindow()===null (win/linux)
        //     to auto-close when the user clicks any other application.
        //   • clicking a model in the list explicitly hides the panel via
        //     the set-active-model IPC.

        // ROUND 3 FIX (#1): stop the stealth tap when Model Selector shows,
        // mirroring the Settings handler. While brief (model selector is a
        // dropdown), interaction with the dropdown still requires keystrokes
        // to reach this window's React tree, which the tap would otherwise
        // intercept at OS level.
        this.window.on('show', () => {
            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[ModelSelectorWindowHelper] failed to stop stealth tap on show:', e);
            }
        });
    }

    private ensureVisibleOnScreen() {
        if (!this.window) return;
        const { x, y, width, height } = this.window.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        // Keep within horizontal bounds
        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (x < bounds.x) {
            newX = bounds.x;
        }

        // Keep within vertical bounds
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }
        if (y < bounds.y) {
            newY = bounds.y;
        }

        this.window.setPosition(newX, newY);
    }

    public setContentProtection(enable: boolean): void {
        // Dedupe: see WindowHelper.setContentProtection rationale — repeated
        // identical calls are common (toggle IPC fans out across helpers) and
        // produce DWM affinity churn on Windows.
        if (this.contentProtection === enable && this.window && !this.window.isDestroyed()) return;
        console.log(`[ModelSelectorWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;
        if (this.window && !this.window.isDestroyed()) {
            this.window.setContentProtection(enable);
        }
    }

    // Force-reapply the current content-protection state, bypassing the dedupe
    // guard above. Called after app.dock.hide()/show() flips the macOS
    // activation policy, which can reset the window's sharingType even though
    // our in-memory flag is unchanged.
    public reassertContentProtection(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setContentProtection(this.contentProtection);
        }
    }

    public syncActivationPolicy(): void {
        if (process.platform !== 'win32') return;
        if (!this.window || this.window.isDestroyed()) return;
        this.window.setContentProtection(this.contentProtection);
        if (this.window.isVisible()) {
            this.window.setOpacity(1);
        }
    }
}
