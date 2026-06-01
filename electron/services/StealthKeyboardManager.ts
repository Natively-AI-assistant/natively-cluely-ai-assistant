import { BrowserWindow, shell, systemPreferences } from 'electron';
import type { CapturedKey, OverlayBoundsInput } from '../audio/nativeModuleLoader';
import { isVerboseLogging } from '../verboseLog';

/**
 * Lifecycle owner for the macOS CGEventTap. JS-side state machine for the
 * "stealth typing mode" that lets the user type into Natively without their
 * foreground app (Zoom, browser, etc.) ever losing key/frontmost status at
 * the OS level.
 *
 * # Activation
 *
 * `toggle()` flips between active and inactive. The activation hotkey
 * (Cmd/Ctrl+Shift+Space, registered via globalShortcut) calls toggle().
 * Carbon hotkey processing happens BEFORE the session event tap, so the
 * hotkey itself is consumed by globalShortcut and never reaches our tap —
 * meaning toggle() works cleanly without us special-casing the hotkey
 * keycode in the captured stream.
 *
 * # Captured-event flow
 *
 * Worker thread (in Rust) → ThreadsafeFunction → this manager's `onKey`
 * callback → broadcast `stealth-key-captured` IPC to the overlay window.
 * The renderer accumulates `chars` into the chat input value programmatically
 * (no DOM keyboard event ever fires on the panel — the input never has to
 * become focused).
 *
 * # Esc / Enter handling
 *
 * Esc (keyCode 53) and Cmd+Enter inside the captured stream auto-stop the
 * tap. We handle this in main rather than relying on the renderer to call
 * stop() because the renderer might be slow / unmounted, and a stuck tap
 * means the user's keystrokes vanish into the void.
 *
 * # Permission failure
 *
 * `start()` returns false if Accessibility is not granted. We surface this
 * to the renderer via `stealth-tap-state` ({active:false, error:'permission'})
 * and offer to open System Settings via the helper below.
 */
export class StealthKeyboardManager {
    private static instance: StealthKeyboardManager | null = null;

    private tap: any | null = null; // StealthKeyboardTap instance from native module
    private active = false;
    private nativeAvailable = false;
    private idleTimer: NodeJS.Timeout | null = null;
    /// Explicit reference to the overlay BrowserWindow that should receive
    /// captured-key broadcasts. Without this, broadcast() falls back to
    /// `BrowserWindow.getAllWindows()` which fan-outs every keystroke to
    /// settings windows, cropper, model selector — any window that exists.
    /// If a future settings window registers an `onStealthKeyCaptured`
    /// listener (intentionally or accidentally during development), it
    /// would silently receive every user keystroke. Scoping prevents this.
    private overlayWebContents: Electron.WebContents | null = null;
    private overlayBoundsProvider: (() => OverlayBoundsInput | null) | null = null;
    /// Monotonic counter incremented on every setOverlayWindow call. The
    /// 'closed' listener captures the token at registration time and only
    /// nulls overlayWebContents if the token still matches. Without this,
    /// equality on WebContents identity is unreliable — Electron may reuse
    /// WebContents instances after `webContents.reload()`, so a `closed`
    /// event from window A could spuriously null a later registration of
    /// window B that happens to have the same WebContents reference.
    private overlayRegistrationToken: number = 0;
    // Idle window before we auto-disengage. Long enough that the user can
    // pause to think mid-question without losing the tap, short enough that
    // a stuck tap can't eat keystrokes into the void if the renderer crashes
    // or the user wandered away. Tunable per UX feedback.
    private static readonly IDLE_TIMEOUT_MS = 10_000;

    private constructor() {
        this.tap = this.createTapInstance();
        this.nativeAvailable = this.tap !== null;
    }

    public static getInstance(): StealthKeyboardManager {
        if (!StealthKeyboardManager.instance) {
            StealthKeyboardManager.instance = new StealthKeyboardManager();
        }
        return StealthKeyboardManager.instance;
    }

    /**
     * Register the overlay BrowserWindow as the sole recipient of
     * captured-key broadcasts. Called from WindowHelper after the overlay
     * is created. State broadcasts (active/inactive) still fan out to all
     * windows (cheap, low-sensitivity); only key events are scoped.
     */
    public setOverlayBoundsProvider(provider: (() => OverlayBoundsInput | null) | null): void {
        this.overlayBoundsProvider = provider;
    }

