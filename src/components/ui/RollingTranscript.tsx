import React, { useEffect, useRef } from 'react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

interface RollingTranscriptProps {
    text: string;
    isActive?: boolean;
    surfaceStyle?: React.CSSProperties;
}

/**
 * RollingTranscript - A single-line horizontally scrolling transcript bar
 * 
 * Displays real-time speech transcription as a smooth left-scrolling text track.
 * Features:
 * - Fixed height, single line only
 * - Text flows from right to left as new words arrive
 * - Edge fade gradients for visual polish
 */
const RollingTranscript: React.FC<RollingTranscriptProps> = ({ text, isActive = true, surfaceStyle }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    useResolvedTheme();

    // Auto-scroll to the end when text updates
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollLeft = containerRef.current.scrollWidth;
        }
    }, [text]);

    if (!text) return null;

    return (
        <div className="relative w-[90%] mx-auto pt-2">
            {/* Scrolling Container */}
            <div
                ref={containerRef}
                className="overflow-hidden whitespace-nowrap text-right scroll-smooth overlay-transcript-surface"
                style={{
                    ...surfaceStyle,
                    maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)'
                }}
            >
                <span className="overlay-text-secondary inline-flex items-center text-[13px] italic leading-7 transition-all duration-300">
                    {text}
                    {isActive && (
                        <span className="inline-flex items-center ml-2">
                            <span className="w-1 h-1 bg-green-500/60 rounded-full animate-pulse" />
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
};

export default RollingTranscript;
