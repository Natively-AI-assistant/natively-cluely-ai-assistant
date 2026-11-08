// The notes window (`?window=notes`, 2026-10-15): how it is built, shown and
// placed on each platform.
//
// A small floating window the user types notes into during a meeting, opened
// from the overlay. Its rules follow the overlay family's, per platform:
//
//   macOS   an NSPanel (type 'panel' + applyStealthToWindow in the helper), so
//           it floats over a fullscreen meeting app on every Space, never puts
//           a tile in the Dock, and clicking into it to type makes it key
//           WITHOUT activating Natively over the meeting app. Level 'floating',
//           like the overlay's popovers. Hidden from Mission Control.
//   Windows skipTaskbar (no taskbar button, like every overlay window) and
//           level 'screen-saver', the overlay's own, so it stays above a
//           fullscreen meeting app. Since 2026-10-20 it is under the overlay's
//           no-activate policy too (windowsFocusPolicy.attachNoActivate, in
//           NotesWindowHelper): a click never activates it, and typing goes
//           through the keyboard hook, which feeds whichever of the overlay or
//           the notes started the session (StealthKeyboardManager's target).
//           Without a hook (none built, a CJK keyboard) the policy skips
//           itself and the window is typed into by focus, as before.
//
// Content protection follows Undetectable exactly as the overlay's does
// (setContentProtection(isUndetectable) at creation and on every show), with
// the Windows show shield the settings popover uses: shown at opacity 0,
// protected, then made visible, so a capture never sees one unprotected frame.
//
// Not transparent: a transparent window cannot be resized from its edges on
// Windows, and this one is resizable. Frameless on both, with its own header.
//
// Pure module: no electron import, platform injected, so both platform
// branches are tested from either OS (MeetingNotesWindow2026_10_15.test.mjs).

import { setVisibleOnAllWorkspacesKeepingDock } from './macDockPolicy';

export interface NotesWindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface WorkArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Tall like Granola's notes window (2026-10-20: theirs is 500 wide and the
// screen's full height, flush with its right edge). The height is the work
// area's, so only the width is fixed; `height` is the fallback with no screen.
export const NOTES_WINDOW_DEFAULT_SIZE = { width: 460, height: 800 } as const;
/**
 * Saved bounds from an older layout are not reused: everyone who opened the
 * small 340 x 420 window (before the tall one) would keep getting it. Bumped
 * whenever the default shape changes.
 */
export const NOTES_WINDOW_LAYOUT = 2;
export const NOTES_WINDOW_MIN_SIZE = { width: 260, height: 200 } as const;

/** Background painted before the page draws, per theme (the page's --bg-elevated). */
export const NOTES_WINDOW_BACKGROUND = { light: '#FFFFFF', dark: '#151515' } as const;

/** BrowserWindow options for the notes window. */
export function buildNotesWindowOptions(input: {
    platform: NodeJS.Platform;
    bounds: NotesWindowBounds;
    preloadPath: string;
    isLight: boolean;
}): Record<string, unknown> {
    const { platform, bounds } = input;
    return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        minWidth: NOTES_WINDOW_MIN_SIZE.width,
        minHeight: NOTES_WINDOW_MIN_SIZE.height,
        show: false,
        frame: false,
        transparent: false,
        backgroundColor: input.isLight ? NOTES_WINDOW_BACKGROUND.light : NOTES_WINDOW_BACKGROUND.dark,
        resizable: true,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: true,
        title: 'Notes',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: input.preloadPath,
            backgroundThrottling: false,
        },
        // NSPanel on macOS (see the header); Windows has no panel type.
        ...(platform === 'darwin' ? { type: 'panel' } : {}),
    };
}

/** Structural subset of BrowserWindow the per-platform setup needs. */
export interface NotesWindowLike {
    setAlwaysOnTop(flag: boolean, level?: any): void;
    setHiddenInMissionControl?(hidden: boolean): void;
    setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean }): void;
    setSkipTaskbar?(skip: boolean): void;
    setContentProtection(enable: boolean): void;
}

