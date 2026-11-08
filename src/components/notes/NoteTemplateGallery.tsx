import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Lock, Search, X } from 'lucide-react';
import { NOTE_TEMPLATES, NOTE_TEMPLATE_GROUPS, searchNoteTemplates, type NoteTemplate } from '../../../electron/services/meeting/noteTemplates';
import nativelyMark from '../../assets/logo.webp';
import { noteTemplateGlyph } from './noteTemplateIcons';

/**
 * "Note templates" (2026-10-20), Granola's gallery: the templates grouped on
 * the left with a search, the picked one on the right (its meeting context and
 * sections), and Apply template. The notepad is narrow by default (460px), so
 * below 640px the list and the template take turns, with a back arrow.
 *
 * Sizes, fills and spacing measured on Granola's own dialog (2026-10-21): a
 * 200px list of 36px tiles, the right pane at 32px, 16px context text in a
 * box darker than the dialog, 16/14px section cards. Granola's picture
 * tiles are each template's own icon here (noteTemplateIcons.tsx); its New
 * template row and edit and favourite buttons are not built.
 *
 * Coloured in Natively's lavender, not Granola's cream (.np-lavender in
 * index.css, from the website's colour doc).
 *
 * The search is a controlled field: the window types into it through the hook
 * as into its other fields (NotesWindow's 'template' field).
 */

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });
const WIDE_MIN = 640;

function useWide(): boolean {
    const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= WIDE_MIN);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= WIDE_MIN);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return wide;
}

const Tile: React.FC<{ t: NoteTemplate }> = ({ t }) => {
    const Glyph = noteTemplateGlyph(t.id);
    return (
        <span aria-hidden className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center" style={{ background: 'var(--np-tile)' }}>
            <Glyph className="w-[18px] h-[18px]" strokeWidth={1.75} style={{ color: 'var(--np-tile-ink, var(--np-ink-secondary))' }} />
        </span>
    );
};

