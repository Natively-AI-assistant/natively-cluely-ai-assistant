import React, { useEffect, useRef } from 'react';
import './HeroGlassButton.css';

export type HeroGlassVariant =
    | 'neutral'
    | 'green'
    | 'action'
    | 'sky'
    /** Natively primary — lavender light material. See the theme block in the CSS. */
    | 'lavender'
    /** Natively secondary — the page's own white glass. */
    | 'paper';

export interface HeroGlassButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Which material tint to use. Each variant carries its own rim and lens
     * alphas. `action` reads the host app's own action tokens and has a derived
     * light-mode treatment; add `className="hlg-sm"` for UI rather than hero scale.
     */
    variant?: HeroGlassVariant;
    /** Optional leading icon. Size it yourself — see design.md on aspect-locked SVGs. */
    icon?: React.ReactNode;
    /**
     * Renders an `<a>` instead of a `<button>`. Half the page's CTAs are real
     * navigations (a download, an outbound link) and wrapping the button in an
     * anchor would nest two interactive elements.
     */
    href?: string;
    target?: string;
    rel?: string;
}

/**
 * Tracks the pointer across an element and publishes its position as
 * `--hlg-mx` / `--hlg-my`, which the lens mask reads.
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
            el.style.setProperty('--hlg-mx', pct((clientX - box.left) / box.width));
            el.style.setProperty('--hlg-my', pct((clientY - box.top) / box.height));
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
        el.style.removeProperty('--hlg-mx');
        el.style.removeProperty('--hlg-my');
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
 * <HeroGlassButton variant="green" icon={<MutedBell />} onClick={unmute}>
 *     Unmute
 * </HeroGlassButton>
 * ```
 */
export const HeroGlassButton: React.FC<HeroGlassButtonProps> = ({
    children,
    variant = 'neutral',
    icon,
    className = '',
    type = 'button',
    href,
    // Pulled out of `rest` so the lens can run alongside a caller's own
    // handlers instead of quietly overwriting them.
    onPointerMove: callerPointerMove,
    onFocus: callerFocus,
    ...rest
}) => {
    const { ref, onPointerMove, onFocus } = useLensTracking<HTMLElement>();

    const shared = {
        ...rest,
        className: `hlg-button hlg-${variant} ${className}`.trim(),
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
            onPointerMove(event);
            callerPointerMove?.(event as React.PointerEvent<HTMLButtonElement>);
        },
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
            onFocus();
            callerFocus?.(event as React.FocusEvent<HTMLButtonElement>);
        },
    };

    const body = (
        <>
            {/* Painted below the content and above the flat fill. ::before and
                ::after are already spoken for by the rim and the cap shadow,
                so the lens needs an element of its own. */}
            <span className="hlg-lens" aria-hidden="true" />
            <span className="hlg-content">
                {icon ? <span className="hlg-icon" aria-hidden="true">{icon}</span> : null}
                <span className="hlg-label">{children}</span>
            </span>
        </>
    );

    if (href !== undefined) {
        return (
            <a {...(shared as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>)} ref={ref as React.Ref<HTMLAnchorElement>} href={href}>
                {body}
            </a>
        );
    }

    return (
        <button {...(shared as React.ButtonHTMLAttributes<HTMLButtonElement>)} ref={ref as React.Ref<HTMLButtonElement>} type={type}>
            {body}
        </button>
    );
};

/** The same material as a non-interactive span, for when the surrounding link is the control. */
export const HeroGlassPill: React.FC<{
    variant?: HeroGlassVariant;
    icon?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}> = ({ variant = 'paper', icon, className = '', style, children }) => {
    const { ref, onPointerMove } = useLensTracking<HTMLSpanElement>();
    return (
        <span ref={ref} onPointerMove={onPointerMove} className={`hlg-button hlg-${variant} ${className}`.trim()} style={style}>
            <span className="hlg-lens" aria-hidden="true" />
            <span className="hlg-content">
                {children !== undefined && <span className="hlg-label">{children}</span>}
                {icon ? <span className="hlg-icon" aria-hidden="true">{icon}</span> : null}
            </span>
        </span>
    );
};

export default HeroGlassButton;
