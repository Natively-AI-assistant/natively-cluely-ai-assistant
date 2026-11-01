import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { NP_PILL } from './npPill';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { ShareMenu } from '../meeting/ShareMenu';
import { notesLabel, notesWereEdited } from '../meeting/notesView';
import { templatePickerOptions } from '../meeting/notesFeedback';
import { enhancedNotesMarkdown, enhancedOverview, enhancedSections } from './notepadView';
import { NotesTemplateMenu, type TemplatePick } from './NotesTemplateMenu';

/**
 * The notes after Stop, in the notepad (2026-10-20), as Granola turns the same
 * note into the enhanced notes: written in the template, a line built on the
 * user's own notes in the primary ink and the rest in grey, as the meeting
 * page draws them. While they are written: a "Writing your notes" pill, as Granola's.
 *
 * Under them: the template menu (NotesTemplateMenu: rewrite, a note template,
 * All templates…, or a mode; one that needs Pro says so), Copy, Share and Open
 * meeting. The meeting page keeps the rest (Source, versions, ratings, follow-up).
 * The window's template gallery applies through the handle (applyTemplate).
 */

/** Granola's step between lines of the sweep down the page. */
const SWEEP_LINE_MS = 140;
/** One written line every 140ms (Granola's notes came in about that fast), faster for long notes so writing stays near 4s. */
export function revealStepMs(lines: number): number {
    if (lines <= 1) return SWEEP_LINE_MS;
    return Math.max(45, Math.min(SWEEP_LINE_MS, Math.round(4200 / lines)));
}
/**
 * What the pill says while the notes are being written (owner, 2026-11-01: "add few
 * multiple text ... to make user think something big is happening"). Each is a step the
 * summary really takes (the transcript, your notes, the points, decisions and next steps),
 * one every 2.2s (one grey sweep), holding on the last until the notes come.
 */
export function writingLabels(hasMyNotes: boolean, rewrite: boolean): string[] {
    if (rewrite) return ['Reading the transcript again', 'Rewriting your notes'];
    return [
        'Reading the transcript',
        ...(hasMyNotes ? ['Going through your notes'] : []),
        'Finding the key points',
        'Pulling out decisions and next steps',
        'Writing your notes',
    ];
}
const LABEL_STEP_MS = 2200;
/**
 * The pill's ride down the page: a critically damped spring that keeps its speed when the
 * next line moves the target (Emil Kowalski: springs keep velocity when interrupted;
 * tweens restart). A 250ms ease-out retargeted every 140ms lurched (bursts of 10–20px a
 * frame, then near stops), so the pill now travels at an even pace a little behind the
 * writing, each new line coming out from under it.
 */
const WRITE_HEAD_SPRING = { type: 'spring', stiffness: 170, damping: 26, mass: 1 } as const;
/**
 * Room the window's bottom bar takes (My notes | Enhanced + Ask + padding) until the window
 * has measured it (bottomInset). The bar is taller than this and changes height (a notice,
 * the Ask panel), so a fixed stop put the pill behind the switch (Evin, 2026-11-01).
 */
const BOTTOM_BAR_PX = 128;
/** Air between the pill and the top of the bottom bar. */
const WRITE_HEAD_GAP_PX = 12;
/** The pill: 40px tall, over the newest line's last 12px (.np-write-head margin-top). */
const WRITE_HEAD_PX = 40;
const WRITE_HEAD_OVERLAP_PX = 12;
const WRITE_HEAD_BELOW_PX = WRITE_HEAD_PX - WRITE_HEAD_OVERLAP_PX;
/** The nearest ancestor that scrolls (the notepad's page). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
        const y = getComputedStyle(p).overflowY;
        if (y === 'auto' || y === 'scroll') return p;
    }
    return null;
}
/** A written line's grey-to-ink settle (.np-write-line). The pill leaves once the last line has settled. */
export const WRITE_SETTLE_MS = 900;
/** How long the writing runs: every line out, then the last one's settle. */
export function revealDurationMs(lines: number): number {
    return Math.max(0, lines) * revealStepMs(lines) + WRITE_SETTLE_MS;
}

