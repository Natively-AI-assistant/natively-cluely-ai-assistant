// The guide's liquid glass (Evin, 2026-11-15: "card isnt liquid glass, i want
// proper liquid glass with tint"). The app's Liquid Glass 2.0 stack
// (ui-components/liquidglas2.0/design.md), as the calendar banner builds it:
//
//   1. frost: the page behind, blurred and saturated, under a periwinkle tint.
//      A backdrop-filter of its own, because the lens's SVG filter alone left
//      the cards behind crisp and readable through the tip (seen live).
//   2. lens: GlassSurface, which bends that frosted backdrop at the rim, so the
//      edge reads as thick glass rather than a flat pane.
//   3. bevel, sheen and the directional edge: the 2.0 CTA's own layers (light
//      pooling inside the faces, the corner bloom, a rim lit from a corner).
//
// Purely decorative (aria-hidden, no pointer events); the host draws its
// content above it. Themed in guide.css (--gt-tint and the --cta-* tokens).
import React from 'react';
import GlassSurface from '../../ui-components/GlassSurface';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import '../../ui-components/liquidglas2.0/LiquidGlassCta.css';

export const GuideGlass: React.FC<{ radius: number }> = ({ radius }) => {
  const light = useResolvedTheme() === 'light';
  return (
    <span className="guide-glass" aria-hidden style={{ borderRadius: radius }}>
      <span className="guide-glass-frost" />
      <GlassSurface
        className="guide-glass-lens"
        contentClassName="glass-surface__content--bare"
        width="100%"
        height="100%"
        borderRadius={radius}
        borderWidth={0.18}
        brightness={55}
        opacity={0.9}
        blur={4}
        displace={1}
        tint="transparent"
        saturation={1.3}
        distortionScale={light ? -36 : -64}
        redOffset={0}
        greenOffset={0}
        blueOffset={0}
        xChannel="R"
        yChannel="B"
        mixBlendMode="screen"
      />
      <span className="glass-cta__bevel" />
      <span className="glass-cta__sheen" />
      <span className="glass-cta__edge" />
    </span>
  );
};
