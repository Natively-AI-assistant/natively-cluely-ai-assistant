import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { FileText, Heading1, LayoutGrid, List, ListChecks, ListOrdered, Heading2, type LucideIcon } from 'lucide-react';
import { SLASH_ITEMS, findMatchRanges, slashEntries, slashQuery, stepMatch, type SlashCommand, type SlashEntry } from './notesEditorModel';
import { NOTE_TEMPLATES, quickNoteTemplates } from '../../../electron/services/meeting/noteTemplates';
import { isWordDelete } from '../../lib/stealthEdit.mjs';

/**
 * The notepad's page (2026-10-20), on Granola's editor: Tiptap with headings,
 * bullet, numbered and checkbox lists, bold / italic / underline / strike and
 * links, markdown shortcuts as you type ("# ", "- ", "1. ", "[ ] "), a "/" menu
 * at the start of a line (Granola's: Heading, Bullet List, Checkbox), and Find.
 * No toolbar on a selection: Granola's live page has none (⌘B / ⌘I / ⌘U work).
 *
 * The text stays markdown (getMarkdown / setContent with contentType
 * markdown), so main, the notes prompt and the meeting page read what they
 * always read: "#" headings and "- " points.
 *
 * Typed into without focus (NotesWindow.tsx's keyboard hook): `typeKey` puts
 * each key at the selection, through the same input rules and Enter /
 * Backspace keymaps a focused editor uses; a click sets the selection (and a
 * drag extends it) without taking focus, and a drawn caret and selection show
 * where the keys go, since the page has no focus to draw its own. Ctrl/Cmd+V,
 * A, C and X act on that selection through `editShortcut` and `pasteText`.
 */

export interface TypedKey { keyCode: number; chars: string; isKeyDown: boolean; flags?: number }

export interface NotesEditorHandle {
    /** One key from the keyboard hook. Returns whether it was used. */
    typeKey: (key: TypedKey) => boolean;
    /** Ctrl/Cmd+A, C or X from the hook: the text to put on the clipboard, if any. */
    editShortcut: (letter: 'a' | 'c' | 'x') => string | null;
    /** Ctrl/Cmd+V from the hook: paste plain text at the selection, as a real paste does. */
    pasteText: (text: string) => boolean;
    /** The selection's text, else the line the caret is on, with its range. */
    shortenTarget: () => { text: string; from: number; to: number } | null;
    /** Replace a range with plain text, if it still reads `expected`. */
    replaceRange: (from: number, to: number, expected: string, text: string) => boolean;
    setFind: (query: string) => number;
    /** Go to the next (or previous) match; its 0-based index and the count. */
    stepFind: (back?: boolean) => { index: number; count: number };
}

interface MarksState { query: string; index: number; drawCaret: boolean }
const marksKey = new PluginKey<MarksState>('notesMarks');

/** Every match of `query` in the document's text blocks, in document positions. */
function docMatches(doc: PMNode, query: string): Array<{ from: number; to: number }> {
    const out: Array<{ from: number; to: number }> = [];
    if (!query) return out;
    doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        let text = '';
        const map: number[] = [];
        node.forEach((child, offset) => {
            const start = pos + 1 + offset;
            if (child.isText && child.text) {
                for (let i = 0; i < child.text.length; i++) map.push(start + i);
                text += child.text;
            } else {
                map.push(start);
                text += '￼';
            }
        });
        for (const r of findMatchRanges(text, query)) out.push({ from: map[r.from], to: map[r.to - 1] + 1 });
        return false;
    });
    return out;
}

