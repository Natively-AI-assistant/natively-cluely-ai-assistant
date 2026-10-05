import React from 'react';
import './LiquidGlassButton.css';

export type LiquidGlassBadgeVariant = 'neutral' | 'green' | 'action' | 'sky';

export interface LiquidGlassBadgeProps
    extends React.HTMLAttributes<HTMLSpanElement> {
    /**
     * Which material tint to use. `neutral` is the default because a tag
     * qualifies the thing beside it rather than competing with it — and at
     * badge type sizes it is also the only variant that clears the AA
     * contrast floor comfortably (#fafafa on #555 is 7.4:1, against 3.68:1
     * for `action` in dark theme and 2.80:1 for `sky`).
     */
    variant?: LiquidGlassBadgeVariant;
    /**
     * Optional leading glyph, the same slot the button has. Size it yourself;
     * at tag scale the label is 9.5px, so a 10px icon sits level with it.
     */
    icon?: React.ReactNode;
}

/**
 * The Liquid Glass material as a static tag — "Beta", "New", "Included".
 *
 * Same material as {@link LiquidGlassButton} and the same stylesheet, at the
 * tag scale defined by `.lg-badge`; see design.md on why the rim, the lens
 * bloom and the type each need their own treatment at a smaller size rather
 * than scaling with the pill.
 *
 * Two deliberate differences from the button:
 *
 *  - **It is a `<span>`, and it carries no lens.** The lens is the button's
 *    affordance — a highlight that refracts toward the pointer. A tag has
 *    nothing to afford, so the element simply is not rendered and
 *    `useLensTracking` is never wired up.
 *
 *  - **It still carries the `lg-button` class.** Every rule in the stylesheet
 *    — the rim, the cap shadow, the variant tints, the contrast and
 *    reduced-motion treatments — is keyed to that class, and re-keying a
 *    stylesheet whose values were measured off a reference screenshot is a
 *    far larger change than reusing the name. `.lg-badge` then removes the
 *    parts that only make sense on a control.
 *
 * ```tsx
 * <LiquidGlassBadge>Beta</LiquidGlassBadge>
 * ```
 */
export const LiquidGlassBadge: React.FC<LiquidGlassBadgeProps> = ({
    children,
    variant = 'neutral',
    icon,
    className = '',
    ...rest
}) => (
    <span
        {...rest}
        className={`lg-button lg-badge lg-${variant} ${className}`.trim()}
    >
        <span className="lg-content">
            {icon ? <span className="lg-icon" aria-hidden="true">{icon}</span> : null}
            <span className="lg-label">{children}</span>
        </span>
    </span>
);

export default LiquidGlassBadge;
