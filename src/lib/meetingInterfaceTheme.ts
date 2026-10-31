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
 * and modern are always dark; lavender and default follow the app (lavender
 * has had a dark set since 2026-10-31, overlayLavenderTheme.css Part 4).
 */
export function interfaceThemeSurface(theme: MeetingInterfaceTheme, appTheme: 'light' | 'dark'): 'light' | 'dark' {
    if (theme === 'liquid-glass' || theme === 'modern') return 'dark';
    return appTheme;
}

/**
 * The style a window paints for the user's pick. Default is Lavender under
 * both app themes (the owner: Lavender replaced the light Default on
 * 2026-10-30, and dark mode shows Lavender's dark set since 2026-10-31, not
 * the old dark panel). Every other pick paints itself. The stored pick stays 'default', so Settings still shows Default
 * chosen; only what is drawn changes. Every window that draws the overlay or
 * a preview of it resolves through here, so they never disagree.
 */
export function resolveMeetingInterfaceTheme(theme: MeetingInterfaceTheme, _appTheme: 'light' | 'dark'): MeetingInterfaceTheme {
    return theme === 'default' ? 'lavender' : theme;
}

export function getMeetingInterfaceTheme(): MeetingInterfaceTheme {
    const stored = localStorage.getItem(STORAGE_KEY) as MeetingInterfaceTheme | null;
    // Lavender left the picker on 2026-10-31 (Default paints it in both app
    // themes). A saved Lavender pick reads as Default, so Settings shows it
    // chosen and nothing on screen changes.
    if (stored === 'lavender') return 'default';
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
