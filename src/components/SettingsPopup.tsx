import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Link, Camera, Zap, Heart } from 'lucide-react';

const SettingsPopup = () => {
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [useGeminiPro, setUseGeminiPro] = useState(() => {
        return localStorage.getItem('natively_model_preference') === 'pro';
    });

    const isFirstRender = React.useRef(true);
    const isFirstUndetectableRender = React.useRef(true);

    // Sync with global state changes
    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Skip initial render if needed, or just allow it to sync once.
        // We need to differentiate between "user toggled here" and "state came from backend"
        // But since we are setting state via API, and API broadcasts back, we might get loops?
        // Actually, if we set state to X, backend broadcasts X. Frontend receives X.
        // If frontend state is already X, no re-render. So safe.

        if (isFirstUndetectableRender.current) {
            isFirstUndetectableRender.current = false;
            return;
        }

        localStorage.setItem('natively_undetectable', String(isUndetectable));
        if (window.electronAPI && window.electronAPI.setUndetectable) {
            window.electronAPI.setUndetectable(isUndetectable);
        }
    }, [isUndetectable]);

    useEffect(() => {
        // Skip initial render to avoid unnecessary IPC calls
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        // Apply model preference
        const modelType = useGeminiPro ? 'pro' : 'flash';
        localStorage.setItem('natively_model_preference', modelType);
        try {
            // @ts-ignore - electronAPI not typed in this file yet
            window.electronAPI?.invoke('set-model-preference', modelType);
        } catch (e) {
            console.error(e);
        }
    }, [useGeminiPro]);

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

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className="w-[200px] bg-[#1E1E1E]/80 backdrop-blur-md border border-white/10 rounded-[16px] overflow-hidden shadow-2xl shadow-black/40 px-2 pt-2 pb-2 flex flex-col animate-scale-in origin-top-left justify-between">

                {/* Undetectability */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors duration-200 group cursor-default">
                    <div className="flex items-center gap-3">
                        <CustomGhost
                            className={`w-4 h-4 transition-colors ${isUndetectable ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? "black" : "white"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${isUndetectable ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => setIsUndetectable(!isUndetectable)}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${isUndetectable ? 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]' : 'bg-white/10'}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full bg-black shadow-sm transition-transform duration-300 ease-spring ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>


                {/* Gemini 3 Pro Toggle */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors duration-200 group cursor-default">
                    <div className="flex items-center gap-3">
                        <Zap
                            className="w-4 h-4 text-yellow-500 group-hover:text-yellow-400 transition-colors"
                            fill={useGeminiPro ? "currentColor" : "none"}
                        />
                        <span className="text-[12px] text-slate-400 group-hover:text-slate-200 font-medium transition-colors">Gemini 3 Pro</span>
                    </div>
                    <button
                        onClick={() => setUseGeminiPro(!useGeminiPro)}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${useGeminiPro ? 'bg-yellow-500 shadow-[0_2px_10px_rgba(234,179,8,0.3)]' : 'bg-white/10'}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full bg-black shadow-sm transition-transform duration-300 ease-spring ${useGeminiPro ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Interviewer Transcript Toggle */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors duration-200 group cursor-default">
                    <div className="flex items-center gap-3">
                        <MessageSquare
                            className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'}`}
                            fill={showTranscript ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${showTranscript ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>Transcript</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !showTranscript;
                            setShowTranscript(newState);
                            localStorage.setItem('natively_interviewer_transcript', String(newState));
                            // Dispatch event for same-window listeners
                            window.dispatchEvent(new Event('storage'));
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${showTranscript ? 'bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : 'bg-white/10'}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full bg-black shadow-sm transition-transform duration-300 ease-spring ${showTranscript ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                <div className="h-px bg-white/[0.04] my-0.5 mx-2" />

                {/* Show/Hide Natively */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors duration-200 group cursor-pointer interaction-base interaction-press">
                    <div className="flex items-center gap-3">
                        <MessageSquare className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        <span className="text-[12px] text-slate-400 group-hover:text-slate-200 transition-colors">Show/Hide</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-medium">⌘</div>
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-medium">B</div>
                    </div>
                </div>

                {/* Screenshot */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors duration-200 group cursor-pointer interaction-base interaction-press">
                    <div className="flex items-center gap-3">
                        <Camera className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        <span className="text-[12px] text-slate-400 group-hover:text-slate-200 transition-colors">Screenshot</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-medium">⌘</div>
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-medium">H</div>
                    </div>
                </div>

                <div className="h-px bg-white/[0.04] my-0.5 mx-2" />

                {/* Donate */}
                <div
                    // @ts-ignore
                    onClick={() => window.electronAPI.openExternal('https://buymeacoffee.com/evinjohnn')}
                    className="flex items-center justify-between px-3 py-2 hover:bg-pink-500/10 rounded-lg transition-colors duration-200 group cursor-pointer interaction-base interaction-press"
                >
                    <div className="flex items-center gap-3">
                        <Heart className="w-3.5 h-3.5 text-pink-400 group-hover:fill-pink-400 transition-all duration-300" />
                        <span className="text-[12px] text-slate-400 group-hover:text-pink-100 transition-colors">Donate</span>
                    </div>
                    <div className="opacity-60 group-hover:opacity-100 transition-opacity">
                        <Link className="w-3 h-3 text-slate-500 group-hover:text-pink-400" />
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
