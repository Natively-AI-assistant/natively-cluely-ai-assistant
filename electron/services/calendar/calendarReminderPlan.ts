/**
 * Which lists the calendar reminders are planned from, and when the main
 * process refreshes the calendar by itself (2026-11-09).
 *
 * Until then reminders were planned only when something asked for the
 * upcoming list (launch, a manual refresh, a connect), and a fetch that failed
 * for one source cancelled that source's reminders. With Natively opening at
 * login and staying up for days, a meeting added after launch, tomorrow's
 * meetings (plans cover 24 h) and a cancelled one were all reminded wrongly.
 *
 * Pure: the clock and every input are passed in, so both are tested without
 * Electron. Nothing here is platform-specific.
 */

/** A failed source's last good list is used for its reminders for this long after it was fetched. */
export const REMINDER_LAST_GOOD_MAX_AGE_MS = 24 * 60 * 60_000;

/** How often main refreshes the calendar itself (the Launcher, while it is up, refreshes every minute). */
export const CALENDAR_BACKGROUND_REFRESH_MS = 5 * 60_000;

/** A list fetched this recently is fresh enough: the timer does not fetch again. */
export const CALENDAR_BACKGROUND_FRESH_MS = 2 * 60_000;

/**
 * The lists reminders are planned from: each source that answered, its new
 * list; each that failed (null), its last good list if that is no older than
 * `maxAgeMs`, else nothing. A source absent from `results` is not connected.
 */
export function reminderSourceLists<S extends string, E>(
    results: ReadonlyMap<S, readonly E[] | null>,
    lastBySource: ReadonlyMap<S, readonly E[]>,
    lastGoodAt: ReadonlyMap<S, number>,
    nowMs: number,
    maxAgeMs: number = REMINDER_LAST_GOOD_MAX_AGE_MS,
): Array<{ source: S; events: E[] }> {
    const out: Array<{ source: S; events: E[] }> = [];
    for (const [source, events] of results) {
        if (events) {
            out.push({ source, events: [...events] });
            continue;
        }
        const last = lastBySource.get(source);
        const at = lastGoodAt.get(source);
        if (last && typeof at === 'number' && nowMs - at <= maxAgeMs) out.push({ source, events: [...last] });
    }
    return out;
}

export type BackgroundRefreshReason = 'interval' | 'resume' | 'unlock';

export type BackgroundRefreshDecision = 'fetch' | 'not-connected' | 'blocked' | 'in-flight' | 'fresh';

/**
 * Whether main's own refresh fetches now. Never while Undetectable is on (no
 * calendar traffic, as the Launcher's poll), never over a fetch already on its
 * way (the Launcher's, a manual refresh), and on the timer not when a list
 * landed in the last CALENDAR_BACKGROUND_FRESH_MS (the Launcher's minute poll
 * covers it while it is up). Waking or unlocking always fetches: the list may
 * be hours old.
 */
export function backgroundRefreshDecision(input: {
    reason: BackgroundRefreshReason;
    nowMs: number;
    connected: boolean;
    egressBlocked: boolean;
    inFlight: boolean;
    lastLandedAt: number;
    freshMs?: number;
}): BackgroundRefreshDecision {
    if (!input.connected) return 'not-connected';
    if (input.egressBlocked) return 'blocked';
    if (input.inFlight) return 'in-flight';
    if (input.reason === 'interval' && input.lastLandedAt > 0 && input.nowMs - input.lastLandedAt < (input.freshMs ?? CALENDAR_BACKGROUND_FRESH_MS)) return 'fresh';
    return 'fetch';
}

/**
 * A Google calendar that failed in a fetch where others answered: its last
 * good items, if fetched within `maxAgeMs`, less those that ended before
 * `fromMs`; else none. Without it one failing calendar among several counted
 * as an empty one, which cancelled its reminders and overwrote its list.
 */
export function lastGoodCalendarItems(
    entry: { items: readonly any[]; at: number } | undefined,
    nowMs: number,
    fromMs: number,
    maxAgeMs: number = REMINDER_LAST_GOOD_MAX_AGE_MS,
): any[] {
    if (!entry || nowMs - entry.at > maxAgeMs) return [];
    return entry.items.filter((item) => {
        const end = new Date(item?.end?.dateTime ?? item?.end?.date ?? '').getTime();
        return !Number.isFinite(end) || end > fromMs;
    });
}