/** Find's highlights, and the caret and selection drawn while the page has no focus. */
const NotesMarks = Extension.create({
    name: 'notesMarks',
    addProseMirrorPlugins() {
        return [
            new Plugin<MarksState>({
                key: marksKey,
                state: {
                    init: () => ({ query: '', index: 0, drawCaret: false }),
                    apply: (tr, prev) => {
                        const meta = tr.getMeta(marksKey) as Partial<MarksState> | undefined;
                        return meta ? { ...prev, ...meta } : prev;
                    },
                },
                props: {
                    decorations(state) {
                        const s = marksKey.getState(state);
                        if (!s) return null;
                        const decos: Decoration[] = [];
                        if (s.query) {
                            docMatches(state.doc, s.query).forEach((m, i) => {
                                decos.push(Decoration.inline(m.from, m.to, { class: i === s.index ? 'notes-find-hit notes-find-current' : 'notes-find-hit' }));
                            });
                        }
                        if (s.drawCaret) {
                            const sel = state.selection;
                            if (sel.empty) {
                                decos.push(Decoration.widget(sel.head, () => {
                                    const el = document.createElement('span');
                                    el.className = 'notes-hook-caret';
                                    return el;
                                }, { side: 1, key: 'hook-caret' }));
                            } else {
                                decos.push(Decoration.inline(sel.from, sel.to, { class: 'notes-hook-selection' }));
                            }
                        }
                        return decos.length ? DecorationSet.create(state.doc, decos) : null;
                    },
                },
            }),
        ];
    },
});

type SlashState = { query: string; from: number; to: number; left: number; top: number } | null;

function runSlash(editor: Editor, id: SlashCommand, range: { from: number; to: number }, focus: boolean): void {
    const chain = (focus ? editor.chain().focus() : editor.chain()).deleteRange(range);
    if (id === 'heading') chain.setNode('heading', { level: 1 }).run();
    else if (id === 'subheading') chain.setNode('heading', { level: 2 }).run();
    else if (id === 'bulletList') chain.toggleBulletList().run();
    else if (id === 'orderedList') chain.toggleOrderedList().run();
    else chain.toggleTaskList().run();
}

