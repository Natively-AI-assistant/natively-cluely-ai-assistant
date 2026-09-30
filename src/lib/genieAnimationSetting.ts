import { useSyncExternalStore } from 'react';

/**
 * Settings → Advanced → "Genie animation". Off makes every popup open and close
 * with the plain fade the reduced-motion preference already uses, and drops the
 * pictures the genie keeps of each popup (decoded, up to 64 MB per window).
 *
 * localStorage, so every Natively window starts from the same value. A change
 * reaches the other windows two ways: the `storage` event, and an IPC hop
 * through main carrying the new value (the `storage` event does not reliably
 * cross BrowserWindows; see meetingInterfaceTheme.ts). The IPC value is taken
 * as sent, not re-read: this renderer's storage cache can lag behind it.
 */
export const GENIE_ANIMATION_KEY = 'natively_genie_animation';

function read(): boolean {
    try {
        return localStorage.getItem(GENIE_ANIMATION_KEY) !== 'off';
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

// Listening from load, not from the first subscriber, so the value is fresh
// whenever a card first reads it.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === GENIE_ANIMATION_KEY || e.key === null) adopt(read());
    });
    try {
        (window as any).electronAPI?.onGenieAnimationChanged?.((enabled: unknown) => {
            if (typeof enabled === 'boolean') adopt(enabled);
        });
    } catch {
        /* no preload (a harness): the storage event still works */
    }
}

export function isGenieAnimationEnabled(): boolean {
    return current;
}

export function setGenieAnimationEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(GENIE_ANIMATION_KEY, enabled ? 'on' : 'off');
    } catch {
        /* storage unavailable: this window still follows the switch */
    }
    adopt(enabled);
    try {
        (window as any).electronAPI?.setGenieAnimationEnabled?.(enabled);
    } catch {
        /* no preload: the other windows follow through the storage event */
    }
}

export function subscribeGenieAnimation(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
}

export function useGenieAnimationEnabled(): boolean {
    return useSyncExternalStore(subscribeGenieAnimation, isGenieAnimationEnabled, () => true);
}
