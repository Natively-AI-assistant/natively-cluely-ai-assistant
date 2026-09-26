import { useSyncExternalStore } from 'react';

/**
 * Settings → Advanced → "Genie animation". Off makes every popup open and close
 * with the plain fade the reduced-motion preference already uses, and stops the
 * pictures the genie keeps of each popup (decoded, up to 64 MB per window).
 *
 * localStorage, so every Natively window reads the same value; a change in one
 * window reaches the others through the `storage` event, and this window
 * through the one set() dispatches itself.
 */
export const GENIE_ANIMATION_KEY = 'natively_genie_animation';

export function isGenieAnimationEnabled(): boolean {
    try {
        return localStorage.getItem(GENIE_ANIMATION_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function setGenieAnimationEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(GENIE_ANIMATION_KEY, enabled ? 'on' : 'off');
        window.dispatchEvent(new StorageEvent('storage', { key: GENIE_ANIMATION_KEY }));
    } catch {
        /* storage unavailable: the animation stays as it was */
    }
}

function subscribe(onChange: () => void): () => void {
    const handler = (e: StorageEvent) => {
        if (e.key === GENIE_ANIMATION_KEY || e.key === null) onChange();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
}

export function useGenieAnimationEnabled(): boolean {
    return useSyncExternalStore(subscribe, isGenieAnimationEnabled, () => true);
}
