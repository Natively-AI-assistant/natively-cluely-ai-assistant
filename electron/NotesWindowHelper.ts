import { BrowserWindow, screen, app } from "electron"
import path from "node:path"
import { DEV_SERVER_URL } from './devServerUrl';
import { attachNoActivate } from "./utils/windowsFocusPolicy"
import {
    applyNotesWindowPlatformBehaviour,
    buildNotesWindowOptions,
    resolveNotesWindowBounds,
    NOTES_WINDOW_LAYOUT,
    showNotesWindow,
    type NotesWindowBounds,
} from "./utils/notesWindowPolicy"

// Same isDev predicate as the other window helpers: a packaged launch never
// points at a dev server.
const isDev = process.env.NODE_ENV === "development" && !app.isPackaged

const startUrl = isDev
    ? DEV_SERVER_URL
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

/**
 * The notes window (`?window=notes`, 2026-10-15): a small floating window the
 * user types meeting notes into, opened from the overlay's Notes button. The
 * per-platform rules (NSPanel on macOS, taskbar-free on Windows, content
 * protection that follows Undetectable) are in utils/notesWindowPolicy.ts.
 *
 * Closing it hides it; the text lives in main (liveNotesSession.ts), so
 * nothing is lost. Its bounds and whether it was open are remembered in
 * settings (notesWindowState), and a meeting starting reopens it without
 * taking focus for someone who left it open.
 */
export class NotesWindowHelper {
    private window: BrowserWindow | null = null
    private contentProtection = false
    private quitting = false
    private saveTimer: NodeJS.Timeout | null = null
    private visibilityListener: ((visible: boolean) => void) | null = null
    private closedByUserListener: (() => void) | null = null

    constructor() {
        app.once('before-quit', () => {
            this.quitting = true
            this.saveState()
        })
    }

    public getWindow(): BrowserWindow | null {
        return this.window && !this.window.isDestroyed() ? this.window : null
    }

    public isVisible(): boolean {
        const win = this.getWindow()
        return !!win && win.isVisible()
    }

    public onVisibilityChange(listener: ((visible: boolean) => void) | null): void {
        this.visibilityListener = listener
    }

    /** The user closed the window (not a screenshot's brief hide): main shows a launcher Stop held back. */
    public onClosedByUser(listener: (() => void) | null): void {
        this.closedByUserListener = listener
    }

    /**
     * The overlay's Notes button: open it or hide it. Opened without focus, as
     * the overlay is: the meeting app keeps focus, and a click in the page
     * starts typing through the keyboard hook (NotesWindow.tsx).
     * Returns whether the window is now open (a new one shows once painted, so ask here, not isVisible()).
     */
    public toggle(): boolean {
        if (this.isVisible()) {
            this.hide(true)
            return false
        }
        this.open({ activate: false })
        return true
    }

    public open(opts: { activate: boolean }): void {
        const existing = this.getWindow()
        const win = existing ?? this.createWindow()
        if (!win) return
        const show = () => {
            if (win.isDestroyed()) return
            showNotesWindow(win, { platform: process.platform, contentProtection: this.contentProtection, activate: opts.activate })
            this.saveState({ open: true })
        }
        // A new window is shown once painted, after the macOS panel attributes
        // (ready-to-show below), so the first show cannot activate the app.
        if (existing) show()
        else win.once('ready-to-show', show)
    }

    /** `byUser`: the user closed it, so the next meeting does not reopen it. */
    public hide(byUser: boolean): void {
        const win = this.getWindow()
        if (!win || !win.isVisible()) return
        // A session typing into it ends with it (the hook swallows keys).
        this.stealthTyping()?.stopIfTarget('notes')
        win.hide()
        if (byUser) {
            this.saveState({ open: false })
            this.closedByUserListener?.()
        }
    }

    /** Whether the user left the window open (a meeting start opens it again). */
    public wasLeftOpen(): boolean {
        return this.readState()?.open === true
    }

    /**
     * A meeting started: open the window, without focus, when the plan says so
     * (utils/meetingSurface.planMeetingStart: the notepad is the meeting's
     * surface, or the user left it open).
     */
    public reopenForMeeting(open: boolean): void {
        if (this.isVisible() || !open) return
        this.open({ activate: false })
    }

    public setContentProtection(enable: boolean): void {
        this.contentProtection = enable
        this.getWindow()?.setContentProtection(enable)
    }

    /** Re-apply after a macOS activation-policy flip (main: reassertAllContentProtection). */
    public reassertContentProtection(): void {
        this.getWindow()?.setContentProtection(this.contentProtection)
    }

