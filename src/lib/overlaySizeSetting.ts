import { useSyncExternalStore } from 'react';

/**
 * Settings → General → Advanced → "Keep overlay size" (2026-11-06; replaces
 * the overlay size A/B). On, the default: the overlay keeps the width a code
 * answer opened even once the code scrolls away, and a width you set with the
 * resize button or a height you dragged stays for the next answers. Off: the
 * earlier behaviour, where it narrows again when no code is in view and every
 * new answer starts from the automatic size.
 *
 * Stored and passed between windows the way the Genie switch is
 * (genieAnimationSetting.ts): localStorage, the `storage` event, and an IPC
 * hop through main, because the `storage` event does not reliably cross
 * BrowserWindows. The IPC value is taken as sent, not re-read.
 */
export const KEEP_OVERLAY_SIZE_KEY = 'natively_keep_overlay_size';

function read(): boolean {
    try {
        return localStorage.getItem(KEEP_OVERLAY_SIZE_KEY) !== 'off';
    } catch {
        return true;
    }
}

let current = read();
const listeners = new Set<() => void>();

function adopt(enabled: boolean): void {
    if (enabled === current) return;
    current = enabled;
    for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === KEEP_OVERLAY_SIZE_KEY || e.key === null) adopt(read());
    });
    try {
        (window as any).electronAPI?.onKeepOverlaySizeChanged?.((enabled: unknown) => {
            if (typeof enabled === 'boolean') adopt(enabled);
        });
    } catch {
        /* no preload (a harness): the storage event still works */
    }
}

export function isKeepOverlaySizeEnabled(): boolean {
    return current;
}

export function setKeepOverlaySizeEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(KEEP_OVERLAY_SIZE_KEY, enabled ? 'on' : 'off');
    } catch {
        /* storage unavailable: this window still follows the switch */
    }
    adopt(enabled);
    try {
        (window as any).electronAPI?.setKeepOverlaySizeEnabled?.(enabled);
    } catch {
        /* no preload: the other windows follow through the storage event */
    }
}

export function subscribeKeepOverlaySize(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
}

export function useKeepOverlaySizeEnabled(): boolean {
    return useSyncExternalStore(subscribeKeepOverlaySize, isKeepOverlaySizeEnabled, () => true);
}
