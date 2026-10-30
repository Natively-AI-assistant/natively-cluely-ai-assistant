export type MeetingInterfaceTheme = 'default' | 'liquid-glass' | 'modern' | 'lavender';

const STORAGE_KEY = 'natively_meeting_interface_theme';

const VALID_THEMES: ReadonlySet<MeetingInterfaceTheme> = new Set([
    'default',
    'liquid-glass',
    'modern',
    'lavender',
]);

/**
 * Whether the style paints its own surfaces in index.css, so the overlay's
 * inline opacity styles (getOverlayAppearance) must stay out of its way.
 */
export function isCssOwnedInterfaceTheme(theme: MeetingInterfaceTheme): boolean {
    return theme === 'liquid-glass' || theme === 'lavender';
}

/**
 * The panel the style paints, whatever the app's colour theme: liquid glass
 * and modern are always dark, lavender always light, default follows the app.
 */
export function interfaceThemeSurface(theme: MeetingInterfaceTheme, appTheme: 'light' | 'dark'): 'light' | 'dark' {
    if (theme === 'liquid-glass' || theme === 'modern') return 'dark';
    if (theme === 'lavender') return 'light';
    return appTheme;
}

/**
 * The style a window paints for the user's pick. Default is Lavender under the
 * light app theme (the owner, 2026-10-30: Lavender replaces the light Default)
 * and keeps its own dark panel under the dark one. Every other pick paints
 * itself. The stored pick stays 'default', so Settings still shows Default
 * chosen; only what is drawn changes. Every window that draws the overlay or
 * a preview of it resolves through here, so they never disagree.
 */
export function resolveMeetingInterfaceTheme(theme: MeetingInterfaceTheme, appTheme: 'light' | 'dark'): MeetingInterfaceTheme {
    return theme === 'default' && appTheme === 'light' ? 'lavender' : theme;
}

export function getMeetingInterfaceTheme(): MeetingInterfaceTheme {
    const stored = localStorage.getItem(STORAGE_KEY) as MeetingInterfaceTheme | null;
    // Reject unknown / legacy values so forward/backward compat can't poison the UI.
    if (stored && VALID_THEMES.has(stored)) {
        return stored;
    }
    return 'default';
}

export function setMeetingInterfaceTheme(theme: MeetingInterfaceTheme): void {
    localStorage.setItem(STORAGE_KEY, theme);
    // Notify same-window subscribers (the `storage` event does NOT fire in the
    // window that wrote the value per spec; this manual dispatch handles that).
    window.dispatchEvent(new Event('storage'));
    // Cross-window broadcast: Electron BrowserWindows are separate Chromium
    // contexts. A `storage` event in the settings/launcher window never reaches
    // the overlay window. Without this IPC hop, the overlay's React state stays
    // pinned to the theme value it read at mount, and the next meeting start
    // re-shows the overlay with stale CSS variables + fresh component state —
    // manifest as a half-painted UI that requires a force-quit.
    try {
        window.electronAPI?.setMeetingInterfaceTheme?.(theme);
    } catch {
        // Preload not available (e.g. running in a non-Electron host); the
        // localStorage path still works within a single window.
    }
}
