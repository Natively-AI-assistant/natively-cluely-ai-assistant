export type MeetingInterfaceTheme = 'default' | 'liquid-glass' | 'modern';

const STORAGE_KEY = 'natively_meeting_interface_theme';

const VALID_THEMES: ReadonlySet<MeetingInterfaceTheme> = new Set([
    'default',
    'liquid-glass',
    'modern',
]);

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
