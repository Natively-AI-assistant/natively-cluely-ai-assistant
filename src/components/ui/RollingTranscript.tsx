import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

interface ChannelStatus {
    status: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
    error?: string;
    provider?: string;
}

interface RollingTranscriptProps {
    text: string;
    isActive?: boolean;
    surfaceStyle?: React.CSSProperties;
    interviewerChannel?: ChannelStatus;
    microphoneChannel?: ChannelStatus;
}

export interface RollingTranscriptHandle {
    scrollByLines: (direction: -1 | 1) => boolean;
    scrollToBottom: () => void;
    isScrollable: () => boolean;
}

const TRANSCRIPT_SCROLL_LINES = 3;
const TRANSCRIPT_SCROLL_FRICTION_HALF_LIFE = 0.12;
const TRANSCRIPT_SCROLL_TERMINAL_LINES_PER_SECOND = 48;
const TRANSCRIPT_SCROLL_MIN_VELOCITY = 6;
const TRANSCRIPT_SCROLL_MAX_FRAME_DT = 0.05;

const isNearBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop <= 4;

const getTranscriptLineHeight = (el: HTMLElement) => {
    const textEl = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el;
    return Number.parseFloat(window.getComputedStyle(textEl).lineHeight) || 28;
};

const RollingTranscript = forwardRef<RollingTranscriptHandle, RollingTranscriptProps>(({
    text, isActive = true, surfaceStyle,
    interviewerChannel, microphoneChannel,
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const programmaticAutoScrollRef = useRef(false);
    const programmaticAutoScrollTimerRef = useRef<number | null>(null);
    const lastAutoScrolledTextRef = useRef<string | null>(null);
    const transcriptScrollMomentumRef = useRef({
        raf: null as number | null,
        lastTs: 0,
        velocity: 0,
        fraction: 0,
    });
    const [autoScroll, setAutoScroll] = useState(true);

    const intStatus = interviewerChannel?.status ?? 'connected';
    const micStatus = microphoneChannel?.status ?? 'connected';
    const anyAwaitingAudio = intStatus === 'awaiting-audio' || micStatus === 'awaiting-audio';
    const isNormal = intStatus === 'connected' && micStatus === 'connected' && !anyAwaitingAudio;
    const showTranscriptText = intStatus !== 'failed' && micStatus !== 'failed';

    const setProgrammaticAutoScroll = useCallback((enabled: boolean) => {
        if (programmaticAutoScrollTimerRef.current !== null) {
            window.clearTimeout(programmaticAutoScrollTimerRef.current);
            programmaticAutoScrollTimerRef.current = null;
        }

        programmaticAutoScrollRef.current = enabled;
        if (enabled) {
            programmaticAutoScrollTimerRef.current = window.setTimeout(() => {
                programmaticAutoScrollRef.current = false;
                programmaticAutoScrollTimerRef.current = null;
            }, 500);
        }
    }, []);

    useEffect(() => {
        return () => {
            if (programmaticAutoScrollTimerRef.current !== null) {
                window.clearTimeout(programmaticAutoScrollTimerRef.current);
            }
            const momentum = transcriptScrollMomentumRef.current;
            if (momentum.raf !== null) {
                window.cancelAnimationFrame(momentum.raf);
                momentum.raf = null;
            }
        };
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !showTranscriptText || !text || !autoScroll) return;
        if (lastAutoScrolledTextRef.current === text) return;

        lastAutoScrolledTextRef.current = text;
        setProgrammaticAutoScroll(true);
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [text, showTranscriptText, autoScroll, setProgrammaticAutoScroll]);

    const scrollToBottom = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
        setProgrammaticAutoScroll(false);
        setAutoScroll(true);
    }, [setProgrammaticAutoScroll]);

    const isScrollable = useCallback(() => {
        const el = containerRef.current;
        return Boolean(el && el.scrollHeight > el.clientHeight + 1);
    }, []);

    const startTranscriptMomentum = useCallback(() => {
        const momentum = transcriptScrollMomentumRef.current;
        if (momentum.raf !== null) return;

        const tick = (ts: number) => {
            const el = containerRef.current;
            if (!el) {
                momentum.raf = null;
                momentum.lastTs = 0;
                momentum.velocity = 0;
                momentum.fraction = 0;
                return;
            }

            if (momentum.lastTs === 0) momentum.lastTs = ts;
            const dt = Math.min((ts - momentum.lastTs) / 1000, TRANSCRIPT_SCROLL_MAX_FRAME_DT);
            momentum.lastTs = ts;

            if (Math.abs(momentum.velocity) < TRANSCRIPT_SCROLL_MIN_VELOCITY) {
                momentum.raf = null;
                momentum.lastTs = 0;
                momentum.velocity = 0;
                momentum.fraction = 0;
                return;
            }

            const maxTop = el.scrollHeight - el.clientHeight;
            const current = el.scrollTop;
            const move = momentum.velocity * dt + momentum.fraction;
            const intMove = Math.trunc(move);
            momentum.fraction = move - intMove;

            if (intMove !== 0) {
                let nextTop = current + intMove;
                if (nextTop <= 0) {
                    nextTop = 0;
                    momentum.velocity = Math.max(0, momentum.velocity);
                    momentum.fraction = 0;
                } else if (nextTop >= maxTop) {
                    nextTop = maxTop;
                    momentum.velocity = Math.min(0, momentum.velocity);
                    momentum.fraction = 0;
                }

                if (nextTop !== current) el.scrollTop = nextTop;
                setAutoScroll(isNearBottom(el));
            }

            momentum.velocity *= Math.pow(0.5, dt / TRANSCRIPT_SCROLL_FRICTION_HALF_LIFE);
            momentum.raf = window.requestAnimationFrame(tick);
        };

        momentum.raf = window.requestAnimationFrame(tick);
    }, []);

    const scrollByLines = useCallback((direction: -1 | 1) => {
        const el = containerRef.current;
        if (!el || !isScrollable()) return false;

        const lineHeight = getTranscriptLineHeight(el);
        const maxTop = el.scrollHeight - el.clientHeight;
        if ((direction < 0 && el.scrollTop <= 1) || (direction > 0 && maxTop - el.scrollTop <= 1)) return false;

        const momentum = transcriptScrollMomentumRef.current;
        if (Math.sign(momentum.velocity) === -direction) {
            momentum.velocity = 0;
            momentum.fraction = 0;
        }

        const kickVelocity = lineHeight * TRANSCRIPT_SCROLL_LINES * (Math.LN2 / TRANSCRIPT_SCROLL_FRICTION_HALF_LIFE);
        const terminalVelocity = lineHeight * TRANSCRIPT_SCROLL_TERMINAL_LINES_PER_SECOND;
        momentum.velocity = Math.max(
            -terminalVelocity,
            Math.min(terminalVelocity, momentum.velocity + direction * kickVelocity),
        );

        setProgrammaticAutoScroll(false);
        setAutoScroll(false);
        startTranscriptMomentum();
        return true;
    }, [isScrollable, setProgrammaticAutoScroll, startTranscriptMomentum]);

    useImperativeHandle(ref, () => ({
        scrollByLines,
        scrollToBottom,
        isScrollable,
    }), [isScrollable, scrollByLines, scrollToBottom]);

    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (programmaticAutoScrollRef.current) {
            if (isNearBottom(el)) setProgrammaticAutoScroll(false);
            setAutoScroll(true);
            return;
        }
        setAutoScroll(isNearBottom(el));
    }, [setProgrammaticAutoScroll]);

    return (
        <div className="relative w-full">
            <div
                className="relative w-full overflow-hidden"
                style={{
                    maskImage: 'linear-gradient(to bottom, transparent 0px, black 8px, black 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, black 8px, black 100%)',
                }}
            >
                <div className="w-[90%] mx-auto pt-2">
                    <div
                        ref={containerRef}
                        onScroll={handleScroll}
                        className="max-h-[84px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words scroll-smooth overlay-transcript-surface transition-all duration-500 text-left"
                        style={{
                            ...surfaceStyle,
                            scrollbarWidth: 'none',
                        }}
                    >
                        {showTranscriptText && (
                            <div className="text-[13px] italic leading-7 text-[var(--overlay-text-muted)] transition-all duration-300">
                                {text || 'Listening…'}
                                {isActive && isNormal && (
                                    <span className="inline-flex items-center ml-2">
                                        <span className="w-[3px] h-[3px] bg-emerald-400/70 rounded-full animate-pulse" />
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

RollingTranscript.displayName = 'RollingTranscript';

export default RollingTranscript;
