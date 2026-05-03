import React, { useState, useEffect, useMemo } from 'react';
import packageJson from '../../package.json';
import {
    X, Mic, Speaker, Monitor, Keyboard, User, LifeBuoy, LogOut, Upload,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    Camera, RotateCcw, Eye, Layout, MessageSquare, Crop,
    ChevronDown, ChevronUp, Check, BadgeCheck, Power, Palette, Calendar, Ghost, Sun, Moon, RefreshCw, Info, Globe, FlaskConical, Terminal, Settings, Activity, ExternalLink, Trash2,
    Sparkles, Pencil, Briefcase, Building2, Search, MapPin, CheckCircle, HelpCircle, Zap, SlidersHorizontal, PointerOff,
    Star, AlertCircle, Gift, Smartphone
} from 'lucide-react';
import { analytics } from '../lib/analytics/analytics.service';
import { AboutSection } from './AboutSection';
import { HelpSettings } from './settings/HelpSettings';
import { AIProvidersSettings } from './settings/AIProvidersSettings';
import { NativelyApiSettings } from './settings/NativelyApiSettings';
import { NativelyProSettings } from './settings/NativelyProSettings';
import { PhoneMirrorSettings } from './settings/PhoneMirrorSettings';
import { NativelyLogoMark } from './NativelyLogoMark';
import { motion, AnimatePresence } from 'framer-motion';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import {
    clampOverlayOpacity,
    getOverlayAppearance,
    OVERLAY_OPACITY_DEFAULT,
    OVERLAY_OPACITY_MIN,
    getDefaultOverlayOpacity,
} from '../lib/overlayAppearance';
import { KeyRecorder } from './ui/KeyRecorder';
import { ProfileVisualizer, PremiumUpgradeModal } from '../premium';
import icon from './icon.png';

// ---------------------------------------------------------------------------
// StarRating — renders filled/empty stars for culture ratings


// ---------------------------------------------------------------------------
// MockupNativelyInterface — fake in-meeting widget for the opacity preview
// ---------------------------------------------------------------------------
const MockupNativelyInterface = ({ opacity }: { opacity: number }) => {
    const resolvedTheme = useResolvedTheme();
    const appearance = useMemo(
        () => getOverlayAppearance(opacity, resolvedTheme),
        [opacity, resolvedTheme]
    );

    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none bg-transparent">
                {/* NativelyInterface Widget — opacity controlled by the slider */}
                <div
                    id="mockup-natively-interface"
                    className="flex flex-col items-center pointer-events-none -mt-56"
                >
                    {/* TopPill Replica */}
                    <div className="flex justify-center mb-2 select-none z-50">
                        <div className="flex items-center gap-2 rounded-full overlay-pill-surface backdrop-blur-md pl-1.5 pr-1.5 py-1.5" style={appearance.pillStyle}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden overlay-icon-surface" style={appearance.iconStyle}>
                                <img
                                    src={icon}
                                    alt="Natively"
                                    className="w-[24px] h-[24px] object-contain opacity-95 scale-105 force-black-icon"
                                    draggable="false"
                                />
                            </div>
                            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-medium border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                                <span className="opacity-80 tracking-wide">Hide</span>
                            </div>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center overlay-icon-surface overlay-text-primary" style={appearance.iconStyle}>
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-red-400 opacity-80" />
                            </div>
                        </div>
                    </div>

                    {/* Main Interface Window Replica */}
                    <div className="relative w-[600px] max-w-full overlay-shell-surface overlay-text-primary backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col pt-2 pb-3" style={appearance.shellStyle}>

                        {/* Rolling Transcript Bar */}
                        <div className="w-full flex justify-center py-2 px-4 border-b mb-1 overlay-transcript-surface" style={appearance.transcriptStyle}>
                            <p className="text-[13px] truncate max-w-[90%] font-medium overlay-text-primary">
                                <span className={`${resolvedTheme === 'light' ? 'text-blue-700' : 'text-blue-400'} mr-2 font-semibold`}>Interviewer</span>
                                <span className="opacity-95">So how would you optimize the current algorithm?</span>
                            </p>
                        </div>

                        {/* Chat History Mock */}
                        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                            <div className="flex justify-start">
                                <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal overlay-text-primary">
                                    <span className="font-semibold text-emerald-500 block mb-1">Suggestion</span>
                                    A good approach would be to use a hash map to cache the intermediate results, which brings the time complexity down from O(n²) to O(n).
                                </div>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <MessageSquare className="w-3 h-3 opacity-70" /> Clarify
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <RefreshCw className="w-3 h-3 opacity-70" /> Recap
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question
                            </div>
                            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium min-w-[74px] shrink-0 border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <Zap className="w-3 h-3 opacity-70" /> Answer
                            </div>
                        </div>

                        {/* Input Area */}
                        <div className="px-3">
                            <div className="relative group">
                                <div className="w-full border rounded-xl pl-3 pr-10 py-2.5 h-[38px] flex items-center overlay-input-surface" style={appearance.inputStyle}>
                                    <span className="text-[13px] overlay-text-muted">Ask anything on screen or conversation</span>
                                </div>
                            </div>

                            {/* Bottom Row */}
                            <div className="flex items-center justify-between mt-3 px-0.5">
                                <div className="flex items-center gap-1.5">
                                    <div className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium w-[140px] overlay-control-surface overlay-text-interactive" style={appearance.controlStyle}>
                                        <span className="truncate min-w-0 flex-1">Gemini 3 Flash</span>
                                        <ChevronDown size={14} className="shrink-0" />
                                    </div>
                                    <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />
                                    <div className="w-7 h-7 flex items-center justify-center rounded-lg overlay-icon-surface overlay-text-muted" style={appearance.iconStyle}>
                                        <SlidersHorizontal className="w-3.5 h-3.5" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
        </div>
    );
};

interface CustomSelectProps {
    label: string;
    icon: React.ReactNode;
    value: string;
    options: MediaDeviceInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ label, icon, value, options, onChange, placeholder = "Select device" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = options.find(o => o.deviceId === value)?.label || placeholder;

