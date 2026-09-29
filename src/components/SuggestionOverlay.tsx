import React, { useState, useEffect } from 'react';

interface SuggestionOverlayProps {
    className?: string;
}

interface Transcript {
    speaker: string;
    text: string;
    final: boolean;
}

interface GeneratedSuggestion {
    question: string;
    suggestion: string;
    confidence: number;
    /**
     * Campaign-3 (fix/answer-policy-engine, 2026-07-19, founder §2.6):
     * Visible source label for the answer. One of:
     *   "From: Resume" | "From: Job description" | "From: Reference files" |
     *   "Mixed: Resume + Job description" | "Mixed: ..." | "General knowledge" |
     *   "Not in your reference files — from general knowledge:"
     * When absent, the renderer falls back to "General knowledge" so legacy
     * emitters that don't carry the label still display something sensible.
     */
    sourceLabel?: string;
}

/**
 * Natively-style suggestion overlay component
 * Displays real-time transcripts and AI-generated suggestions
 */
export const SuggestionOverlay: React.FC<SuggestionOverlayProps> = ({ className }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState<Transcript | null>(null);
    const [suggestion, setSuggestion] = useState<GeneratedSuggestion | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Subscribe to native audio events
        const cleanups: (() => void)[] = [];

        // Connection status
        cleanups.push(
            window.electronAPI.onNativeAudioConnected(() => {
                setIsConnected(true);
                console.log('[SuggestionOverlay] Native audio connected');
            })
        );

        cleanups.push(
            window.electronAPI.onNativeAudioDisconnected(() => {
                setIsConnected(false);
                console.log('[SuggestionOverlay] Native audio disconnected');
            })
        );

        // Real-time transcripts
        cleanups.push(
            window.electronAPI.onNativeAudioTranscript((transcript) => {
                setCurrentTranscript(transcript);
                // Clear after a delay if it's a final transcript
                if (transcript.final) {
                    setTimeout(() => setCurrentTranscript(null), 3000);
                }
            })
        );

        // Processing status
        cleanups.push(
            window.electronAPI.onSuggestionProcessingStart(() => {
                setIsProcessing(true);
                setError(null);
            })
        );

        // Generated suggestions
        cleanups.push(
            window.electronAPI.onSuggestionGenerated((data) => {
                setSuggestion(data);
                setIsProcessing(false);
            })
        );

        // Errors
        cleanups.push(
            window.electronAPI.onSuggestionError((err) => {
                setError(err.error);
                setIsProcessing(false);
            })
        );

        return () => {
            cleanups.forEach(cleanup => cleanup());
        };
    }, []);

    // Don't render if not connected
    if (!isConnected && !suggestion && !currentTranscript) {
        return null;
    }

    return (
        <div className={`suggestion-overlay ${className || ''}`}>
            {/* Connection indicator */}
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-gray-400">
                    {isConnected ? 'Live' : 'Disconnected'}
                </span>
            </div>

            {/* Current transcript (interviewer's speech) */}
            {currentTranscript && (
                <div className="transcript-bubble mb-3 p-3 rounded-lg bg-gray-800/80 backdrop-blur-sm border border-gray-700">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-blue-400">
                            {currentTranscript.speaker === 'interviewer' ? '🎤 Interviewer' : '👤 You'}
                        </span>
                        {!currentTranscript.final && (
                            <span className="text-xs text-gray-500 animate-pulse">listening...</span>
                        )}
                    </div>
                    <p className="text-sm text-gray-200">{currentTranscript.text}</p>
                </div>
            )}

            {/* Processing indicator */}
            {isProcessing && (
                <div className="processing-indicator flex items-center gap-2 p-3 rounded-lg bg-purple-900/30 border border-purple-700">
                    <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-purple-300">Generating suggestion...</span>
                </div>
            )}

            {/* AI Suggestion */}
            {suggestion && !isProcessing && (
                <div className="suggestion-card p-4 rounded-lg bg-gradient-to-br from-indigo-900/80 to-purple-900/80 backdrop-blur-sm border border-indigo-500/50 shadow-lg shadow-indigo-500/20">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-indigo-300">💡 Suggested Response</span>
                        <span className="text-xs text-gray-400">
                            {Math.round(suggestion.confidence * 100)}% confidence
                        </span>
                    </div>
                    <p className="text-sm text-gray-100 leading-relaxed">{suggestion.suggestion}</p>
                    {/* Campaign-3 (fix/answer-policy-engine, 2026-07-19, founder §2.6):
                        Source badge. Renders under the suggestion text in a small
                        pill; falls back to "General knowledge" when the emitter
                        doesn't carry sourceLabel (backward-compatible with legacy
                        emitters). */}
                    <div className="mt-2 flex items-center gap-2">
                        <span
                            className="inline-block px-2 py-0.5 text-[10px] font-medium rounded-full bg-indigo-700/40 text-indigo-200 border border-indigo-500/40"
                            data-source-label={suggestion.sourceLabel ?? 'General knowledge'}
                        >
                            {suggestion.sourceLabel ?? 'General knowledge'}
                        </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-indigo-700/50">
                        <p className="text-xs text-gray-400 italic">
                            Re: "{suggestion.question.substring(0, 50)}..."
                        </p>
                    </div>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="error-card p-3 rounded-lg bg-red-900/30 border border-red-700">
                    <span className="text-sm text-red-300">⚠️ {error}</span>
                </div>
            )}

            {/* Instructions */}
            <div className="mt-3 text-xs text-gray-500 text-center">
                <p>Say "rephrase that" or "make it shorter" for follow-ups</p>
            </div>
        </div>
    );
};

export default SuggestionOverlay;