    /** Windows: the settings popover's sync after an Undetectable change. */
    public syncActivationPolicy(): void {
        if (process.platform !== 'win32') return
        const win = this.getWindow()
        if (!win) return
        win.setContentProtection(this.contentProtection)
        if (win.isVisible()) win.setOpacity(1)
    }

    private stealthTyping(): { stopIfTarget(t: 'notes' | 'overlay'): void; getTarget(): 'notes' | 'overlay'; isActive(): boolean; setNotesWindow(w: BrowserWindow | null): void } | null {
        if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') return null
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { StealthKeyboardManager } = require('./services/StealthKeyboardManager')
            return StealthKeyboardManager.getInstance()
        } catch {
            return null
        }
    }

    private readState(): { x: number; y: number; width: number; height: number; open: boolean; layout?: number } | null {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { SettingsManager } = require('./services/SettingsManager')
            return SettingsManager.getInstance().get('notesWindowState') ?? null
        } catch {
            return null
        }
    }

    private saveState(patch: { open?: boolean } = {}): void {
        const win = this.getWindow()
        const prev = this.readState()
        const b = win ? win.getBounds() : prev
        if (!b) return
        const next = { x: b.x, y: b.y, width: b.width, height: b.height, open: patch.open ?? prev?.open ?? false, layout: NOTES_WINDOW_LAYOUT }
        if (prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height && prev.open === next.open && prev.layout === next.layout) return
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { SettingsManager } = require('./services/SettingsManager')
            SettingsManager.getInstance().set('notesWindowState', next)
        } catch { /* bounds are a convenience */ }
    }

    private scheduleBoundsSave(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveState() }, 500)
    }

    private createWindow(): BrowserWindow | null {
        const saved = this.readState()
        const bounds: NotesWindowBounds = resolveNotesWindowBounds(saved, screen.getAllDisplays().map((d) => d.workArea))
        let isLight = false
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { ThemeManager } = require('./ThemeManager')
            isLight = ThemeManager.getInstance().getResolvedTheme() === 'light'
        } catch { /* dark until the page paints */ }

        const win = new BrowserWindow(buildNotesWindowOptions({
            platform: process.platform,
            bounds,
            preloadPath: path.join(__dirname, "preload.js"),
            isLight,
        }) as Electron.BrowserWindowConstructorOptions)
        this.window = win
        const applied = applyNotesWindowPlatformBehaviour(win, process.platform, this.contentProtection)
        // Windows: never activated by a click, as the overlay (WS_EX_NOACTIVATE
        // via windowsFocusPolicy). Typing goes through the keyboard hook. Skipped
        // (the window stays focusable, typing by focus) when there is no hook to
        // type through. macOS: the NSPanel attributes below do the same.
        if (attachNoActivate(win)) applied.push('noActivate')
        // The second typing sink of the keyboard hook (StealthKeyboardManager).
        this.stealthTyping()?.setNotesWindow(win)
        console.log(`[NotesWindowHelper] Created the notes window (${applied.join(', ')})`)

        win.loadURL(`${startUrl}?window=notes`).catch((e) => {
            console.error('[NotesWindowHelper] Failed to load the notes window:', e)
        })

        win.once('ready-to-show', () => {
            // NSPanel stealth attributes, as the settings popover: clicking into
            // the notes makes the panel key without activating Natively.
            if (process.platform === 'darwin' && !win.isDestroyed()) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader')
                    const native = loadNativeModule()
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(win.getNativeWindowHandle())
                    }
                } catch (e) {
                    console.error('[NotesWindowHelper] applyStealthToWindow failed:', e)
                }
            }
        })

        // Focused anyway (no hook to type through, so typing is by focus):
        // keys must reach this window, so an overlay session ends. A session
        // of the notes' own is left alone (macOS can make the panel key on the
        // click that started it).
        win.on('focus', () => {
            this.stealthTyping()?.stopIfTarget('overlay')
        })

        // Closing hides; the notes stay in main.
        win.on('close', (e) => {
            if (this.quitting) return
            e.preventDefault()
            this.hide(true)
        })
        win.on('moved', () => this.scheduleBoundsSave())
        win.on('resized', () => this.scheduleBoundsSave())
        win.on('show', () => this.visibilityListener?.(true))
        win.on('hide', () => this.visibilityListener?.(false))
        win.on('closed', () => {
            if (this.window === win) this.window = null
        })
        return win
    }
}
