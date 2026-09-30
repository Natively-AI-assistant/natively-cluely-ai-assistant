// Warm/cool tint sub-option for the light theme (Theme = System/Light/Dark;
// this only ever applies while resolved theme is 'light' — see
// `[data-theme='light'][data-light-temp=...]` in index.css). Mirrors
// meetingInterfaceTheme.ts's storage + cross-window IPC pattern.

export type LightThemeTemperature = 'neutral' | 'warm' | 'cool';

const STORAGE_KEY = 'natively_light_theme_temp';

const VALID_TEMPS: ReadonlySet<LightThemeTemperature> = new Set([
    'neutral',
    'warm',
    'cool',
]);

export function getLightThemeTemperature(): LightThemeTemperature {
    const stored = localStorage.getItem(STORAGE_KEY) as LightThemeTemperature | null;
    if (stored && VALID_TEMPS.has(stored)) {
        return stored;
    }
    return 'neutral';
}

export function applyLightThemeTemperature(temp: LightThemeTemperature): void {
    if (temp === 'neutral') {
        document.documentElement.removeAttribute('data-light-temp');
    } else {
        document.documentElement.setAttribute('data-light-temp', temp);
    }
}

export function setLightThemeTemperature(temp: LightThemeTemperature): void {
    localStorage.setItem(STORAGE_KEY, temp);
    applyLightThemeTemperature(temp);
    // Same-window `storage` events don't fire in the writing window per spec.
    window.dispatchEvent(new Event('storage'));
    // Cross-window broadcast — see setMeetingInterfaceTheme for why this is
    // necessary in this app's multi-BrowserWindow setup.
    try {
        window.electronAPI?.setLightThemeTemperature?.(temp);
    } catch {
        // Preload not available (e.g. non-Electron host); localStorage still
        // works within a single window.
    }
}
