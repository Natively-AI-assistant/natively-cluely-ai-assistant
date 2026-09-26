import React, { useEffect, useRef } from 'react';
import './LiquidGlassButton.css';

export type LiquidGlassVariant = 'neutral' | 'green' | 'action' | 'sky' | 'clear';

export interface LiquidGlassButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Which material tint to use. Each variant carries its own rim and lens
     * alphas. `action` reads the host app's own action tokens and has a derived
     * light-mode treatment; add `className="lg-sm"` for UI rather than hero scale.
     *
     * `clear` is the odd one out: it has no body of its own, so the host's
     * surface shows through and the rim is the only thing the material adds.
     * It is therefore the only variant that does NOT pin a label colour — it
     * takes `color: inherit` instead (a `<button>`'s UA default is
     * `buttontext`, not an inherited value), which is what lets one class
     * serve both themes. Give it a fixed colour and it stops doing that.
     */
    variant?: LiquidGlassVariant;
    /** Optional leading icon. Size it yourself — see design.md on aspect-locked SVGs. */
    icon?: React.ReactNode;
}

/**
 * Tracks the pointer across an element and publishes its position as
 * `--lg-mx` / `--lg-my`, which the lens mask reads.
 *
 * Two things are deliberate here:
 *
 *  - **Position is written raw, never eased.** Liquid Glass refracts toward
 *    whatever is nearest, so the highlight has to sit exactly under the
 *    cursor. Put a transition on these properties and it trails behind,
 *    reading as a delayed glow instead of a lens.
 *
 *  - **One write per frame.** `pointermove` fires faster than the display
 *    refreshes, and every extra write is a repaint nobody sees. The rAF gate
 *    collapses a burst of events into a single style write.
 *
 * Under `prefers-reduced-motion` the stylesheet pins the two properties with
 * `!important`, so these writes become inert without needing to tear the
 * listener down — which also means the setting takes effect live.
 */
export function useLensTracking<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const frame = useRef(0);

    useEffect(() => () => cancelAnimationFrame(frame.current), []);

    const onPointerMove = (event: React.PointerEvent<T>) => {
        // Read the pointer now: the callback runs after React has moved on.
        const { clientX, clientY } = event;
        if (frame.current) return;

        frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            const el = ref.current;
            if (!el) return;

            const box = el.getBoundingClientRect();
            if (!box.width || !box.height) return;

            // 1dp is well under a pixel at any realistic button size, and
            // keeps float noise (22.00000000000001%) out of the style write.
            const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
            el.style.setProperty('--lg-mx', pct((clientX - box.left) / box.width));
            el.style.setProperty('--lg-my', pct((clientY - box.top) / box.height));
        });
    };

    /*
      A keyboard focus has no pointer position, so clear whatever the last
      hover left behind and let the lens bloom from the centre. Guarded because
      :focus-visible throws a SyntaxError in engines that do not know it.
    */
    const onFocus = () => {
        const el = ref.current;
        if (!el) return;
        try {
            if (!el.matches(':focus-visible')) return;
        } catch {
            return;
        }
        // Drop any queued pointermove write, or it lands after this and puts
        // the bloom back where the pointer last was.
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        el.style.removeProperty('--lg-mx');
        el.style.removeProperty('--lg-my');
    };

    return { ref, onPointerMove, onFocus };
}

/**
 * A macOS 27 "Liquid Glass" pill button.
 *
 * The material is FLAT — the depth is a thin specular rim that is bright on
 * the top and bottom faces and dark along the rounded caps. `design.md` in
 * this folder documents how each value was measured and which ones are
 * load-bearing.
 *
 * ```tsx
 * <LiquidGlassButton variant="green" icon={<MutedBell />} onClick={unmute}>
 *     Unmute
 * </LiquidGlassButton>
 * ```
 */
export const LiquidGlassButton: React.FC<LiquidGlassButtonProps> = ({
    children,
    variant = 'neutral',
    icon,
    className = '',
    type = 'button',
    // Pulled out of `rest` so the lens can run alongside a caller's own
    // handlers instead of quietly overwriting them.
    onPointerMove: callerPointerMove,
    onFocus: callerFocus,
    ...rest
}) => {
    const { ref, onPointerMove, onFocus } = useLensTracking<HTMLButtonElement>();

    return (
        <button
            {...rest}
            ref={ref}
            type={type}
            className={`lg-button lg-${variant} ${className}`.trim()}
            onPointerMove={(event) => {
                onPointerMove(event);
                callerPointerMove?.(event);
            }}
            onFocus={(event) => {
                onFocus();
                callerFocus?.(event);
            }}
        >
            {/* Painted below the content and above the flat fill. ::before and
                ::after are already spoken for by the rim and the cap shadow,
                so the lens needs an element of its own. */}
            <span className="lg-lens" aria-hidden="true" />
            <span className="lg-content">
                {icon ? <span className="lg-icon" aria-hidden="true">{icon}</span> : null}
                <span className="lg-label">{children}</span>
            </span>
        </button>
    );
};

export default LiquidGlassButton;
