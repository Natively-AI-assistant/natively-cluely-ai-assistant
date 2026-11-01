import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ArrowDown, Check, ChevronDown, ChevronUp, Copy, FileText, ImagePlus, LayoutGrid, Minus, MoreHorizontal, Paperclip, Pause, Play, RotateCcw, Scissors, Search, X } from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { applyTypedKeyAtEnd, plainAnswerText } from './meeting/notesView';
import { NotepadAnswer } from './notes/NotepadAnswer';
import { useLastTimeRecap } from './assist/useLastTimeRecap';
import { shouldBlockFocus, shouldFireStealthTapStart } from '../lib/overlayStealthFocusGuards.mjs';
import { editCommand, editShortcutLetter, paste } from '../lib/stealthEdit.mjs';
import { NotesEditor, type NotesEditorHandle } from './notes/NotesEditor';
import { NotesHeading, type HeadingInfo } from './notes/NotesHeading';
import { NotesEnhanced, type NotesEnhancedHandle } from './notes/NotesEnhanced';
import { NoteTemplateGallery } from './notes/NoteTemplateGallery';
import { noteTemplateById } from '../../electron/services/meeting/noteTemplates';
import { answerSources, applyTranscriptEvent, askContext, EMPTY_LIVE_TRANSCRIPT, findInTranscript, listeningBarHeights, liveTranscriptRows, type AskTurn, type LiveTranscript, type TranscriptHit, type TranscriptLine } from './notes/notepadView';
import { TranscriptControls } from './notes/TranscriptControls';
import { NpPop } from './notes/NpPop';
import { NOTE_RECIPES, noteRecipeById, parseSlashCommand, recipesFor, searchRecipes, type NoteRecipe } from '../../electron/llm/noteRecipes';
import { NOTEPAD_DEMO_STILL_MS, notepadDemoFrame, sameDemoContent, type NotepadDemoFrame } from './notes/notepadDemo';

/**
 * The notes window (`?window=notes`, 2026-10-15), laid out and working like
 * Granola's notepad (2026-10-20):
 *
 *  - Heading (notes/NotesHeading.tsx): the title in the serif, renamed by a
 *    click; a chip with the day and people that opens the event (Join, people
 *    by company, add or remove someone, link a different event).
 *  - The page (notes/NotesEditor.tsx): headings, lists, checkboxes, bold and
 *    the rest, a "/" menu, Find. Markdown underneath.
 *  - While the meeting runs, Granola's floating bottom bar: one pill with bars
 *    that follow the real audio level (red after 3 s of silence), ^ for the
 *    transcript (bubbles, search, copy) and ■ to stop; beside it "Ask
 *    anything" with suggestions (the overlay's live helpers), answered here
 *    with the lines of the transcript it matches, Copy, Say more, Retry.
 *    Pause is in the ⋯ menu; a paused pill reads Resume.
 *  - The meeting's status, shown here because a notepad meeting hides the
 *    overlay: the automatic stop's "nothing has been said" warning with Keep
 *    going, and capture or transcription trouble.
 *  - After Stop (notes/NotesEnhanced.tsx): the notes written into the same
 *    window, a My notes / Enhanced switch at the bottom, the template, Copy, Share.
 *
 * Its look is Granola's own (sizes, colours, type), from the `.notepad` tokens
 * in index.css; the title uses IBM Plex Serif, Granola's fallback for its
 * licensed display face.
 *
 * Every change goes to main at once (main keeps it with the running meeting,
 * on disk within ~2 s, and hands it to the notes at Stop). Main never sends
 * the text back while the user types; it replaces it only when a new meeting
 * clears the page. The window never takes focus by itself.
 *
 * Typed into without focus, as the overlay's input is (2026-10-20): a click in
 * a field starts the keyboard hook for this window (main picks the target from
 * the sender), the click's focus is blocked, and the hook's keys go to the
 * field clicked last. The meeting app keeps focus. With no hook (none built, a
 * CJK keyboard, no Accessibility yet on macOS) the fields are typed into by
 * focus as before. The same gates as the overlay's (NativelyInterface).
 *
 * A light route (AuxRoot): no i18n here, like the other overlay panels.
 *
 * `preview` (2026-10-20): Settings › Overlay's notepad tab draws this same page
 * with sample notes. It talks to nothing (every effect returns at once), its
 * top strip is no drag handle, and it takes no clicks. With `demo` (2026-11-01)
 * it plays notes/notepadDemo.ts on a loop: the transcript streaming in, notes
 * typed, the bars moving, "/" listing the recipes, then Ask answering. Reduced
 * motion shows one still frame.
 */

type Phase = 'idle' | 'live' | 'ended';
type Field = 'notes' | 'ask' | 'title' | 'find' | 'search' | 'attendee' | 'template';
/** `recipeId`/`extra`: the recipe a turn ran and what was typed after it, for Retry. */
type Turn = AskTurn & { kind: 'chat' | 'helper'; recipeId?: string; extra?: string; errorText?: string };
type HelperAction = 'catch_me_up' | 'define' | 'sound_smart' | 'follow_up_questions';
export interface NotesWindowPreview {
    title: string;
    people: number;
    text: string;
    /** Play the live demo (notes/notepadDemo.ts) instead of still notes. */
    demo?: boolean;
    /** The template chip shown over the notes. */
    templateId?: string;
    /** The other side's name in the transcript bubbles. */
    them?: string;
}

/** How often typing tells main "the user is typing" (no automatic stop under their hands). */
const TYPING_PING_MS = 5_000;
/** How often the heading asks main for the meeting's title and people while it runs (the calendar link lands late). */
const MEETING_INFO_POLL_MS = 5_000;
/** Transcript lines kept for the ^ panel and Ask's sources. */
const TRANSCRIPT_KEEP = 600;

/**
 * The floating panel (2026-10-30): slow, critically damped springs, as Apple's sheets move, so the
 * panel unrolls rather than pops. The transcript opens over .55 s and closes over .45 s; Ask's short
 * recipe row over .4 / .3. No bounce either way. 400px tall unless dragged, never under 160.
 */
const SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;
const PANEL_OPEN = { type: 'spring', duration: 0.55, bounce: 0 } as const;
const PANEL_CLOSE = { type: 'spring', duration: 0.45, bounce: 0 } as const;
const ROW_OPEN = { type: 'spring', duration: 0.4, bounce: 0 } as const;
const ROW_CLOSE = { type: 'spring', duration: 0.3, bounce: 0 } as const;
const PANEL_MIN = 160;
const PANEL_HEIGHT_KEY = 'notepad.panelHeight';
function readPanelHeight(): number {
    try { const v = Number(localStorage.getItem(PANEL_HEIGHT_KEY)); return Number.isFinite(v) && v >= PANEL_MIN ? v : 400; } catch { return 400; }
}

/**
 * Ask's recipes (electron/llm/noteRecipes.ts), as Granola's: two chips, the rest under
 * All recipes and "/". While live the chips are the live helpers; after Stop, the
 * follow-up email and todos, as Granola's are after a meeting.
 */
const CHIP_IDS: Record<'live' | 'ended', string[]> = { live: ['what-did-i-miss', 'sound-smart'], ended: ['follow-up-email', 'todos'] };
const RECENT_RECIPES_KEY = 'notepad.recentRecipes';
function readRecentRecipes(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(RECENT_RECIPES_KEY) ?? '[]');
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!noteRecipeById(x)).slice(0, 3) : [];
    } catch { return []; }
}
function rememberRecipe(id: string): string[] {
    const next = [id, ...readRecentRecipes().filter((x) => x !== id)].slice(0, 3);
    try { localStorage.setItem(RECENT_RECIPES_KEY, JSON.stringify(next)); } catch { /* private window: no Recent */ }
    return next;
}

/** Granola's recipe mark: a slash in a rounded square. */
const RecipeIcon: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
        <rect x="1.1" y="1.1" width="11.8" height="11.8" rx="3" />
        <path d="M8.4 4.1 5.6 9.9" />
    </svg>
);

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

const EMPTY_INFO: HeadingInfo & { speakers: { me: string; them: string } } = {
    title: null, people: 0, event: null, attendees: [], selfEmail: null, speakers: { me: 'You', them: 'Them' },
};

