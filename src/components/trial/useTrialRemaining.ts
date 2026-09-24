import { useEffect, useState } from 'react';

// ─── Trial countdown ─────────────────────────────────────────
// A hook, not a component. This was an 11px clock chip in the section label's
// `aside` — the right size for a status pill sitting beside three usage
// meters. With the meters gone (see the active-trial card) the time IS the
// card's statement, so the caller needs the value, not a rendering of it.
//
// Lives here rather than in NativelyApiSettings because FreeTrialModal needs the
// same clock: that panel already imports the modal, so the modal cannot import
// back without a cycle. One implementation, so the card and the modal can never
// disagree about how much trial is left.
export function useTrialRemaining(expiresAt: string) {
    const [remaining, setRemaining] = useState(() =>
        Math.max(0, new Date(expiresAt).getTime() - Date.now()),
    );
    useEffect(() => {
        const id = setInterval(() => {
            setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
        }, 1000);
        return () => clearInterval(id);
    }, [expiresAt]);
    const totalSec = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return {
        /** `19:04`. Seconds are zero-padded so the string never changes width. */
        clock: `${m}:${s.toString().padStart(2, '0')}`,
        ended: remaining === 0,
        /** The last two minutes, where the number stops being background. */
        isWarning: remaining < 2 * 60 * 1000,
    };
}
