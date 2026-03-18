import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Link, Camera, Zap, Heart, User } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

const SettingsPopup = () => {
    const { shortcuts } = useShortcuts();
    const isLightTheme = useResolvedTheme() === 'light';
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [useGroqFastText, setUseGroqFastText] = useState(() => {
        return localStorage.getItem('natively_groq_fast_text') === 'true';
    });
    const [profileMode, setProfileMode] = useState(false);
    const [hasProfile, setHasProfile] = useState(false);
    const [isPremium, setIsPremium] = useState(false);

    const isFirstRender = React.useRef(true);

    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});

    // Load credentials func
    const loadCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            if (creds) {
                setHasStoredKey({
                    gemini: creds.hasGeminiKey,
                    groq: creds.hasGroqKey,
                    openai: creds.hasOpenaiKey,
                    claude: creds.hasClaudeKey
                });
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    };

    // Load Initial Data and refresh on focus
    useEffect(() => {
        loadCredentials();
        const handleFocus = () => loadCredentials();
        window.addEventListener('focus', handleFocus);

        // Load profile status
        const loadProfile = async () => {
            try {
                // @ts-ignore
                const status = await window.electronAPI?.profileGetStatus?.();
                if (status) {
                    setHasProfile(status.hasProfile);
                    setProfileMode(status.profileMode);
                }
                // Check premium status
                const premium = await window.electronAPI?.licenseCheckPremium?.();
                setIsPremium(!!premium);
            } catch (e) { console.warn('[SettingsPopup] Failed to load profile/premium status:', e); }

        };
        loadProfile();

        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    // Fetch initial undetectable state from main process (source of truth)
    useEffect(() => {
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((state: boolean) => {
                setIsUndetectable(state);
            });
        }
    }, []);

    // One-way listener: receive state changes from main process, never echo back
    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
                localStorage.setItem('natively_undetectable', String(newState));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setUseGroqFastText(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Skip initial render to avoid unnecessary IPC calls
        if (isFirstRender.current) {
            isFirstRender.current = false;
            // Ensure backend is synced on mount (even if no change)
            try {
                // @ts-ignore
                window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Apply Groq Text Mode
        localStorage.setItem('natively_groq_fast_text', String(useGroqFastText));
        try {
            // @ts-ignore - electronAPI not typed in this file yet
            window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
        } catch (e) {
            console.error(e);
        }
    }, [useGroqFastText]);

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false'; // Default to true if not set
    });

    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('natively_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                // Send exact dimensions to Electron
                try {
                    // @ts-ignore
                    window.electronAPI?.updateContentDimensions({
                        width: Math.ceil(rect.width),
                        height: Math.ceil(rect.height)
                    });
                } catch (e) {
                    console.warn("Failed to update dimensions", e);
                }
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    const popupPanelClass = isLightTheme
        ? 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10'
        : 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40';
    const itemHoverClass = isLightTheme ? 'hover:bg-black/[0.04]' : 'hover:bg-white/5';
    const labelInactiveClass = isLightTheme ? 'text-slate-700 group-hover:text-slate-900' : 'text-slate-400 group-hover:text-slate-200';
    const iconInactiveClass = isLightTheme ? 'text-slate-500 group-hover:text-slate-700' : 'text-slate-500 group-hover:text-slate-300';
    const dividerClass = isLightTheme ? 'bg-black/[0.06]' : 'bg-white/[0.04]';
    const shortcutKeyClass = isLightTheme
        ? 'border-black/10 bg-black/[0.04] text-slate-600'
        : 'border-white/10 bg-white/5 text-slate-500';
    const defaultToggleTrackClass = isLightTheme ? 'bg-black/10' : 'bg-white/10';
    const toggleKnobClass = isLightTheme ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]' : 'bg-black shadow-sm';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className={`w-[200px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl px-2 pt-2 pb-2 flex flex-col animate-scale-in origin-top-left justify-between ${popupPanelClass}`}>

                {/* Undetectability */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <CustomGhost
                            className={`w-4 h-4 transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-900' : 'text-white') : iconInactiveClass}`}
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? (isLightTheme ? "white" : "black") : (isLightTheme ? "#334155" : "white")}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !isUndetectable;
                            setIsUndetectable(newState);
                            localStorage.setItem('natively_undetectable', String(newState));
                            window.electronAPI?.setUndetectable(newState);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${isUndetectable
                            ? (isLightTheme ? 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]' : 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]')
                            : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>


                {/* Groq (Fast Text) Toggle */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${hasStoredKey.groq === false ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} cursor-default`}`} title={hasStoredKey.groq === false ? "Requires Groq API Key to be configured in Settings" : ""}>
                    <div className="flex items-center gap-3">
                        <Zap
                            className={`w-4 h-4 transition-colors ${useGroqFastText ? 'text-orange-500' : iconInactiveClass}`}
                            fill={useGroqFastText ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${useGroqFastText ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Fast Response</span>
                    </div>
                    <button
                        onClick={() => {
                            if (hasStoredKey.groq === false) return; // Prevent clicking
                            setUseGroqFastText(!useGroqFastText);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${useGroqFastText ? 'bg-orange-500 shadow-[0_2px_10px_rgba(249,115,22,0.3)]' : defaultToggleTrackClass}`}
                        disabled={hasStoredKey.groq === false}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${useGroqFastText ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Interviewer Transcript Toggle */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <MessageSquare
                            className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-emerald-400' : iconInactiveClass}`}
                            fill={showTranscript ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${showTranscript ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Transcript</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !showTranscript;
                            setShowTranscript(newState);
                            localStorage.setItem('natively_interviewer_transcript', String(newState));
                            // Dispatch event for same-window listeners
                            window.dispatchEvent(new Event('storage'));
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${showTranscript ? 'bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${showTranscript ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Profile Mode Toggle */}
                {hasProfile && (
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${!isPremium ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} cursor-default`}`} title={!isPremium ? 'Requires Pro license to be active' : ''}>
                        <div className="flex items-center gap-3">
                            <User
                                className={`w-3.5 h-3.5 transition-colors ${profileMode && isPremium ? 'text-accent-primary' : iconInactiveClass}`}
                                fill={profileMode && isPremium ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${profileMode && isPremium ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Profile Mode</span>
                        </div>
                        <button
                            onClick={async () => {
                                if (!isPremium) return;
                                const newState = !profileMode;
                                setProfileMode(newState);
                                try {
                                    // @ts-ignore
                                    await window.electronAPI?.profileSetMode?.(newState);
                                } catch (e) { console.error(e); }
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${profileMode && isPremium ? 'bg-accent-primary shadow-[0_2px_10px_rgba(var(--color-accent-primary),0.3)]' : defaultToggleTrackClass}`}
                            disabled={!isPremium}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${profileMode && isPremium ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>
                )}

                <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                {/* Show/Hide Natively */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <MessageSquare className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                        <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Show/Hide</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Dynamic Keys for Toggle Visibility */}
                        {(shortcuts.toggleVisibility || ['⌘', 'B']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Screenshot */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <Camera className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                        <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Screenshot</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Dynamic Keys for Take Screenshot */}
                        {(shortcuts.takeScreenshot || ['⌘', 'H']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                {/* Donate */}
                <div
                    // @ts-ignore
                    onClick={() => window.electronAPI.openExternal('https://buymeacoffee.com/evinjohnn')}
                    className="flex items-center justify-between px-3 py-2 hover:bg-pink-500/10 rounded-lg transition-colors duration-200 group interaction-base interaction-press"
                >
                    <div className="flex items-center gap-3">
                        <Heart className="w-3.5 h-3.5 text-pink-400 group-hover:fill-pink-400 transition-all duration-300" />
                        <span className={`text-[12px] transition-colors ${isLightTheme ? 'text-slate-700 group-hover:text-pink-700' : 'text-slate-400 group-hover:text-pink-100'}`}>Donate</span>
                    </div>
                    <div className="opacity-60 group-hover:opacity-100 transition-opacity">
                        <Link className={`w-3 h-3 group-hover:text-pink-400 ${isLightTheme ? 'text-slate-600' : 'text-slate-500'}`} />
                    </div>
                </div>

            </div>
        </div>
    );
};

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: { className?: string, fill?: string, stroke?: string, eyeColor?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);

export default SettingsPopup;
