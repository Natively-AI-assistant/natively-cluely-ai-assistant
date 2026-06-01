import { BrowserWindow, screen, app } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

import type { WindowHelper } from "./WindowHelper"

type WindowActivationOptions = {
    activate?: boolean
}

export class ModelSelectorWindowHelper {
    private window: BrowserWindow | null = null
    private contentProtection: boolean = false
    private opacityTimeout: NodeJS.Timeout | null = null;

    constructor() { }

    private windowHelper: WindowHelper | null = null;

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public getWindow(): BrowserWindow | null {
        return this.window
    }

    public preloadWindow(): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(-10000, -10000, false);
        }
    }

    public showWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        if (!this.window || this.window.isDestroyed()) {
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
            // Align with parent window behavior
            this.window.setVisibleOnAllWorkspaces(isOverlay, { visibleOnFullScreen: isOverlay });
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
        this.ensureVisibleOnScreen();

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
    }

    public hideWindow(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setParentWindow(null);
            this.window.hide();
            // Do NOT call mainWin.focus() here — the model selector is a floating dropdown.
            // Explicitly focusing the main window steals OS focus from whatever the user
            // had active (Zoom, browser, etc.) before opening the selector.
        }
    }

    public toggleWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        if (this.window && !this.window.isDestroyed()) {
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

    private createWindow(
        x?: number,
        y?: number,
        showWhenReady: boolean = true,
        showOptions: WindowActivationOptions = {},
    ): void {
        const isMac = process.platform === 'darwin';
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 140,
            height: 200,
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

        this.window = new BrowserWindow(windowSettings)

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
