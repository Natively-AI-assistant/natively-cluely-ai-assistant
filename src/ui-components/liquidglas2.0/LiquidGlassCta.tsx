import React from 'react';
import GlassSurface from '../GlassSurface';
import './LiquidGlassCta.css';

export interface LiquidGlassCtaProps {
    /** Box width in px. The refraction map is drawn in the box's own pixels. */
    width: number;
    /** Box height in px; the silhouette is a pill (radius = height / 2). */
    height?: number;
    /** Label size in px. */
    labelSize?: number;
    onClick: () => void;
    children: React.ReactNode;
}

/**
 * The hero call-to-action in the REFRACTIVE Liquid Glass material — the
 * translucent lens of Figma's community "Liquid Glass Button", as opposed to
 * {@link LiquidGlassButton}'s measured flat-body pill (see ./design.md).
 *
 * Four things make it read as glass rather than a purple plate, and the last is
 * easy to forget:
 *
 *  1. a TINTED, translucent body — the page shows through it;
 *  2. a real displacement of the backdrop toward the rim ({@link GlassSurface});
 *  3. a directional edge: a bright hairline on the top-left and bottom-right,
 *     an inner bevel, and a specular bloom;
 *  4. something LUMINOUS BEHIND IT. Glass over a flat page has nothing to bend,
 *     so the CTA carries its own aura: two soft light pools (lavender, blue)
 *     for the lens to refract. Curved lines behind it were tried and dropped.
 */
export const LiquidGlassCta: React.FC<LiquidGlassCtaProps> = ({
    width,
    height = 48,
    labelSize = 15,
    onClick,
    children,
}) => {
    const radius = height / 2;
    return (
        <span className="glass-cta-wrap" style={{ width, height }}>
            <span className="glass-cta-aura" aria-hidden="true">
                <i className="glass-cta-aura__pool glass-cta-aura__pool--a" />
                <i className="glass-cta-aura__pool glass-cta-aura__pool--b" />
            </span>
            <button
                type="button"
                className="glass-cta"
                onClick={onClick}
                style={{ width, height, borderRadius: radius, fontSize: labelSize }}
            >
                <GlassSurface
                    className="glass-cta__glass"
                    contentClassName="glass-surface__content--bare"
                    width={width}
                    height={height}
                    borderRadius={radius}
                    borderWidth={0.3}
                    brightness={55}
                    opacity={0.9}
                    blur={3}
                    saturation={1.7}
                    distortionScale={-46}
                    redOffset={0}
                    greenOffset={0}
                    blueOffset={0}
                    xChannel="R"
                    yChannel="B"
                    mixBlendMode="screen"
                />
                <span className="glass-cta__bevel" aria-hidden="true" />
                <span className="glass-cta__sheen" aria-hidden="true" />
                <span className="glass-cta__edge" aria-hidden="true" />
                <span className="glass-cta__label">{children}</span>
            </button>
        </span>
    );
};

export default LiquidGlassCta;
