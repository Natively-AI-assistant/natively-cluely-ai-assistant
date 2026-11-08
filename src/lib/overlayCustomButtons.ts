import { useSyncExternalStore } from 'react';

/**
 * Settings › Overlay: the user's own overlay buttons (2026-10-30). Each has a
 * name (at most OVERLAY_CUSTOM_NAME_MAX characters, so it sits in the row
 * like the built-in ones), the user's description of it in plain sentences
 * (`prompt`), the contract a model wrote from that description when it was
 * saved (`instruction`, electron/llm/customButtons.ts), and whether a press
 * takes a screenshot first. A press runs the contract the way Define runs:
 * as the action of the system prompt, with the conversation as context.
 *
 * Their ids (`custom:<id>`) live in the same list as the built-in buttons
 * (overlayButtonOrder.ts), so they are dragged between the row and the tray
 * like any other. Stored and passed between windows as that list is:
 * localStorage plus an IPC hop through main.
 */
export type OverlayCustomButtonId = `custom:${string}`;

export type OverlayCustomButton = {
    id: OverlayCustomButtonId;
    name: string;
    /** The user's description, in the template's parts. */
    prompt: string;
    /** The contract written from it, in the built-in buttons' style; '' until written. */
    instruction: string;
    screenshot: boolean;
};

/** How many characters a name may have. */
export const OVERLAY_CUSTOM_NAME_MAX = 10;
/** How long a prompt may be. */
export const OVERLAY_CUSTOM_PROMPT_MAX = 2000;
/** How long the written contract may be (promptSystemV2 CUSTOM_BUTTON_INSTRUCTION_MAX_CHARS). */
export const OVERLAY_CUSTOM_INSTRUCTION_MAX = 1200;
/** How many buttons a user may make. */
export const OVERLAY_CUSTOM_MAX = 4;

export const OVERLAY_CUSTOM_BUTTONS_KEY = 'natively_overlay_custom_buttons';

const ID_PATTERN = /^custom:[a-z0-9-]{1,40}$/;

export const isOverlayCustomButtonId = (id: unknown): id is OverlayCustomButtonId =>
    typeof id === 'string' && ID_PATTERN.test(id);

/** Characters as a person counts them (an emoji is one), not UTF-16 units. */
export const nameLength = (name: string): number => Array.from(name).length;

/** A name cut to the limit, whitespace runs folded, ends trimmed. */
export function cleanOverlayCustomName(name: string): string {
    return Array.from(name.replace(/\s+/g, ' ').trim()).slice(0, OVERLAY_CUSTOM_NAME_MAX).join('').trim();
}

/**
 * The parts every description starts from: the parts Natively's own buttons
 * are written in (electron/llm/promptSystemV2.ts ACTIONS): what it does, what
 * to read, how the answer looks (order, length, voice), what never to do, and
 * what to say when there is nothing to work from. The user writes each as a
 * plain sentence; on save a model rewrites them into the button's contract
 * (electron/llm/customButtons.ts, whose fallback reads these same labels).
 */
export const OVERLAY_CUSTOM_PROMPT_LINES = ['What it does', 'What to read', 'How the answer looks', 'Never', "If there's nothing to work with"] as const;

export const OVERLAY_CUSTOM_PROMPT_TEMPLATE = [
    'What it does: ',
    'What to read: the last 3 minutes of the conversation',
    'How the answer looks: three short lines at most, in my own words, ready to say out loud',
    "Never: make up anything that wasn't said",
    "If there's nothing to work with: say so in one line",
].join('\n');

const FIRST_PART = /^\s*what it does\s*:/i;
const READ_PART = /^\s*what to read\s*:/i;

/** How far back a press reads when "What to read" names no span (Sound smart's window). */
export const OVERLAY_CUSTOM_READ_DEFAULT_MINUTES = 3;
/** The longest a press reads ("the whole meeting"); main holds the same cap. */
export const OVERLAY_CUSTOM_READ_MAX_MINUTES = 60;

const WORD_NUMBERS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
const NUMBER = `(\\d+(?:\\.\\d+)?|${Object.keys(WORD_NUMBERS).join('|')})`;
const toNumber = (raw: string): number => WORD_NUMBERS[raw.toLowerCase()] ?? Number(raw);

/**
 * How many minutes of the conversation a press reads, from the "What to read"
 * line (or the whole description when it has no such line): "the last 10
 * minutes" is 10, "an hour" or "the whole meeting" is the cap, "the last few
 * minutes" or a line naming no span is the default. Between 1 and the cap.
 */
export function overlayCustomReadMinutes(prompt: string): number {
    const lines = prompt.split('\n');
    const readLine = lines.find((line) => READ_PART.test(line));
    const text = (readLine !== undefined ? readLine.replace(READ_PART, '') : prompt).toLowerCase();
    const clamp = (n: number) => Math.min(OVERLAY_CUSTOM_READ_MAX_MINUTES, Math.max(1, Math.round(n)));

    if (/\b(?:whole|entire|full|all of the|all the)\s+(?:meeting|conversation|call|interview|session|transcript|thing)\b|\bfrom the (?:start|beginning)\b|\beverything\b/.test(text)) {
        return OVERLAY_CUSTOM_READ_MAX_MINUTES;
    }
    const hours = text.match(new RegExp(`\\b${NUMBER}\\s*(?:h|hr|hrs|hours?)\\b`));
    if (hours) return clamp(toNumber(hours[1]) * 60);
    if (/\bhalf an hour\b/.test(text)) return 30;
    if (/\b(?:an|one|the last|past)\s+hour\b/.test(text)) return OVERLAY_CUSTOM_READ_MAX_MINUTES;
    const minutes = text.match(new RegExp(`\\b${NUMBER}\\s*(?:m|mins?|minutes?)\\b`));
    if (minutes) return clamp(toNumber(minutes[1]));
    const seconds = text.match(new RegExp(`\\b${NUMBER}\\s*(?:s|secs?|seconds?)\\b`));
    if (seconds) return clamp(toNumber(seconds[1]) / 60);
    if (/\b(?:a|one|the last|the past)\s+minute\b/.test(text)) return 1;
    if (/\bcouple(?: of)? minutes\b/.test(text)) return 2;
    if (/\bseveral minutes\b/.test(text)) return 5;
    return OVERLAY_CUSTOM_READ_DEFAULT_MINUTES;
}

