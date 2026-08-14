import React, { useEffect, useRef } from 'react';

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

const RollingTranscript: React.FC<RollingTranscriptProps> = ({
    text, isActive = true, surfaceStyle,
    interviewerChannel, microphoneChannel,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const intStatus = interviewerChannel?.status ?? 'connected';
    const micStatus = microphoneChannel?.status ?? 'connected';
    const anyAwaitingAudio = intStatus === 'awaiting-audio' || micStatus === 'awaiting-audio';
    const isNormal = intStatus === 'connected' && micStatus === 'connected' && !anyAwaitingAudio;
    const showTranscriptText = intStatus !== 'failed' && micStatus !== 'failed';

    useEffect(() => {
        if (containerRef.current && showTranscriptText && text) {
            containerRef.current.scrollLeft = containerRef.current.scrollWidth;
        }
    }, [text, showTranscriptText]);

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
                        className="overflow-hidden whitespace-nowrap scroll-smooth overlay-transcript-surface transition-all duration-500 text-right"
                        style={{
                            ...surfaceStyle,
                            maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
                        }}
                    >
                        {showTranscriptText && (
                            <span className="inline-flex items-center text-[13px] italic leading-7 text-[var(--overlay-text-muted)] transition-all duration-300">
                                {text || 'Listening…'}
                                {isActive && isNormal && (
                                    <span className="inline-flex items-center ml-2">
                                        <span className="w-[3px] h-[3px] bg-emerald-400/70 rounded-full animate-pulse" />
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RollingTranscript;