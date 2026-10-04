import { useEffect, useRef } from 'react';

// ─── Trial expiry ────────────────────────────────────────────
// The 0:00 hand-over to Trial ended, without waiting for a server poll (never,
// offline). It used to ride on the countdown banner's clock; the banner is gone
// and this is what it left behind.
//
// No state, unlike useTrialRemaining: nothing here is drawn, and the caller is
// App, which must not re-render every second. The wall clock is re-read each
// second rather than slept on with one long timeout, so a machine that wakes
// after the expiry hands over within a second.
export function useTrialExpiry(expiresAt: string | null, onExpired: () => void) {
    const onExpiredRef = useRef(onExpired);
    onExpiredRef.current = onExpired;
    useEffect(() => {
        if (expiresAt === null) return;
        // Once per trial: a new expiresAt runs this effect again.
        let reported = false;
        let id: ReturnType<typeof setInterval> | null = null;
        const tick = () => {
            if (new Date(expiresAt).getTime() - Date.now() > 0) return;
            if (id) { clearInterval(id); id = null; }
            if (!reported) { reported = true; onExpiredRef.current(); }
        };
        id = setInterval(tick, 1000);
        tick();
        return () => { if (id) clearInterval(id); };
    }, [expiresAt]);
}