    return (
        <div className="bg-bg-card rounded-xl p-4 border border-border-subtle" ref={containerRef}>
            {label && (
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-text-secondary">{icon}</span>
                    <label className="text-xs font-medium text-text-primary uppercase tracking-wide">{label}</label>
                </div>
            )}

            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
                >
                    <span className="truncate pr-4">{selectedLabel}</span>
                    <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 w-full mt-1 bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto animated fadeIn">
                        <div className="p-1 space-y-0.5">
                            {options.map((device) => (
                                <button
                                    key={device.deviceId}
                                    onClick={() => {
                                        onChange(device.deviceId);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group transition-colors ${value === device.deviceId ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                >
                                    <span className="truncate">{device.label || `Device ${device.deviceId.slice(0, 5)}...`}</span>
                                    {value === device.deviceId && <Check size={14} className="text-accent-primary" />}
                                </button>
                            ))}
                            {options.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-500 italic">No devices found</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface ProviderOption {
    id: string;
    label: string;
    badge?: string | null;
    recommended?: boolean;
    desc: string;
    color: string;
    icon: React.ReactNode;
}

interface ProviderSelectProps {
    value: string;
    options: ProviderOption[];
    onChange: (value: string) => void;
}

const ProviderSelect: React.FC<ProviderSelectProps> = ({ value, options, onChange }) => {
    const isLight = useResolvedTheme() === 'light';
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selected = options.find(o => o.id === value);

    const getBadgeStyle = (color?: string) => {
        switch (color) {
            case 'blue': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'orange': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
            case 'purple': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
            case 'teal': return 'bg-teal-500/10 text-teal-500 border-teal-500/20';
            case 'cyan': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
            case 'indigo': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
            case 'green': return 'bg-green-500/10 text-green-500 border-green-500/20';
            default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
        }
    };

    const getIconStyle = (color?: string, isSelectedItem: boolean = false) => {
        if (isSelectedItem) return 'bg-accent-primary text-white shadow-sm';
        // For unselected items in list or trigger
        switch (color) {
            case 'blue': return 'bg-blue-500/10 text-blue-600';
            case 'orange': return 'bg-orange-500/10 text-orange-600';
            case 'purple': return 'bg-purple-500/10 text-purple-600';
            case 'teal': return 'bg-teal-500/10 text-teal-600';
            case 'cyan': return 'bg-cyan-500/10 text-cyan-600';
            case 'indigo': return 'bg-indigo-500/10 text-indigo-600';
            case 'green': return 'bg-green-500/10 text-green-600';
            default: return 'bg-gray-500/10 text-gray-600';
        }
    };

    return (
        <div ref={containerRef} className="relative z-20 font-sans">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full group bg-bg-input border border-border-subtle hover:border-border-muted shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-all duration-200 outline-none focus:ring-2 focus:ring-accent-primary/20 ${isOpen ? 'ring-2 ring-accent-primary/20 border-accent-primary/50' : 'hover:shadow-md'}`}
            >
                {selected ? (
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 ${getIconStyle(selected.color)}`}>
                            {selected.icon}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                {selected.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.badge === 'Saved' ? 'green' : selected.color)}`}>{selected.badge}</span>}
                                {selected.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.color)}`}>Recommended</span>}
                            </div>
                            {/* Short description for trigger */}
                            <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                        </div>
                    </div>
                ) : <span className="text-text-secondary px-2 text-sm">Select Provider</span>}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                    <ChevronDown size={14} strokeWidth={2.5} />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className={`absolute top-full left-0 w-full mt-2 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden ring-1 ring-black/5 ${isLight ? 'bg-bg-elevated border border-border-subtle' : 'bg-bg-elevated/90 border border-white/5'}`}
                    >
                        <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                            {options.map(option => {
                                const isSelected = value === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        onClick={() => { onChange(option.id); setIsOpen(false); }}
                                        className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative ${isSelected ? (isLight ? 'bg-bg-item-active shadow-inner' : 'bg-white/10 shadow-inner') : (isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/5')}`}
                                    >
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-95 group-hover:scale-100'} ${getIconStyle(option.color, false)}`}>
                                            {option.icon}
                                        </div>
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[13px] font-medium transition-colors ${isSelected && !isLight ? 'text-white' : 'text-text-primary'}`}>{option.label}</span>
                                                    {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.badge === 'Saved' ? 'green' : option.color)}`}>{option.badge}</span>}
                                                    {option.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.color)}`}>Recommended</span>}
                                                </div>
                                                {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                            </div>
                                            <span className={`text-[11px] block truncate transition-colors ${isSelected && !isLight ? 'text-white/70' : 'text-text-tertiary'}`}>{option.desc}</span>
                                        </div>
                                        {/* Hover Indicator */}
                                        {!isSelected && <div className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-transparent group-hover:ring-border-subtle pointer-events-none" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: string;
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose, initialTab = 'general' }) => {
    const isLight = useResolvedTheme() === 'light';
    const [activeTab, setActiveTab] = useState(initialTab);
    
    // Sync active tab when modal opens
    useEffect(() => {
        if (isOpen && initialTab) {
            setActiveTab(initialTab);
            
            
        }
    }, [isOpen, initialTab]);
    
    const { shortcuts, updateShortcut, resetShortcuts } = useShortcuts();
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [disguiseMode, setDisguiseMode] = useState<'terminal' | 'settings' | 'activity' | 'none'>('none');
    const [openOnLogin, setOpenOnLogin] = useState(false);
    const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const [isAiLangDropdownOpen, setIsAiLangDropdownOpen] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'uptodate' | 'error'>('idle');
    const themeDropdownRef = React.useRef<HTMLDivElement>(null);
    const aiLangDropdownRef = React.useRef<HTMLDivElement>(null);

    
    const [verboseLogging, setVerboseLogging] = useState(false);
    const [showVerboseToast, setShowVerboseToast] = useState(false);
    const verboseToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Close dropdown when clicking outside
    // Sync with global state changes
    useEffect(() => {
        if (isOpen) {
            
            
            // Fetch true initial state from main process
            window.electronAPI?.getUndetectable?.().then(setIsUndetectable).catch(() => { });
            window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => { });
            window.electronAPI?.getDisguise?.().then(setDisguiseMode).catch(() => { });
            window.electronAPI?.getVerboseLogging?.().then(setVerboseLogging).catch(() => { });
        }
    }, [isOpen]);

    useEffect(() => {
        if (!showVerboseToast) return;
        verboseToastTimerRef.current = setTimeout(() => setShowVerboseToast(false), 5200);
        return () => {
            if (verboseToastTimerRef.current) clearTimeout(verboseToastTimerRef.current);
        };
    }, [showVerboseToast]);

    

    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onDisguiseChanged) {
            const unsubscribe = window.electronAPI.onDisguiseChanged((newMode: any) => {
                setDisguiseMode(newMode);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onOverlayMousePassthroughChanged) {
            const unsubscribe = window.electronAPI.onOverlayMousePassthroughChanged((enabled: boolean) => {
                setIsMousePassthrough(enabled);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onSttLanguageAutoDetected) {
            const unsubscribe = window.electronAPI.onSttLanguageAutoDetected((bcp47: string) => {
                setAutoDetectedLanguage(bcp47);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
                setIsThemeDropdownOpen(false);
            }
            if (aiLangDropdownRef.current && !aiLangDropdownRef.current.contains(event.target as Node)) {
                setIsAiLangDropdownOpen(false);
            }
        };

        if (isThemeDropdownOpen || isAiLangDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isThemeDropdownOpen, isAiLangDropdownOpen]);

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false';
    });

    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('');
    const [selectedSttGroup, setSelectedSttGroup] = useState('');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});
    const [autoDetectedLanguage, setAutoDetectedLanguage] = useState<string | null>(null);

    // AI Response Language
    const [aiResponseLanguage, setAiResponseLanguage] = useState('English');
    const [availableAiLanguages, setAvailableAiLanguages] = useState<any[]>([]);

    // Overlay Opacity state
    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('natively_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        // Treat missing value or the old default (0.65) as "not user-set"
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    // When the theme changes and the user hasn't saved a custom value, reset to theme-aware default
    const resolvedTheme = useResolvedTheme();
    useEffect(() => {
        const stored = localStorage.getItem('natively_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        if (!isUserSet) {
            setOverlayOpacity(getDefaultOverlayOpacity());
        }
    }, [resolvedTheme]);


    // Live preview state — true while the user is holding down the slider
    const [isPreviewingOpacity, setIsPreviewingOpacity] = useState(false);
    const [previewOverlayOpacity, setPreviewOverlayOpacity] = useState(overlayOpacity);

    // Ref to hold the latest opacity value without triggering renders during drag
    const latestOpacityRef = React.useRef(overlayOpacity);

    const handleOpacityChange = (val: number) => {
        // DOM-direct updates for 0-lag 60fps drag (bypasses React reconciliation)
        const percentText = `${Math.round(val * 100)}%`;
        document.querySelectorAll('.opacity-percent-label').forEach(el => el.textContent = percentText);
        setPreviewOverlayOpacity(val);
        latestOpacityRef.current = val;
        
        // Broadcast IPC in real-time so actual meeting overlay tracks slider instantly
        // (safe to do at 60fps, does not trigger React renders)
        window.electronAPI?.setOverlayOpacity?.(val);
    };

    // Bug fix #3: keep latestOpacityRef in sync when overlayOpacity changes outside of a drag
    // (e.g. on first mount, or if another part of code updates it)
    useEffect(() => {
        latestOpacityRef.current = overlayOpacity;
        setPreviewOverlayOpacity(overlayOpacity);
    }, [overlayOpacity]);

    // Bug fix #3 (close-during-drag): if the overlay closes while the user is still dragging,
    // restore all DOM state so nothing is left in a broken state.
    useEffect(() => {
        if (!isOpen && isPreviewingOpacity) {
            stopPreviewingOpacity();
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const startPreviewingOpacity = () => {
        // Bug fix #5: guard against rapid repeated calls (double pointerDown / touch events)
        if (isPreviewingOpacity) return;

        // Direct DOM mutation for sub-millisecond instant hide (bypassing slow React tree diffs)
        document.body.classList.add('disable-transitions');
        
        const backdrop = document.getElementById('settings-backdrop');
        const wrapper = document.getElementById('settings-panel-wrapper');
        const panel = document.getElementById('settings-panel');
        const card = document.getElementById('opacity-slider-card');
        const mockup = document.getElementById('settings-mockup-wrapper');
        const launcher = document.getElementById('launcher-container');

        if (backdrop) {
            backdrop.style.backgroundColor = 'transparent';
            backdrop.style.backdropFilter = 'none';
            backdrop.style.transition = 'none';
        }
        if (wrapper) {
            wrapper.style.backgroundColor = 'transparent';
            wrapper.style.border = 'none';
            wrapper.style.boxShadow = 'none';
        }
        if (panel) {
            panel.style.visibility = 'hidden';
        }
        if (launcher) {
            launcher.style.visibility = 'hidden';
        }
        
        if (card) {
            card.style.visibility = 'visible';
            card.style.position = 'relative';
            card.style.zIndex = '9999';
        }
        if (mockup) {
            mockup.style.opacity = '1';
        }

        setPreviewOverlayOpacity(latestOpacityRef.current);
        setIsPreviewingOpacity(true);
    };

    const stopPreviewingOpacity = () => {
        // Direct DOM restoration
        document.body.classList.remove('disable-transitions');
        const backdrop = document.getElementById('settings-backdrop');
        const wrapper = document.getElementById('settings-panel-wrapper');
        const panel = document.getElementById('settings-panel');
        const card = document.getElementById('opacity-slider-card');
        const mockup = document.getElementById('settings-mockup-wrapper');
        const launcher = document.getElementById('launcher-container');

        if (backdrop) {
            backdrop.style.backgroundColor = '';
            backdrop.style.backdropFilter = '';
            backdrop.style.transition = '';
        }
        if (wrapper) {
            wrapper.style.backgroundColor = '';
            wrapper.style.border = '';
            wrapper.style.boxShadow = '';
        }
        if (panel) {
            panel.style.visibility = '';
        }
        if (launcher) {
            launcher.style.visibility = '';
        }

        if (card) {
            card.style.visibility = '';
            card.style.position = '';
            card.style.zIndex = '';
        }
        if (mockup) {
            // Bug fix #4: restore mockup to hidden (opacity 0) rather than leaving it visible
            mockup.style.opacity = '0';
        }

        setIsPreviewingOpacity(false);
        // Sync final dragged value back to React state (persists to localStorage + IPC via useEffect)
        setOverlayOpacity(latestOpacityRef.current);
        setPreviewOverlayOpacity(latestOpacityRef.current);
    };

    useEffect(() => {
        // Only persist to localStorage here. IPC is handled real-time in handleOpacityChange
        // to avoid a redundant extra call 150ms after every drag ends.
        const timeoutId = setTimeout(() => {
            localStorage.setItem('natively_overlay_opacity', String(overlayOpacity));
        }, 150);
        return () => clearTimeout(timeoutId);
    }, [overlayOpacity]);

    useEffect(() => {
        const loadLanguages = async () => {
            if (window.electronAPI?.getRecognitionLanguages) {
                const langs = await window.electronAPI.getRecognitionLanguages();
                setAvailableLanguages(langs);

                // Load stored preference or auto-detect
                const storedStt = await window.electronAPI.getSttLanguage();
                let currentLangKey = storedStt;

                if (!currentLangKey) {
                    const systemLocale = navigator.language;
                    // Try to find exact match or primary match
                    const match = Object.entries(langs).find(([_, config]: [string, any]) =>
                        config.bcp47 === systemLocale ||
                        config.iso639 === systemLocale ||
                        (config.alternates && config.alternates.includes(systemLocale))
                    );

                    currentLangKey = match ? match[0] : 'english-us';

                    // Save the auto-detected default
                    if (window.electronAPI?.setRecognitionLanguage) {
                        window.electronAPI.setRecognitionLanguage(currentLangKey);
                    }
                }

                setRecognitionLanguage(currentLangKey);

                // Initialize Group based on current language
                if (langs[currentLangKey]) {
                    setSelectedSttGroup(langs[currentLangKey].group);
                } else {
                    setSelectedSttGroup('English');
                }
            }

            if (window.electronAPI?.getAiResponseLanguages) {
                const aiLangs = await window.electronAPI.getAiResponseLanguages();
                // Sort: Auto first, English second, then alphabetical
                const sortedAiLangs = [...aiLangs].sort((a, b) => {
                    if (a.code === 'auto') return -1;
                    if (b.code === 'auto') return 1;
                    if (a.label === 'English') return -1;
                    if (b.label === 'English') return 1;
                    return a.label.localeCompare(b.label);
                });
                setAvailableAiLanguages(sortedAiLangs);

                const storedAi = await window.electronAPI.getAiResponseLanguage();
                setAiResponseLanguage(storedAi || 'auto');
            }
        };
        loadLanguages();
    }, []);

    const handleLanguageChange = async (key: string) => {
        setRecognitionLanguage(key);
        setAutoDetectedLanguage(null);  // always reset — new session may detect a different language
        if (availableLanguages[key]) {
            setSelectedSttGroup(availableLanguages[key].group);
        }
        if (window.electronAPI?.setRecognitionLanguage) {
            await window.electronAPI.setRecognitionLanguage(key);
        }
    };

    const handleGroupChange = (group: string) => {
        setSelectedSttGroup(group);
        // Find default variant for this group (first one)
        const firstVariant = Object.entries(availableLanguages).find(([_, lang]) => lang.group === group);
        if (firstVariant) {
            handleLanguageChange(firstVariant[0]);
        }
    };

    // Helper to get unique groups
    const languageGroups = Array.from(new Set(Object.values(availableLanguages).map((l: any) => l.group)))
        .sort((a, b) => {
            if (a === 'Auto') return -1;
            if (b === 'Auto') return 1;
            if (a === 'English') return -1;
            if (b === 'English') return 1;
            return a.localeCompare(b);
        });

    // Helper to get variants for current group
    const currentGroupVariants = Object.entries(availableLanguages)

        .filter(([_, lang]) => lang.group === selectedSttGroup)
        .map(([key, lang]) => ({
            deviceId: key,
            label: lang.label,
            kind: 'audioinput' as MediaDeviceKind,
            groupId: '',
            toJSON: () => ({})
        }));

    const handleAiLanguageChange = async (key: string) => {
        if (!key) return;
        const previous = aiResponseLanguage;
        setAiResponseLanguage(key); // Optimistic update
        try {
            if (window.electronAPI?.setAiResponseLanguage) {
                const result = await window.electronAPI.setAiResponseLanguage(key);
                if (result && !result.success) {
                    // Rollback on explicit failure
                    setAiResponseLanguage(previous);
                    console.error('[Settings] Failed to set AI response language:', result.error);
                }
            }
        } catch (err) {
            // Rollback on exception
            setAiResponseLanguage(previous);
            console.error('[Settings] Exception setting AI response language:', err);
        }
    };


    // Sync transcript setting
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('natively_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Theme Handlers
    const handleSetTheme = async (mode: 'system' | 'light' | 'dark') => {
        setThemeMode(mode);
        if (window.electronAPI?.setThemeMode) {
            await window.electronAPI.setThemeMode(mode);
        }
    };

    // Audio Settings
    const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
    const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedInput, setSelectedInput] = useState('');
    const [selectedOutput, setSelectedOutput] = useState('');
    const [micLevel, setMicLevel] = useState(0);
    const [useExperimentalSck, setUseExperimentalSck] = useState(false);

    // STT Provider settings
    const [sttProvider, setSttProvider] = useState<'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively'>('none');
    const [groqSttModel, setGroqSttModel] = useState('whisper-large-v3-turbo');
    const [sttGroqKey, setSttGroqKey] = useState('');
    const [sttOpenaiKey, setSttOpenaiKey] = useState('');
    const [sttDeepgramKey, setSttDeepgramKey] = useState('');
    const [sttElevenLabsKey, setSttElevenLabsKey] = useState('');
    const [sttAzureKey, setSttAzureKey] = useState('');
    const [sttAzureRegion, setSttAzureRegion] = useState('eastus');
    const [sttIbmKey, setSttIbmKey] = useState('');
    const [sttTestStatus, setSttTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [sttTestError, setSttTestError] = useState('');
    const [sttSaving, setSttSaving] = useState(false);
    const [sttSaved, setSttSaved] = useState(false);
    const [googleServiceAccountPath, setGoogleServiceAccountPath] = useState<string | null>(null);
    const [hasNativelyKey, setHasNativelyKey] = useState(false);
    const [hasStoredSttGroqKey, setHasStoredSttGroqKey] = useState(false);
    const [hasStoredSttOpenaiKey, setHasStoredSttOpenaiKey] = useState(false);
    const [hasStoredDeepgramKey, setHasStoredDeepgramKey] = useState(false);
    const [hasStoredElevenLabsKey, setHasStoredElevenLabsKey] = useState(false);
    const [hasStoredAzureKey, setHasStoredAzureKey] = useState(false);
    const [hasStoredIbmWatsonKey, setHasStoredIbmWatsonKey] = useState(false);
    const [sttSonioxKey, setSttSonioxKey] = useState('');
    const [hasStoredSonioxKey, setHasStoredSonioxKey] = useState(false);
    const [isSttDropdownOpen, setIsSttDropdownOpen] = useState(false);
    const sttDropdownRef = React.useRef<HTMLDivElement>(null);

    // Close STT dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sttDropdownRef.current && !sttDropdownRef.current.contains(event.target as Node)) {
                setIsSttDropdownOpen(false);
            }
        };
        if (isSttDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isSttDropdownOpen]);

    // Load STT settings on mount
    useEffect(() => {
        const loadSttSettings = async () => {
            try {
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setSttProvider(creds.sttProvider || 'none');
                    if (creds.groqSttModel) setGroqSttModel(creds.groqSttModel);
                    setGoogleServiceAccountPath(creds.googleServiceAccountPath);
                    setHasStoredSttGroqKey(creds.hasSttGroqKey);
                    setHasStoredSttOpenaiKey(creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(creds.hasElevenLabsKey);
                    setHasStoredAzureKey(creds.hasAzureKey);
                    if (creds.azureRegion) setSttAzureRegion(creds.azureRegion);
                    setHasStoredIbmWatsonKey(creds.hasIbmWatsonKey);
                    setHasStoredSonioxKey(creds.hasSonioxKey || false);
                    
                    setHasNativelyKey(creds.hasNativelyKey || false);
                    // Populate key fields so switching providers doesn't make saved keys appear gone
                    if (creds.sttGroqKey) setSttGroqKey(creds.sttGroqKey);
                    if (creds.sttOpenaiKey) setSttOpenaiKey(creds.sttOpenaiKey);
                    if (creds.sttDeepgramKey) setSttDeepgramKey(creds.sttDeepgramKey);
                    if (creds.sttElevenLabsKey) setSttElevenLabsKey(creds.sttElevenLabsKey);
                    if (creds.sttAzureKey) setSttAzureKey(creds.sttAzureKey);
                    if (creds.sttIbmKey) setSttIbmKey(creds.sttIbmKey);
                    if (creds.sttSonioxKey) setSttSonioxKey(creds.sttSonioxKey);
                }
            } catch (e) {
                console.error('Failed to load STT settings:', e);
            }
        };
        if (isOpen) loadSttSettings();
    }, [isOpen]);

    // PR #173: Live-reload settings whenever the backend broadcasts a credentials change
    // (e.g., when the user saves an STT key in a different window, or main fires it after
    // a provider auto-reconfigure like Natively key clear).
    useEffect(() => {
        if (!window.electronAPI?.onCredentialsChanged) return;
        const unsubscribe = window.electronAPI.onCredentialsChanged(() => {
            if (isOpen) {
                // Re-fetch credentials silently — purely additive, no state reset
                window.electronAPI?.getStoredCredentials?.().then((creds: any) => {
                    if (!creds) return;
                    setSttProvider(creds.sttProvider || 'none');
                    if (creds.groqSttModel) setGroqSttModel(creds.groqSttModel);
                    setHasNativelyKey(creds.hasNativelyKey || false);
                    setHasStoredSttGroqKey(creds.hasSttGroqKey);
                    setHasStoredSttOpenaiKey(creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(creds.hasElevenLabsKey);
                    setHasStoredAzureKey(creds.hasAzureKey);
                    setHasStoredIbmWatsonKey(creds.hasIbmWatsonKey);
                    setHasStoredSonioxKey(creds.hasSonioxKey || false);
                }).catch(() => { /* silently ignore */ });
            }
        });
        return () => unsubscribe();
    }, []); // mount-once: isOpen is checked inside the callback

    const handleSttProviderChange = async (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively') => {
        setSttProvider(provider);
        setIsSttDropdownOpen(false);
        setSttTestStatus('idle');
        setSttTestError('');
        try {
            // @ts-ignore
            await window.electronAPI?.setSttProvider?.(provider);
        } catch (e) {
            console.error('Failed to set STT provider:', e);
        }
    };

    const handleSttKeySubmit = async (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', key: string) => {
        if (!key.trim()) return;

        // Auto-test before saving
        setSttSaving(true);
        setSttTestStatus('testing');
        setSttTestError('');

        try {
            // @ts-ignore
            const testResult = await window.electronAPI?.testSttConnection?.(
                provider,
                key.trim(),
                provider === 'azure' ? sttAzureRegion : undefined
            );

            if (!testResult?.success) {
                setSttTestStatus('error');
                setSttTestError(testResult?.error || 'Validation failed. Key not saved.');
                setSttSaving(false);
                return; // Stop save
            }

            // If success, proceed to save
            setSttTestStatus('success');
            setTimeout(() => setSttTestStatus('idle'), 3000);

            if (provider === 'groq') {
                // @ts-ignore
                await window.electronAPI?.setGroqSttApiKey?.(key.trim());
            } else if (provider === 'openai') {
                // @ts-ignore
                await window.electronAPI?.setOpenAiSttApiKey?.(key.trim());
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.(key.trim());
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.(key.trim());
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.(key.trim());
            } else if (provider === 'soniox') {
                // @ts-ignore
                await window.electronAPI?.setSonioxApiKey?.(key.trim());
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.(key.trim());
            }
            if (provider === 'groq') setHasStoredSttGroqKey(true);
            else if (provider === 'openai') setHasStoredSttOpenaiKey(true);
            else if (provider === 'elevenlabs') setHasStoredElevenLabsKey(true);
            else if (provider === 'azure') setHasStoredAzureKey(true);
            else if (provider === 'ibmwatson') setHasStoredIbmWatsonKey(true);
            else if (provider === 'soniox') setHasStoredSonioxKey(true);
            else setHasStoredDeepgramKey(true);

            setSttSaved(true);
            setTimeout(() => setSttSaved(false), 2000);
        } catch (e: any) {
            console.error(`Failed to save ${provider} STT key:`, e);
            setSttTestStatus('error');
            setSttTestError(e.message || 'Validation failed');
        } finally {
            setSttSaving(false);
        }
    };

    const handleRemoveSttKey = async (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => {
        if (!confirm(`Are you sure you want to remove the ${provider === 'ibmwatson' ? 'IBM Watson' : provider.charAt(0).toUpperCase() + provider.slice(1)} API key?`)) return;

        try {
            if (provider === 'groq') {
                // @ts-ignore
                await window.electronAPI?.setGroqSttApiKey?.('');
                setSttGroqKey('');
                setHasStoredSttGroqKey(false);
            } else if (provider === 'openai') {
                // @ts-ignore
                await window.electronAPI?.setOpenAiSttApiKey?.('');
                setSttOpenaiKey('');
                setHasStoredSttOpenaiKey(false);
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.('');
                setSttElevenLabsKey('');
                setHasStoredElevenLabsKey(false);
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.('');
                setSttAzureKey('');
                setHasStoredAzureKey(false);
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.('');
                setSttIbmKey('');
                setHasStoredIbmWatsonKey(false);
            } else if (provider === 'soniox') {
                // @ts-ignore
                await window.electronAPI?.setSonioxApiKey?.('');
                setSttSonioxKey('');
                setHasStoredSonioxKey(false);
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.('');
                setSttDeepgramKey('');
                setHasStoredDeepgramKey(false);
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} STT key:`, e);
        }
    };

    const handleRemoveTavilyKey = async () => {
        if (!confirm('Are you sure you want to remove the Tavily API Key?')) return;

        try {
            await window.electronAPI?.setTavilyApiKey?.('');
            
            
        } catch (e) {
            console.error('Failed to remove Tavily API key:', e);
        }
    };

    const handleTestSttConnection = async () => {
        if (sttProvider === 'none' || sttProvider === 'google' || sttProvider === 'natively') return;
        const keyMap: Record<string, string> = {
            groq: sttGroqKey, openai: sttOpenaiKey, deepgram: sttDeepgramKey,
            elevenlabs: sttElevenLabsKey, azure: sttAzureKey, ibmwatson: sttIbmKey,
            soniox: sttSonioxKey,
        };
        const keyToTest = keyMap[sttProvider] || '';
        if (!keyToTest.trim()) {
            setSttTestStatus('error');
            setSttTestError('Please enter an API key first');
            return;
        }

        setSttTestStatus('testing');
        setSttTestError('');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.testSttConnection?.(
                sttProvider,
                keyToTest.trim(),
                sttProvider === 'azure' ? sttAzureRegion : undefined
            );
            if (result?.success) {
                setSttTestStatus('success');
                setTimeout(() => setSttTestStatus('idle'), 3000);
            } else {
                setSttTestStatus('error');
                setSttTestError(result?.error || 'Connection failed');
            }
        } catch (e: any) {
            setSttTestStatus('error');
            setSttTestError(e.message || 'Test failed');
        }
    };


    const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; email?: string }>({ connected: false });
    const [isCalendarsLoading, setIsCalendarsLoading] = useState(false);


    // Load stored credentials on mount




    const handleCheckForUpdates = async () => {
        if (updateStatus === 'checking') return;
        setUpdateStatus('checking');
        try {
            await window.electronAPI.checkForUpdates();
        } catch (error) {
            console.error("Failed to check for updates:", error);
            setUpdateStatus('error');
            setTimeout(() => setUpdateStatus('idle'), 3000);
        }
    };

    useEffect(() => {
        if (!isOpen) return;

        const unsubs = [
            window.electronAPI.onUpdateChecking(() => {
                setUpdateStatus('checking');
            }),
            window.electronAPI.onUpdateAvailable(() => {
                setUpdateStatus('available');
                // Don't close settings - let user see the button change to "Update Available"
            }),
            window.electronAPI.onUpdateNotAvailable(() => {
                setUpdateStatus('uptodate');
                setTimeout(() => setUpdateStatus('idle'), 3000);
            }),
            window.electronAPI.onUpdateError((err) => {
                console.error('[Settings] Update error:', err);
                setUpdateStatus('error');
                setTimeout(() => setUpdateStatus('idle'), 3000);
            })
        ];

        return () => unsubs.forEach(unsub => unsub());
    }, [isOpen, onClose]);



    useEffect(() => {
        if (isOpen) {
            // Load detectable status
            if (window.electronAPI?.getUndetectable) {
                window.electronAPI.getUndetectable().then(setIsUndetectable);
            }
            if (window.electronAPI?.getOpenAtLogin) {
                window.electronAPI.getOpenAtLogin().then(setOpenOnLogin);
            }
            if (window.electronAPI?.getThemeMode) {
                window.electronAPI.getThemeMode().then(({ mode }) => setThemeMode(mode));
            }

            // Load settings
            const loadDevices = async () => {
                try {
                    const [inputs, outputs] = await Promise.all([
                        // @ts-ignore
                        window.electronAPI?.getInputDevices() || Promise.resolve([]),
                        // @ts-ignore
                        window.electronAPI?.getOutputDevices() || Promise.resolve([])
                    ]);

                    // Map to shape compatible with CustomSelect (which expects MediaDeviceInfo-like objects)
                    const formatDevices = (devs: any[]) => devs.map(d => ({
                        deviceId: d.id,
                        label: d.name,
                        kind: 'audioinput' as MediaDeviceKind,
                        groupId: '',
                        toJSON: () => d
                    }));

                    setInputDevices(formatDevices(inputs));
                    setOutputDevices(formatDevices(outputs));

                    // Load saved preferences
                    const savedInput = localStorage.getItem('preferredInputDeviceId');
                    const savedOutput = localStorage.getItem('preferredOutputDeviceId');

                    if (savedInput && inputs.find((d: any) => d.id === savedInput)) {
                        setSelectedInput(savedInput);
                    } else if (inputs.length > 0 && !selectedInput) {
                        setSelectedInput(inputs[0].id);
                    }

                    if (savedOutput && outputs.find((d: any) => d.id === savedOutput)) {
                        setSelectedOutput(savedOutput);
                    } else if (outputs.length > 0 && !selectedOutput) {
                        setSelectedOutput(outputs[0].id);
                    }
                } catch (e) {
                    console.error("Error loading native devices:", e);
                }
            };
            loadDevices();

            // Load Experimental SCK pref
            const savedSck = localStorage.getItem('useExperimentalSckBackend') === 'true';
            setUseExperimentalSck(savedSck);

            // Load Calendar Status
            if (window.electronAPI?.getCalendarStatus) {
                window.electronAPI.getCalendarStatus().then(setCalendarStatus);
            }
        }
    }, [isOpen, selectedInput, selectedOutput]); // Re-run if isOpen changes, or if selected devices are cleared

    // Use the native mic test path so device IDs stay consistent with the meeting runtime.
    useEffect(() => {
        if (isOpen && activeTab === 'audio') {
            const unsubscribe = window.electronAPI?.onAudioTestLevel?.((level) => {
                setMicLevel(Math.max(0, Math.min(100, level * 100)));
            });

            window.electronAPI?.startAudioTest(selectedInput || undefined).catch((error) => {
                console.error("Error starting native microphone test:", error);
                setMicLevel(0);
            });

            return () => {
                unsubscribe?.();
                window.electronAPI?.stopAudioTest?.().catch((error) => {
                    console.error("Error stopping native microphone test:", error);
                });
                setMicLevel(0);
            };
        } else {
            setMicLevel(0);
            window.electronAPI?.stopAudioTest?.().catch((error) => {
                console.error("Error stopping native microphone test:", error);
            });
        }
    }, [isOpen, activeTab, selectedInput]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    id="settings-backdrop"
                    className={`fixed inset-0 z-50 flex items-center justify-center p-8 transition-colors duration-150 ${isPreviewingOpacity ? 'bg-transparent backdrop-blur-none' : 'bg-black/60 backdrop-blur-sm'}`}
                >
                    <motion.div
                        id="settings-panel-wrapper"
                        initial={{ scale: 0.94, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 20 }}
                        transition={{ 
                            type: "spring", 
                            stiffness: 400, 
                            damping: 32,
                            mass: 1
                        }}
                        className="bg-bg-elevated w-full max-w-4xl h-[80vh] rounded-2xl border border-border-subtle shadow-2xl overflow-hidden relative"
                    >
                        <div 
                            id="settings-panel" 
                            className="flex w-full h-full"
                            style={{ visibility: isPreviewingOpacity ? 'hidden' : 'visible' }}
                        >
                        {/* Sidebar */}
                        <div className="w-64 bg-bg-sidebar flex flex-col border-r border-border-subtle">
                            <div className="p-6">
                                <h2 className="font-semibold text-gray-400 text-xs uppercase tracking-wider mb-2">Settings</h2>
                                <nav className="space-y-1">
                                    <button
                                        onClick={() => setActiveTab('general')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'general' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Monitor size={16} /> General
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('natively-api')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'natively-api' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Zap size={16} className={activeTab === 'natively-api' ? 'text-blue-500' : 'text-blue-500/70'} />
                                        <span>Natively API</span>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('natively-pro')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'natively-pro' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <NativelyLogoMark size={16} className={activeTab === 'natively-pro' ? 'text-text-primary' : 'text-text-secondary'} />
                                        <span>Natively Pro</span>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('ai-providers')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'ai-providers' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <FlaskConical size={16} /> AI Providers
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('calendar')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'calendar' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Calendar size={16} /> Calendar
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('audio')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'audio' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Mic size={16} /> Audio
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('keybinds')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'keybinds' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Keyboard size={16} /> Keybinds
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('phone-mirror')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'phone-mirror' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Smartphone size={16} /> Phone Mirror
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('help')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors flex items-center gap-3 ${activeTab === 'help' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <HelpCircle size={16} /> Setup & Help
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('about')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'about' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Info size={16} /> About
                                    </button>
                                </nav>
                            </div>

                            <div className="mt-auto p-6 border-t border-border-subtle">
                                <button
                                    onClick={() => window.electronAPI.quitApp()}
                                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-3"
                                >
                                    <LogOut size={16} /> Quit Natively
                                </button>
                                <button onClick={onClose} className="group mt-2 w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50 transition-colors flex items-center gap-3">
                                    <X size={18} className="group-hover:text-red-500 transition-colors" /> Close
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 bg-bg-main overflow-y-auto p-8 relative">
                            {activeTab === 'general' && (
                                <div className="space-y-6 animated fadeIn">
                                    <div className="space-y-3.5">
                                        {/* UndetectableToggle */}
                                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isUndetectable ? 'shadow-lg shadow-blue-500/10' : ''}`}>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    {isUndetectable ? (
                                                        <svg
                                                            width="18"
                                                            height="18"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            className="text-text-primary"
                                                        >
                                                            <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" fill="currentColor" stroke="currentColor" />
                                                            <path d="M9 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                            <path d="M15 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                        </svg>
                                                    ) : (
                                                        <Ghost size={18} className="text-text-primary" />
                                                    )}
                                                    <h3 className="text-lg font-bold text-text-primary">{isUndetectable ? 'Undetectable' : 'Detectable'}</h3>
                                                </div>
                                                <p className="text-xs text-text-secondary">
                                                    Natively is currently {isUndetectable ? 'undetectable' : 'detectable'} by screen-sharing. <button className="text-blue-400 hover:underline">Supported apps here</button>
                                                </p>
                                            </div>
                                            <div
                                                onClick={() => {
                                                    const newState = !isUndetectable;
                                                    setIsUndetectable(newState);
                                                    window.electronAPI?.setUndetectable(newState);
                                                    // Analytics: Undetectable Mode Toggle
                                                    analytics.trackModeSelected(newState ? 'undetectable' : 'overlay');
                                                }}
                                                className={`w-11 h-6 rounded-full relative transition-colors ${isUndetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                            >
                                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isUndetectable ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                        </div>

                                        {/* Mouse Passthrough Toggle — Adapted from public PR #113 */}
                                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isMousePassthrough ? 'shadow-lg shadow-sky-500/10' : ''}`}>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <PointerOff size={18} className={isMousePassthrough ? 'text-sky-400' : 'text-text-primary'} />
                                                    <h3 className="text-lg font-bold text-text-primary">Mouse Passthrough</h3>
                                                </div>
                                                <p className="text-xs text-text-secondary">
                                                    Overlay stays visible but lets all mouse clicks pass through to the app beneath.
                                                </p>
                                            </div>
                                            <div
                                                onClick={() => {
                                                    const newState = !isMousePassthrough;
                                                    setIsMousePassthrough(newState);
                                                    window.electronAPI?.setOverlayMousePassthrough(newState);
                                                }}
                                                className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer ${isMousePassthrough ? 'bg-sky-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                            >
                                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isMousePassthrough ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">General settings</h3>
                                            <p className="text-xs text-text-secondary mb-2">Customize how Natively works for you</p>

                                            <div className={`rounded-xl border ${isLight ? 'bg-bg-card border-border-subtle divide-y divide-border-subtle' : 'bg-transparent border-transparent divide-y divide-border-subtle/20'}`}>
                                            <div className="space-y-0">
                                                {/* Open at Login */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <Power size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Open Natively when you log in</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Natively will open automatically when you log in to your computer</p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !openOnLogin;
                                                            setOpenOnLogin(newState);
                                                            window.electronAPI?.setOpenAtLogin(newState);
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors ${openOnLogin ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${openOnLogin ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>

                                                {/* Debug Logging */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-10 h-10 bg-bg-item-surface rounded-lg border flex items-center justify-center transition-colors ${verboseLogging ? 'border-amber-500/40 text-amber-400' : 'border-border-subtle text-text-tertiary'}`}>
                                                            <Terminal size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Verbose debug logging</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Print detailed audio, STT, and pipeline diagnostics</p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !verboseLogging;
                                                            setVerboseLogging(newState);
                                                            window.electronAPI?.setVerboseLogging?.(newState);
                                                            if (newState) {
                                                                setShowVerboseToast(true);
                                                            }
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer ${verboseLogging ? 'bg-amber-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${verboseLogging ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>

                                                {/* Verbose logging toast */}
                                                <AnimatePresence>
                                                    {showVerboseToast && (
                                                        <motion.div
                                                            key="verbose-toast"
                                                            initial={{ opacity: 0, y: -6, height: 0 }}
                                                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                                                            exit={{ opacity: 0, y: -4, height: 0 }}
                                                            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                                                            className="mx-4 mb-1 overflow-hidden"
                                                        >
                                                            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    <Terminal size={14} className="text-amber-400 shrink-0" />
                                                                    <p className="text-xs text-amber-200/80 leading-snug truncate">
                                                                        Logs → <span className="font-mono text-amber-300">~/Documents/natively_debug.log</span>
                                                                    </p>
                                                                </div>
                                                                <button
                                                                    onClick={() => window.electronAPI?.openLogFile?.()}
                                                                    className="shrink-0 text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25"
                                                                >
                                                                    Open
                                                                </button>
                                                            </div>
                                                            {/* 5-second drain bar */}
                                                            <motion.div
                                                                className="h-[2px] bg-amber-500/40 rounded-b-xl"
                                                                initial={{ scaleX: 1, originX: 0 }}
                                                                animate={{ scaleX: 0 }}
                                                                transition={{ duration: 5, ease: 'linear', delay: 0.2 }}
                                                            />
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>

                                                {/* Interviewer Transcript */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <MessageSquare size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Interviewer Transcript</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Show real-time transcription of the interviewer</p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !showTranscript;
                                                            setShowTranscript(newState);
                                                            localStorage.setItem('natively_interviewer_transcript', String(newState));
                                                            window.dispatchEvent(new Event('storage'));
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors ${showTranscript ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${showTranscript ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>


                                                {/* Theme */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <Palette size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Theme</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Customize how Natively looks on your device</p>
                                                        </div>
                                                    </div>

                                                    <div className="relative" ref={themeDropdownRef}>
                                                        <button
                                                            onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                                                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                                                        >
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <span className="text-text-secondary shrink-0">
                                                                    {themeMode === 'system' && <Monitor size={14} />}
                                                                    {themeMode === 'light' && <Sun size={14} />}
                                                                    {themeMode === 'dark' && <Moon size={14} />}
                                                                </span>
                                                                <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap">{themeMode}</span>
                                                            </div>
                                                            <ChevronDown size={12} className={`shrink-0 transition-transform ${isThemeDropdownOpen ? 'rotate-180' : ''}`} />
                                                        </button>

                                                        {/* Dropdown Menu */}
                                                        {isThemeDropdownOpen && (
                                                            <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none">
                                                                {[
                                                                    { mode: 'system', label: 'System', icon: <Monitor size={14} /> },
                                                                    { mode: 'light', label: 'Light', icon: <Sun size={14} /> },
                                                                    { mode: 'dark', label: 'Dark', icon: <Moon size={14} /> }
                                                                ].map((option) => (
                                                                    <button
                                                                        key={option.mode}
                                                                        onClick={() => {
                                                                            handleSetTheme(option.mode as any);
                                                                            setIsThemeDropdownOpen(false);
                                                                        }}
                                                                        className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${themeMode === option.mode ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                    >
                                                                        <span className={themeMode === option.mode ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}>{option.icon}</span>
                                                                        <span className="font-medium">{option.label}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                    {/* AI Response Language */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <Globe size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">AI Response Language</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">
                                                                {aiResponseLanguage === 'auto'
                                                                    ? 'Mirrors user\'s language automatically'
                                                                    : 'Language for AI suggestions and notes'
                                                                }
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="relative" ref={aiLangDropdownRef}>
                                                        <button
                                                            onClick={() => setIsAiLangDropdownOpen(!isAiLangDropdownOpen)}
                                                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                                                        >
                                                            <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap flex items-center gap-1">
                                                                {aiResponseLanguage === 'auto' ? 'Auto' : aiResponseLanguage}
                                                            </span>
                                                            <ChevronDown size={12} className={`shrink-0 transition-transform ${isAiLangDropdownOpen ? 'rotate-180' : ''}`} />
                                                        </button>

                                                        {/* Dropdown Menu */}
                                                        {isAiLangDropdownOpen && (
                                                            <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none max-h-60 overflow-y-auto custom-scrollbar">
                                                                {availableAiLanguages.map((option) => (
                                                                    <button
                                                                        key={option.code}
                                                                        onClick={() => {
                                                                            handleAiLanguageChange(option.code);
                                                                            setIsAiLangDropdownOpen(false);
                                                                        }}
                                                                        className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${aiResponseLanguage === option.code ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                    >
                                                                        {option.code === 'auto' ? (
                                                                            <span className="font-medium">Auto</span>
                                                                        ) : (
                                                                            <span className="font-medium">{option.label}</span>
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Version */}
                                                <div className="flex items-start justify-between gap-4 px-4 py-3">
                                                    <div className="flex items-start gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                            <BadgeCheck size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Version</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">
                                                                You are currently using Natively version {packageJson.version}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={async () => {
                                                            if (updateStatus === 'available') {
                                                                try {
                                                                    // @ts-ignore
                                                                    await window.electronAPI.downloadUpdate();
                                                                    onClose(); // Close settings to show the banner
                                                                } catch (err) {
                                                                    console.error("Failed to start download:", err);
                                                                }
                                                            } else {
                                                                handleCheckForUpdates();
                                                            }
                                                        }}
                                                        disabled={updateStatus === 'checking'}
                                                        className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all flex items-center gap-2 shrink-0 ${updateStatus === 'checking' ? 'bg-bg-input text-text-tertiary cursor-wait' :
                                                            updateStatus === 'available' ? 'bg-accent-primary text-white hover:bg-accent-secondary shadow-lg shadow-blue-500/20' :
                                                                updateStatus === 'uptodate' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                                                    updateStatus === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                                        'bg-bg-component hover:bg-bg-input text-text-primary'
                                                            }`}
                                                    >
                                                        {updateStatus === 'checking' ? (
                                                            <>
                                                                <RefreshCw size={14} className="animate-spin" />
                                                                Checking...
                                                            </>
                                                        ) : updateStatus === 'available' ? (
                                                            <>
                                                                <ArrowDown size={14} />
                                                                Update Available
                                                            </>
                                                        ) : updateStatus === 'uptodate' ? (
                                                            <>
                                                                <Check size={14} />
                                                                Up to date
                                                            </>
                                                        ) : updateStatus === 'error' ? (
                                                            <>
                                                                <X size={14} />
                                                                Error
                                                            </>
                                                        ) : (
                                                            <>
                                                                <RefreshCw size={14} />
                                                                Check for updates
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                            </div>

                                                {/* ------------------------------------------------------------------ */}
                                                {/* Interface Opacity (Stealth Mode)                                   */}
                                                {/* ------------------------------------------------------------------ */}
                                                <div
                                                    id="opacity-slider-card"
                                                    style={isPreviewingOpacity ? { visibility: 'visible', position: 'relative', zIndex: 9999 } : {}}
                                                    className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle mt-4`}
                                                >
                                                    <div className="flex items-center justify-between mb-3">
                                                        <label className="flex items-center gap-2 text-xs font-medium text-text-secondary uppercase tracking-wide">
                                                            <Eye size={13} className="text-text-secondary" />
                                                            Interface Opacity
                                                        </label>
                                                        <span className="opacity-percent-label text-xs font-semibold text-text-primary tabular-nums">
                                                            {Math.round(overlayOpacity * 100)}%
                                                        </span>
                                                    </div>

                                                    <input
                                                        type="range"
                                                        min={OVERLAY_OPACITY_MIN}
                                                        max={1.0}
                                                        step={0.01}
                                                        defaultValue={overlayOpacity}
                                                        onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                                                        onPointerDown={startPreviewingOpacity}
                                                        onPointerUp={stopPreviewingOpacity}
                                                        onPointerCancel={stopPreviewingOpacity}
                                                        onPointerLeave={stopPreviewingOpacity}
                                                        className="w-full h-1.5 rounded-full appearance-none bg-bg-input accent-accent-primary"
                                                        style={{ WebkitAppearance: 'none' } as React.CSSProperties}
                                                    />

                                                    <div className="flex justify-between mt-1.5">
                                                        <span className="text-[10px] text-text-tertiary">More Stealth</span>
                                                        <span className="text-[10px] text-text-tertiary">Fully Visible</span>
                                                    </div>

                                                    <p className="text-xs text-text-tertiary mt-2">
                                                        Controls the visibility of the in-meeting overlay.{' '}
                                                        <span className="text-text-secondary">Hold the slider to preview.</span>
                                                    </p>
                                                </div>

                                        </div>

                                    </div>

                                    {/* Process Disguise */}
                                    {/* Process Disguise */}
                                    <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle`}>
                                        <div className="flex flex-col gap-1 mb-3">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-bold text-text-primary">Process Disguise</h3>
                                            </div>
                                            <p className="text-xs text-text-secondary">
                                                Disguise Natively as another application to prevent detection during screen sharing.
                                                <span className="block mt-1 text-text-tertiary">
                                                    Select a disguise to be automatically applied when Undetectable mode is on.
                                                </span>
                                            </p>
                                        </div>

                                        <div className={`grid grid-cols-2 gap-3 ${isUndetectable ? 'opacity-50 pointer-events-none' : ''}`}>
                                            {isUndetectable && (
                                                <p className="col-span-2 text-xs text-yellow-500/80 -mt-1 mb-1">
                                                    ⚠️ Disable Undetectable mode first to change disguise.
                                                </p>
                                            )}
                                            {[
                                                { id: 'none', label: 'None (Default)', icon: <Layout size={14} /> },
                                                { id: 'terminal', label: 'Terminal', icon: <Terminal size={14} /> },
                                                { id: 'settings', label: 'System Settings', icon: <Settings size={14} /> },
                                                { id: 'activity', label: 'Activity Monitor', icon: <Activity size={14} /> }
                                            ].map((option) => (
                                                <button
                                                    key={option.id}
                                                    disabled={isUndetectable}
                                                    onClick={() => {
                                                        if (isUndetectable) return;
                                                        // @ts-ignore
                                                        setDisguiseMode(option.id);
                                                        // @ts-ignore
                                                        window.electronAPI?.setDisguise(option.id);
                                                        // Analytics
                                                        analytics.trackModeSelected(`disguise_${option.id}`);
                                                    }}
                                                    className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-all ${disguiseMode === option.id
                                                        ? 'bg-accent-primary border-accent-primary text-white shadow-lg shadow-blue-500/20'
                                                        : 'bg-bg-input border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-subtle-hover'
                                                        } ${isUndetectable ? 'cursor-not-allowed' : ''}`}
                                                >
                                                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${disguiseMode === option.id ? 'bg-white/20 text-white' : 'bg-bg-item-surface text-text-secondary'
                                                        }`}>
                                                        {option.icon}
                                                    </div>
                                                    <span className="text-xs font-medium">{option.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                </div>
                            )}
                            
                            {activeTab === 'ai-providers' && (
                                <AIProvidersSettings />
                            )}
                            {activeTab === 'natively-api' && (
                                <NativelyApiSettings />
                            )}
                            {activeTab === 'natively-pro' && (
                                <NativelyProSettings />
                            )}
                            {activeTab === 'keybinds' && (
                                <div className="space-y-5 animated fadeIn select-text pb-4">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">Keyboard shortcuts</h3>
                                            <p className="text-xs text-text-secondary">Natively works with these easy to remember commands.</p>
                                        </div>
                                        <button
                                            onClick={resetShortcuts}
                                            className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-green-500/30 transition-all duration-200 text-xs font-medium text-text-secondary hover:text-green-500 active:scale-95 mt-1"
                                        >
                                            <RotateCcw size={13} strokeWidth={2.5} />
                                            Restore Default
                                        </button>
                                    </div>

                                    <div className="grid gap-6">
                                        {/* General Category */}
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary mb-3">General</h4>
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Eye size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Toggle Visibility</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.toggleVisibility}
                                                        onSave={(keys) => updateShortcut('toggleVisibility', keys)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><PointerOff size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Toggle Mouse Passthrough</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.toggleMousePassthrough}
                                                        onSave={(keys) => updateShortcut('toggleMousePassthrough', keys)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><MessageSquare size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Process Screenshots</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.processScreenshots}
                                                        onSave={(keys) => updateShortcut('processScreenshots', keys)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Sparkles size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Capture Screen & Ask AI</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.captureAndProcess}
                                                        onSave={(keys) => updateShortcut('captureAndProcess', keys)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><RotateCcw size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Reset / Cancel</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.resetCancel}
                                                        onSave={(keys) => updateShortcut('resetCancel', keys)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Camera size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Take Screenshot</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.takeScreenshot}
                                                        onSave={(keys) => updateShortcut('takeScreenshot', keys)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Crop size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Selective Screenshot</span>
                                                    </div>
                                                    <KeyRecorder
                                                        currentKeys={shortcuts.selectiveScreenshot}
                                                        onSave={(keys) => updateShortcut('selectiveScreenshot', keys)}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Chat Category */}
                                        <div>
                                            <div className="mb-3">
                                                <h4 className="text-sm font-bold text-text-primary">Chat</h4>
                                            </div>
                                            <div className="space-y-1">
                                                {[
                                                    { id: 'whatToAnswer', label: 'What to Answer', icon: <Sparkles size={14} /> },
                                                    { id: 'clarify', label: 'Clarify', icon: <MessageSquare size={14} /> },
                                                    { id: 'followUp', label: 'Follow Up', icon: <MessageSquare size={14} /> },
                                                    { id: 'dynamicAction4', label: 'Recap / Brainstorm', icon: <RefreshCw size={14} /> },
                                                    { id: 'answer', label: 'Answer / Record', icon: <Mic size={14} /> },
                                                    { id: 'codeHint', label: 'Get Code Hint', icon: <Zap size={14} /> },
                                                    { id: 'brainstorm', label: 'Brainstorm Approaches', icon: <Zap size={14} /> },
                                                    { id: 'scrollUp', label: 'Scroll Up', icon: <ArrowUp size={14} /> },
                                                    { id: 'scrollDown', label: 'Scroll Down', icon: <ArrowDown size={14} /> },
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                                            onSave={(keys) => updateShortcut(item.id as any, keys)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Window Category */}
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary mb-3">Window</h4>
                                            <div className="space-y-1">
                                                {[
                                                    { id: 'moveWindowUp', label: 'Move Window Up', icon: <ArrowUp size={14} /> },
                                                    { id: 'moveWindowDown', label: 'Move Window Down', icon: <ArrowDown size={14} /> },
                                                    { id: 'moveWindowLeft', label: 'Move Window Left', icon: <ArrowLeft size={14} /> },
                                                    { id: 'moveWindowRight', label: 'Move Window Right', icon: <ArrowRight size={14} /> }
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                                            onSave={(keys) => updateShortcut(item.id as any, keys)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'audio' && (
                                <div className="space-y-6 animated fadeIn">
                                    {/* ── Speech Provider Section ── */}
                                    <div>
                                        <h3 className="text-lg font-bold text-text-primary mb-1">Speech Provider</h3>
                                        <p className="text-xs text-text-secondary mb-5">Choose the engine that transcribes audio to text.</p>

                                        <div className="space-y-4">
                                            <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                                                <label className="text-xs font-medium text-text-secondary block">Speech Provider</label>
                                                <div className="relative">
                                                    <ProviderSelect
                                                        value={sttProvider}
                                                        onChange={(val) => handleSttProviderChange(val as any)}
                                                        options={[
                                                            ...(hasNativelyKey ? [{ id: 'natively', label: 'Natively API', badge: 'Saved' as const, recommended: true, desc: 'Managed transcription via Natively backend', color: 'blue', icon: <Mic size={14} /> }] : []),
                                                            { id: 'google', label: 'Google Cloud', badge: googleServiceAccountPath ? 'Saved' : null, recommended: true, desc: 'gRPC streaming via Service Account', color: 'blue', icon: <Mic size={14} /> },
                                                            { id: 'groq', label: 'Groq Whisper', badge: hasStoredSttGroqKey ? 'Saved' : null, recommended: true, desc: 'Ultra-fast REST transcription', color: 'orange', icon: <Mic size={14} /> },
                                                            { id: 'openai', label: 'OpenAI Whisper', badge: hasStoredSttOpenaiKey ? 'Saved' : null, desc: 'OpenAI-compatible Whisper API', color: 'green', icon: <Mic size={14} /> },
                                                            { id: 'deepgram', label: 'Deepgram Nova-3', badge: hasStoredDeepgramKey ? 'Saved' : null, recommended: true, desc: 'High-accuracy REST transcription', color: 'purple', icon: <Mic size={14} /> },
                                                            { id: 'elevenlabs', label: 'ElevenLabs Scribe', badge: hasStoredElevenLabsKey ? 'Saved' : null, desc: 'Scribe v2 Realtime API', color: 'teal', icon: <Mic size={14} /> },
                                                            { id: 'azure', label: 'Azure Speech', badge: hasStoredAzureKey ? 'Saved' : null, desc: 'Microsoft Cognitive Services STT', color: 'cyan', icon: <Mic size={14} /> },
                                                            { id: 'ibmwatson', label: 'IBM Watson', badge: hasStoredIbmWatsonKey ? 'Saved' : null, desc: 'IBM Watson cloud STT service', color: 'indigo', icon: <Mic size={14} /> },
                                                            { id: 'soniox', label: 'Soniox', badge: hasStoredSonioxKey ? 'Saved' : null, recommended: true, desc: '60+ languages, multilingual, domain context', color: 'cyan', icon: <Mic size={14} /> },
                                                        ]}
                                                    />
                                                </div>
                                            </div>

                                            {/* Groq Model Selector */}
                                            {sttProvider === 'groq' && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                                    <label className="text-xs font-medium text-text-secondary mb-2.5 block">Whisper Model</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {[
                                                            { id: 'whisper-large-v3-turbo', label: 'V3 Turbo', desc: 'Fastest' },
                                                            { id: 'whisper-large-v3', label: 'V3', desc: 'Most Accurate' },
                                                        ].map((m) => (
                                                            <button
                                                                key={m.id}
                                                                onClick={async () => {
                                                                    setGroqSttModel(m.id);
                                                                    try {
                                                                        // @ts-ignore
                                                                        await window.electronAPI?.setGroqSttModel?.(m.id);
                                                                    } catch (e) {
                                                                        console.error('Failed to set Groq model:', e);
                                                                    }
                                                                }}
                                                                className={`rounded-lg px-3 py-2.5 text-left transition-all duration-200 ease-in-out active:scale-[0.98] ${groqSttModel === m.id
                                                                    ? 'bg-blue-600 text-white shadow-md'
                                                                    : 'bg-bg-input hover:bg-bg-elevated text-text-primary'
                                                                    }`}
                                                            >
                                                                <span className="text-sm font-medium block">{m.label}</span>
                                                                <span className={`text-[11px] transition-colors ${groqSttModel === m.id ? 'text-white/70' : 'text-text-tertiary'
                                                                    }`}>{m.desc}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Google Cloud Service Account */}
                                            {sttProvider === 'google' && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                                    <label className="text-xs font-medium text-text-secondary mb-2 block">Service Account JSON</label>
                                                    <div className="flex gap-2">
                                                        <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-secondary font-mono truncate">
                                                            {googleServiceAccountPath
                                                                ? <span className="text-text-primary">{googleServiceAccountPath.split('/').pop()}</span>
                                                                : <span className="text-text-tertiary italic">No file selected</span>}
                                                        </div>
                                                        <button
                                                            onClick={async () => {
                                                                // @ts-ignore
                                                                const result = await window.electronAPI?.selectServiceAccount?.();
                                                                if (result?.success && result.path) {
                                                                    setGoogleServiceAccountPath(result.path);
                                                                }
                                                            }}
                                                            className="px-3 py-2 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors flex items-center gap-2"
                                                        >
                                                            <Upload size={14} /> Select File
                                                        </button>
                                                    </div>
                                                    <p className="text-[10px] text-text-tertiary mt-2">
                                                        Required for Google Cloud Speech-to-Text.
                                                    </p>
                                                </div>
                                            )}

                                            {/* API Key Input (non-Google providers) */}
                                            {sttProvider !== 'google' && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                                                    <label className="text-xs font-medium text-text-secondary block">
                                                        {sttProvider === 'groq' ? 'Groq' : sttProvider === 'openai' ? 'OpenAI STT' : sttProvider === 'elevenlabs' ? 'ElevenLabs' : sttProvider === 'azure' ? 'Azure' : sttProvider === 'ibmwatson' ? 'IBM Watson' : sttProvider === 'soniox' ? 'Soniox' : 'Deepgram'} API Key
                                                    </label>
                                                    {sttProvider === 'openai' && (
                                                        <p className="text-[10px] text-text-tertiary mb-1.5">
                                                            This key is separate from your main AI Provider key.
                                                        </p>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="password"
                                                            value={
                                                                sttProvider === 'groq' ? sttGroqKey
                                                                    : sttProvider === 'openai' ? sttOpenaiKey
                                                                        : sttProvider === 'elevenlabs' ? sttElevenLabsKey
                                                                            : sttProvider === 'azure' ? sttAzureKey
                                                                                : sttProvider === 'ibmwatson' ? sttIbmKey
                                                                                    : sttProvider === 'soniox' ? sttSonioxKey
                                                                                        : sttDeepgramKey
                                                            }
                                                            onChange={(e) => {
                                                                if (sttProvider === 'groq') setSttGroqKey(e.target.value);
                                                                else if (sttProvider === 'openai') setSttOpenaiKey(e.target.value);
                                                                else if (sttProvider === 'elevenlabs') setSttElevenLabsKey(e.target.value);
                                                                else if (sttProvider === 'azure') setSttAzureKey(e.target.value);
                                                                else if (sttProvider === 'ibmwatson') setSttIbmKey(e.target.value);
                                                                else if (sttProvider === 'soniox') setSttSonioxKey(e.target.value);
                                                                else setSttDeepgramKey(e.target.value);
                                                            }}
                                                            placeholder={
                                                                sttProvider === 'groq'
                                                                    ? (hasStoredSttGroqKey ? '••••••••••••' : 'Enter Groq API key')
                                                                    : sttProvider === 'openai'
                                                                        ? (hasStoredSttOpenaiKey ? '••••••••••••' : 'Enter OpenAI STT API key')
                                                                        : sttProvider === 'elevenlabs'
                                                                            ? (hasStoredElevenLabsKey ? '••••••••••••' : 'Enter ElevenLabs API key')
                                                                            : sttProvider === 'azure'
                                                                                ? (hasStoredAzureKey ? '••••••••••••' : 'Enter Azure API key')
                                                                                : sttProvider === 'ibmwatson'
                                                                                    ? (hasStoredIbmWatsonKey ? '••••••••••••' : 'Enter IBM Watson API key')
                                                                                    : sttProvider === 'soniox'
                                                                                        ? (hasStoredSonioxKey ? '••••••••••••' : 'Enter Soniox API key')
                                                                                        : (hasStoredDeepgramKey ? '••••••••••••' : 'Enter Deepgram API key')
                                                            }
                                                            className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                const keyMap: Record<string, string> = {
                                                                    groq: sttGroqKey, openai: sttOpenaiKey, deepgram: sttDeepgramKey,
                                                                    elevenlabs: sttElevenLabsKey, azure: sttAzureKey, ibmwatson: sttIbmKey,
                                                                };
                                                                handleSttKeySubmit(sttProvider as any, keyMap[sttProvider] || '');
                                                            }}
                                                            disabled={sttSaving || !(() => {
                                                                const keyMap: Record<string, string> = {
                                                                    groq: sttGroqKey, openai: sttOpenaiKey, deepgram: sttDeepgramKey,
                                                                    elevenlabs: sttElevenLabsKey, azure: sttAzureKey, ibmwatson: sttIbmKey,
                                                                    soniox: sttSonioxKey,
                                                                };
                                                                return (keyMap[sttProvider] || '').trim();
                                                            })()}
                                                            className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${sttSaved
                                                                ? 'bg-green-500/20 text-green-400'
                                                                : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50'
                                                                }`}
                                                        >
                                                            {sttSaving ? 'Saving...' : sttSaved ? 'Saved!' : 'Save'}
                                                        </button>
                                                        {(() => {
                                                            const hasKeyMap: Record<string, boolean> = {
                                                                groq: hasStoredSttGroqKey,
                                                                openai: hasStoredSttOpenaiKey,
                                                                deepgram: hasStoredDeepgramKey,
                                                                elevenlabs: hasStoredElevenLabsKey,
                                                                azure: hasStoredAzureKey,
                                                                ibmwatson: hasStoredIbmWatsonKey,
                                                                soniox: hasStoredSonioxKey,
                                                            };
                                                            return hasKeyMap[sttProvider] ? (
                                                                <button
                                                                    onClick={() => handleRemoveSttKey(sttProvider as any)}
                                                                    className="px-2.5 py-2.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all"
                                                                    title="Remove API Key"
                                                                >
                                                                    <Trash2 size={16} strokeWidth={1.5} />
                                                                </button>
                                                            ) : null;
                                                        })()}
                                                    </div>

                                                    {/* Azure Region Input */}
                                                    {sttProvider === 'azure' && (
                                                        <div className="space-y-1.5">
                                                            <label className="text-xs font-medium text-text-secondary block">Region</label>
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={sttAzureRegion}
                                                                    onChange={(e) => setSttAzureRegion(e.target.value)}
                                                                    placeholder="e.g. eastus"
                                                                    className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                                                                />
                                                                <button
                                                                    onClick={async () => {
                                                                        if (!sttAzureRegion.trim()) return;
                                                                        // @ts-ignore
                                                                        await window.electronAPI?.setAzureRegion?.(sttAzureRegion.trim());
                                                                        setSttSaved(true);
                                                                        setTimeout(() => setSttSaved(false), 2000);
                                                                    }}
                                                                    disabled={!sttAzureRegion.trim()}
                                                                    className="px-5 py-2.5 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50 transition-colors"
                                                                >
                                                                    Save
                                                                </button>
                                                            </div>
                                                            <p className="text-[10px] text-text-tertiary">e.g. eastus, westeurope, westus2</p>
                                                        </div>
                                                    )}

                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={handleTestSttConnection}
                                                            disabled={sttTestStatus === 'testing'}
                                                            className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                                                        >
                                                            {sttTestStatus === 'testing' ? (
                                                                <><RefreshCw size={12} className="animate-spin" /> Testing...</>
                                                            ) : sttTestStatus === 'success' ? (
                                                                <><Check size={12} className="text-green-500" /> Connected</>
                                                            ) : (
                                                                <>Test Connection</>
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const urls: Record<string, string> = {
                                                                    groq: 'https://console.groq.com/keys',
                                                                    openai: 'https://platform.openai.com/api-keys',
                                                                    deepgram: 'https://console.deepgram.com',
                                                                    elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
                                                                    azure: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeech',
                                                                    ibmwatson: 'https://cloud.ibm.com/catalog/services/speech-to-text'
                                                                };
                                                                if (urls[sttProvider]) {
                                                                    // @ts-ignore
                                                                    window.electronAPI?.openExternal(urls[sttProvider]);
                                                                }
                                                            }}
                                                            className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors ml-1"
                                                            title="Get API Key"
                                                        >
                                                            <ExternalLink size={12} />
                                                        </button>
                                                        {sttTestStatus === 'error' && (
                                                            <span className="text-xs text-red-400">{sttTestError}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Recognition Language Family */}
                                            <CustomSelect
                                                label="Language"
                                                icon={<Globe size={14} />}
                                                value={selectedSttGroup}
                                                options={languageGroups.map(g => ({
                                                    deviceId: g,
                                                    label: g,
                                                    kind: 'audioinput' as MediaDeviceKind,
                                                    groupId: '',
                                                    toJSON: () => ({})
                                                }))}
                                                onChange={handleGroupChange}
                                                placeholder="Select Language"
                                            />

                                            {/* Variant/Accent Selector (Conditional) */}
                                            {currentGroupVariants.length > 1 && (
                                                <div className="mt-3 animated fadeIn">
                                                    <CustomSelect
                                                        label="Accent / Region"
                                                        icon={<MapPin size={14} />}
                                                        value={recognitionLanguage}
                                                        options={currentGroupVariants}
                                                        onChange={handleLanguageChange}
                                                        placeholder="Select Region"
                                                    />
                                                </div>
                                            )}

                                            <div className="flex gap-2 items-center mt-2 px-1">
                                                <Info size={14} className="text-text-secondary shrink-0" />
                                                <p className="text-xs text-text-secondary">
                                                    {recognitionLanguage === 'auto'
                                                        ? autoDetectedLanguage
                                                            ? (() => {
                                                                const label = Object.values(availableLanguages).find((l: any) =>
                                                                    l.bcp47 === autoDetectedLanguage || l.iso639 === autoDetectedLanguage
                                                                )?.label as string | undefined;
                                                                return `Auto mode — detected: ${label ?? autoDetectedLanguage}`;
                                                              })()
                                                            : 'Auto mode — language will be detected from the first few seconds of audio.'
                                                        : 'Select the primary language being spoken in the meeting.'
                                                    }
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="h-px bg-border-subtle" />

                                    {/* ── Audio Configuration Section ── */}
                                    <div>
                                        <h3 className="text-lg font-bold text-text-primary mb-1">Audio Configuration</h3>
                                        <p className="text-xs text-text-secondary mb-5">Manage input and output devices.</p>

                                        <div className="space-y-4">
                                            <CustomSelect
                                                label="Input Device"
                                                icon={<Mic size={16} />}
                                                value={selectedInput}
                                                options={inputDevices}
                                                onChange={(id) => {
                                                    setSelectedInput(id);
                                                    localStorage.setItem('preferredInputDeviceId', id);
                                                }}
                                                placeholder="Default Microphone"
                                            />

                                            <div>
                                                <div className="flex justify-between text-xs text-text-secondary mb-2 px-1">
                                                    <span>Input Level</span>
                                                </div>
                                                <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-green-500 transition-all duration-100 ease-out"
                                                        style={{ width: `${micLevel}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="h-px bg-border-subtle my-2" />

                                            <CustomSelect
                                                label="Output Device"
                                                icon={<Speaker size={16} />}
                                                value={selectedOutput}
                                                options={outputDevices}
                                                onChange={(id) => {
                                                    setSelectedOutput(id);
                                                    localStorage.setItem('preferredOutputDeviceId', id);
                                                }}
                                                placeholder="Default Speakers"
                                            />

                                            <div className="flex justify-end">
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
                                                            if (!AudioContext) {
                                                                console.error("Web Audio API not supported");
                                                                return;
                                                            }

                                                            const ctx = new AudioContext();

                                                            if (ctx.state === 'suspended') {
                                                                await ctx.resume();
                                                            }

                                                            const oscillator = ctx.createOscillator();
                                                            const gainNode = ctx.createGain();

                                                            oscillator.connect(gainNode);
                                                            gainNode.connect(ctx.destination);

                                                            oscillator.type = 'sine';
                                                            oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
                                                            gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
                                                            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);

                                                            if (selectedOutput && (ctx as any).setSinkId) {
                                                                try {
                                                                    await (ctx as any).setSinkId(selectedOutput);
                                                                } catch (e) {
                                                                    console.warn("Error setting sink for AudioContext", e);
                                                                }
                                                            }

                                                            oscillator.start();
                                                            oscillator.stop(ctx.currentTime + 1.0);
                                                        } catch (e) {
                                                            console.error("Error playing test sound", e);
                                                        }
                                                    }}
                                                    className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                                                >
                                                    <Speaker size={12} /> Test Sound
                                                </button>
                                            </div>

                                            <div className="h-px bg-border-subtle my-2" />

                                            {/* SCK Backend Toggle */}
                                            <div className="bg-amber-500/5 rounded-xl border border-amber-500/20 p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-start gap-3">
                                                        <div className="mt-0.5 p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                                                            <FlaskConical size={18} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                <h3 className="text-sm font-bold text-text-primary">SCK Backend</h3>
                                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 uppercase tracking-wide">Alternative</span>
                                                            </div>
                                                            <p className="text-xs text-text-secondary leading-relaxed max-w-[300px]">
                                                                Use the ScreenCaptureKit backend. An optimized alternative to CoreAudio if you experience any capture issues.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !useExperimentalSck;
                                                            setUseExperimentalSck(newState);
                                                            window.localStorage.setItem('useExperimentalSckBackend', newState ? 'true' : 'false');
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${useExperimentalSck ? 'bg-amber-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${useExperimentalSck ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}


                            {activeTab === 'calendar' && (
                                <div className="space-y-6 animated fadeIn h-full">
                                    <div>
                                        <h3 className="text-lg font-bold text-text-primary mb-2">Visible Calendars</h3>
                                        <p className="text-xs text-text-secondary mb-4">Upcoming meetings are synchronized from these calendars</p>
                                    </div>

                                    <div className="bg-bg-card rounded-xl p-6 border border-border-subtle flex flex-col items-start gap-4">
                                        {calendarStatus.connected ? (
                                            <div className="w-full flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                                                        <Calendar size={20} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-medium text-text-primary">Google Calendar</h4>
                                                        <p className="text-xs text-text-secondary">Connected as {calendarStatus.email || 'User'}</p>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={async () => {
                                                        setIsCalendarsLoading(true);
                                                        try {
                                                            await window.electronAPI.calendarDisconnect();
                                                            const status = await window.electronAPI.getCalendarStatus();
                                                            setCalendarStatus(status);
                                                        } catch (e) {
                                                            console.error(e);
                                                        } finally {
                                                            setIsCalendarsLoading(false);
                                                        }
                                                    }}
                                                    disabled={isCalendarsLoading}
                                                    className="px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary rounded-md text-xs font-medium transition-colors"
                                                >
                                                    {isCalendarsLoading ? 'Disconnecting...' : 'Disconnect'}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="w-full py-4">
                                                <div className="mb-4">
                                                    <Calendar size={24} className="text-text-tertiary mb-3" />
                                                    <h4 className="text-sm font-bold text-text-primary mb-1">No calendars</h4>
                                                    <p className="text-xs text-text-secondary">Get started by connecting a Google account.</p>
                                                </div>

                                                <button
                                                    onClick={async () => {
                                                        setIsCalendarsLoading(true);
                                                        try {
                                                            const res = await window.electronAPI.calendarConnect();
                                                            if (res.success) {
                                                                const status = await window.electronAPI.getCalendarStatus();
                                                                setCalendarStatus(status);
                                                            }
                                                        } catch (e) {
                                                            console.error(e);
                                                        } finally {
                                                            setIsCalendarsLoading(false);
                                                        }
                                                    }}
                                                    disabled={isCalendarsLoading}
                                                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2.5 ${isLight ? 'bg-bg-component hover:bg-bg-item-surface text-text-primary border border-border-subtle' : 'bg-[#303033] hover:bg-[#3A3A3D] text-white'}`}
                                                >
                                                    <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                                                        <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                                                            <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z" />
                                                            <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z" />
                                                            <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.734 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z" />
                                                            <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z" />
                                                        </g>
                                                    </svg>
                                                    {isCalendarsLoading ? 'Connecting...' : 'Connect Google'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'phone-mirror' && (
                                <PhoneMirrorSettings />
                            )}

                            {activeTab === 'help' && (
                                <HelpSettings onNavigate={setActiveTab} />
                            )}

                            {activeTab === 'about' && (
                                <AboutSection />
                            )}
                        </div>
                    </div>
                    </motion.div>
                </motion.div>
            )
            }


            {/* ------------------------------------------------------------------ */}
            {/* Live Preview — mockup sits below the z-50 modal                    */}
            {/* ------------------------------------------------------------------ */}
            {/* ------------------------------------------------------------------ */}
            {/* Live Preview — mockup sits below the z-50 modal                    */}
            {/* ALWAYS MOUNTED to prevent React AnimatePresence lag spikes         */}
            {/* ------------------------------------------------------------------ */}
            <div
                id="settings-mockup-wrapper"
                className="fixed inset-0 z-[49] pointer-events-none transition-opacity duration-150"
                style={{ opacity: isPreviewingOpacity ? 1 : 0 }}
            >
                <MockupNativelyInterface opacity={previewOverlayOpacity} />
            </div>
        </AnimatePresence >
    );
};

export default SettingsOverlay;