type SweepLine = { kind: 'heading' | 'bullet' | 'task' | 'text'; text: string; indent: number };
/** The user's notes (the editor's Markdown) as plain lines for the sweep: no marks, no empty lines. */
export function notesSweepLines(markdown: string): SweepLine[] {
    const out: SweepLine[] = [];
    for (const raw of markdown.split('\n')) {
        if (!raw.trim()) continue;
        const indent = Math.min(4, Math.floor((raw.match(/^\s*/)?.[0].length ?? 0) / 2));
        let line = raw.trim();
        let kind: SweepLine['kind'] = 'text';
        if (/^#{1,6}\s+/.test(line)) { kind = 'heading'; line = line.replace(/^#{1,6}\s+/, ''); }
        else if (/^[-*+]\s+\[[ xX]\]\s*/.test(line)) { kind = 'task'; line = line.replace(/^[-*+]\s+\[[ xX]\]\s*/, ''); }
        else if (/^[-*+]\s+/.test(line)) { kind = 'bullet'; line = line.replace(/^[-*+]\s+/, ''); }
        else if (/^\d+[.)]\s+/.test(line)) { kind = 'bullet'; line = line.replace(/^\d+[.)]\s+/, ''); }
        line = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1');
        if (line) out.push({ kind, text: line, indent });
        if (out.length >= 80) break;
    }
    return out;
}

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
    /** What the user typed during the meeting: shown under the pill, sweeping, while the notes are written. */
    myNotes?: string;
    /** The bottom bar's height over the page, measured by the window: the pill stops above it. */
    bottomInset?: number;
}>(({ meetingId, onTitle, onOpenGallery, myNotes, bottomInset }, ref) => {
    const stopPx = (bottomInset ?? BOTTOM_BAR_PX) + WRITE_HEAD_GAP_PX;
    const stopRef = React.useRef(stopPx);
    stopRef.current = stopPx;
    const [details, setDetails] = useState<Details>(null);
    const still = useReducedMotion() ?? false;
    const sweepLines = React.useMemo(() => notesSweepLines(myNotes ?? ''), [myNotes]);
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
    // The notepad's demand (FunnelTelemetry.notepadUsed), after Stop: action names only.
    const npTrack = (action: string) => {
        window.electronAPI?.funnelTrack?.('notepad_used', { action, phase: 'ended' })?.catch?.(() => {});
    };
    const reportedWritten = React.useRef(false);
    useEffect(() => {
        if (!ready || reportedWritten.current) return;
        reportedWritten.current = true;
        npTrack('notes_written');
    }, [ready]);

    // The notes are written down the page behind the pill, as Granola's are (owner's screen
    // recording of Granola, 2026-11-01): the pill is the write head. Your notes clear, then
    // the written lines appear one at a time from the top, each sliding up out from under
    // the pill, grey first and then their own ink, and the pill rides down after the last
    // line until it stops above the Ask bar (sticky). It leaves once the last line settles.
    // `shown` = how many lines are out; null = all of them (not writing).
    const [shown, setShown] = useState<number | null>(null);
    const revealing = shown !== null;
    // Lines written out of sight under the stopped pill settle grey-to-ink as it leaves
    // (the first such line's index), instead of all appearing at once.
    const [lateFrom, setLateFrom] = useState<number | null>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const lateTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const firstCoveredLine = (): number | null => {
        const root = rootRef.current;
        const head = root?.querySelector<HTMLElement>('[data-np-write-head]');
        if (!root || !head) return null;
        const edge = head.getBoundingClientRect().top;
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-np-line]'))) {
            if (el.getBoundingClientRect().top > edge) return Number(el.dataset.npLine);
        }
        return null;
    };
    // Notes longer than the window: the page follows the writing, keeping the newest line
    // and the pill just above the Ask bar (owner, 2026-11-01: "if the notes are longer than
    // the default view, then auto scroll down"). Scrolling yourself while it writes stops
    // the following; the pill then waits above the Ask bar (.np-write-head, sticky).
    const follow = React.useRef(true);
    const scrollerRef = React.useRef<HTMLElement | null>(null);
    // The page's scroll rides the same spring as the pill: a smooth scrollTo per line
    // restarted every 140ms (bursts of 20px a frame, then stops half the time).
    const pageY = useMotionValue(0);
    const pageRide = React.useRef<ReturnType<typeof animate> | null>(null);
    React.useLayoutEffect(() => {
        if (shown === null || shown === 0 || !follow.current) return;
        const root = rootRef.current;
        const scroller = scrollerRef.current;
        const newest = root?.querySelector<HTMLElement>(`[data-np-line="${shown - 1}"]`);
        if (!root || !scroller || !newest) return;
        // Layout positions (offsetTop), not the line's rise or the pill's glide mid-flight.
        const rootTop = root.getBoundingClientRect().top;
        const contentBottom = rootTop + newest.offsetTop + newest.offsetHeight + WRITE_HEAD_BELOW_PX;
        const limit = scroller.getBoundingClientRect().bottom - stopRef.current;
        const over = contentBottom - limit;
        if (over <= 0) return;
        const riding = pageRide.current !== null;
        if (!riding) pageY.jump(scroller.scrollTop);
        const target = Math.min(pageY.get() + over, scroller.scrollHeight - scroller.clientHeight);
        const velocity = riding ? pageY.getVelocity() : 0;
        pageRide.current?.stop();
        pageRide.current = animate(pageY, target, {
            ...WRITE_HEAD_SPRING,
            velocity,
            onUpdate: (v) => { if (follow.current) scroller.scrollTop = v; },
            onComplete: () => { pageRide.current = null; },
        });
    }, [shown]);
    useEffect(() => {
        if (!revealing) return;
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const stop = () => { follow.current = false; pageRide.current?.stop(); pageRide.current = null; };
        const onKey = (e: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) stop(); };
        scroller.addEventListener('wheel', stop, { passive: true });
        scroller.addEventListener('touchmove', stop, { passive: true });
        scroller.addEventListener('pointerdown', stop);
        window.addEventListener('keydown', onKey);
        return () => {
            scroller.removeEventListener('wheel', stop);
            scroller.removeEventListener('touchmove', stop);
            scroller.removeEventListener('pointerdown', stop);
            window.removeEventListener('keydown', onKey);
        };
    }, [revealing]);
    // The ride (FLIP on a motion value): where the pill's slot in the page moved to since the
    // last render, measured from layout (a marker just before it) so a scroll is never taken
    // for a move, and clamped to where the sticky pill can be, so a stopped pill never bobs.
    const pillY = useMotionValue(0);
    const markerRef = React.useRef<HTMLDivElement>(null);
    const slotWas = React.useRef<number | null>(null);
    React.useLayoutEffect(() => {
        const root = rootRef.current;
        const marker = markerRef.current;
        if (!root || !marker) { slotWas.current = null; return; }
        const slot = marker.offsetTop;
        const before = slotWas.current;
        slotWas.current = slot;
        if (before === null || before === slot || still) return;
        const rootTop = root.getBoundingClientRect().top;
        const scroller = scrollerRef.current ?? scrollParent(root);
        const lowest = scroller ? scroller.getBoundingClientRect().bottom - stopRef.current - WRITE_HEAD_PX : Infinity;
        const seenAt = (at: number) => Math.min(rootTop + at - WRITE_HEAD_OVERLAP_PX, lowest);
        const delta = seenAt(before) - seenAt(slot);
        if (Math.abs(delta) < 0.5) return;
        const velocity = pillY.getVelocity();
        pillY.jump(pillY.get() + delta);
        animate(pillY, 0, { ...WRITE_HEAD_SPRING, velocity });
    });
    const [pendingReveal, setPendingReveal] = useState(false);
    // The pill's words: a step every 2.2s while waiting, "Writing your notes" once lines come.
    const rewriting = regenerating || pendingReveal;
    const waitingForNotes = (!ready || rewriting) && !revealing;
    const [labelStep, setLabelStep] = useState(0);
    useEffect(() => {
        if (!waitingForNotes) return;
        setLabelStep(0);
        const t = setInterval(() => setLabelStep((n) => n + 1), LABEL_STEP_MS);
        return () => clearInterval(t);
    }, [waitingForNotes, rewriting]);
    const steps = writingLabels(sweepLines.length > 0, rewriting);
    const pillLabel = revealing ? 'Writing your notes' : steps[Math.min(labelStep, steps.length - 1)];
    // When the pill first went up. Notes that come back within 600ms were already written
    // (an old meeting opening), so they just show; later ones were written while it waited.
    const waitingSince = React.useRef<number | null>(null);
    const revealTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const revealTick = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const lineCount = overview.length + sections.reduce((n, s) => n + 1 + s.lines.length, 0);
    const stopReveal = useCallback(() => {
        if (revealTimer.current) clearTimeout(revealTimer.current);
        if (revealTick.current) clearInterval(revealTick.current);
        if (lateTimer.current) clearTimeout(lateTimer.current);
        revealTimer.current = null;
        revealTick.current = null;
        lateTimer.current = null;
    }, []);
    const startReveal = useCallback((lines: number) => {
        stopReveal();
        if (still || lines === 0) { setShown(null); return; }
        follow.current = true;
        scrollerRef.current = scrollParent(rootRef.current);
        let out = 0;
        setShown(0);
        revealTick.current = setInterval(() => {
            out += 1;
            setShown(out);
            if (out >= lines && revealTick.current) { clearInterval(revealTick.current); revealTick.current = null; }
        }, revealStepMs(lines));
        revealTimer.current = setTimeout(() => {
            stopReveal();
            const late = firstCoveredLine();
            setLateFrom(late);
            setShown(null);
            if (late !== null) lateTimer.current = setTimeout(() => setLateFrom(null), WRITE_SETTLE_MS);
        }, revealDurationMs(lines));
    }, [still, stopReveal]);
    useEffect(() => stopReveal, [stopReveal]);
    if (!ready && waitingSince.current === null) waitingSince.current = Date.now();
    // Layout effect: the lines are hidden before the first paint, never shown and then hidden.
    React.useLayoutEffect(() => {
        if (!ready || waitingSince.current === null) return;
        const waited = Date.now() - waitingSince.current;
        waitingSince.current = null;
        if (waited >= 600) startReveal(lineCount);
    }, [ready, lineCount, startReveal]);
    // A rewrite: new notes come from load() after the call returns.
    const summaryRef = details?.detailedSummary;
    const pendingSince = React.useRef<unknown>(null);
    React.useLayoutEffect(() => {
        if (!pendingReveal || summaryRef === pendingSince.current) return;
        setPendingReveal(false);
        startReveal(lineCount);
    }, [pendingReveal, summaryRef, lineCount, startReveal]);
    useEffect(() => {
        if (!pendingReveal) return;
        const t = setTimeout(() => setPendingReveal(false), 6000);
        return () => clearTimeout(t);
    }, [pendingReveal]);
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
        npTrack('notes_rewritten');
        setConfirm(null);
        setNotice(null);
        setRegenerating(true);
        const key = req.kind === 'rewrite' ? '' : req.id;
        try {
            const res = await window.electronAPI.regenerateMeetingSummary(meetingId,
                req.kind === 'template' ? { noteTemplateId: req.id } : req.kind === 'mode' ? { modeId: req.id } : {});
            if (res?.success) {
                pendingSince.current = details?.detailedSummary;
                setPendingReveal(true);
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
    const softBtn = `${NP_PILL} justify-center`;
    const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

    // Granola's "Writing notes" card (7.722.1, read 2026-11-01): a wide 40px pill with a
    // spinner, arriving from 96% scale and a 2px blur over 250ms. Its label carries
    // Granola's grey sweep (.np-sweep-text). Owner: "copy the granola notes generation
    // animation, that pill sweep". One element from Stop until the notes have swept in,
    // so it does not blink when they arrive.
    const showPill = !ready || regenerating || pendingReveal || revealing;
    // Lines in page order: the overview, then each heading and its points.
    let lineNo = 0;
    const reveal = (): { out: boolean; className: string; line: number } => {
        const i = lineNo++;
        if (shown === null) return { out: true, className: lateFrom !== null && i >= lateFrom ? 'np-write-late' : '', line: i };
        return { out: i < shown, className: 'np-write-line', line: i };
    };

    return (
        <div ref={rootRef} className={`relative ${ready ? 'px-8 pt-5' : 'px-8 pt-6'}`} style={ready ? { paddingBottom: Math.max(172, stopPx + 52) } : undefined}>
            {ready && (
                <>
                <div className={`flex flex-wrap items-center gap-1.5 ${revealing ? 'np-fade-in-soft' : ''}`}>
                    <NotesTemplateMenu
                        currentName={notesLabel(details?.detailedSummary)}
                        currentTemplateId={currentTemplateId}
                        modes={templatePickerOptions(modes, mode)}
                        disabled={regenerating}
                        needsPro={needsPro}
                        onPick={onPick}
                    />
                    <button type="button" onClick={() => { npTrack('notes_copied'); void copy(); }} className={softBtn} style={ink('--np-ink')}>
                        {copied ? <Check className="w-3.5 h-3.5" strokeWidth={2} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    {/* Share as an icon in the same pill as Notes and Copy: 28px round, same wash and outline. */}
                    <ShareMenu
                        meetingId={meetingId}
                        disabled={regenerating}
                        hasTranscript={(details?.transcript?.length ?? 0) > 0}
                        onOpen={() => npTrack('share_opened')}
                        iconOnly
                        triggerClassName="np-outline np-wash h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-full transition-colors"
                        triggerStyle={ink('--np-ink')}
                    />
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
                </>
            )}

            {ready && (
                <div className={`mt-5 space-y-5 select-text ${regenerating || pendingReveal ? 'opacity-50' : ''}`}>
                    {overview.length > 0 && (shown === null || shown > 0) && (
                        <div className="space-y-2">
                            {overview.map((p, i) => {
                                const r = reveal();
                                return r.out && <p key={i} data-np-line={r.line} className={`text-[15px] leading-[1.5] ${r.className}`} style={ink('--np-ink-secondary')}>{p}</p>;
                            })}
                        </div>
                    )}
                    {sections.map((s, i) => {
                        const h = reveal();
                        const points = s.lines.map(() => reveal());
                        if (!h.out) return null;
                        return (
                            <section key={`${s.title}-${i}`}>
                                <h2 data-np-line={h.line} className={`text-[15px] leading-[1.5] font-semibold ${h.className}`} style={ink('--np-ink-strong')}>{s.title}</h2>
                                <ul className="mt-0.5 ml-6 list-disc">
                                    {s.lines.map((l, j) => {
                                        const r = points[j];
                                        return r.out && (
                                            <li key={j} data-np-line={r.line} className={`text-[15px] leading-[1.5] marker:text-[color:var(--np-marker)] ${r.className}`} style={ink(l.mine ? '--np-ink' : '--np-ink-secondary')}>
                                                {l.text}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            )}

            {/* The pill: above your notes while they are read, then the write head
                riding down after the last written line. */}
            {/* The pill's slot in the page, for its ride (pillY). */}
            <div ref={markerRef} aria-hidden />
            <AnimatePresence mode="popLayout">
                {showPill && (
                    <motion.div
                        key="writing"
                        // Sticks above the bottom bar, wherever its top is now (.np-write-head).
                        style={ready ? { y: pillY, bottom: stopPx - WRITE_HEAD_OVERLAP_PX } : { y: pillY }}
                        data-np-write-head={ready ? '' : undefined}
                        // Motion tokens (transitions-polish, 2026-11-01): opens 250ms smooth-out from
                        // 0.96 + 2px blur. Its ride down the page is the spring above (pillY).
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        role="status"
                        aria-live="polite"
                        initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, filter: 'blur(2px)' }}
                        animate={still ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        // Leaving as a toast closes (transitions.dev #22): 350ms smooth-out with a 2px blur,
                        // so it melts away rather than blinks (150ms dropped it to 0.44 in one frame) while
                        // the lines it covered come out from under it. It contracts slightly as it goes
                        // (0.96, the modal-close scale: about 13px off each end of the wide pill).
                        exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, filter: 'blur(2px)', transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
                        className={`np-writing-pill flex h-10 w-full max-w-[41.5rem] items-center gap-2.5 rounded-full pl-3 pr-4 text-[13px] font-medium ${ready ? 'np-write-head' : ''}`}
                    >
                        <span aria-hidden className="np-spinner" />
                        {/* Text states swap (transitions.dev): 150ms ease-in-out, 4px, 2px blur. */}
                        <span className="relative min-w-0 flex-1 overflow-hidden">
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.span
                                    key={pillLabel}
                                    // transitions.dev shimmer text (owner, 2026-11-01): muted words, a dark band sweeping over them.
                                    className="t-shimmer max-w-full truncate align-top"
                                    data-text={pillLabel}
                                    initial={still ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(2px)' }}
                                    animate={still ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                                    exit={still ? { opacity: 0 } : { opacity: 0, y: -4, filter: 'blur(2px)' }}
                                    transition={{ duration: 0.15, ease: 'easeInOut' }}
                                >
                                    {pillLabel}
                                </motion.span>
                            </AnimatePresence>
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Your notes clear (150ms, 2px blur) as the written ones start, not cut. */}
            <AnimatePresence initial={false}>
            {!ready && (
                /* Granola keeps the user's own notes on screen while it writes, every line
                   carrying the grey sweep 140ms after the one above, so the sweep runs down
                   the page (its X6 grayscalePulse: animationDelay = line × 140ms). */
                sweepLines.length > 0 && (
                    <motion.div
                        key="your-notes"
                        exit={still ? { opacity: 0 } : { opacity: 0, filter: 'blur(2px)', transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] } }}
                        className="np-sweep-notes mt-5 select-text"
                        aria-hidden
                    >
                        {sweepLines.map((line, i) => (
                            <div key={i} className={`np-sweep-line np-sweep-${line.kind}`} style={{ paddingLeft: line.kind === 'heading' ? 0 : line.indent * 18 }}>
                                {line.kind === 'bullet' && <span className="np-sweep-dot" />}
                                {line.kind === 'task' && <span className="np-sweep-box" />}
                                <span className="np-sweep-text" style={{ animationDelay: `${i * SWEEP_LINE_MS}ms` }}>{line.text}</span>
                            </div>
                        ))}
                    </motion.div>
                )
            )}
            </AnimatePresence>
        </div>
    );
});
NotesEnhanced.displayName = 'NotesEnhanced';
