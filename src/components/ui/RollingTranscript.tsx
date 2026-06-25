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
    const [autoScroll, setAutoScroll] = useState(true);

    const intStatus = interviewerChannel?.status ?? 'connected';
    const micStatus = microphoneChannel?.status ?? 'connected';
    const anyAwaitingAudio = intStatus === 'awaiting-audio' || micStatus === 'awaiting-audio';
    const isNormal = intStatus === 'connected' && micStatus === 'connected' && !anyAwaitingAudio;
    const showTranscriptText = intStatus !== 'failed' && micStatus !== 'failed';

    useEffect(() => {
        if (containerRef.current && showTranscriptText && text && autoScroll) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [text, showTranscriptText, autoScroll]);

    const scrollToBottom = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        setAutoScroll(true);
    }, []);

    const isScrollable = useCallback(() => {
        const el = containerRef.current;
        return Boolean(el && el.scrollHeight > el.clientHeight + 1);
    }, []);

    const scrollByLines = useCallback((direction: -1 | 1) => {
        const el = containerRef.current;
        if (!el || !isScrollable()) return false;

        const lineHeight = getTranscriptLineHeight(el);
        const delta = direction * lineHeight * TRANSCRIPT_SCROLL_LINES;
        const maxTop = el.scrollHeight - el.clientHeight;
        const nextTop = Math.max(0, Math.min(maxTop, el.scrollTop + delta));

        el.scrollTo({ top: nextTop, behavior: 'smooth' });
        setAutoScroll(maxTop - nextTop <= 4);
        return true;
    }, [isScrollable]);

    useImperativeHandle(ref, () => ({
        scrollByLines,
        scrollToBottom,
        isScrollable,
    }), [isScrollable, scrollByLines, scrollToBottom]);

    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        setAutoScroll(isNearBottom(el));
    }, []);

    return (
        <div className="relative w-full">
            <div
                className="relative w-full overflow-hidden"
                style={{
                    maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
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
