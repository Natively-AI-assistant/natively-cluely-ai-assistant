// The Dictionary token field's text rules (Settings > Audio,
// src/components/settings/SpeechDictionarySettings.tsx), kept pure so they are
// tested directly. The main process cleans the list again on save
// (electron/audio/userDictionary.ts). Platform-neutral.

/** True when pasted text holds a list (one per line, or comma or semicolon separated). */
export function isListPaste(text) {
    return /[\n,;]/.test(text);
}

/** One entry per line, comma or semicolon, inner whitespace collapsed, empties dropped. */
export function splitEntries(text) {
    return text.split(/[\n,;]+/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * Adds the new entries of `text` to `terms`, up to `max`. Case-insensitive
 * duplicates (of the list or of each other) are dropped; new entries past the
 * cap come back as `leftover` so the field can keep them rather than lose them.
 */
export function mergeEntries(terms, text, max) {
    const seen = new Set(terms.map((x) => x.toLowerCase()));
    const next = [...terms];
    const leftover = [];
    for (const e of splitEntries(text)) {
        const key = e.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (next.length >= max) leftover.push(e);
        else next.push(e);
    }
    return { next, leftover };
}

/**
 * The field's text after pasting `text` the way an ordinary paste would: in
 * place of the selection [start, end), at the caret. Commas around the pasted
 * text keep it from fusing with a word typed either side of it.
 */
export function pasteIntoDraft(draft, start, end, text) {
    const a = Math.max(0, Math.min(start ?? draft.length, draft.length));
    const b = Math.max(a, Math.min(end ?? draft.length, draft.length));
    return `${draft.slice(0, a)},${text},${draft.slice(b)}`;
}
