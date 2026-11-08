import React, { useEffect, useState } from 'react';

/**
 * The notepad's popups as Granola's (2026-10-20): in and out over 75 ms,
 * scaling from .95 and fading, from the corner they open on. Kept on screen
 * through the out half, then removed. Platform-independent.
 */
export const POP_MS = 75;

export function usePresence(open: boolean, ms = POP_MS): { mounted: boolean; closing: boolean } {
    const [mounted, setMounted] = useState(open);
    useEffect(() => {
        if (open) { setMounted(true); return; }
        if (!mounted) return;
        const t = setTimeout(() => setMounted(false), ms);
        return () => clearTimeout(t);
    }, [open, ms, mounted]);
    return { mounted: open || mounted, closing: !open && mounted };
}

type NpPopProps = React.HTMLAttributes<HTMLDivElement> & { open: boolean; origin: string };

export const NpPop = React.forwardRef<HTMLDivElement, NpPopProps>(({ open, origin, className, style, children, ...rest }, ref) => {
    const { mounted, closing } = usePresence(open);
    if (!mounted) return null;
    return (
        <div
            ref={ref}
            {...rest}
            data-closing={closing ? '' : undefined}
            className={`np-pop ${className ?? ''}`}
            style={{ transformOrigin: origin, ...style }}
        >
            {children}
        </div>
    );
});
NpPop.displayName = 'NpPop';