    /**
     * Push the latest overlay bounds into the live tap. Wire this to
     * overlayWindow 'resize' / 'move' so the Rust mouse-down classifier
     * stays in sync with the actual OS frame. Safe to call unconditionally
     * — the native side no-ops when the tap is not active, and the
     * provider lambda is the single source of truth for current bounds.
     *
     * Dedup-on-equal at this layer skips the N-API marshal entirely for
     * identical frames (common at animation start/end and during idle
     * height-only updates). The native side also no-ops when inactive.
     */
    public pushBoundsToTap(): void {
        if (!this.tap) return;
        const bounds = this.getOverlayBoundsForTap();
        if (StealthKeyboardManager.boundsEqual(this.lastPushedBounds, bounds)) return;
        this.lastPushedBounds = bounds;
        try {
            this.tap.updateOverlayBounds(bounds);
        } catch (e) {
            console.error('[StealthKeyboardManager] updateOverlayBounds threw:', e);
        }
    }

    private lastPushedBounds: OverlayBoundsInput | null = null;
    private static boundsEqual(a: OverlayBoundsInput | null, b: OverlayBoundsInput | null): boolean {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    }

    public setOverlayWindow(win: BrowserWindow | null): void {
        // ROUND 4 FIX (#5): bump the token on EVERY call, including null
        // clears. R3 had skipped the bump on null which technically worked
        // for token comparison, but lost the defensive property that any
        // prior window's 'closed' handler is invalidated the moment a new
        // setOverlayWindow() runs (regardless of new value). One u64
        // increment is free; the safety margin is real.
        const myToken = ++this.overlayRegistrationToken;
        if (!win) {
            this.overlayWebContents = null;
            return;
        }
        // ROUND 2 FIX (#5): Issue a fresh registration token so any
        // previously-registered window's 'closed' handler can detect that
        // it's been superseded and skip the null-out. Identity comparison
        // on WebContents was brittle (WebContents can be reused after
        // reload, leading to false equality and spurious nulling).
        this.overlayWebContents = !win.isDestroyed() ? win.webContents : null;
        win.once('closed', () => {
            // Only clear if THIS registration is still the active one.
            // A later setOverlayWindow() bumped the token; in that case
            // the closure of an older window must NOT touch the field.
            if (this.overlayRegistrationToken === myToken) {
                this.overlayWebContents = null;
            }
        });
    }

    /** True if the native module shipped with stealth-tap support. */
    public isAvailable(): boolean {
        return this.nativeAvailable;
    }

    /** True if Accessibility is granted right now. */
    public isPermissionGranted(): boolean {
        if (process.platform !== 'darwin') return false;
        // Prefer Electron's systemPreferences (well-supported, no rebuild
        // required). Fall back to the native module's check if Electron's
        // API is unavailable in this version.
        try {
            return systemPreferences.isTrustedAccessibilityClient(false);
        } catch {
            return this.callNativePermissionCheck();
        }
    }

    /**
     * Trigger the macOS Accessibility prompt. Returns the current trust state
     * (almost always false on first call — user needs to grant in System
     * Settings, then restart the app for the tap to bind).
     */
    public requestPermission(): boolean {
        if (process.platform !== 'darwin') return false;
        try {
            // Pass true to surface the prompt. macOS shows the standard
            // "App would like to control your computer" dialog.
            return systemPreferences.isTrustedAccessibilityClient(true);
        } catch {
            return false;
        }
    }

