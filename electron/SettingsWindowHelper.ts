import { BrowserWindow, screen, app } from "electron"
import { WindowHelper } from "./WindowHelper"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

type WindowActivationOptions = {
    activate?: boolean
}

export class SettingsWindowHelper {
    private settingsWindow: BrowserWindow | null = null
    private windowHelper: WindowHelper | null = null;
    private opacityTimeout: NodeJS.Timeout | null = null;

    public getSettingsWindow(): BrowserWindow | null {
        return this.settingsWindow
    }

    public setWindowDimensions(win: BrowserWindow, width: number, height: number): void {
        if (!win || win.isDestroyed() || !win.isVisible()) return

        const currentBounds = win.getBounds()
        // Only update if dimensions actually change (avoid infinite loops)
        if (currentBounds.width === width && currentBounds.height === height) return

        win.setSize(width, height)
    }

    // Store offsets relative to main window
    private offsetX: number = 0
    private offsetY: number = 0

    private lastBlurTime: number = 0
    private ignoreBlur: boolean = false;

    constructor() { }

    public setIgnoreBlur(ignore: boolean): void {
        this.ignoreBlur = ignore;
    }

    /**
     * Pre-create the settings window in the background (hidden) for faster first open
     */
    public preloadWindow(): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            // Create window off-screen so it's ready but not visible
            this.createWindow(-10000, -10000, false);
        }
    }

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public toggleWindow(x?: number, y?: number): void {
        const mainWindow = this.windowHelper?.getMainWindow() ?? null;
        if (mainWindow && !mainWindow.isDestroyed() && x !== undefined && y !== undefined) {
            const bounds = mainWindow.getBounds();
            this.offsetX = x - bounds.x;
            this.offsetY = y - (bounds.y + bounds.height);
        }

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            // Fix: If window was just closed by blur (e.g. clicking the toggle button), don't re-open immediately
            if (!this.settingsWindow.isVisible() && (Date.now() - this.lastBlurTime < 250)) {
                return;
            }

            if (this.settingsWindow.isVisible()) {
                this.closeWindow(); // Use closeWindow to handle focus restore
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public showWindow(x?: number, y?: number, options: WindowActivationOptions = {}): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        const activate = options.activate ?? true;

        // Set parent to ensure it stays on top of the correct window
        const mainWin = this.windowHelper?.getMainWindow();
        if (mainWin && !mainWin.isDestroyed()) {
            this.settingsWindow.setParentWindow(mainWin);
        }

        if (x !== undefined && y !== undefined) {
            this.settingsWindow.setPosition(Math.round(x), Math.round(y))
        }

        // Ensure fully visible on screen
        this.ensureVisibleOnScreen();

        if (process.platform === 'win32' && this.contentProtection) {
            this.settingsWindow.setOpacity(0);
            if (activate) this.settingsWindow.show(); else this.settingsWindow.showInactive();
            this.settingsWindow.setContentProtection(true);

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                    this.settingsWindow.setOpacity(1);
                    if (activate) this.settingsWindow.focus();
                }
            }, 60);
        } else {
            this.settingsWindow.setContentProtection(this.contentProtection);
            if (activate) this.settingsWindow.show(); else this.settingsWindow.showInactive();
            if (activate) this.settingsWindow.focus();
        }

        this.emitVisibilityChange(true);
    }

    public reposition(mainBounds: Electron.Rectangle): void {
        if (!this.settingsWindow || !this.settingsWindow.isVisible() || this.settingsWindow.isDestroyed()) return;

        const newX = mainBounds.x + this.offsetX;
        const newY = mainBounds.y + mainBounds.height + this.offsetY;

        this.settingsWindow.setPosition(Math.round(newX), Math.round(newY));
    }

    public closeWindow(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.hide()
            this.emitVisibilityChange(false);
        }
    }

    private emitVisibilityChange(isVisible: boolean): void {
        const mainWindow = this.windowHelper?.getMainWindow() ?? null;
        if (!mainWindow) {
            console.warn('[SettingsWindowHelper] settings-visibility-changed dropped — no main window bound yet.');
            return;
        }
        if (mainWindow.isDestroyed()) return;
        try {
            mainWindow.webContents.send('settings-visibility-changed', isVisible);
        } catch {
            // Renderer is tearing down; ignore.
        }
    }

    private createWindow(x?: number, y?: number, showWhenReady: boolean = true): void {
        const isMac = process.platform === 'darwin';
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 180, // Match React component width (SettingsPopup.tsx)
            height: 200, // Trimmed; ResizeObserver in renderer pins exact height
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
                backgroundThrottling: false // Keep window ready even when hidden
            },
            // ROUND 3 FIX: type: 'panel' is what makes this an NSPanel rather
            // than a regular NSWindow. WITHOUT it, the becomesKeyOnlyIfNeeded
            // and _setPreventsActivation: SPI calls in applyStealthToWindow
            // are no-ops (those are NSPanel-only properties — respondsToSelector
            // returns false on a plain NSWindow). The previous fix only added
            // applyStealthToWindow without the underlying panel type, which is
            // why focus theft persisted. NSPanel + type:'panel' = the same
            // Spotlight/Alfred mechanism the overlay uses.
            ...(isMac ? { type: 'panel' as const } : {}),
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.settingsWindow = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            this.settingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.settingsWindow.setHiddenInMissionControl(true)
            this.settingsWindow.setAlwaysOnTop(true, "floating")
        }

        console.log(`[SettingsWindowHelper] Creating Settings Window with Content Protection: ${this.contentProtection}`);
        this.settingsWindow.setContentProtection(this.contentProtection);

        // Load with query param
        const settingsUrl = isDev
            ? `${startUrl}?window=settings`
            : `${startUrl}?window=settings` // file url also works with search params in modern Electron

        this.settingsWindow.loadURL(settingsUrl).catch(e => {
            console.error('[SettingsWindowHelper] Failed to load URL:', e);
        });

        this.settingsWindow.once('ready-to-show', () => {
            // Apply NSPanel stealth attributes (becomesKeyOnlyIfNeeded +
            // _setPreventsActivation + sharingType=None + collectionBehavior)
            // BEFORE any show() so clicking the Settings button on the
            // Natively overlay doesn't activate the Natively app and dim
            // the user's foreground app (Zoom/browser/IDE) mid-meeting.
            // Without this, settings was a regular focusable window and
            // every interaction stole focus. Failure is non-fatal; logged.
            if (process.platform === 'darwin' && this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.settingsWindow.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[SettingsWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showWhenReady) {
                this.showWindow(this.settingsWindow?.getBounds().x || 0, this.settingsWindow?.getBounds().y || 0)
            }
        })

        // Hide on blur instead of close, to keep state?
        // Or just let user close it.
        // User asked for "independent window", maybe sticky?
        // Let's keep it simple: clicks outside close it if we want "popover" behavior.
        // For now, let it stay open until toggled or ESC.
        this.settingsWindow.on('blur', () => {
            if (this.ignoreBlur) return;
            this.lastBlurTime = Date.now();
            this.closeWindow();
        })

        // ROUND 3 FIX (#1): when Settings becomes visible, stop the
        // CGEventTap. Otherwise the tap intercepts every plain keystroke at
        // OS level and routes them into Natively's chat input — the user
        // can't type API keys (or anything) into Settings fields. Settings
        // input is a long-form interaction; stealth-typing-into-overlay is
        // not what the user wants here. They can re-engage with the hotkey
        // after Settings closes.
        this.settingsWindow.on('show', () => {
            // ROUND 4 FIX (#7): reset blur timestamp on every successful
            // show. Without this, a stale lastBlurTime from a prior session
            // (or from a brief NSPanel-nonactivating blur that did fire)
            // can keep the 250ms toggle-protection guard hot indefinitely,
            // suppressing legitimate user re-toggles. Resetting at show
            // time bounds the guard to "the LAST blur" rather than "any
            // blur ever observed."
            this.lastBlurTime = 0;

            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[SettingsWindowHelper] failed to stop stealth tap on show:', e);
            }
        });


    }



    private ensureVisibleOnScreen() {
        if (!this.settingsWindow) return;
        const { x, y, width, height } = this.settingsWindow.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }

        this.settingsWindow.setPosition(newX, newY);
    }
    private contentProtection: boolean = false; // Track state

    public setContentProtection(enable: boolean): void {
        // Dedupe: avoid redundant DWM affinity churn on Windows when the same
        // value is reapplied (settings IPC + show events + global toggles all
        // converge here). The first call still hits both the in-memory state
        // and the native window; later identical calls no-op.
        if (this.contentProtection === enable && this.settingsWindow && !this.settingsWindow.isDestroyed()) return;
        console.log(`[SettingsWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(enable);
        }
    }

    // Force-reapply the current content-protection state, bypassing the dedupe
    // guard above. Called after app.dock.hide()/show() flips the macOS
    // activation policy, which can reset the window's sharingType even though
    // our in-memory flag is unchanged.
    public reassertContentProtection(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(this.contentProtection);
        }
    }

    public syncActivationPolicy(): void {
        if (process.platform !== 'win32') return;
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) return;
        this.settingsWindow.setContentProtection(this.contentProtection);
        if (this.settingsWindow.isVisible()) {
            this.settingsWindow.setOpacity(1);
        }
    }
}
