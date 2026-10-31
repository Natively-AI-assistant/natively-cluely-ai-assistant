import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { ShareMenu } from '../meeting/ShareMenu';
import { notesLabel, notesWereEdited } from '../meeting/notesView';
import { templatePickerOptions } from '../meeting/notesFeedback';
import { enhancedNotesMarkdown, enhancedOverview, enhancedSections } from './notepadView';
import { NotesTemplateMenu, type TemplatePick } from './NotesTemplateMenu';

/**
 * The notes after Stop, in the notepad (2026-10-20), as Granola turns the same
 * note into the enhanced notes: written in the template, a line built on the
 * user's own notes in the primary ink and the rest in grey, as the meeting
 * page draws them. While they are written: "Writing your notes…".
 *
 * Under them: the template menu (NotesTemplateMenu: rewrite, a note template,
 * All templates…, or a mode; one that needs Pro says so), Copy, Share and Open
 * meeting. The meeting page keeps the rest (Source, versions, ratings, follow-up).
 * The window's template gallery applies through the handle (applyTemplate).
 */

export interface NotesEnhancedHandle {
    applyTemplate(id: string, name: string): void;
}

/** What a rewrite is asked in: the same notes, a note template, or a mode. */
type Rewrite = { kind: 'rewrite' } | { kind: 'template'; id: string; name: string } | { kind: 'mode'; id: string; name: string };

type Details = { id: string; title?: string; detailedSummary?: any; transcript?: unknown[] } | null;

