import { useCallback, useRef, useState } from 'react';

/**
 * Arms the shared `.t-toggle` bounce for ONE switch, on that switch's first
 * real user gesture.
 *
 * Why this is per-switch and not per-panel: `.is-init` is what lets
 * `.t-toggle.is-init[data-on="false"]` fire the `t-toggle-off` keyframe. If a
 * single flag were shared across a panel's switches, flipping any one of them
 * would add `.is-init` to ALL of them in the same render, and every switch
 * currently sitting at `data-on="false"` would immediately play the off-bounce
 * from a standing start — the whole settings panel visibly flickering on one
 * click. The same rule fires when async settings hydration lands after mount
 * and flips several `data-on` values at once.
 *
 * So: one `useToggleInit()` per rendered switch. Returning the ready-made class
 * fragment (rather than a raw boolean) makes the wrong shape awkward to write —
 * you cannot easily spread one hook's result across several buttons.
 *
 * Usage:
 *   const toggleInit = useToggleInit();
 *   <button
 *     className={`t-toggle ${toggleInit.className} ...`}
 *     data-on={String(checked)}
 *     {...toggleInit.handlers}
 *     onClick={handler}
 *   >
 *     <span className="t-toggle-thumb" aria-hidden="true" />
 *   </button>
 */
export interface ToggleInit {
    /** `'is-init'` once armed, else `''`. Drop straight into the class list. */
    className: string;
    /** Spread onto the switch element; arms on the first pointer/key gesture. */
    handlers: {
        onPointerDown: () => void;
        onKeyDown: (e: { key?: string }) => void;
    };
}

export function useToggleInit(): ToggleInit {
    const [isInit, setIsInit] = useState(false);
    // Ref mirrors state so the arm path stays a no-op after the first gesture
    // without re-creating the callbacks on every render.
    const armedRef = useRef(false);

    const arm = useCallback(() => {
        if (armedRef.current) return;
        armedRef.current = true;
        setIsInit(true);
    }, []);

    // Only keys that actually activate a <button> should arm the animation.
    // Tabbing THROUGH a switch must not arm it: the keydown for Tab lands on
    // the switch it moves focus to, which would arm a control the user never
    // operated and let a later unrelated re-render bounce it.
    const onKeyDown = useCallback((e: { key?: string }) => {
        if (e?.key === ' ' || e?.key === 'Enter' || e?.key === 'Spacebar') arm();
    }, [arm]);

    return {
        className: isInit ? 'is-init' : '',
        handlers: { onPointerDown: arm, onKeyDown },
    };
}
