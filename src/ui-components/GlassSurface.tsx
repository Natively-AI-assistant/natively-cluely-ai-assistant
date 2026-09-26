import React, {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';
import './GlassSurface.css';

export type GlassChannel = 'R' | 'G' | 'B' | 'A';

export interface GlassSurfaceProps {
    children?: ReactNode;
    /** Box size. A number is px; a string is used verbatim (`'100%'`). */
    width?: number | string;
    height?: number | string;
    /** Corner radius in px. Also the `rx` of the rects in the displacement map. */
    borderRadius?: number;
    /**
     * Thickness of the refracting edge, as a FRACTION of the box's short side.
     * The lens rect in the map is inset by `min(w, h) * borderWidth * 0.5`, so
     * on a short pill this is a couple of px — see `blur` below.
     */
    borderWidth?: number;
    /** Lightness of the lens rect in the map (0–100). */
    brightness?: number;
    /** Alpha of the lens rect in the map (0–1). */
    opacity?: number;
    /**
     * Blur applied to the lens rect INSIDE the map, in px. This is the value
     * that most often needs to come down on a short element: the default is
     * tuned for a ~200x80 card, and a blur wider than the inset washes the
     * edge gradient flat, which is the whole effect.
     */
    blur?: number;
    /** stdDeviation of the final blur on the displaced result. */
    displace?: number;
    /** Alpha of the flat tint painted under the refraction. Ignored when
     *  {@link GlassSurfaceProps.tint} is given. */
    backgroundOpacity?: number;
    /**
     * The flat fill painted over the refracted backdrop, as a complete CSS
     * colour — hue and alpha both. Overrides `backgroundOpacity`, and applies
     * in BOTH themes, so a host that sets it owns the light value too.
     *
     * Without it the fill is black in dark theme and white in light, which is
     * only right when the surface behind is on the far side of the pane from
     * where the glass wants to sit. Over a dark page a black fill reads as a
     * hole punched in it; pass the host's own raised-surface colour instead.
     */
    tint?: string;
    /** Saturation multiplier applied alongside the displacement. */
    saturation?: number;
    /** How hard the backdrop is pushed. Negative pulls inward. */
    distortionScale?: number;
    /** Per-channel scale offsets — the spread between them IS the chromatic fringe. */
    redOffset?: number;
    greenOffset?: number;
    blueOffset?: number;
    xChannel?: GlassChannel;
    /**
     * Which channel of the map drives the VERTICAL push. Upstream defaults to
     * `'G'`, and the map paints no green at all — so `G` is a flat 0 and the
     * vertical displacement is a CONSTANT `-scale / 2` across the whole band.
     * That offsets the backdrop rather than bending it, which on text reads as
     * a duplicated smear. `'B'` is the vertical alpha ramp the map already
     * draws, and gives a real gradient: the band compresses toward the middle
     * the way a lens does. The default is left at `'G'` so the component still
     * matches the API it was ported from; pass `'B'` when the surface sits
     * over text.
     */
    yChannel?: GlassChannel;
    mixBlendMode?: CSSProperties['mixBlendMode'];
    className?: string;
    /** Class for the inner content box. `'glass-surface__content--bare'` drops
     *  its centring and padding when the host lays its own children out. */
    contentClassName?: string;
    style?: CSSProperties;
}

/**
 * Detects whether this engine will accept an SVG filter reference as a
 * `backdrop-filter`.
 *
 * Caveat worth knowing before you trust a green result: this only proves the
 * value PARSES. `div.style.backdropFilter !== ''` is true for any syntactically
 * valid value, whether or not the compositor honours the filter. The two
 * engines that parse it and then ignore it are excluded by name, which is what
 * the userAgent sniff is for — Chromium, which is all this app ever runs on,
 * renders it properly.
 */
const supportsSVGFilters = (filterId: string): boolean => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }

    const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);
    if (isWebkit || isFirefox) return false;

    const div = document.createElement('div');
    div.style.backdropFilter = `url(#${filterId})`;
    return div.style.backdropFilter !== '';
};

