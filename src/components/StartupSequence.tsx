import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsPresent } from 'framer-motion';
import appIcon from './icon.png';
import { prepareSplash, renderSplash, type SplashScene } from './startup/splashRenderer';
import {
    EXIT_MS, SPLASH_DISMISS_MS, SPLASH_HARD_CAP_MS, SPLASH_REDUCED_MOTION_DISMISS_MS, SPLASH_SETTLE_MS, backdropAt,
} from './startup/splashTimeline';

interface StartupSequenceProps {
    onComplete: () => void;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// The canvas is backed at the display's scale, up to 2x and up to this many
// pixels: a maximised launcher on a 5K display would otherwise ask for a 50 MP
// canvas to draw a few thousand small characters.
const MAX_CANVAS_PIXELS = 8_000_000;

const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete }) => {
    // Keep the latest onComplete in a ref so the timer effect can depend on []
    // and arm EXACTLY ONCE for the splash's lifetime. If the effect depended on
    // `onComplete` directly, an un-memoized caller (a new closure per parent
    // re-render) would tear down and re-arm both timers on every render — and
    // the boot path re-renders many times — so the 5s hard-cap safety net could
    // keep resetting and never fire, trapping the user at the black splash. The
    // ref makes the safety net immune to prop-identity churn regardless of how
    // the caller passes onComplete.
    const onCompleteRef = React.useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        // Primary dismiss: once nothing visible is still moving (the ring's faint
        // tail plays out under the exit). These are timers on purpose —
        // Chromium stops requestAnimationFrame for a covered window, and the
        // splash must still hand over to the launcher there.
        const timer = setTimeout(() => {
            onCompleteRef.current();
        }, prefersReducedMotion() ? SPLASH_REDUCED_MOTION_DISMISS_MS : SPLASH_DISMISS_MS);
        // Hard-cap safety net: no matter what, the splash must never persist past
        // 5s. If the primary timer's onComplete is ever prevented from advancing
        // the app (e.g. a throw upstream, a dropped state update), this guarantees
        // the launcher is revealed rather than leaving the user staring at the
        // black logo — the "stuck at logo" failure mode. Idempotent: onComplete
        // just flips showStartup=false, so a double-call is harmless.
        const hardCap = setTimeout(() => {
            try { onCompleteRef.current(); } catch { /* never let the splash trap the user */ }
        }, SPLASH_HARD_CAP_MS);
        return () => {
            clearTimeout(timer);
            clearTimeout(hardCap);
        };
        // Mount-once: arm the dismissal timers a single time. onComplete is read
        // through onCompleteRef so it is intentionally NOT a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    // If the canvas cannot be set up, the splash is the plain logo: it must
    // never be the reason the app shows a blank window.
    const [plain, setPlain] = useState(false);
    // The drawn exit starts when AnimatePresence starts removing the splash, not at
    // the dismiss time: App can hold the splash past it (the welcome gate). App
    // keeps the splash mounted for EXIT_MS and removes it; nothing here can delay that.
    const isPresent = useIsPresent();
    const boxRef = useRef<HTMLDivElement>(null);
    const exitAt = useRef(-1);
    const wake = useRef<() => void>(() => {});
    useEffect(() => {
        if (isPresent || exitAt.current >= 0) return;
        exitAt.current = performance.now();
        const box = boxRef.current;
        if (!box) return;
        if (plain || prefersReducedMotion()) {
            // no drawn exit: the still frame simply fades
            box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' });
            return;
        }
        // From here the canvas paints the backdrop itself, and lets it clear so
        // the launcher shows behind the dissolving logo.
        box.style.background = 'transparent';
        wake.current();
    }, [isPresent, plain]);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            setPlain(true);
            return;
        }
        const reduced = prefersReducedMotion();
        const startedAt = performance.now();
        let scene: SplashScene | null = null;
        let raf = 0;

        const draw = () => {
            raf = 0;
            if (!scene) return;
            // reduced motion: the settled frame, once
            const now = performance.now(), t = reduced ? SPLASH_SETTLE_MS : now - startedAt;
            const exitT = reduced || exitAt.current < 0 ? -1 : now - exitAt.current;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = exitT < 0 ? 1 : backdropAt(exitT);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            renderSplash(ctx, scene, t, exitT);
            // from the settle on the frame no longer changes until the exit, so stop asking for frames
            if (t < SPLASH_SETTLE_MS || (exitT >= 0 && exitT < EXIT_MS)) raf = requestAnimationFrame(draw);
        };
        const layout = () => {
            // The layout size, not getBoundingClientRect: a transform on an
            // ancestor must never resize the backing store.
            const width = canvas.clientWidth, height = canvas.clientHeight;
            if (width < 1 || height < 1) return;
            const scale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (width * height))));
            const W = Math.round(width * scale), H = Math.round(height * scale);
            if (scene && canvas.width === W && canvas.height === H) return;
            try {
                canvas.width = W;
                canvas.height = H;
                scene = prepareSplash(W, H, scale);
            } catch (err) {
                console.warn('[StartupSequence] character splash unavailable, showing the plain logo', err);
                scene = null;
                setPlain(true);
                return;
            }
            if (raf) cancelAnimationFrame(raf);
            draw();
        };

        layout();
        // Reduced motion gets the settled frame with no movement, but not a hard
        // cut: App no longer fades the splash in, so the still frame fades in here.
        if (reduced) canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
        wake.current = () => { if (!raf) draw(); };
        const resize = new ResizeObserver(layout);
        resize.observe(canvas);
        return () => {
            wake.current = () => {};
            resize.disconnect();
            if (raf) cancelAnimationFrame(raf);
        };
    }, []);

    return (
        <div ref={boxRef} className="fixed inset-0 z-[100] bg-[#000000] flex items-center justify-center overflow-hidden">
            {plain ? (
                <img src={appIcon} alt="Natively" className="w-24 h-24 object-contain" />
            ) : (
                <canvas ref={canvasRef} role="img" aria-label="Natively" className="absolute inset-0 w-full h-full block" />
            )}
        </div>
    );
};

export default StartupSequence;
