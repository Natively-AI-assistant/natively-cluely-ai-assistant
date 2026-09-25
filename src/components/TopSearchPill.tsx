import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useT } from '../i18n';
import { createPortal } from 'react-dom';
import { Search, Sparkles, FileText, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

// ============================================
// Types
// ============================================

type PillState = 'idle' | 'focused' | 'typing' | 'results';

interface Meeting {
    id: string;
    title: string;
    date: string;
    summary?: string;
}

interface SearchResult {
    id: string;
    type: 'meeting';
    title: string;
    subtitle?: string;
    meetingId: string;
}

// A long-term memory (Hindsight) matching the query. Linked when the memory carries
// the tag of the meeting it was saved from — then the row opens that meeting.
interface MemoryHit {
    text: string;
    meetingId?: string;
    meetingTitle?: string;
    date?: string;
}

// Memory recall is a network call (local or Cloud Hindsight), so it waits for the
// typing to settle and for a query long enough to mean something.
const MEMORY_DEBOUNCE_MS = 250;
const MEMORY_MIN_QUERY = 3;

// Meeting matches follow the query once typing pauses, on the same beat as memory
// recall. One letter matches almost every meeting and the next few narrow it, so
// matching on every keystroke slid the dropdown open tall and pulled it back up
// mid-word; settled on a pause, the dropdown only grows while you type.
const SESSION_DEBOUNCE_MS = MEMORY_DEBOUNCE_MS;

function shortDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TopSearchPillProps {
    meetings: Meeting[];
    onAIQuery: (query: string) => void;
    onLiteralSearch: (query: string) => void;
    onOpenMeeting: (meetingId: string) => void;
    onExpansionChange?: (isExpanded: boolean) => void;
}

// ============================================
// Fuzzy Search Helper
// ============================================

function fuzzyMatch(text: string, query: string): boolean {
    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    // Simple contains match for now
    if (normalizedText.includes(normalizedQuery)) return true;

    // Fuzzy character match
    // Fuzzy match removed for stricter accuracy
    // Only return true if exact substring match (already checked above)
    return false;
}

function searchMeetings(meetings: Meeting[], query: string): SearchResult[] {
    if (!query.trim()) return [];

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const meeting of meetings) {
        if (seen.has(meeting.id)) continue;

        // Match against title and summary
        const titleMatch = fuzzyMatch(meeting.title, query);
        const summaryMatch = meeting.summary && fuzzyMatch(meeting.summary, query);

        if (titleMatch || summaryMatch) {
            seen.add(meeting.id);
            results.push({
                id: meeting.id,
                type: 'meeting',
                title: meeting.title,
                subtitle: new Date(meeting.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                }),
                meetingId: meeting.id
            });
        }

        if (results.length >= 5) break;
    }

    return results;
}

// ============================================
// Results Panel
// ============================================

// The original slide (same spring, same fade), aimed at the measured height of
// the results instead of framer's `height: 'auto'`. 'auto' is resolved once, when
// the panel mounts: the results shrank as you kept typing while the panel kept
// sliding toward that first measurement, then dropped ~190px in one frame when
// the spring settled. Re-measured on every change, the spring always heads for
// the real height.
//
// While it is open the panel only grows. The results narrow as you type (one
// letter matches almost every meeting), and following them back up read as the
// bottom edge bouncing, so a shorter result set leaves room at the bottom until
// the pill closes; the panel remounts on every open, so each open starts fresh.
// The height lives here, not in the pill, so re-measures re-render only this
// wrapper; the rows arrive as the same `children` and are skipped.
const ResultsPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const bodyRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    // Measured before the first paint, so the spring starts toward this body and
    // not toward 0; the observer then follows results and memories arriving late.
    // offsetHeight ignores transforms, and the body ends in padding, so its
    // rounding never clips a row.
    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const measure = () => setHeight((current) => Math.max(current, body.offsetHeight));
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        return () => observer.disconnect();
    }, []);

    return (
        <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
                type: "spring",
                stiffness: 150,
                damping: 25,
                opacity: { duration: 0.3 }
            }}
            className="overflow-hidden"
        >
            <div ref={bodyRef} className="w-[480px]">
                {children}
            </div>
        </motion.div>
    );
};

