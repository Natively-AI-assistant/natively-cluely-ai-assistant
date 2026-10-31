/*
  The logic behind the meeting page's notes features (2026-10-15) and the
  notes window's editing, kept pure so it is tested without a DOM:

  - Source: the transcript lines around a note line's time (±45 s), and where
    its evidence quote sits in them.
  - Versions: one tab per earlier version of the notes, then the current one.
  - Regenerate's warning: were these notes edited by hand?
  - The notes window: "- " lines continue on Enter.
*/

import { backspace, deleteWord, editShortcutLetter, isWordDelete, typed } from '../../lib/stealthEdit.mjs';

export interface SourceLine {
    speaker: string;
    text: string;
    timestamp: number;
    speakerId?: string;
}

export interface EvidenceLike {
    timestampMs?: number;
    timestamp?: number;
    quote?: string;
}

/** How far either side of a note line's time its Source shows. */
export const SOURCE_WINDOW_MS = 45_000;

/** Speakers the transcript tab hides; Source hides them too. */
const HIDDEN_SPEAKERS = new Set(['system', 'ai', 'assistant', 'model']);

/**
 * The time a note line points at: its own source time (action items), its own
 * time (decisions), else its first piece of evidence's. Undefined when it has
 * none: such a line shows no Source.
 */
export function noteLineTime(item: { sourceTimestampMs?: number; timestampMs?: number; evidence?: EvidenceLike[] } | null | undefined): number | undefined {
    if (!item) return undefined;
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (ok(item.sourceTimestampMs)) return item.sourceTimestampMs;
    if (ok(item.timestampMs)) return item.timestampMs;
    for (const e of item.evidence ?? []) {
        if (ok(e?.timestampMs)) return e.timestampMs;
        if (ok(e?.timestamp)) return e.timestamp;
    }
    return undefined;
}

/**
 * Note times are clock time (epoch ms); notes written before evidenceTimes.ts
 * may carry time into the meeting. Small values are read as an offset from the
 * meeting's first line, as the evidence labels already read them.
 */
export function toClockMs(ts: number, meetingStartMs: number): number {
    return ts > 1e11 || !(meetingStartMs > 0) ? ts : meetingStartMs + ts;
}

/** The meeting's first line's time (0 for none). */
export function meetingStartOf(transcript: SourceLine[] | null | undefined): number {
    let min = Infinity;
    for (const t of transcript ?? []) if (typeof t?.timestamp === 'number' && t.timestamp > 0 && t.timestamp < min) min = t.timestamp;
    return Number.isFinite(min) ? min : 0;
}

/**
 * The transcript lines within `windowMs` of `ts` (both ends included), in time
 * order, without the lines the transcript tab hides. A line keeps the voice it
 * was attributed to (speakerId), as the transcript tab shows it.
 */
export function selectSourceLines(
    transcript: SourceLine[] | null | undefined,
    ts: number | undefined,
    windowMs: number = SOURCE_WINDOW_MS,
): SourceLine[] {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return [];
    const at = toClockMs(ts, meetingStartOf(transcript));
    return (transcript ?? [])
        .filter((t) => t && typeof t.timestamp === 'number' && !HIDDEN_SPEAKERS.has(String(t.speaker || '').toLowerCase()))
        .filter((t) => Math.abs(t.timestamp - at) <= windowMs)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((t) => (t.speakerId ? { ...t, speaker: t.speakerId } : t));
}

const norm = (s: string) => s.toLowerCase().replace(/[“”"‘’']/g, '').replace(/\s+/g, ' ').trim();

/**
 * Split `text` around the evidence quote, for highlighting. Case, quote marks
 * and spacing are ignored when matching; no match leaves the text whole.
 */
export function splitOnQuote(text: string, quote: string | undefined): Array<{ text: string; match: boolean }> {
    const q = norm(quote || '');
    if (!text || q.length < 3) return [{ text, match: false }];
    // Map each position of the normalised text back to the original.
    let normText = '';
    const map: number[] = [];
    let lastSpace = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/[“”"‘’']/.test(ch)) continue;
        if (/\s/.test(ch)) {
            if (lastSpace || normText.length === 0) continue;
            lastSpace = true;
            normText += ' ';
            map.push(i);
            continue;
        }
        lastSpace = false;
        normText += ch.toLowerCase();
        map.push(i);
    }
    const at = normText.indexOf(q);
    if (at < 0) return [{ text, match: false }];
    const start = map[at];
    const end = map[at + q.length - 1] + 1;
    return [
        ...(start > 0 ? [{ text: text.slice(0, start), match: false }] : []),
        { text: text.slice(start, end), match: true },
        ...(end < text.length ? [{ text: text.slice(end), match: false }] : []),
    ];
}

/** True when the user changed the notes by hand (main stamps userEditedAt on an edit). */
export function notesWereEdited(detailed: unknown): boolean {
    const at = (detailed as { userEditedAt?: unknown } | null | undefined)?.userEditedAt;
    return typeof at === 'number' && Number.isFinite(at) && at > 0;
}

/**
 * What the notes SAY, as a short key: the same fields the rating's hash reads
 * in main (notesVersions.notesContentHash). The follow-up draft, speaker renames
 * and bookkeeping are left out, so a follow-up finishing while the user writes a
 * thumbs-down comment does not reset the rating.
 */
export function notesContentKey(detailed: unknown): string {
    const d = (detailed && typeof detailed === 'object') ? detailed as any : {};
    const texts = (v: unknown) => (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'string' ? x : String(x?.text ?? ''))).filter(Boolean);
    const content = JSON.stringify({
        overview: typeof d.overview === 'string' ? d.overview : '',
        tldr: texts(d.tldr),
        sections: (Array.isArray(d.sectionsV3) ? d.sectionsV3 : Array.isArray(d.sections) ? d.sections : [])
            .map((s: any) => [String(s?.title ?? ''), texts(s?.bullets)]),
        actions: texts(d.actionItemsV3 ?? d.actionItems),
        decisions: texts(d.decisions),
        questions: texts(d.openQuestions),
        keyPoints: d.schemaVersion === 3 ? [] : texts(d.keyPoints),
    });
    let h = 2166136261;
    for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 16777619);
    return `${content.length}:${(h >>> 0).toString(36)}`;
}