export const NotesEnhanced = forwardRef<NotesEnhancedHandle, {
    meetingId: string;
    onTitle: (title: string | null) => void;
    /** All templates…: the window opens its gallery on the template in use. */
    onOpenGallery: (currentTemplateId: string | null) => void;
}>(({ meetingId, onTitle, onOpenGallery }, ref) => {
    const [details, setDetails] = useState<Details>(null);
    const [modes, setModes] = useState<Array<{ id: string; name: string; templateType: string }>>([]);
    const [regenerating, setRegenerating] = useState(false);
    const [needsPro, setNeedsPro] = useState<ReadonlySet<string>>(() => new Set());
    const [notice, setNotice] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<Rewrite | null>(null);
    const [copied, setCopied] = useState(false);

    const load = useCallback(() => {
        window.electronAPI?.getMeetingDetails?.(meetingId).then((d: any) => {
            if (!d || typeof d !== 'object') return;
            setDetails(d);
            if (typeof d.title === 'string' && d.title.trim()) onTitle(d.title.trim());
        }).catch(() => { /* not saved yet */ });
    }, [meetingId, onTitle]);

    useEffect(() => {
        load();
        const off = window.electronAPI?.onMeetingsUpdated?.(load);
        return () => { off?.(); };
    }, [load]);

    useEffect(() => {
        window.electronAPI?.modesGetAll?.()
            .then((list: any) => { if (Array.isArray(list)) setModes(list.map((m: any) => ({ id: m.id, name: m.name, templateType: m.templateType }))); })
            .catch(() => { /* no picker */ });
    }, []);

    const sections = enhancedSections(details?.detailedSummary);
    const overview = enhancedOverview(details?.detailedSummary);
    const ready = sections.length > 0 || overview.length > 0;
    // The notes land some seconds after Stop: ask again until they do.
    useEffect(() => {
        if (ready) return;
        const timer = setInterval(load, 4_000);
        return () => clearInterval(timer);
    }, [load, ready]);
    const title = (typeof details?.title === 'string' && details.title.trim()) || 'Meeting notes';

    const regenerate = async (req: Rewrite, confirmed = false) => {
        if (regenerating || !window.electronAPI?.regenerateMeetingSummary) return;
        if (!confirmed && notesWereEdited(details?.detailedSummary)) {
            setConfirm(req);
            return;
        }
        setConfirm(null);
        setNotice(null);
        setRegenerating(true);
        const key = req.kind === 'rewrite' ? '' : req.id;
        try {
            const res = await window.electronAPI.regenerateMeetingSummary(meetingId,
                req.kind === 'template' ? { noteTemplateId: req.id } : req.kind === 'mode' ? { modeId: req.id } : {});
            if (res?.success) {
                load();
                setNeedsPro((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });
            } else if (res?.error === 'pro_required') {
                if (key) setNeedsPro((prev) => new Set(prev).add(key));
                setNotice(req.kind === 'rewrite' ? 'These notes need Natively Pro to rewrite.' : `${req.name} notes need Natively Pro.`);
            } else {
                setNotice('Couldn’t rewrite the notes. Try again, or open the meeting.');
            }
        } catch {
            setNotice('Couldn’t rewrite the notes. Try again, or open the meeting.');
        } finally {
            setRegenerating(false);
        }
    };
    const regenerateRef = React.useRef(regenerate);
    regenerateRef.current = regenerate;
    useImperativeHandle(ref, () => ({
        applyTemplate: (id, name) => { void regenerateRef.current({ kind: 'template', id, name }); },
    }), []);

    const mode = details?.detailedSummary?.mode;
    const currentTemplateId = typeof mode?.noteTemplateId === 'string' ? mode.noteTemplateId : null;
    const onPick = (p: TemplatePick) => {
        if (p.kind === 'gallery') onOpenGallery(currentTemplateId);
        else if (p.kind === 'mode') void regenerate({ kind: 'mode', id: p.option.id, name: p.option.name });
        else void regenerate(p);
    };

    const copy = async (): Promise<boolean> => {
        const res = await window.electronAPI?.notesWindowCopyText?.(enhancedNotesMarkdown(title, sections, overview));
        const ok = !!res?.success;
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
        return ok;
    };

    // The notepad's outline chips (index.css .notepad tokens).
    const softBtn = 'np-outline np-wash h-7 shrink-0 inline-flex items-center gap-1.5 text-[13px] font-[430] px-3 rounded-full transition-colors';
    const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

    if (!ready) {
        return (
            <div className="px-8 pt-6 flex items-center gap-2.5 text-[13px]" style={ink('--np-ink-secondary')}>
                <span className="notes-listening-bars notes-writing" aria-hidden><span /><span /><span /></span>
                {regenerating ? 'Rewriting your notes…' : 'Writing your notes…'}
            </div>
        );
    }

    return (
        <div className="px-8 pt-5 pb-36">
            <div className="flex flex-wrap items-center gap-1.5">
                <NotesTemplateMenu
                    currentName={notesLabel(details?.detailedSummary)}
                    currentTemplateId={currentTemplateId}
                    modes={templatePickerOptions(modes, mode)}
                    disabled={regenerating}
                    needsPro={needsPro}
                    onPick={onPick}
                />
                <button type="button" onClick={() => { void copy(); }} className={softBtn} style={ink('--np-ink')}>
                    {copied ? <Check className="w-3.5 h-3.5" strokeWidth={2} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
                <ShareMenu meetingId={meetingId} disabled={regenerating} hasTranscript={(details?.transcript?.length ?? 0) > 0} onCopy={copy} />
                <button
                    type="button"
                    aria-label="Open meeting"
                    title="Open meeting"
                    onClick={() => { void window.electronAPI?.notesWindowOpenMeeting?.(meetingId); }}
                    className="np-wash w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors"
                    style={ink('--np-ink-secondary')}
                >
                    <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
                </button>
            </div>

            {confirm && (
                <div className="np-outline mt-3 pl-3 pr-1.5 py-1.5 rounded-xl flex items-center justify-between gap-3">
                    <p className="text-[12px] leading-4" style={ink('--np-ink-secondary')}>You edited these notes. {confirm.kind === 'rewrite' ? 'Rewriting them' : `Rewriting them in ${confirm.name}`} replaces your edits.</p>
                    <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => setConfirm(null)} className="np-wash h-7 px-3 rounded-full text-[13px]" style={ink('--np-ink-secondary')}>Cancel</button>
                        <button type="button" onClick={() => { void regenerate(confirm, true); }} className={softBtn} style={ink('--np-ink')}>Rewrite</button>
                    </div>
                </div>
            )}
            {notice && <p className="mt-3 text-[12px] leading-4" style={ink('--np-ink-secondary')}>{notice}</p>}

            <div className={`mt-5 space-y-5 select-text ${regenerating ? 'opacity-50' : ''}`}>
                {overview.length > 0 && (
                    <div className="space-y-2">
                        {overview.map((p, i) => (
                            <p key={i} className="text-[15px] leading-[1.5]" style={ink('--np-ink-secondary')}>{p}</p>
                        ))}
                    </div>
                )}
                {sections.map((s, i) => (
                    <section key={`${s.title}-${i}`}>
                        <h2 className="text-[15px] leading-[1.5] font-semibold" style={ink('--np-ink-strong')}>{s.title}</h2>
                        <ul className="mt-0.5 ml-6 list-disc">
                            {s.lines.map((l, j) => (
                                <li key={j} className="text-[15px] leading-[1.5] marker:text-[color:var(--np-marker)]" style={ink(l.mine ? '--np-ink' : '--np-ink-secondary')}>
                                    {l.text}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
});
NotesEnhanced.displayName = 'NotesEnhanced';