/**
 * Why a button being made cannot be saved yet, or null. A description that
 * still has the template's empty "What it does:" line says nothing about
 * what it is for.
 */
export function overlayCustomDraftProblem(draft: { name: string; prompt: string }): 'name' | 'prompt' | 'task' | null {
    if (!cleanOverlayCustomName(draft.name)) return 'name';
    const prompt = draft.prompt.trim();
    if (!prompt) return 'prompt';
    const taskLine = prompt.split('\n').find((line) => FIRST_PART.test(line));
    if (taskLine !== undefined && !taskLine.replace(FIRST_PART, '').trim()) return 'task';
    return null;
}

/** What the button does, for its row in the list: the first part, or the first line. */
export function overlayCustomSummary(prompt: string): string {
    const lines = prompt.split('\n').map((line) => line.trim()).filter(Boolean);
    const first = lines.find((line) => FIRST_PART.test(line)) ?? lines[0] ?? '';
    return first.replace(FIRST_PART, '').trim();
}

/** A new id, unique enough for a handful of buttons on one machine. */
export function newOverlayCustomButtonId(): OverlayCustomButtonId {
    const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `custom:${rand.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)}`;
}

/**
 * Any stored or sent value, made into a list of valid buttons: bad entries
 * and repeated ids dropped, names and prompts cut to their limits, at most
 * OVERLAY_CUSTOM_MAX. Never throws.
 */
export function normalizeOverlayCustomButtons(value: unknown): OverlayCustomButton[] {
    const out: OverlayCustomButton[] = [];
    if (!Array.isArray(value)) return out;
    for (const raw of value) {
        if (out.length >= OVERLAY_CUSTOM_MAX) break;
        if (!raw || typeof raw !== 'object') continue;
        const { id, name, prompt, instruction, screenshot } = raw as Record<string, unknown>;
        if (!isOverlayCustomButtonId(id) || out.some((b) => b.id === id)) continue;
        if (typeof name !== 'string' || typeof prompt !== 'string') continue;
        const cleanName = cleanOverlayCustomName(name);
        const cleanPrompt = prompt.trim().slice(0, OVERLAY_CUSTOM_PROMPT_MAX);
        if (!cleanName || !cleanPrompt) continue;
        // Buttons saved before the contract existed have none: '' (the press runs the description).
        const cleanInstruction = typeof instruction === 'string' ? instruction.trim().slice(0, OVERLAY_CUSTOM_INSTRUCTION_MAX) : '';
        out.push({ id, name: cleanName, prompt: cleanPrompt, instruction: cleanInstruction, screenshot: screenshot === true });
    }
    return out;
}

export function sameOverlayCustomButtons(a: readonly OverlayCustomButton[], b: readonly OverlayCustomButton[]): boolean {
    return a.length === b.length && a.every((x, i) => {
        const y = b[i];
        return x.id === y.id && x.name === y.name && x.prompt === y.prompt && x.instruction === y.instruction && x.screenshot === y.screenshot;
    });
}

function read(): OverlayCustomButton[] {
    try {
        const raw = localStorage.getItem(OVERLAY_CUSTOM_BUTTONS_KEY);
        return normalizeOverlayCustomButtons(raw ? JSON.parse(raw) : null);
    } catch {
        return [];
    }
}

let current: OverlayCustomButton[] = typeof window !== 'undefined' ? read() : [];
const listeners = new Set<() => void>();

function adopt(buttons: OverlayCustomButton[]): void {
    if (sameOverlayCustomButtons(buttons, current)) return;
    current = buttons;
    for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === OVERLAY_CUSTOM_BUTTONS_KEY || e.key === null) adopt(read());
    });
    try {
        (window as any).electronAPI?.onOverlayCustomButtonsChanged?.((buttons: unknown) => {
            adopt(normalizeOverlayCustomButtons(buttons));
        });
    } catch {
        /* no preload (a harness): the storage event still works */
    }
}

export function getOverlayCustomButtons(): OverlayCustomButton[] {
    return current;
}

export function getOverlayCustomButton(id: string): OverlayCustomButton | undefined {
    return current.find((b) => b.id === id);
}

export function setOverlayCustomButtons(buttons: readonly OverlayCustomButton[]): void {
    const next = normalizeOverlayCustomButtons(buttons);
    try {
        localStorage.setItem(OVERLAY_CUSTOM_BUTTONS_KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable: this window still follows the change */
    }
    adopt(next);
    try {
        (window as any).electronAPI?.setOverlayCustomButtons?.(next);
    } catch {
        /* no preload: the other windows follow through the storage event */
    }
}

export function subscribeOverlayCustomButtons(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
}

export function useOverlayCustomButtons(): OverlayCustomButton[] {
    return useSyncExternalStore(subscribeOverlayCustomButtons, getOverlayCustomButtons, () => current);
}
