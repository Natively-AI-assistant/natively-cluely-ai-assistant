import { BrowserWindow, screen } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(__dirname, "../dist/index.html")}`

export class SettingsWindowHelper {
    private settingsWindow: BrowserWindow | null = null

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

    public toggleWindow(x?: number, y?: number): void {
        const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== this.settingsWindow);
        if (mainWindow && x !== undefined && y !== undefined) {
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
                this.settingsWindow.hide()
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public showWindow(x?: number, y?: number): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        if (x !== undefined && y !== undefined) {
            this.settingsWindow.setPosition(Math.round(x), Math.round(y))
        }

        // Ensure fully visible on screen
        this.ensureVisibleOnScreen();
        this.settingsWindow.show()
        this.settingsWindow.focus()
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
        const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== this.settingsWindow);
        if (mainWindow) {
            mainWindow.webContents.send('settings-visibility-changed', isVisible);
        }
    }

    private createWindow(x?: number, y?: number, showWhenReady: boolean = true): void {
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 200, // Match React component width
            height: 238, // Increased to accommodate new Transcript toggle
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
            }
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

        this.settingsWindow.loadURL(settingsUrl)

        this.settingsWindow.once('ready-to-show', () => {
            if (showWhenReady) {
                this.settingsWindow?.show()
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
        console.log(`[SettingsWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(enable);
        }
    }
}