const NotesWindow: React.FC<{ preview?: NotesWindowPreview }> = ({ preview }) => {
    const isLight = useResolvedTheme() === 'light';
    const [text, setText] = useState(preview?.text ?? '');
    const [phase, setPhase] = useState<Phase>(preview ? 'live' : 'idle');
    // The notepad's demand (2026-11-01, FunnelTelemetry.notepadUsed): which parts of it are used,
    // a fixed action name and recipe id only, never the notes, a question or an answer.
    const npTrack = useCallback((action: string, recipe?: string) => {
        if (preview) return;
        window.electronAPI?.funnelTrack?.('notepad_used', { action, phase, ...(recipe ? { recipe: recipe.replace(/-/g, '_') } : {}) })?.catch?.(() => {});
    }, [preview, phase]);
    const [meetingId, setMeetingId] = useState<string | null>(null);
    const [info, setInfo] = useState(() => (preview
        ? { ...EMPTY_INFO, title: preview.title, people: preview.people, speakers: { me: 'You', them: preview.them ?? EMPTY_INFO.speakers.them } }
        : EMPTY_INFO));
    const [savedTitle, setSavedTitle] = useState<string | null>(null);
    const [ask, setAskState] = useState('');
    const [askEngaged, setAskEngaged] = useState(false);
    const [allRecipes, setAllRecipes] = useState(false);
    const [recentRecipes, setRecentRecipes] = useState<string[]>(readRecentRecipes);
    // What the user typed here, for a live recipe's context.
    const textRef = useRef(text);
    textRef.current = text;
    // The highlighted row of the "/" list.
    const [slashAt, setSlashAt] = useState(0);
    const [findTranscript, setFindTranscript] = useState(false);
    const [hitIndex, setHitIndex] = useState(0);
    const [atBottom, setAtBottom] = useState(true);
    const [shownKind, setShownKind] = useState<'transcript' | 'ask' | null>(null);
    // The preview's panel leaves the notes in view above it.
    const [panelHeight, setPanelHeight] = useState(() => (preview ? 300 : readPanelHeight()));
    const [resizing, setResizing] = useState(false);
    const [winH, setWinH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
    const askCardRef = useRef<HTMLDivElement>(null);
    // How much of the page the floating bottom bar covers, for the notes' writing pill to stop above it.
    const pageRef = useRef<HTMLDivElement>(null);
    const bottomBarRef = useRef<HTMLDivElement>(null);
    const [bottomInset, setBottomInset] = useState<number | undefined>(undefined);
    // Scrolled off the top: the page fades out under the heading instead of being cut at a straight edge.
    const [pageScrolled, setPageScrolled] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);
    // You and the call each keep your own words in progress (applyTranscriptEvent).
    const [live, setLive] = useState<LiveTranscript>(EMPTY_LIVE_TRANSCRIPT);
    const lines = live.lines;
    const [search, setSearchState] = useState('');
    const [highlightAt, setHighlightAt] = useState<number | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [turns, setTurns] = useState<Turn[]>([]);
    const turnsRef = useRef<Turn[]>([]);
    turnsRef.current = turns;
    const [paused, setPaused] = useState(false);
    const [level, setLevel] = useState<number | null>(null);
    const [stopsAt, setStopsAt] = useState<number | null>(null);
    const [problems, setProblems] = useState<Record<string, string>>({});
    // Ambient AI Chat left this meeting with no audio (main: isMeetingWithoutAudio).
    const [withoutAudio, setWithoutAudio] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraftState] = useState('');
    const [attendeeDraft, setAttendeeDraftState] = useState('');
    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQueryState] = useState('');
    const [findPos, setFindPos] = useState({ index: 0, count: 0 });
    const [endedTab, setEndedTab] = useState<'enhanced' | 'mine'>('enhanced');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    // Note templates (electron/services/meeting/noteTemplates.ts): the one the
    // running meeting's notes will be written in, and the gallery.
    const [liveTemplateId, setLiveTemplateId] = useState<string | null>(null);
    const [templateNotice, setTemplateNotice] = useState<string | null>(null);
    const [gallery, setGallery] = useState<{ initialId: string | null } | null>(null);
    const [galleryQuery, setGalleryQueryState] = useState('');
    const galleryQueryRef = useRef('');
    const setGalleryQuery = useCallback((v: string) => { galleryQueryRef.current = v; setGalleryQueryState(v); }, []);
    const enhancedRef = useRef<NotesEnhancedHandle>(null);
    const answerScrollRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<NotesEditorHandle>(null);
    const askRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const lastTypingPing = useRef(0);
    // "Last time" for a recurring meeting, as the overlay shows it (assist/useLastTimeRecap).
    const lastTime = useLastTimeRecap();
    // A state broadcast that lands before the first read wins over that read.
    const heardFromMain = useRef(false);
    // Typing through the keyboard hook (see the header).
    const [hookTyping, setHookTyping] = useState(false);
    const hookTypingRef = useRef(false);
    const hookAvailableRef = useRef(false);
    const hookEngageOkRef = useRef(true);
    const fieldRef = useRef<Field>('notes');
    const [field, setField] = useState<Field>('notes');
    const focusBlockedRef = useRef(false);
    const lineSeq = useRef(0);

    // The text fields the hook types into: the value is kept in a ref at once,
    // so two keys landing before a render both count.
    const askTextRef = useRef(ask);
    const titleDraftRef = useRef(titleDraft);
    const attendeeDraftRef = useRef(attendeeDraft);
    const findQueryRef = useRef(findQuery);
    const searchRef = useRef(search);
    const setAsk = useCallback((v: string) => { askTextRef.current = v; setAskState(v); }, []);
    const setTitleDraft = useCallback((v: string) => { titleDraftRef.current = v; setTitleDraftState(v); }, []);
    const setAttendeeDraft = useCallback((v: string) => { attendeeDraftRef.current = v; setAttendeeDraftState(v); }, []);
    const setSearch = useCallback((v: string) => { searchRef.current = v; setSearchState(v); }, []);
    const setFindQuery = useCallback((v: string) => {
        findQueryRef.current = v;
        setFindQueryState(v);
        const count = editorRef.current?.setFind(v) ?? 0;
        setFindPos({ index: 0, count });
    }, []);

    useEffect(() => {
        if (preview) return;
        let cancelled = false;
        window.electronAPI?.liveNotesGetState?.().then((s) => {
            if (cancelled || !s || heardFromMain.current) return;
            setText(typeof s.text === 'string' ? s.text : '');
            setPhase(s.phase);
            setMeetingId(s.meetingId ?? null);
        }).catch(() => { /* empty page */ });
        const off = window.electronAPI?.onLiveNotesState?.((s) => {
            heardFromMain.current = true;
            setPhase(s.phase);
            setMeetingId(s.meetingId ?? null);
            if (typeof s.text === 'string') setText(s.text);
        });
        return () => { cancelled = true; off?.(); };
    }, []);

    // The heading: the meeting's title, event and people, while it runs. Kept
    // after Stop (the page still belongs to that meeting); a new meeting starts over.
    const readInfo = useCallback(() => {
        window.electronAPI?.liveNotesMeetingInfo?.().then((next) => {
            if (!next?.live) return;
            setInfo({
                title: next.title,
                people: next.people,
                event: next.event ?? null,
                attendees: Array.isArray(next.attendees) ? next.attendees : [],
                selfEmail: next.selfEmail ?? null,
                speakers: next.speakers ?? EMPTY_INFO.speakers,
            });
        }).catch(() => { /* keep the last */ });
    }, []);
    useEffect(() => {
        if (phase !== 'live' || preview) return;
        setInfo(EMPTY_INFO);
        setSavedTitle(null);
        setLive(EMPTY_LIVE_TRANSCRIPT);
        setTurns([]);
        setEndedTab('enhanced');
        readInfo();
        const timer = setInterval(readInfo, MEETING_INFO_POLL_MS);
        return () => clearInterval(timer);
    }, [phase, readInfo]);
    // After Stop the notes call names the meeting. Read the saved title whichever tab is open: it
    // used to arrive only through NotesEnhanced, so on My notes the heading never changed (2026-10-31).
    useEffect(() => {
        if (phase !== 'ended' || !meetingId || preview) return;
        const api = window.electronAPI;
        const read = () => {
            api?.getMeetingDetails?.(meetingId).then((d: any) => {
                const title = typeof d?.title === 'string' ? d.title.trim() : '';
                if (title) setSavedTitle(title);
            }).catch(() => { /* not saved yet */ });
        };
        read();
        const off = api?.onMeetingsUpdated?.(read);
        return () => { off?.(); };
    }, [phase, meetingId, preview]);

    // The ^ panel's transcript (main sends it here only while the window is open).
    useEffect(() => {
        if (preview || !window.electronAPI?.onNativeAudioTranscript) return;
        return window.electronAPI.onNativeAudioTranscript((t) => {
            const at = typeof t.timestamp === 'number' ? t.timestamp : Date.now();
            const text = (t.text ?? '').trim();
            if (!text) return;
            const ev = { speaker: t.speaker, text, at: at + (lineSeq.current++ % 1000) / 1000, final: !!t.final };
            setLive((prev) => applyTranscriptEvent(prev, ev, Date.now(), TRANSCRIPT_KEEP));
        });
    }, []);
    // The transcript keeps to its newest line while it is read there (Granola's: within 48px of the end).
    useEffect(() => {
        const el = transcriptRef.current;
        if (el && showTranscript && highlightAt === null && atBottom) el.scrollTop = el.scrollHeight;
    }, [live, showTranscript, highlightAt, atBottom]);
    useEffect(() => { if (!showTranscript) { setAtBottom(true); setFindTranscript(false); } }, [showTranscript]);
    // The transcript belongs to a running meeting: after Stop it closes, so Ask has its slot back.
    useEffect(() => { if (phase !== 'live') setShowTranscript(false); }, [phase]);
    // The preview's live demo: one frame every 90 ms, held while the window is hidden.
    const demo = !!preview?.demo;
    useEffect(() => {
        if (!demo) return;
        let last: NotepadDemoFrame | null = null;
        const show = (f: NotepadDemoFrame) => {
            setLevel(f.level);
            setShowTranscript(f.showTranscript);
            setAskEngaged(f.askOpen);
            if (last && sameDemoContent(last, f)) return;
            last = f;
            setText(f.text);
            setLive(f.transcript);
            setAsk(f.askText);
            setTurns(f.turns.map((t) => ({ ...t, kind: 'helper', recipeId: 'what-did-i-miss' })));
        };
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { show(notepadDemoFrame(NOTEPAD_DEMO_STILL_MS)); return; }
        let elapsed = 0;
        let prev = performance.now();
        show(notepadDemoFrame(0));
        const timer = setInterval(() => {
            const now = performance.now();
            if (!document.hidden) elapsed += Math.min(now - prev, 250);
            prev = now;
            show(notepadDemoFrame(elapsed));
        }, 90);
        return () => clearInterval(timer);
    }, [demo, setAsk]);
    useEffect(() => {
        const onResize = () => setWinH(window.innerHeight);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    useEffect(() => {
        if (highlightAt === null || !showTranscript) return;
        transcriptRef.current?.querySelector(`[data-at="${highlightAt}"]`)?.scrollIntoView({ block: 'center' });
    }, [highlightAt, showTranscript]);

    // Status while the meeting runs: pause, the audio level, the automatic stop's
    // warning, capture and transcription trouble.
    useEffect(() => {
        const api = window.electronAPI;
        if (preview || !api) return;
        api.getTranscriptionPaused?.().then((p) => setPaused(!!p)).catch(() => {});
        api.getMeetingAudioCapture?.().then((state) => setWithoutAudio(state?.withoutAudio === true)).catch(() => {});
        const offs = [
            api.onMeetingAudioCapture?.((state) => setWithoutAudio(state?.withoutAudio === true)),
            api.onTranscriptionPaused?.(({ paused: p }) => setPaused(p)),
            api.onMeetingAudioLevel?.((l) => setLevel(l)),
            api.onMeetingAutoStopNotice?.((d) => setStopsAt(typeof d?.stopsAt === 'number' ? d.stopsAt : null)),
            api.onSttStatusChanged?.((d) => {
                const key = `stt:${d.channel}`;
                const msg = d.state === 'failed' && !d.fallback
                    ? 'Transcription stopped. Check your speech provider in Settings.'
                    : d.state === 'reconnecting' ? 'Transcription is reconnecting…' : null;
                setProblems((prev) => {
                    if ((prev[key] ?? null) === msg) return prev;
                    const next = { ...prev };
                    if (msg) next[key] = msg;
                    else delete next[key];
                    return next;
                });
            }),
            api.onAudioCaptureFailed?.((p) => {
                if (!p?.terminal && !p?.stuck) return;
                const key = `capture:${p.channel}`;
                const msg = p.channel === 'mic'
                    ? 'Natively can’t hear your microphone. Check Settings › Audio.'
                    : 'Natively can’t hear the call. Check Settings › Audio.';
                setProblems((prev) => (prev[key] === msg ? prev : { ...prev, [key]: msg }));
            }),
        ];
        return () => { for (const off of offs) off?.(); };
    }, []);
    useEffect(() => {
        if (phase === 'live') return;
        setStopsAt(null);
        setProblems({});
        setPaused(false);
        setLevel(null);
    }, [phase]);

    const commit = useCallback((next: string) => {
        setText(next);
        window.electronAPI?.liveNotesSetText?.(next);
        const now = Date.now();
        if (phase === 'live' && now - lastTypingPing.current > TYPING_PING_MS) {
            lastTypingPing.current = now;
            window.electronAPI?.meetingAutoStopTyping?.();
        }
    }, [phase]);

    // The answer streams to this window only (the handler replies to its sender).
    useEffect(() => {
        const api = window.electronAPI;
        if (preview || !api?.onGeminiStreamToken) return;
        const streamingChat = () => {
            const last = turnsRef.current[turnsRef.current.length - 1];
            return !!last && last.kind === 'chat' && last.status === 'streaming';
        };
        const updateLast = (fn: (t: Turn) => Turn) => setTurns((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.kind !== 'chat' || last.status !== 'streaming') return prev;
            return [...prev.slice(0, -1), fn(last)];
        });
        const offToken = api.onGeminiStreamToken((token) => {
            if (!streamingChat()) return;
            updateLast((t) => ({ ...t, text: t.text + token }));
        });
        const offDone = api.onGeminiStreamDone?.((data) => {
            if (!streamingChat()) return;
            updateLast((t) => ({ ...t, text: typeof data?.finalText === 'string' && data.finalText ? data.finalText : t.text, status: 'done' }));
        });
        const offError = api.onGeminiStreamError?.(() => {
            if (!streamingChat()) return;
            updateLast((t) => ({ ...t, status: t.text ? 'done' : 'error' }));
        });
        return () => { offToken(); offDone?.(); offError?.(); };
    }, []);
    useEffect(() => {
        const el = answerScrollRef.current;
        if (el && turns[turns.length - 1]?.status === 'streaming') el.scrollTop = el.scrollHeight;
    }, [turns]);

    const busy = turns.some((t) => t.status === 'streaming');
    // A finished meeting's Ask reads the whole meeting, as its page's Ask does (RAGManager.queryMeeting).
    // Its turn is a 'helper' turn so the overlay's chat tokens, which stream to every window, never land in it.
    const askMeeting = useCallback((id: string, question: string, history?: string) => {
        const api = window.electronAPI;
        if (!api?.ragQueryMeeting) return;
        setTurns((prev) => [...prev, { question, text: '', status: 'streaming', kind: 'helper' }]);
        let text = '';
        const settle = (patch: Partial<Turn>) => setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 && t.kind === 'helper' && t.status === 'streaming' ? { ...t, ...patch } : t)));
        const offs: Array<(() => void) | undefined> = [];
        let finished = false;
        const finish = (errorText?: string) => {
            if (finished) return;
            finished = true;
            offs.forEach((off) => off?.());
            settle(text ? { text, status: 'done' } : { status: 'error', errorText });
        };
        offs.push(api.onRAGStreamChunk?.((d) => { if (d.meetingId !== id) return; text += d.chunk; settle({ text }); }));
        offs.push(api.onRAGStreamComplete?.((d) => { if (d.meetingId === id) finish(); }));
        offs.push(api.onRAGStreamError?.((d) => { if (d.meetingId === id) finish(); }));
        // The last answers ride along, so "Say more about that." has its referent.
        api.ragQueryMeeting(id, history ? `${question}\n\n(Earlier in this chat:\n${history})` : question)
            // Resolves after the last chunk; a query another Ask replaced ends without a complete event.
            .then((r) => finish(r?.fallback ? 'This meeting is still being prepared for questions. Try again in a minute.' : undefined))
            .catch(() => finish());
    }, []);

    // `shown`: what the turn reads as (a recipe's name), when the question sent is its longer instruction.
    const submitAsk = useCallback((value: string, shown?: string) => {
        const question = value.trim();
        const api = window.electronAPI;
        if (!question || turnsRef.current.some((t) => t.status === 'streaming')) return;
        if (!shown) npTrack('ask');
        if (phase === 'ended' && meetingId) { setAsk(''); askMeeting(meetingId, question, askContext(turnsRef.current)); return; }
        if (!api?.streamGeminiChat) return;
        setAsk('');
        // The last answers go along, so "and the second one?" has its referent.
        const context = askContext(turnsRef.current);
        const label = shown?.trim() || question;
        setTurns((prev) => [...prev, { question: label, text: '', status: 'streaming', kind: 'chat' }]);
        api.streamGeminiChat(question, undefined, context).catch(() => {
            setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 && t.question === label && !t.text ? { ...t, status: 'error' } : t)));
        });
    }, [setAsk, phase, meetingId, askMeeting, npTrack]);
    const submitAskRef = useRef(submitAsk);
    // Enter in Ask, typed or through the keyboard hook: "/…" runs the recipe it names, anything else is asked.
    const askSubmitRef = useRef<() => void>(() => {});
    submitAskRef.current = submitAsk;

    const runHelper = useCallback((action: HelperAction, label: string) => {
        const api = window.electronAPI;
        if (!api?.generateLiveHelper || turnsRef.current.some((t) => t.status === 'streaming')) return;
        setTurns((prev) => [...prev, { question: label, text: '', status: 'streaming', kind: 'helper' }]);
        const settle = (patch: Partial<Turn>) => setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 && t.kind === 'helper' && t.status === 'streaming' ? { ...t, ...patch } : t)));
        api.generateLiveHelper(action)
            .then((res) => settle(res?.text ? { text: res.text, status: 'done' } : { status: 'error' }))
            .catch(() => settle({ status: 'error' }));
    }, []);

    // A recipe from a chip, All recipes or "/": a live helper, or its instruction over the meeting
    // (note-recipe:run reads a finished meeting whole, a live one so far with what was typed here).
    const runRecipe = useCallback((recipe: NoteRecipe, extra = '') => {
        if (turnsRef.current.some((t) => t.status === 'streaming')) return;
        npTrack('recipe', recipe.id);
        setAllRecipes(false);
        setAsk('');
        setRecentRecipes(rememberRecipe(recipe.id));
        if (recipe.helper) { runHelper(recipe.helper, recipe.label); return; }
        const api = window.electronAPI;
        if (!api?.runNoteRecipe || turnsRef.current.some((t) => t.status === 'streaming')) return;
        const label = extra ? `${recipe.label} ${extra}` : recipe.label;
        setTurns((prev) => [...prev, { question: label, text: '', status: 'streaming', kind: 'helper', recipeId: recipe.id, extra }]);
        const settle = (patch: Partial<Turn>) => setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 && t.kind === 'helper' && t.status === 'streaming' ? { ...t, ...patch } : t)));
        api.runNoteRecipe({ recipeId: recipe.id, extra, meetingId, phase: phase === 'ended' ? 'ended' : 'live', notes: textRef.current })
            .then((res) => settle(res?.text ? { text: res.text, status: 'done' } : { status: 'error' }))
            .catch(() => settle({ status: 'error' }));
    }, [setAsk, runHelper, meetingId, phase, npTrack]);

    const retry = (i: number) => {
        const turn = turns[i];
        if (!turn) return;
        npTrack('answer_retried');
        setTurns((prev) => prev.filter((_, j) => j !== i));
        const recipe = turn.recipeId ? noteRecipeById(turn.recipeId) : NOTE_RECIPES.find((r) => r.helper && r.label === turn.question);
        if (recipe) runRecipe(recipe, turn.extra ?? '');
        else submitAsk(turn.question);
    };

    const copyText = async (key: string, value: string) => {
        const res = await window.electronAPI?.notesWindowCopyText?.(value);
        if (!res?.success) return;
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    };

    // ── The title ──
    const commitTitle = useCallback(() => {
        const next = titleDraftRef.current.replace(/\s+/g, ' ').trim();
        setEditingTitle(false);
        if (fieldRef.current === 'title') { fieldRef.current = 'notes'; setField('notes'); }
        const api = window.electronAPI;
        if (phase === 'live') {
            setInfo((prev) => ({ ...prev, title: next || prev.event?.title || null }));
            void api?.liveNotesSetTitle?.(next).then(() => readInfo()).catch(() => {});
        } else if (phase === 'ended' && meetingId && next) {
            setSavedTitle(next);
            void api?.updateMeetingTitle?.(meetingId, next).catch(() => {});
        }
    }, [phase, meetingId, readInfo]);
    const commitTitleRef = useRef(commitTitle);
    commitTitleRef.current = commitTitle;

    const addAttendee = useCallback(() => {
        const email = attendeeDraftRef.current.trim();
        if (!email) return;
        void window.electronAPI?.liveNotesSetAttendees?.({ add: email }).then((res) => {
            if (res?.success) { setAttendeeDraft(''); readInfo(); }
        }).catch(() => {});
    }, [readInfo, setAttendeeDraft]);
    const addAttendeeRef = useRef(addAttendee);
    addAttendeeRef.current = addAttendee;

    const stepFind = useCallback((back = false) => {
        const pos = editorRef.current?.stepFind(back);
        if (pos) setFindPos(pos);
    }, []);

    // ── Note templates ──
    useEffect(() => {
        if (preview || phase === 'ended') { setLiveTemplateId(preview?.templateId && phase !== 'ended' ? preview.templateId : null); return; }
        window.electronAPI?.liveNotesGetTemplate?.().then((id) => setLiveTemplateId(noteTemplateById(id) ? id : null)).catch(() => {});
    }, [phase, preview]);
    useEffect(() => {
        if (!templateNotice) return;
        const t = setTimeout(() => setTemplateNotice(null), 5000);
        return () => clearTimeout(t);
    }, [templateNotice]);
    const setLiveTemplate = useCallback((id: string | null) => {
        const api = window.electronAPI;
        if (!api?.liveNotesSetTemplate) return;
        void api.liveNotesSetTemplate(id).then((res) => {
            if (res?.success) { if (id) npTrack('template_set'); setLiveTemplateId(id); setTemplateNotice(null); return; }
            const name = noteTemplateById(id)?.name;
            setTemplateNotice(res?.error === 'pro_required' && name ? `${name} notes need Natively Pro.` : 'Couldn’t set the template.');
        }).catch(() => {});
    }, [npTrack]);
    const openGallery = useCallback((initialId: string | null) => {
        npTrack('templates_browsed');
        setGalleryQuery('');
        setGallery({ initialId });
    }, [setGalleryQuery, npTrack]);
    const closeGallery = useCallback(() => {
        setGallery(null);
        if (fieldRef.current === 'template') { fieldRef.current = 'notes'; setField('notes'); }
    }, []);
    // "/" › Templates in the notes: a template for this meeting, or the gallery.
    const onSlashTemplate = useCallback((id: string | null) => {
        if (id) setLiveTemplate(id);
        else openGallery(liveTemplateId);
    }, [setLiveTemplate, openGallery, liveTemplateId]);
    const applyFromGallery = (id: string) => {
        closeGallery();
        if (phase === 'ended') enhancedRef.current?.applyTemplate(id, noteTemplateById(id)?.name ?? 'Template');
        else setLiveTemplate(id);
    };
    const liveTemplate = noteTemplateById(liveTemplateId);

    const textFields = useRef<Partial<Record<Field, { get: () => string; set: (v: string) => void; submit: () => void }>>>({});
    textFields.current = {
        ask: { get: () => askTextRef.current, set: setAsk, submit: () => askSubmitRef.current() },
        title: { get: () => titleDraftRef.current, set: setTitleDraft, submit: () => commitTitleRef.current() },
        attendee: { get: () => attendeeDraftRef.current, set: setAttendeeDraft, submit: () => addAttendeeRef.current() },
        find: { get: () => findQueryRef.current, set: setFindQuery, submit: () => stepFind(false) },
        search: { get: () => searchRef.current, set: setSearch, submit: () => {} },
        template: { get: () => galleryQueryRef.current, set: setGalleryQuery, submit: () => {} },
    };

    // Ctrl/Cmd+A in a one-line field selects all of it (typing appends, so
    // "everything" is the only selection there); the next key replaces it, as
    // in the overlay's box. Held with the value it covered: the selection ends
    // with the session, a move to another field, or any change to that text.
    const fieldSelRef = useRef<{ field: Field; value: string } | null>(null);
    const [fieldSel, setFieldSelState] = useState<Field | null>(null);
    const setFieldSel = useCallback((f: Field | null) => {
        fieldSelRef.current = f ? { field: f, value: textFields.current[f]?.get() ?? '' } : null;
        setFieldSelState(f);
    }, []);
    const fieldSelected = useCallback((f: Field) => {
        const sel = fieldSelRef.current;
        return !!sel && sel.field === f && textFields.current[f]?.get() === sel.value;
    }, []);
    useEffect(() => {
        const sel = fieldSelRef.current;
        if (sel && (!hookTyping || field !== sel.field || !fieldSelected(sel.field))) setFieldSel(null);
    }, [hookTyping, field, ask, titleDraft, attendeeDraft, findQuery, search, galleryQuery, fieldSelected, setFieldSel]);
    // The window has no focus while the hook types, so an input's own
    // selection would not paint: draw it behind the text instead.
    useLayoutEffect(() => {
        if (!fieldSel) return;
        const input = document.querySelector<HTMLInputElement>('input[data-hook-typing="true"]');
        if (!input) return;
        const cs = getComputedStyle(input);
        const ctx = document.createElement('canvas').getContext('2d');
        if (!ctx) return;
        ctx.font = cs.font;
        const spacing = parseFloat(cs.letterSpacing) || 0;
        const room = input.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        const width = Math.min(ctx.measureText(input.value).width + spacing * input.value.length, room);
        input.dataset.hookSelected = 'true';
        input.style.setProperty('--hook-sel-w', `${Math.max(0, Math.ceil(width))}px`);
        return () => {
            delete input.dataset.hookSelected;
            input.style.removeProperty('--hook-sel-w');
        };
    }, [fieldSel]);

    useEffect(() => {
        const api = window.electronAPI;
        if (preview || !api?.stealthTapStart || !api.onStealthTapState || !api.onStealthKeyCaptured) return;
        // As the overlay: Windows knows at once whether the hook can type
        // (this window is never focusable when it can); macOS learns it from
        // the first session that starts, and types by focus until then.
        if (api.platform === 'win32') {
            api.stealthTapAvailable?.().then((ok) => { if (ok) hookAvailableRef.current = true; }).catch(() => {});
        }
        api.stealthTapShouldAutoEngage?.().then((ok) => { hookEngageOkRef.current = !!ok; }).catch(() => {});
        const offState = api.onStealthTapState(({ active, target }) => {
            if (active) hookAvailableRef.current = true;
            const mine = active && target === 'notes';
            hookTypingRef.current = mine;
            setHookTyping(mine);
        });
        const offKey = api.onStealthKeyCaptured((ev) => {
            if (!hookTypingRef.current) return;
            const f = fieldRef.current;
            // Ctrl/Cmd+V/A/C/X: the hooks keep these from the meeting app and
            // deliver them here as their letter; never typed as text. The notes
            // act on their drawn selection; a one-line field has no caret, so
            // its only selection is all of it (Ctrl/Cmd+A), and a paste goes at
            // the end or over that selection.
            const letter = editShortcutLetter(ev);
            if (letter) {
                const tf = f === 'notes' ? null : textFields.current[f];
                if (letter === 'v') {
                    api.stealthReadClipboard?.()
                        .then((text) => {
                            // Not after the session ended or moved to another field.
                            if (!text || !hookTypingRef.current || fieldRef.current !== f) return;
                            if (f === 'notes') editorRef.current?.pasteText(text);
                            else if (tf) {
                                const allSelected = fieldSelected(f);
                                if (allSelected) setFieldSel(null);
                                tf.set(paste({ value: tf.get(), allSelected }, text).value);
                            }
                        })
                        .catch(() => {});
                } else if (f === 'notes') {
                    const copied = editorRef.current?.editShortcut(letter);
                    if (copied) api.stealthWriteClipboard?.(copied).catch(() => {});
                } else if (tf) {
                    const next = editCommand({ value: tf.get(), allSelected: fieldSelected(f) }, letter);
                    if (next.copy !== undefined) api.stealthWriteClipboard?.(next.copy).catch(() => {});
                    if (next.value !== tf.get()) tf.set(next.value);
                    setFieldSel(next.allSelected ? f : null);
                }
                return;
            }
            if (f === 'notes') {
                editorRef.current?.typeKey(ev);
                return;
            }
            const tf = textFields.current[f];
            if (!tf) return;
            if (f === 'template' && ev.isKeyDown && ev.keyCode === 53) {
                setFieldSel(null);
                closeGallery();
                return;
            }
            if (ev.isKeyDown && (ev.keyCode === 36 || ev.keyCode === 76)) {
                setFieldSel(null);
                tf.submit();
                return;
            }
            const allSelected = fieldSelected(f);
            const next = applyTypedKeyAtEnd(tf.get(), ev, allSelected);
            if (next === null) return;
            if (allSelected) setFieldSel(null);
            tf.set(next);
        });
        return () => { offState(); offKey(); };
    }, []);

    // mousedown, before the field would take focus: start this window's
    // session (or point it at this field), and keep the focus from moving
    // (that blur is what a meeting app or a test page sees).
    const engage = (target: Field) => (e: React.MouseEvent<HTMLElement>) => {
        if (preview) return;
        if (fieldRef.current === 'title' && target !== 'title' && editingTitle) commitTitleRef.current();
        fieldRef.current = target;
        setField(target);
        setAskEngaged(target === 'ask');
        focusBlockedRef.current = false;
        const api = window.electronAPI;
        if (!api?.stealthTapStart) return;
        if (!shouldBlockFocus({ stealthAutoEngageOk: hookEngageOkRef.current, isCgEventTapAvailable: hookAvailableRef.current })) return;
        e.preventDefault();
        focusBlockedRef.current = true;
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) active.blur();
        if (shouldFireStealthTapStart({ stealthTapActive: hookTypingRef.current, stealthAutoEngageOk: hookEngageOkRef.current, isStealthEngageTarget: true })) {
            api.stealthTapStart().catch(() => {});
        }
    };

    const startTitle = (e: React.MouseEvent<HTMLElement>) => {
        if (preview || phase === 'idle') return;
        engage('title')(e);
        if (!editingTitle) {
            // The click's own focus change would blur the field it opens.
            e.preventDefault();
            setTitleDraft(phase === 'ended' ? (savedTitle ?? info.title ?? '') : (info.title ?? ''));
            setEditingTitle(true);
        }
    };

    // Cmd/Ctrl+F: Find in the notes (typing by focus; the hook sends it to the meeting app).
    useEffect(() => {
        if (preview) return;
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                setFindOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Granola's buttons: 28px round icons, 32px menu rows, 24px chips; washes from its tokens (index.css .notepad).
    const iconBtn = 'w-7 h-7 rounded-full flex items-center justify-center transition-colors np-wash';
    const smallBtn = 'w-6 h-6 rounded-full flex items-center justify-center transition-colors np-wash';
    const menuItem = 'w-full h-8 flex items-center gap-2 text-left px-2 rounded-lg text-[13px] transition-colors disabled:opacity-40 np-wash';
    const chipBtn = 'np-outline h-6 shrink-0 inline-flex items-center gap-1 px-2.5 rounded-full text-[12px] font-[430] transition-colors disabled:opacity-40 np-wash';
    const [working, setWorking] = useState<'shorten' | 'attach' | null>(null);
    const [attached, setAttached] = useState(0);

    // "Shorten": the selection, or the line under the caret, tightened by the
    // user's model; replaced only when main's check says it adds nothing (see
    // services/meeting/noteLineShortener.ts).
    const shortenLine = async () => {
        const target = editorRef.current?.shortenTarget();
        if (!target || working || target.text.trim().length < 12) return;
        npTrack('line_shortened');
        setWorking('shorten');
        try {
            const res = await window.electronAPI?.liveNotesShortenLine?.(target.text);
            const next = res?.text;
            if (next && next !== target.text) editorRef.current?.replaceRange(target.from, target.to, target.text, next);
        } finally {
            setWorking(null);
        }
    };

    // "Attach image": a picture (a whiteboard, a slide photo) kept with the
    // meeting and described for the notes, like a shared screen.
    const attachImage = async () => {
        if (working) return;
        npTrack('image_attached');
        setWorking('attach');
        try {
            const res = await window.electronAPI?.liveNotesAttachImage?.();
            if (res?.count !== undefined) setAttached(res.count);
        } finally {
            setWorking(null);
        }
    };

    // The ⋯ menu closes on a click anywhere else.
    useEffect(() => {
        if (!menuOpen) return;
        const close = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', close, true);
        return () => document.removeEventListener('mousedown', close, true);
    }, [menuOpen]);

    const togglePause = () => {
        const next = !paused;
        if (next) npTrack('paused');
        setPaused(next);
        window.electronAPI?.setTranscriptionPaused?.(next).then((r) => { if (r) setPaused(r.paused); }).catch(() => setPaused(!next));
    };


    // Ask stays open while the pointer works inside its card (Copy, Say more,
    // a recipe); a press anywhere else closes it, as Granola's does.
    useEffect(() => {
        if (!askEngaged) return;
        const close = (e: MouseEvent) => {
            if (askCardRef.current?.contains(e.target as Node)) return;
            setAskEngaged(false);
            setAllRecipes(false);
        };
        document.addEventListener('mousedown', close, true);
        return () => document.removeEventListener('mousedown', close, true);
    }, [askEngaged]);

    // Granola's bars turn red after 3 s without sound.
    const [silent, setSilent] = useState(false);
    const lastSound = useRef(Date.now());
    useEffect(() => {
        if (level !== null && level > 0.02) { lastSound.current = Date.now(); setSilent(false); }
    }, [level]);
    useEffect(() => {
        if (phase !== 'live' || paused) { setSilent(false); return; }
        const timer = setInterval(() => setSilent(level !== null && Date.now() - lastSound.current > 3_000), 500);
        return () => clearInterval(timer);
    }, [phase, paused, level]);

    // A window opened after Stop never heard the title: the plain name, not "New meeting".
    const fallbackTitle = phase === 'live' ? 'New meeting' : 'Meeting notes';
    const headingInfo: HeadingInfo = phase === 'ended' && savedTitle ? { ...info, title: savedTitle } : info;
    const typingHere = (f: Field) => hookTyping && field === f;
    const speakerName = (s: string) => (s === 'user' ? info.speakers.me : info.speakers.them);
    const hits = useMemo(() => (showTranscript && findTranscript ? findInTranscript(lines, search) : []), [showTranscript, findTranscript, lines, search]);
    const currentHit = hits.length ? ((hitIndex % hits.length) + hits.length) % hits.length : -1;
    const transcriptRows = useMemo(() => liveTranscriptRows(live), [live]);
    const hitsByLine = useMemo(() => {
        const m = new Map<number, Array<TranscriptHit & { current: boolean }>>();
        hits.forEach((h, i) => { const list = m.get(h.at) ?? []; list.push({ ...h, current: i === currentHit }); m.set(h.at, list); });
        return m;
    }, [hits, currentHit]);
    // No audio at all says so first: every other line is about audio that is on.
    const problem = (withoutAudio ? 'Audio is off because Ambient AI Chat is on. Turn it off in Settings › General.' : null)
        ?? Object.values(problems)[0] ?? null;
    // Ask open (Granola's): focused, or typed into through the hook. Closed, the answers wait behind "Continue chat".
    // After Stop the notepad keeps Ask (Granola's chat on a finished note), without the listening pill.
    const askBar = phase === 'live' || (phase === 'ended' && !!meetingId && !preview);
    const askOpen = askBar && askEngaged;
    const bars = useMemo(() => (level === null || paused ? null : listeningBarHeights(level * 3.2)), [level, paused]);
    // The floating panel: what fills it, kept on through the closing spring, and how tall.
    const panelKind: 'transcript' | 'ask' | null = phase === 'live' ? (showTranscript ? 'transcript' : askOpen ? 'ask' : null) : askOpen ? 'ask' : null;
    const contentKind = panelKind ?? shownKind;
    const maxPanel = Math.max(PANEL_MIN, winH - 160);
    const contentHeight: number | 'auto' = contentKind === 'transcript' || (contentKind === 'ask' && turns.length > 0) ? Math.min(Math.max(panelHeight, PANEL_MIN), maxPanel) : 'auto';
    useEffect(() => { if (panelKind) setShownKind(panelKind); }, [panelKind]);
    const tall = contentHeight !== 'auto';
    const panelMotion = resizing ? { duration: 0 } : panelKind ? (tall ? PANEL_OPEN : ROW_OPEN) : (tall ? PANEL_CLOSE : ROW_CLOSE);
    // The plate is there quickly and leaves last, so the content never floats on the bare page.
    const plateMotion = resizing ? { duration: 0 } : panelKind
        ? { opacity: { duration: 0.25, ease: SMOOTH_OUT }, scale: panelMotion }
        : { opacity: { duration: 0.3, delay: 0.12, ease: SMOOTH_OUT }, scale: panelMotion };
    useEffect(() => {
        if (currentHit < 0) return;
        transcriptRef.current?.querySelector('.np-hit[data-current]')?.scrollIntoView({ block: 'center' });
    }, [currentHit, hits]);

    const stepHit = (by: number) => { if (hits.length) setHitIndex((i) => i + by); };
    const closeTranscriptFind = () => { setFindTranscript(false); setSearch(''); setHitIndex(0); };
    const onTranscriptScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
    };
    // Drag the panel's top edge: taller upward, kept for the next meeting.
    const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const grip = e.currentTarget;
        grip.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startH = typeof contentHeight === 'number' ? contentHeight : panelHeight;
        let last = startH;
        setResizing(true);
        const move = (ev: PointerEvent) => { last = Math.round(Math.min(maxPanel, Math.max(PANEL_MIN, startH + startY - ev.clientY))); setPanelHeight(last); };
        const up = () => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', up);
            grip.removeEventListener('pointercancel', up);
            setResizing(false);
            try { localStorage.setItem(PANEL_HEIGHT_KEY, String(last)); } catch { /* kept for this window only */ }
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
    };
    const recipeChip = 'h-6 shrink-0 inline-flex items-center gap-1 px-2.5 rounded-full text-[12px] font-[430] tracking-[0.02em] whitespace-nowrap transition-colors np-wash';
    const showEnhanced = phase === 'ended' && !!meetingId && endedTab === 'enhanced';
    const showTabs = phase === 'ended' && !!meetingId;
    const barShown = phase === 'live' || showTabs;
    useLayoutEffect(() => {
        const page = pageRef.current;
        const bar = bottomBarRef.current;
        if (!page || !bar || !barShown) { setBottomInset(undefined); return; }
        const measure = () => {
            const covered = Math.round(page.getBoundingClientRect().bottom - bar.getBoundingClientRect().top);
            setBottomInset(covered > 0 ? covered : undefined);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(page);
        ro.observe(bar);
        return () => ro.disconnect();
    }, [barShown]);

    // The listening controls: in their own pill, or inside the open transcript panel.
    const listeningControls = (
        <>
            <button
                type="button"
                aria-label={showTranscript ? 'Hide transcript' : 'Show transcript'}
                title={showTranscript ? 'Hide transcript' : 'Show transcript'}
                aria-expanded={showTranscript}
                onClick={() => { if (!showTranscript) npTrack('transcript_opened'); setShowTranscript((s) => !s); setHighlightAt(null); }}
                className="h-full min-w-12 shrink-0 flex items-center pl-[13.5px] pr-[5.25px] rounded-l-3xl rounded-r-lg transition-colors duration-75 np-wash"
                style={showTranscript ? { background: 'var(--np-wash)' } : undefined}
            >
                <span className={`notes-listening-bars${bars ? ' notes-level' : ''}${paused ? ' np-paused' : silent ? ' np-silent' : ''}`} aria-hidden>
                    {(bars ?? [null, null, null]).map((b, i) => <span key={i} style={b === null ? undefined : { transform: `scaleY(${b.toFixed(2)})` }} />)}
                </span>
                <ChevronUp
                    className={`ml-[3.25px] w-4 h-4 transition-transform duration-200 ${showTranscript ? 'rotate-180' : ''}`}
                    strokeWidth={2}
                    style={ink('--np-chevron')}
                />
            </button>
            {paused && (
                <button type="button" onClick={togglePause} className="h-full shrink-0 px-2 rounded-lg text-[13px] font-medium np-wash" style={ink('--np-accent')}>
                    Resume
                </button>
            )}
            <button
                type="button"
                aria-label="Stop transcript"
                title="Stop transcript"
                onClick={() => { npTrack('stopped'); void window.electronAPI?.endMeeting?.(); }}
                // The mic's mirror: a 24px round end (concentric with the pill's 28px end). At
                // 34.5px wide that curve took most of the button and hovered as a lopsided blob,
                // so Stop takes 2.5px from the mic's right padding (37px): the pill keeps its
                // size. 8px corners read as a square (2026-11-01, Evin).
                // Kept at 37px (2026-11-01): a mirrored hover needs equal widths, which either
                // narrows the mic (44/44) or widens the pill (51/51); Evin kept the original.
                className="h-full shrink-0 flex items-center pl-[8px] pr-[13px] rounded-l-lg rounded-r-3xl transition-colors duration-75 np-wash"
                style={ink('--np-stop')}
            >
                <span className="w-4 h-4 flex items-center justify-center"><span className="w-3 h-3 rounded-[2.6px] bg-current" /></span>
            </button>
        </>
    );

    const recipePhase: 'live' | 'ended' = phase === 'ended' ? 'ended' : 'live';
    const phaseRecipes = useMemo(() => recipesFor(recipePhase), [recipePhase]);
    const chipRecipes = CHIP_IDS[recipePhase].map(noteRecipeById).filter((r): r is NoteRecipe => !!r);
    const recentList = recentRecipes.map(noteRecipeById).filter((r): r is NoteRecipe => !!r && phaseRecipes.includes(r));
    // "/" at the start of Ask lists the recipes: Recent and All recipes, or what the words after it match.
    const slashQuery = ask.startsWith('/') ? ask.slice(1) : null;
    const slashParsed = slashQuery !== null ? parseSlashCommand(phaseRecipes, ask) : null;
    const slashMatches = useMemo(() => {
        if (slashQuery === null) return [];
        const found = searchRecipes(phaseRecipes, slashQuery);
        return found.length ? found : slashParsed ? [slashParsed.recipe] : [];
    }, [slashQuery, phaseRecipes, slashParsed]);
    const slashOpen = askOpen && slashQuery !== null && !busy;
    const slashSections: Array<{ title: string | null; rows: NoteRecipe[] }> = slashQuery?.trim()
        ? [{ title: null, rows: slashMatches }]
        : [...(recentList.length ? [{ title: 'Recent', rows: recentList }] : []), { title: 'All recipes', rows: phaseRecipes }];
    const slashRows = slashSections.flatMap((x) => x.rows);
    const slashIndex = Math.min(slashAt, Math.max(0, slashRows.length - 1));
    const slashActive = slashRows[slashIndex];
    useEffect(() => { setSlashAt(0); }, [slashQuery]);
    const runSlash = (pick?: NoteRecipe) => {
        // "/tldr in Spanish": the recipe it names, with the rest as the user's addition.
        if (!pick && slashParsed?.extra) { runRecipe(slashParsed.recipe, slashParsed.extra); return; }
        const recipe = pick ?? slashActive;
        if (recipe) runRecipe(recipe, slashParsed?.recipe === recipe ? slashParsed.extra : '');
    };
    askSubmitRef.current = () => { if (askTextRef.current.startsWith('/')) runSlash(); else submitAsk(askTextRef.current); };

    const recipeButton = (r: NoteRecipe) => (
        <button
            key={r.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runRecipe(r)}
            className={recipeChip}
            style={ink('--np-ink-secondary')}
        >
            <RecipeIcon /> {r.label}
        </button>
    );

    /** Granola's recipe rows: the slash mark, the name, and what it makes underneath. */
    /** `activeIndex`: the "/" list's highlighted row, counted across its sections; absent for All recipes. */
    const recipeRows = (sections: Array<{ title: string | null; rows: NoteRecipe[] }>, activeIndex?: number) => {
        const slash = activeIndex !== undefined;
        let at = 0;
        return sections.map((section) => {
            const start = at;
            at += section.rows.length;
            return (
            <div key={section.title ?? 'matches'} role="group" aria-label={section.title ?? 'Recipes'}>
                {section.title && <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium" style={ink('--np-ink-tertiary')}>{section.title}</p>}
                {section.rows.map((r, j) => (
                    <button
                        key={`${section.title}-${r.id}`}
                        id={slash ? `np-slash-${start + j}` : undefined}
                        type="button"
                        role={slash ? 'option' : 'menuitem'}
                        aria-selected={slash ? activeIndex === start + j : undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={slash ? () => setSlashAt(start + j) : undefined}
                        onClick={() => (slash ? runSlash(r) : runRecipe(r))}
                        className="w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors np-wash"
                        style={slash && activeIndex === start + j ? { background: 'var(--np-wash)' } : undefined}
                    >
                        <span className="mt-[3px] shrink-0" style={ink('--np-ink-secondary')}><RecipeIcon /></span>
                        <span className="min-w-0">
                            <span className="block text-[13px] leading-[18px] truncate" style={ink('--np-ink')}>{r.label}</span>
                            <span className="block text-[12px] leading-4 truncate" style={ink('--np-ink-secondary')}>{r.description}</span>
                        </span>
                    </button>
                ))}
            </div>
            );
        });
    };

    const askInput = (
        <input
            ref={askRef}
            aria-label="Ask anything"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onMouseDown={engage('ask')}
            onFocus={() => setAskEngaged(true)}
            onKeyDown={(e) => {
                if (slashOpen && slashRows.length > 0) {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const n = slashRows.length;
                        setSlashAt((i) => (Math.min(i, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                        return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlash(); return; }
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    if (slashQuery !== null) { setAsk(''); return; }
                    setAskEngaged(false); askRef.current?.blur();
                }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={slashOpen}
            aria-controls={slashOpen ? 'np-slash-recipes' : undefined}
            aria-activedescendant={slashOpen && slashRows.length > 0 ? `np-slash-${slashIndex}` : undefined}
            data-hook-typing={typingHere('ask') ? 'true' : undefined}
            placeholder={turns.length > 0 ? 'Continue chat' : 'Ask anything'}
            className="w-full h-full min-w-0 bg-transparent pl-5 pr-4 text-[14px] leading-[18px] tracking-[0.01em] outline-none placeholder:text-[color:var(--np-ask-placeholder)]"
            style={ink('--np-ink')}
        />
    );

    return (
        <div
            className={`notepad ${preview ? 'h-full w-full pointer-events-none select-none' : 'h-screen w-screen'} relative flex flex-col overflow-hidden`}
            data-np-theme={isLight ? 'light' : 'dark'}
            inert={preview ? true : undefined}
        >
            {/* The top strip is the window's drag handle (frameless on both platforms), 44px as Granola's toolbar. */}
            <div className={`${preview ? '' : 'drag-region '}h-11 shrink-0 flex items-center justify-end gap-1.5 pr-3`}>
                <div className="relative flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} ref={menuRef}>
                    {phase !== 'ended' && (
                        <button type="button" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} className={iconBtn} style={ink('--np-ink-secondary')}>
                            <MoreHorizontal className="w-4 h-4" strokeWidth={1.75} />
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={() => { void window.electronAPI?.notesWindowClose?.(); }}
                        className={iconBtn}
                        style={ink('--np-ink-secondary')}
                    >
                        <X className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                        <NpPop open={menuOpen && phase !== 'ended'} origin="top right" role="menu" className="absolute right-0 top-9 z-40 w-56 p-1">
                            <button type="button" role="menuitem" className={menuItem} style={ink('--np-ink')} onClick={() => { setMenuOpen(false); setFindOpen(true); }}>
                                <Search className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} /> Find in notes
                            </button>
                            {phase === 'live' && (
                                <>
                                    <button type="button" role="menuitem" className={menuItem} style={ink('--np-ink')} onClick={() => { setMenuOpen(false); togglePause(); }}>
                                        {paused ? <Play className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} /> : <Pause className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} />}
                                        {paused ? 'Resume transcription' : 'Pause transcription'}
                                    </button>
                                    <button type="button" role="menuitem" className={menuItem} style={ink('--np-ink')} disabled={!!working} onClick={() => { setMenuOpen(false); void shortenLine(); }}>
                                        <Scissors className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                                        {working === 'shorten' ? 'Shortening…' : 'Shorten this line'}
                                    </button>
                                    <button type="button" role="menuitem" className={menuItem} style={ink('--np-ink')} disabled={!!working} onClick={() => { setMenuOpen(false); void attachImage(); }}>
                                        <ImagePlus className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                                        {working === 'attach' ? 'Adding…' : attached > 0 ? `Attach image (${attached} added)` : 'Attach image'}
                                    </button>
                                </>
                            )}
                        </NpPop>
                </div>
            </div>

            <NotesHeading
                info={headingInfo}
                fallbackTitle={fallbackTitle}
                live={phase === 'live' && !preview}
                showChip={phase !== 'idle'}
                editingTitle={editingTitle}
                titleDraft={titleDraft}
                setTitleDraft={setTitleDraft}
                onStartTitle={startTitle}
                titleFocusBlocked={focusBlockedRef.current}
                onCommitTitle={commitTitle}
                onCancelTitle={() => { setEditingTitle(false); if (fieldRef.current === 'title') { fieldRef.current = 'notes'; setField('notes'); } }}
                attendeeDraft={attendeeDraft}
                setAttendeeDraft={setAttendeeDraft}
                onEngageAttendee={engage('attendee')}
                onAddAttendee={addAttendee}
                onRemoveAttendee={(email) => { void window.electronAPI?.liveNotesSetAttendees?.({ remove: email }).then(() => readInfo()).catch(() => {}); }}
                onLinkEvent={(id) => { void window.electronAPI?.liveNotesLinkEvent?.(id).then(() => readInfo()).catch(() => {}); }}
                hookField={hookTyping ? field : null}
                preview={!!preview}
            />

            {!preview && phase !== 'ended' && lastTime.recap?.recap && lastTime.recap.recap.bullets.length > 0 && (
                <div className="shrink-0 mx-7 mt-4 px-3 py-2.5 rounded-xl" style={{ background: 'var(--np-wash)' }}>
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-[12px] font-medium leading-4" style={ink('--np-ink-secondary')}>{lastTime.recap.recap.title}</span>
                        <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={lastTime.dismiss}
                            className="-mt-1 -mr-1.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center np-wash"
                            style={ink('--np-ink-secondary')}
                        >
                            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                    </div>
                    <ul className="mt-1">
                        {lastTime.recap.recap.bullets.map((b, i) => (
                            <li key={i} className="text-[13px] leading-[18px]" style={ink('--np-ink')}>{`• ${b}`}</li>
                        ))}
                    </ul>
                </div>
            )}

            {findOpen && !showEnhanced && (
                <div className="np-outline shrink-0 mx-7 mt-3 flex items-center gap-1 h-8 pl-3 pr-1 rounded-full">
                    <Search className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                    <input
                        aria-label="Find in notes"
                        autoFocus={!focusBlockedRef.current}
                        value={findQuery}
                        onChange={(e) => setFindQuery(e.target.value)}
                        onMouseDown={engage('find')}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey); }
                            if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); setFindQuery(''); }
                        }}
                        data-hook-typing={typingHere('find') ? 'true' : undefined}
                        placeholder="Find"
                        className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--np-ink-tertiary)]"
                        style={ink('--np-ink')}
                    />
                    <span className="text-[11px] tabular-nums px-1" style={ink('--np-ink-secondary')}>{findQuery ? (findPos.count ? `${findPos.index + 1} of ${findPos.count}` : 'No results') : ''}</span>
                    <button type="button" aria-label="Previous match" onClick={() => stepFind(true)} className={smallBtn} style={ink('--np-ink-secondary')}><ChevronUp className="w-3.5 h-3.5" strokeWidth={2} /></button>
                    <button type="button" aria-label="Next match" onClick={() => stepFind(false)} className={smallBtn} style={ink('--np-ink-secondary')}><ChevronDown className="w-3.5 h-3.5" strokeWidth={2} /></button>
                    <button type="button" aria-label="Close find" onClick={() => { setFindOpen(false); setFindQuery(''); }} className={smallBtn} style={ink('--np-ink-secondary')}><X className="w-3.5 h-3.5" strokeWidth={2} /></button>
                </div>
            )}

            <div
                ref={pageRef}
                className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
                onScroll={(e) => setPageScrolled(e.currentTarget.scrollTop > 2)}
            >
                {/* Top fade: sticks to the page's top edge and takes no room (-mb); shown only once scrolled. */}
                <div
                    aria-hidden
                    data-np-page-fade
                    className="np-fade-top np-page-fade pointer-events-none sticky top-0 z-[11] -mb-7 h-7"
                    data-shown={pageScrolled ? 'true' : undefined}
                />
                {showEnhanced ? (
                    <NotesEnhanced ref={enhancedRef} meetingId={meetingId!} onTitle={setSavedTitle} onOpenGallery={openGallery} myNotes={text} bottomInset={bottomInset} />
                ) : (
                    <>
                    {phase !== 'ended' && (liveTemplate || templateNotice) && (
                        // The template this meeting's notes will be written in ("/" › Templates).
                        <div className="px-8 pt-3 -mb-1 flex items-center gap-2 min-w-0" role="status">
                            {liveTemplate && (
                                <span className="np-outline h-7 inline-flex items-center gap-1.5 pl-2.5 pr-1 rounded-full text-[13px] font-[430] min-w-0" style={ink('--np-ink')}>
                                    <button type="button" onClick={() => openGallery(liveTemplate.id)} className="inline-flex items-center gap-1.5 min-w-0" title="Change template">
                                        <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                                        <span className="truncate">{liveTemplate.name}</span>
                                    </button>
                                    <button type="button" aria-label="Remove template" onClick={() => setLiveTemplate(null)} className="w-5 h-5 rounded-full flex items-center justify-center np-wash" style={ink('--np-ink-tertiary')}>
                                        <X className="w-3 h-3" strokeWidth={2} />
                                    </button>
                                </span>
                            )}
                            {templateNotice && <span className="text-[12px] truncate" style={ink('--np-ink-secondary')}>{templateNotice}</span>}
                        </div>
                    )}
                    <NotesEditor
                        ref={editorRef}
                        value={text}
                        onChange={commit}
                        editable={!preview && phase !== 'ended'}
                        hookTyping={typingHere('notes')}
                        onEngage={engage('notes')}
                        onTemplate={phase !== 'ended' && !preview ? onSlashTemplate : undefined}
                        className="min-h-full px-8 pt-[19px] pb-36"
                    />
                    </>
                )}
            </div>

            {/* The floating bottom bar, as Granola's: panels above two 56px pills, over a fade of the page. */}
            {(phase === 'live' || showTabs) && (
                <div className="absolute inset-x-0 bottom-0 z-20 pointer-events-none">
                    <div className="np-fade-bottom absolute inset-x-0 bottom-0 h-20" />
                    <div ref={bottomBarRef} className="relative px-4 pb-[27.5px] flex flex-col gap-2 pointer-events-auto">
                        {/* The meeting's status: the overlay is hidden in a notepad meeting. */}
                        {phase === 'live' && stopsAt !== null && (
                            <div className="np-elevated rounded-[20px] pl-4 pr-1.5 py-1.5 flex items-center justify-between gap-3" role="status">
                                <p className="text-[13px] leading-[18px]" style={ink('--np-red')}>Natively stops in 1 minute because nothing has been said.</p>
                                <button
                                    type="button"
                                    onClick={() => { setStopsAt(null); window.electronAPI?.meetingAutoStopKeepGoing?.()?.catch?.(() => {}); }}
                                    className={chipBtn}
                                    style={ink('--np-ink')}
                                >
                                    Keep going
                                </button>
                            </div>
                        )}
                        {phase === 'live' && problem && stopsAt === null && (
                            <p className="px-2 text-center text-balance text-[12px] leading-4" style={ink('--np-ink-secondary')} role="status">{problem}</p>
                        )}

                        {/* After Stop: Granola's My notes / Enhanced switch, the thumb sliding between them. */}
                        {/* The switch steps aside while Ask is open over the notes. */}
                        {showTabs && !askOpen && (
                            <div className="flex justify-center">
                                <div className="np-track relative h-8 p-0.5 rounded-full flex" role="tablist" aria-label="Notes">
                                    <span className="np-thumb absolute top-0.5 bottom-0.5 w-[104px] rounded-full" style={{ left: endedTab === 'mine' ? 2 : 106 }} aria-hidden />
                                    {(['mine', 'enhanced'] as const).map((tab) => (
                                        <button
                                            key={tab}
                                            type="button"
                                            role="tab"
                                            aria-selected={endedTab === tab}
                                            onClick={() => setEndedTab(tab)}
                                            className="relative w-[104px] h-7 rounded-full text-[13px] font-[430] transition-colors"
                                            style={ink(endedTab === tab ? '--np-ink' : '--np-ink-secondary')}
                                        >
                                            {tab === 'enhanced' ? 'Enhanced' : 'My notes'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Granola's floating panel: the pills sit in a shell whose plate springs in (opacity, .98 → 1)
                            while the space above them grows from nothing; the transcript or Ask fills that space. */}
                        {askBar && (
                            <MotionConfig reducedMotion="user">
                            <div ref={askCardRef} className="np-shell relative isolate -mx-1 flex flex-col">
                                <motion.div
                                    aria-hidden
                                    className="np-plate absolute inset-0 z-10 rounded-[32px]"
                                    style={{ transformOrigin: '50% 100%' }}
                                    initial={false}
                                    animate={{ opacity: panelKind ? 1 : 0, scale: panelKind ? 1 : 0.98 }}
                                    transition={plateMotion}
                                />
                                {contentKind && contentHeight !== 'auto' && (
                                    <div
                                        className="np-grip absolute top-0 left-1/2 z-30 h-4 w-48 -translate-x-1/2 cursor-ns-resize"
                                        onPointerDown={startResize}
                                        aria-hidden
                                    />
                                )}
                                <motion.div
                                    className="relative z-20 flex min-h-0 flex-col justify-end overflow-hidden rounded-t-[32px]"
                                    initial={false}
                                    animate={{ height: panelKind ? contentHeight : 0 }}
                                    transition={panelMotion}
                                    onAnimationComplete={() => { if (!panelKind) setShownKind(null); }}
                                >
                                    {/* The content keeps its final height while the space grows, so it is revealed
                                        from the bottom up instead of reflowing every frame; it rises 8px out of a soft blur. */}
                                    <motion.div
                                        key={contentKind ?? 'none'}
                                        className="shrink-0 flex flex-col"
                                        style={tall ? { height: contentHeight } : undefined}
                                        initial={tall ? { opacity: 0, y: 8, filter: 'blur(2px)' } : false}
                                        animate={panelKind
                                            ? { opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }
                                            : { opacity: 0, y: 0, filter: 'blur(2px)' }}
                                        transition={panelKind ? { duration: 0.45, delay: 0.06, ease: SMOOTH_OUT } : { duration: 0.2, ease: SMOOTH_OUT }}
                                    >
                                    {contentKind === 'transcript' ? (
                                        <div className="h-full flex flex-col">
                                            <div className="shrink-0 h-12 flex items-center gap-1 px-3">
                                                <div
                                                    className={`h-8 min-w-0 flex items-center rounded-full overflow-hidden transition-[max-width,box-shadow] duration-100 ${findTranscript ? 'np-outline flex-1' : ''}`}
                                                    style={{ maxWidth: findTranscript ? 220 : 28 }}
                                                >
                                                    {findTranscript ? (
                                                        <>
                                                            <input
                                                                aria-label="Find in transcript"
                                                                value={search}
                                                                autoFocus={!focusBlockedRef.current}
                                                                onChange={(e) => { setSearch(e.target.value); setHitIndex(0); }}
                                                                onMouseDown={engage('search')}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); }
                                                                    else if (e.key === 'ArrowUp') { e.preventDefault(); stepHit(-1); }
                                                                    else if (e.key === 'Escape') { e.preventDefault(); closeTranscriptFind(); }
                                                                }}
                                                                data-hook-typing={typingHere('search') ? 'true' : undefined}
                                                                placeholder="Find"
                                                                className="h-7 flex-1 min-w-0 bg-transparent pl-3 text-[13px] outline-none placeholder:text-[color:var(--np-ink-tertiary)] animate-[np-fade-in_100ms_ease-out]"
                                                                style={ink('--np-ink')}
                                                            />
                                                            {search.trim() && (
                                                                <span className="mx-1 shrink-0 text-[11px] tabular-nums" style={ink('--np-ink-tertiary')}>
                                                                    {hits.length ? `${currentHit + 1}/${hits.length}` : 'No results'}
                                                                </span>
                                                            )}
                                                            <button type="button" aria-label="Previous match" onClick={() => stepHit(-1)} disabled={!hits.length} className={`${smallBtn} disabled:opacity-40`} style={ink('--np-ink-secondary')}><ChevronUp className="w-3.5 h-3.5" strokeWidth={2} /></button>
                                                            <button type="button" aria-label="Next match" onClick={() => stepHit(1)} disabled={!hits.length} className={`${smallBtn} disabled:opacity-40`} style={ink('--np-ink-secondary')}><ChevronDown className="w-3.5 h-3.5" strokeWidth={2} /></button>
                                                            <span className="ml-1 h-3 w-px shrink-0" style={{ background: 'var(--np-hairline)' }} aria-hidden />
                                                            <button type="button" aria-label="Close find" onClick={closeTranscriptFind} className={`${smallBtn} mr-1`} style={ink('--np-ink-secondary')}><X className="w-3.5 h-3.5" strokeWidth={2} /></button>
                                                        </>
                                                    ) : (
                                                        <button type="button" aria-label="Find in transcript" title="Find in transcript" onClick={() => { npTrack('transcript_searched'); setFindTranscript(true); }} className={iconBtn} style={ink('--np-ink-secondary')}>
                                                            <Search className="w-4 h-4" strokeWidth={1.75} />
                                                        </button>
                                                    )}
                                                </div>
                                                <span className="flex-1" />
                                                <button
                                                    type="button"
                                                    aria-label="Copy the transcript"
                                                    title={copiedKey === 'transcript' ? 'Copied' : 'Copy transcript'}
                                                    disabled={lines.length === 0}
                                                    onClick={() => { npTrack('transcript_copied'); void copyText('transcript', lines.map((l) => `${speakerName(l.speaker)}: ${l.text}`).join('\n')); }}
                                                    className={`${iconBtn} disabled:opacity-40`}
                                                    style={ink('--np-ink-secondary')}
                                                >
                                                    {copiedKey === 'transcript' ? <Check className="w-4 h-4" strokeWidth={1.75} /> : <Copy className="w-4 h-4" strokeWidth={1.75} />}
                                                </button>
                                                <button type="button" aria-label="Close transcript" onClick={() => setShowTranscript(false)} className={iconBtn} style={ink('--np-ink-secondary')}>
                                                    <Minus className="w-4 h-4" strokeWidth={1.75} />
                                                </button>
                                            </div>
                                            <div className="relative flex-1 min-h-0">
                                                <div ref={transcriptRef} onScroll={onTranscriptScroll} className="h-full overflow-y-auto px-4 pb-3 select-text">
                                                    {lines.length === 0 && live.partials.length === 0 ? (
                                                        <p className="pt-2 text-center text-[13px]" style={ink('--np-ink-tertiary')}>{paused ? 'Transcription is paused.' : 'The transcript shows here as people talk.'}</p>
                                                    ) : (
                                                        <>
                                                            {transcriptRows.map((l, i) => (
                                                                <TranscriptBubble
                                                                    key={l.partial ? `partial-${l.speaker}` : l.at}
                                                                    line={l}
                                                                    name={speakerName(l.speaker)}
                                                                    runStart={i === 0 || transcriptRows[i - 1].speaker !== l.speaker}
                                                                    partial={l.partial}
                                                                    highlighted={!l.partial && highlightAt === l.at}
                                                                    hits={l.partial ? undefined : hitsByLine.get(l.at)}
                                                                    copied={!l.partial && copiedKey === `line-${l.at}`}
                                                                    onCopy={l.partial ? undefined : () => { void copyText(`line-${l.at}`, l.text); }}
                                                                />
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                                {!atBottom && (
                                                    <button
                                                        type="button"
                                                        aria-label="Jump to the latest"
                                                        onClick={() => { const el = transcriptRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setHighlightAt(null); }}
                                                        className="np-jump np-arrive absolute bottom-4 left-1/2 -ml-6 grid h-8 w-12 place-items-center rounded-full"
                                                        style={ink('--np-ink')}
                                                    >
                                                        <ArrowDown className="w-4 h-4" strokeWidth={1.75} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ) : contentKind === 'ask' && turns.length > 0 ? (
                                        <div className="h-full flex flex-col">
                                            <div className="shrink-0 h-12 flex items-center justify-end px-3">
                                                <button type="button" aria-label="Close" title="Close" onClick={() => { npTrack('answers_closed'); setTurns([]); }} className={iconBtn} style={ink('--np-ink-secondary')}>
                                                    <ChevronDown className="w-4 h-4" strokeWidth={1.75} />
                                                </button>
                                            </div>
                                            <div ref={answerScrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-4 select-text">
                                                {turns.map((turn, i) => {
                                                    const sources = turn.status === 'done' ? answerSources(turn.text, lines) : [];
                                                    return (
                                                        <div key={i} className="np-arrive">
                                                            <div className="flex justify-end">
                                                                <p
                                                                    className="max-w-[85%] rounded-xl rounded-br py-1.5 px-3 text-[13px] leading-[18px]"
                                                                    style={{ background: 'var(--np-wash-strong)', color: 'var(--np-ink)' }}
                                                                >
                                                                    {turn.question}
                                                                </p>
                                                            </div>
                                                            {turn.status === 'error' ? (
                                                                <div className="mt-3 flex items-start justify-between gap-3">
                                                                    <p className="text-[14px] leading-[1.58]" style={ink('--np-ink-secondary')}>{turn.errorText ?? <>Couldn&rsquo;t get an answer. Check your AI provider in Settings, then ask again.</>}</p>
                                                                    <button type="button" onClick={() => retry(i)} className={chipBtn} style={ink('--np-ink-secondary')}><RotateCcw className="w-3 h-3" strokeWidth={2} /> Retry</button>
                                                                </div>
                                                            ) : turn.text ? (
                                                                <NotepadAnswer text={turn.text} />
                                                            ) : (
                                                                <p className="mt-3 text-[14px] leading-[1.58]">
                                                                    <span className="natively-thinking-label np-thinking">Thinking</span>
                                                                </p>
                                                            )}
                                                            {turn.status === 'done' && sources.length > 0 && (
                                                                <div className="mt-2">
                                                                    <p className="text-[12px] font-medium" style={ink('--np-ink-secondary')}>In the transcript</p>
                                                                    <ul className="mt-1 space-y-0.5">
                                                                        {sources.map((s) => (
                                                                            <li key={s.at}>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => { npTrack('transcript_opened'); closeTranscriptFind(); setShowTranscript(true); setHighlightAt(s.at); }}
                                                                                    className="w-full text-left text-[13px] leading-[18px] px-2 py-1 rounded-lg np-wash"
                                                                                >
                                                                                    <span className="mr-1.5" style={ink('--np-ink-tertiary')}>{speakerName(s.speaker)}</span>
                                                                                    <span style={ink('--np-ink-secondary')}>{s.text}</span>
                                                                                </button>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                            {turn.status === 'done' && (
                                                                <div className="mt-2 flex items-center gap-1.5">
                                                                    {i === turns.length - 1 && (
                                                                        <button type="button" disabled={busy} onClick={() => submitAsk('Say more about that.')} className={chipBtn} style={ink('--np-ink')}>
                                                                            Say more
                                                                        </button>
                                                                    )}
                                                                    <button type="button" onClick={() => { npTrack('answer_copied'); void copyText(`turn-${i}`, plainAnswerText(turn.text)); }} className={chipBtn} style={ink('--np-ink-secondary')}>
                                                                        {copiedKey === `turn-${i}` ? <Check className="w-3 h-3" strokeWidth={2} /> : <Copy className="w-3 h-3" strokeWidth={2} />} {copiedKey === `turn-${i}` ? 'Copied' : 'Copy'}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : contentKind === 'ask' ? (
                                        /* Granola's recipe row: two recipes, All recipes at the end, 24px chips of 12px. */
                                        <motion.div
                                            className="relative px-4 pt-[7px] pb-[3px] flex items-center gap-0.5"
                                            aria-label="Recipes"
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={panelKind ? { opacity: 1, y: 0 } : { opacity: 0, y: 0 }}
                                            transition={panelKind ? { duration: 0.25, ease: SMOOTH_OUT } : { duration: 0.1, ease: SMOOTH_OUT }}
                                        >
                                            {chipRecipes.map(recipeButton)}
                                            <button
                                                type="button"
                                                aria-haspopup="menu"
                                                aria-expanded={allRecipes}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => { if (!allRecipes) npTrack('recipes_browsed'); setAllRecipes((v) => !v); }}
                                                className={`${recipeChip} ml-auto`}
                                                style={ink(allRecipes ? '--np-ink' : '--np-ink-secondary')}
                                            >
                                                <LayoutGrid className="w-4 h-4" strokeWidth={1.75} /> All recipes
                                            </button>
                                        </motion.div>
                                    ) : null}
                                    </motion.div>
                                </motion.div>
                                {/* All recipes: a menu opening upward from its chip, outside the clipped content. */}
                                <NpPop open={askOpen && allRecipes && turns.length === 0 && slashQuery === null} origin="bottom right" role="menu" aria-label="All recipes" className="absolute right-4 bottom-[102px] z-40 w-[300px] max-h-[360px] overflow-y-auto p-1">
                                    {recipeRows([...(recentList.length ? [{ title: 'Recent', rows: recentList }] : []), { title: 'All recipes', rows: phaseRecipes }])}
                                </NpPop>
                                {/* "/" in Ask: the recipes, filtered as the user types, above the field. */}
                                <NpPop id="np-slash-recipes" open={slashOpen} origin="bottom left" role="listbox" aria-label="Recipes" className="absolute left-3 right-3 bottom-[66px] z-40 max-h-[340px] overflow-y-auto p-1">
                                    {slashRows.length
                                        ? recipeRows(slashSections, slashIndex)
                                        : <p className="px-2.5 py-2 text-[13px]" style={ink('--np-ink-secondary')}>No recipes found matching "{slashQuery}"</p>}
                                </NpPop>
                                <div className="relative z-20 rounded-[32px] p-1">
                                    <div className="flex w-full items-end gap-2">
                                        {/* The listening pill folds away to the left as Ask opens, so Ask
                                            widens instead of jumping; clipped only while folded or folding. */}
                                        {phase === 'live' && <motion.div
                                            className="shrink-0 rounded-[28px]"
                                            inert={askOpen}
                                            aria-hidden={askOpen || undefined}
                                            initial={false}
                                            animate={askOpen
                                                ? { width: 0, opacity: 0, marginRight: -8, overflow: 'hidden' }
                                                : { width: 'auto', opacity: 1, marginRight: 0, transitionEnd: { overflow: 'visible' } }}
                                            transition={askOpen ? ROW_OPEN : ROW_CLOSE}
                                        >
                                            <div className={`np-elevated${panelKind ? ' np-flat' : ''} h-14 w-max flex items-center gap-1 p-1 rounded-[28px]`}>
                                                {listeningControls}
                                            </div>
                                        </motion.div>}
                                        {/* One slot beside the pill: Ask, or the transcript's mic and language. They
                                            crossfade in place through a 2px blur, so neither pops in or out. */}
                                        <div className="grid grow basis-3/5 min-w-0 h-14">
                                            <AnimatePresence initial={false}>
                                                {showTranscript && (
                                                    <motion.div
                                                        key="transcript-controls"
                                                        className="[grid-area:1/1] min-w-0 flex items-center justify-end pr-1"
                                                        initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
                                                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
                                                        exit={{ opacity: 0, filter: 'blur(2px)', transition: { duration: 0.18, ease: SMOOTH_OUT } }}
                                                        transition={{ duration: 0.4, delay: 0.12, ease: SMOOTH_OUT }}
                                                    >
                                                        <TranscriptControls />
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                            <motion.form
                                                className={`np-ask ${askOpen ? '' : 'np-elevated np-glow '}[grid-area:1/1] w-full min-w-0 h-14 flex items-center rounded-[28px]`}
                                                inert={showTranscript}
                                                aria-hidden={showTranscript || undefined}
                                                initial={false}
                                                animate={showTranscript
                                                    ? { opacity: 0, scale: 0.98, filter: 'blur(2px)', pointerEvents: 'none' }
                                                    : { opacity: 1, scale: 1, filter: 'blur(0px)', pointerEvents: 'auto', transitionEnd: { filter: 'none' } }}
                                                transition={showTranscript ? { duration: 0.2, ease: SMOOTH_OUT } : { duration: 0.4, delay: 0.1, ease: SMOOTH_OUT }}
                                                data-engaged={askOpen ? 'true' : undefined}
                                                onMouseMove={askOpen ? undefined : (e) => {
                                                    const r = e.currentTarget.getBoundingClientRect();
                                                    e.currentTarget.style.setProperty('--np-x', `${e.clientX - r.left}px`);
                                                    e.currentTarget.style.setProperty('--np-y', `${e.clientY - r.top}px`);
                                                }}
                                                onSubmit={(e) => { e.preventDefault(); askSubmitRef.current(); }}
                                            >
                                                {askInput}
                                                {askOpen && (
                                                    <button
                                                        type="button"
                                                        aria-label="Attach image"
                                                        title={attached > 0 ? `Attach image (${attached} added)` : 'Attach image'}
                                                        disabled={!!working}
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => { void attachImage(); }}
                                                        className="mr-2 w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 np-wash"
                                                        style={{ ...ink('--np-ink-secondary'), animation: 'np-fade-in 250ms ease-out' }}
                                                    >
                                                        <Paperclip className="w-4 h-4" strokeWidth={1.75} />
                                                    </button>
                                                )}
                                            </motion.form>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            </MotionConfig>
                        )}
                        {phase === 'live' && paused && !showTranscript && !askOpen && (
                            <p className="-mt-1 text-center text-[12px] leading-4" style={ink('--np-ink-secondary')}>Transcription paused</p>
                        )}
                    </div>
                </div>
            )}

            {gallery && (
                <NoteTemplateGallery
                    appliedId={phase === 'ended' ? null : liveTemplateId}
                    initialId={gallery.initialId}
                    query={galleryQuery}
                    onQuery={setGalleryQuery}
                    onEngageSearch={engage('template')}
                    searchHookTyping={typingHere('template')}
                    onApply={applyFromGallery}
                    onClose={closeGallery}
                />
            )}
        </div>
    );
};

/** One transcript line as Granola draws it: yours on the right, theirs on the left with the name over a run. */
const TranscriptBubble: React.FC<{
    line: TranscriptLine;
    name: string;
    runStart: boolean;
    highlighted?: boolean;
    partial?: boolean;
    hits?: Array<{ from: number; to: number; current: boolean }>;
    copied?: boolean;
    onCopy?: () => void;
}> = ({ line, name, runStart, highlighted, partial, hits, copied, onCopy }) => {
    const mine = line.speaker === 'user';
    return (
        <div data-at={line.at} className={`group flex flex-col ${mine ? 'items-end pl-16' : 'items-start pr-16'} ${runStart ? 'mt-3 first:mt-1' : 'mt-1'}`}>
            {runStart && !mine && <span className="mb-1 px-2 text-[12px] font-medium" style={ink('--np-ink-secondary')}>{name}</span>}
            <div className={`flex items-center gap-1.5 max-w-full ${mine ? 'flex-row-reverse' : ''}`}>
                <p
                    className="min-w-0 rounded-lg px-2 py-1.5 text-[13px] leading-snug"
                    style={{
                        background: mine ? 'var(--np-bubble-me)' : 'var(--np-bubble-them)',
                        color: mine ? 'var(--np-bubble-me-ink)' : 'var(--np-bubble-them-ink)',
                        boxShadow: highlighted ? '0 0 0 2px var(--np-focus)' : undefined,
                    }}
                >
                    <span style={partial ? { opacity: 0.5 } : undefined}>{hits?.length ? markHits(line.text, hits) : line.text}</span>
                </p>
                {onCopy && (
                    <button
                        type="button"
                        aria-label="Copy this line"
                        onClick={onCopy}
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity np-wash"
                        style={ink('--np-ink-secondary')}
                    >
                        {copied ? <Check className="w-3.5 h-3.5" strokeWidth={1.75} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />}
                    </button>
                )}
            </div>
        </div>
    );
};

/** The line's text with each find match marked, the current one amber. */
function markHits(text: string, hits: Array<{ from: number; to: number; current: boolean }>): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let at = 0;
    for (const h of hits) {
        if (h.from > at) out.push(text.slice(at, h.from));
        out.push(<mark key={h.from} className="np-hit" data-current={h.current ? '' : undefined}>{text.slice(h.from, h.to)}</mark>);
        at = h.to;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
}

export default NotesWindow;
