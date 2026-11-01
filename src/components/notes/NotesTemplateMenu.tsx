import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, LayoutGrid, RotateCw } from 'lucide-react';
import { NP_PILL } from './npPill';
import { quickNoteTemplates } from '../../../electron/services/meeting/noteTemplates';
import type { TemplateOption } from '../meeting/notesFeedback';
import { NpPop } from './NpPop';

/**
 * The notes' template menu after Stop (2026-10-20), as Granola's Enhanced ⌄:
 * write the notes again as they are, in one of the quick templates, or in any
 * template from the gallery (All templates…). The user's modes follow, as the
 * meeting page's "Regenerate as" lists them, so a mode's own sections stay one
 * pick away. A pick main refused for want of Pro is marked.
 */

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

export type TemplatePick =
    | { kind: 'rewrite' }
    | { kind: 'template'; id: string; name: string }
    | { kind: 'gallery' }
    | { kind: 'mode'; option: TemplateOption };

export const NotesTemplateMenu: React.FC<{
    /** What wrote the notes shown, by name. */
    currentName: string;
    /** The note template that wrote them, if one did. */
    currentTemplateId: string | null;
    modes: TemplateOption[];
    disabled: boolean;
    /** Template and mode ids main refused for want of Pro. */
    needsPro: ReadonlySet<string>;
    onPick: (pick: TemplatePick) => void;
}> = ({ currentName, currentTemplateId, modes, disabled, needsPro, onPick }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', close, true);
        window.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', esc); };
    }, [open]);

    const pick = (p: TemplatePick) => { setOpen(false); onPick(p); };
    const row = 'w-full h-7 flex items-center gap-2 px-2 rounded-lg text-[13px] text-left transition-colors np-wash';
    const label = 'px-2 pt-2 pb-1 text-[11px] font-medium';
    const pro = <span className="ml-auto pl-2 text-[11px] shrink-0" style={ink('--np-ink-tertiary')}>Needs Pro</span>;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Notes template: ${currentName}`}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                className={`${NP_PILL} justify-center disabled:opacity-50`}
                style={ink('--np-ink')}
            >
                <span className="truncate max-w-[180px]">{currentName}</span>
                <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} style={ink('--np-ink-secondary')} />
            </button>
            <NpPop open={open} origin="top left" role="menu" aria-label="Notes template" className="absolute left-0 top-full mt-1.5 z-40 w-[248px] max-h-[380px] overflow-y-auto p-1">
                <button type="button" role="menuitem" onClick={() => pick({ kind: 'rewrite' })} className={row} style={ink('--np-ink')}>
                    <RotateCw className="w-4 h-4 shrink-0" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                    <span className="flex-1 truncate">Rewrite notes</span>
                </button>
                <div className={label} style={ink('--np-ink-tertiary')}>Templates</div>
                {quickNoteTemplates().map((t) => (
                    <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === currentTemplateId} onClick={() => pick({ kind: 'template', id: t.id, name: t.name })} className={row} style={ink('--np-ink')}>
                        <FileText className="w-4 h-4 shrink-0" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                        <span className="flex-1 min-w-0 truncate">{t.name}</span>
                        {needsPro.has(t.id) ? pro : t.id === currentTemplateId && <Check className="w-4 h-4 shrink-0" strokeWidth={2} style={ink('--np-accent')} />}
                    </button>
                ))}
                <button type="button" role="menuitem" onClick={() => pick({ kind: 'gallery' })} className={row} style={ink('--np-ink')}>
                    <LayoutGrid className="w-4 h-4 shrink-0" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                    <span className="flex-1 truncate">All templates…</span>
                </button>
                {modes.length > 0 && (
                    <>
                        <div className={label} style={ink('--np-ink-tertiary')}>Modes</div>
                        {modes.map((m) => {
                            const on = !currentTemplateId && m.current;
                            return (
                                <button key={m.id} type="button" role="menuitemradio" aria-checked={on} onClick={() => pick({ kind: 'mode', option: m })} className={row} style={ink('--np-ink')}>
                                    <span className="w-4 shrink-0" aria-hidden />
                                    <span className="flex-1 min-w-0 truncate">{m.name}</span>
                                    {needsPro.has(m.id) ? pro : on && <Check className="w-4 h-4 shrink-0" strokeWidth={2} style={ink('--np-accent')} />}
                                </button>
                            );
                        })}
                    </>
                )}
            </NpPop>
        </div>
    );
};