export const NotesEditor = forwardRef<NotesEditorHandle, {
    value: string;
    onChange: (markdown: string) => void;
    editable: boolean;
    /** True while keys come through the hook: draw the caret, never take focus. */
    hookTyping: boolean;
    /** The window's click-to-engage (NotesWindow.engage): may preventDefault to keep focus away. */
    onEngage?: (e: React.MouseEvent<HTMLElement>) => void;
    /** "/" › Templates: a template picked (its id), or All templates… (null). Without it the menu has no Templates. */
    onTemplate?: (id: string | null) => void;
    /** "Shorten" on the selection toolbar. */
    className?: string;
}>(({ value, onChange, editable, hookTyping, onEngage, onTemplate, className }, ref) => {
    const lastMarkdown = useRef(value);
    const emitted = useRef<Set<string>>(new Set());
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const hookTypingRef = useRef(hookTyping);
    hookTypingRef.current = hookTyping;
    const wrapRef = useRef<HTMLDivElement>(null);
    const [slash, setSlash] = useState<SlashState>(null);
    const slashRef = useRef<SlashState>(null);
    slashRef.current = slash;
    const [slashIndex, setSlashIndex] = useState(0);
    const slashIndexRef = useRef(0);
    slashIndexRef.current = slashIndex;
    const findRef = useRef({ query: '', index: 0 });
    const onTemplateRef = useRef(onTemplate);
    onTemplateRef.current = onTemplate;
    // The menu's rows for a query: the commands, then Templates when the window takes them.
    const entriesFor = (query: string): SlashEntry[] => {
        const all = slashEntries(query, quickNoteTemplates(), NOTE_TEMPLATES);
        return onTemplateRef.current ? all : all.filter((e) => e.kind === 'command');
    };

    const slashItems = slash ? entriesFor(slash.query) : [];

    const editor = useEditor({
        immediatelyRender: true,
        editable,
        content: value,
        contentType: 'markdown',
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                code: false,
                codeBlock: false,
                blockquote: false,
                link: { openOnClick: false, autolink: true, linkOnPaste: true },
            }),
            TaskList,
            TaskItem.configure({ nested: false }),
            Placeholder.configure({ placeholder: 'Write notes' }),
            Markdown,
            NotesMarks,
        ],
        editorProps: {
            attributes: { class: 'notes-editor outline-none', 'aria-label': 'Meeting notes', spellcheck: 'true' },
            handleKeyDown: (_view, event) => {
                const open = slashRef.current;
                const items = open ? entriesFor(open.query) : [];
                if (!open || items.length === 0) return false;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    const n = items.length;
                    setSlashIndex((i) => (event.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
                    return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                    pickRef.current(items[Math.min(slashIndexRef.current, items.length - 1)]);
                    return true;
                }
                if (event.key === 'Escape') {
                    setSlash(null);
                    return true;
                }
                return false;
            },
        },
        onUpdate: ({ editor: ed }) => {
            const md = ed.getMarkdown();
            lastMarkdown.current = md;
            emitted.current.add(md);
            onChangeRef.current(md);
        },
    });

    // The "/" menu follows the caret: open on "/" at the start of a paragraph.
    // State changes only when what it shows changes (every transaction calls this).
    useEffect(() => {
        if (!editor) return;
        const read = () => {
            const { selection } = editor.state;
            const $from = selection.$from;
            const q = selection.empty && $from.parent.type.name === 'paragraph'
                ? slashQuery($from.parent.textBetween(0, $from.parentOffset, '\ufffc'))
                : null;
            const prev = slashRef.current;
            if (q === null) {
                if (prev) setSlash(null);
                return;
            }
            const from = $from.start();
            const to = $from.pos;
            if (prev && prev.query === q && prev.from === from && prev.to === to) return;
            const wrap = wrapRef.current?.getBoundingClientRect();
            let left = 0;
            let top = 0;
            try {
                const at = editor.view.coordsAtPos(from);
                left = at.left - (wrap?.left ?? 0);
                top = at.bottom - (wrap?.top ?? 0) + 6;
            } catch { /* keep 0,0 */ }
            if (!prev || prev.query !== q) setSlashIndex(0);
            const next = { query: q, from, to, left, top };
            slashRef.current = next;
            setSlash(next);
        };
        editor.on('transaction', read);
        return () => { editor.off('transaction', read); };
    }, [editor]);

    const pickRef = useRef<(entry: SlashEntry | undefined) => void>(() => {});
    pickRef.current = (entry) => {
        const open = slashRef.current;
        if (!editor || !open || !entry) return;
        setSlash(null);
        if (entry.kind === 'command') {
            runSlash(editor, entry.item.id, { from: open.from, to: open.to }, !hookTypingRef.current);
            return;
        }
        // A template: the "/query" goes, the line stays where it was.
        editor.view.dispatch(editor.state.tr.delete(open.from, open.to));
        onTemplateRef.current?.(entry.kind === 'template' ? entry.id : null);
    };

    // Main replaced the text (a new meeting cleared the page): take it, without an update back.
    // A value this editor sent itself is the window catching up, not new text: hook keys come
    // faster than React renders, and taking an older one back would drop the keys after it.
    useEffect(() => {
        if (!editor) return;
        if (value === lastMarkdown.current) { emitted.current.clear(); return; }
        if (emitted.current.has(value)) return;
        emitted.current.clear();
        lastMarkdown.current = value;
        editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }, [value, editor]);

    useEffect(() => {
        editor?.setEditable(editable, false);
    }, [editable, editor]);

    // Typing through the hook: draw the caret (the page has no focus to draw one).
    useEffect(() => {
        if (!editor) return;
        editor.view.dispatch(editor.state.tr.setMeta(marksKey, { drawCaret: hookTyping }).setMeta('addToHistory', false));
    }, [hookTyping, editor]);

    useImperativeHandle(ref, () => ({
        typeKey: (key) => {
            if (!editor || !key.isKeyDown || !editor.isEditable) return false;
            const view = editor.view;
            if (key.keyCode === 36 || key.keyCode === 76) {
                // The "/" menu picks its item (read from the query now: hook keys can
                // come before React renders the menu); otherwise Enter as typed (lists continue).
                const open = slashRef.current;
                const items = open ? entriesFor(open.query) : [];
                if (open && items.length > 0) {
                    pickRef.current(items[Math.min(slashIndexRef.current, items.length - 1)]);
                    return true;
                }
                return editor.commands.keyboardShortcut('Enter');
            }
            if (key.keyCode === 51) {
                const { selection } = view.state;
                if (selection.empty && selection.$from.parentOffset > 0) {
                    const end = selection.from;
                    const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '￼');
                    // Ctrl+Backspace / Ctrl+Delete (Windows), Option+Backspace (macOS):
                    // the word before the caret and the space before it, within the line.
                    // Measured with each inline atom (a line break) as one whitespace
                    // character, so the length is the span's document size.
                    const word = isWordDelete(key)
                        ? /\s*\S+\s*$/.exec(selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, '\n'))
                        : null;
                    if (word) {
                        view.dispatch(view.state.tr.delete(end - word[0].length, end).scrollIntoView());
                        return true;
                    }
                    // One character, a whole surrogate pair included.
                    const width = /[\uDC00-\uDFFF]$/.test(text) && text.length > 1 ? 2 : 1;
                    view.dispatch(view.state.tr.delete(end - width, end).scrollIntoView());
                    return true;
                }
                if (!selection.empty) {
                    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
                    return true;
                }
                return editor.commands.keyboardShortcut('Backspace');
            }
            if (key.keyCode === 53) return false;
            const chars = key.chars;
            if (!chars || chars === '\r' || chars === '\n' || chars === '\t') return false;
            // macOS names function and arrow keys with private-use characters: never text.
            if (/^[\uF700-\uF8FF]+$/.test(chars)) return false;
            const { from, to } = view.state.selection;
            // Through the input rules first ("# " a heading, "- " a point), as typing does.
            const handled = view.someProp('handleTextInput', (f) => f(view, from, to, chars, () => view.state.tr.insertText(chars, from, to)));
            if (!handled) view.dispatch(view.state.tr.insertText(chars, from, to).scrollIntoView());
            return true;
        },
        editShortcut: (letter) => {
            if (!editor) return null;
            const { selection, doc } = editor.state;
            if (letter === 'a') {
                // A text selection over the whole page, not an AllSelection: that
                // one stays "everything" after an edit, so each key typed over it
                // would replace the whole page again.
                const all = TextSelection.between(Selection.atStart(doc).$from, Selection.atEnd(doc).$to);
                editor.view.dispatch(editor.state.tr.setSelection(all));
                return null;
            }
            if (selection.empty) return null;
            const text = doc.textBetween(selection.from, selection.to, '\n');
            // Copy works on a read-only page too; cut needs an editable one.
            if (letter === 'x' && editor.isEditable) editor.view.dispatch(editor.state.tr.deleteSelection().scrollIntoView());
            return text;
        },
        pasteText: (text) => {
            if (!editor || !editor.isEditable || !text) return false;
            return editor.view.pasteText(text);
        },
        shortenTarget: () => {
            if (!editor) return null;
            const { selection } = editor.state;
            if (!selection.empty) {
                return { text: editor.state.doc.textBetween(selection.from, selection.to, '\n'), from: selection.from, to: selection.to };
            }
            const $from = selection.$from;
            if (!$from.parent.isTextblock) return null;
            return { text: $from.parent.textContent, from: $from.start(), to: $from.end() };
        },
        replaceRange: (from, to, expected, text) => {
            if (!editor) return false;
            const { doc } = editor.state;
            if (to > doc.content.size || doc.textBetween(from, to, '\n') !== expected) return false;
            editor.view.dispatch(editor.state.tr.insertText(text, from, to));
            return true;
        },
        setFind: (query) => {
            if (!editor) return 0;
            findRef.current = { query, index: 0 };
            editor.view.dispatch(editor.state.tr.setMeta(marksKey, { query, index: 0 }).setMeta('addToHistory', false));
            const hits = docMatches(editor.state.doc, query);
            scrollToHit(editor, hits[0]);
            return hits.length;
        },
        stepFind: (back) => {
            if (!editor) return { index: 0, count: 0 };
            const hits = docMatches(editor.state.doc, findRef.current.query);
            const index = stepMatch(findRef.current.index, hits.length, back);
            findRef.current.index = index;
            editor.view.dispatch(editor.state.tr.setMeta(marksKey, { index }).setMeta('addToHistory', false));
            scrollToHit(editor, hits[index]);
            return { index, count: hits.length };
        },
    }), [editor]);

    // A click while the hook types for this window: the window's engage keeps
    // focus away (preventDefault), so the selection is set here, and a drag extends it.
    const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        onEngage?.(e);
        if (!editor || !e.defaultPrevented || !editor.isEditable) return;
        const target = e.target as HTMLElement;
        if (target.closest('input[type="checkbox"]') || target.closest('[data-notes-menu]')) return;
        const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        const anchor = hit ? hit.pos : editor.state.doc.content.size;
        editor.commands.setTextSelection(anchor);
        const move = (ev: MouseEvent) => {
            const p = editor.view.posAtCoords({ left: ev.clientX, top: ev.clientY });
            if (p) editor.commands.setTextSelection({ from: anchor, to: p.pos });
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    const keep = (e: React.MouseEvent) => e.preventDefault();

    return (
        <div ref={wrapRef} className={`relative ${className ?? ''}`} onMouseDown={onMouseDown}>
            <EditorContent editor={editor} />
            {slash && slashItems.length > 0 && (
                // Granola's "/" menu: 220px and up, 12px corners, 4px inside, 28px rows of 13px.
                <div
                    data-notes-menu
                    role="listbox"
                    aria-label="Insert"
                    onMouseDown={keep}
                    className="np-pop absolute z-30 min-w-[220px] max-h-[340px] overflow-y-auto p-1"
                    style={{ left: Math.max(0, slash.left), top: slash.top }}
                >
                    {slashItems.map((entry, i) => {
                        const key = entry.kind === 'command' ? entry.item.id : entry.kind === 'template' ? `t:${entry.id}` : 'all';
                        // Granola's Templates group: a quiet label over the first template.
                        const label = entry.kind !== 'command' && (i === 0 || slashItems[i - 1].kind === 'command');
                        const Icon = entry.kind === 'command' ? SLASH_ICONS[entry.item.id] : entry.kind === 'template' ? FileText : LayoutGrid;
                        return (
                            <React.Fragment key={key}>
                                {label && (
                                    <div className={`px-2 pb-1 text-[11px] font-medium ${i > 0 ? 'pt-2' : 'pt-1'}`} style={{ color: 'var(--np-ink-tertiary)' }}>Templates</div>
                                )}
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={i === slashIndex}
                                    onMouseEnter={() => setSlashIndex(i)}
                                    onClick={() => pickRef.current(entry)}
                                    className="w-full h-7 flex items-center gap-2 px-2 rounded-lg text-[13px] text-left transition-colors"
                                    style={{ color: 'var(--np-ink)', background: i === slashIndex ? 'var(--np-wash)' : undefined }}
                                >
                                    <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: 'var(--np-ink-secondary)' }} />
                                    <span className="truncate">{entry.kind === 'command' ? entry.item.label : entry.kind === 'template' ? entry.name : 'All templates…'}</span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
NotesEditor.displayName = 'NotesEditor';

function scrollToHit(editor: Editor, hit: { from: number; to: number } | undefined): void {
    if (!hit) return;
    try {
        const { node } = editor.view.domAtPos(hit.from);
        const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
        el?.scrollIntoView({ block: 'nearest' });
    } catch { /* nothing to scroll to */ }
}

const SLASH_ICONS: Record<SlashCommand, LucideIcon> = {
    heading: Heading1,
    subheading: Heading2,
    bulletList: List,
    orderedList: ListOrdered,
    taskList: ListChecks,
};

export { SLASH_ITEMS };
