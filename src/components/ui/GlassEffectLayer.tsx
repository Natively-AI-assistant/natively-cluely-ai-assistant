/**
 * GlassEffectLayer — animated specular rim for liquid-glass mode.
 *
 * Blur is no longer the responsibility of this component (or any CSS): the
 * Electron BrowserWindow now uses macOS `vibrancy: 'under-window'` and
 * Windows `backgroundMaterial: 'acrylic'` to produce real OS-level blur of
 * desktop content behind the transparent overlay.  That's the only reliable
 * way to get authentic glass blur in an Electron transparent window.
 *
 * This component delivers the *visible* glass character on top of that blur:
 * two stacked border rings using the liquid-glass-react mask-composite trick.
 *   • Layer 1 — mix-blend-mode: screen, opacity 0.2.
 *   • Layer 2 — mix-blend-mode: overlay, full opacity.
 *
 * Both rings share a linear-gradient that rotates with cursor position
 * (angle = 135 + mouseOffset.x × 1.2), giving the live sweeping specular sheen
 * that makes the glass feel alive.  RAF-throttled.
 */
import React, { type CSSProperties, useEffect, useRef, useState } from 'react';

export interface GlassEffectLayerProps {
    /** Ref to the shell element — used for mouse-relative offset calculation. */
    parentRef: React.RefObject<HTMLElement | null>;
    /** Shell border-radius in px — matches mask geometry. */
    cornerRadius?: number;
}

const GlassEffectLayer: React.FC<GlassEffectLayerProps> = ({
    parentRef,
    cornerRadius = 24,
}) => {
    const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
    const rafIdRef   = useRef<number | null>(null);
    const pendingRef = useRef({ x: 0, y: 0 });

    // RAF-throttled mouse offset (percent from element center, -50..50 range).
    useEffect(() => {
        const el = parentRef.current;
        if (!el) return;

        const update = () => {
            rafIdRef.current = null;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const cx = rect.left + rect.width  / 2;
            const cy = rect.top  + rect.height / 2;
            setMouseOffset({
                x: ((pendingRef.current.x - cx) / rect.width)  * 100,
                y: ((pendingRef.current.y - cy) / rect.height) * 100,
            });
        };
        const onMove = (e: MouseEvent) => {
            pendingRef.current.x = e.clientX;
            pendingRef.current.y = e.clientY;
            if (rafIdRef.current === null) rafIdRef.current = requestAnimationFrame(update);
        };

        document.addEventListener('mousemove', onMove);
        return () => {
            document.removeEventListener('mousemove', onMove);
            if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        };
    }, [parentRef]);

    // Sheen gradient — values lifted directly from liquid-glass-react.
    const gradAngle  = (135 + mouseOffset.x * 1.2).toFixed(2);
    const gradStop1  = Math.max(10, 33 + mouseOffset.y * 0.3).toFixed(2);
    const gradStop2  = Math.min(90, 66 + mouseOffset.y * 0.4).toFixed(2);
    const opacityA_1 = (0.12 + Math.abs(mouseOffset.x) * 0.008).toFixed(3);
    const opacityA_2 = (0.40 + Math.abs(mouseOffset.x) * 0.012).toFixed(3);
    const opacityB_1 = (0.32 + Math.abs(mouseOffset.x) * 0.008).toFixed(3);
    const opacityB_2 = (0.60 + Math.abs(mouseOffset.x) * 0.012).toFixed(3);

    const ringBase: CSSProperties = {
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
        borderRadius: `${cornerRadius}px`,
        padding: '1.5px',
        // mask-composite trick: shows only the 1.5px padding ring.
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        boxShadow:
            '0 0 0 0.5px rgba(255,255,255,0.5) inset, ' +
            '0 1px 3px rgba(255,255,255,0.25) inset, ' +
            '0 1px 4px rgba(0,0,0,0.35)',
    };

    return (
        <>
            {/* Border ring layer 1 — screen blend, low opacity */}
            <span
                aria-hidden="true"
                style={{
                    ...ringBase,
                    mixBlendMode: 'screen',
                    opacity: 0.2,
                    background:
                        `linear-gradient(${gradAngle}deg, ` +
                        `rgba(255,255,255,0) 0%, ` +
                        `rgba(255,255,255,${opacityA_1}) ${gradStop1}%, ` +
                        `rgba(255,255,255,${opacityA_2}) ${gradStop2}%, ` +
                        `rgba(255,255,255,0) 100%)`,
                }}
            />

            {/* Border ring layer 2 — overlay blend, stronger opacity */}
            <span
                aria-hidden="true"
                style={{
                    ...ringBase,
                    mixBlendMode: 'overlay',
                    background:
                        `linear-gradient(${gradAngle}deg, ` +
                        `rgba(255,255,255,0) 0%, ` +
                        `rgba(255,255,255,${opacityB_1}) ${gradStop1}%, ` +
                        `rgba(255,255,255,${opacityB_2}) ${gradStop2}%, ` +
                        `rgba(255,255,255,0) 100%)`,
                }}
            />
        </>
    );
};

export default GlassEffectLayer;
