// View › Zoom In / Zoom Out / Actual Size, and the interview text size (#673).
//
// The built-in zoom roles zoom the whole page of the focused window. In the
// meeting overlay that is the wrong thing: the overlay sizes its window from
// its content's CSS height, and page zoom makes every CSS pixel bigger on
// screen, so the window comes out too short and the bottom is cut off. Users
// asked for bigger text, not a bigger page.
//
// So the same shortcuts now ask the overlay to change its text size instead
// (src/lib/interviewTextScale.ts owns the value and saves it). Every other
// window keeps page zoom, done exactly the way Electron's roles do it
// (zoomLevel ± 0.5, reset to 0).
//
// Platform: the accelerators are CommandOrControl on both. On Windows the
// overlay is never focused (WS_EX_NOACTIVATE, see WindowHelper), so a menu
// shortcut can't reach it there; Settings › Overlay › Text size is the control
// that works on both. The hidden `=` alias is macOS-only because
// `acceleratorWorksWhenHidden` is a macOS menu feature.
import type { BaseWindow, MenuItemConstructorOptions } from 'electron';

export type InterviewTextScaleStep = 'increase' | 'decrease' | 'reset';

/** Main → overlay: change the text size by one step. */
export const INTERVIEW_TEXT_SCALE_STEP_CHANNEL = 'interview-text-scale:step';
/** Renderer → main: the new text size, to pass on to every window. */
export const INTERVIEW_TEXT_SCALE_SET_CHANNEL = 'interview-text-scale:set';
/** Main → every window: the text size changed. */
export const INTERVIEW_TEXT_SCALE_CHANGED_CHANNEL = 'interview-text-scale:changed';

// Must match src/lib/interviewTextScale.ts (asserted by
// electron/services/__tests__/InterviewTextScale2026_11_05.test.mjs).
export const INTERVIEW_TEXT_SCALE_MIN = 0.8;
export const INTERVIEW_TEXT_SCALE_MAX = 1.6;

/** The value to pass on, or null when the renderer sent something unusable. */
export function sanitizeInterviewTextScale(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const clamped = Math.min(INTERVIEW_TEXT_SCALE_MAX, Math.max(INTERVIEW_TEXT_SCALE_MIN, value));
    return Math.round(clamped * 10) / 10;
}

export interface ZoomTarget {
    isOverlay: boolean;
    webContents: { zoomLevel: number; send: (channel: string, ...args: unknown[]) => void };
}

export type ZoomMenuOutcome = 'text-scale' | 'page-zoom' | 'none';

/** What one of the three menu items does to the window it was pressed in. */
export function applyZoomMenuCommand(step: InterviewTextScaleStep, target: ZoomTarget | null): ZoomMenuOutcome {
    if (!target) return 'none';
    if (target.isOverlay) {
        target.webContents.send(INTERVIEW_TEXT_SCALE_STEP_CHANNEL, step);
        return 'text-scale';
    }
    if (step === 'reset') target.webContents.zoomLevel = 0;
    else target.webContents.zoomLevel += step === 'increase' ? 0.5 : -0.5;
    return 'page-zoom';
}

/**
 * The three View menu items that replace the resetZoom / zoomIn / zoomOut
 * roles. `platform` is passed in so tests can build both menus.
 */
export function buildZoomMenuItems(
    platform: NodeJS.Platform,
    resolveTarget: (win: BaseWindow | undefined) => ZoomTarget | null,
): MenuItemConstructorOptions[] {
    const item = (label: string, accelerator: string, step: InterviewTextScaleStep): MenuItemConstructorOptions => ({
        label,
        accelerator,
        click: (_menuItem, win) => { applyZoomMenuCommand(step, resolveTarget(win)); },
    });
    const items: MenuItemConstructorOptions[] = [
        item('Actual Size', 'CommandOrControl+0', 'reset'),
        item('Zoom In', 'CommandOrControl+Plus', 'increase'),
        item('Zoom Out', 'CommandOrControl+-', 'decrease'),
    ];
    if (platform === 'darwin') {
        // Cmd+= without Shift, which is what most people press for "Cmd +".
        items.push({ ...item('Zoom In', 'CommandOrControl+=', 'increase'), visible: false, acceleratorWorksWhenHidden: true });
    }
    return items;
}
