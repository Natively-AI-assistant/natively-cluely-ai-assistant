import React, { useState, useEffect } from 'react';
import {
    X, Mic, Speaker, Monitor, Keyboard, User, LifeBuoy, LogOut, Upload,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    Camera, RotateCcw, Eye, Layout, MessageSquare, Crop,
    ChevronDown, Check, BadgeCheck, Power, Palette, Calendar, Ghost, Sun, Moon, RefreshCw, Info, Globe, FlaskConical, Terminal, Settings, Activity, ExternalLink
} from 'lucide-react';
import { analytics } from '../lib/analytics/analytics.service';
import { AboutSection } from './AboutSection';
import { AIProvidersSettings } from './settings/AIProvidersSettings';
import { motion, AnimatePresence } from 'framer-motion';

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
                                {/* Badge removed from trigger */}
                            </div>
                            {/* Short description for trigger */}
                            <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                        </div>
                    </div>
                ) : <span className="text-text-secondary px-2 text-sm">Select Provider</span>}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-surface ${isOpen ? 'rotate-180 bg-bg-surface text-text-primary' : ''}`}>
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
                        className="absolute top-full left-0 w-full mt-2 bg-bg-elevated/90 backdrop-blur-xl border border-white/5 rounded-xl shadow-2xl overflow-hidden ring-1 ring-black/5"
                    >
                        <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                            {options.map(option => {
                                const isSelected = value === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        onClick={() => { onChange(option.id); setIsOpen(false); }}
                                        className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative ${isSelected ? 'bg-white/10 shadow-inner' : 'hover:bg-white/5'}`}
                                    >
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-95 group-hover:scale-100'} ${getIconStyle(option.color, false)}`}>
                                            {option.icon}
                                        </div>
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[13px] font-medium transition-colors ${isSelected ? 'text-white' : 'text-text-primary'}`}>{option.label}</span>
                                                    {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.badge === 'Saved' ? 'green' : option.color)}`}>{option.badge}</span>}
                                                </div>
                                                {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                            </div>
                                            <span className={`text-[11px] block truncate transition-colors ${isSelected ? 'text-white/70' : 'text-text-tertiary'}`}>{option.desc}</span>
                                        </div>
                                        {/* Hover Indicator */}
                                        {!isSelected && <div className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-white/0 group-hover:ring-white/5 pointer-events-none" />}
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
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [disguiseMode, setDisguiseMode] = useState<'terminal' | 'settings' | 'activity' | 'none'>('none');
    const [openOnLogin, setOpenOnLogin] = useState(false);
    const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'uptodate' | 'error'>('idle');
    const themeDropdownRef = React.useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
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
        if (window.electronAPI?.onDisguiseChanged) {
            const unsubscribe = window.electronAPI.onDisguiseChanged((newMode: any) => {
                setDisguiseMode(newMode);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
                setIsThemeDropdownOpen(false);
            }
        };

        if (isThemeDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isThemeDropdownOpen]);

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false';
    });

    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});
    const [languageOptions, setLanguageOptions] = useState<any[]>([]);

    useEffect(() => {
        const loadLanguages = async () => {
            if (window.electronAPI?.getRecognitionLanguages) {
                const langs = await window.electronAPI.getRecognitionLanguages();
                setAvailableLanguages(langs);

                // Define the specific order and labels requested by user
                const desiredOrder = [
                    { key: 'english-india', label: 'English (India)' },
                    { key: 'english-us', label: 'English (United States)' },
                    { key: 'english-uk', label: 'English (United Kingdom)' },
                    { key: 'english-au', label: 'English (Australia)' },
                    { key: 'english-ca', label: 'English (Canada)' },
                ];

                // Create options list starting with Auto
                const options = [
                    {
                        deviceId: 'auto',
                        label: 'Auto (Recommended)',
                        kind: 'audioinput' as MediaDeviceKind,
                        groupId: '',
                        toJSON: () => ({})
                    }
                ];

                // Add the rest if they exist in backend response
                desiredOrder.forEach(({ key, label }) => {
                    if (langs[key]) {
                        options.push({
                            deviceId: key,
                            label: label, // Use requested label
                            kind: 'audioinput' as MediaDeviceKind,
                            groupId: '',
                            toJSON: () => ({})
                        });
                    }
                });

                setLanguageOptions(options);

                // Load stored preference
                const stored = localStorage.getItem('natively_recognition_language');

                // If stored is 'auto' or not set, default to 'auto'
                if (!stored || stored === 'auto') {
                    setRecognitionLanguage('auto');
                    // We still need to set the actual backend language based on system locale
                    // But for UI, we show 'auto'
                    applyAutoLanguage(langs);
                } else if (langs[stored]) {
                    setRecognitionLanguage(stored);
                } else {
                    // Fallback if stored key no longer exists
                    setRecognitionLanguage('auto');
                    applyAutoLanguage(langs);
                }
            }
        };
        loadLanguages();
    }, []);

    const applyAutoLanguage = (langs: any) => {
        const systemLocale = navigator.language;
        let match = 'english-us';

        // Logic to find best match from available langs
        for (const [key, config] of Object.entries(langs)) {
            if ((config as any).primary === systemLocale || (config as any).alternates.includes(systemLocale)) {
                match = key;
                break;
            }
        }
        if (systemLocale === 'en-IN') match = 'english-india';

        // Send actual code to backend, but keep UI as 'auto' (handled by separating state if needed, 
        // but here 'recognitionLanguage' state tracks the dropdown value)
        if (window.electronAPI?.setRecognitionLanguage) {
            window.electronAPI.setRecognitionLanguage(match);
        }
    };

    const handleLanguageChange = (key: string) => {
        setRecognitionLanguage(key);
        localStorage.setItem('natively_recognition_language', key);

        if (key === 'auto') {
            applyAutoLanguage(availableLanguages);
        } else {
            if (window.electronAPI?.setRecognitionLanguage) {
                window.electronAPI.setRecognitionLanguage(key);
            }
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
    const [useLegacyAudio, setUseLegacyAudio] = useState(false);

    // STT Provider settings
    const [sttProvider, setSttProvider] = useState<'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson'>('google');
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
    const [hasStoredSttGroqKey, setHasStoredSttGroqKey] = useState(false);
    const [hasStoredSttOpenaiKey, setHasStoredSttOpenaiKey] = useState(false);
    const [hasStoredDeepgramKey, setHasStoredDeepgramKey] = useState(false);
    const [hasStoredElevenLabsKey, setHasStoredElevenLabsKey] = useState(false);
    const [hasStoredAzureKey, setHasStoredAzureKey] = useState(false);
    const [hasStoredIbmWatsonKey, setHasStoredIbmWatsonKey] = useState(false);
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
                    setSttProvider(creds.sttProvider || 'google');
                    if (creds.groqSttModel) setGroqSttModel(creds.groqSttModel);
                    setGoogleServiceAccountPath(creds.googleServiceAccountPath);
                    setHasStoredSttGroqKey(creds.hasSttGroqKey);
                    setHasStoredSttOpenaiKey(creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(creds.hasElevenLabsKey);
                    setHasStoredAzureKey(creds.hasAzureKey);
                    if (creds.azureRegion) setSttAzureRegion(creds.azureRegion);
                    setHasStoredIbmWatsonKey(creds.hasIbmWatsonKey);
                }
            } catch (e) {
                console.error('Failed to load STT settings:', e);
            }
        };
        if (isOpen) loadSttSettings();
    }, [isOpen]);

    const handleSttProviderChange = async (provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson') => {
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

    const handleSttKeySubmit = async (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson', key: string) => {
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
                await window.electronAPI?.setOpenaiSttApiKey?.(key.trim());
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.(key.trim());
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.(key.trim());
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.(key.trim());
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.(key.trim());
            }
            if (provider === 'groq') setHasStoredSttGroqKey(true);
            else if (provider === 'openai') setHasStoredSttOpenaiKey(true);
            else if (provider === 'elevenlabs') setHasStoredElevenLabsKey(true);
            else if (provider === 'azure') setHasStoredAzureKey(true);
            else if (provider === 'ibmwatson') setHasStoredIbmWatsonKey(true);
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

    const handleTestSttConnection = async () => {
        if (sttProvider === 'google') return;
        const keyMap: Record<string, string> = {
            groq: sttGroqKey, openai: sttOpenaiKey, deepgram: sttDeepgramKey,
            elevenlabs: sttElevenLabsKey, azure: sttAzureKey, ibmwatson: sttIbmKey,
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

    const audioContextRef = React.useRef<AudioContext | null>(null);
    const analyserRef = React.useRef<AnalyserNode | null>(null);
    const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
    const rafRef = React.useRef<number | null>(null);
    const streamRef = React.useRef<MediaStream | null>(null);

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

            // Load Legacy Audio pref
            const savedLegacy = localStorage.getItem('useLegacyAudioBackend') === 'true';
            setUseLegacyAudio(savedLegacy);

            // Load Calendar Status
            if (window.electronAPI?.getCalendarStatus) {
                window.electronAPI.getCalendarStatus().then(setCalendarStatus);
            }
        }
    }, [isOpen, selectedInput, selectedOutput]); // Re-run if isOpen changes, or if selected devices are cleared

    // Effect for real-time audio level monitoring
    useEffect(() => {
        if (isOpen && activeTab === 'audio') {
            let mounted = true;

            const startAudio = async () => {
                try {
                    // Cleanup previous audio context if it exists
                    if (audioContextRef.current) {
                        audioContextRef.current.close();
                    }

                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: selectedInput ? { exact: selectedInput } : undefined
                        }
                    });

                    streamRef.current = stream;

                    if (!mounted) return;

                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const analyser = audioContext.createAnalyser();
                    const source = audioContext.createMediaStreamSource(stream);

                    analyser.fftSize = 256;
                    source.connect(analyser);

                    audioContextRef.current = audioContext;
                    analyserRef.current = analyser;
                    sourceRef.current = source;

                    const dataArray = new Uint8Array(analyser.frequencyBinCount);
                    let smoothLevel = 0;

                    const updateLevel = () => {
                        if (!mounted || !analyserRef.current) return;
                        // Use Time Domain Data for accurate volume (waveform) instead of frequency
                        analyserRef.current.getByteTimeDomainData(dataArray);

                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) {
                            // Convert 0-255 to -1 to 1 range
                            const value = (dataArray[i] - 128) / 128;
                            sum += value * value;
                        }

                        // Calculate RMS
                        const rms = Math.sqrt(sum / dataArray.length);

                        // Convert to simpler 0-100 range with some boost
                        // RMS is usually very small (0.01 - 0.5 for normal speech)
                        // Logarithmic scaling feels more natural for volume
                        const db = 20 * Math.log10(rms);
                        // Approximate mapping: -60dB (silence) to 0dB (max) -> 0 to 100
                        const targetLevel = Math.max(0, Math.min(100, (db + 60) * 2));

                        // Apply smoothing
                        if (targetLevel > smoothLevel) {
                            smoothLevel = smoothLevel * 0.7 + targetLevel * 0.3; // Fast attack
                        } else {
                            smoothLevel = smoothLevel * 0.95 + targetLevel * 0.05; // Slow decay
                        }

                        setMicLevel(smoothLevel);

                        rafRef.current = requestAnimationFrame(updateLevel);
                    };

                    updateLevel();
                } catch (error) {
                    console.error("Error accessing microphone:", error);
                    setMicLevel(0); // Reset level on error
                }
            };

            startAudio();

            return () => {
                mounted = false;
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                if (sourceRef.current) sourceRef.current.disconnect();
                if (audioContextRef.current) {
                    audioContextRef.current.close();
                    audioContextRef.current = null;
                }
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
                setMicLevel(0); // Reset mic level on cleanup
            };
        } else {
            // Cleanup when closing tab or overlay or switching away from audio tab
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (sourceRef.current) sourceRef.current.disconnect(); // Disconnect source as well
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            setMicLevel(0);
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
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8"
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 10 }}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        className="bg-bg-elevated w-full max-w-4xl h-[80vh] rounded-2xl border border-border-subtle shadow-2xl flex overflow-hidden"
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
                        <div className="flex-1 overflow-y-auto bg-bg-main p-8">
                            {activeTab === 'general' && (
                                <div className="space-y-6 animated fadeIn">
                                    <div className="space-y-3.5">
                                        {/* UndetectableToggle */}
                                        <div className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isUndetectable ? 'shadow-lg shadow-blue-500/10' : ''}`}>
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
                                                className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${isUndetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                            >
                                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isUndetectable ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">General settings</h3>
                                            <p className="text-xs text-text-secondary mb-2">Customize how Natively works for you</p>

                                            <div className="space-y-4">
                                                {/* Open at Login */}
                                                <div className="flex items-center justify-between">
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
                                                        className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${openOnLogin ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${openOnLogin ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>

                                                {/* Interviewer Transcript */}
                                                <div className="flex items-center justify-between">
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
                                                        className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${showTranscript ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${showTranscript ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>


                                                {/* Theme */}
                                                <div className="flex items-center justify-between">
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
                                                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[100px] justify-between"
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
                                                            <div className="absolute right-0 top-full mt-1 w-full bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none">
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

                                                {/* Version */}
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex items-start gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                            <BadgeCheck size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Version</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">
                                                                You are currently using Natively version 1.0.1.
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

                                    </div>

                                    {/* Process Disguise */}
                                    {/* Process Disguise */}
                                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
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

                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { id: 'none', label: 'None (Default)', icon: <Layout size={14} /> },
                                                { id: 'terminal', label: 'Terminal', icon: <Terminal size={14} /> },
                                                { id: 'settings', label: 'System Settings', icon: <Settings size={14} /> },
                                                { id: 'activity', label: 'Activity Monitor', icon: <Activity size={14} /> }
                                            ].map((option) => (
                                                <button
                                                    key={option.id}
                                                    onClick={() => {
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
                                                        }`}
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
                            {activeTab === 'keybinds' && (
                                <div className="space-y-5 animated fadeIn select-text h-full flex flex-col justify-center">
                                    <div>
                                        <h3 className="text-lg font-bold text-text-primary mb-1">Keyboard shortcuts</h3>
                                        <p className="text-xs text-text-secondary">Natively works with these easy to remember commands.</p>
                                    </div>

                                    <div className="grid gap-6">
                                        {/* General Category */}
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary mb-3">General</h4>
                                            <div className="space-y-1">
                                                {[
                                                    { label: 'Toggle Visibility', keys: ['⌘', 'B'], icon: <Eye size={14} /> },
                                                    { label: 'Show/Center Natively', keys: ['⌘', '⇧', 'Space'], icon: <Layout size={14} /> },
                                                    { label: 'Process Screenshots', keys: ['⌘', 'Enter'], icon: <MessageSquare size={14} /> },
                                                    { label: 'Reset / Cancel', keys: ['⌘', 'R'], icon: <RotateCcw size={14} /> },
                                                    { label: 'Take Screenshot', keys: ['⌘', 'H'], icon: <Camera size={14} /> },
                                                    { label: 'Selective Screenshot', keys: ['⌘', '⇧', 'H'], icon: <Crop size={14} /> },
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors">{item.icon}</span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            {item.keys.map((k, j) => (
                                                                <span key={j} className="bg-bg-input text-text-secondary px-2 py-1 rounded-md text-xs font-sans min-w-[24px] text-center shadow-sm border border-border-subtle">
                                                                    {k}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Window Category */}
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary mb-3">Window</h4>
                                            <div className="space-y-1">
                                                {[
                                                    { label: 'Move Window Up', keys: ['⌘', '↑'], icon: <ArrowUp size={14} /> },
                                                    { label: 'Move Window Down', keys: ['⌘', '↓'], icon: <ArrowDown size={14} /> },
                                                    { label: 'Move Window Left', keys: ['⌘', '←'], icon: <ArrowLeft size={14} /> },
                                                    { label: 'Move Window Right', keys: ['⌘', '→'], icon: <ArrowRight size={14} /> }
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors">{item.icon}</span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            {item.keys.map((k, j) => (
                                                                <span key={j} className="bg-bg-input text-text-secondary px-2 py-1 rounded-md text-xs font-sans min-w-[24px] text-center shadow-sm border border-border-subtle">
                                                                    {k}
                                                                </span>
                                                            ))}
                                                        </div>
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
                                                            { id: 'google', label: 'Google Cloud', badge: googleServiceAccountPath ? 'Saved' : 'Default', desc: 'gRPC streaming via Service Account', color: 'blue', icon: <Mic size={14} /> },
                                                            { id: 'groq', label: 'Groq Whisper', badge: hasStoredSttGroqKey ? 'Saved' : 'Fast', desc: 'Ultra-fast REST transcription', color: 'orange', icon: <Mic size={14} /> },
                                                            { id: 'openai', label: 'OpenAI Whisper', badge: hasStoredSttOpenaiKey ? 'Saved' : null, desc: 'OpenAI-compatible Whisper API', color: 'green', icon: <Mic size={14} /> },
                                                            { id: 'deepgram', label: 'Deepgram Nova-2', badge: hasStoredDeepgramKey ? 'Saved' : 'Accurate', desc: 'High-accuracy REST transcription', color: 'purple', icon: <Mic size={14} /> },
                                                            { id: 'elevenlabs', label: 'ElevenLabs Scribe', badge: hasStoredElevenLabsKey ? 'Saved' : null, desc: 'High-quality Scribe v1 API', color: 'teal', icon: <Mic size={14} /> },
                                                            { id: 'azure', label: 'Azure Speech', badge: hasStoredAzureKey ? 'Saved' : null, desc: 'Microsoft Cognitive Services STT', color: 'cyan', icon: <Mic size={14} /> },
                                                            { id: 'ibmwatson', label: 'IBM Watson', badge: hasStoredIbmWatsonKey ? 'Saved' : null, desc: 'IBM Watson cloud STT service', color: 'indigo', icon: <Mic size={14} /> },
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
                                                        {sttProvider === 'groq' ? 'Groq' : sttProvider === 'openai' ? 'OpenAI' : sttProvider === 'elevenlabs' ? 'ElevenLabs' : sttProvider === 'azure' ? 'Azure' : sttProvider === 'ibmwatson' ? 'IBM Watson' : 'Deepgram'} API Key
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="password"
                                                            value={
                                                                sttProvider === 'groq' ? sttGroqKey
                                                                    : sttProvider === 'openai' ? sttOpenaiKey
                                                                        : sttProvider === 'elevenlabs' ? sttElevenLabsKey
                                                                            : sttProvider === 'azure' ? sttAzureKey
                                                                                : sttProvider === 'ibmwatson' ? sttIbmKey
                                                                                    : sttDeepgramKey
                                                            }
                                                            onChange={(e) => {
                                                                if (sttProvider === 'groq') setSttGroqKey(e.target.value);
                                                                else if (sttProvider === 'openai') setSttOpenaiKey(e.target.value);
                                                                else if (sttProvider === 'elevenlabs') setSttElevenLabsKey(e.target.value);
                                                                else if (sttProvider === 'azure') setSttAzureKey(e.target.value);
                                                                else if (sttProvider === 'ibmwatson') setSttIbmKey(e.target.value);
                                                                else setSttDeepgramKey(e.target.value);
                                                            }}
                                                            placeholder={
                                                                sttProvider === 'groq'
                                                                    ? (hasStoredSttGroqKey ? '••••••••••••' : 'Enter Groq API key')
                                                                    : sttProvider === 'openai'
                                                                        ? (hasStoredSttOpenaiKey ? '••••••••••••' : 'Enter OpenAI API key')
                                                                        : sttProvider === 'elevenlabs'
                                                                            ? (hasStoredElevenLabsKey ? '••••••••••••' : 'Enter ElevenLabs API key')
                                                                            : sttProvider === 'azure'
                                                                                ? (hasStoredAzureKey ? '••••••••••••' : 'Enter Azure API key')
                                                                                : sttProvider === 'ibmwatson'
                                                                                    ? (hasStoredIbmWatsonKey ? '••••••••••••' : 'Enter IBM Watson API key')
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

                                            {/* Accent Preference */}
                                            <CustomSelect
                                                label="Preferred English Accent"
                                                icon={null}
                                                value={recognitionLanguage}
                                                options={languageOptions}
                                                onChange={handleLanguageChange}
                                                placeholder="Select Accent"
                                            />
                                            <div className="flex gap-2 items-center -mt-2 px-1">
                                                <Info size={14} className="text-text-secondary shrink-0" />
                                                <p className="text-xs text-text-secondary whitespace-nowrap">
                                                    Improves accuracy by prioritizing your accent. Other English accents are still supported.
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

                                            {/* CoreAudio Beta Toggle */}
                                            <div className="bg-amber-500/5 rounded-xl border border-amber-500/20 p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-start gap-3">
                                                        <div className="mt-0.5 p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                                                            <FlaskConical size={18} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                <h3 className="text-sm font-bold text-text-primary">CoreAudio Backend</h3>
                                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-600 uppercase tracking-wide">Beta</span>
                                                            </div>
                                                            <p className="text-xs text-text-secondary leading-relaxed max-w-[300px]">
                                                                Legacy audio capture method. Use only if you experience issues with the default engine.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !useLegacyAudio;
                                                            setUseLegacyAudio(newState);
                                                            window.localStorage.setItem('useLegacyAudioBackend', newState ? 'true' : 'false');
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors shrink-0 ${useLegacyAudio ? 'bg-amber-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${useLegacyAudio ? 'translate-x-5' : 'translate-x-0'}`} />
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
                                                    className="bg-[#303033] hover:bg-[#3A3A3D] text-white px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2.5"
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

                            {activeTab === 'about' && (
                                <AboutSection />
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )
            }
        </AnimatePresence >
    );
};

export default SettingsOverlay;