/**
 * Per-platform window level and workspace behaviour, applied once after
 * construction. Returns what was applied (for the tests and the log).
 */
export function applyNotesWindowPlatformBehaviour(
    win: NotesWindowLike,
    platform: NodeJS.Platform,
    contentProtection: boolean,
): string[] {
    const applied: string[] = [];
    win.setContentProtection(contentProtection);
    applied.push(`contentProtection:${contentProtection}`);
    if (platform === 'darwin') {
        // Never the raw API: it would flip the activation policy and the Dock tile (macDockPolicy.ts).
        setVisibleOnAllWorkspacesKeepingDock(win, true, true);
        win.setHiddenInMissionControl?.(true);
        win.setAlwaysOnTop(true, 'floating');
        applied.push('allWorkspaces', 'hiddenInMissionControl', 'level:floating');
    } else if (platform === 'win32') {
        win.setSkipTaskbar?.(true);
        win.setAlwaysOnTop(true, 'screen-saver');
        applied.push('skipTaskbar', 'level:screen-saver');
    }
    return applied;
}

/** Structural subset of BrowserWindow for showing. */
export interface NotesShowWindowLike {
    show(): void;
    showInactive(): void;
    focus(): void;
    setOpacity(opacity: number): void;
    setContentProtection(enable: boolean): void;
    isDestroyed(): boolean;
}

/**
 * Show the window. `activate` false (a meeting starting reopens it) never takes
 * focus. On Windows in Undetectable mode the window is protected while still
 * invisible, then revealed (the settings popover's shield).
 */
export function showNotesWindow(
    win: NotesShowWindowLike,
    opts: { platform: NodeJS.Platform; contentProtection: boolean; activate: boolean },
    setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): void {
    if (opts.platform === 'win32' && opts.contentProtection) {
        win.setOpacity(0);
        if (opts.activate) win.show(); else win.showInactive();
        win.setContentProtection(true);
        setTimer(() => {
            if (win.isDestroyed()) return;
            win.setOpacity(1);
            if (opts.activate) win.focus();
        }, 60);
        return;
    }
    win.setContentProtection(opts.contentProtection);
    if (opts.activate) {
        win.show();
        win.focus();
    } else {
        win.showInactive();
    }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Where the window opens: its saved bounds when they still land on a screen
 * (at least 80 px of it visible on some work area, size clamped to that work
 * area), else the default size at the top right of the primary work area.
 */
export function resolveNotesWindowBounds(
    saved: (Partial<NotesWindowBounds> & { layout?: number }) | null | undefined,
    workAreas: WorkArea[],
): NotesWindowBounds {
    const primary = workAreas[0] ?? { x: 0, y: 0, width: 1280, height: NOTES_WINDOW_DEFAULT_SIZE.height };
    // The full height of the work area (under the menu bar on macOS, above the
    // taskbar on Windows), flush with its right edge.
    const tallWidth = Math.min(NOTES_WINDOW_DEFAULT_SIZE.width, primary.width);
    const fallback: NotesWindowBounds = {
        width: tallWidth,
        height: primary.height,
        x: primary.x + primary.width - tallWidth,
        y: primary.y,
    };
    if (!saved || saved.layout !== NOTES_WINDOW_LAYOUT || !finite(saved.x) || !finite(saved.y) || !finite(saved.width) || !finite(saved.height)) return fallback;
    const VISIBLE = 80;
    const area = workAreas.find((a) =>
        saved.x! + saved.width! - VISIBLE >= a.x && saved.x! + VISIBLE <= a.x + a.width
        && saved.y! >= a.y - 8 && saved.y! + VISIBLE <= a.y + a.height,
    );
    if (!area) return fallback;
    const width = Math.min(Math.max(saved.width, NOTES_WINDOW_MIN_SIZE.width), area.width);
    const height = Math.min(Math.max(saved.height, NOTES_WINDOW_MIN_SIZE.height), area.height);
    const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
    const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
