import { BrowserWindow, screen, app, ipcMain, IpcMainEvent } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

/**
 * CropperWindowHelper configuration constants.
 * These values can be overridden via environment variables for testing/debugging.
 */
const CROPPER_CONFIG = {
    /** Minimum selection size in pixels (protection against accidental clicks) */
    MIN_SELECTION_SIZE: parseInt(process.env.CROPPER_MIN_SELECTION_SIZE || '5', 10),

    /** Delay in ms before setting opacity to 1 (Windows opacity shield) */
    OPACITY_DELAY_MS: parseInt(process.env.CROPPER_OPACITY_DELAY || '60', 10),

    /** Window type for the cropper window */
    WINDOW_TYPE: 'toolbar' as const,

    /** Maximum retries for loading cropper URL */
    MAX_LOAD_RETRIES: 3,

    /** Delay between load retries in ms */
    LOAD_RETRY_DELAY_MS: 1000,
}

/**
 * Type guard to validate IPC message data as Electron.Rectangle
 */
function isRectangle(obj: unknown): obj is Electron.Rectangle {
    return typeof obj === 'object' && 
           obj !== null && 
           'x' in obj && 
           'y' in obj && 
           'width' in obj && 
           'height' in obj;
}

/**
 * Calculates the combined bounding box of all displays.
 * This represents the entire virtual screen across all monitors.
 * 
 * @returns Rectangle covering all displays with x/y possibly negative
 *          (e.g., if secondary monitor is to the left of primary)
 */
function getCombinedDisplayBounds(): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    
    if (displays.length === 0) {
        // Fallback to primary if no displays found
        const primary = screen.getPrimaryDisplay();
        return primary.bounds;
    }
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const display of displays) {
        const { x, y, width, height } = display.bounds;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    }
    
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

/**
 * CropperWindowHelper manages the life cycle of the area-selection window.
 *
 * DESIGN STRATEGY:
 * 1. Preload & Reuse (Windows): To ensure instant activation, the window is created once
 *    at startup and toggled via show/hide.
 * 2. Opacity Shield (Windows): Due to DWM (Desktop Window Manager) behavior, content
 *    protection must be applied while the window is invisible (opacity 0) to prevent
 *    frame leakage during screen capture.
 */
export class CropperWindowHelper {
    private cropperWindow: BrowserWindow | null = null
    private opacityTimeout: NodeJS.Timeout | null = null;
    private selectionTimeout: NodeJS.Timeout | null = null;
    private resolvePromise: ((value: Electron.Rectangle | null) => void) | null = null;
    private isUndetectable: boolean = false;
    private isWaitingForSelection: boolean = false;
    private isDisposed: boolean = false;

    // IPC listener references for cleanup
    private readonly confirmedListener: (event: IpcMainEvent, bounds: unknown) => void;
    private readonly cancelledListener: (event: IpcMainEvent) => void;
    private beforeQuitHandler: (() => void) | null = null;

    constructor() {
        // Define IPC listeners as instance methods for proper cleanup
        this.confirmedListener = (event, bounds: unknown) => {
            // Type guard: validate incoming data from renderer process
            if (!isRectangle(bounds)) {
                console.error('[CropperWindowHelper] Invalid bounds type received:', typeof bounds);
                this.rejectCurrentSelection(null);
                this.hideOrClose();
                return;
            }

            // Validate input data for security
            if (!this.validateBounds(bounds)) {
                console.error('[CropperWindowHelper] Invalid bounds received:', bounds);
                this.rejectCurrentSelection(null);
                this.hideOrClose();
                return;
            }

            this.resolveCurrentSelection(bounds);
            this.hideOrClose();
        };

        this.cancelledListener = () => {
            this.rejectCurrentSelection(null);
            this.hideOrClose();
        };

        // Setup IPC listeners for cropper actions
        ipcMain.on('cropper-confirmed', this.confirmedListener);
        ipcMain.on('cropper-cancelled', this.cancelledListener);

        // Fallback cleanup: if app quits before dispose() is called, clean up IPC listeners
        // Store reference so we can remove it if dispose() is called first
        this.beforeQuitHandler = () => {
            if (!this.isDisposed) {
                console.log('[CropperWindowHelper] before-quit: auto-disposing IPC listeners');
                ipcMain.removeListener('cropper-confirmed', this.confirmedListener);
                ipcMain.removeListener('cropper-cancelled', this.cancelledListener);
            }
        };
        app.on('before-quit', this.beforeQuitHandler);
    }

