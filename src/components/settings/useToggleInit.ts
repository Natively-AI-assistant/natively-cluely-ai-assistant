import { useCallback, useState } from 'react';

/**
 * Arms the shared `.t-toggle` bounce for ONE switch.
 *
 * CURRENTLY INERT: index.css's `.t-toggle` moved from a keyframe bounce
 * (gated on `is-init`, exactly as described below) to a plain CSS
 * `transition`, which fires correctly on every state change with no arming
 * needed. Every call site still applies `is-init` via `arm()`, but it no
 * longer matches any selector. Left wired rather than pulled out of every
 * caller here; harmless to keep, safe to delete if this hook's only purpose
 * (below) doesn't come back.
 *
 * WHY ARMING HAPPENS ON ACTIVATION, NOT ON POINTERDOWN. `is-init` and the new
 * `data-on` must land in the SAME render. An earlier version armed on
 * `pointerdown`, which is a separate render from the `click` that flips
 * `data-on`, producing this on the first click of an OFF switch:
 *
 *   1. pointerdown -> is-init added, data-on still "false"
 *   2. that render matches `.t-toggle.is-init[data-on="false"]`, so
 *      `t-toggle-off` plays even though the thumb is already at rest at 0 —
 *      its 55% keyframe kicks the thumb to -1px, a visible backwards nudge
 *   3. click -> data-on flips to "true" and `t-toggle-on` takes over mid-flight
 *
 * i.e. the thumb appeared to jump on, snap back off, then travel on again.
 * Arming from the same handler that changes state collapses 1-3 into one
 * render, so no keyframe can run against a stale `data-on`.
 *
 * WHY IT IS PER-SWITCH. `.is-init` is what lets
 * `.t-toggle.is-init[data-on="false"]` fire `t-toggle-off` at all. A flag
 * shared across a panel's switches would gain `.is-init` on ALL of them in one
 * render, so every switch sitting at `data-on="false"` would immediately play
 * the off-bounce from a standing start — the whole panel flickering on one
 * click. Async settings hydration flipping several `data-on` values at once
 * hits the same rule. So: one `useToggleInit()` per rendered switch.
 *
 * Usage — `arm()` must be called from the state-changing handler:
 *   const toggleInit = useToggleInit();
 *   <button
 *     className={`t-toggle ${toggleInit.className} ...`}
 *     data-on={String(checked)}
 *     onClick={() => { toggleInit.arm(); setChecked(!checked); }}
 *   >
 *     <span className="t-toggle-thumb" aria-hidden="true" />
 *   </button>
 */
export interface ToggleInit {
    /** `'is-init'` once armed, else `''`. Drop straight into the class list. */
    className: string;
    /**
     * Call from the same handler that changes the switch's state, so `is-init`
     * and the new `data-on` land in one render. Idempotent.
     */
    arm: () => void;
}

export function useToggleInit(): ToggleInit {
    const [isInit, setIsInit] = useState(false);
    // Not guarded by a ref: setState with an unchanged value is already a no-op
    // for re-render purposes, and the ref only ever mirrored this same boolean.
    const arm = useCallback(() => { setIsInit(true); }, []);
    return { className: isInit ? 'is-init' : '', arm };
}
