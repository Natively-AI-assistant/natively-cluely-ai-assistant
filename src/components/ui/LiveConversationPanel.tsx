import React, { useEffect, useMemo, useRef } from 'react';

export interface ConversationTurn {
    id: string;
    speaker: 'interviewer' | 'user';
    text: string;
    timestamp: number;
    final: boolean;
}

interface LivePartial {
    speaker: 'interviewer' | 'user';
    text: string;
}

interface LiveConversationPanelProps {
    turns: ConversationTurn[];
    livePartial: LivePartial | null;
    isLightTheme?: boolean;
}

/**
 * Editorial Console — speaker attribution as page typography.
 *
 * Interviewer voice flows from the left, marked by a thin warm-ivory rule
 * (or near-black ochre in light theme) and rendered in a serif italic, like
 * a quote-block in a printed page. The user voice is set in the system body
 * face, marked by a phosphor-green rule on the right edge — the same accent
 * used everywhere else in the overlay to signal "you". A ▍caret blinks on
 * the partial transcript so it's obvious which side is currently speaking.
 */
const LiveConversationPanel: React.FC<LiveConversationPanelProps> = ({
    turns,
    livePartial,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns, livePartial]);

    // Compose final + partial into a single rendered list, deduping when the
    // partial just continues the most recent turn from the same speaker.
    const rows = useMemo(() => {
        const items: Array<{
            id: string;
            speaker: 'interviewer' | 'user';
            text: string;
            partial: boolean;
        }> = turns.map((t) => ({ id: t.id, speaker: t.speaker, text: t.text, partial: false }));

        if (livePartial && livePartial.text.trim()) {
            items.push({
                id: 'live-partial',
                speaker: livePartial.speaker,
                text: livePartial.text,
                partial: true,
            });
        }
        return items;
    }, [turns, livePartial]);

    if (rows.length === 0) return null;

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    };

    return (
        <div className="w-full px-5 pb-3 pt-2 no-drag">
            <div
                ref={scrollRef}
                className="console-log w-full max-h-[220px] overflow-y-auto flex flex-col"
            >
                {rows.map((row, idx) => {
                    const isUser = row.speaker === 'user';
                    const turn = turns.find((t) => t.id === row.id);
                    const ts = turn ? formatTime(turn.timestamp) : null;

                    return (
                        <article
                            key={row.id}
                            className={`group/turn relative py-2 ${
                                idx > 0 ? 'border-t border-[var(--console-rule)]' : ''
                            }`}
                        >
                            <div
                                className={`flex flex-col ${
                                    isUser ? 'items-end ml-auto' : 'items-start'
                                } max-w-[92%]`}
                            >
                                {/* Speaker label + timestamp — small caps mono */}
                                <header className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                                    <span
                                        className={`console-label ${
                                            isUser ? 'console-you-color' : 'console-them-soft'
                                        } flex items-center gap-2`}
                                    >
                                        <span
                                            className={`inline-block rounded-full ${
                                                isUser
                                                    ? 'bg-[var(--console-accent)]'
                                                    : 'bg-[var(--console-them)]'
                                            } ${row.partial ? 'console-pulse-dot is-pulsing' : ''}`}
                                            style={{ width: 4, height: 4 }}
                                        />
                                        {isUser ? 'You' : 'Them'}
                                    </span>
                                    {ts && (
                                        <span className="console-mono text-[9.5px] console-ink-dim tracking-wider">
                                            {ts}
                                        </span>
                                    )}
                                </header>

                                {/* Body — interviewer in serif italic, user in body face */}
                                <div
                                    className={
                                        isUser
                                            ? 'console-you-rule pr-3 console-ink text-[13px] leading-[1.55] font-normal text-right'
                                            : 'console-them-rule pl-3 console-them-color console-serif italic text-[14.5px] leading-[1.5] font-normal text-left'
                                    }
                                    style={{
                                        fontVariationSettings: !isUser ? '"opsz" 36, "wght" 400, "SOFT" 50' : undefined,
                                    }}
                                >
                                    {row.text}
                                    {row.partial && (
                                        <span
                                            className={`console-caret ${!isUser ? 'console-caret-them' : ''}`}
                                            aria-hidden
                                        />
                                    )}
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
};

export default LiveConversationPanel;