/**
 * A pane of glass with actual thickness: the backdrop behind it is displaced
 * toward the edges by an SVG map, so content scrolling underneath bends as it
 * passes the rim instead of merely blurring.
 *
 * Sibling material to {@link LiquidGlassButton} — that one is the measured
 * macOS 27 pill (flat body, thin specular rim, see design.md). This one is the
 * refractive variant, ported from React Bits. Reach for the button when the
 * thing IS a control; reach for this when a surface sits over moving content
 * and you want the movement to show through it.
 *
 * Three things this port changes, each for a reason the upstream could not
 * have known about:
 *
 *  - **The support probe runs during the first render, not after it.** It was
 *    a `useState(false)` plus a mount effect, which paints one frame of the
 *    fallback material before flipping. Cheap-looking, except the surfaces
 *    that want this component tend to mount DURING a page transition, so that
 *    frame lands mid-animation where it is very visible.
 *
 *  - **The id is sanitised to `[A-Za-z0-9_-]`.** React 19's `useId` returns
 *    `«r0»`, not React 18's `:r0:`, so upstream's `replace(/:/g, '-')` leaves
 *    the guillemets in an id that then has to survive a CSS `url(#…)`.
 *
 *  - **Theming is keyed to `[data-theme]`**, not to the OS colour scheme.
 *    See the header of GlassSurface.css.
 *
 * ```tsx
 * <GlassSurface width="100%" height={48} borderRadius={24}>
 *     <span>Ask about this meeting…</span>
 * </GlassSurface>
 * ```
 */