    /**
     * Validates the selection area bounds.
     * Checks that bounds are within screen limits and have valid dimensions.
     * Uses early exit optimization for better performance.
     */
    private validateBounds(bounds: Electron.Rectangle): boolean {
        // Check for NaN or Infinity first (fastest checks)
        if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) ||
            !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
            console.warn('[CropperWindowHelper] Invalid bounds: contains NaN or Infinity');
            return false;
        }

        // Round to integers for pixel coordinates
        const x = Math.round(bounds.x);
        const y = Math.round(bounds.y);
        const width = Math.round(bounds.width);
        const height = Math.round(bounds.height);

        // Check for negative coordinates RELATIVE TO THE COMBINED VIEWPORT.
        // Coords can be negative if a monitor is positioned to the left/above the primary.
        // We check against combinedBounds below (out-of-bounds check), not against 0.
        // Check for zero or negative dimensions
        if (width <= 0 || height <= 0) {
            console.warn('[CropperWindowHelper] Invalid bounds: zero or negative dimensions', { width, height });
            return false;
        }

        // Check for minimum size (protection against accidental clicks)
        if (width < CROPPER_CONFIG.MIN_SELECTION_SIZE || height < CROPPER_CONFIG.MIN_SELECTION_SIZE) {
            console.warn('[CropperWindowHelper] Selection too small', { width, height, minSize: CROPPER_CONFIG.MIN_SELECTION_SIZE });
            return false;
        }

        // Check for out of bounds (beyond combined multi-monitor viewport)
        const combinedBounds = getCombinedDisplayBounds();
        const combinedRight = combinedBounds.x + combinedBounds.width;
        const combinedBottom = combinedBounds.y + combinedBounds.height;
        
        // Also check that at least part of selection is on a visible display
        const selectionRight = x + width;
        const selectionBottom = y + height;
        
        if (x < combinedBounds.x || y < combinedBounds.y || 
            selectionRight > combinedRight || selectionBottom > combinedBottom) {
            console.warn('[CropperWindowHelper] Bounds exceed combined multi-monitor viewport', { 
                selection: { x, y, width, height },
                combinedViewport: combinedBounds
            });
            return false;
        }

        // NOTE: We intentionally do NOT check that selection is visible on a display.
        // This allows selection to span across monitors with different heights.
        // The smaller monitor's area in the selection will just have empty/black space.

        console.log(`[CropperWindowHelper] validateBounds PASSED: x=${x}, y=${y}, w=${width}, h=${height}`);
        return true;
    }

    /**
     * Resolves the current selection promise with the given bounds.
     * Resets the selection state.
     * Protection against multiple resolve/reject calls.
     */
    private resolveCurrentSelection(bounds: Electron.Rectangle | null): void {
        if (!this.isWaitingForSelection) {
            console.warn('[CropperWindowHelper] resolveCurrentSelection called but not waiting for selection');
            return;
        }
        if (this.resolvePromise) {
            this.resolvePromise(bounds);
            this.resolvePromise = null;
        }
        this.isWaitingForSelection = false;
    }

    /**
     * Rejects the current selection promise with null.
     * Resets the selection state.
     * Protection against multiple resolve/reject calls.
     */
    private rejectCurrentSelection(reason?: unknown): void {
        if (!this.isWaitingForSelection) {
            console.warn('[CropperWindowHelper] rejectCurrentSelection called but not waiting for selection');
            return;
        }
        if (this.resolvePromise) {
            if (reason) {
                console.warn('[CropperWindowHelper] Rejected:', reason);
            }
            this.resolvePromise(null);
            this.resolvePromise = null;
        }
        this.isWaitingForSelection = false;
    }

    /**
     * Updates the content protection state.
     * When enabled, the cropper UI becomes invisible to screen sharing/recording.
     */
    public setContentProtection(enable: boolean): void {
        this.isUndetectable = enable;
        if (this.cropperWindow && !this.cropperWindow.isDestroyed()) {
            this.cropperWindow.setContentProtection(enable);
        }
    }

    // Force-reapply the current content-protection state. Called after
    // app.dock.hide()/show() flips the macOS activation policy, which can reset
    // the window's sharingType even though our in-memory flag is unchanged.
    public reassertContentProtection(): void {
        if (this.cropperWindow && !this.cropperWindow.isDestroyed()) {
            this.cropperWindow.setContentProtection(this.isUndetectable);
        }
    }

    /**
     * Pre-creates the window in hidden state to eliminate cold-start delay.
     * Recommended to call this during AppState initialization on Windows.
     */
    public preload(): void {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] Cannot preload: instance has been disposed');
            return;
        }
        if (!this.cropperWindow || this.cropperWindow.isDestroyed()) {
            this.createWindow(false);
        }
    }

    /**
     * Shows the cropper and returns a promise that resolves with selection bounds
     * or null if cancelled (ESC/click away).
     *
     * @param timeout - Timeout in milliseconds (default: 30000ms)
     * @throws Error if another selection is already in progress
     */
    public async showCropper(timeout = 30000): Promise<Electron.Rectangle | null> {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] Cannot show cropper: instance has been disposed');
            return null;
        }

        // Prevent race condition: only one selection at a time
        if (this.isWaitingForSelection) {
            throw new Error('Another selection is already in progress');
        }

        this.isWaitingForSelection = true;

        return new Promise((resolve, reject) => {
            // Set up selection timeout
            this.selectionTimeout = setTimeout(() => {
                this.selectionTimeout = null;
                this.rejectCurrentSelection(new Error('Selection timeout'));
                this.hideOrClose();
                reject(new Error('Cropper selection timeout'));
            }, timeout);

            this.resolvePromise = (bounds) => {
                if (this.selectionTimeout) {
                    clearTimeout(this.selectionTimeout);
                    this.selectionTimeout = null;
                }
                resolve(bounds);
            };

            if (this.cropperWindow && !this.cropperWindow.isDestroyed()) {
                // Get cursor position and display info at the moment cropper is shown
                const cursorPosition = screen.getCursorScreenPoint();
                const displays = screen.getAllDisplays();
                
                // Find which display contains the cursor
                let targetDisplay: Electron.Display | null = null;
                for (const display of displays) {
                    const { x, y, width, height } = display.bounds;
                    if (cursorPosition.x >= x && cursorPosition.x < x + width &&
                        cursorPosition.y >= y && cursorPosition.y < y + height) {
                        targetDisplay = display;
                        break;
                    }
                }
                
                // Calculate HUD position: center top of the display where cursor was
                const hudPosition = targetDisplay ? {
                    x: targetDisplay.bounds.x + Math.round(targetDisplay.bounds.width / 2),
                    y: targetDisplay.bounds.y + 32
                } : {
                    x: cursorPosition.x,
                    y: cursorPosition.y
                };
                
                console.log(`[CropperWindowHelper] Cursor at ${JSON.stringify(cursorPosition)}, display bounds: ${targetDisplay ? JSON.stringify(targetDisplay.bounds) : 'unknown'}`);
                console.log(`[CropperWindowHelper] HUD position: ${JSON.stringify(hudPosition)}`);
                
                // Send reset with HUD position
                this.cropperWindow.webContents.send('reset-cropper', { hudPosition });
                this.applyOpacityShield();
            } else {
                // Window doesn't exist yet — createWindow will call applyOpacityShield
                // via ready-to-show once the URL finishes loading.
                this.createWindow(true);
            }
        });
    }

    /**
     * Windows-specific "Opacity Shield" sequence:
     *
     * WHY: If setContentProtection(true) is applied before the window is fully "ready"
     * and shown in the DWM, Windows may ignore the flag.
     *
     * HOW:
     * 1. Set opacity to 0 (invisible to eye, but "active" for DWM)
     * 2. Show window
     * 3. Apply protection flag
     * 4. Delay to let DWM process the flag
     * 5. Set opacity to 1
     */
    private applyOpacityShield(): void {
        if (!this.cropperWindow || this.isDisposed) return;

        if (process.platform === 'win32') {
            this.cropperWindow.setOpacity(0);
            this.cropperWindow.show();
            this.cropperWindow.setContentProtection(this.isUndetectable);

            // NOTE: Do NOT call maximize() - it limits to current monitor on Windows
            // The window already has correct bounds from createWindow()

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.cropperWindow && !this.cropperWindow.isDestroyed() && !this.isDisposed) {
                    this.cropperWindow.setOpacity(1);
                    this.cropperWindow.focus();
                }
            }, CROPPER_CONFIG.OPACITY_DELAY_MS);
        } else {
            this.cropperWindow.setContentProtection(this.isUndetectable);
            this.cropperWindow.show();
            this.cropperWindow.focus();
        }
    }

    private createWindow(showImmediately: boolean): void {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] Cannot create window: instance has been disposed');
            return;
        }

        // Get combined bounds of ALL displays for multi-monitor support
        const combinedBounds = getCombinedDisplayBounds();
        const { width, height } = combinedBounds;

        console.log(`[CropperWindowHelper] Creating cropper window with multi-monitor bounds:`, combinedBounds);

        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width,
            height,
            x: combinedBounds.x,
            y: combinedBounds.y,
            frame: false,
            transparent: true,
            resizable: false,
            // NOTE: On Windows, do NOT use fullscreenable: true as it limits the window
            // to a single monitor. We use enableLargerThanScreen + maximize instead.
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js")
            }
        }

        // Windows requires enableLargerThanScreen to span multiple monitors
        // macOS uses fullscreenable + visibleOnAllWorkspaces instead
        if (process.platform === 'win32') {
            (windowSettings as any).enableLargerThanScreen = true;
        } else {
            windowSettings.type = CROPPER_CONFIG.WINDOW_TYPE;
        }

        this.cropperWindow = new BrowserWindow(windowSettings)

        // Apply NSPanel stealth attributes (becomesKeyOnlyIfNeeded +
        // _setPreventsActivation: SPI + sharingType=None + collectionBehavior).
        // Cropper opens during meetings via Cmd+Shift+H — without this, the
        // cropperWindow.show()/.focus() calls below steal focus from the
        // foreground app (Zoom/browser), defeating the whole stealth model.
        //
        // ROUND 2 FIX (#7): stealth-apply moved INTO the same ready-to-show
        // listener as opacity-shield + show (registered ~40 lines below).
        // Two independent ready-to-show listeners had ordering risk: if
        // stealth's try/catch swallowed a native panic, the opacity-shield
        // listener still fired and show() exposed a panel-attribute-less
        // window — focus theft mid-meeting. Consolidating means stealth
        // attempts run BEFORE show in a single listener body. (Stealth is
        // still try/catch-wrapped so a failure doesn't block the cropper
        // from being usable; partial stealth is better than no cropper.)

        // On Windows, ensure window spans all monitors by explicitly setting bounds
        // This is needed because BrowserWindow might auto-adjust to primary monitor
        if (process.platform === 'win32') {
            this.cropperWindow.setBounds({
                x: combinedBounds.x,
                y: combinedBounds.y,
                width: combinedBounds.width,
                height: combinedBounds.height
            });
        }

        // Debug: log actual window bounds after creation
        const actualBounds = this.cropperWindow.getBounds();
        console.log(`[CropperWindowHelper] Window created. Actual bounds:`, actualBounds);
        console.log(`[CropperWindowHelper] Expected bounds: {x:${combinedBounds.x}, y:${combinedBounds.y}, width:${combinedBounds.width}, height:${combinedBounds.height}}`);

        if (process.platform === "darwin") {
            this.cropperWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.cropperWindow.setAlwaysOnTop(true, "screen-saver")
        }

        // Load URL with retry mechanism
        this.loadCropperUrlWithRetry().catch(err => {
            console.error('[CropperWindowHelper] Failed to load cropper:', err);
        });

        this.cropperWindow.once('ready-to-show', () => {
            if (!this.cropperWindow || this.cropperWindow.isDestroyed()) return;
            // Apply stealth attributes BEFORE any show() so the panel never
            // appears with default activation behavior. Failure is logged
            // but non-fatal — partial stealth (panel type + content
            // protection) still applies via the BrowserWindow constructor.
            if (process.platform === 'darwin') {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.cropperWindow.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[CropperWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showImmediately) {
                this.applyOpacityShield();
            }
        })

        // ROUND 3 FIX (#1): stop the stealth tap when Cropper shows so the
        // user's selection-area drag/keystrokes (Esc to cancel, etc.) reach
        // the cropper, not the overlay's hidden chat input. Same rationale
        // as Settings + Model Selector.
        this.cropperWindow.on('show', () => {
            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[CropperWindowHelper] failed to stop stealth tap on show:', e);
            }
        });

        this.cropperWindow.on('closed', () => {
            // Protect against race condition: window closed after successful selection
            if (this.isWaitingForSelection) {
                this.rejectCurrentSelection(null);
            }
            this.cropperWindow = null;
        });

        this.cropperWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'Escape') {
                this.rejectCurrentSelection(null);
                this.hideOrClose();
            }
        });
    }

    /**
     * Loads the cropper URL with retry mechanism.
     * Retries up to MAX_LOAD_RETRIES times with exponential backoff.
     */
    private async loadCropperUrlWithRetry(): Promise<void> {
        const cropperUrl = `${startUrl}?window=cropper`;
        
        for (let attempt = 1; attempt <= CROPPER_CONFIG.MAX_LOAD_RETRIES; attempt++) {
            try {
                await this.cropperWindow!.loadURL(cropperUrl);
                console.log(`[CropperWindowHelper] URL loaded successfully (attempt ${attempt})`);
                return;
            } catch (error) {
                console.error(`[CropperWindowHelper] Failed to load URL (attempt ${attempt}/${CROPPER_CONFIG.MAX_LOAD_RETRIES}):`, error);
                
                if (attempt === CROPPER_CONFIG.MAX_LOAD_RETRIES) {
                    console.error('[CropperWindowHelper] All load attempts failed');
                    this.rejectCurrentSelection(new Error('Failed to load cropper UI after multiple attempts'));
                    this.hideOrClose();
                    throw error;
                }
                
                // Wait before retry with exponential backoff
                const delay = CROPPER_CONFIG.LOAD_RETRY_DELAY_MS * attempt;
                console.log(`[CropperWindowHelper] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    private hideOrClose(): void {
        if (this.cropperWindow && !this.cropperWindow.isDestroyed() && !this.isDisposed) {
            if (process.platform === 'linux') {
                // Linux: close and recreate each time (no preload strategy on Linux)
                this.cropperWindow.close();
            } else {
                // Windows & macOS: hide and reuse to avoid cold-start on next call.
                // Windows: reset opacity to 0 first so the opacity-shield sequence
                // works correctly on next show (DWM needs window "invisible" before
                // setContentProtection is applied).
                if (process.platform === 'win32') {
                    this.cropperWindow.setOpacity(0);
                }
                this.cropperWindow.hide();
            }
        }
    }

    public closeWindow(): void {
        if (this.cropperWindow && !this.cropperWindow.isDestroyed() && !this.isDisposed) {
            this.cropperWindow.close();
        }
    }

    /**
     * Disposes of all resources and cleans up IPC listeners.
     * Call this when the application is shutting down or when the instance is no longer needed.
     *
     * IMPORTANT: This instance cannot be reused after disposal.
     */
    public dispose(): void {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] dispose() called but already disposed');
            return;
        }

        console.log('[CropperWindowHelper] Disposing...');
        this.isDisposed = true;

        // Clear opacity timeout with safety check
        if (this.opacityTimeout) {
            clearTimeout(this.opacityTimeout);
            this.opacityTimeout = null;
            console.log('[CropperWindowHelper] Opacity timeout cleared');
        }

        // Clear selection timeout with safety check
        if (this.selectionTimeout) {
            clearTimeout(this.selectionTimeout);
            this.selectionTimeout = null;
            console.log('[CropperWindowHelper] Selection timeout cleared');
        }

        // Remove before-quit handler to prevent double cleanup
        if (this.beforeQuitHandler) {
            app.removeListener('before-quit', this.beforeQuitHandler);
            this.beforeQuitHandler = null;
        }

        // Remove IPC listeners
        ipcMain.removeListener('cropper-confirmed', this.confirmedListener);
        ipcMain.removeListener('cropper-cancelled', this.cancelledListener);
        console.log('[CropperWindowHelper] IPC listeners removed');

        // Close window
        this.closeWindow();
        this.cropperWindow = null;
        console.log('[CropperWindowHelper] Window closed');

        // Reject any pending selection — bypass the isWaitingForSelection guard
        // since dispose() is a forced cleanup path that can happen at any time.
        if (this.resolvePromise) {
            this.resolvePromise(null);
            this.resolvePromise = null;
            this.isWaitingForSelection = false;
            console.log('[CropperWindowHelper] Pending selection rejected due to disposal');
        }
        console.log('[CropperWindowHelper] Disposal complete');
    }
}
