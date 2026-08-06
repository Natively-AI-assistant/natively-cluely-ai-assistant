import { useCallback, useState } from 'react';

/**
 * Adds the `.is-init` class on the FIRST user interaction (pointerdown or
 * keydown) so the shared `.t-toggle` off-load keyframe never plays on mount.
 *
 * Usage:
 *   const { isInit, onInit } = useToggleInit();
 *   <button
 *     className={`t-toggle ${isInit ? 'is-init' : ''} ...`}
 *     data-on={String(checked)}
 *     onPointerDown={onInit}
 *     onKeyDown={onInit}
 *     onClick={handler}
 *   >
 *     <span className="t-toggle-thumb" aria-hidden="true" />
 *   </button>
 *
 * The hook is per-instance so each switch can suppress the off-load animation
 * independently (matters when toggles mount at different times inside a panel).
 */
export function useToggleInit(): { isInit: boolean; onInit: () => void } {
    const [isInit, setIsInit] = useState(false);
    const onInit = useCallback(() => { setIsInit(true); }, []);
    return { isInit, onInit };
}