    /** Open System Settings → Privacy & Security → Accessibility directly. */
    public openSettings(): void {
        if (process.platform !== 'darwin') return;
        // x-apple.systempreferences URL scheme: documented (mostly) and
        // stable across recent macOS versions. Falls back to the general
        // privacy pane if the deep link fails.
        // shell.openExternal in this Electron version is locally typed to
        // return a boolean (legacy sync signature) rather than Promise<void>
        // — wrap in Promise.resolve so we can chain. Two-level catch: first
        // catches the deep-link failure and tries the parent pane; second
        // catches the fallback's failure and logs. Without the outer catch,
        // the fallback's rejection would be a floating promise warning.
        const tryOpen = (url: string): Promise<unknown> =>
            Promise.resolve(shell.openExternal(url));
        tryOpen('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
            .catch(() => tryOpen('x-apple.systempreferences:com.apple.preference.security'))
            .catch((e: unknown) => {
                console.error('[StealthKeyboardManager] failed to open Accessibility settings:', e);
            });
    }

    /** True while the tap is engaged and capturing keystrokes. */
    public isActive(): boolean {
        return this.active;
    }

    /**
     * Engage the tap. Returns false if the native module isn't available
     * or Accessibility isn't granted; the renderer should drive the user
     * through the permission flow in that case.
     */
    public start(): boolean {
        if (!this.tap) return false;
        if (this.active) return true;

        // ROUND 2 FIX (#12): Flip active=true BEFORE tap.start() so the
        // first captured callback (which can fire on the worker thread the
        // instant the tap binds, before this method returns) doesn't hit
        // handleCapturedKey's `if (!this.active) return;` guard and drop
        // the first keystroke. Roll back to false on tap.start failure.
        //
        // ROUND 3 FIX (#7): also broadcast active=true BEFORE calling
        // tap.start(). Otherwise, a captured Esc that fires between
        // tap.start() returning and the broadcast at the end of this method
        // would invoke handleCapturedKey → broadcastState({active:false})
        // BEFORE we send {active:true} — renderer sees inverted ordering and
        // its stealthTapActiveRef diverges from manager's actual state.
        // Sending active=true first means the worst case is one spurious
        // {active:false} broadcast on permission failure (corrected below).
        this.active = true;
        this.broadcastState({ active: true });
        let ok = false;
        try {
            const overlayBounds = this.getOverlayBoundsForTap();
            ok = this.tap.start((err: Error | null, ev: CapturedKey) => {
                if (err) {
                    console.error('[StealthKeyboardManager] tap callback error:', err);
                    return;
                }
                // Defensive: napi-rs may invoke the callback with `undefined`
                // ev during tsfn shutdown / abort sequences. Without this
                // guard, `ev.isKeyDown` below throws → uncaught exception.
                if (!ev) return;
                this.handleCapturedKey(ev);
            }, overlayBounds);
        } catch (e) {
            this.active = false;
            this.broadcastState({ active: false }); // correct the optimistic broadcast
            console.error('[StealthKeyboardManager] tap.start threw:', e);
            return false;
        }

        if (!ok) {
            this.active = false;
            // Override the optimistic active=true with the failure reason.
            this.broadcastState({ active: false, reason: 'permission' });
            return false;
        }

        // ROUND 4 FIX (#3): hide aux windows that are still visible. With
        // panel-nonactivating, NSPanel blur fires unreliably so Settings /
        // ModelSelector / Cropper can stay open after the user thinks they
        // dismissed them. If the tap engages while one is open, the user
        // sees a stale window with dead inputs (tap intercepts keystrokes
        // at OS level → routes to overlay, not the aux window's React
        // tree). Hiding here closes the loop: engaging the tap = "I want
        // to type into Natively now" implies "no other Natively windows
        // should be competing for input."
        this.hideAuxWindowsForStealth();

        this.armIdleTimer();
        return true;
    }

    /**
     * Hide Settings / ModelSelector / Cropper if they happen to be visible
     * when the stealth tap engages. Lazy require()'d to avoid pulling those
     * helpers into early boot.
     */
    private hideAuxWindowsForStealth(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { AppState } = require('../main');
            const app = AppState.getInstance();
            const settings = app?.settingsWindowHelper?.getSettingsWindow?.();
            if (settings && !settings.isDestroyed() && settings.isVisible()) {
                app.settingsWindowHelper.closeWindow();
            }
            const modelSel = app?.modelSelectorWindowHelper?.getWindow?.();
            if (modelSel && !modelSel.isDestroyed() && modelSel.isVisible()) {
                app.modelSelectorWindowHelper.hideWindow();
            }
            // Cropper: don't auto-close — if the user is mid-selection, hiding
            // would lose their crop. Cropper's own 'show' handler stops the
            // tap (the inverse direction), so the conflict is already
            // unidirectional and acceptable.
        } catch (e) {
            console.error('[StealthKeyboardManager] hideAuxWindowsForStealth failed:', e);
        }
    }

