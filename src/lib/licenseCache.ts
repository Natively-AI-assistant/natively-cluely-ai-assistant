// Last known license state, remembered ACROSS RESTARTS.
//
// WHY THIS EXISTS. Whether Pro came from a standalone Yearly/Lifetime licence
// or bundled with a Natively API plan is settled at activation time and does
// not change until the user pastes a different key. But the Plans & Billing tab
// re-derives it asynchronously on every open, from two independent
// `licenseGetDetails()` calls (PlansSettings, to decide whether to collapse the
// app-only-licence section; NativelyProSettings, to decide which card to
// render). Both start from "unknown" and both resolve a beat later, so opening
// the tab flashed the wrong card for about a second and then swapped it.
//
// A module-level variable fixed that WITHIN a session but not across restarts:
// the module is re-evaluated on every app launch, so the first open after a
// restart was cold and flickered again. Hence localStorage, which is the
// convention already used in this codebase for renderer-side persistence
// (`natively_trial_claimed`, `natively_groq_fast_text`).
//
// THIS IS A DISPLAY HINT, NEVER AN ENTITLEMENT. Feature gating lives in the
// main process (`LicenseManager`); nothing here grants access to anything. A
// tampered or stale value only changes which card paints for one frame, and the
// `licenseGetDetails()` call on mount overwrites it immediately. Do not read
// this to decide whether a user may USE a paid feature.
export type LicenseSnapshot = {
    isPremium: boolean;
    /**
     * 'natively_api' means Pro is bundled with an API plan and is NOT
     * device-bound. 'dodo' / 'gumroad' mean a standalone device licence.
     * `undefined` means the details call failed and only the boolean is known,
     * which callers must treat as "assume standalone" rather than "assume
     * bundled" — under-warning about a device licence is the safer direction.
     */
    provider?: string;
};

// Versioned: if the shape ever changes, bump the suffix rather than trying to
// migrate, since a wrong-shaped hint is worse than a cold start.
const STORAGE_KEY = 'natively_license_snapshot_v1';

function read(): LicenseSnapshot | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Validate rather than trust: a hand-edited or half-written value must
        // fall back to "unknown" instead of poisoning the first paint.
        if (!parsed || typeof parsed.isPremium !== 'boolean') return null;
        return {
            isPremium: parsed.isPremium,
            provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
        };
    } catch {
        return null;
    }
}

let snapshot: LicenseSnapshot | null = read();

export function getLicenseSnapshot(): LicenseSnapshot | null {
    return snapshot;
}

export function setLicenseSnapshot(next: LicenseSnapshot | null): void {
    snapshot = next;
    try {
        if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage unavailable or full. The in-memory value still works for this
        // session; only cross-restart persistence is lost.
    }
}