// Result rows swap in place when the results change; a new row only fades in.
// Rows used to animate their own height out: a collapsing row's text is not
// clipped, so it ran over the rows below while they moved up (and before that,
// popLayout left it fading where it had been while the rest slid under it).
const ROW_ENTER = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.15, ease: 'easeOut' as const },
};

// ============================================
// Main Component
// ============================================

const TopSearchPill: React.FC<TopSearchPillProps> = ({
    meetings,
    onAIQuery,
    onLiteralSearch,
    onOpenMeeting,
    onExpansionChange
}) => {
    const isLight = useResolvedTheme() === 'light';
    const t = useT();
    const [state, setState] = useState<PillState>('idle');
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // The backdrop starts at the bottom of the bar the pill sits in, not at the
    // top of the window. The bar paints above the backdrop, so covering it
    // dimmed nothing — but backdrop-filter still blurred the dark strip behind
    // the bar down into the page, and the bar's crisp bottom edge grew into a
    // ~10px soft band as the backdrop faded in.
    const [backdropTop, setBackdropTop] = useState(0);

    // Notify parent of expansion changes
    useEffect(() => {
        onExpansionChange?.(state !== 'idle');
    }, [state, onExpansionChange]);

    useLayoutEffect(() => {
        if (state === 'idle') return;
        const bar = containerRef.current?.offsetParent;
        setBackdropTop(bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0);
    }, [state]);

    // Compute results from the query as it stood when typing paused (see
    // SESSION_DEBOUNCE_MS). Cleared as soon as the results close, so a reopened
    // pill never flashes the last search's sessions.
    const [sessionQuery, setSessionQuery] = useState('');
    useEffect(() => {
        if (state !== 'results') {
            setSessionQuery('');
            return;
        }
        const timer = setTimeout(() => setSessionQuery(query), SESSION_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query, state]);

    const sessionResults = useMemo(() => {
        if (state !== 'results' || !sessionQuery.trim()) return [];
        return searchMeetings(meetings, sessionQuery);
    }, [meetings, sessionQuery, state]);

    // Long-term memories for the query. Each request carries an id; a response for an
    // older query (the user kept typing) is dropped. Cleared whenever the pill closes
    // or the query gets too short, so a reopened pill never flashes stale memories.
    const [memoryHits, setMemoryHits] = useState<MemoryHit[]>([]);
    const memoryRequest = useRef(0);
    useEffect(() => {
        const q = query.trim();
        const id = ++memoryRequest.current;
        if (state !== 'results' || q.length < MEMORY_MIN_QUERY || !window.electronAPI?.searchMemories) {
            setMemoryHits([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const res = await window.electronAPI.searchMemories!(q);
                if (id !== memoryRequest.current) return;
                setMemoryHits(res?.enabled && Array.isArray(res.results) ? res.results : []);
            } catch {
                if (id === memoryRequest.current) setMemoryHits([]);
            }
        }, MEMORY_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query, state]);

    // Only a memory linked to a meeting is actionable; the rest are read in place.
    // Memories render BELOW Sessions, so their late arrival never shifts the index of
    // anything already on screen (Enter defaults to index 0).
    const linkedMemories = useMemo(() => memoryHits.filter((m) => m.meetingId), [memoryHits]);

    // Total selectable items: 2 (Explore section) + sessions + linked memories
    const totalItems = 2 + sessionResults.length + linkedMemories.length;

    // A highlighted memory row can vanish when a newer response lands; drop the
    // highlight rather than leave it on nothing (Enter then falls back to index 0).
    useEffect(() => {
        if (selectedIndex >= totalItems) setSelectedIndex(-1);
    }, [selectedIndex, totalItems]);

    // State transitions
    const open = useCallback(() => {
        setState('focused');
        setTimeout(() => inputRef.current?.focus(), 50);
    }, []);

    const close = useCallback(() => {
        setState('idle');
        // Delay clearing query to allow exit animation to complete
        setTimeout(() => {
            setQuery('');
            setSelectedIndex(-1);
        }, 150);
        inputRef.current?.blur();
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
        setSelectedIndex(-1);

        if (value.trim()) {
            setState('results');
        } else {
            setState('focused');
        }
    }, []);

    const handleSelect = useCallback((index: number) => {
        if (index === 0) {
            // AI Query
            onAIQuery(query);
            close();
        } else if (index === 1) {
            // Literal search
            onLiteralSearch(query);
            close();
        } else if (index < 2 + sessionResults.length) {
            // Session result
            const sessionIndex = index - 2;
            const result = sessionResults[sessionIndex];
            if (result) {
                onOpenMeeting(result.meetingId);
                close();
            }
        } else {
            // Linked memory — opens the meeting it was saved from
            const memory = linkedMemories[index - 2 - sessionResults.length];
            if (memory?.meetingId) {
                onOpenMeeting(memory.meetingId);
                close();
            }
        }
    }, [query, sessionResults, linkedMemories, onAIQuery, onLiteralSearch, onOpenMeeting, close]);

    // Keyboard handling
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // ⌘K to open
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                if (state === 'idle') {
                    open();
                } else {
                    close();
                }
                return;
            }

            if (state === 'idle') return;

            // ESC to close
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                return;
            }

            // Arrow navigation
            if (state === 'results') {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, -1));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    // No item hovered/arrow-selected yet (selectedIndex is -1 right
                    // after typing) — default Enter to the AI Query option (index 0),
                    // which is the primary action and already shows the raw query.
                    handleSelect(selectedIndex < 0 ? 0 : selectedIndex);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [state, open, close, selectedIndex, totalItems, handleSelect]);

    // Click outside to close
    useEffect(() => {
        if (state === 'idle') return;

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                close();
            }
        };

        // Delay to prevent immediate close on open click
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [state, close]);

    const isExpanded = state !== 'idle';
    const showResults = state === 'results' && query.trim();

    return (
        <>
            {/* Backdrop overlay */}
            {createPortal(
                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            style={{ top: backdropTop }}
                            className={`fixed inset-0 ${isLight ? 'bg-black/[0.05]' : 'bg-black/30'} z-[90]`}
                            onClick={close}
                        />
                    )}
                </AnimatePresence>,
                document.body
            )}

            {/* Search Pill Container. will-change-transform gives the pill its own
                compositor layer. Without it the open dropdown, which hangs below the
                header, was painted into the header's layer and stretched it: on the first
                open and close after a load, the new area showed the header's colour for
                2-4 frames before it was drawn, a full-width band up to ~20px under the top
                bar (recorded frame by frame; it takes the header's colour when that is
                changed). */}
            <div
                ref={containerRef}
                className="absolute left-1/2 -translate-x-1/2 top-[7px] no-drag z-40 will-change-transform"
            >
                <div className="relative">
                    <motion.div
                        initial={false}
                        animate={{
                            width: isExpanded ? 480 : 340,
                        }}
                        transition={{
                            type: "spring",
                            stiffness: 150,
                            damping: 25
                        }}
                        className="relative transform-gpu"
                    >
                        {/* Main Pill */}
                        <div className="relative">
                            {/* At rest, the "My Natively" section's colour (Launcher.tsx), recessed into
                                the header with an inner top shadow and a hairline ring. Open, it blends
                                into the same colour at 90% so the frost shows: in on the dropdown-open
                                clock (250ms smooth-out), back on the close clock (150ms).
                                The blur stays on at rest, where the opaque fill hides it, so only
                                background-color and box-shadow animate. Only the open results panel
                                casts a drop, so it reads above the page. color-mix because a /90
                                modifier emits nothing on a bare var() colour. */}
                            <div
                                className={`
                                    relative overflow-hidden
                                    backdrop-blur-xl backdrop-saturate-150
                                    rounded-2xl ring-1
                                    transition-[background-color,box-shadow] ease-sculpted
                                    ${isExpanded ? 'duration-[250ms]' : 'duration-150'}
                                    ${isLight
                                        ? `${isExpanded ? 'bg-[color-mix(in_srgb,var(--bg-secondary)_90%,transparent)]' : 'bg-bg-secondary'} ${showResults ? 'shadow-[inset_0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.10)]' : 'shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]'} ${isExpanded ? 'ring-black/[0.14]' : 'ring-black/[0.08] hover:ring-black/[0.14]'}`
                                        : `${isExpanded ? 'bg-[color-mix(in_srgb,var(--bg-elevated)_90%,transparent)]' : 'bg-bg-elevated'} ${showResults ? 'shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),0_12px_32px_rgba(0,0,0,0.55)]' : 'shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]'} ${isExpanded ? 'ring-white/[0.14]' : 'ring-white/[0.08] hover:ring-white/[0.12]'}`}
                                `}
                            >
                                {/* Input Row */}
                                <div
                                    className="relative flex items-center"
                                    onClick={() => state === 'idle' && open()}
                                >
                                    <div className="absolute left-3 flex items-center pointer-events-none">
                                        <Search size={14} className="text-text-tertiary" />
                                    </div>
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={query}
                                        onChange={handleInputChange}
                                        onFocus={() => state === 'idle' && setState('focused')}
                                        className={`
                                        w-full bg-transparent
                                        pl-9 pr-4 py-1
                                        text-[13px] text-text-primary
                                        placeholder-text-tertiary
                                        focus:outline-none
                                        ${state === 'idle' ? 'cursor-default' : 'cursor-text'}
                                    `}
                                        placeholder={t("Search or ask anything...")}
                                    />
                                </div>

                                {/* Results Panel */}
                                <AnimatePresence>
                                    {showResults && (
                                        <ResultsPanel>
                                                <div className="border-t border-border-muted py-2">
                                                    {/* Explore Section */}
                                                    <div className="px-3 py-1">
                                                        <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                                            Explore
                                                        </div>

                                                        {/* AI Query Option */}
                                                        <motion.button
                                                            initial={{ opacity: 0, scale: 0.95 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            transition={{ duration: 0.2 }}
                                                            className={`
                                                            w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left
                                                            transition-colors duration-100
                                                            ${selectedIndex === 0
                                                                    ? 'bg-bg-item-active'
                                                                    : 'hover:bg-bg-item-hover'
                                                                }
                                                        `}
                                                            onClick={() => handleSelect(0)}
                                                            onMouseEnter={() => setSelectedIndex(0)}
                                                        >
                                                            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                                                                <Sparkles size={12} className="text-white" />
                                                            </div>
                                                            <span className="text-[13px] text-text-primary truncate">
                                                                {query}
                                                            </span>
                                                        </motion.button>

                                                        {/* Literal Search Option */}
                                                        <motion.button
                                                            initial={{ opacity: 0, scale: 0.95 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            transition={{ duration: 0.2 }}
                                                            className={`
                                                            w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left
                                                            transition-colors duration-100
                                                            ${selectedIndex === 1
                                                                    ? 'bg-bg-item-active'
                                                                    : 'hover:bg-bg-item-hover'
                                                                }
                                                        `}
                                                            onClick={() => handleSelect(1)}
                                                            onMouseEnter={() => setSelectedIndex(1)}
                                                        >
                                                            <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0">
                                                                <Search size={12} className="text-text-secondary" />
                                                            </div>
                                                            <span className="text-[13px] text-text-secondary">
                                                                Search for <span className="text-text-primary">"{query}"</span>
                                                            </span>
                                                        </motion.button>
                                                    </div>

                                                    {/* Sessions Section */}
                                                    {sessionResults.length > 0 && (
                                                        <div className="px-3 py-1 mt-1">
                                                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                                                Sessions
                                                            </div>

                                                                {sessionResults.map((result, index) => (
                                                                    <motion.button
                                                                        key={result.id}
                                                                        {...ROW_ENTER}
                                                                        className={`
                                                                        w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left
                                                                        transition-colors duration-100
                                                                        ${selectedIndex === index + 2
                                                                                ? 'bg-bg-item-active'
                                                                                : 'hover:bg-bg-item-hover'
                                                                            }
                                                                    `}
                                                                        onClick={() => handleSelect(index + 2)}
                                                                        onMouseEnter={() => setSelectedIndex(index + 2)}
                                                                    >
                                                                        <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0">
                                                                            <FileText size={12} className="text-text-secondary" />
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="text-[13px] text-text-primary truncate">
                                                                                {result.title}
                                                                            </div>
                                                                            {result.subtitle && (
                                                                                <div className="text-[11px] text-text-tertiary">
                                                                                    {result.subtitle}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </motion.button>
                                                                ))}
                                                        </div>
                                                    )}

                                                    {/* Memory Section — long-term memories (Hindsight) */}
                                                    {memoryHits.length > 0 && (
                                                        <div className="px-3 py-1 mt-1">
                                                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                                                {t('Memory')}
                                                            </div>

                                                                {memoryHits.map((memory) => {
                                                                    const linkedIndex = memory.meetingId ? linkedMemories.indexOf(memory) : -1;
                                                                    const itemIndex = linkedIndex >= 0 ? 2 + sessionResults.length + linkedIndex : -1;
                                                                    const when = shortDate(memory.date);
                                                                    const subtitle = memory.meetingId
                                                                        ? [memory.meetingTitle || t('Meeting'), when].filter(Boolean).join(' · ')
                                                                        : [t('Long-term memory'), when].filter(Boolean).join(' · ');
                                                                    const body = (
                                                                        <>
                                                                            <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 mt-px">
                                                                                <Brain size={12} className="text-text-secondary" />
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="text-[13px] text-text-primary line-clamp-2">
                                                                                    {memory.text}
                                                                                </div>
                                                                                <div className="text-[11px] text-text-tertiary truncate">
                                                                                    {subtitle}
                                                                                </div>
                                                                            </div>
                                                                        </>
                                                                    );
                                                                    const motionProps = ROW_ENTER;
                                                                    return itemIndex >= 0 ? (
                                                                        <motion.button
                                                                            key={`memory:${memory.text}`}
                                                                            {...motionProps}
                                                                            data-memory-linked="true"
                                                                            className={`
                                                                            w-full flex items-start gap-3 px-2 py-1.5 rounded-lg text-left
                                                                            transition-colors duration-100
                                                                            ${selectedIndex === itemIndex
                                                                                    ? 'bg-bg-item-active'
                                                                                    : 'hover:bg-bg-item-hover'
                                                                                }
                                                                        `}
                                                                            onClick={() => handleSelect(itemIndex)}
                                                                            onMouseEnter={() => setSelectedIndex(itemIndex)}
                                                                        >
                                                                            {body}
                                                                        </motion.button>
                                                                    ) : (
                                                                        <motion.div
                                                                            key={`memory:${memory.text}`}
                                                                            {...motionProps}
                                                                            data-memory-linked="false"
                                                                            className="w-full flex items-start gap-3 px-2 py-1.5 text-left"
                                                                        >
                                                                            {body}
                                                                        </motion.div>
                                                                    );
                                                                })}
                                                        </div>
                                                    )}
                                                </div>
                                        </ResultsPanel>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                </div >
            </div >
        </>
    );
};

export default TopSearchPill;
