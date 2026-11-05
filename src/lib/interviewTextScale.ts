// The meeting overlay's text size (#673): "Cmd +" zoomed the whole window and
// cut the bottom off; people wanted bigger text, not a bigger page.
//
// One number, 0.8–1.6 in steps of 0.1, saved in localStorage like the other
// overlay settings. App.tsx puts it on the overlay as --interview-text-scale,
// and the message rows apply it with CSS `zoom` ([data-text-scale] in index.css).
// CSS zoom changes layout size, not just paint, so the overlay's
// ResizeObserver measures the bigger text and the window grows to fit it.
//
// Changed from Settings › Overlay › Text size (both platforms) and from
// View › Zoom In / Zoom Out / Actual Size while the overlay is focused
// (macOS; on Windows the overlay never takes focus).

export const INTERVIEW_TEXT_SCALE_MIN = 0.8;
export const INTERVIEW_TEXT_SCALE_MAX = 1.6;
export const INTERVIEW_TEXT_SCALE_STEP = 0.1;
export const INTERVIEW_TEXT_SCALE_DEFAULT = 1;

const STORAGE_KEY = 'natively_interview_text_scale';

export type InterviewTextScaleStep = 'increase' | 'decrease' | 'reset';

/** Any input → a value in range, rounded to the step. Unusable input → the default. */
export function clampInterviewTextScale(value: unknown): number {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return INTERVIEW_TEXT_SCALE_DEFAULT;
    const clamped = Math.min(INTERVIEW_TEXT_SCALE_MAX, Math.max(INTERVIEW_TEXT_SCALE_MIN, n));
    return Math.round(clamped * 10) / 10;
}

export function stepInterviewTextScale(current: number, step: InterviewTextScaleStep): number {
    if (step === 'reset') return INTERVIEW_TEXT_SCALE_DEFAULT;
    const delta = step === 'increase' ? INTERVIEW_TEXT_SCALE_STEP : -INTERVIEW_TEXT_SCALE_STEP;
    return clampInterviewTextScale(clampInterviewTextScale(current) + delta);
}

/** "100%", "120%" … for the Settings row. */
export function formatInterviewTextScale(scale: number): string {
    return `${Math.round(clampInterviewTextScale(scale) * 100)}%`;
}

export function getInterviewTextScale(): number {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === null ? INTERVIEW_TEXT_SCALE_DEFAULT : clampInterviewTextScale(stored);
    } catch {
        return INTERVIEW_TEXT_SCALE_DEFAULT;
    }
}

/** Saves the size and tells every window (same hop as meetingInterfaceTheme.ts). */
export function setInterviewTextScale(scale: number): number {
    const safe = clampInterviewTextScale(scale);
    try {
        localStorage.setItem(STORAGE_KEY, String(safe));
        // `storage` does not fire in the window that wrote the value.
        window.dispatchEvent(new Event('storage'));
    } catch {
        // Storage unavailable; the IPC below still updates open windows.
    }
    try {
        window.electronAPI?.setInterviewTextScale?.(safe);
    } catch {
        // Preload not available (not running in Electron).
    }
    return safe;
}
