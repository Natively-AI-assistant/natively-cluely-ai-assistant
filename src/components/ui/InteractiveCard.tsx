import React, { useRef } from 'react';
import { motion, useReducedMotion, useMotionValue, useTransform, useSpring } from 'framer-motion';

// Shared hover primitive for the purchase cards in Plans & Billing.
//
// Extracted from NativelyProSettings so the Natively API tier card can use the
// SAME hover as the Pro cards. The visible part of that hover is not CSS: it is
// a cursor-tracked radial spotlight plus a press-scale spring. A CSS-only
// imitation on :hover can copy the shadow geometry, but never the glow that
// follows the pointer, which is the part people actually notice.
//
// The old rotateX/rotateY springs were dropped in the move: they were computed
// on every mousemove and never applied to any element, so the "3D tilt" this
// was named for never actually happened. Only `scale` was ever consumed.

export interface InteractiveCardProps {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    role?: string;
    tabIndex?: number;
    'aria-pressed'?: boolean;
    'data-active'?: string;
    style?: React.CSSProperties;
    glowColor?: string;
    /**
     * Unmounts the cursor-tracked glow. `useTransform` rebuilds a
     * `radial-gradient(...)` string and writes it to `style.background` on EVERY
     * frame, and the position spring keeps doing so for ~360ms after the pointer
     * last moved — a continuous re-raster of a large masked layer. That is the
     * single most expensive per-frame paint in this panel, and it is pure waste
     * during a layout transition: the pointer is on the Save or Remove button at
     * that moment, not on a tier card.
     */
    suspendGlow?: boolean;
}

export function InteractiveCard({
    children,
    className = '',
    onClick,
    glowColor = 'rgba(59, 130, 246, 0.15)',
    suspendGlow = false,
    style,
    ...props
}: InteractiveCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    // Mouse coordinates (0 to 1)
    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);

    // Spotlight positions (0% to 100%).
    // 120/22 is critically damped (ζ = 1.00): it settles in ~360ms with NO
    // overshoot. The previous 200/20 was ζ ≈ 0.71, which overshoots about 4% —
    // imperceptible on a box, but on a light source it reads as a wobble. Slower
    // and smoother at once, so the glow trails the cursor like it has weight.
    const spotlightX = useSpring(useTransform(mouseX, [0, 1], [0, 100]), { stiffness: 120, damping: 22 });
    const spotlightY = useSpring(useTransform(mouseY, [0, 1], [0, 100]), { stiffness: 120, damping: 22 });


    // Tactile press scale spring. 400/30 is ζ = 0.75 — about as fast as the old
    // 450/14 (~90ms) but without its pronounced bounce, which on a card this
    // large read as toy-like.
    // Deliberately NOT slowed down with everything else: press feedback is the
    // one channel that has to stay immediate, and it is the contrast against the
    // now-slower ambient channels that makes the press read as crisp.
    const scale = useSpring(1, { stiffness: 400, damping: 30 });

    const readPointer = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = cardRef.current!.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
        };
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (prefersReducedMotion || !cardRef.current) return;
        const { x, y } = readPointer(e);
        mouseX.set(x);
        mouseY.set(y);
    };

    // The spring must smooth movement WITHIN the card, never the arrival at it.
    // Entering used to start the spring from wherever it was last left (0.5/0.5
    // after any previous exit), so the glow swooshed out from the middle to meet
    // the cursor every single time — the most visible seam in the hover.
    // `jump` writes the spring's current value without animating it.
    const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
        if (prefersReducedMotion || !cardRef.current) return;
        const { x, y } = readPointer(e);
        mouseX.set(x);
        mouseY.set(y);
        spotlightX.jump(x * 100);
        spotlightY.jump(y * 100);
    };

    // Deliberately does NOT re-centre the spotlight. It used to set mouseX/mouseY
    // back to 0.5, which starts a ~450ms spring toward the middle while the
    // overlay is fading out over a shorter window — so the glow visibly slid
    // across the card after the pointer had already gone. Leaving the position
    // untouched means the fade is the only thing that happens on exit, and the
    // next enter jumps straight to the new pointer anyway.
    const handleMouseLeave = () => {
        scale.set(1);
    };

    const handleMouseDown = () => {
        if (prefersReducedMotion) return;
        scale.set(0.97); // Emil's recommendation for press scale
    };

    const handleMouseUp = () => {
        scale.set(1);
    };

    const dynamicStyle = prefersReducedMotion
        ? {}
        : {
              scale,
          };

    // `transparent 100%`, not 80%: at 80% the gradient hit zero at 144px rather
    // than 180px, a steeper slope that made the glow read as a cone with a
    // visible boundary. Running the falloff to the full radius is shallower and
    // lowers alpha at every intermediate radius, which also means less tint over
    // whatever ink sits beneath it.
    const spotlightBg = useTransform(
        [spotlightX, spotlightY],
        ([x, y]) => `radial-gradient(circle 180px at ${x}% ${y}%, ${glowColor}, transparent 100%)`
    );

    return (
        <motion.div
            ref={cardRef}
            className={`${className} perspective-1000`}
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={onClick}
            style={{ ...style, ...dynamicStyle }}
            {...props}
        >
            {/* z-0, not z-10: the glow belongs IN the card's material, under the
                blueprint grid and the content, not washed over the ink.
                Everything else about this overlay's paint — the edge mask that
                stops the gradient reaching the rim, and the asymmetric
                enter/leave opacity timing — lives in `.natively-interactive-glow`
                in index.css, so the mask and both halves of the transition are
                readable in one place. An inline `transition` here would also be
                outranked by the `!important` ones there. */}
            {!suspendGlow && (
            <motion.div
                className="natively-interactive-glow absolute inset-0 pointer-events-none z-0 opacity-0 group-hover:opacity-100"
                style={{
                    background: prefersReducedMotion
                        // Reduced motion means gentler, not absent: a fixed centred
                        // glow still marks the hover, it just doesn't track.
                        ? `radial-gradient(circle 180px at 50% 50%, ${glowColor}, transparent 100%)`
                        : spotlightBg,
                }}
            />
            )}
            {children}
        </motion.div>
    );
}
