import React, { useState } from 'react';
import type { SttErrorCategory } from '../../lib/sttErrorMapper';

interface ChannelCardProps {
    /** Channel name displayed in header */
    name: string;
    /** Channel status */
    status: 'connected' | 'reconnecting' | 'failed';
    /** STT provider name (e.g. 'google', 'openai', 'deepgram') */
    provider?: string;
    /** Raw error string */
    error?: string;
    /** Categorized error info (title + body) */
    errorCategory?: SttErrorCategory | null;
    /** SVG icon for each status */
    iconConnected: React.ReactNode;
    iconReconnecting: React.ReactNode;
    iconFailed: React.ReactNode;
}

/** Human-readable provider label */
const providerLabel = (provider?: string): string => {
    if (!provider || provider === 'none') return '';
    const labels: Record<string, string> = {
        google: 'Google',
        groq: 'Groq',
        openai: 'OpenAI',
        deepgram: 'Deepgram',
        elevenlabs: 'ElevenLabs',
        azure: 'Azure',
        ibmwatson: 'IBM Watson',
        soniox: 'Soniox',
        natively: 'Natively Pro',
    };
    return labels[provider.toLowerCase()] || provider;
};

const ChannelCard: React.FC<ChannelCardProps> = ({
    name, status, provider, error, errorCategory,
    iconConnected, iconReconnecting, iconFailed,
}) => {
    const [copied, setCopied] = useState(false);

    const cleanedError = error?.replace(/\s*\(\d+ consecutive errors\):?/gi, '');

    const handleCopy = () => {
        if (cleanedError) {
            navigator.clipboard.writeText(cleanedError);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const icon = status === 'failed' ? iconFailed : status === 'reconnecting' ? iconReconnecting : iconConnected;

    const statusLabel = status === 'connected' ? 'Operational' : status === 'reconnecting' ? 'Reconnecting...' : 'Error';
    const label = providerLabel(provider);

    return (
        <div className={`relative rounded-xl transition-all duration-300 ${
            status === 'failed'
                ? 'bg-gradient-to-br from-red-500/8 to-red-500/3 border border-red-500/15'
                : status === 'reconnecting'
                    ? 'bg-gradient-to-br from-amber-500/8 to-amber-500/3 border border-amber-500/15'
                    : 'bg-gradient-to-br from-sky-500/4 to-sky-500/2 border border-sky-500/10'
        }`}>
            {/* Status indicator line */}
            <div className={`absolute top-0 left-3 right-3 h-px ${
                status === 'failed' ? 'bg-gradient-to-r from-red-500/40 to-transparent' :
                status === 'reconnecting' ? 'bg-gradient-to-r from-amber-500/40 to-transparent' :
                'bg-gradient-to-r from-sky-500/40 to-transparent'
            }`} />

            <div className="p-3.5 space-y-2.5">
                {/* Header */}
                <div className="flex items-center gap-2">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${
                        status === 'failed' ? 'bg-red-500/15' :
                        status === 'reconnecting' ? 'bg-amber-500/15' :
                        'bg-sky-500/10'
                    }`}>
                        <div className={`w-4 h-4 ${
                            status === 'failed' ? 'text-red-400' :
                            status === 'reconnecting' ? 'text-amber-400 animate-spin' :
                            'text-sky-400'
                        }`}>
                            {icon}
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-semibold ${
                            status === 'failed' ? 'text-red-400/90' :
                            status === 'reconnecting' ? 'text-amber-400/90' :
                            'overlay-text-primary'
                        }`}>
                            {name}
                        </p>
                        <p className="text-[10px] overlay-text-muted truncate">
                            {statusLabel}
                        </p>
                        {label && (
                            <p className="text-[9px] overlay-text-muted opacity-60 mt-0.5">
                                via {label}
                            </p>
                        )}
                    </div>
                </div>

                {/* Error details */}
                {status === 'failed' && errorCategory && (
                    <div className="space-y-1">
                        <p className="text-[12px] font-medium overlay-text-primary leading-snug">
                            {errorCategory.title}
                        </p>
                        <p className="text-[10.5px] leading-relaxed overlay-text-secondary">
                            {errorCategory.body}
                        </p>
                    </div>
                )}

                {/* Tech details */}
                {error && (
                    <div className="pt-1.5 border-t border-white/5">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] font-medium tracking-wide overlay-text-muted opacity-60">
                                Details
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopy();
                                }}
                                className="p-1 rounded transition-all opacity-60 hover:opacity-100"
                            >
                                <svg className="w-3 h-3 overlay-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                            </button>
                        </div>
                        <code className="block text-[10px] font-mono leading-relaxed overlay-text-secondary bg-black/20 rounded-lg px-2 py-1.5 break-words overflow-wrap-anywhere max-h-12 overflow-y-auto scrollbar-none">
                            {cleanedError}
                        </code>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChannelCard;
