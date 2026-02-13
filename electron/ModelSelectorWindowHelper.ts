import { BrowserWindow, screen, app } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(__dirname, "../dist/index.html")}`

export class ModelSelectorWindowHelper {
    private window: BrowserWindow | null = null

    // Store offsets relative to main window if needed, but absolute positioning is simpler for dropdowns
    private lastBlurTime: number = 0
    private ignoreBlur: boolean = false;

    constructor() { }

    public getWindow(): BrowserWindow | null {
        return this.window
    }

    public preloadWindow(): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(-10000, -10000, false);
        }
    }

    public showWindow(x: number, y: number): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        // Standard dropdown positioning: top-left of window at (x, y)
        // Or centered if needed. For now, assume (x, y) is the bottom-left of the button.
        this.window.setPosition(Math.round(x), Math.round(y))

        this.ensureVisibleOnScreen();
        this.window.show()
        this.window.focus()
    }

    public hideWindow(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.hide()
        }
    }

    public toggleWindow(x: number, y: number): void {
        if (this.window && !this.window.isDestroyed()) {
            // Fix: If window was just closed by blur (e.g. clicking the toggle button), don't re-open immediately
            if (!this.window.isVisible() && (Date.now() - this.lastBlurTime < 250)) {
                return;
            }

            if (this.window.isVisible()) {
                this.window.hide()
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public closeWindow(): void {
        this.hideWindow();
    }

    private createWindow(x?: number, y?: number, showWhenReady: boolean = true): void {
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
            }
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.window = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.window.setHiddenInMissionControl(true)
            this.window.setAlwaysOnTop(true, "floating")
        }

        // Load with query param for routing
        const url = isDev
            ? `${startUrl}?window=model-selector`
            : `${startUrl}?window=model-selector`

        this.window.loadURL(url)

        this.window.once('ready-to-show', () => {
            if (showWhenReady) {
                this.window?.show()
            }
        })

        // Close on blur (click outside)
        this.window.on('blur', () => {
            if (this.ignoreBlur) return;
            this.lastBlurTime = Date.now();
            this.hideWindow();
        })
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
}