export const NoteTemplateGallery: React.FC<{
    /** The template the notes are in now (marked in the list and on Apply). */
    appliedId: string | null;
    /** The one shown first: the applied one, or the first. */
    initialId?: string | null;
    query: string;
    onQuery: (q: string) => void;
    onEngageSearch?: (e: React.MouseEvent<HTMLElement>) => void;
    searchHookTyping?: boolean;
    onApply: (id: string) => void;
    onClose: () => void;
}> = ({ appliedId, initialId, query, onQuery, onEngageSearch, searchHookTyping, onApply, onClose }) => {
    const wide = useWide();
    const [pickedId, setPickedId] = useState<string>(() => initialId ?? appliedId ?? NOTE_TEMPLATES[0].id);
    // Narrow: the list first unless the window opened on a template.
    const [showDetail, setShowDetail] = useState(!!initialId);
    const found = useMemo(() => searchNoteTemplates(query), [query]);
    const picked: NoteTemplate = NOTE_TEMPLATES.find((t) => t.id === pickedId) ?? NOTE_TEMPLATES[0];

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const pick = (id: string) => { setPickedId(id); setShowDetail(true); };
    const groupLabel = 'px-2 pt-4 pb-1.5 text-[13px] leading-[18px] font-medium';
    const shownGroups = NOTE_TEMPLATE_GROUPS.filter((g) => found.some((t) => t.group === g));

    const list = (
        <div className={`flex flex-col min-h-0 ${wide ? 'w-[200px] shrink-0' : 'flex-1'}`} style={wide ? { borderRight: '0.5px solid var(--np-ring)' } : undefined}>
            <div className="px-3 pt-1.5">
                {/* A filled pill that lifts to the dialog's card colour while typing (index.css .np-search). */}
                <label className="np-search h-8 flex items-center gap-2 pl-3 pr-1 rounded-full" onMouseDown={onEngageSearch}>
                    <Search className="w-3.5 h-3.5 shrink-0" strokeWidth={2} style={ink('--np-ink-secondary')} />
                    <input
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        placeholder="Search templates…"
                        aria-label="Search templates"
                        data-hook-typing={searchHookTyping ? 'true' : undefined}
                        className="flex-1 min-w-0 bg-transparent outline-none text-[14px] placeholder:text-[color:var(--np-placeholder)]"
                        style={ink('--np-ink')}
                    />
                    {query && (
                        <button type="button" aria-label="Clear search" onClick={() => onQuery('')} className="np-search-clear w-6 h-6 shrink-0 rounded-full flex items-center justify-center" style={ink('--np-ink-secondary')}>
                            <X className="w-3.5 h-3.5" strokeWidth={2} />
                        </button>
                    )}
                </label>
            </div>
            <div role="listbox" aria-label="Templates" className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                {found.length === 0 && <p className="px-2 pt-4 text-[14px]" style={ink('--np-label')}>No templates match.</p>}
                {shownGroups.map((group, gi) => (
                    <div key={group}>
                        {/* Granola's group rule: inset to the rows' content, 17px under the last row. */}
                        {gi > 0 && <div className="mx-2 mt-[17px]" style={{ borderTop: '0.5px solid var(--np-ring)' }} />}
                        <div className={groupLabel} style={ink('--np-label')}>{group}</div>
                        {found.filter((t) => t.group === group).map((t) => {
                            const on = wide && t.id === picked.id;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    role="option"
                                    aria-selected={on}
                                    onClick={() => pick(t.id)}
                                    className="w-full mb-px flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors np-wash"
                                    style={on ? { background: 'var(--np-wash)' } : undefined}
                                >
                                    <Tile t={t} />
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[15px] leading-5 truncate" style={ink('--np-ink')}>{t.name}</span>
                                        <span className="block text-[12px] leading-4 truncate" style={ink('--np-ink-secondary')}>Natively</span>
                                    </span>
                                    {t.id === appliedId && <Check className="w-4 h-4 shrink-0" strokeWidth={2} style={ink('--np-accent')} aria-label="In use" />}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );

    const sectionLabel = 'text-[14px] leading-5 font-medium mb-3';
    const card: React.CSSProperties = { background: 'var(--np-card, var(--np-track))', boxShadow: 'inset 0 0 0 0.5px var(--np-ring)' };
    const detail = (
        <div className={`flex-1 min-w-0 min-h-0 overflow-y-auto pt-4 pb-8 ${wide ? 'px-8' : 'px-6'}`}>
            {!wide && (
                <button type="button" onClick={() => setShowDetail(false)} className="-ml-1.5 -mt-3 mb-4 h-7 inline-flex items-center gap-1 px-1.5 rounded-lg text-[14px] transition-colors np-wash" style={ink('--np-ink-secondary')}>
                    <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> All templates
                </button>
            )}
            <div className="flex items-center gap-4">
                <Tile t={picked} />
                <h3 className="font-plex-serif text-[26px] leading-8 font-normal min-w-0 break-words" style={ink('--np-ink-strong')}>{picked.name}</h3>
            </div>
            {/* Granola's author line ("Granola", a lock, View only): the built-in templates can't be edited. */}
            <div className="mt-4 h-6 flex items-center text-[14px]">
                <span aria-hidden className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center" style={{ background: '#1e1e1e' }}>
                    <img src={nativelyMark} alt="" draggable={false} className="w-4 h-4" />
                </span>
                <span className="ml-[7px]" style={ink('--np-ink-strong')}>Natively</span>
                <Lock className="ml-[19px] w-3 h-3 shrink-0" strokeWidth={2.25} style={ink('--np-label')} aria-hidden />
                <span className="ml-[7px]" style={ink('--np-label')}>View only</span>
            </div>
            <div className="mt-6 pt-[30px]" style={{ borderTop: '0.5px solid var(--np-ring)' }}>
                <div className={sectionLabel} style={ink('--np-label')}>Meeting Context</div>
                <p className="rounded-xl px-5 pt-4 pb-[22px] text-[16px] leading-[25px]" style={{ ...ink('--np-ink'), ...card }}>{picked.context}</p>
                <div className={`${sectionLabel} mt-[30px]`} style={ink('--np-label')}>Sections</div>
                <div className="flex flex-col gap-[9px]">
                    {picked.sections.map((s) => (
                        <div key={s.title} className="rounded-xl px-4 py-3" style={card}>
                            <div className="text-[16px] leading-5 font-semibold" style={ink('--np-ink-strong')}>{s.title}</div>
                            <div className="text-[14px] leading-[18px] mt-1" style={ink('--np-ink-soft')}>{s.description}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <div className="np-lavender fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'var(--np-scrim)', animation: 'np-fade-in 120ms ease-out' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-label="Note templates" className="np-pop w-full max-w-[1014px] h-full max-h-[768px] flex flex-col overflow-hidden" style={{ transformOrigin: 'center', borderRadius: 16, background: 'var(--np-surface)' }}>
                <div className="h-[52px] shrink-0 flex items-center justify-between pl-6 pr-1.5">
                    <h2 className="text-[15px] font-medium" style={ink('--np-ink-strong')}>Note templates</h2>
                    <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors np-wash" style={ink('--np-ink-secondary')}>
                        <X className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                </div>
                <div className="flex-1 min-h-0 flex">
                    {wide ? <>{list}{detail}</> : (showDetail ? detail : list)}
                </div>
                {(wide || showDetail) && (
                    <div className="h-[52px] shrink-0 flex items-center justify-end gap-2 px-4" style={{ borderTop: '0.5px solid var(--np-ring)' }}>
                        <button
                            type="button"
                            disabled={picked.id === appliedId}
                            onClick={() => onApply(picked.id)}
                            // A solid pill: Natively's periwinkle in the gallery (index.css .np-lavender).
                            className="h-7 px-3 rounded-full text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
                            style={{ background: 'var(--np-cta, var(--np-ink))', color: 'var(--np-cta-ink, var(--np-surface))' }}
                        >
                            {picked.id === appliedId ? 'In use' : 'Apply template'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
