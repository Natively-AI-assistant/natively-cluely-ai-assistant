/*
  The notepad editor's logic (NotesEditor.tsx, 2026-10-20), kept pure so it is
  tested without a DOM:

  - The "/" menu: what a line starting with "/" asks for, and which items and
    note templates fit.
  - Find: where a query sits in a run of text.
  - Notes shown as reading text (the meeting page's Your notes): the editor's
    underline and escapes made plain.
*/

export type SlashCommand = 'heading' | 'subheading' | 'bulletList' | 'orderedList' | 'taskList';

export interface SlashItem {
    id: SlashCommand;
    label: string;
    /** What typing at the start of a line does the same (shown in the menu). */
    hint: string;
    keywords: string[];
}

/** The "/" menu, in order: Granola's three (Heading, Bullet List, Checkbox). "## " and "1. " still work as typed. */
export const SLASH_ITEMS: SlashItem[] = [
    { id: 'heading', label: 'Heading', hint: '#', keywords: ['heading', 'title', 'h1'] },
    { id: 'bulletList', label: 'Bullet List', hint: '-', keywords: ['bullet', 'list', 'points', 'ul'] },
    { id: 'taskList', label: 'Checkbox', hint: '[ ]', keywords: ['checkbox', 'todo', 'task', 'check'] },
];

/**
 * The query of a "/" typed at the start of a paragraph: the text before the
 * caret, when it is "/" and up to 20 letters. Null when the menu is not asked for.
 */
export function slashQuery(textBeforeCaret: string): string | null {
    const m = /^\/([a-z0-9 ]{0,20})$/i.exec(textBeforeCaret);
    if (!m) return null;
    return m[1].toLowerCase();
}

/** The items a query keeps: a word of the label or a keyword starts with it. */
export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => [...item.label.toLowerCase().split(/\s+/), ...item.keywords].some((w) => w.startsWith(q)));
}

/** One row of the "/" menu: a block command, a note template, or the template gallery. */
export type SlashEntry =
    | { kind: 'command'; item: SlashItem }
    | { kind: 'template'; id: string; name: string }
    | { kind: 'allTemplates' };

export interface SlashTemplate { id: string; name: string }

/**
 * The "/" menu as Granola's: the commands that fit, then Templates (the five
 * quick ones, or up to five whose name has a word starting with the query),
 * then "All templates…", always last.
 */
export function slashEntries(query: string, quick: readonly SlashTemplate[], all: readonly SlashTemplate[]): SlashEntry[] {
    const q = query.trim().toLowerCase();
    const commands: SlashEntry[] = filterSlashItems(q).map((item) => ({ kind: 'command', item }));
    const templates = (q ? all.filter((t) => t.name.toLowerCase().split(/[\s:()]+/).some((w) => w.startsWith(q))) : quick).slice(0, 5);
    return [...commands, ...templates.map((t): SlashEntry => ({ kind: 'template', id: t.id, name: t.name })), { kind: 'allTemplates' }];
}

/** Every place `query` sits in `text`, case ignored, not overlapping. */
export function findMatchRanges(text: string, query: string): Array<{ from: number; to: number }> {
    const q = query.toLowerCase();
    if (!q) return [];
    const hay = text.toLowerCase();
    const out: Array<{ from: number; to: number }> = [];
    let at = hay.indexOf(q);
    while (at !== -1) {
        out.push({ from: at, to: at + q.length });
        at = hay.indexOf(q, at + q.length);
    }
    return out;
}

/** The next match index, wrapping, for Find's Enter / Shift+Enter. */
export function stepMatch(index: number, count: number, back = false): number {
    if (count <= 0) return 0;
    return back ? (index - 1 + count) % count : (index + 1) % count;
}

/**
 * The notepad's markdown for a markdown renderer: its underline (++text++,
 * Tiptap's own mark) becomes the plain words, as the notes prompt reads it
 * (meetingNotesContext.cleanUserNotes).
 */
export function readableNotesMarkdown(markdown: string): string {
    return markdown.replace(/\+\+([^+\n]+?)\+\+/g, '$1');
}
