import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Camera, Zap, User } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getModifierSymbol } from '../utils/platformUtils';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';

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
    const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
        return getMeetingInterfaceTheme();
    });

    // Load credentials func
    const loadCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            if (creds) {
                setHasStoredKey({
                    gemini: !!creds.hasGeminiKey,
                    groq: !!creds.hasGroqKey,
                    openai: !!creds.hasOpenaiKey,
                    claude: !!creds.hasClaudeKey,
                    deepseek: !!creds.hasDeepseekKey,
                    natively: !!creds.hasNativelyKey
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

    // Sync meeting interface theme from localStorage and main process
    useEffect(() => {
        const handleStorage = () => {
            setInterfaceTheme(getMeetingInterfaceTheme());
        };
        window.addEventListener('storage', handleStorage);
        // @ts-ignore
        const unsubscribe = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme: string) => {
            const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
            if (valid.includes(theme as MeetingInterfaceTheme)) {
                setInterfaceTheme(theme as MeetingInterfaceTheme);
            }
        });
        return () => {
            window.removeEventListener('storage', handleStorage);
            unsubscribe?.();
        };
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

    const [actionButtonMode, setActionButtonModeState] = useState<'recap' | 'brainstorm'>('recap');

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

    // Load action button mode and subscribe to changes from other windows
    useEffect(() => {
        // @ts-ignore
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode ?? 'recap');
        }).catch(() => {});
        // @ts-ignore
        if (!window.electronAPI?.onActionButtonModeChanged) return;
        // @ts-ignore
        const unsubscribe = window.electronAPI.onActionButtonModeChanged((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode);
        });
        return () => unsubscribe();
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

    // Determine if the background is dark (glass themes are always dark glass)
    const isDarkBg = interfaceTheme === 'liquid-glass' || interfaceTheme === 'modern' || !isLightTheme;

    const popupPanelClass = isDarkBg
        ? 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40'
        : 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10';
    const itemHoverClass = isDarkBg ? 'hover:bg-white/5' : 'hover:bg-black/[0.04]';
    const glassRowClass = 'glass-popup-row';
    const labelColorClass = isDarkBg ? 'text-white' : 'text-slate-900';
    const inactiveIconColorClass = isDarkBg
        ? 'text-white/60 group-hover:text-white/90'
        : 'text-slate-500 group-hover:text-slate-800';
    const dividerClass = isDarkBg ? 'bg-white/[0.04]' : 'bg-black/[0.06]';
    const shortcutKeyClass = isDarkBg
        ? 'border-white/10 bg-white/5 text-slate-400 glass-shortcut-key'
        : 'border-black/10 bg-black/[0.04] text-slate-600 glass-shortcut-key';
    const defaultToggleTrackClass = isDarkBg ? 'bg-white/10 glass-toggle-track' : 'bg-black/[0.22] glass-toggle-track';
    const toggleKnobClass = isDarkBg ? 'bg-black shadow-sm' : 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className={`w-[180px] backdrop-blur-md border rounded-[14px] overflow-hidden shadow-2xl p-1.5 flex flex-col animate-scale-in origin-top-left overlay-shell-surface ${popupPanelClass}`}>
                <div className="relative z-[1] flex flex-col">

                {/* Undetectability */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group cursor-default ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <CustomGhost
                            className={`w-4 h-4 transition-colors ${isUndetectable ? (isDarkBg ? 'text-white' : 'text-slate-900') : inactiveIconColorClass}`}
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? (isDarkBg ? "black" : "white") : (isDarkBg ? "white" : "#334155")}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !isUndetectable;
                            setIsUndetectable(newState);
                            localStorage.setItem('natively_undetectable', String(newState));
                            window.electronAPI?.setUndetectable(newState);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${isUndetectable
                            ? (isDarkBg ? 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]' : 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]')
                            : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>


                {/* Groq (Fast Text) Toggle — enabled with Groq key OR Natively API key */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group ${!(hasStoredKey.groq || hasStoredKey.natively) ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} ${glassRowClass} cursor-default`}`} title={!(hasStoredKey.groq || hasStoredKey.natively) ? "Requires Groq or Natively API key" : ""}>
                    <div className="flex items-center gap-2.5">
                        <Zap
                            className={`w-4 h-4 transition-colors ${useGroqFastText ? 'text-orange-500' : inactiveIconColorClass}`}
                            fill={useGroqFastText ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Fast Response</span>
                    </div>
                    <button
                        onClick={() => {
                            if (!(hasStoredKey.groq || hasStoredKey.natively)) return;
                            setUseGroqFastText(!useGroqFastText);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${useGroqFastText ? 'bg-orange-500 shadow-[0_2px_10px_rgba(249,115,22,0.3)]' : defaultToggleTrackClass}`}
                        disabled={!(hasStoredKey.groq || hasStoredKey.natively)}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${useGroqFastText ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Interviewer Transcript Toggle */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group cursor-default ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <MessageSquare
                            className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-emerald-400' : inactiveIconColorClass}`}
                            fill={showTranscript ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Transcript</span>
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

                {/* Interview Mode (Brainstorm) Toggle */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group cursor-default ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`w-3.5 h-3.5 transition-colors ${actionButtonMode === 'brainstorm' ? 'text-violet-400' : inactiveIconColorClass}`}
                        >
                            <line x1="6" y1="3" x2="6" y2="15" />
                            <circle cx="18" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Interview Mode</span>
                    </div>
                    <button
                        onClick={async () => {
                            const newMode: 'recap' | 'brainstorm' = actionButtonMode === 'brainstorm' ? 'recap' : 'brainstorm';
                            setActionButtonModeState(newMode);
                            try {
                                // @ts-ignore
                                await window.electronAPI?.setActionButtonMode?.(newMode);
                            } catch (e) { console.error(e); }
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${actionButtonMode === 'brainstorm' ? 'bg-violet-500 shadow-[0_2px_10px_rgba(139,92,246,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${actionButtonMode === 'brainstorm' ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Profile Mode Toggle */}
                {hasProfile && (
                    <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group ${!isPremium ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} ${glassRowClass} cursor-default`}`} title={!isPremium ? 'Requires Pro license to be active' : ''}>
                        <div className="flex items-center gap-2.5">
                            <User
                                className={`w-3.5 h-3.5 transition-colors ${profileMode && isPremium ? 'text-accent-primary' : inactiveIconColorClass}`}
                                fill={profileMode && isPremium ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Profile Mode</span>
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

                <div className={`h-px my-0.5 mx-1.5 ${dividerClass}`} />

                {/* Show/Hide Natively */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <MessageSquare className={`w-3.5 h-3.5 transition-colors ${inactiveIconColorClass}`} />
                        <span className={`text-[12px] transition-colors ${labelColorClass}`}>Show/Hide</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Dynamic Keys for Toggle Visibility */}
                        {(shortcuts.toggleVisibility || [getModifierSymbol('cmd'), 'B']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Screenshot */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <Camera className={`w-3.5 h-3.5 transition-colors ${inactiveIconColorClass}`} />
                        <span className={`text-[12px] transition-colors ${labelColorClass}`}>Screenshot</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Dynamic Keys for Take Screenshot */}
                        {(shortcuts.takeScreenshot || [getModifierSymbol('cmd'), 'H']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                </div>
            </div>
        </div>
    );
};

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: CustomGhostProps) => (
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