/** The tab name for notes: the mode they were written in. */
export function notesLabel(detailed: unknown): string {
    const mode = (detailed as any)?.mode;
    // A note template (noteTemplates.ts) wrote them: its name, over the mode's.
    const noteTemplate = typeof mode?.noteTemplateName === 'string' ? mode.noteTemplateName.trim() : '';
    if (noteTemplate) return noteTemplate;
    const name = typeof mode?.selectedModeName === 'string' ? mode.selectedModeName.trim() : '';
    if (name) return name;
    const template = typeof mode?.selectedTemplateType === 'string' ? mode.selectedTemplateType.trim() : '';
    if (template) return template.charAt(0).toUpperCase() + template.slice(1).replace(/[_-]+/g, ' ');
    return 'Notes';
}

export type VersionKey = 'current' | number;

/**
 * One tab per earlier version (oldest first), then the current notes. Two tabs
 * with the same mode are told apart by a number ("General", "General 2").
 * No tabs at all when there is no earlier version.
 */
export function versionTabs(
    current: unknown,
    versions: Array<{ id: number; label?: string; createdAt?: number }>,
): Array<{ key: VersionKey; label: string }> {
    if (!versions.length) return [];
    const raw: Array<{ key: VersionKey; label: string }> = [
        ...[...versions].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).map((v) => ({ key: v.id as VersionKey, label: (v.label || 'Notes').trim() || 'Notes' })),
        { key: 'current' as VersionKey, label: notesLabel(current) },
    ];
    const seen = new Map<string, number>();
    return raw.map((t) => {
        const n = (seen.get(t.label) ?? 0) + 1;
        seen.set(t.label, n);
        return n === 1 ? t : { ...t, label: `${t.label} ${n}` };
    });
}

/**
 * Enter in the notes window: a "- " (or "* ") line continues as a new point;
 * Enter on an empty point ends the list. Null: an ordinary Enter.
 */
export function continueListOnEnter(value: string, selStart: number, selEnd: number): { value: string; caret: number } | null {
    if (selStart !== selEnd) return null;
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    const line = value.slice(lineStart, selStart);
    const m = /^(\s*)([-*•])\s/.exec(line);
    if (!m) return null;
    const marker = `${m[1]}${m[2]} `;
    const restOfLine = value.slice(selStart, (value.indexOf('\n', selStart) + 1 || value.length + 1) - 1);
    if (line.trim() === m[2] && restOfLine.trim() === '') {
        // An empty point: Enter ends the list (the marker goes, the line stays).
        const next = value.slice(0, lineStart) + value.slice(selStart);
        return { value: next, caret: lineStart };
    }
    const next = `${value.slice(0, selStart)}\n${marker}${value.slice(selEnd)}`;
    return { value: next, caret: selStart + 1 + marker.length };
}

/**
 * One key typed into the notes window through the keyboard hook (2026-10-20),
 * which types without the window ever taking focus, as the overlay's input
 * does. The page has no caret then, so text goes at the end: Return is a new
 * line (continuing a point, as typed Enter does), Backspace takes the last
 * character (the last word with Ctrl, or Option on macOS), anything with
 * characters is added. Keys use the hook's macOS
 * codes on both platforms (36 Return, 76 numpad Enter, 51 Backspace); Esc and
 * the arrows never get here as text (main ends the session on Esc; the hook
 * passes arrows to the meeting app). With `allSelected` (Ctrl/Cmd+A in a
 * one-line field) the key replaces the whole value, as in the overlay's box.
 * Returns null when the key changes nothing.
 */
export function applyTypedKeyAtEnd(value: string, key: { keyCode: number; chars: string; isKeyDown: boolean; flags?: number }, allSelected = false): string | null {
    if (!key.isKeyDown) return null;
    // Ctrl/Cmd+V/A/C/X arrive as their letter with the modifier flag; they are
    // commands (NotesWindow.tsx runs them), never text.
    if (editShortcutLetter(key)) return null;
    if (key.keyCode === 36 || key.keyCode === 76) {
        return continueListOnEnter(value, value.length, value.length)?.value ?? `${value}\n`;
    }
    if (key.keyCode === 51) {
        if (value.length === 0) return null;
        // Ctrl+Backspace / Ctrl+Delete (Windows), Option+Backspace (macOS).
        return isWordDelete(key) ? deleteWord({ value, allSelected }).value : backspace({ value, allSelected }).value;
    }
    if (key.keyCode === 53) return null;
    const chars = key.chars;
    if (!chars || chars === '\r' || chars === '\n' || chars === '\t') return null;
    return typed({ value, allSelected }, chars).value;
}

/**
 * A chat answer as plain reading text for the notes window's answer panel
 * (2026-10-20). The notes window is a light route with no markdown renderer,
 * so the marks a model writes are taken out: `**bold**`, `__bold__`, `*em*`,
 * `` `code` ``, heading hashes, code fences and "> " quote marks. Points
 * ("- ", "1. ") stay as they read fine as text.
 */
export function plainAnswerText(markdown: string): string {
    return markdown
        .replace(/^```[^\n]*\n?/gm, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/^\s*[*+]\s+/gm, '- ')
        // A "> " quote (Make me sound smart's line to say) reads as the line itself.
        .replace(/^[ \t]*>[ \t]?/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
