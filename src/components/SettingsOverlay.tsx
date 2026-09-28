import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { LANG_NATIVE_NAMES, useLanguage, useT } from '../i18n';
import { CalendarSettings } from './settings/CalendarSettings';
import packageJson from '../../package.json';
import {
    X, Mic, Speaker, Monitor, Keyboard, User, LifeBuoy, LogOut, Upload,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    Camera, RotateCcw, Eye, Layout, MessageSquare, Crop,
    ChevronDown, ChevronUp, Check, BadgeCheck, Power, Palette, Calendar, Ghost, Sun, Moon, RefreshCw, Info, Globe, FlaskConical, Terminal, Download, Settings, Activity, ExternalLink, Trash2,
    Sparkles, Pencil, Briefcase, Building2, Search, MapPin, CheckCircle, HelpCircle, Zap, SlidersHorizontal, PointerOff, Folder,
    Star, AlertCircle, Gift, Smartphone, Cpu, Shield, Code2, Headphones, Boxes, Languages, Volume2, KeyRound, Loader2, CornerDownRight
} from 'lucide-react';
import { AutoAnswerIcon } from './AutoAnswerIcon';
import { HiCreditCard } from 'react-icons/hi2';
import { analytics } from '../lib/analytics/analytics.service';
import { AboutSection } from './AboutSection';
import { ErrorBoundary } from './ErrorBoundary';
import { HelpSettings } from './settings/HelpSettings';
import { AIProvidersSettings, AIP_CSS, AipModelList, AipPassedCheck } from './settings/AIProvidersSettings';
import { PlansSettings } from './settings/PlansSettings';
import { PhoneMirrorSettings } from './settings/PhoneMirrorSettings';
import { RetrievalSettings } from './settings/RetrievalSettings';
import { IntelligenceSettings } from './settings/IntelligenceSettings';
import { SkillsSettings } from './settings/SkillsSettings';
import { LocalWhisperModelPanel, type ChannelConfig as LocalWhisperChannelConfig } from './LocalWhisperModelPanel';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useShortcuts } from '../hooks/useShortcuts';
import { isMac, isWindows } from '../utils/platformUtils';
import { SettingsToggle } from './settings/SettingsToggle';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import {
    clampOverlayOpacity,
    getOverlayAppearance,
    getGlassOverlayAppearance,
    OVERLAY_OPACITY_DEFAULT,
    OVERLAY_OPACITY_MIN,
    getDefaultOverlayOpacity,
} from '../lib/overlayAppearance';
import { getMeetingInterfaceTheme, setMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import { KeyRecorder } from './ui/KeyRecorder';
import { useConfirmDialog } from './ui/ConfirmDialog';
import { ModelSelectorLabel } from './ui/ModelSelectorLabel';
import { MODEL_SELECTOR_WIDTH } from './ui/modelSelectorLabelText';
import { Disclosure, DisclosureChevron } from './ui/AccordionSection';
import { Presence, SettingsMenu, SettingsMotionReady } from './settings/SettingsRow';
import { ProfileVisualizer } from '../premium';
import GlassEffectLayer from './ui/GlassEffectLayer';
import { GenieModal } from './ui/GenieModal';
import { BrandMark, BrandMonogram } from './ui/BrandMark';
import { LiquidGlassBadge } from '../ui-components/LiquidGlassBadge';
import { LiquidGlassButton } from '../ui-components/LiquidGlassButton';
import icon from './icon.png';

// Process Disguise tiles: Liquid Glass fed this card's own tokens. `.lg-action`
// otherwise reads the legacy action blue, and `.lg-clear`'s defaults are the
// modes sidebar's weights, not a tile sitting on --bg-item-surface / --bg-card.
//
// The shape is the tile the material replaced, not a pill: 58px (p-3 around a
// 32px icon chip, plus the old 1px border), rounded-lg, left-aligned. A rounded
// rect needs the cap fade as px stops that end at the 8px corner — percentage
// stops would run the specular's ramp far across the flat top (design.md,
// "Adapting it to an existing UI").
const DISGUISE_TILE_SHAPE = {
    '--lg-pill-h': '58px',
    '--lg-radius': '8px',
    '--lg-cap-0': '1px',
    '--lg-cap-1': '3px',
    '--lg-cap-2': '8px',
    '--lg-icon-gap': '12px',
    '--lg-label-weight': 500,
    padding: '0 12px',
};
const SELECTED_PERIWINKLE = 'var(--accent-primary)';
const SELECTED_PERIWINKLE_LIGHT = 'color-mix(in srgb, var(--periwinkle-200) 50%, var(--periwinkle-300))';
const DISGUISE_TILE_SELECTED = {
    ...DISGUISE_TILE_SHAPE,
    '--legacy-action-bg': SELECTED_PERIWINKLE,
    '--legacy-action-hover': 'var(--accent-hover)',
    '--legacy-action-fg': 'var(--on-accent)',
} as React.CSSProperties;
// Light theme's accent (periwinkle-600) read too heavy as a whole tile, so the
// selected tile takes a pale periwinkle halfway between the 200 and 300 steps.
// A light fill needs the dark foreground (#14102A on it is ~10:1).
// The opacity slider's knob is fed the same two values, so the selected colour
// in this panel is one colour and not two that drift apart.
const DISGUISE_TILE_SELECTED_LIGHT = {
    ...DISGUISE_TILE_SHAPE,
    '--legacy-action-bg': SELECTED_PERIWINKLE_LIGHT,
    '--legacy-action-hover': 'var(--periwinkle-300)',
    '--legacy-action-fg': 'var(--periwinkle-on-accent-dark)',
} as React.CSSProperties;
// `.lg-clear`'s own defaults: a translucent step over the card, so the surface
// shows through and the rim is what the material adds. An opaque fill
// (--bg-input) reads as a solid plate sitting in a hole, not as glass.
const DISGUISE_TILE_RESTING = {
    ...DISGUISE_TILE_SHAPE,
} as React.CSSProperties;
// Shared with the main process so the picker cannot offer a model the ipc
// validator rejects. Pure data module — no node/electron imports.
import { NVIDIA_NIM_STT_MODELS, DEFAULT_NVIDIA_NIM_STT_MODEL, allowedLanguageKeysForNvidiaModel } from '../../electron/audio/nvidiaNimSttModels';
import { STT_MODEL_CATALOG, isEnglishOnlySttModel, type SttModelProvider } from '../../electron/audio/sttModelCatalog';
import { isDefaultOpenAiSttBase } from '../../electron/audio/openaiSttBaseUrl';
import { isRecognitionLanguageOffered, PARAKEET_ONLY_LANGUAGE_KEYS } from '../../electron/config/languages';

// ---------------------------------------------------------------------------
// StarRating — renders filled/empty stars for culture ratings


// ---------------------------------------------------------------------------
// MockupNativelyInterface — fake in-meeting widget for the opacity preview.
// Mirrors NativelyInterface.tsx's own theme resolution (isGlassTheme /
// isModernTheme / data-interface-theme / GlassEffectLayer) so the preview
// actually reflects whichever "Meeting Interface Style" the user has picked,
// instead of always rendering the default theme's appearance.
// ---------------------------------------------------------------------------
const MockupNativelyInterface = ({ opacity, theme }: { opacity: number; theme: MeetingInterfaceTheme }) => {
    const t = useT();
    const resolvedTheme = useResolvedTheme();
    const isGlassTheme = theme === 'liquid-glass';
    const isModernTheme = theme === 'modern';
    const shellRef = React.useRef<HTMLDivElement>(null);
    const appearance = useMemo(
        () => (isGlassTheme ? getGlassOverlayAppearance() : getOverlayAppearance(opacity, resolvedTheme)),
        [opacity, resolvedTheme, isGlassTheme]
    );

    return (
        <div
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none bg-transparent"
            // The "modern" theme's CSS (index.css [data-interface-theme="modern"]
            // .overlay-shell-surface etc.) reads --overlay-opacity directly via
            // calc(), same as the real overlay window (see App.tsx's
            // '--overlay-opacity' inline style) — it does NOT go through
            // appearance.shellStyle. Without setting it here too, the modern
            // theme's preview would silently ignore the slider entirely.
            style={{ ['--overlay-opacity' as '--overlay-opacity']: String(opacity) } as React.CSSProperties}
        >
                {/* NativelyInterface Widget — opacity controlled by the slider.
                    Shifted up enough to clear the opacity-slider-card, which
                    stays visible (and in its normal in-flow position) during
                    the preview — see #opacity-slider-card's z-index override
                    in startPreviewingOpacity(). */}
                <div
                    id="mockup-natively-interface"
                    data-interface-theme={isGlassTheme ? 'liquid-glass' : isModernTheme ? 'modern' : 'default'}
                    className="flex flex-col items-center pointer-events-none -mt-96"
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
                                <span className="opacity-80 tracking-wide">{t('Hide')}</span>
                            </div>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center overlay-icon-surface overlay-text-primary" style={appearance.iconStyle}>
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-red-400 opacity-80" />
                            </div>
                        </div>
                    </div>

                    {/* Main Interface Window Replica */}
                    <div ref={shellRef} className="relative w-[600px] max-w-full overlay-shell-surface overlay-text-primary backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col pt-2 pb-3" style={appearance.shellStyle}>
                        {isGlassTheme && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}

                        {/* Rolling Transcript Bar */}
                        <div className="w-full flex justify-center py-2 px-4 border-b mb-1 overlay-transcript-surface" style={appearance.transcriptStyle}>
                            <p className="text-[13px] truncate max-w-[90%] font-medium overlay-text-primary">
                                <span className="overlay-text-muted mr-2 font-semibold">{t('Interviewer')}</span>
                                <span className="opacity-95">{t('So how would you optimize the current algorithm?')}</span>
                            </p>
                        </div>

                        {/* Chat History Mock */}
                        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                            <div className="flex justify-start">
                                <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal overlay-text-primary">
                                    <span className="font-semibold text-emerald-500 block mb-1">{t('Suggestion')}</span>
                                    {t('A good approach would be to use a hash map to cache the intermediate results, which brings the time complexity down from O(n²) to O(n).')}
                                </div>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <Pencil className="w-3 h-3 opacity-70" /> {t('What to answer?')}
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <MessageSquare className="w-3 h-3 opacity-70" /> {t('Clarify')}
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <RefreshCw className="w-3 h-3 opacity-70" /> {t('Recap')}
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <HelpCircle className="w-3 h-3 opacity-70" /> {t('Follow Up Question')}
                            </div>
                            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium min-w-[74px] shrink-0 border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <Mic className="w-3 h-3 opacity-70" /> {t('Answer')}
                            </div>
                        </div>

                        {/* Input Area */}
                        <div className="px-3">
                            <div className="relative group">
                                <div className="w-full border rounded-xl pl-3 pr-10 py-2.5 h-[38px] flex items-center overlay-input-surface" style={appearance.inputStyle}>
                                    <span className="text-[13px] overlay-text-muted">{t('Ask anything on screen or conversation')}</span>
                                </div>
                            </div>

                            {/* Bottom Row */}
                            <div className="flex items-center justify-between mt-3 px-0.5">
                                <div className="flex items-center gap-1.5">
                                    <div className="flex items-center gap-1 pl-3 pr-1.5 h-7 border rounded-[9px] text-xs font-medium text-left shrink-0 overlay-control-surface overlay-text-interactive" style={{ ...appearance.controlStyle, width: MODEL_SELECTOR_WIDTH }}>
                                        <ModelSelectorLabel>Gemini 3 Flash</ModelSelectorLabel>
                                        <ChevronDown size={12} className="shrink-0" />
                                    </div>
                                    <div className="w-7 h-7 flex items-center justify-center rounded-[9px] border overlay-control-surface overlay-text-muted" style={appearance.controlStyle}>
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

// A button label or result line that changes on a click: Sync's text swap
// (150ms, 4px, 2px blur). Always ready, because these only ever change in
// answer to the user, never when a value arrives over IPC as the pane opens.
const LabelSwap: React.FC<{ id: string | null; children?: React.ReactNode }> = ({ id, children }) => (
    <SettingsMotionReady.Provider value={true}>
        <Presence kind="text" id={id}>{children}</Presence>
    </SettingsMotionReady.Provider>
);

// LabelSwap in a box sized to its widest state, so a button whose label
// changes (Test Connection → Testing… → Connected) keeps one width instead of
// shoving what sits beside it. Every state renders invisibly in one grid cell.
// A spinner is a same-size blank in the sizers: a hidden .animate-spin still
// reads as "loading" to GenieModal's snapshot check.
const SizedLabelSwap: React.FC<{ id: string | null; sizers: React.ReactNode[]; children?: React.ReactNode }> = ({ id, sizers, children }) => (
    <span className="grid place-items-center">
        {sizers.map((node, i) => (
            <span key={i} aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-nowrap">{node}</span>
        ))}
        <span className="col-start-1 row-start-1 whitespace-nowrap">
            <LabelSwap id={id}>{children}</LabelSwap>
        </span>
    </span>
);

// The same swap for a whole description that follows a switch beside it.
const DescriptionSwap: React.FC<{ id: string; children?: React.ReactNode }> = ({ id, children }) => (
    <SettingsMotionReady.Provider value={true}>
        <Presence kind="text" id={id} block>{children}</Presence>
    </SettingsMotionReady.Provider>
);

// AI Providers' Models control for a speech provider: AipModelList itself, so
// the summary, the reveal, the row actions and Set default are that control's
// own. `pickOnly` because a speech provider runs one model at a time: the tick
// marks the model in use, and a row (or its Set default) picks it. Renders
// inside an .aip-root (the key card), which carries AIP_CSS.
const SttModelList: React.FC<{
    models: { id: string; label: string; description?: string }[];
    value: string;
    onSelect: (id: string) => void;
}> = ({ models, value, onSelect }) => (
    <AipModelList
        pickOnly
        catalogIsComplete
        models={models}
        enabled={[]}
        onToggle={() => {}}
        onReset={() => {}}
        defaultId={value}
        onSetDefault={onSelect}
    />
);

interface CustomSelectProps {
    label: string;
    value: string;
    options: MediaDeviceInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
    /** Greys the control out and blocks the dropdown — used when the active
     *  local STT model doesn't accept this setting (see modelLanguageSupport). */
    disabled?: boolean;
    /** Optional right-aligned tag per option, keyed by deviceId. Used to mark
     *  Apple Speech languages as already installed vs downloaded on first use,
     *  so the wait is visible BEFORE a meeting starts rather than as a silent
     *  pause afterwards. Kept out of `label` because the label span truncates. */
    badges?: Record<string, string>;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ label, value, options, onChange, placeholder = "Select device", disabled = false, badges }) => {
    const t = useT();
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

    // Escape closes an open menu and hands focus back to its trigger.
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setIsOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [isOpen]);

    const selectedLabel = options.find(o => o.deviceId === value)?.label || placeholder;

    return (
        <div className="bg-bg-card rounded-xl p-4 border border-border-subtle" ref={containerRef}>
            {label && (
                // A quiet caption over the value: secondary grey, no glyph. An icon
                // on every card repeated its own label and was most of the pane's
                // visual noise; the value is what the eye should land on.
                <div className="flex items-center gap-2 mb-3">
                    <label className="text-xs font-medium text-text-secondary uppercase tracking-wide truncate">{label}</label>
                </div>
            )}

            <div className="relative">
                <button
                    ref={triggerRef}
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                    disabled={disabled}
                    aria-disabled={disabled}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    className={`w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary flex items-center justify-between transition-colors outline-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-bg-elevated'}`}
                >
                    <span className="truncate pr-4">{selectedLabel}</span>
                    <ChevronDown size={14} className={`text-text-secondary transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                <SettingsMenu open={isOpen && !disabled} origin="top" className="absolute top-full left-0 w-full mt-1 bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
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
                                <span className="flex items-center gap-2 shrink-0 pl-2">
                                    {badges?.[device.deviceId] && (
                                        <span className="text-[10px] uppercase tracking-wide text-text-secondary/80 whitespace-nowrap">
                                            {badges[device.deviceId]}
                                        </span>
                                    )}
                                    {value === device.deviceId && <Check size={14} className="text-accent-primary" />}
                                </span>
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-500 italic">{t('No devices found')}</div>
                        )}
                    </div>
                </SettingsMenu>
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
    /** Row carries an official brand mark, so its tile drops the per-provider
     *  tint and goes neutral — a mark in its own brand colours cannot sit on a
     *  coloured wash without reading as an accident. Monogram rows keep the
     *  tint, which is the only colour they have. */
    neutralTile?: boolean;
    /** Explicit tile classes, overriding both the tint and `neutralTile`. For a
     *  monogram that has to reproduce a specific brand treatment rather than a
     *  generic tint. */
    tileClassName?: string;
}

interface ProviderSelectProps {
    value: string;
    options: ProviderOption[];
    onChange: (value: string) => void;
}

const ProviderSelect: React.FC<ProviderSelectProps> = ({ value, options, onChange }) => {
    const t = useT();
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

    // Escape closes an open menu and hands focus back to its trigger.
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setIsOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [isOpen]);

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

    const getIconStyle = (color?: string, isSelectedItem: boolean = false, neutralTile: boolean = false, tileClassName?: string) => {
        if (isSelectedItem) return 'bg-accent-primary text-on-accent shadow-sm';
        // An explicit brand treatment wins over both the tint and the neutral tile.
        if (tileClassName) return tileClassName;
        // A row showing an official brand mark gets a neutral surface so the mark
        // renders in its own colours. Mirrors `.aip-tile--mark` in the AI Providers
        // panel, which likewise reserves the brand tint for monogram tiles.
        if (neutralTile) return 'bg-bg-input border border-border-subtle text-text-primary';
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
                ref={triggerRef}
                onClick={() => setIsOpen(!isOpen)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                // focus-visible, not focus: a mouse click left the 2px ring on
                // the trigger after the menu had closed, until something else
                // took focus. Keyboard focus still gets it.
                className={`w-full group bg-bg-input border border-border-subtle hover:border-border-muted shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-[border-color,box-shadow] duration-150 ease-out outline-none ${isOpen ? 'ring-2 ring-accent-border border-accent-focus' : 'hover:shadow-md'}`}
            >
                {selected ? (
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-colors duration-200 ${getIconStyle(selected.color, false, selected.neutralTile, selected.tileClassName)}`}>
                            {selected.icon}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                {selected.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.badge === 'Saved' ? 'green' : selected.color)}`}>{t(selected.badge)}</span>}
                            </div>
                            {/* Short description for trigger */}
                            <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                        </div>
                    </div>
                ) : <span className="text-text-secondary px-2 text-sm">{t('Select Provider')}</span>}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-[transform,background-color,color] duration-[250ms] ease-sculpted motion-reduce:transition-none group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                    <ChevronDown size={14} strokeWidth={2.5} />
                </div>
            </button>

            <SettingsMenu
                open={isOpen}
                origin="top"
                className={`absolute top-full left-0 w-full mt-2 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden ring-1 ring-black/5 ${isLight ? 'bg-bg-elevated border border-border-subtle' : 'bg-[color:color-mix(in_srgb,var(--bg-elevated)_90%,transparent)] border border-white/5'}`}
            >
                <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                    {options.map(option => {
                        const isSelected = value === option.id;
                        return (
                            <button
                                key={option.id}
                                onClick={() => { onChange(option.id); setIsOpen(false); }}
                                className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-[background-color,box-shadow] duration-150 ease-out group relative ${isSelected ? (isLight ? 'bg-bg-item-active shadow-inner' : 'bg-white/10 shadow-inner') : (isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/5')}`}
                            >
                                {/* The mark holds still on hover: the row's own fill and ring
                                    already answer the pointer, and a tile that grew under it
                                    made every pass down the list twitch. */}
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getIconStyle(option.color, false, option.neutralTile, option.tileClassName)}`}>
                                    {option.icon}
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[13px] font-medium transition-colors ${isSelected && !isLight ? 'text-white' : 'text-text-primary'}`}>{option.label}</span>
                                            {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.badge === 'Saved' ? 'green' : option.color)}`}>{t(option.badge)}</span>}
                                        </div>
                                        {isSelected && <Check size={14} className="text-accent-primary" strokeWidth={3} />}
                                    </div>
                                    <span className={`text-[11px] block truncate transition-colors ${isSelected && !isLight ? 'text-white/70' : 'text-text-tertiary'}`}>{option.desc}</span>
                                </div>
                                {/* Hover Indicator */}
                                {!isSelected && <div className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-transparent group-hover:ring-border-subtle pointer-events-none" />}
                            </button>
                        );
                    })}
                </div>
            </SettingsMenu>
        </div>
    );
};

/* Sidebar order, top to bottom. Drives the DIRECTION of the panel transition:
   moving down the sidebar enters the new panel from below, moving up enters it
   from above, so the motion stays spatially consistent with the nav. Any id not
   in this list (deep-links from HelpSettings) falls back to the downward
   direction rather than guessing. Keep in sync with the <nav> below. */
const SETTINGS_NAV_ORDER = [
    'general',
    'plans',
    'ai-providers',
    'retrieval',
    'audio',
    'calendar',
    'skills',
    'keybinds',
    'phone-mirror',
    'intelligence',
    'help',
    'about',
];

/* Retrieval absorbed the old Embeddings and Reranker panels. Both ids are kept
   as aliases rather than repointed at the call site: AI Providers' lightweight
   notice is specifically about embeddings and should land on the Embedding
   sub-tab, not at the top of a combined page. */
// The Settings card's drop shadow (#settings-panel-wrapper in index.css for
// light, shadow-2xl for dark), carried by GenieModal's stand-in mid-genie.
const SETTINGS_SHADOW_LIGHT = '0 20px 60px rgba(0,0,0,0.10), 0 6px 16px rgba(0,0,0,0.06)';
const SETTINGS_SHADOW_DARK = '0 25px 50px -12px rgba(0,0,0,0.25)';

const isRetrievalTab = (tab: string) =>
    tab === 'retrieval' || tab === 'embedding' || tab === 'reranker';

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: string;
    /**
     * Bumped by App on every open request, including a repeat of the tab that
     * is already active. It is what makes the sync effect below re-assert
     * instead of bailing on an unchanged `initialTab`.
     */
    initialTabSeq?: number;
    initialIsPremium?: boolean | null;
    initialHasNativelyKey?: boolean;
    /** Close without the genie: the Modes / Profile manager is taking over. */
    closeInstantly?: boolean;
    /** Setup & Help's "Pick a mode" / "Add your résumé": hand over to that manager. */
    onOpenModes?: () => void;
    onOpenProfile?: () => void;
}

/**
 * Where each speech provider issues API keys. The "Get API Key" button reads
 * this; a provider missing from it used to render a link that did NOTHING when
 * clicked — soniox and nvidia_nim were both in that state — so the button is now
 * hidden unless there is somewhere to send the user.
 *
 * nvidia_nim points at the SPEECH catalogue rather than a settings page:
 * build.nvidia.com/settings/api-keys 404s (it returns the SPA's not-found
 * shell), and NVIDIA issues keys from a model card's "Generate API Key" button,
 * so /explore/speech is both a working URL and the right context for an ASR key.
 */
const STT_KEY_URLS: Record<string, string> = {
    groq: 'https://console.groq.com/keys',
    openai: 'https://platform.openai.com/api-keys',
    deepgram: 'https://console.deepgram.com',
    elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
    azure: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeech',
    ibmwatson: 'https://cloud.ibm.com/catalog/services/speech-to-text',
    soniox: 'https://console.soniox.com/api-keys',
    nvidia_nim: 'https://build.nvidia.com/explore/speech',
};

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
    isOpen,
    onClose,
    initialTab = 'general',
    initialTabSeq = 0,
    initialIsPremium = null,
    initialHasNativelyKey = false,
    closeInstantly = false,
    onOpenModes,
    onOpenProfile,
}) => {
    const resolvedTheme = useResolvedTheme();
    const isLight = resolvedTheme === 'light';
    const { t, lang, setLang } = useLanguage();
    const [activeTab, setActiveTab] = useState(initialTab);
    // In-window confirms only: see ConfirmDialog.tsx for why never confirm().
    const { confirm: askConfirm, dialog: confirmDialog } = useConfirmDialog();

    /* ---------------------------------------------------------------- */
    /* Section transition                                                */
    /* ---------------------------------------------------------------- */
    const reduceMotion = useReducedMotion() ?? false;

    /* 'plans' / 'natively-api' / 'natively-pro' all render the SAME
       <PlansSettings/>. Keying the panel on activeTab would remount it (and
       drop its internal state) when moving between them, so they collapse to
       one key — no remount, no transition, which is correct: the content
       didn't change. */
    /* Same collapse for the two legacy Retrieval ids: they render the SAME
       <RetrievalSettings/>, differing only in which sub-tab opens, so they must
       not read as a section change. Keying on activeTab would play a full panel
       transition for a deep link that only moves the inner pill — and would put
       'embedding'/'reranker' outside SETTINGS_NAV_ORDER, losing the direction. */
    const panelKey = (activeTab === 'natively-api' || activeTab === 'natively-pro')
        ? 'plans'
        : isRetrievalTab(activeTab)
            ? 'retrieval'
            : activeTab;

    /* Read the previous key during render, write it in an effect — mutating a
       ref while rendering double-fires under StrictMode. */
    const prevPanelKeyRef = useRef(panelKey);
    const prevPanelIdx = SETTINGS_NAV_ORDER.indexOf(prevPanelKeyRef.current);
    const curPanelIdx = SETTINGS_NAV_ORDER.indexOf(panelKey);
    const panelDirection = (prevPanelIdx === -1 || curPanelIdx === -1 || curPanelIdx >= prevPanelIdx) ? 1 : -1;
    useEffect(() => { prevPanelKeyRef.current = panelKey; }, [panelKey]);
    /* The children's stagger follows the container's direction (see
       settings-stagger-in in src/index.css). Pinned per section: panelDirection
       reads 1 again on the next render, and a var that flipped mid-cascade
       would jump every child still animating. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const staggerDy = useMemo(() => `${panelDirection * 7}px`, [panelKey]);

    /* The modal wrapper already springs in on open (scale 0.94→1, y 20→0).
       Letting the panel play its own enter animation on that same frame stacks
       two motions on the same pixels and reads as a wobble, so the panel
       animates only on a genuine section CHANGE. `isOpen` false→true renders
       once with this still false; the effect arms it afterwards. */
    const settingsWasOpenRef = useRef(false);
    useEffect(() => { settingsWasOpenRef.current = isOpen; }, [isOpen]);

    /* Set by the initialTab sync effect below when Settings is deep-linked open
       to a non-default section, and cleared once that section has rendered. */
    const suppressPanelAnimRef = useRef(false);
    useEffect(() => { suppressPanelAnimRef.current = false; }, [panelKey]);

    const animatePanel = settingsWasOpenRef.current && isOpen && !suppressPanelAnimRef.current;

    /* The scroll container outlives the section swap, so without this a tab
       switched to from a scrolled position would open mid-page. Layout effect,
       not effect: reset before paint or the old offset flashes. */
    const panelScrollRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0;
    }, [panelKey]);

    /* Active state is painted by ONE shared pill that projects between items
       (layoutId), so the item itself must not carry `bg-bg-item-active` — an
       instant background under a moving pill cancels the movement out. */
    const navItemClass = (active: boolean, size = 'text-sm') =>
        `w-full text-left px-3 py-2 rounded-lg ${size} font-medium flex items-center gap-3 relative isolate transition-colors duration-150 ease-out ${active
            ? 'text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-[color:color-mix(in_srgb,var(--bg-item-active)_50%,transparent)]'}`;

    /* `isolate` on the button + `-z-10` here puts the pill above the button's
       own background box but below its inline content (icon + label), so the
       label stays readable without wrapping every child in a z-indexed span.
       layoutId resolves GLOBALLY in framer-motion — this id must stay unique
       across the app. `initial={false}` so it doesn't fly in from nowhere on
       first paint. Spring matches the existing pill in MeetingDetails.tsx. */
    const navActivePill = (
        <motion.span
            layoutId="settingsNavActivePill"
            className="absolute inset-0 -z-10 rounded-lg bg-bg-item-active"
            initial={false}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
        />
    );

    /* The retrieval sub-tab a deep link is asking for, captured as ONE value.
     *
     * It must not be derived from `activeTab` at render time. `activeTab` and
     * the nav sequence update on DIFFERENT renders, and reading them as two
     * independent props let a stale pair through: bumping the sequence for a
     * plain 'retrieval' request re-applied the PREVIOUS request's 'embedding'
     * one render before activeTab caught up, throwing away the user's sub-tab.
     * Caught by a regression guard on 2026-09-15. Target and sequence are now
     * written together, from `initialTab`, which is the request itself. */
    const [retrievalRequest, setRetrievalRequest] = useState<{ tab?: 'embedding' | 'reranker'; seq: number }>({ seq: 0 });

    // Sync active tab when modal opens
    useEffect(() => {
        if (isOpen && initialTab) {
            /* Deep-link open (App.tsx openSettingsExclusive('plans') and friends)
               lands the tab switch one render AFTER the arming effect above, so
               `animatePanel` would be true and the panel would slide-fade on top
               of the modal's spring-in — the exact double-motion the guard exists
               to stop. Suppress that one transition. The `!==` matters: setting
               this on a same-tab open would never clear and would swallow the
               user's first real tab click. */
            if (initialTab !== activeTab) suppressPanelAnimRef.current = true;
            setActiveTab(initialTab);
            setRetrievalRequest({
                tab: initialTab === 'reranker' ? 'reranker'
                    : initialTab === 'embedding' ? 'embedding'
                        : undefined,
                seq: initialTabSeq,
            });


        }
        /* `initialTabSeq` is in the deps on purpose: a repeat request for the
           tab that is ALREADY active must still re-assert, because the panel
           below it may own state of its own (Retrieval's Embedding/Reranker
           sub-tab) that the deep link is trying to reach. Without it the second
           click of a deep link did nothing at all. */
    }, [isOpen, initialTab, initialTabSeq]);

    const { shortcuts, updateShortcut, resetShortcuts, conflicts, globalShortcutsEnabled, setGlobalShortcutsEnabled } = useShortcuts();
    // Small badge shown next to a shortcut row when globalShortcut.register()
    // failed for it (another app/OS already owns that key combo). The
    // KeyRecorder right next to it is the fix — recording a new combo
    // re-registers and clears the flag.
    const renderShortcutConflictBadge = (actionId: keyof typeof shortcuts) => (
        conflicts.has(actionId) ? (
            <span
                className="settings-control-in flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/15 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0"
                title={t('Another app on your system is already using this shortcut. Record a new key combo to fix it.')}
            >
                <AlertCircle size={11} />
                {t('In use')}
            </span>
        ) : null
    );
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [disguiseMode, setDisguiseMode] = useState<'terminal' | 'settings' | 'activity' | 'none'>('none');
    const [openOnLogin, setOpenOnLogin] = useState(false);
    // Windows-only. Defaults to true to match the main-process policy (unset ⟹
    // on), so the toggle doesn't flash off before the IPC read lands.
    const [shortcutGuard, setShortcutGuard] = useState(true);
    const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const [isAiLangDropdownOpen, setIsAiLangDropdownOpen] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'uptodate' | 'error'>('idle');
    const themeDropdownRef = React.useRef<HTMLDivElement>(null);
    const aiLangDropdownRef = React.useRef<HTMLDivElement>(null);
    const [meetingInterfaceTheme, setMeetingInterfaceThemeState] = useState<MeetingInterfaceTheme>(getMeetingInterfaceTheme);
    const [isInterfaceThemeDropdownOpen, setIsInterfaceThemeDropdownOpen] = useState(false);
    const interfaceThemeDropdownRef = React.useRef<HTMLDivElement>(null);
    const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
    const langDropdownRef = React.useRef<HTMLDivElement>(null);


    const [verboseLogging, setVerboseLogging] = useState(false);
    const [showVerboseToast, setShowVerboseToast] = useState(false);
    const verboseToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [exportingLogs, setExportingLogs] = useState(false);
    const [exportResult, setExportResult] = useState<string | null>(null);
    const [ambientChatEnabled, setAmbientChatEnabled] = useState(false);
    const [autoAnswerEnabled, setAutoAnswerEnabled] = useState(false);
    const [meetingRetention, setMeetingRetention] = useState<'forever' | '7d' | '30d' | 'never'>('forever');
    const [codeVerification, setCodeVerification] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

    useEffect(() => {
        if (!showVerboseToast) return;
        verboseToastTimerRef.current = setTimeout(() => setShowVerboseToast(false), 10000);
        return () => {
            if (verboseToastTimerRef.current) clearTimeout(verboseToastTimerRef.current);
        };
    }, [showVerboseToast]);

    // Close dropdown when clicking outside
    // Sync with global state changes
    useEffect(() => {
        if (isOpen) {


            // Fetch true initial state from main process
            window.electronAPI?.getUndetectable?.().then(setIsUndetectable).catch(() => { });
            window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => { });
            window.electronAPI?.getDisguise?.().then(setDisguiseMode).catch(() => { });
            window.electronAPI?.getVerboseLogging?.().then(setVerboseLogging).catch(() => { });
            window.electronAPI?.getAmbientChatEnabled?.().then(setAmbientChatEnabled).catch(() => { });
            window.electronAPI?.getAutoAnswerEnabled?.().then(setAutoAnswerEnabled).catch(() => { });
            window.electronAPI?.getCodeVerification?.().then((v) => setCodeVerification(v === true)).catch(() => { });
            window.electronAPI?.getMeetingRetention?.().then(setMeetingRetention).catch(() => { });
        }
    }, [isOpen]);



    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onMeetingRetentionChanged) {
            const unsubscribe = window.electronAPI.onMeetingRetentionChanged(setMeetingRetention);
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
            if (interfaceThemeDropdownRef.current && !interfaceThemeDropdownRef.current.contains(event.target as Node)) {
                setIsInterfaceThemeDropdownOpen(false);
            }
            if (langDropdownRef.current && !langDropdownRef.current.contains(event.target as Node)) {
                setIsLangDropdownOpen(false);
            }
        };

        // Escape closes the open menu and hands focus back to its trigger, like
        // CustomSelect. Capture phase + stopPropagation, so it never reaches the
        // window-level Escape that closes all of Settings.
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            const open = [
                [isThemeDropdownOpen, themeDropdownRef, setIsThemeDropdownOpen],
                [isAiLangDropdownOpen, aiLangDropdownRef, setIsAiLangDropdownOpen],
                [isInterfaceThemeDropdownOpen, interfaceThemeDropdownRef, setIsInterfaceThemeDropdownOpen],
                [isLangDropdownOpen, langDropdownRef, setIsLangDropdownOpen],
            ] as const;
            for (const [isOpen, ref, setOpen] of open) {
                if (!isOpen) continue;
                event.stopPropagation();
                setOpen(false);
                ref.current?.querySelector('button')?.focus();
            }
        };

        if (isThemeDropdownOpen || isAiLangDropdownOpen || isInterfaceThemeDropdownOpen || isLangDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape, true);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape, true);
        };
    }, [isThemeDropdownOpen, isAiLangDropdownOpen, isInterfaceThemeDropdownOpen, isLangDropdownOpen]);

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false';
    });

    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('');
    const [selectedSttGroup, setSelectedSttGroup] = useState('');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});
    const [autoDetectedLanguage, setAutoDetectedLanguage] = useState<string | null>(null);

    // Active STT provider — declared here (not with the rest of the STT
    // settings below) because the local-model language-capability effect and
    // memo that follow depend on it.
    const [sttProvider, setSttProvider] = useState<'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'nvidia_nim' | 'natively' | 'local-whisper' | 'apple-speech'>('none');

    // Declared here for the same reason sttProvider is: the NVIDIA
    // language-capability memo below reads it, and which languages that model
    // can recognise gates the recognition-language selector.
    const [nvidiaNimSttModel, setNvidiaNimSttModel] = useState(DEFAULT_NVIDIA_NIM_STT_MODEL);
    // Deepgram / OpenAI transcription model (sttModelCatalog.ts), per provider.
    const [sttModels, setSttModels] = useState<Record<SttModelProvider, string>>({
        deepgram: STT_MODEL_CATALOG.deepgram.defaultId,
        openai: STT_MODEL_CATALOG.openai.defaultId,
    });

    // Local model language capability (local-whisper provider only).
    // Per-model: which RECOGNITION_LANGUAGES keys the model accepts, whether
    // language is changeable at all, and whether accent/region variants mean
    // anything to it — computed main-side from each model's official docs
    // (electron/audio/whisper/modelLanguageSupport.ts) and attached to
    // local-whisper-get-models. Combined with the live channel config to
    // restrict/grey the Language and Accent/Region selects below.
    const [localModelSupport, setLocalModelSupport] = useState<Record<string, {
        name: string;
        support: { languageSelectable: boolean; accentSelectable: boolean; allowedLanguageKeys: string[] };
    }> | null>(null);
    const [localWhisperConfig, setLocalWhisperConfig] = useState<LocalWhisperChannelConfig | null>(null);

    // Apple Speech locale availability (macOS 26+). Apple transcribes 45
    // locales, but only 14 of Natively's 30 language entries map to one — the
    // other 20 fail at meeting start with "does not support language X". This
    // restricts the list to what Apple can actually do and marks the rest as a
    // first-use download, so the wait is visible before a meeting rather than
    // as an unexplained pause during one.
    const [appleSpeechLocales, setAppleSpeechLocales] = useState<{
        available: boolean; supported: string[]; installed: string[]; reserved: string[]; maxReserved: number;
    } | null>(null);
    const [appleReleasing, setAppleReleasing] = useState<string>('');
    // Live asset download started from Settings. Apple reports a 0..1 fraction
    // and no transfer size, so the bar is a percentage — there is no MB figure
    // to show (Progress.totalUnitCount is 1, not bytes).
    const [appleInstall, setAppleInstall] = useState<{ locale: string; fraction: number } | null>(null);
    const [appleInstallError, setAppleInstallError] = useState<string>('');

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

    // The launcher window is created with `transparent: true` on every
    // platform (see createWindow() in WindowHelper.ts) so setLauncherOpacityPreview
    // can punch through it at runtime everywhere, not just macOS. Windows/Linux
    // have no vibrancy API, but stripping the native backgroundColor alone is
    // enough there to reveal the real desktop, so the DOM hide/restore below
    // runs on all platforms.
    const canPreviewTransparency = true;

    const startPreviewingOpacity = () => {
        // Bug fix #5: guard against rapid repeated calls (double pointerDown / touch events)
        if (isPreviewingOpacity) return;

        if (canPreviewTransparency) {
            // Direct DOM mutation for sub-millisecond instant hide (bypassing slow React tree diffs)
            document.body.classList.add('disable-transitions');

            const backdrop = document.getElementById('settings-backdrop');
            const wrapper = document.getElementById('settings-panel-wrapper');
            const panel = document.getElementById('settings-panel');
            const card = document.getElementById('opacity-slider-card');
            const launcher = document.getElementById('launcher-container');
            // Global banners/toasts/modals (update, quota, trial, onboarding,
            // ad promos) — mounted as siblings of #launcher-container in
            // App.tsx, not inside it, so they need their own hide pass or
            // whichever one happens to be visible stays opaque on top of the
            // "transparent" preview. See the data-opacity-preview-surface
            // wrapper comment in App.tsx.
            const globalSurfaces = document.querySelectorAll('[data-opacity-preview-surface]');

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
            globalSurfaces.forEach((el) => {
                (el as HTMLElement).style.visibility = 'hidden';
            });

            if (card) {
                card.style.visibility = 'visible';
                card.style.position = 'relative';
                card.style.zIndex = '9999';
            }

            // Strip the launcher window's own vibrancy/background (macOS) so
            // the areas behind the DOM we just hid show the real desktop
            // instead of an opaque NSVisualEffectView material. See
            // WindowHelper.setLauncherOpacityPreview() for why this can't be
            // done with CSS alone.
            window.electronAPI?.setLauncherOpacityPreview?.(true);
        }

        const mockup = document.getElementById('settings-mockup-wrapper');
        if (mockup) {
            mockup.style.opacity = '1';
        }

        setPreviewOverlayOpacity(latestOpacityRef.current);
        setIsPreviewingOpacity(true);
    };

    const stopPreviewingOpacity = () => {
        if (canPreviewTransparency) {
            // Direct DOM restoration
            document.body.classList.remove('disable-transitions');
            const backdrop = document.getElementById('settings-backdrop');
            const wrapper = document.getElementById('settings-panel-wrapper');
            const panel = document.getElementById('settings-panel');
            const card = document.getElementById('opacity-slider-card');
            const launcher = document.getElementById('launcher-container');
            const globalSurfaces = document.querySelectorAll('[data-opacity-preview-surface]');

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
            globalSurfaces.forEach((el) => {
                (el as HTMLElement).style.visibility = '';
            });

            if (card) {
                card.style.visibility = '';
                card.style.position = '';
                card.style.zIndex = '';
            }

            // Restore launcher vibrancy/background — must run on every exit
            // path (drag release, Settings closing mid-drag, pointer-up
            // outside the window), all of which funnel through this one
            // function.
            window.electronAPI?.setLauncherOpacityPreview?.(false);
        }

        const mockup = document.getElementById('settings-mockup-wrapper');
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

    // Load per-model language capability whenever the local provider is
    // active. The channel config is ALSO pushed live by LocalWhisperModelPanel
    // via onModelConfigChanged (the panel and these selects are on the same
    // Settings page), so a model swap re-restricts the selects immediately.
    useEffect(() => {
        if (sttProvider !== 'local-whisper') return;
        let cancelled = false;
        (async () => {
            try {
                const [modelsRes, cfgRes] = await Promise.all([
                    window.electronAPI?.localWhisperGetModels?.(),
                    window.electronAPI?.localWhisperGetChannelConfig?.(),
                ]);
                if (cancelled) return;
                if (modelsRes?.models) {
                    const map: Record<string, { name: string; support: any }> = {};
                    for (const m of modelsRes.models) {
                        if (m?.id && m.languageSupport) map[m.id] = { name: m.name ?? m.id, support: m.languageSupport };
                    }
                    setLocalModelSupport(map);
                }
                if (cfgRes) setLocalWhisperConfig(cfgRes);
            } catch (err) {
                console.error('[Settings] Failed to load local model language capability:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [sttProvider]);

    // Effective capability across the ACTIVE local model(s): in split mode the
    // one global language setting feeds BOTH channels, so the offered set is
    // the intersection of what mic and system models accept; accent stays
    // enabled if ANY active model consumes regional variants (harmless to the
    // others — they collapse variants to a plain language token).
    // null → no restriction (cloud providers, or capability not loaded yet).
    const localLanguageCapability = useMemo(() => {
        if (sttProvider !== 'local-whisper' || !localModelSupport || !localWhisperConfig) return null;
        const { enabled, micModelId, systemModelId, globalModelId } = localWhisperConfig;
        const ids = Array.from(new Set(
            (enabled ? [micModelId || globalModelId, systemModelId || globalModelId] : [globalModelId]).filter(Boolean)
        ));
        const entries = ids.map(id => localModelSupport[id]).filter(Boolean);
        if (entries.length === 0) return null;
        let allowedKeys = new Set<string>(entries[0].support.allowedLanguageKeys);
        for (const e of entries.slice(1)) {
            allowedKeys = new Set(e.support.allowedLanguageKeys.filter((k: string) => allowedKeys.has(k)));
        }
        const accentSelectable = entries.some(e => e.support.accentSelectable);
        const englishOnlyNames = entries.filter(e => !e.support.languageSelectable).map(e => e.name);
        // Locked when every offered key sits in one group (the English-only
        // case) — a select with a single meaningful choice is greyed, not hidden.
        const allowedGroups = new Set(
            Array.from(allowedKeys).map(k => availableLanguages[k]?.group).filter(Boolean)
        );
        const languageSelectable = allowedGroups.size > 1;
        return { allowedKeys, accentSelectable, languageSelectable, englishOnlyNames, modelNames: entries.map(e => e.name) };
    }, [sttProvider, localModelSupport, localWhisperConfig, availableLanguages]);

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
        // Find default variant for this group (first one the active model accepts)
        const firstVariant = Object.entries(availableLanguages).find(
            ([key, lang]) => lang.group === group && isLanguageEntryAllowed(key)
        );
        if (firstVariant) {
            handleLanguageChange(firstVariant[0]);
        }
    };

    useEffect(() => {
        const off = window.electronAPI?.onAppleSpeechInstallProgress?.((d) => {
            setAppleInstall((cur) => (cur && cur.locale === d.locale ? { ...cur, fraction: d.fraction } : cur));
        });
        return () => { off?.(); };
    }, []);

    useEffect(() => {
        if (sttProvider !== 'apple-speech') return;
        let cancelled = false;
        window.electronAPI?.getAppleSpeechLocales?.()
            .then((r) => { if (!cancelled) setAppleSpeechLocales(r); })
            .catch(() => { if (!cancelled) setAppleSpeechLocales(null); });
        return () => { cancelled = true; };
    }, [sttProvider]);

    /** bcp47 -> lower-case, so es-ES and es-es compare equal. */
    const appleLocaleSets = useMemo(() => {
        if (sttProvider !== 'apple-speech' || !appleSpeechLocales?.available) return null;
        return {
            supported: new Set(appleSpeechLocales.supported.map((l) => l.toLowerCase())),
            installed: new Set(appleSpeechLocales.installed.map((l) => l.toLowerCase())),
        };
    }, [sttProvider, appleSpeechLocales]);

    // Feeds the same allowedLanguageKeySet the local/NVIDIA gates use, so the
    // unsupported entries disappear from both selects with no new plumbing.
    const appleLanguageCapability = useMemo(() => {
        if (!appleLocaleSets) return null;
        const keys = new Set<string>(['auto']);
        for (const [key, l] of Object.entries(availableLanguages) as [string, any][]) {
            const bcp = String(l?.bcp47 ?? '');
            if (bcp && bcp !== 'auto' && appleLocaleSets.supported.has(bcp.toLowerCase())) keys.add(key);
        }
        return keys;
    }, [appleLocaleSets, availableLanguages]);

    /** bcp47 of the currently selected recognition language, if resolvable. */
    const selectedAppleLocale = useMemo(() => {
        if (!appleLocaleSets) return null;
        // recognitionLanguage, not displayedRecognitionLanguage: the display
        // fallback only fires for a locked local model, which cannot be active
        // while Apple Speech is the provider, and it is declared further down.
        const bcp = String((availableLanguages as any)[recognitionLanguage]?.bcp47 ?? '');
        if (!bcp || bcp === 'auto') return null;
        return appleLocaleSets.supported.has(bcp.toLowerCase()) ? bcp : null;
    }, [appleLocaleSets, availableLanguages, recognitionLanguage]);

    const selectedAppleNeedsDownload = !!selectedAppleLocale
        && !!appleLocaleSets && !appleLocaleSets.installed.has(selectedAppleLocale.toLowerCase());

    const startAppleDownload = async () => {
        if (!selectedAppleLocale) return;
        setAppleInstallError('');
        setAppleInstall({ locale: selectedAppleLocale, fraction: 0 });
        try {
            const r = await window.electronAPI.installAppleSpeechLocale(selectedAppleLocale);
            if (!r?.ok) setAppleInstallError(r?.error || 'The language download did not finish.');
            const fresh = await window.electronAPI.getAppleSpeechLocales();
            setAppleSpeechLocales(fresh);
        } catch (e: any) {
            setAppleInstallError(e?.message || 'The language download did not finish.');
        } finally {
            setAppleInstall(null);
        }
    };

    /**
     * Apple allocates at most `maxReserved` (5) locales per app and an install
     * takes a slot permanently, so a sixth download fails with "Too many
     * allocated locales, 5 maximum". Releasing is the only way back and it
     * PURGES the asset, so the user is shown the limit and picks what to give
     * up rather than having a language deleted silently to make room.
     */
    const appleSlots = useMemo(() => {
        if (sttProvider !== 'apple-speech' || !appleSpeechLocales?.available) return null;
        const max = appleSpeechLocales.maxReserved || 0;
        if (!max) return null;
        const label = (bcp: string) => {
            const hit = Object.values(availableLanguages).find(
                (l: any) => String(l?.bcp47 ?? '').toLowerCase() === bcp.toLowerCase(),
            ) as any;
            return hit?.label ? `${hit.group}${hit.label !== hit.group ? ` (${hit.label})` : ''}` : bcp;
        };
        return {
            max,
            used: appleSpeechLocales.reserved.length,
            full: appleSpeechLocales.reserved.length >= max,
            entries: appleSpeechLocales.reserved.map((bcp) => ({ bcp, label: label(bcp) })),
        };
    }, [sttProvider, appleSpeechLocales, availableLanguages]);

    const releaseAppleLanguage = async (bcp: string) => {
        setAppleReleasing(bcp);
        setAppleInstallError('');
        try {
            const r = await window.electronAPI.releaseAppleSpeechLocale(bcp);
            if (!r?.ok) setAppleInstallError(r?.error || 'Could not remove the language.');
            setAppleSpeechLocales(await window.electronAPI.getAppleSpeechLocales());
        } catch (e: any) {
            setAppleInstallError(e?.message || 'Could not remove the language.');
        } finally {
            setAppleReleasing('');
        }
    };

    /** Per-variant and per-group install badges for the two language selects. */
    const appleLanguageBadges = useMemo(() => {
        if (!appleLocaleSets) return undefined;
        const variant: Record<string, string> = {};
        const groupInstalled = new Map<string, boolean>();
        for (const [key, l] of Object.entries(availableLanguages) as [string, any][]) {
            const bcp = String(l?.bcp47 ?? '');
            if (!bcp || bcp === 'auto') continue;
            if (!appleLocaleSets.supported.has(bcp.toLowerCase())) continue;
            const installed = appleLocaleSets.installed.has(bcp.toLowerCase());
            variant[key] = installed ? t('Installed') : t('Download');
            // A group counts as installed once any of its regions is on disk —
            // picking that group lands on an installed region by default.
            groupInstalled.set(l.group, (groupInstalled.get(l.group) ?? false) || installed);
        }
        const group: Record<string, string> = {};
        for (const [name, installed] of groupInstalled) {
            group[name] = installed ? t('Installed') : t('Download');
        }
        return { variant, group };
    }, [appleLocaleSets, availableLanguages, t]);

    // NVIDIA speech models are per-language deployments: the Vietnamese build
    // serves vi-VN and nothing else, and the streaming English ones serve en-US
    // only. Offering the full language list under them would let a user pick a
    // language the selected model cannot recognise. Derived from each model's
    // documented locales — see allowedLanguageKeysForNvidiaModel.
    const nvidiaLanguageCapability = useMemo(() => {
        if (sttProvider !== 'nvidia_nim') return null;
        if (!availableLanguages || Object.keys(availableLanguages).length === 0) return null;
        return allowedLanguageKeysForNvidiaModel(nvidiaNimSttModel, availableLanguages);
    }, [sttProvider, nvidiaNimSttModel, availableLanguages]);

    // Language keys the active STT backend accepts. Unrestricted for cloud
    // providers; for local-whisper this is the active model's documented set.
    // Parakeet-only languages are hidden unless the active local model lists them.
    // Deepgram's English-only models (Nova-3 Medical, Nova-2 Meeting) answer
    // any other language, or `multi`, with a 400 — measured live 2026-09-26.
    const deepgramLanguageCapability = useMemo(() => {
        if (sttProvider !== 'deepgram' || !isEnglishOnlySttModel('deepgram', sttModels.deepgram)) return null;
        const keys = Object.entries(availableLanguages).filter(([, l]: [string, any]) => l?.group === 'English').map(([k]) => k);
        return keys.length > 0 ? new Set<string>(keys) : null;
    }, [sttProvider, sttModels.deepgram, availableLanguages]);

    const allowedLanguageKeySet = localLanguageCapability?.allowedKeys ?? nvidiaLanguageCapability ?? deepgramLanguageCapability ?? appleLanguageCapability ?? null;
    const isLanguageEntryAllowed = (key: string) =>
        isRecognitionLanguageOffered(key, localLanguageCapability?.allowedKeys ?? null, allowedLanguageKeySet);

    // Helper to get unique groups (restricted to what the active model accepts)
    const languageGroups = Array.from(new Set(
        Object.entries(availableLanguages)
            .filter(([key]) => isLanguageEntryAllowed(key))
            .map(([, l]: [string, any]) => l.group)
    ))
        .sort((a, b) => {
            if (a === 'Auto') return -1;
            if (b === 'Auto') return 1;
            if (a === 'English') return -1;
            if (b === 'English') return 1;
            return a.localeCompare(b);
        });

    // The stored selection can name a language the newly-selected local model
    // doesn't support (the setting is global across providers and is NOT
    // rewritten when a model is picked). Display-only fallbacks: a locked
    // (English-only) model shows English / United States — which IS what the
    // pipeline does (the worker omits the language token for English-only
    // checkpoints) — while an unsupported pick on a selectable model keeps
    // showing the stored value alongside the warning hint below.
    const languageLocked = localLanguageCapability ? !localLanguageCapability.languageSelectable : false;
    // 'auto' is its own case, NOT an unsupported language. No local model has a
    // real auto-detect mode with locale conditioning, but LocalWhisperSTT
    // normalizes 'auto' to English rather than failing (see
    // resolveAndApplyNemotronLanguage), so the honest message is "auto-detect
    // is unavailable, English is used" — not "your language isn't supported".
    const autoDetectUnavailable =
        recognitionLanguage === 'auto' && !!allowedLanguageKeySet && !allowedLanguageKeySet.has('auto');
    const storedLanguageUnsupported =
        !!recognitionLanguage && recognitionLanguage !== 'auto'
        && !!allowedLanguageKeySet && !allowedLanguageKeySet.has(recognitionLanguage);
    // A Parakeet-only language picked under Parakeet stays stored after the user
    // moves to a backend that never lists it. Other local models are covered by
    // storedLanguageUnsupported (their allowed keys exclude these languages).
    const storedLanguageParakeetOnly =
        sttProvider !== 'local-whisper' && PARAKEET_ONLY_LANGUAGE_KEYS.has(recognitionLanguage);
    // An English-only Deepgram model is locked to English the same way: its
    // session always sends English (DeepgramStreamingSTT.connectLanguage), so
    // an Auto or non-English stored choice shows as the English it gets —
    // not as an empty placeholder with nothing in the list to match.
    const showsEnglishFallback = (languageLocked || !!deepgramLanguageCapability) && (storedLanguageUnsupported || autoDetectUnavailable);
    const displayedSttGroup = showsEnglishFallback ? 'English' : selectedSttGroup;
    const displayedRecognitionLanguage = showsEnglishFallback ? 'english-us' : recognitionLanguage;

    // Helper to get variants for current group
    const currentGroupVariants = Object.entries(availableLanguages)
        .filter(([key, lang]) => lang.group === displayedSttGroup && isLanguageEntryAllowed(key))
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

    useEffect(() => {
        // Listen on both `storage` (same-window) and the IPC broadcast (cross-window)
        // so the settings pane reflects the active theme regardless of which window
        // changed it. See ipcHandlers.ts `interface-theme:set` for the relay.
        const handleStorage = () => {
            setMeetingInterfaceThemeState(getMeetingInterfaceTheme());
        };
        window.addEventListener('storage', handleStorage);
        const unsubscribeIpc = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme) => {
            const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
            if (valid.includes(theme as MeetingInterfaceTheme)) {
                setMeetingInterfaceThemeState(theme as MeetingInterfaceTheme);
            }
        });
        return () => {
            window.removeEventListener('storage', handleStorage);
            unsubscribeIpc?.();
        };
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
    // System-audio half of the pre-meeting check (UX4). The mic meter alone only
    // proves we can hear the USER; this one proves we are capturing the other
    // side of the call, which is the half that silently fails (permission not
    // granted, no loopback device, tap init refused).
    const [systemAudioLevel, setSystemAudioLevel] = useState(0);
    const [systemAudioError, setSystemAudioError] = useState<string | null>(null);
    // Which way each meter last moved. A level meter rises at once and falls
    // slowly (attack / release); one 100ms ease both ways made the bars jitter
    // on every update instead of reading as a level.
    const [micFalling, setMicFalling] = useState(false);
    const [systemFalling, setSystemFalling] = useState(false);
    // True for the length of the test tone, so Test Sound shows it is playing.
    const [testSoundPlaying, setTestSoundPlaying] = useState(false);
    const testSoundTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [useExperimentalSck, setUseExperimentalSck] = useState(false);
    // Most-recent device fallback notice. Populated by main process via
    // 'device-selection-applied' IPC when the saved device couldn't be opened
    // and the audio pipeline silently fell back to the system default.
    const [deviceFallbackNotice, setDeviceFallbackNotice] = useState<{
        kind: 'input' | 'output';
        requested: string | null;
        actual: string | null;
        reason?: string;
    } | null>(null);

    const [sttNvidiaNimKey, setSttNvidiaNimKey] = useState('');
    const [groqSttModel, setGroqSttModel] = useState('whisper-large-v3-turbo');
    const [sttGroqKey, setSttGroqKey] = useState('');
    const [sttOpenaiKey, setSttOpenaiKey] = useState('');
    const [sttDeepgramKey, setSttDeepgramKey] = useState('');
    const [sttElevenLabsKey, setSttElevenLabsKey] = useState('');
    const [sttAzureKey, setSttAzureKey] = useState('');
    const [sttAzureRegion, setSttAzureRegion] = useState('eastus');
    const [sttIbmKey, setSttIbmKey] = useState('');
    const [sttOpenaiBaseUrl, setSttOpenaiBaseUrl] = useState('');
    // What is stored for Azure's region and OpenAI's server, so their Save is
    // live only for an edit, as the key's is, and which of them just saved.
    const [savedAzureRegion, setSavedAzureRegion] = useState('eastus');
    const [savedOpenaiBaseUrl, setSavedOpenaiBaseUrl] = useState('');
    const [sttFieldSaved, setSttFieldSaved] = useState<'region' | 'baseUrl' | null>(null);
    const sttFieldSavedTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const markSttFieldSaved = (field: 'region' | 'baseUrl') => {
        setSttFieldSaved(field);
        clearTimeout(sttFieldSavedTimer.current);
        sttFieldSavedTimer.current = setTimeout(() => setSttFieldSaved(null), 2000);
    };
    const [sttTestStatus, setSttTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [sttTestError, setSttTestError] = useState('');
    const [sttSaving, setSttSaving] = useState(false);
    const [sttSaved, setSttSaved] = useState(false);
    const [googleServiceAccountPath, setGoogleServiceAccountPath] = useState<string | null>(null);
    // Why the picker rejected the last pick. Without this a rejected file is
    // indistinguishable from a cancelled dialog — the field just stays empty.
    const [googleServiceAccountError, setGoogleServiceAccountError] = useState('');
    const [hasNativelyKey, setHasNativelyKey] = useState(initialHasNativelyKey);
    const [hasStoredSttGroqKey, setHasStoredSttGroqKey] = useState(false);
    const [hasStoredNvidiaNimKey, setHasStoredNvidiaNimKey] = useState(false);
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
                    setSttProvider((creds.sttProvider || 'none') as any);
                    if (creds.groqSttModel) setGroqSttModel(creds.groqSttModel);
                    setGoogleServiceAccountPath(creds.googleServiceAccountPath);
                    setHasStoredSttGroqKey(creds.hasSttGroqKey);
                    setHasStoredNvidiaNimKey(creds.hasNvidiaNimKey || false);
                    if ((creds as any).nvidiaNimSttModel) setNvidiaNimSttModel((creds as any).nvidiaNimSttModel);
                    if (creds.sttModels) setSttModels((cur) => ({ ...cur, ...creds.sttModels }));
                    setHasStoredSttOpenaiKey(creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(creds.hasElevenLabsKey);
                    setHasStoredAzureKey(creds.hasAzureKey);
                    if (creds.azureRegion) { setSttAzureRegion(creds.azureRegion); setSavedAzureRegion(creds.azureRegion); }
                    setHasStoredIbmWatsonKey(creds.hasIbmWatsonKey);
                    setHasStoredSonioxKey(creds.hasSonioxKey || false);

                    setHasNativelyKey(creds.hasNativelyKey || false);
                    // Do NOT pre-populate STT key fields from stored credentials.
                    // The backend returns masked values ("sk-...XXXX") for security; pre-populating
                    // them into the input state causes the masked string to be submitted on re-test,
                    // which every provider (Deepgram, Groq, Soniox, etc.) rejects as invalid.
                    // The hasStoredXxxKey booleans already show the "Saved" badge and set the
                    // placeholder to "••••••••••••" — that is sufficient UX feedback.
                    if (typeof creds.openAiSttBaseUrl === 'string') { setSttOpenaiBaseUrl(creds.openAiSttBaseUrl); setSavedOpenaiBaseUrl(creds.openAiSttBaseUrl); }
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
                    if (creds.nvidiaNimSttModel) setNvidiaNimSttModel(creds.nvidiaNimSttModel);
                    if (creds.sttModels) setSttModels((cur) => ({ ...cur, ...creds.sttModels }));
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

    const handleSttProviderChange = async (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'nvidia_nim' | 'natively' | 'local-whisper' | 'apple-speech') => {
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

    /**
     * Commit a speech-model choice.
     *
     * Optimistic, then REVERTED if the write did not land. set-nvidia-nim-stt-model
     * answers {success:false} for an unsupported id and for a degraded credential
     * store (refuseWriteWhileDegraded), and the previous version neither awaited a
     * result nor caught a rejection — so a refused write left the UI showing a model
     * the next session would not load, with an unhandled rejection in the console.
     */
    const selectNvidiaNimSttModel = async (id: string) => {
        const previous = nvidiaNimSttModel;
        if (previous === id) return;
        setNvidiaNimSttModel(id);
        try {
            const result = await window.electronAPI?.setNvidiaNimSttModel?.(id);
            if (result && result.success === false) throw new Error(result.error || 'Could not save speech model');
        } catch (err) {
            console.error('[Settings] Failed to save NVIDIA NIM speech model:', err);
            setNvidiaNimSttModel(previous);
        }
    };

    /** Groq's Whisper model (groqSttModel), saved like the others. */
    const selectGroqSttModel = async (id: string) => {
        const previous = groqSttModel;
        if (previous === id) return;
        setGroqSttModel(id);
        try {
            // @ts-ignore
            const result = await window.electronAPI?.setGroqSttModel?.(id);
            if (result && result.success === false) throw new Error(result.error || 'Could not save Groq model');
        } catch (err) {
            console.error('[Settings] Failed to set Groq model:', err);
            setGroqSttModel(previous);
        }
    };

    /** Same contract as selectNvidiaNimSttModel: optimistic, reverted if the
     *  write did not land (unsupported id, degraded credential store). */
    const selectSttModel = async (provider: SttModelProvider, id: string) => {
        const previous = sttModels[provider];
        if (previous === id) return;
        setSttModels((cur) => ({ ...cur, [provider]: id }));
        try {
            const result = await window.electronAPI?.setSttModel?.(provider, id);
            if (result && result.success === false) throw new Error(result.error || 'Could not save speech model');
        } catch (err) {
            console.error(`[Settings] Failed to save ${provider} speech model:`, err);
            setSttModels((cur) => ({ ...cur, [provider]: previous }));
        }
    };

    const handleSttKeySubmit = async (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'nvidia_nim', key: string) => {
        if (!key.trim()) return;
        // Reject masked values returned by getStoredCredentials ("sk-...XXXX").
        // These are never valid API keys and every provider rejects them.
        if (/^sk-\.\.\.[A-Za-z0-9]{4}$/.test(key.trim())) {
            setSttTestStatus('error');
            setSttTestError('Please enter your actual API key — the displayed value is masked for security.');
            return;
        }

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

            let saveResult: { success?: boolean; error?: string } | undefined;
            if (provider === 'groq') {
                // @ts-ignore
                saveResult = await window.electronAPI?.setGroqSttApiKey?.(key.trim());
            } else if (provider === 'nvidia_nim') {
                saveResult = await window.electronAPI?.setNvidiaNimApiKey?.(key.trim());
            } else if (provider === 'openai') {
                // @ts-ignore
                saveResult = await window.electronAPI?.setOpenAiSttApiKey?.(key.trim());
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                saveResult = await window.electronAPI?.setElevenLabsApiKey?.(key.trim());
            } else if (provider === 'azure') {
                // @ts-ignore
                saveResult = await window.electronAPI?.setAzureApiKey?.(key.trim());
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                saveResult = await window.electronAPI?.setIbmWatsonApiKey?.(key.trim());
            } else if (provider === 'soniox') {
                // @ts-ignore
                saveResult = await window.electronAPI?.setSonioxApiKey?.(key.trim());
            } else {
                // @ts-ignore
                saveResult = await window.electronAPI?.setDeepgramApiKey?.(key.trim());
            }

            // The key validated, but the OS blocked secure storage so it was only
            // kept in memory for this session. Surface the real error instead of a
            // false "Saved" badge — this is what made STT keys silently reset after
            // restart. The provider stays selected (it works this session).
            if (saveResult && saveResult.success === false) {
                setSttTestStatus('error');
                setSttTestError(saveResult.error || 'API key could not be saved to disk and will not survive a restart.');
                setSttSaving(false);
                return;
            }

            if (provider === 'groq') setHasStoredSttGroqKey(true);
            else if (provider === 'nvidia_nim') setHasStoredNvidiaNimKey(true);
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
        if (!(await askConfirm({ title: `Are you sure you want to remove the ${provider === 'ibmwatson' ? 'IBM Watson' : provider.charAt(0).toUpperCase() + provider.slice(1)} API key?` }))) return;

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
        if (!(await askConfirm({ title: 'Are you sure you want to remove the Tavily API Key?' }))) return;

        try {
            await window.electronAPI?.setTavilyApiKey?.('');


        } catch (e) {
            console.error('Failed to remove Tavily API key:', e);
        }
    };

    const handleTestSttConnection = async () => {
        if (sttProvider === 'none' || sttProvider === 'google' || sttProvider === 'natively' || sttProvider === 'local-whisper' || sttProvider === 'apple-speech') return;
        const keyMap: Record<string, string> = {
            groq: sttGroqKey, openai: sttOpenaiKey, deepgram: sttDeepgramKey,
            elevenlabs: sttElevenLabsKey, azure: sttAzureKey, ibmwatson: sttIbmKey,
            soniox: sttSonioxKey,
        };
        const keyToTest = keyMap[sttProvider]?.trim() || '';

        // If the input field is empty post-restart (the #318 fix intentionally
        // does NOT pre-populate masked values) but a key IS on disk, ask the
        // backend to test the persisted key directly. The sentinel is resolved
        // in main — the raw key never round-trips back into renderer state, so
        // the masked pre-population regression cannot recur. This closes the
        // "Please enter an API key first" false alarm users reported as
        // "the STT key was lost on restart."
        const hasStoredKeyForCurrentProvider = (() => {
            switch (sttProvider) {
                case 'groq':       return hasStoredSttGroqKey;
                case 'openai':     return hasStoredSttOpenaiKey;
                case 'deepgram':   return hasStoredDeepgramKey;
                case 'elevenlabs': return hasStoredElevenLabsKey;
                case 'azure':      return hasStoredAzureKey;
                case 'ibmwatson':  return hasStoredIbmWatsonKey;
                case 'soniox':     return hasStoredSonioxKey;
                default:           return false;
            }
        })();

        // Pick the key to send: explicit input if present, otherwise the
        // sentinel (the IPC will resolve to the persisted key, or fail clean
        // with a "no key saved" error).
        const apiKeyToSend = keyToTest
            ? keyToTest
            : (hasStoredKeyForCurrentProvider ? '__USE_STORED__' : '');

        if (!apiKeyToSend) {
            setSttTestStatus('error');
            setSttTestError('Please add your API key in Settings to test the connection.');
            return;
        }

        setSttTestStatus('testing');
        setSttTestError('');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.testSttConnection?.(
                sttProvider,
                apiKeyToSend,
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

    // Escape closes Settings — except during opacity preview (slider is the
    // active gesture, dismiss-on-Escape would interrupt the drag).
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (isPreviewingOpacity) return;
            e.preventDefault();
            onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, isPreviewingOpacity, onClose]);



    useEffect(() => {
        if (isOpen) {
            // Load detectable status
            if (window.electronAPI?.getUndetectable) {
                window.electronAPI.getUndetectable().then(setIsUndetectable);
            }
            if (window.electronAPI?.getOpenAtLogin) {
                window.electronAPI.getOpenAtLogin().then(setOpenOnLogin);
            }
            if (isWindows && window.electronAPI?.getStealthShortcutGuard) {
                window.electronAPI.getStealthShortcutGuard().then(setShortcutGuard).catch(() => { });
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

        }
    }, [isOpen, selectedInput, selectedOutput]); // Re-run if isOpen changes, or if selected devices are cleared

    /* General's switches, theme and disguise lock are read over IPC every time
       Settings opens (the load effects above). Until those reads have landed, a
       change is the pane loading, not news, and must not play a swap — the
       Detectable row would announce "Undetectable" on open. Declared after the
       load effects so its reads queue behind theirs; flips one tick after they
       settle (useMotionReadyAfter's reason) and re-arms on close, because this
       component outlives the modal. */
    const [generalMotionReady, setGeneralMotionReady] = useState(false);
    useEffect(() => {
        if (!isOpen) { setGeneralMotionReady(false); return; }
        let live = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        Promise.allSettled([
            window.electronAPI?.getUndetectable?.(),
            window.electronAPI?.getThemeMode?.(),
        ]).then(() => { if (live) timer = setTimeout(() => { if (live) setGeneralMotionReady(true); }, 0); });
        return () => { live = false; clearTimeout(timer); };
    }, [isOpen]);

    // Listen for device-selection-applied so the user can see when their saved
    // device couldn't be opened and audio fell back to the system default.
    // Pre-fix this was silent: settings showed "AirPods" selected but capture
    // was actually using the built-in mic, leaving users to wonder why their
    // device choice "doesn't work".
    useEffect(() => {
        if (!window.electronAPI?.onDeviceSelectionApplied) return;
        const unsubscribe = window.electronAPI.onDeviceSelectionApplied((payload) => {
            if (payload.fellBack) {
                setDeviceFallbackNotice({
                    kind: payload.kind,
                    requested: payload.requested,
                    actual: payload.actual,
                    reason: payload.reason,
                });
            } else {
                // Successful apply for this kind — clear any stale notice that
                // pointed at the same channel.
                setDeviceFallbackNotice(prev =>
                    prev && prev.kind === payload.kind ? null : prev
                );
            }
        });
        return unsubscribe;
    }, []);

    // Use the native mic test path so device IDs stay consistent with the meeting runtime.
    // Guard: only start when selectedInput is populated (loadDevices sets it after device enum).
    //
    // Mic-indicator discipline: the user expects the orange macOS menu-bar mic
    // indicator to be OFF outside an active meeting OR an explicit Settings >
    // Audio session. The cleanup below guarantees that ANY transition out of
    // the audio-test state (tab switch, settings close, device list cleared,
    // selectedInput flipping to empty during a device-list refresh) tears the
    // native capture down — never leaving a dangling mic-test capture that
    // would keep the indicator lit after the user thinks they left the panel.
    useEffect(() => {
        const shouldRun = isOpen && activeTab === 'audio' && !!selectedInput;

        if (shouldRun) {
            let lastMic = 0;
            let lastSystem = 0;
            const unsubscribe = window.electronAPI?.onAudioTestLevel?.((level) => {
                const next = Math.max(0, Math.min(100, level * 100));
                setMicFalling(next < lastMic);
                lastMic = next;
                setMicLevel(next);
            });

            // The main process probes system audio in PARALLEL with the mic for the
            // duration of the same test, so both meters are driven by the one
            // startAudioTest() call below — there is no separate start/stop to make.
            const unsubscribeSystemLevel = window.electronAPI?.onAudioTestSystemLevel?.((level) => {
                setSystemAudioError(null);
                const next = Math.max(0, Math.min(100, level * 100));
                setSystemFalling(next < lastSystem);
                lastSystem = next;
                setSystemAudioLevel(next);
            });
            // A system-audio failure is reported, never left as a flat bar. A silent
            // zero reads as "quiet" when it actually means the tap could not start,
            // which is precisely the confusion this meter exists to remove.
            const unsubscribeSystemError = window.electronAPI?.onAudioTestSystemError?.((message) => {
                setSystemAudioLevel(0);
                setSystemAudioError(message || 'System audio could not be captured.');
            });

            window.electronAPI?.startAudioTest(selectedInput).catch((error) => {
                console.error("Error starting native microphone test:", error);
                setMicLevel(0);
            });

            return () => {
                unsubscribe?.();
                unsubscribeSystemLevel?.();
                unsubscribeSystemError?.();
                window.electronAPI?.stopAudioTest?.().catch((error) => {
                    console.error("Error stopping native microphone test:", error);
                });
                setMicLevel(0);
                setSystemAudioLevel(0);
                setSystemAudioError(null);
            };
        }

        // Guard ran false on this pass (tab switch, settings close, or
        // selectedInput cleared). If a previous render started a test, the
        // backend audioTestCapture may still be running — explicitly stop it
        // here so the mic indicator turns off even if React skips the prior
        // cleanup (StrictMode double-effect, race during device-list refresh,
        // etc.). This is idempotent on the backend (`stopAudioTest` no-ops on
        // a null audioTestCapture).
        window.electronAPI?.stopAudioTest?.().catch((error) => {
            console.error("Error stopping native microphone test (guard=false):", error);
        });
        setMicLevel(0);
        // Reset the system meter on the same guard-false path as the mic one, or a
        // stale level/error from a previous test survives a tab switch.
        setSystemAudioLevel(0);
        setSystemAudioError(null);
    }, [isOpen, activeTab, selectedInput]);

    return (
        <>
            {confirmDialog}
            {/* Settings pours out of, and back into, the bottom of the window
                like every other popup (GenieModal). */}
            <GenieModal
                open={isOpen}
                label="SettingsOverlay"
                snapshotKey="settings"
                // The tab this open lands on: activeTab only catches up in an
                // effect after the card mounts, too late to pick its picture.
                openingView={initialTab}
                snapshotPaused={isPreviewingOpacity}
                closeInstantly={closeInstantly}
                backdropId="settings-backdrop"
                padding={32}
                backdropClassName={`transition-colors duration-150 ${isPreviewingOpacity ? 'bg-transparent backdrop-blur-none pointer-events-none' : isLight ? 'bg-black/[0.06]' : 'bg-black/60'}`}
                onBackdropClick={() => {
                    // Mirror Modes/Profile (App.tsx) close-on-outside-click.
                    // Skip when opacity slider preview is active — backdrop is
                    // invisible but pointer-active; clicking during preview
                    // would otherwise dismiss Settings mid-drag.
                    if (isPreviewingOpacity) return;
                    onClose();
                }}
                wrapClassName="w-full max-w-4xl h-[80vh]"
                // Phase-1 Soft Orchid rebrand scope: any future Settings dropdown/menu
                // that renders via createPortal(..., document.body) will mount OUTSIDE
                // this data-settings-theme scope and silently fall back to the blue
                // brand accent — portals must be scoped to this subtree (or avoided).
                cardProps={{ id: 'settings-panel-wrapper', 'data-settings-theme': 'periwinkle' }}
                cardClassName={`bg-bg-elevated rounded-2xl border border-border-subtle ${isLight ? 'shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_48px_-12px_rgba(0,0,0,0.16),0_8px_16px_-6px_rgba(0,0,0,0.06)]' : 'shadow-2xl'} overflow-hidden relative`}
                shadow={isLight ? SETTINGS_SHADOW_LIGHT : SETTINGS_SHADOW_DARK}
                radius={16}
            >
                        <div
                            id="settings-panel"
                            data-genie-view={activeTab}
                            className="flex w-full h-full"
                            // Inherit rather than force 'visible': a forced value would show
                            // the real panel through the card while GenieModal hides it mid-genie.
                            style={{ visibility: isPreviewingOpacity ? 'hidden' : undefined }}
                        >
                        {/* Sidebar */}
                        <div className="w-64 bg-bg-sidebar flex flex-col border-r border-border-subtle">
                            <button
                                onClick={onClose}
                                className="self-start ml-2 mt-2 mb-1 p-1.5 rounded-md text-text-tertiary hover:text-text-primary transition-colors"
                                title={t('Close')}
                                aria-label={t('Close')}
                            >
                                <X size={15} />
                            </button>
                            <div className="px-5 pt-2 pb-3 overflow-y-auto flex-1 min-h-0">
                                <h2 className="mb-0 text-[13px] font-bold uppercase tracking-[0.01em] text-text-primary">{t('Settings')}</h2>
                                <nav className="mt-2 space-y-1">
                                    <button
                                        onClick={() => setActiveTab('general')}
                                        className={navItemClass(activeTab === 'general')}
                                    >
                                        {activeTab === 'general' && navActivePill}
                                        <Monitor size={16} /> {t('General')}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('plans')}
                                        className={navItemClass(activeTab === 'plans' || activeTab === 'natively-api' || activeTab === 'natively-pro')}
                                    >
                                        {(activeTab === 'plans' || activeTab === 'natively-api' || activeTab === 'natively-pro') && navActivePill}
                                        <HiCreditCard size={16} />
                                        <span>{t('Plans & Billing')}</span>
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('ai-providers')}
                                        className={navItemClass(activeTab === 'ai-providers')}
                                    >
                                        {activeTab === 'ai-providers' && navActivePill}
                                        <FlaskConical size={16} /> {t('AI Providers')}
                                    </button>
                                    {/* One entry for both halves of document search. The
                                        legacy 'embedding' and 'reranker' ids still render
                                        here (see isRetrievalTab) so existing deep links
                                        land on the matching sub-tab instead of a blank
                                        content area. */}
                                    <button
                                        onClick={() => setActiveTab('retrieval')}
                                        className={navItemClass(isRetrievalTab(activeTab))}
                                    >
                                        {isRetrievalTab(activeTab) && navActivePill}
                                        <Boxes size={16} /> {t('Retrieval')}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('audio')}
                                        className={navItemClass(activeTab === 'audio')}
                                    >
                                        {activeTab === 'audio' && navActivePill}
                                        <Mic size={16} /> {t('Audio')}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('calendar')}
                                        className={navItemClass(activeTab === 'calendar')}
                                    >
                                        {activeTab === 'calendar' && navActivePill}
                                        <Calendar size={16} /> {t('Calendar')}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('skills')}
                                        className={navItemClass(activeTab === 'skills')}
                                    >
                                        {activeTab === 'skills' && navActivePill}
                                        <Folder size={16} /> {t('Skills')}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('keybinds')}
                                        className={navItemClass(activeTab === 'keybinds')}
                                    >
                                        {activeTab === 'keybinds' && navActivePill}
                                        <Keyboard size={16} /> {t('Keybinds')}
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('phone-mirror')}
                                        className={navItemClass(activeTab === 'phone-mirror')}
                                    >
                                        {activeTab === 'phone-mirror' && navActivePill}
                                        <Smartphone size={16} /> {t('Sync')}
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('intelligence')}
                                        className={navItemClass(activeTab === 'intelligence')}
                                    >
                                        {activeTab === 'intelligence' && navActivePill}
                                        <Cpu size={16} /> {t('Intelligence')}
                                    </button>


                                    <button
                                        onClick={() => setActiveTab('help')}
                                        className={navItemClass(activeTab === 'help', 'text-[13px]')}
                                    >
                                        {activeTab === 'help' && navActivePill}
                                        <HelpCircle size={16} /> {t('Setup & Help')}
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('about')}
                                        className={navItemClass(activeTab === 'about')}
                                    >
                                        {activeTab === 'about' && navActivePill}
                                        <Info size={16} /> {t('About')}
                                    </button>
                                </nav>
                            </div>

                            <div className="mt-auto py-4 px-6 border-t border-border-subtle">
                                <button
                                    onClick={() => window.electronAPI.quitApp()}
                                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-3"
                                >
                                    <LogOut size={16} /> {t('Quit Natively')}
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        {/* `overflow-anchor: none` — scroll anchoring defaults to
                            `auto` on a scroll container, so when content above the
                            viewport changes height Chromium silently adjusts
                            scrollTop to compensate. Mid-animation it does that
                            repeatedly, producing micro-jumps that read as choppy
                            and are independent of frame rate. Plans & Billing
                            animates whole regions in and out; this stops the
                            browser fighting it. */}
                        <div ref={panelScrollRef} className="flex-1 bg-bg-main overflow-y-auto p-8 relative" style={{ overflowAnchor: 'none' }}>
                            {/* Section transition. Keyed on panelKey, so React remounts this
                                subtree on a section change — which both replays this
                                translate AND restarts the per-child `data-settings-stagger`
                                CSS cascade inside each section (see src/index.css).

                                The container owns the directional MOVE only; the children own
                                the FADE. Fading here as well would put every child behind a
                                second fade and mush the cascade into one flat block — the
                                whole point of the stagger is that it stays legible.

                                Enter-only by design: an AnimatePresence exit would either
                                stack two full sections (layout jank in a scroll container) or
                                run sequentially with mode="wait" (~2x the duration, which is
                                exactly the sluggishness this is meant to remove).

                                Deliberately NO height class and NO `relative`: a height would
                                add p-8 to a full-height box and manufacture 64px of phantom
                                scroll, and `relative` would re-parent absolutely-positioned
                                descendants off the scroll container. */}
                            <motion.div
                                key={panelKey}
                                style={{ '--settings-stagger-dy': staggerDy } as React.CSSProperties}
                                initial={animatePanel ? { y: reduceMotion ? 0 : panelDirection * 10 } : false}
                                animate={{ y: 0 }}
                                transition={reduceMotion
                                    ? { duration: 0 }
                                    : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                            >
                            {/* A render error in ANY settings section used to destroy the
                                whole launcher window. SettingsOverlay sits inside App's
                                <ErrorBoundary context="Launcher">, so the throw bubbled all
                                the way up and replaced the launcher with "Launcher crashed" —
                                measured 2026-09-15 by injecting a throw into a panel.

                                This boundary keeps the blast radius at the section. It needs
                                no `key` of its own: the motion.div above is keyed on
                                panelKey, so switching sections remounts this subtree and
                                clears a latched error — without that, one bad section would
                                show its fallback on every other tab too. */}
                            <ErrorBoundary context={`Settings · ${panelKey}`}>
                            {activeTab === 'general' && (
                                <SettingsMotionReady.Provider value={generalMotionReady}>
                                <div className="space-y-6 animated fadeIn">
                                    <div className="space-y-3.5">
                                        <div data-settings-stagger>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">{t('General settings')}</h3>
                                            <p className="text-xs text-text-secondary mb-2">{t('Customize how Natively works for you')}</p>

                                            <div className="rounded-xl border bg-transparent border-transparent divide-y divide-border-subtle/20">
                                            <div className="space-y-0">
                                                {/* Detectable / Undetectable */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            {/* The row's state, in all three places it shows: the glyph
                                                                cross-fades, title and sentence swap (Presence). */}
                                                            <Presence kind="icon" id={isUndetectable ? 'undetectable' : 'detectable'} slotClassName="w-5 h-5">
                                                            {isUndetectable ? (
                                                                <svg
                                                                    width="20"
                                                                    height="20"
                                                                    viewBox="0 0 24 24"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                >
                                                                    <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" fill="currentColor" stroke="currentColor" />
                                                                    <path d="M9 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                                    <path d="M15 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                                </svg>
                                                            ) : (
                                                                <Ghost size={20} />
                                                            )}
                                                            </Presence>
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">
                                                                <Presence kind="text" id={isUndetectable ? 'undetectable' : 'detectable'}>
                                                                    {isUndetectable ? t('Undetectable') : t('Detectable')}
                                                                </Presence>
                                                            </h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">
                                                                <Presence kind="text" id={isUndetectable ? 'undetectable' : 'detectable'}>
                                                                    {isUndetectable ? t('Natively is currently undetectable by screen-sharing.') : t('Natively is currently detectable by screen-sharing.')}
                                                                </Presence>{' '}
                                                                {/* The underline fades in with the hover rather than snapping on. */}
                                                                <button onClick={() => window.electronAPI?.openExternal?.('https://natively.software/supportedapps')} className="text-accent-primary underline decoration-transparent hover:decoration-current transition-colors duration-150 ease-out">{t('Supported apps here')}</button>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <SettingsToggle
                                                        checked={isUndetectable}
                                                        label={t('Undetectable mode')}
                                                        onChange={() => {
                                                            const newState = !isUndetectable;
                                                            setIsUndetectable(newState);
                                                            window.electronAPI?.setUndetectable(newState);
                                                            // Analytics: Undetectable Mode Toggle
                                                            analytics.trackModeSelected(newState ? 'undetectable' : 'overlay');
                                                        }}
                                                        className={isUndetectable ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                    />
                                                </div>

                                                {/* Open at Login */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <Power size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">{t('Open Natively when you log in')}</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">{t('Natively will open automatically when you log in to your computer')}</p>
                                                        </div>
                                                    </div>
                                                    <SettingsToggle
                                                        checked={openOnLogin}
                                                        label={t('Open Natively when you log in')}
                                                        onChange={() => {
                                                            const newState = !openOnLogin;
                                                            setOpenOnLogin(newState);
                                                            window.electronAPI?.setOpenAtLogin(newState);
                                                        }}
                                                        className={openOnLogin ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                    />
                                                </div>

                                                {/* Shortcut guard — Windows only. The macOS build has no
                                                    equivalent: RegisterHotKey is the Windows API that silently
                                                    drops registrations, so there is nothing to guard against on
                                                    macOS and no toggle to show. */}
                                                {isWindows && (
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <Keyboard size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Protect Natively shortcuts')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">{t('Keeps shortcuts from typing into the app below. Turn off if antivirus flags it.')}</p>
                                                            </div>
                                                        </div>
                                                        <SettingsToggle
                                                            checked={shortcutGuard}
                                                            label={t('Protect Natively shortcuts')}
                                                            onChange={async () => {
                                                                const previous = shortcutGuard;
                                                                const newState = !previous;
                                                                setShortcutGuard(newState); // Optimistic
                                                                try {
                                                                    const result = await window.electronAPI?.setStealthShortcutGuard?.(newState);
                                                                    if (result && !result.success) {
                                                                        setShortcutGuard(previous);
                                                                        console.error('[Settings] Failed to set shortcut guard');
                                                                    }
                                                                } catch (err) {
                                                                    setShortcutGuard(previous);
                                                                    console.error('[Settings] Exception setting shortcut guard:', err);
                                                                }
                                                            }}
                                                            className={shortcutGuard ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                        />
                                                    </div>
                                                )}

                                                {/* Ambient AI Chat */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <Headphones size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">{t('Ambient AI Chat')}</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">{t('Meetings start without capturing mic or system audio')}</p>
                                                        </div>
                                                    </div>
                                                    <SettingsToggle
                                                        checked={ambientChatEnabled}
                                                        label={t('Ambient AI Chat')}
                                                        onChange={() => {
                                                            const newState = !ambientChatEnabled;
                                                            setAmbientChatEnabled(newState);
                                                            window.electronAPI?.setAmbientChatEnabled?.(newState);
                                                        }}
                                                        className={ambientChatEnabled ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                    />
                                                </div>

                                                {/* Auto Answer */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <AutoAnswerIcon size={20} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Auto Answer')}</h3>
                                                                {/* The same Liquid Glass tag as Direct Assist's, so the two
                                                                    Beta features read as one decision rather than two. It
                                                                    replaces a bespoke solid-yellow span whose --badge-beta-*
                                                                    tokens now have no other reader. */}
                                                                <LiquidGlassBadge variant="sky">{t('Beta')}</LiquidGlassBadge>
                                                            </div>
                                                            <p className="text-xs text-text-secondary mt-0.5">{t('Answers appear as soon as the interviewer finishes a question')}</p>
                                                        </div>
                                                    </div>
                                                    <SettingsToggle
                                                        checked={autoAnswerEnabled}
                                                        label={t('Auto Answer')}
                                                        onChange={async () => {
                                                            const previous = autoAnswerEnabled;
                                                            const newState = !previous;
                                                            setAutoAnswerEnabled(newState); // Optimistic update
                                                            try {
                                                                const result = await window.electronAPI?.setAutoAnswerEnabled?.(newState);
                                                                if (result && !result.success) {
                                                                    // Rollback on explicit failure (settings store degraded)
                                                                    setAutoAnswerEnabled(previous);
                                                                    console.error('[Settings] Failed to set Auto Answer:', result.error);
                                                                }
                                                            } catch (err) {
                                                                setAutoAnswerEnabled(previous);
                                                                console.error('[Settings] Exception setting Auto Answer:', err);
                                                            }
                                                        }}
                                                        className={autoAnswerEnabled ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                    />
                                                </div>

                                                {/* Meeting Retention */}
                                                <div className="flex items-start justify-between px-4 py-3 gap-4">
                                                    <div className="flex items-start gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <Shield size={20} />
                                                        </div>
                                                        <div className="flex-1">
                                                            <h3 className="text-sm font-bold text-text-primary">{t('Do not save meetings')}</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5 leading-normal">{t('Nothing is saved after the meeting ends')}</p>
                                                        </div>
                                                    </div>
                                                    <SettingsToggle
                                                        checked={meetingRetention === 'never'}
                                                        label={t('Do not save meetings')}
                                                        onChange={() => {
                                                            const nextRetention = meetingRetention === 'never' ? 'forever' : 'never';
                                                            setMeetingRetention(nextRetention);
                                                            window.electronAPI?.setMeetingRetention?.(nextRetention);
                                                        }}
                                                        className={`mt-2 ${meetingRetention === 'never' ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    />
                                                </div>

                                                {/* Theme */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <Palette size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">{t('Theme')}</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">{t('Customize how Natively looks on your device')}</p>
                                                        </div>
                                                    </div>

                                                    {/* Theme, Language, Meeting Interface Style and the Check
                                                        and Export buttons share px-2.5 + min-w-[105px], so they
                                                        match. 105px holds the widest label each can show in
                                                        English: Theme "System" with its icon (104.9px, icon at
                                                        gap-1.5) and Check's "Up to date" (104.4px), so no state
                                                        resizes them. A longer label ("Liquid Glass") still grows. */}
                                                    <div className="relative" ref={themeDropdownRef}>
                                                        <button
                                                            onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                                                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[105px] justify-between"
                                                        >
                                                            <div className="flex items-center gap-1.5 overflow-hidden">
                                                                <span className="text-text-secondary shrink-0 flex">
                                                                    <Presence kind="icon" id={themeMode}>
                                                                        {themeMode === 'system' && <Monitor size={14} />}
                                                                        {themeMode === 'light' && <Sun size={14} />}
                                                                        {themeMode === 'dark' && <Moon size={14} />}
                                                                    </Presence>
                                                                </span>
                                                                <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap">
                                                                    <Presence kind="text" id={themeMode}>{themeMode}</Presence>
                                                                </span>
                                                            </div>
                                                            <ChevronDown size={12} className={`shrink-0 transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${isThemeDropdownOpen ? 'rotate-180' : ''}`} />
                                                        </button>

                                                        {/* Dropdown Menu */}
                                                        <SettingsMenu open={isThemeDropdownOpen} origin="top right" className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 select-none">
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
                                                                    className={`group w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${themeMode === option.mode ? 'text-text-primary bg-[color:color-mix(in_srgb,var(--bg-item-active)_50%,transparent)]' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                >
                                                                    <span className={themeMode === option.mode ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}>{option.icon}</span>
                                                                    <span className="font-medium">{t(option.label)}</span>
                                                                </button>
                                                            ))}
                                                        </SettingsMenu>
                                                    </div>
                                                </div>

                                                {/* Language */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <Globe size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">{t('Language')}</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">{t('Interface language for Natively')}</p>
                                                        </div>
                                                    </div>

                                                    <div className="relative" ref={langDropdownRef}>
                                                        {/* The language name is centred, in the button and in
                                                            the menu. In the button it travels with an icon, like
                                                            Theme's and Check's, and the two are centred together.
                                                            Two spacers share the free space. The right one holds
                                                            the chevron and never gets narrower than the chevron
                                                            plus the old 8px gap, so a long name slides left
                                                            instead of under it. The button keeps the 105px of its
                                                            column: "English" with its icon fills it. */}
                                                        <button
                                                            onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                                                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center min-w-[105px]"
                                                        >
                                                            <span aria-hidden="true" className="flex-1 basis-0 min-w-0" />
                                                            <span className="min-w-0 flex items-center gap-1.5">
                                                                <Languages size={14} className="text-text-secondary shrink-0" aria-hidden="true" />
                                                                <span className="min-w-0 text-ellipsis overflow-hidden whitespace-nowrap">
                                                                    {LANG_NATIVE_NAMES[lang]}
                                                                </span>
                                                            </span>
                                                            <span aria-hidden="true" className="flex-1 basis-0 min-w-[20px] flex justify-end">
                                                                <ChevronDown size={12} className={`shrink-0 transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
                                                            </span>
                                                        </button>

                                                        <SettingsMenu open={isLangDropdownOpen} origin="top right" className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 select-none">
                                                            {[
                                                                { code: 'en' as const, label: LANG_NATIVE_NAMES.en },
                                                                { code: 'ru' as const, label: LANG_NATIVE_NAMES.ru },
                                                                { code: 'zh' as const, label: LANG_NATIVE_NAMES.zh },
                                                                { code: 'ja' as const, label: LANG_NATIVE_NAMES.ja },
                                                                { code: 'es' as const, label: LANG_NATIVE_NAMES.es },
                                                            ].map((option) => (
                                                                <button
                                                                    key={option.code}
                                                                    onClick={() => {
                                                                        setLang(option.code);
                                                                        setIsLangDropdownOpen(false);
                                                                    }}
                                                                    className={`relative w-full text-center px-5 py-1.5 rounded-md text-xs flex items-center justify-center transition-colors ${lang === option.code ? 'text-text-primary bg-[color:color-mix(in_srgb,var(--bg-item-active)_50%,transparent)]' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                >
                                                                    {/* Pinned left, out of the flow, so the tick does not push
                                                                        the selected name off centre; px-5 keeps every name
                                                                        clear of it. */}
                                                                    {lang === option.code && <Check size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-primary" />}
                                                                    <span className={lang === option.code ? 'text-text-primary' : 'text-text-secondary'}>{option.label}</span>
                                                                </button>
                                                            ))}
                                                        </SettingsMenu>
                                                    </div>
                                                </div>

                                                {/* Version. items-center like the Theme and Language rows:
                                                    items-start pinned the Check button 5px above their
                                                    buttons, which sit on their tile's centre line. */}
                                                <div className="flex items-center justify-between gap-4 px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                            <BadgeCheck size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">{t('Version')}</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">
                                                                {t('You are currently using Natively version')} {packageJson.version}
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
                                                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100 flex items-center justify-start gap-2 shrink-0 min-w-[105px] ${
                                                            updateStatus === 'checking'
                                                                ? 'bg-bg-input text-text-tertiary border-border-subtle cursor-wait'
                                                                : updateStatus === 'available'
                                                                    ? 'bg-legacy-action-bg text-legacy-action-fg border-legacy-action-bg hover:bg-legacy-action-hover shadow-lg shadow-[var(--legacy-action-shadow)]'
                                                                    : updateStatus === 'uptodate'
                                                                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                                                        : updateStatus === 'error'
                                                                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                                            : 'bg-bg-component hover:bg-bg-elevated text-text-primary border-border-subtle'
                                                        }`}
                                                    >
                                                        {/* justify-start puts the glyph where Theme's and Language's
                                                            icons start; centred, it sat 12px further in. */}
                                                        {/* Each status is one glyph + one word: the glyph cross-fades
                                                            in its 14px slot, the word swaps (Sync's Copy → Copied). */}
                                                        <Presence kind="icon" id={updateStatus}>
                                                            {updateStatus === 'checking' ? <RefreshCw size={14} className="animate-spin" />
                                                                : updateStatus === 'available' ? <ArrowDown size={14} />
                                                                : updateStatus === 'uptodate' ? <Check size={14} />
                                                                : updateStatus === 'error' ? <X size={14} />
                                                                : <RefreshCw size={14} />}
                                                        </Presence>
                                                        <LabelSwap id={updateStatus}>
                                                            {updateStatus === 'checking' ? t('Checking')
                                                                : updateStatus === 'available' ? t('Update')
                                                                : updateStatus === 'uptodate' ? t('Up to date')
                                                                : updateStatus === 'error' ? t('Error')
                                                                : t('Check')}
                                                        </LabelSwap>
                                                    </button>
                                                </div>
                                            </div>
                                            </div>

                                            <div className="pt-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowAdvancedSettings((s) => !s)}
                                                    aria-expanded={showAdvancedSettings}
                                                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
                                                >
                                                    <DisclosureChevron open={showAdvancedSettings} />
                                                    <LabelSwap id={showAdvancedSettings ? 'hide' : 'show'}>
                                                        {showAdvancedSettings ? t('Hide advanced settings') : t('Show advanced settings')}
                                                    </LabelSwap>
                                                </button>
                                                <Disclosure open={showAdvancedSettings} unclipWhenOpen>
                                                <div className="mt-1">
                                                    {/* Mouse Passthrough Toggle — Adapted from public PR #113 */}
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <PointerOff size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Mouse Passthrough')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">
                                                                    {t('Pass all mouse clicks through to the app beneath.')}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <SettingsToggle
                                                            checked={isMousePassthrough}
                                                            label={t('Mouse Passthrough')}
                                                            onChange={() => {
                                                                const newState = !isMousePassthrough;
                                                                setIsMousePassthrough(newState);
                                                                window.electronAPI?.setOverlayMousePassthrough(newState);
                                                            }}
                                                            className={isMousePassthrough ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                        />
                                                    </div>

                                                    {/* Code Verification — runs LLM-generated code against test cases + one-shot correction */}
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <Code2 size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Verify coding answers')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">{t('Run generated code against test cases and self-correct')}</p>
                                                            </div>
                                                        </div>
                                                        <SettingsToggle
                                                            checked={codeVerification}
                                                            label={t('Verify coding answers')}
                                                            onChange={() => {
                                                                const newState = !codeVerification;
                                                                setCodeVerification(newState);
                                                                // Swallow rejection: a missing handler (pre-rebuild) must not
                                                                // spam the console with unhandledrejection noise like the
                                                                // other toggle-style settings also use optional chaining.
                                                                window.electronAPI?.setCodeVerification?.(newState)?.catch?.(() => { });
                                                            }}
                                                            className={codeVerification ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                        />
                                                    </div>

                                                    {/* Interviewer Transcript */}
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <MessageSquare size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Interviewer Transcript')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">{t('Show real-time transcription of the interviewer')}</p>
                                                            </div>
                                                        </div>
                                                        <SettingsToggle
                                                            checked={showTranscript}
                                                            label={t('Interviewer Transcript')}
                                                            onChange={() => {
                                                                const newState = !showTranscript;
                                                                setShowTranscript(newState);
                                                                localStorage.setItem('natively_interviewer_transcript', String(newState));
                                                                window.dispatchEvent(new Event('storage'));
                                                            }}
                                                            className={showTranscript ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                        />
                                                    </div>

                                                    {/* Debug Logging */}
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <Terminal size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Debug logging')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">
                                                                    {t('Logs audio, STT, routing, questions and answers. API keys removed.')}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <SettingsToggle
                                                            checked={verboseLogging}
                                                            label={t('Debug logging')}
                                                            onChange={() => {
                                                                const newState = !verboseLogging;
                                                                setVerboseLogging(newState);
                                                                window.electronAPI?.setVerboseLogging?.(newState);
                                                                if (newState) setShowVerboseToast(true);
                                                            }}
                                                            className={verboseLogging ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                                        />
                                                    </div>


                                                    {/* Verbose logging notice — the log location AND the
                                                        full-capture privacy disclosure as ONE card, shown for
                                                        10s when the user turns logging on. */}
                                                    <AnimatePresence>
                                                        {showVerboseToast && (
                                                            <motion.div
                                                                key="verbose-toast"
                                                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
                                                                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, height: 'auto' }}
                                                                exit={reduceMotion
                                                                    ? { opacity: 0, transition: { duration: 0.15 } }
                                                                    : { opacity: 0, y: -4, height: 0, transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] } }}
                                                                transition={{ duration: reduceMotion ? 0.15 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                                                                className="mx-4 mb-1 overflow-hidden"
                                                            >
                                                                <div className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                                            <Terminal size={14} className={`${isLight ? 'text-amber-700' : 'text-amber-400'} shrink-0`} />
                                                                            <p className={`text-xs ${isLight ? 'text-amber-800' : 'text-amber-200/80'} leading-snug truncate`}>
                                                                                Logs → <span className={`font-mono ${isLight ? 'text-amber-900' : 'text-amber-300'}`}>~/Documents/natively_debug.log</span>
                                                                            </p>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => window.electronAPI?.openLogFile?.()}
                                                                            className={`shrink-0 text-[11px] font-medium ${isLight ? 'text-amber-800 hover:text-amber-900' : 'text-amber-400 hover:text-amber-300'} transition-colors px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25`}
                                                                        >
                                                                            Open
                                                                        </button>
                                                                    </div>
                                                                    <p className={`text-xs ${isLight ? 'text-amber-800' : 'text-amber-200/80'} leading-snug mt-2`}>
                                                                        {t('Full capture records your transcripts, questions, and answers in plaintext on this device. API keys and tokens are always removed. Review a log before sharing it.')}
                                                                    </p>
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>

                                                    {/* Meeting Interface Style */}
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <Layout size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Meeting Interface Style')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">
                                                                    <Presence kind="text" id={meetingInterfaceTheme}>
                                                                        {meetingInterfaceTheme === 'liquid-glass'
                                                                            ? t('Liquid glass — Apple-inspired transparent overlay')
                                                                            : meetingInterfaceTheme === 'modern'
                                                                                ? t('Modern — polished dark glass with cobalt accents')
                                                                                : t('Default overlay appearance')}
                                                                    </Presence>
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="relative" ref={interfaceThemeDropdownRef}>
                                                            {/* Centred like Language's picker: two spacers share the free
                                                                space, and the right one holds the chevron and never gets
                                                                narrower than the chevron plus the old 8px gap, so
                                                                "Liquid Glass" slides left instead of under it. */}
                                                            <button
                                                                onClick={() => setIsInterfaceThemeDropdownOpen(!isInterfaceThemeDropdownOpen)}
                                                                className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center min-w-[105px]"
                                                            >
                                                                <span aria-hidden="true" className="flex-1 basis-0 min-w-0" />
                                                                <span className="min-w-0 text-ellipsis overflow-hidden whitespace-nowrap">
                                                                    <Presence kind="text" id={meetingInterfaceTheme}>
                                                                        {meetingInterfaceTheme === 'liquid-glass'
                                                                            ? 'Liquid Glass'
                                                                            : meetingInterfaceTheme === 'modern'
                                                                                ? 'Modern'
                                                                                : t('Default')}
                                                                    </Presence>
                                                                </span>
                                                                <span aria-hidden="true" className="flex-1 basis-0 min-w-[20px] flex justify-end">
                                                                    <ChevronDown size={12} className={`shrink-0 transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${isInterfaceThemeDropdownOpen ? 'rotate-180' : ''}`} />
                                                                </span>
                                                            </button>

                                                            {/* Opens down past the Export row: the advanced Disclosure is
                                                                unclipWhenOpen, so the menu is not cut off at its edge. */}
                                                            <SettingsMenu open={isInterfaceThemeDropdownOpen} origin="top right" className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 select-none">
                                                                {([
                                                                    { mode: 'default' as MeetingInterfaceTheme, label: 'Default' },
                                                                    { mode: 'liquid-glass' as MeetingInterfaceTheme, label: 'Liquid Glass' },
                                                                    { mode: 'modern' as MeetingInterfaceTheme, label: 'Modern' },
                                                                ] as const).map((option) => (
                                                                    <button
                                                                        key={option.mode}
                                                                        onClick={() => {
                                                                            setMeetingInterfaceTheme(option.mode);
                                                                            setMeetingInterfaceThemeState(option.mode);
                                                                            setIsInterfaceThemeDropdownOpen(false);
                                                                        }}
                                                                        className={`w-full text-center px-2.5 py-1.5 rounded-md text-xs flex items-center justify-center transition-colors ${meetingInterfaceTheme === option.mode ? 'text-text-primary bg-[color:color-mix(in_srgb,var(--bg-item-active)_50%,transparent)]' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                    >
                                                                        <span className="font-medium">{t(option.label)}</span>
                                                                    </button>
                                                                ))}
                                                            </SettingsMenu>
                                                        </div>
                                                    </div>

                                                    {/* Export debug logs — collects the main log, the previous
                                                        session, the structured JSONL records and a system-info
                                                        header into one folder and reveals it. */}
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
                                                                <Download size={20} />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-bold text-text-primary">{t('Export debug logs')}</h3>
                                                                <p className="text-xs text-text-secondary mt-0.5">
                                                                    <Presence kind="text" id={exportResult ?? 'idle'}>
                                                                        {exportResult ?? t('Collect this session\u2019s logs into one folder to share')}
                                                                    </Presence>
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={exportingLogs}
                                                            onClick={async () => {
                                                                setExportingLogs(true);
                                                                setExportResult(null);
                                                                try {
                                                                    const r = await window.electronAPI?.exportDebugLogs?.();
                                                                    setExportResult(r?.success
                                                                        ? t('Exported {{n}} file(s) \u2014 revealed in your file manager').replace('{{n}}', String(r.files?.length ?? 0))
                                                                        : t('Export failed: {{e}}').replace('{{e}}', r?.error ?? 'unknown'));
                                                                } catch (e: any) {
                                                                    setExportResult(t('Export failed: {{e}}').replace('{{e}}', e?.message ?? 'unknown'));
                                                                } finally {
                                                                    setExportingLogs(false);
                                                                }
                                                            }}
                                                            className="shrink-0 min-w-[105px] text-xs font-medium px-2.5 py-1.5 rounded-lg bg-bg-item-surface border border-border-subtle text-text-primary hover:bg-[color:var(--bg-row-hover)] transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100 disabled:opacity-50"
                                                        >
                                                            {/* min-w-[105px] + px-2.5 like every other control in this
                                                                column; it also holds "Exporting…", so the swap can't
                                                                resize the box. */}
                                                            <LabelSwap id={exportingLogs ? 'exporting' : 'idle'}>
                                                                {exportingLogs ? t('Exporting\u2026') : t('Export')}
                                                            </LabelSwap>
                                                        </button>
                                                    </div>
                                                </div>
                                                </Disclosure>
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
                                                            {t('Interface Opacity')}
                                                        </label>
                                                        {/*
                                                         * Render previewOverlayOpacity (live drag value), NOT
                                                         * overlayOpacity (committed). The drag handler at
                                                         * handleOpacityChange does an imperative
                                                         *   document.querySelectorAll('.opacity-percent-label')
                                                         *     .forEach(el => el.textContent = percentText)
                                                         * for sub-frame latency, then calls setPreviewOverlayOpacity(val).
                                                         * That setter queues a React re-render — if this JSX read
                                                         * `overlayOpacity` (the un-committed pre-drag value), React
                                                         * would clobber the imperative text back to the stale value
                                                         * on the next commit, producing a visible flicker every
                                                         * drag tick. Reading previewOverlayOpacity keeps React's
                                                         * render and the imperative write in agreement — the
                                                         * imperative write still wins the sub-frame race, React's
                                                         * commit just confirms the same value.
                                                         */}
                                                        <span className="opacity-percent-label text-xs font-semibold text-text-primary tabular-nums">
                                                            {Math.round(previewOverlayOpacity * 100)}%
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
                                                        className="lg-slider w-full h-1.5 rounded-full appearance-none bg-bg-input"
                                                        style={{
                                                            WebkitAppearance: 'none',
                                                            // Same body as the selected Process Disguise tile.
                                                            '--lg-knob-bg': isLight ? SELECTED_PERIWINKLE_LIGHT : SELECTED_PERIWINKLE,
                                                        } as React.CSSProperties}
                                                    />

                                                    <div className="flex justify-between mt-1.5">
                                                        <span className="text-[10px] text-text-tertiary">{t('More Stealth')}</span>
                                                        <span className="text-[10px] text-text-tertiary">{t('Fully Visible')}</span>
                                                    </div>

                                                    <p className="text-xs text-text-tertiary mt-2">
                                                        {t('Controls the visibility of the in-meeting overlay.')}{' '}
                                                        <span className="text-text-secondary">{t('Hold the slider to preview.')}</span>
                                                    </p>
                                                </div>

                                        </div>

                                    </div>

                                    {/* Process Disguise */}
                                    <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle`}>
                                        <div className="flex flex-col gap-1 mb-3">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-bold text-text-primary">{t('Process Disguise')}</h3>
                                            </div>
                                            <p className="text-xs text-text-secondary">
                                                {t('Disguise Natively as another application to prevent detection during screen sharing.')}
                                                <span className="block mt-1 text-text-tertiary">
                                                    {t('Select a disguise to be automatically applied when Undetectable mode is on.')}
                                                </span>
                                            </p>
                                        </div>

                                        {/* `.lg-clear` inherits its label colour from this grid. No blanket
                                            opacity when locked: `disabled` dims the parts and keeps the rim
                                            (ui-components/design.md, States). */}
                                        {/* The lock notice folds open above the grid rather than popping in
                                            as a grid row, which shoved all four tiles down in one frame.
                                            Same box as before: 8px under the header (the -4px margin it
                                            always had, now animated with it), 16px over the tiles. */}
                                        <AnimatePresence initial={false}>
                                            {isUndetectable && (
                                                <motion.div
                                                    key="disguise-lock"
                                                    initial={generalMotionReady ? (reduceMotion ? { opacity: 0, marginTop: -4 } : { opacity: 0, height: 0, marginTop: 0 }) : false}
                                                    animate={{ opacity: 1, height: 'auto', marginTop: -4 }}
                                                    exit={reduceMotion ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] } }}
                                                    transition={{ duration: reduceMotion ? 0.15 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                                                    style={{ overflow: 'hidden' }}
                                                >
                                                    <p className="text-xs text-yellow-500/80 pb-4">
                                                        ⚠️ {t('Disable Undetectable mode first to change disguise.')}
                                                    </p>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                        <div className={`grid grid-cols-2 gap-3 text-text-secondary ${isUndetectable ? 'pointer-events-none' : ''}`}>
                                            {[
                                                // Names match what _applyDisguise renames the app to per platform.
                                                { id: 'none', label: 'None (Default)', icon: <Layout size={18} strokeWidth={1.75} /> },
                                                { id: 'terminal', label: isWindows ? 'Command Prompt' : 'Terminal', icon: <Terminal size={18} strokeWidth={1.75} /> },
                                                { id: 'settings', label: isWindows ? 'Settings' : 'System Settings', icon: <Settings size={18} strokeWidth={1.75} /> },
                                                { id: 'activity', label: isWindows ? 'Task Manager' : 'Activity Monitor', icon: <Activity size={18} strokeWidth={1.75} /> }
                                            ].map((option) => {
                                                const selected = disguiseMode === option.id;
                                                return (
                                                    <LiquidGlassButton
                                                        key={option.id}
                                                        variant={selected ? 'action' : 'clear'}
                                                        className="lg-sm lg-tile w-full [&_.lg-content]:justify-start"
                                                        icon={<span className={selected ? undefined : 'text-text-primary'}>{option.icon}</span>}
                                                        aria-pressed={selected}
                                                        disabled={isUndetectable}
                                                        style={selected ? (isLight ? DISGUISE_TILE_SELECTED_LIGHT : DISGUISE_TILE_SELECTED) : DISGUISE_TILE_RESTING}
                                                        onClick={() => {
                                                            if (isUndetectable) return;
                                                            // @ts-ignore
                                                            setDisguiseMode(option.id);
                                                            // @ts-ignore
                                                            window.electronAPI?.setDisguise(option.id);
                                                            // Analytics
                                                            analytics.trackModeSelected(`disguise_${option.id}`);
                                                        }}
                                                    >
                                                        {t(option.label)}
                                                    </LiquidGlassButton>
                                                );
                                            })}
                                        </div>
                                    </div>

                                </div>
                                </SettingsMotionReady.Provider>
                            )}

                            {activeTab === 'ai-providers' && (
                                <AIProvidersSettings
                                    onNavigate={setActiveTab}
                                    aiResponseLanguage={aiResponseLanguage}
                                    availableAiLanguages={availableAiLanguages}
                                    isAiLangDropdownOpen={isAiLangDropdownOpen}
                                    onToggleAiLangDropdown={() => setIsAiLangDropdownOpen(!isAiLangDropdownOpen)}
                                    onSelectAiLanguage={(code) => {
                                        handleAiLanguageChange(code);
                                        setIsAiLangDropdownOpen(false);
                                    }}
                                    aiLangDropdownRef={aiLangDropdownRef}
                                />
                            )}
                            {activeTab === 'skills' && (
                                <SkillsSettings />
                            )}
                            {(activeTab === 'plans' || activeTab === 'natively-api' || activeTab === 'natively-pro') && (
                                <PlansSettings initialIsPremium={initialIsPremium} initialHasNativelyKey={hasNativelyKey} />
                            )}
                            {activeTab === 'keybinds' && (
                                <div className="space-y-5 animated fadeIn select-text pb-4">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">{t('Keyboard shortcuts')}</h3>
                                            <p className="text-xs text-text-secondary">{t('Natively works with these easy to remember commands.')}</p>
                                        </div>
                                        <button
                                            onClick={resetShortcuts}
                                            className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle hover:bg-bg-item-surface hover:border-green-500/30 transition-[color,background-color,border-color,transform] duration-150 ease-out text-xs font-medium text-text-secondary hover:text-green-500 active:scale-95 mt-1"
                                        >
                                            <RotateCcw size={13} strokeWidth={2.5} />
                                            {t('Restore Default')}
                                        </button>
                                    </div>

                                    {/* Issue #517: one switch to stop Natively claiming keys OS-wide.
                                        The card fill is what makes it a card in dark, where
                                        --border-subtle is transparent. */}
                                    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-border-subtle bg-bg-card">
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary">{t('Global shortcuts')}</h4>
                                            <p className="text-xs text-text-secondary mt-0.5">
                                                <DescriptionSwap id={globalShortcutsEnabled ? 'global' : 'focused'}>
                                                    {globalShortcutsEnabled
                                                        ? t('Shortcuts work even when another app is focused.')
                                                        : t('Shortcuts work only while Natively is focused. Toggle Visibility stays global so you can always bring Natively back.')}
                                                </DescriptionSwap>
                                            </p>
                                        </div>
                                        <SettingsToggle
                                            checked={globalShortcutsEnabled}
                                            label={t('Global shortcuts')}
                                            onChange={() => setGlobalShortcutsEnabled(!globalShortcutsEnabled)}
                                            className={globalShortcutsEnabled ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
                                        />
                                    </div>

                                    {/* Surfaces globalShortcut.register() failures in bulk — e.g. on
                                        Windows, another running app (screenshot tool, clipboard
                                        manager, IME) can silently claim a combo Natively wants,
                                        which otherwise looks like "the hotkey just doesn't work". */}
                                    {conflicts.size > 0 && (
                                        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 settings-swap-in">
                                            <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                            <p className="text-xs text-amber-200/90 leading-snug">
                                                {t("Some shortcuts below (marked \"In use\") are claimed by another app on your system and won't fire. Record a new key combo for each to fix it.")}
                                            </p>
                                        </div>
                                    )}

                                    <div className="grid gap-6" data-settings-stagger>
                                        {/* General Category */}
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary mb-3">{t('General')}</h4>
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Eye size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Toggle Visibility')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('toggleVisibility')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.toggleVisibility}
                                                            onSave={(keys) => updateShortcut('toggleVisibility', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><PointerOff size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Toggle Mouse Passthrough')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('toggleMousePassthrough')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.toggleMousePassthrough}
                                                            onSave={(keys) => updateShortcut('toggleMousePassthrough', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><MessageSquare size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Process Screenshots')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('processScreenshots')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.processScreenshots}
                                                            onSave={(keys) => updateShortcut('processScreenshots', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Sparkles size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Capture Screen & Ask AI')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('captureAndProcess')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.captureAndProcess}
                                                            onSave={(keys) => updateShortcut('captureAndProcess', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Globe size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Capture Page (Browser)')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('capturePage')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.capturePage}
                                                            onSave={(keys) => updateShortcut('capturePage', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><RotateCcw size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Reset / Cancel')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('resetCancel')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.resetCancel}
                                                            onSave={(keys) => updateShortcut('resetCancel', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Camera size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Take Screenshot')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('takeScreenshot')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.takeScreenshot}
                                                            onSave={(keys) => updateShortcut('takeScreenshot', keys)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between py-1.5 group">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Crop size={14} /></span>
                                                        <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t('Selective Screenshot')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {renderShortcutConflictBadge('selectiveScreenshot')}
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.selectiveScreenshot}
                                                            onSave={(keys) => updateShortcut('selectiveScreenshot', keys)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Chat Category */}
                                        <div>
                                            <div className="mb-3">
                                                <h4 className="text-sm font-bold text-text-primary">{t('Chat')}</h4>
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
                                                    { id: 'acceptSuggestion', label: 'Use Suggestion', icon: <CornerDownRight size={14} /> },
                                                    { id: 'scrollUp', label: 'Scroll Up', icon: <ArrowUp size={14} /> },
                                                    { id: 'scrollDown', label: 'Scroll Down', icon: <ArrowDown size={14} /> },
                                                    { id: 'scrollLeft', label: 'Scroll Left (code block)', icon: <ArrowLeft size={14} /> },
                                                    { id: 'scrollRight', label: 'Scroll Right (code block)', icon: <ArrowRight size={14} /> },
                                                    { id: 'focusInput', label: 'Toggle Stealth Typing', icon: <MessageSquare size={14} /> },
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t(item.label)}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {renderShortcutConflictBadge(item.id as keyof typeof shortcuts)}
                                                            <KeyRecorder
                                                                currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                                                onSave={(keys) => updateShortcut(item.id as any, keys)}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Window Category */}
                                        <div>
                                            <h4 className="text-sm font-bold text-text-primary mb-3">{t('Window')}</h4>
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
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{t(item.label)}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {renderShortcutConflictBadge(item.id as keyof typeof shortcuts)}
                                                            <KeyRecorder
                                                                currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                                                onSave={(keys) => updateShortcut(item.id as any, keys)}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'audio' && (
                                <div className="space-y-6 animated fadeIn" data-settings-stagger>
                                    {/* ── Speech Provider Section ── */}
                                    <div>
                                        <h3 className="text-lg font-bold text-text-primary mb-1">{t('Speech Provider')}</h3>
                                        <p className="text-xs text-text-secondary mb-4">{t('Choose the engine that transcribes audio to text.')}</p>

                                        <div className="space-y-4">
                                            <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                                                <label className="text-xs font-medium text-text-secondary block">{t('Speech Provider')}</label>
                                                <div className="relative">
                                                    <ProviderSelect
                                                        value={sttProvider}
                                                        onChange={(val) => handleSttProviderChange(val as any)}
                                                        options={[
                                                            /* Icons are each provider's official monochrome brand mark, inlined so it
                                                               inherits the tile's per-provider tint (see src/components/ui/BrandMark.tsx).
                                                               Soniox is a monogram because it publishes no licence-compatible mark;
                                                               Natively is our own logo component. Every option used to share one
                                                               generic <Mic>, which made the list unreadable at a glance. */
                                                            ...(hasNativelyKey ? [{ id: 'natively', label: 'Natively API', badge: 'Saved' as const, desc: t('Managed transcription via Natively backend'), color: 'blue', icon: <BrandMark provider="natively" />, neutralTile: true }] : []),
                                                            /* Directly under Natively API: both are turnkey — no key to paste,
                                                               nothing to configure — so they belong together at the top, ahead
                                                               of the bring-your-own-key providers. macOS only; the mark is
                                                               Apple's because the model runs on this machine. */
                                                            ...(isMac ? [{ id: 'apple-speech', label: 'Apple Speech', badge: null, desc: t('On-device · macOS 26+'), color: 'green', icon: <BrandMark provider="apple" />, neutralTile: true }] : []),
                                                            { id: 'google', label: 'Google Cloud', badge: googleServiceAccountPath ? 'Saved' : null, desc: t('gRPC streaming via Service Account'), color: 'blue', icon: <BrandMark provider="google" />, neutralTile: true },
                                                            { id: 'groq', label: 'Groq Whisper', badge: hasStoredSttGroqKey ? 'Saved' : null, desc: t('Ultra-fast REST transcription'), color: 'orange', icon: <BrandMark provider="groq" />, neutralTile: true },
                                                            { id: 'nvidia_nim', label: 'Nvidia Nim', badge: hasStoredNvidiaNimKey ? 'Saved' : null, desc: t('Low-latency Nemotron / Parakeet streaming ASR'), color: 'green', icon: <BrandMark provider="nvidia_nim" />, neutralTile: true },
                                                            { id: 'openai', label: 'OpenAI Whisper', badge: hasStoredSttOpenaiKey ? 'Saved' : null, desc: t('OpenAI-compatible Whisper API'), color: 'green', icon: <BrandMark provider="openai" />, neutralTile: true },
                                                            { id: 'deepgram', label: 'Deepgram', badge: hasStoredDeepgramKey ? 'Saved' : null, desc: `${STT_MODEL_CATALOG.deepgram.models.find((m) => m.id === sttModels.deepgram)?.label ?? 'Nova-3'} · ${t('300 ms endpointing')}`, color: 'purple', icon: <BrandMark provider="deepgram" />, neutralTile: true },
                                                            { id: 'elevenlabs', label: 'ElevenLabs Scribe', badge: hasStoredElevenLabsKey ? 'Saved' : null, desc: t('Scribe v2 Realtime API'), color: 'teal', icon: <BrandMark provider="elevenlabs" />, neutralTile: true },
                                                            { id: 'azure', label: 'Azure Speech', badge: hasStoredAzureKey ? 'Saved' : null, desc: t('Microsoft Cognitive Services STT'), color: 'cyan', icon: <BrandMark provider="azure" />, neutralTile: true },
                                                            { id: 'ibmwatson', label: 'IBM Watson', badge: hasStoredIbmWatsonKey ? 'Saved' : null, desc: t('IBM Watson cloud STT service'), color: 'indigo', icon: <BrandMark provider="ibmwatson" />, neutralTile: true },
                                                            /* Soniox has no licence-compatible mark, so its monogram reproduces the brand's
                                                               own treatment instead of a generic tint: white letterform on black. Fixed in
                                                               both themes — it is a brand colour pair, not a themed surface. */
                                                            { id: 'soniox', label: 'Soniox', badge: hasStoredSonioxKey ? 'Saved' : null, desc: t('60+ languages, multilingual, domain context'), color: 'cyan', icon: <BrandMonogram name="Soniox" />, tileClassName: 'bg-black text-white' },
                                                            /* Label only — the `local-whisper` id stays as-is. It is the persisted
                                                               sttProvider value and is matched across the main process, IPC and
                                                               CredentialsManager, so renaming it would strand every existing user
                                                               on a provider the app no longer recognises. */
                                                            /* The host OS mark: these models run on THIS machine, so the platform is
                                                               the identity. Apple on macOS; on Windows the Microsoft mark, because no
                                                               Windows logo exists under a licence compatible with AGPL-3.0 (it is in
                                                               neither lobehub nor simple-icons — see the README). `isMac` is the same
                                                               platform source the rest of this panel uses. */
                                                            { id: 'local-whisper', label: 'Local Models', badge: null, desc: t('Privacy-first: runs 100% on your device'), color: 'green', icon: <BrandMark provider={isMac ? 'apple' : 'microsoft'} />, neutralTile: true },
                                                        ]}
                                                    />
                                                </div>
                                            </div>

                                            {/* Groq Model Selector */}
                                            {/* Each card below belongs to one provider and fades up as it
                                                mounts (.settings-swap-in, src/index.css), so switching the
                                                provider above swaps them in rather than cutting. */}
                                            {/* Google Cloud Service Account */}
                                            {sttProvider === 'google' && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4 settings-swap-in">
                                                    <label className="text-xs font-medium text-text-secondary mb-2 block">{t('Service Account JSON')}</label>
                                                    <div className="flex gap-2">
                                                        <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-secondary font-mono truncate">
                                                            {googleServiceAccountPath
                                                                ? <span className="text-text-primary">{googleServiceAccountPath.split('/').pop()}</span>
                                                                : <span className="text-text-tertiary italic">{t('No file selected')}</span>}
                                                        </div>
                                                        <button
                                                            onClick={async () => {
                                                                // @ts-ignore
                                                                const result = await window.electronAPI?.selectServiceAccount?.();
                                                                if (result?.success && result.path) {
                                                                    setGoogleServiceAccountPath(result.path);
                                                                    setGoogleServiceAccountError('');
                                                                } else if (result && !result.cancelled) {
                                                                    // A rejected pick must say WHY. Silently doing nothing
                                                                    // reads as "Settings is broken" and the user retries
                                                                    // the same wrong file.
                                                                    setGoogleServiceAccountError(result.error || t('That file is not a usable Google service-account key.'));
                                                                }
                                                            }}
                                                            className="px-3 py-2 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 flex items-center gap-2"
                                                        >
                                                            <Upload size={14} /> {t('Select File')}
                                                        </button>
                                                    </div>
                                                    {googleServiceAccountError && (
                                                        <p className="text-xs text-red-400 mt-2">{googleServiceAccountError}</p>
                                                    )}
                                                    <p className="text-[10px] text-text-tertiary mt-2">
                                                        {t('Required for Google Cloud Speech-to-Text.')}
                                                    </p>
                                                </div>
                                            )}

                                            {/* API Key Input (non-Google providers) — AI Providers' own card
                                                (ProviderCard): the provider's mark and name with Get Key on the
                                                head row, the key in one field with Save as its inset segment,
                                                then Test Connection on a row of its own and one note line for
                                                an error. The .aip-* sheet it needs is the one the Local Models
                                                panel already brings into this pane, so a speech key reads
                                                exactly like a model key does in AI Providers. Keyed on the
                                                provider: every key-backed provider shares this card, so
                                                without a key it would never remount — and never swap. */}
                                            {sttProvider !== 'google' && sttProvider !== 'local-whisper' && sttProvider !== 'apple-speech' && sttProvider !== 'natively' && sttProvider !== 'none' && (() => {
                                                const providerName = sttProvider === 'nvidia_nim' ? 'Nvidia Nim' : sttProvider === 'groq' ? 'Groq' : sttProvider === 'openai' ? 'OpenAI STT' : sttProvider === 'elevenlabs' ? 'ElevenLabs' : sttProvider === 'azure' ? 'Azure' : sttProvider === 'ibmwatson' ? 'IBM Watson' : sttProvider === 'soniox' ? 'Soniox' : 'Deepgram';
                                                const keyValue = sttProvider === 'nvidia_nim' ? sttNvidiaNimKey
                                                    : sttProvider === 'groq' ? sttGroqKey
                                                    : sttProvider === 'openai' ? sttOpenaiKey
                                                    : sttProvider === 'elevenlabs' ? sttElevenLabsKey
                                                    : sttProvider === 'azure' ? sttAzureKey
                                                    : sttProvider === 'ibmwatson' ? sttIbmKey
                                                    : sttProvider === 'soniox' ? sttSonioxKey
                                                    : sttDeepgramKey;
                                                const hasStoredKey = sttProvider === 'nvidia_nim' ? hasStoredNvidiaNimKey
                                                    : sttProvider === 'groq' ? hasStoredSttGroqKey
                                                    : sttProvider === 'openai' ? hasStoredSttOpenaiKey
                                                    : sttProvider === 'elevenlabs' ? hasStoredElevenLabsKey
                                                    : sttProvider === 'azure' ? hasStoredAzureKey
                                                    : sttProvider === 'ibmwatson' ? hasStoredIbmWatsonKey
                                                    : sttProvider === 'soniox' ? hasStoredSonioxKey
                                                    : hasStoredDeepgramKey;
                                                // handleRemoveSttKey has no NVIDIA branch (the key is shared
                                                // with AI Providers), so the card never offered one.
                                                const removable = hasStoredKey && sttProvider !== 'nvidia_nim';
                                                return (
                                                // The card's fill is this pane's (bg-card), not AI Providers'
                                                // (bg-item-surface): in the light theme that is grey against the
                                                // white Speech Provider and Language cards around it.
                                                <div key={sttProvider} className="aip-root settings-swap-in" data-theme={resolvedTheme} style={{ ['--aip-card-bg' as string]: 'var(--bg-card)' } as React.CSSProperties}>
                                                    {/* bg-bg-card also brings the light theme's card shadow
                                                        (index.css, "Level 1"), which the cards around it have. */}
                                                    <div className="aip-card aip-provider bg-bg-card">
                                                        <div className="aip-provider-head">
                                                            {/* The provider's official mark, as AI Providers draws it.
                                                                Soniox publishes no licence-clean mark: its monogram in
                                                                the brand's own white-on-black. */}
                                                            {sttProvider === 'soniox' ? (
                                                                <span className="aip-tile" style={{ background: '#000', color: '#fff', borderColor: 'transparent' }} aria-hidden="true">SO</span>
                                                            ) : (
                                                                <span className="aip-tile aip-tile--mark" aria-hidden="true">
                                                                    <BrandMark provider={sttProvider} />
                                                                </span>
                                                            )}
                                                            <h4 className="aip-card-title truncate min-w-0">{providerName}</h4>
                                                            {STT_KEY_URLS[sttProvider] && (
                                                                <div className="ml-auto flex items-center gap-2 shrink-0">
                                                                    <button
                                                                        // @ts-ignore
                                                                        onClick={() => window.electronAPI?.openExternal(STT_KEY_URLS[sttProvider])}
                                                                        className="aip-btn"
                                                                        data-size="sm"
                                                                        data-variant="ghost"
                                                                        title={`Get ${providerName} API Key`}
                                                                    >
                                                                        <span className="uppercase tracking-wide">{t('Get Key')}</span>
                                                                        <ExternalLink size={12} strokeWidth={1.75} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {sttProvider === 'openai' && (
                                                            <p className="aip-meta">{t('This key is separate from your main AI Provider key.')}</p>
                                                        )}

                                                        <div className="aip-provider-row">
                                                            <div className="aip-provider-field">
                                                                {/* One 32px shell: glyph + input + Save as an inset segment. */}
                                                                <div className="aip-field">
                                                                    <KeyRound size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                                                    <input
                                                                        type="password"
                                                                        value={keyValue}
                                                                        onChange={(e) => {
                                                                            if (sttProvider === 'nvidia_nim') setSttNvidiaNimKey(e.target.value);
                                                                            else if (sttProvider === 'groq') setSttGroqKey(e.target.value);
                                                                            else if (sttProvider === 'openai') setSttOpenaiKey(e.target.value);
                                                                            else if (sttProvider === 'elevenlabs') setSttElevenLabsKey(e.target.value);
                                                                            else if (sttProvider === 'azure') setSttAzureKey(e.target.value);
                                                                            else if (sttProvider === 'ibmwatson') setSttIbmKey(e.target.value);
                                                                            else if (sttProvider === 'soniox') setSttSonioxKey(e.target.value);
                                                                            else setSttDeepgramKey(e.target.value);
                                                                        }}
                                                                        autoComplete="off"
                                                                        spellCheck={false}
                                                                        data-1p-ignore
                                                                        aria-label={`${providerName} ${t('API key')}`}
                                                                        placeholder={
                                                                            sttProvider === 'nvidia_nim'
                                                                                ? (hasStoredNvidiaNimKey ? '••••••••••••' : t('Enter Nvidia Nim API key'))
                                                                                : sttProvider === 'groq'
                                                                                ? (hasStoredSttGroqKey ? '••••••••••••' : t('Enter Groq API key'))
                                                                                : sttProvider === 'openai'
                                                                                    ? (hasStoredSttOpenaiKey ? '••••••••••••' : t('Enter OpenAI STT API key'))
                                                                                    : sttProvider === 'elevenlabs'
                                                                                        ? (hasStoredElevenLabsKey ? '••••••••••••' : t('Enter ElevenLabs API key'))
                                                                                        : sttProvider === 'azure'
                                                                                            ? (hasStoredAzureKey ? '••••••••••••' : t('Enter Azure API key'))
                                                                                            : sttProvider === 'ibmwatson'
                                                                                                ? (hasStoredIbmWatsonKey ? '••••••••••••' : t('Enter IBM Watson API key'))
                                                                                                : sttProvider === 'soniox'
                                                                                                    ? (hasStoredSonioxKey ? '••••••••••••' : t('Enter Soniox API key'))
                                                                                                    : (hasStoredDeepgramKey ? '••••••••••••' : t('Enter Deepgram API key'))
                                                                        }
                                                                        className="aip-input"
                                                                    />
                                                                    {/* Rendered-and-disabled, never conditional, and sized to
                                                                        its widest label, so the key field never changes width. */}
                                                                    <button
                                                                        onClick={() => handleSttKeySubmit(sttProvider as any, keyValue || '')}
                                                                        disabled={sttSaving || !(keyValue || '').trim()}
                                                                        className="aip-field-seg"
                                                                        data-tone={sttSaved ? 'ok' : undefined}
                                                                    >
                                                                        <SizedLabelSwap
                                                                            id={sttSaving ? 'saving' : sttSaved ? 'saved' : 'save'}
                                                                            sizers={[
                                                                                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saving...')}</span>,
                                                                                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saved')}</span>,
                                                                                t('Save'),
                                                                            ]}
                                                                        >
                                                                            {sttSaving
                                                                                ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" />{t('Saving...')}</span>
                                                                                : sttSaved
                                                                                    ? <span className="inline-flex items-center gap-1.5"><Check size={12} strokeWidth={2} className="aip-check" />{t('Saved')}</span>
                                                                                    : t('Save')}
                                                                        </SizedLabelSwap>
                                                                    </button>
                                                                </div>
                                                                {removable && (
                                                                    <button
                                                                        onClick={() => handleRemoveSttKey(sttProvider as any)}
                                                                        className="aip-btn shrink-0"
                                                                        data-icon="true"
                                                                        data-variant="danger-ghost"
                                                                        title={t("Remove API Key")}
                                                                        aria-label={t("Remove API Key")}
                                                                    >
                                                                        <Trash2 size={14} strokeWidth={1.75} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Azure: the key's region, in the same field. */}
                                                        {sttProvider === 'azure' && (
                                                            <div className="aip-provider-row">
                                                                <div className="aip-provider-field">
                                                                    <div className="aip-field">
                                                                        <MapPin size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                                                        <input
                                                                            type="text"
                                                                            value={sttAzureRegion}
                                                                            onChange={(e) => setSttAzureRegion(e.target.value)}
                                                                            placeholder={t("e.g. eastus")}
                                                                            aria-label={t('Region')}
                                                                            className="aip-input"
                                                                        />
                                                                        <button
                                                                            onClick={async () => {
                                                                                const region = sttAzureRegion.trim();
                                                                                if (!region) return;
                                                                                // @ts-ignore
                                                                                await window.electronAPI?.setAzureRegion?.(region);
                                                                                setSavedAzureRegion(region);
                                                                                markSttFieldSaved('region');
                                                                            }}
                                                                            disabled={!sttAzureRegion.trim() || sttAzureRegion.trim() === savedAzureRegion}
                                                                            className="aip-field-seg"
                                                                            data-tone={sttFieldSaved === 'region' ? 'ok' : undefined}
                                                                        >
                                                                            <SizedLabelSwap
                                                                                id={sttFieldSaved === 'region' ? 'saved' : 'save'}
                                                                                sizers={[
                                                                                    <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saving...')}</span>,
                                                                                    <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saved')}</span>,
                                                                                    t('Save'),
                                                                                ]}
                                                                            >
                                                                                {sttFieldSaved === 'region'
                                                                                    ? <span className="inline-flex items-center gap-1.5"><Check size={12} strokeWidth={2} className="aip-check" />{t('Saved')}</span>
                                                                                    : t('Save')}
                                                                            </SizedLabelSwap>
                                                                        </button>
                                                                    </div>
                                                                    {removable && (
                                                                        <span className="aip-btn shrink-0 invisible" data-icon="true" aria-hidden="true">
                                                                            <Trash2 size={14} strokeWidth={1.75} />
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* OpenAI Custom Base URL — for self-hosted OpenAI-compatible servers (e.g. Speaches).
                                                            When set, the WebSocket Realtime path is skipped and REST is used against the custom host. */}
                                                        {sttProvider === 'openai' && (
                                                            <>
                                                                <div className="aip-provider-row">
                                                                    <div className="aip-provider-field">
                                                                        <div className="aip-field">
                                                                            <Globe size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                                                            <input
                                                                                type="text"
                                                                                value={sttOpenaiBaseUrl}
                                                                                onChange={(e) => setSttOpenaiBaseUrl(e.target.value)}
                                                                                placeholder={t("https://api.openai.com (default)")}
                                                                                aria-label={t('Custom Base URL')}
                                                                                className="aip-input"
                                                                            />
                                                                            <button
                                                                                onClick={async () => {
                                                                                    const url = sttOpenaiBaseUrl.trim();
                                                                                    // @ts-ignore
                                                                                    await window.electronAPI?.setOpenAiSttBaseUrl?.(url);
                                                                                    setSavedOpenaiBaseUrl(url);
                                                                                    markSttFieldSaved('baseUrl');
                                                                                }}
                                                                                disabled={sttOpenaiBaseUrl.trim() === savedOpenaiBaseUrl}
                                                                                className="aip-field-seg"
                                                                                data-tone={sttFieldSaved === 'baseUrl' ? 'ok' : undefined}
                                                                            >
                                                                                <SizedLabelSwap
                                                                                    id={sttFieldSaved === 'baseUrl' ? 'saved' : 'save'}
                                                                                    sizers={[
                                                                                        <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saving...')}</span>,
                                                                                        <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saved')}</span>,
                                                                                        t('Save'),
                                                                                    ]}
                                                                                >
                                                                                    {sttFieldSaved === 'baseUrl'
                                                                                        ? <span className="inline-flex items-center gap-1.5"><Check size={12} strokeWidth={2} className="aip-check" />{t('Saved')}</span>
                                                                                        : t('Save')}
                                                                                </SizedLabelSwap>
                                                                            </button>
                                                                        </div>
                                                                        {removable && (
                                                                            <span className="aip-btn shrink-0 invisible" data-icon="true" aria-hidden="true">
                                                                                <Trash2 size={14} strokeWidth={1.75} />
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </>
                                                        )}

                                                        {/* Test Connection leads its own row, as in AI Providers. Sized
                                                            to its widest label, so "Testing..." → "Passed" never moves it. */}
                                                        <div className="aip-provider-row">
                                                            <button
                                                                onClick={handleTestSttConnection}
                                                                disabled={sttTestStatus === 'testing'}
                                                                className="aip-btn shrink-0"
                                                                data-tone={sttTestStatus === 'success' ? 'ok' : sttTestStatus === 'error' ? 'danger' : undefined}
                                                                title={sttTestError || t('Test Connection')}
                                                            >
                                                                <SizedLabelSwap
                                                                    id={sttTestStatus}
                                                                    sizers={[
                                                                        t('Test Connection'),
                                                                        <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Testing...')}</span>,
                                                                        <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Passed')}</span>,
                                                                        <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Error')}</span>,
                                                                    ]}
                                                                >
                                                                    {sttTestStatus === 'testing' ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" />{t('Testing...')}</span> :
                                                                        sttTestStatus === 'success' ? <span className="inline-flex items-center gap-1.5"><AipPassedCheck />{t('Passed')}</span> :
                                                                            sttTestStatus === 'error' ? <span className="inline-flex items-center gap-1.5"><AlertCircle size={12} strokeWidth={1.75} />{t('Error')}</span> :
                                                                                t('Test Connection')}
                                                                </SizedLabelSwap>
                                                            </button>
                                                            {/* MODELS beside Test, as in AI Providers. OpenAI with a
                                                                custom server skips the Realtime socket (REST only), so
                                                                a Realtime model choice would do nothing there.
                                                                OpenAI's own URL is not a custom server. */}
                                                            {(sttProvider === 'deepgram' || (sttProvider === 'openai' && isDefaultOpenAiSttBase(savedOpenaiBaseUrl))) && (
                                                                <SttModelList
                                                                    models={STT_MODEL_CATALOG[sttProvider as SttModelProvider].models}
                                                                    value={sttModels[sttProvider as SttModelProvider]}
                                                                    onSelect={(id) => void selectSttModel(sttProvider as SttModelProvider, id)}
                                                                />
                                                            )}
                                                            {sttProvider === 'groq' && (
                                                                <SttModelList
                                                                    models={[
                                                                        { id: 'whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo', description: t('Fastest') },
                                                                        { id: 'whisper-large-v3', label: 'Whisper Large V3', description: t('Most Accurate') },
                                                                    ]}
                                                                    value={groqSttModel}
                                                                    onSelect={(id) => void selectGroqSttModel(id)}
                                                                />
                                                            )}
                                                            {sttProvider === 'nvidia_nim' && (
                                                                <SttModelList
                                                                    models={NVIDIA_NIM_STT_MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description }))}
                                                                    value={nvidiaNimSttModel}
                                                                    onSelect={(id) => void selectNvidiaNimSttModel(id)}
                                                                />
                                                            )}
                                                        </div>

                                                        {/* One note line, and only when something is actually wrong. */}
                                                        {sttTestStatus === 'error' && sttTestError && (
                                                            <p className="aip-meta aip-danger-fg aip-provider-note settings-swap-in" role="alert">{sttTestError}</p>
                                                        )}
                                                    </div>
                                                    {/* OpenAI's server note sits under the card, in the footnote
                                                        form the pane's other notes use (Auto mode, ScreenCaptureKit). */}
                                                    {sttProvider === 'openai' && (
                                                        <div className="flex gap-2 items-center mt-2 px-1">
                                                            <Info size={14} className="text-text-secondary shrink-0" />
                                                            <p className="text-xs text-text-secondary">
                                                                {t('Point at any OpenAI-compatible server (e.g. Speaches). Custom servers use REST only — Realtime WebSocket is skipped. Leave blank for default.')}
                                                            </p>
                                                        </div>
                                                    )}
                                                    {/* Last child, as in AI Providers and the Local Models panel:
                                                        on this tab AIProvidersSettings is unmounted, so its copy
                                                        of the sheet is not in the DOM. */}
                                                    <style>{AIP_CSS}</style>
                                                </div>
                                                );
                                            })()}

                                            {sttProvider === 'apple-speech' && (
                                                <p className="text-xs text-text-secondary settings-swap-in">{t('Transcribes on this Mac. “Auto” follows your system language.')}</p>
                                            )}
                                            {/* Local Whisper Model Panel */}
                                            {sttProvider === 'local-whisper' && (
                                                <div className="settings-swap-in">
                                                    <LocalWhisperModelPanel onModelConfigChanged={setLocalWhisperConfig} />
                                                </div>
                                            )}

                                            {/* Recognition Language Family — options restricted to what the
                                                active local model accepts (per its official docs); greyed out
                                                entirely when the model is English-only and language cannot change. */}
                                            {/* Language and its Accent share one row: the accent
                                                is a refinement of the language beside it, and two short
                                                selects stacked full-width left most of each card empty. */}
                                            <div className={currentGroupVariants.length > 1 ? 'grid grid-cols-2 gap-4' : ''}>
                                                <CustomSelect
                                                    label={t("Language")}
                                                    value={displayedSttGroup}
                                                    options={languageGroups.map(g => ({
                                                        deviceId: g,
                                                        label: g,
                                                        kind: 'audioinput' as MediaDeviceKind,
                                                        groupId: '',
                                                        toJSON: () => ({})
                                                    }))}
                                                    onChange={handleGroupChange}
                                                    placeholder={t("Select Language")}
                                                    disabled={languageLocked}
                                                    badges={appleLanguageBadges?.group}
                                                />

                                                {/* Variant/Accent Selector (Conditional) — greyed out when the
                                                    active local model's language conditioning is region-neutral
                                                    (Whisper-family) or fixed (English-only checkpoints). Only
                                                    Nemotron consumes regional variants. */}
                                                {currentGroupVariants.length > 1 && (
                                                    <div className="settings-swap-in">
                                                        <CustomSelect
                                                            label={t("Accent")}
                                                            value={displayedRecognitionLanguage}
                                                            options={currentGroupVariants}
                                                            onChange={handleLanguageChange}
                                                            placeholder={t("Select Accent")}
                                                            badges={appleLanguageBadges?.variant}
                                                            disabled={!!localLanguageCapability && !localLanguageCapability.accentSelectable}
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Local model capability notes */}
                                            {localLanguageCapability && languageLocked && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">
                                                        {(localLanguageCapability.englishOnlyNames.length > 0
                                                            ? localLanguageCapability.englishOnlyNames.join(', ')
                                                            : t('The selected local model'))}
                                                        {' '}{localLanguageCapability.accentSelectable
                                                            ? t('supports English only — language is fixed for this model.')
                                                            : t('supports English only — language and accent are fixed for this model.')}
                                                    </p>
                                                </div>
                                            )}
                                            {/* Apple Speech: the stored language may be one of the 20
                                                Natively offers that Apple cannot transcribe. It is filtered
                                                out of the selects above, so without this the control would
                                                just sit on its placeholder with no explanation. */}
                                            {appleLanguageCapability && storedLanguageUnsupported && !storedLanguageParakeetOnly && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <AlertCircle size={14} className="text-amber-400 shrink-0" />
                                                    <p className="text-xs text-amber-200/90">
                                                        {`"${availableLanguages[recognitionLanguage]?.label ?? recognitionLanguage}" ${t("isn't available in Apple Speech — pick one of the listed languages.")}`}
                                                    </p>
                                                </div>
                                            )}
                                            {/* Download the selected language now, with a visible bar,
                                                instead of letting the first meeting stall on it. Apple
                                                reports a 0..1 fraction and no transfer size, so this is a
                                                percentage — there is no MB figure available to show. */}
                                            {appleLanguageCapability && selectedAppleNeedsDownload && (
                                                <div className="mt-3 rounded-xl border border-border-subtle bg-bg-card p-3 settings-swap-in">
                                                    {/* Gate on the locale actually downloading, not merely on
                                                        "a download exists": switching language mid-download
                                                        otherwise showed the NEW language's card wearing the
                                                        OLD language's progress bar, and hid its own button. */}
                                                    {appleInstall && appleInstall.locale === selectedAppleLocale ? (
                                                        <>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-xs text-text-primary">
                                                                    {t('Downloading language model…')}
                                                                </span>
                                                                <span className="text-xs tabular-nums text-text-secondary">
                                                                    {Math.round(appleInstall.fraction * 100)}%
                                                                </span>
                                                            </div>
                                                            <div className="h-1.5 w-full rounded-full bg-bg-input overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-accent-primary transition-[width] duration-300 ease-out"
                                                                    style={{ width: `${Math.max(2, appleInstall.fraction * 100)}%` }}
                                                                />
                                                            </div>
                                                            <p className="text-[11px] text-text-secondary mt-2">
                                                                {t('macOS is fetching this language. You can keep using Natively; the download continues in the background.')}
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-xs text-text-primary">
                                                                    {t('This language is not downloaded yet.')}
                                                                </p>
                                                                <p className="text-[11px] text-text-secondary mt-0.5">
                                                                    {t('Download it now, or the first meeting will wait while macOS fetches it.')}
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={startAppleDownload}
                                                                disabled={!!appleSlots?.full}
                                                                title={appleSlots?.full ? t('Remove a downloaded language first.') : undefined}
                                                                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-bg-input hover:bg-bg-elevated text-text-primary border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                            >
                                                                {t('Download')}
                                                            </button>
                                                        </div>
                                                    )}
                                                    {appleInstallError && (
                                                        <p className="text-[11px] text-amber-200/90 mt-2">{appleInstallError}</p>
                                                    )}
                                                </div>
                                            )}
                                            {/* Apple allocates a fixed number of language slots per app
                                                and an install takes one permanently, so the cap has to be
                                                visible and recoverable — otherwise the sixth language just
                                                fails with Apple's opaque "Too many allocated locales". */}
                                            {appleSlots && appleSlots.entries.length > 0 && (
                                                <div className="mt-3 rounded-xl border border-border-subtle bg-bg-card p-3 settings-swap-in">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-medium text-text-primary">
                                                            {t('Downloaded languages')}
                                                        </span>
                                                        <span className={`text-[11px] tabular-nums ${appleSlots.full ? 'text-amber-300/90' : 'text-text-secondary'}`}>
                                                            {appleSlots.used} / {appleSlots.max}
                                                        </span>
                                                    </div>
                                                    <ul className="space-y-1">
                                                        {appleSlots.entries.map((e) => (
                                                            <li key={e.bcp} className="flex items-center justify-between gap-3">
                                                                <span className="text-xs text-text-secondary truncate">{e.label}</span>
                                                                <button
                                                                    onClick={() => releaseAppleLanguage(e.bcp)}
                                                                    disabled={appleReleasing === e.bcp}
                                                                    className="shrink-0 text-[11px] px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-input border border-transparent hover:border-border-subtle transition-colors disabled:opacity-40"
                                                                >
                                                                    {appleReleasing === e.bcp ? t('Removing…') : t('Remove')}
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    <p className="text-[11px] text-text-secondary mt-2">
                                                        {appleSlots.full
                                                            ? t('All language slots are in use. Remove one to download another — removing deletes the model, so it has to be downloaded again to use it.')
                                                            : t('Apple allows a limited number of downloaded languages. Removing one deletes its model.')}
                                                    </p>
                                                </div>
                                            )}
                                            {appleLanguageCapability && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">
                                                        {t('macOS fetches languages marked Download the first time you use them.')}
                                                    </p>
                                                </div>
                                            )}
                                            {localLanguageCapability && !languageLocked && storedLanguageUnsupported && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <AlertCircle size={14} className="text-amber-400 shrink-0" />
                                                    <p className="text-xs text-amber-200/90">
                                                        {`"${availableLanguages[recognitionLanguage]?.label ?? recognitionLanguage}" ${t("isn't supported by the selected local model — pick one of the listed languages.")}`}
                                                    </p>
                                                </div>
                                            )}
                                            {storedLanguageParakeetOnly && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <AlertCircle size={14} className="text-amber-400 shrink-0" />
                                                    <p className="text-xs text-amber-200/90">
                                                        {`"${availableLanguages[recognitionLanguage]?.label ?? recognitionLanguage}" ${t("is only available with the Parakeet TDT local model — pick one of the listed languages.")}`}
                                                    </p>
                                                </div>
                                            )}
                                            {localLanguageCapability && !languageLocked && autoDetectUnavailable && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">
                                                        {t("This model has no auto-detect mode — English is transcribed unless you pick a language.")}
                                                    </p>
                                                </div>
                                            )}
                                            {localLanguageCapability && !languageLocked && !storedLanguageUnsupported && !autoDetectUnavailable
                                                && !localLanguageCapability.accentSelectable && currentGroupVariants.length > 1 && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">
                                                        {t("This model doesn't distinguish accents or regions — only the language itself applies.")}
                                                    </p>
                                                </div>
                                            )}

                                            {/* Auto mode only. The picker's own label already says this
                                                is the meeting language, so restating it under every explicit
                                                choice was noise — and it pushed the genuinely useful notes
                                                (download state, slot budget) further down the panel. */}
                                            {/* An English-only Deepgram model says so; it transcribes
                                                English whatever was stored before. */}
                                            {deepgramLanguageCapability && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">{t('This model transcribes English only.')}</p>
                                                </div>
                                            )}
                                            {/* Not while English is fixed: "detected" would be untrue. */}
                                            {recognitionLanguage === 'auto' && !showsEnglishFallback && (
                                                <div className="flex gap-2 items-center mt-2 px-1 settings-swap-in">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">
                                                        {autoDetectedLanguage
                                                            ? (() => {
                                                                const label = Object.values(availableLanguages).find((l: any) =>
                                                                    l.bcp47 === autoDetectedLanguage || l.iso639 === autoDetectedLanguage
                                                                )?.label as string | undefined;
                                                                return `${t('Auto mode — detected:')} ${label ?? autoDetectedLanguage}`;
                                                              })()
                                                            : t('Detected from the first few seconds of audio.')
                                                        }
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Audio Configuration Section ── */}
                                    <div>
                                        {/* Test Sound sits on the heading line, on the right: it checks the
                                            whole section's output path, not one card. On the page, not a
                                            card, so it takes General's button fill (bg-component, as Theme
                                            and Check use): the selects' bg-input vanishes on this background. */}
                                        <div className="flex items-start justify-between gap-4 mb-4">
                                            <div>
                                                <h3 className="text-lg font-bold text-text-primary mb-1">{t('Audio Configuration')}</h3>
                                                <p className="text-xs text-text-secondary">{t('Manage input and output devices.')}</p>
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    // The tone lasts 1s; the icon says so for as long.
                                                    setTestSoundPlaying(true);
                                                    clearTimeout(testSoundTimer.current);
                                                    testSoundTimer.current = setTimeout(() => setTestSoundPlaying(false), 1000);
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
                                                // Pressed, it gives (0.97, like every button in Settings);
                                                // while the tone plays the speaker cross-fades to a sounding
                                                // one (icon swap). The label never changes, so neither
                                                // does the width.
                                                className="mt-0.5 shrink-0 text-xs bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 flex items-center gap-2"
                                            >
                                                <SettingsMotionReady.Provider value={true}>
                                                    <Presence kind="icon" id={testSoundPlaying ? 'playing' : 'idle'}>
                                                        {testSoundPlaying ? <Volume2 size={12} /> : <Speaker size={12} />}
                                                    </Presence>
                                                </SettingsMotionReady.Provider>
                                                {t('Test Sound')}
                                            </button>
                                        </div>

                                        {/* Device-fallback banner: shown when main process couldn't
                                            open the selected device and silently used the default. */}
                                        {deviceFallbackNotice && (
                                            <div className="mb-4 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 settings-swap-in">
                                                <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs text-amber-200/90 leading-snug">
                                                        {deviceFallbackNotice.kind === 'input' ? t('Selected microphone') : t('Selected output device')}
                                                        {deviceFallbackNotice.requested ? ` "${deviceFallbackNotice.requested}"` : ''} {t("couldn't be opened — using")} <span className="font-medium">{deviceFallbackNotice.actual ?? t('no device')}</span> {t('instead.')}
                                                    </p>
                                                    {deviceFallbackNotice.reason && (
                                                        <p className="text-[11px] text-amber-200/60 mt-1 font-mono break-all">{deviceFallbackNotice.reason}</p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        // Clear stale localStorage so the next meeting starts clean.
                                                        if (deviceFallbackNotice.kind === 'input') {
                                                            localStorage.removeItem('preferredInputDeviceId');
                                                            setSelectedInput('default');
                                                        } else {
                                                            localStorage.removeItem('preferredOutputDeviceId');
                                                            setSelectedOutput('default');
                                                        }
                                                        setDeviceFallbackNotice(null);
                                                    }}
                                                    className="shrink-0 text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25"
                                                >
                                                    {t('Reset')}
                                                </button>
                                            </div>
                                        )}

                                        <div className="space-y-4">
                                            {/* The two meters, side by side on one line, and set apart from
                                                the device cards below (pb-4). Both run off the same audio test;
                                                the system meter answers "will the app hear the person I am
                                                talking to", which the mic meter cannot. */}
                                            <div className="pb-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <div className="flex justify-between text-xs text-text-secondary mb-2 px-1">
                                                            <span>{t('Input Level')}</span>
                                                        </div>
                                                        <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full w-full origin-left bg-green-500 transition-transform ease-out motion-reduce:transition-none"
                                                                style={{ transform: `scaleX(${Math.min(1, Math.max(0, micLevel / 100))})`, transitionDuration: micFalling ? '350ms' : '80ms' }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="flex justify-between text-xs text-text-secondary mb-2 px-1">
                                                            <span>{t('System Audio Level')}</span>
                                                            {systemAudioError && (
                                                                <span className="text-red-500 settings-swap-in" title={systemAudioError}>
                                                                    {t('Unavailable')}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full w-full origin-left bg-green-500 transition-transform ease-out motion-reduce:transition-none"
                                                                style={{ transform: `scaleX(${Math.min(1, Math.max(0, systemAudioLevel / 100))})`, transitionDuration: systemFalling ? '350ms' : '80ms' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* Full width under the pair: the reason is a sentence, and half
                                                    a column would wrap it into a block. */}
                                                {systemAudioError && (
                                                    <p className="text-xs text-red-500 mt-2 px-1 settings-swap-in">{systemAudioError}</p>
                                                )}
                                            </div>

                                            {/* Input and Output Device side by side: each card held one select
                                                across the whole column. */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <CustomSelect
                                                    label={t("Input Device")}
                                                    value={selectedInput}
                                                    options={inputDevices}
                                                    onChange={(id) => {
                                                        setSelectedInput(id);
                                                        localStorage.setItem('preferredInputDeviceId', id);
                                                    }}
                                                    placeholder={t("Default Microphone")}
                                                />

                                                <CustomSelect
                                                    label={t("Output Device")}
                                                    value={selectedOutput}
                                                    options={outputDevices}
                                                    onChange={(id) => {
                                                        setSelectedOutput(id);
                                                        localStorage.setItem('preferredOutputDeviceId', id);
                                                    }}
                                                    placeholder={t("Default Speakers")}
                                                />
                                            </div>

                                            {/* System Audio Capture (the SCK backend) — macOS only. The ScreenCaptureKit
                                                backend is a CoreAudio alternative implemented in the
                                                Rust speaker module under #[cfg(target_os="macos")];
                                                Windows audio runs via WASAPI loopback so the toggle
                                                has no meaning there and routing "sck" as a device id
                                                silently breaks system audio (issue #252 audit / F-003). */}
                                            {isMac && (
                                                /* A card like its neighbours: Input Device and Output Device are
                                                   CustomSelect cards (uppercase label, one control), so the capture
                                                   method is one too, and the hint under it is the Language card's.
                                                   It was a tile/title/switch card titled "SCK Backend" — the
                                                   internal name — with a two-line description; a picker names both
                                                   choices and shows which is on. App reads the flag when a meeting
                                                   starts, so a change applies from the next one. */
                                                <div>
                                                    <CustomSelect
                                                        label={t('System Audio Capture')}
                                                        value={useExperimentalSck ? 'sck' : 'coreaudio'}
                                                        options={[
                                                            { deviceId: 'coreaudio', label: t('Core Audio (default)') },
                                                            { deviceId: 'sck', label: 'ScreenCaptureKit' },
                                                        ].map((o) => ({ ...o, kind: 'audiooutput' as MediaDeviceKind, groupId: '', toJSON: () => ({}) }))}
                                                        onChange={(id) => {
                                                            const useSck = id === 'sck';
                                                            setUseExperimentalSck(useSck);
                                                            window.localStorage.setItem('useExperimentalSckBackend', useSck ? 'true' : 'false');
                                                        }}
                                                    />
                                                    <div className="flex gap-2 items-center mt-2 px-1">
                                                        <Info size={14} className="text-text-secondary shrink-0" />
                                                        <p className="text-xs text-text-secondary">
                                                            {t("Try ScreenCaptureKit if the other side isn't transcribed.")}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}


                            {activeTab === 'calendar' && <CalendarSettings />}

                            {activeTab === 'phone-mirror' && (
                                <PhoneMirrorSettings />
                            )}

                            {isRetrievalTab(activeTab) && (
                                /* No `key`. Keying on activeTab would remount both panels
                                   whenever the id changed — including the 'embedding' ->
                                   'retrieval' flip you get from clicking the sidebar item
                                   you are ALREADY on, which discarded the user's sub-tab
                                   and flashed skeletons for ~400ms. A mounted layout picks
                                   up a late deep link through its own effect instead.

                                   `initialTab` is passed ONLY for the legacy ids: plain
                                   'retrieval' sends undefined, which is what tells the
                                   layout to leave the current sub-tab alone. */
                                <RetrievalSettings
                                    initialTab={retrievalRequest.tab}
                                    navSeq={retrievalRequest.seq}
                                />
                            )}

                            {activeTab === 'intelligence' && (
                                <IntelligenceSettings />
                            )}

                            {activeTab === 'help' && (
                                <HelpSettings onNavigate={setActiveTab} onOpenModes={onOpenModes} onOpenProfile={onOpenProfile} />
                            )}

                            {activeTab === 'about' && (
                                <AboutSection />
                            )}
                            </ErrorBoundary>
                            </motion.div>
                        </div>
                    </div>
            </GenieModal>


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
                <MockupNativelyInterface opacity={previewOverlayOpacity} theme={meetingInterfaceTheme} />
            </div>
        </>
    );
};

export default SettingsOverlay;