    /** Disengage the tap. Safe to call when inactive. */
    public stop(): void {
        this.clearIdleTimer();
        if (!this.tap) return;
        if (!this.active) return;
        this.tap.stop();
        this.active = false;
        this.broadcastState({ active: false });
    }

    private armIdleTimer(): void {
        // Guard against creating an orphan timer if a late-arriving captured
        // event tries to arm us after stop() already ran. Without this, a
        // captured-key IPC queued by the worker thread before stop() but
        // processed after would call armIdleTimer on an inactive manager,
        // creating a 10s zombie timer that fires and calls stop() (no-op
        // because already inactive — benign, but log noise + zero value).
        // The guard is fine to put here even though armIdleTimer is also
        // called from start() right after `this.active = true` is set.
        if (!this.active) return;
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            // No captured keystroke for IDLE_TIMEOUT_MS — assume the user
            // walked away or context-switched. Disengage so subsequent typing
            // goes to whatever they're now focused on, not into a hidden tap.
            if (this.active) this.stop();
        }, StealthKeyboardManager.IDLE_TIMEOUT_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /** Toggle active state. Bound to the activation hotkey. */
    public toggle(): boolean {
        if (this.active) {
            this.stop();
            return false;
        }
        return this.start();
    }

    // ─── internals ───────────────────────────────────────────────────────

    private createTapInstance(): any | null {
        if (process.platform !== 'darwin') return null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadNativeModule } = require('../audio/nativeModuleLoader');
            const native = loadNativeModule();
            if (!native) return null;
            const Ctor = native.StealthKeyboardTap;
            if (typeof Ctor !== 'function') {
                if (isVerboseLogging()) {
                    console.warn(
                        '[StealthKeyboardManager] StealthKeyboardTap constructor missing from native binary — rebuild with `npm run build:native` for stealth typing'
                    );
                }
                return null;
            }
            return new Ctor();
        } catch (e) {
            // Errors here are load failures, not user-correctable conditions —
            // always log so build/dist issues surface. Verbose-gating these
            // would mask real bugs.
            console.error('[StealthKeyboardManager] failed to instantiate native tap:', e);
            return null;
        }
    }

    private callNativePermissionCheck(): boolean {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadNativeModule } = require('../audio/nativeModuleLoader');
            const native = loadNativeModule();
            return typeof native?.isAccessibilityGranted === 'function'
                ? native.isAccessibilityGranted()
                : false;
        } catch {
            return false;
        }
    }

    private getOverlayBoundsForTap(): OverlayBoundsInput | null {
        const bounds = this.overlayBoundsProvider?.() ?? null;
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
        return bounds;
    }

    private handleCapturedKey(ev: CapturedKey): void {
        if (ev.isOutsideMouseDown) {
            this.stop();
            return;
        }

        // Auto-exit on Esc. ORDER MATTERS: send the captured key event
        // FIRST, then stop() (which broadcasts the inactive state). See
        // the renderer's escSuppressUntilNextActive flag for the matching
        // half of the ordering invariant.
        if (ev.isKeyDown && ev.keyCode === 53) {
            this.sendKeyToOverlay(ev);
            this.stop();
            return;
        }
        // Drop captured events that arrive after stop().
        if (!this.active) return;
        this.armIdleTimer();
        this.sendKeyToOverlay(ev);
    }

    private sendKeyToOverlay(ev: CapturedKey): void {
        // Captured keystrokes are sensitive — never fan out. Send only to
        // the registered overlay webContents. If unset (e.g., overlay not
        // yet created), drop. The user wouldn't see the result anyway.
        if (this.overlayWebContents && !this.overlayWebContents.isDestroyed()) {
            this.overlayWebContents.send('stealth-key-captured', ev);
        }
    }

    private broadcastState(state: { active: boolean; reason?: string }): void {
        this.broadcast('stealth-tap-state', state);
    }

    private broadcast(channel: string, payload: unknown): void {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, payload);
            }
        }
    }
}
