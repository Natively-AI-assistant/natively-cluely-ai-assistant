import { useSyncExternalStore } from 'react';
import {
    getOverlayCustomButtons,
    isOverlayCustomButtonId,
    subscribeOverlayCustomButtons,
    type OverlayCustomButtonId,
} from './overlayCustomButtons.ts';

/**
 * Settings › Overlay: which five buttons the meeting overlay shows, and in
 * what order. Every button is kept in one list: the first five are the
 * overlay's row, the rest wait in the page's tray. Dragging swaps places in
 * this list, between the row and the tray or within the row.
 *
 * localStorage, so every Natively window starts from the same order. A change
 * reaches the other windows two ways, as the genie switch does
 * (genieAnimationSetting.ts): the `storage` event, and an IPC hop through main
 * carrying the new order (the `storage` event does not reliably cross
 * BrowserWindows; see meetingInterfaceTheme.ts).
 *
 * The user's own buttons (overlayCustomButtons.ts, 2026-10-30) are in the
 * list too, by their `custom:` ids: one that exists and is missing from a
 * saved order goes to the end (the tray), and one that was deleted drops out.
 */
export type BuiltinOverlayButtonId =
    | 'what_to_answer'
    | 'clarify'
    | 'recap'
    | 'follow_up'
    | 'answer'
    | 'brainstorm'
    | 'catch_me_up'
    | 'define'
    | 'sound_smart';

export type OverlayButtonId = BuiltinOverlayButtonId | OverlayCustomButtonId;

/** How many buttons the overlay's row holds. */
export const OVERLAY_ROW_SIZE = 5;

export const DEFAULT_OVERLAY_BUTTON_ORDER: readonly BuiltinOverlayButtonId[] = [
    'what_to_answer',
    'clarify',
    'recap',
    'follow_up',
    'answer',
    'brainstorm',
    'catch_me_up',
    'define',
    'sound_smart',
];

/** The overlay's row: the first OVERLAY_ROW_SIZE of an order. */
export const overlayRowOf = (order: readonly OverlayButtonId[]): OverlayButtonId[] => order.slice(0, OVERLAY_ROW_SIZE);

export const OVERLAY_BUTTON_ORDER_KEY = 'natively_overlay_button_order';

/**
 * Ids an older version saved that now name another button. The tray's
 * "Follow-up questions" (2026-10-16) did what Follow Up Question does, so the
 * two became one (2026-10-27): a saved row that showed it shows Follow Up
 * Question in its place.
 */
const RENAMED_OVERLAY_BUTTON_IDS: Readonly<Record<string, BuiltinOverlayButtonId>> = {
    follow_up_questions: 'follow_up',
};

export const isBuiltinOverlayButtonId = (id: unknown): id is BuiltinOverlayButtonId =>
    DEFAULT_OVERLAY_BUTTON_ORDER.includes(id as BuiltinOverlayButtonId);

/**
 * Any stored or sent value, made into a full order: known ids once each, in
 * the order given, then any button missing from it (a value from an older
 * version, a damaged one, a custom button just made) at the end: built-in
 * ones in their default place, then custom ones in the order they were made.
 * `customIds` are the custom buttons that exist; any other `custom:` id is
 * dropped. Never throws.
 */
export function normalizeOverlayButtonOrder(
    value: unknown,
    customIds: readonly OverlayCustomButtonId[] = getOverlayCustomButtons().map((b) => b.id),
): OverlayButtonId[] {
    const out: OverlayButtonId[] = [];
    const known = (id: unknown): id is OverlayButtonId =>
        isBuiltinOverlayButtonId(id) || (isOverlayCustomButtonId(id) && customIds.includes(id));
    if (Array.isArray(value)) {
        for (const raw of value) {
            const id = (typeof raw === 'string' && RENAMED_OVERLAY_BUTTON_IDS[raw]) || raw;
            if (known(id) && !out.includes(id)) out.push(id);
        }
    }
    for (const id of DEFAULT_OVERLAY_BUTTON_ORDER) if (!out.includes(id)) out.push(id);
    for (const id of customIds) if (!out.includes(id)) out.push(id);
    return out;
}

export function sameOverlayButtonOrder(a: readonly OverlayButtonId[], b: readonly OverlayButtonId[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** `a` and `b` trade places; the order unchanged if either is missing. */
export function swapOverlayButtons(order: readonly OverlayButtonId[], a: OverlayButtonId, b: OverlayButtonId): OverlayButtonId[] {
    const i = order.indexOf(a);
    const j = order.indexOf(b);
    const next = [...order];
    if (i < 0 || j < 0) return next;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
}

/**
 * `id` moved one place left (-1) or right (+1) within its own group (the row,
 * or the tray); unchanged at either end of the group.
 */
export function moveOverlayButton(order: readonly OverlayButtonId[], id: OverlayButtonId, step: -1 | 1): OverlayButtonId[] {
    const from = order.indexOf(id);
    const to = from + step;
    const sameGroup = (from < OVERLAY_ROW_SIZE) === (to < OVERLAY_ROW_SIZE);
    if (from < 0 || to < 0 || to >= order.length || !sameGroup) return [...order];
    return swapOverlayButtons(order, id, order[to]);
}

function read(): OverlayButtonId[] {
    try {
        const raw = localStorage.getItem(OVERLAY_BUTTON_ORDER_KEY);
        return normalizeOverlayButtonOrder(raw ? JSON.parse(raw) : null);
    } catch {
        return [...DEFAULT_OVERLAY_BUTTON_ORDER];
    }
}

let current: OverlayButtonId[] = typeof window !== 'undefined' ? read() : [...DEFAULT_OVERLAY_BUTTON_ORDER];
const listeners = new Set<() => void>();

function adopt(order: OverlayButtonId[]): void {
    if (sameOverlayButtonOrder(order, current)) return;
    current = order;
    for (const fn of listeners) fn();
}

// Listening from load, not from the first subscriber, so the order is fresh
// whenever the overlay first reads it.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === OVERLAY_BUTTON_ORDER_KEY || e.key === null) adopt(read());
    });
    try {
        (window as any).electronAPI?.onOverlayButtonOrderChanged?.((order: unknown) => {
            adopt(normalizeOverlayButtonOrder(order));
        });
    } catch {
        /* no preload (a harness): the storage event still works */
    }
    // A custom button made or deleted: the saved order, read again against
    // the new list (a new one joins the tray, a deleted one leaves).
    subscribeOverlayCustomButtons(() => adopt(read()));
}

export function getOverlayButtonOrder(): OverlayButtonId[] {
    return current;
}

export function setOverlayButtonOrder(order: readonly OverlayButtonId[]): void {
    const next = normalizeOverlayButtonOrder(order);
    try {
        localStorage.setItem(OVERLAY_BUTTON_ORDER_KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable: this window still follows the change */
    }
    adopt(next);
    try {
        (window as any).electronAPI?.setOverlayButtonOrder?.(next);
    } catch {
        /* no preload: the other windows follow through the storage event */
    }
}

export function subscribeOverlayButtonOrder(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
}

export function useOverlayButtonOrder(): OverlayButtonId[] {
    return useSyncExternalStore(subscribeOverlayButtonOrder, getOverlayButtonOrder, () => current);
}