const GlassSurface: React.FC<GlassSurfaceProps> = ({
    children,
    width = 200,
    height = 80,
    borderRadius = 20,
    borderWidth = 0.07,
    brightness = 50,
    opacity = 0.93,
    blur = 11,
    displace = 0,
    backgroundOpacity = 0,
    tint,
    saturation = 1,
    distortionScale = -180,
    redOffset = 0,
    greenOffset = 10,
    blueOffset = 20,
    xChannel = 'R',
    yChannel = 'G',
    mixBlendMode = 'difference',
    className = '',
    contentClassName = '',
    style = {},
}) => {
    // React 19 ids are «r0»; strip anything that is not id-safe rather than
    // only the colons React 18 used to emit.
    const uniqueId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const filterId = `glass-filter-${uniqueId}`;
    const redGradId = `red-grad-${uniqueId}`;
    const blueGradId = `blue-grad-${uniqueId}`;

    // Resolved once, during the first render, so the fallback material never
    // paints on a engine that can do the real thing.
    const [svgSupported] = useState(() => supportsSVGFilters(filterId));

    const containerRef = useRef<HTMLDivElement | null>(null);
    const feImageRef = useRef<SVGFEImageElement | null>(null);
    const redChannelRef = useRef<SVGFEDisplacementMapElement | null>(null);
    const greenChannelRef = useRef<SVGFEDisplacementMapElement | null>(null);
    const blueChannelRef = useRef<SVGFEDisplacementMapElement | null>(null);
    const gaussianBlurRef = useRef<SVGFEGaussianBlurElement | null>(null);

    /**
     * The map itself: a black field, a red ramp across X, a blue ramp down Y,
     * and a bright rect inset from the edges. feDisplacementMap reads the red
     * channel as the X push and the green as the Y, so the ramps are what bend
     * the backdrop outward and the inset rect is what leaves the middle of the
     * pane undistorted.
     */
    const generateDisplacementMap = useCallback(() => {
        // offsetWidth/Height, NOT getBoundingClientRect: the rect is the
        // TRANSFORMED box, and a surface that mounts inside a page transition
        // is mid-scale when this first runs — which bakes the map at, say,
        // 435px for a 440px pill and never regenerates, because a transform
        // does not move the layout box a ResizeObserver watches.
        const el = containerRef.current;
        const actualWidth = el?.offsetWidth || 400;
        const actualHeight = el?.offsetHeight || 200;
        const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5);

        const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"></rect>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})" />
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${mixBlendMode}" />
        <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)" />
      </svg>
    `;

        return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
    }, [borderWidth, borderRadius, mixBlendMode, brightness, opacity, blur, redGradId, blueGradId]);

    const updateDisplacementMap = useCallback(() => {
        feImageRef.current?.setAttribute('href', generateDisplacementMap());
    }, [generateDisplacementMap]);

    // Layout effect so the map is in place before the first paint — an feImage
    // with no href renders as a transparent black map, i.e. a visible flash of
    // un-refracted surface.
    useLayoutEffect(() => {
        updateDisplacementMap();

        ([
            [redChannelRef, redOffset],
            [greenChannelRef, greenOffset],
            [blueChannelRef, blueOffset],
        ] as const).forEach(([ref, offset]) => {
            const node = ref.current;
            if (!node) return;
            node.setAttribute('scale', (distortionScale + offset).toString());
            node.setAttribute('xChannelSelector', xChannel);
            node.setAttribute('yChannelSelector', yChannel);
        });

        gaussianBlurRef.current?.setAttribute('stdDeviation', displace.toString());
    }, [
        updateDisplacementMap,
        width,
        height,
        displace,
        distortionScale,
        redOffset,
        greenOffset,
        blueOffset,
        xChannel,
        yChannel,
    ]);

    // The map is generated in the box's own pixels, so any resize the props do
    // not describe — a percentage width, a window resize, a font swap — has to
    // regenerate it too.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let frame: number | null = null;
        const observer = new ResizeObserver(() => {
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                updateDisplacementMap();
            });
        });
        observer.observe(el);

        return () => {
            observer.disconnect();
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [updateDisplacementMap]);

    const containerStyle: CSSProperties = {
        ...style,
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: `${borderRadius}px`,
        ['--glass-frost' as string]: backgroundOpacity,
        ...(tint ? { ['--glass-tint' as string]: tint } : null),
        ['--glass-saturation' as string]: saturation,
        ['--filter-id' as string]: `url(#${filterId})`,
    };

    return (
        <div
            ref={containerRef}
            className={`glass-surface ${svgSupported ? 'glass-surface--svg' : 'glass-surface--fallback'} ${className}`.trim()}
            style={containerStyle}
        >
            <svg className="glass-surface__filter" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                <defs>
                    <filter id={filterId} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
                        <feImage ref={feImageRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />

                        {/* Each channel is displaced by its own scale and then
                            masked back down to that one channel; screening the
                            three together is what produces the coloured fringe
                            at the rim. Offsets of 0 collapse it to a clean,
                            achromatic bend. */}
                        <feDisplacementMap ref={redChannelRef} in="SourceGraphic" in2="map" result="dispRed" />
                        <feColorMatrix
                            in="dispRed"
                            type="matrix"
                            values="1 0 0 0 0
                                    0 0 0 0 0
                                    0 0 0 0 0
                                    0 0 0 1 0"
                            result="red"
                        />

                        <feDisplacementMap ref={greenChannelRef} in="SourceGraphic" in2="map" result="dispGreen" />
                        <feColorMatrix
                            in="dispGreen"
                            type="matrix"
                            values="0 0 0 0 0
                                    0 1 0 0 0
                                    0 0 0 0 0
                                    0 0 0 1 0"
                            result="green"
                        />

                        <feDisplacementMap ref={blueChannelRef} in="SourceGraphic" in2="map" result="dispBlue" />
                        <feColorMatrix
                            in="dispBlue"
                            type="matrix"
                            values="0 0 0 0 0
                                    0 0 0 0 0
                                    0 0 1 0 0
                                    0 0 0 1 0"
                            result="blue"
                        />

                        <feBlend in="red" in2="green" mode="screen" result="rg" />
                        <feBlend in="rg" in2="blue" mode="screen" result="output" />
                        <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="0.7" />
                    </filter>
                </defs>
            </svg>

            <div className={`glass-surface__content ${contentClassName}`.trim()}>{children}</div>
        </div>
    );
};

export default GlassSurface;
