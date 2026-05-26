import React, { useState, useEffect, useRef } from 'react';
import {
    X, RefreshCw, Upload, Briefcase, Trash2, Pencil, Check, Globe,
    Building2, Search, AlertCircle, Gift, Info, Star, Sparkles, User, CheckCircle, ArrowUpRight
} from 'lucide-react';
import { ProfileVisualizer, PremiumUpgradeModal } from '../premium';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { motion, AnimatePresence } from 'framer-motion';

const spring = { type: "spring" as const, stiffness: 100, damping: 20 };

// ─── Profile Intelligence Apple-style CSS (mirrors ModesSettings GATE_CSS) ────
// Lives at module scope so it's not re-allocated on each render.
const PI_CSS = `
    .pi-root {
        --pi-hero: #ffffff;
        --pi-sub: rgba(255,255,255,0.55);
        --pi-sub-low: rgba(255,255,255,0.4);
        --pi-border: rgba(255,255,255,0.06);
        --pi-shell-bg: rgba(255,255,255,0.025);
        --pi-shell-border: rgba(255,255,255,0.05);
        --pi-shell-hover: rgba(255,255,255,0.09);
        --pi-core-bg1: rgba(255,255,255,0.045);
        --pi-core-bg2: rgba(255,255,255,0.01);
        --pi-core-shadow1: rgba(255,255,255,0.1);
        --pi-core-shadow2: rgba(255,255,255,0.04);
        --pi-cta-bg: #ffffff;
        --pi-cta-text: #0a0a0a;
        --pi-cta-ring: rgba(0,0,0,0.08);
        --pi-cta-shadow: 0 4px 14px rgba(0,0,0,0.28);
        --pi-noise: 0.035;
    }
    .pi-root[data-theme='light'] {
        --pi-hero: #1d1d1f;
        --pi-sub: #6e6e73;
        --pi-sub-low: #86868b;
        --pi-border: rgba(0,0,0,0.07);
        --pi-shell-bg: #f5f5f7;
        --pi-shell-border: rgba(0,0,0,0.05);
        --pi-shell-hover: rgba(0,0,0,0.1);
        --pi-core-bg1: #ffffff;
        --pi-core-bg2: #fdfdfd;
        --pi-core-shadow1: rgba(0,0,0,0.02);
        --pi-core-shadow2: #ffffff;
        --pi-cta-bg: #0a0a0a;
        --pi-cta-text: #ffffff;
        --pi-cta-ring: rgba(255,255,255,0.14);
        --pi-cta-shadow: 0 4px 14px rgba(0,0,0,0.12);
        --pi-noise: 0;
    }

    /* ── Premium Double-Bezel Bento (Doppelrand) ── */
    .pi-bento-shell {
        padding: 6px;
        background: var(--pi-shell-bg);
        border-radius: 28px;
        border: 1px solid var(--pi-shell-border);
        box-shadow: 0 6px 18px rgba(0,0,0,0.08);
        transition: border-color 320ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 320ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .pi-bento-shell:hover {
        box-shadow: 0 14px 36px rgba(0,0,0,0.16);
        border-color: var(--pi-shell-hover);
    }
    .pi-bento-core {
        background-image: linear-gradient(135deg, var(--pi-core-bg1) 0%, var(--pi-core-bg2) 100%);
        box-shadow: inset 0 1px 1px var(--pi-core-shadow1),
                    inset 0 0 0 1px var(--pi-core-shadow2);
        border-radius: calc(28px - 6px);
        overflow: hidden;
        position: relative;
        height: 100%;
        width: 100%;
    }
    .pi-bento-core::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: var(--pi-noise);
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        z-index: 10;
        mix-blend-mode: overlay;
    }
    .pi-bento-content { position: relative; z-index: 1; height: 100%; }

    /* ── Button-in-Button CTA (Manage Pro / Unlock Pro) ── */
    .pi-cta-group {
        padding: 5px 5px 5px 18px;
        height: 40px;
        border-radius: 20px;
        background: var(--pi-cta-bg);
        color: var(--pi-cta-text);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        border: none;
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; gap: 10px;
        box-shadow: var(--pi-cta-shadow);
        transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 220ms ease;
        white-space: nowrap;
    }
    .pi-cta-group:hover {
        transform: scale(0.975);
        box-shadow: 0 8px 22px rgba(0,0,0,0.22);
    }
    .pi-cta-group:active { transform: scale(0.94); }
    .pi-cta-icon-ring {
        width: 30px; height: 30px;
        border-radius: 50%;
        background: var(--pi-cta-ring);
        display: flex; align-items: center; justify-content: center;
        transition: transform 320ms cubic-bezier(0.23, 1, 0.32, 1);
        flex-shrink: 0;
    }
    .pi-cta-group:hover .pi-cta-icon-ring {
        transform: translateX(2px) translateY(-1px) scale(1.06);
    }

    /* Trial variant retains violet without losing pill geometry */
    .pi-cta-group--trial {
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        color: #ffffff;
        box-shadow: 0 4px 14px rgba(124,58,237,0.35);
    }
    .pi-cta-group--trial .pi-cta-icon-ring { background: rgba(255,255,255,0.18); }
    .pi-cta-group--trial:hover { box-shadow: 0 8px 22px rgba(124,58,237,0.45); }

    /* ── Yellow BETA pill ── */
    .pi-beta-badge {
        display: inline-flex; align-items: center; justify-content: center;
        height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        background: #FACC15;
        color: #0a0a0a;
        font-size: 9.5px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        line-height: 1;
        box-shadow: 0 1px 0 rgba(255,255,255,0.4) inset,
                    0 2px 6px rgba(250,204,21,0.35);
    }

    /* ── Subtle pill badges (plan / trial) ── */
    .pi-meta-badge {
        display: inline-flex; align-items: center;
        height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        line-height: 1;
    }
    .pi-meta-badge--plan {
        background: var(--pi-shell-bg);
        color: var(--pi-hero);
        border: 1px solid var(--pi-shell-border);
    }
    .pi-meta-badge--trial {
        background: linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(124,58,237,0.14) 100%);
        color: #c4b5fd;
        border: 1px solid rgba(139,92,246,0.32);
    }
    .pi-root[data-theme='light'] .pi-meta-badge--trial { color: #6d28d9; }

    /* ── Long upload pill with internal indeterminate progress ── */
    .pi-upload-pill {
        position: relative;
        width: 100%;
        height: 48px;
        border-radius: 999px;
        padding: 5px 5px 5px 22px;
        background: var(--pi-cta-bg);
        color: var(--pi-cta-text);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        border: none;
        cursor: pointer;
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        box-shadow: var(--pi-cta-shadow);
        overflow: hidden;
        transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 220ms ease,
                    background 200ms ease;
    }
    .pi-upload-pill:hover:not(:disabled) {
        transform: scale(0.985);
        box-shadow: 0 8px 22px rgba(0,0,0,0.22);
    }
    .pi-upload-pill:active:not(:disabled) { transform: scale(0.96); }
    .pi-upload-pill:disabled { cursor: progress; }

    .pi-upload-pill--secondary {
        background: var(--pi-shell-bg);
        color: var(--pi-hero);
        border: 1px solid var(--pi-shell-border);
        box-shadow: none;
    }
    .pi-upload-pill--secondary:hover:not(:disabled) {
        background: var(--pi-shell-hover);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }

    /* Indeterminate sweep — fills the pill while work is in flight */
    .pi-upload-pill__fill {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        border-radius: inherit;
    }
    .pi-upload-pill__fill::before {
        content: '';
        position: absolute;
        top: 0; bottom: 0;
        left: -45%;
        width: 45%;
        background: linear-gradient(90deg,
            transparent 0%,
            var(--pi-upload-sweep, rgba(0,0,0,0.18)) 50%,
            transparent 100%);
        animation: pi-upload-sweep 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    .pi-upload-pill__fill::after {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--pi-upload-tint, transparent);
        opacity: 0.5;
    }
    /* Primary (dark bg in dark, white bg in light): subtle inverse sweep */
    .pi-root[data-theme='light'] .pi-upload-pill:not(.pi-upload-pill--secondary) {
        --pi-upload-sweep: rgba(255,255,255,0.22);
    }
    /* Accent tinting via data-accent */
    .pi-upload-pill[data-accent='blue'] {
        --pi-upload-sweep: rgba(59,130,246,0.45);
        --pi-upload-tint: rgba(59,130,246,0.08);
    }
    .pi-upload-pill[data-accent='emerald'] {
        --pi-upload-sweep: rgba(16,185,129,0.45);
        --pi-upload-tint: rgba(16,185,129,0.08);
    }

    @keyframes pi-upload-sweep {
        0%   { left: -45%; }
        100% { left: 100%; }
    }

    .pi-upload-pill__content {
        position: relative; z-index: 1;
        display: flex; align-items: center; gap: 10px;
        min-width: 0;
    }
    .pi-upload-pill__label {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pi-upload-pill__ring {
        position: relative; z-index: 1;
        width: 38px; height: 38px;
        border-radius: 50%;
        background: var(--pi-cta-ring);
        display: flex; align-items: center; justify-content: center;
        transition: transform 320ms cubic-bezier(0.23, 1, 0.32, 1);
        flex-shrink: 0;
    }
    .pi-upload-pill:hover:not(:disabled) .pi-upload-pill__ring {
        transform: translateX(2px) scale(1.05);
    }
    .pi-upload-pill--secondary .pi-upload-pill__ring {
        background: var(--pi-shell-bg);
        border: 1px solid var(--pi-shell-border);
    }
    .pi-upload-spinner { animation: pi-spin 0.9s linear infinite; }
    @keyframes pi-spin { to { transform: rotate(360deg); } }

    /* ── "Pro" badge shown next to upload card titles for Free Tier ── */
    .pi-upload-pill__pro-badge {
        display: inline-flex; align-items: center;
        height: 18px;
        padding: 0 7px;
        margin-left: 8px;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        line-height: 1;
        background: linear-gradient(135deg, rgba(139,92,246,0.22) 0%, rgba(124,58,237,0.18) 100%);
        color: #c4b5fd;
        border: 1px solid rgba(139,92,246,0.36);
        vertical-align: middle;
    }
    .pi-root[data-theme='light'] .pi-upload-pill__pro-badge { color: #6d28d9; }

    /* ── Header close button (mirrors ModesSettings manager closeBtn — flat, no shadow) ── */
    .pi-close-btn {
        display: flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 8px;
        background: transparent;
        color: var(--pi-sub-low);
        border: none;
        cursor: pointer;
        box-shadow: none;
        transition: color 150ms ease, transform 150ms ease;
    }
    .pi-close-btn:hover { color: var(--pi-hero); background: transparent; }
    .pi-close-btn:active { transform: scale(0.9); }
`;

const BezelCard = ({ children, className = "", delay = 0, style = {} }: any) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ ...spring, delay }}
            style={style}
            className={`pi-bento-shell ${className}`}
        >
            <div className="pi-bento-core bg-bg-item-surface">
                <div className="pi-bento-content">
                    {children}
                </div>
            </div>
        </motion.div>
    );
};

const MagneticButton = ({ children, onClick, disabled, className = "", primary = false, style }: any) => {
    return (
        <motion.button
            whileHover={!disabled ? { scale: 1.02, y: -1 } : {}}
            whileTap={!disabled ? { scale: 0.98 } : {}}
            transition={spring}
            onClick={onClick}
            disabled={disabled}
            style={style}
            className={`relative group px-6 py-3 text-[13px] tracking-tight font-bold rounded-full flex items-center justify-center gap-2 overflow-hidden ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className} ${primary ? 'bg-text-primary text-bg-main shadow-[0_10px_20px_-10px_rgba(0,0,0,0.2)]' : 'bg-bg-input text-text-primary hover:bg-bg-surface border border-border-subtle'}`}
        >
            {children}
            {primary && (
                <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20 pointer-events-none" />
            )}
        </motion.button>
    );
};

// ---------------------------------------------------------------------------
// StarRating
// ---------------------------------------------------------------------------
const StarRating = ({ value, size = 11 }: { value: number; size?: number }) => {
    const clamped = Math.min(5, Math.max(0, value ?? 0));
    // Round to nearest 0.5 so 3.7→3.5 stars, 3.8→4 stars, 4.75→5 stars
    const rounded = Math.round(clamped * 2) / 2;
    const full = Math.floor(rounded);
    const half = rounded - full === 0.5;
    const empty = 5 - full - (half ? 1 : 0);
    return (
        <span className="flex items-center gap-0.5">
            {Array.from({ length: full }).map((_, i) => (
                <Star key={`f${i}`} size={size} className="text-yellow-400 fill-yellow-400" />
            ))}
            {half && <Star size={size} className="text-yellow-400 fill-yellow-400/40" />}
            {Array.from({ length: empty }).map((_, i) => (
                <Star key={`e${i}`} size={size} className="text-text-tertiary/25 fill-transparent" />
            ))}
        </span>
    );
};

// Cache premium state in localStorage so the CTA renders in its correct
// state on first paint — avoids the "Unlock Pro" → "Manage Pro" flash for
// activated users while the async licenseGetDetails() call is in flight.
// Cleared whenever the canonical check returns non-premium (or on deactivate).
const PI_PREMIUM_CACHE_KEY = 'pi:isPremium';
const PI_PREMIUM_PLAN_CACHE_KEY = 'pi:premiumPlan';

const readPremiumCache = (): { isPremium: boolean; plan: string } => {
    if (typeof window === 'undefined') return { isPremium: false, plan: '' };
    try {
        return {
            isPremium: window.localStorage.getItem(PI_PREMIUM_CACHE_KEY) === '1',
            plan: window.localStorage.getItem(PI_PREMIUM_PLAN_CACHE_KEY) ?? '',
        };
    } catch {
        return { isPremium: false, plan: '' };
    }
};

const writePremiumCache = (isPremium: boolean, plan: string) => {
    if (typeof window === 'undefined') return;
    try {
        if (isPremium) {
            window.localStorage.setItem(PI_PREMIUM_CACHE_KEY, '1');
            if (plan) window.localStorage.setItem(PI_PREMIUM_PLAN_CACHE_KEY, plan);
            else window.localStorage.removeItem(PI_PREMIUM_PLAN_CACHE_KEY);
        } else {
            window.localStorage.removeItem(PI_PREMIUM_CACHE_KEY);
            window.localStorage.removeItem(PI_PREMIUM_PLAN_CACHE_KEY);
        }
    } catch { /* localStorage disabled — fall back to live check */ }
};

export function ProfileIntelligenceSettings({ onClose }: { onClose: () => void }) {
    // Premium Status — seed from cache so the header CTA paints correctly
    // before licenseGetDetails() resolves.
    const cachedPremium = readPremiumCache();
    const [isPremium, setIsPremium] = useState(cachedPremium.isPremium);
    const [premiumPlan, setPremiumPlan] = useState<string>(cachedPremium.plan);
    const [isTrialActive, setIsTrialActive] = useState(false);
    const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);
    const hasProfileAccess = isPremium || isTrialActive;
    const isLight = useResolvedTheme() === 'light';

    // Profile Engine State
    const [profileStatus, setProfileStatus] = useState<{
        hasProfile: boolean;
        profileMode: boolean;
        name?: string;
        role?: string;
        totalExperienceYears?: number;
    }>({ hasProfile: false, profileMode: false });
    const [profileUploading, setProfileUploading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileData, setProfileData] = useState<any>(null);
    const [jdUploading, setJdUploading] = useState(false);
    const [jdError, setJdError] = useState('');
    const [companyResearching, setCompanyResearching] = useState(false);
    const [companyDossier, setCompanyDossier] = useState<any>(null);
    const [companySearchQuotaExhausted, setCompanySearchQuotaExhausted] = useState(false);
    const [tavilyApiKey, setTavilyApiKey] = useState('');
    const [hasStoredTavilyKey, setHasStoredTavilyKey] = useState(false);
    const [tavilySaving, setTavilySaving] = useState(false);
    const [tavilyError, setTavilyError] = useState('');
    const [negotiationScript, setNegotiationScript] = useState<any>(null);
    const [negotiationGenerating, setNegotiationGenerating] = useState(false);
    const [negotiationError, setNegotiationError] = useState('');
    const [customNotes, setCustomNotes] = useState('');
    const [customNotesSaved, setCustomNotesSaved] = useState(false);
    const customNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [persona, setPersona] = useState('');
    const [personaSaved, setPersonaSaved] = useState(false);
    const personaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Fetch premium details — canonical source of truth. Sync the
        // localStorage cache so the next mount paints with the correct state.
        if (window.electronAPI?.licenseGetDetails) {
            window.electronAPI.licenseGetDetails().then((details: any) => {
                const live = !!details?.isPremium;
                const plan = details?.plan ?? '';
                setIsPremium(live);
                if (plan) setPremiumPlan(plan);
                else if (!live) setPremiumPlan('');
                writePremiumCache(live, plan);
            }).catch(() => { });
        } else {
            window.electronAPI?.licenseCheckPremium?.().then((live: boolean) => {
                setIsPremium(!!live);
                writePremiumCache(!!live, premiumPlan);
            }).catch(() => { });
        }

        // Proactively load profile data
        window.electronAPI?.profileGetStatus?.().then(setProfileStatus).catch(() => { });
        window.electronAPI?.profileGetProfile?.().then((data: any) => {
            setProfileData(data);
            if (data?.negotiationScript) setNegotiationScript(data.negotiationScript);
        }).catch(() => { });
        window.electronAPI?.profileGetNotes?.().then((res: any) => {
            if (res?.success) setCustomNotes(res.content ?? '');
        }).catch(() => { });

        // Tavily key check
        window.electronAPI?.getStoredCredentials?.().then((creds: any) => {
            if (creds && creds.hasTavilyKey) {
                setHasStoredTavilyKey(true);
            }
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!hasProfileAccess) {
            setPersona('');
            if (personaDebounceRef.current) clearTimeout(personaDebounceRef.current);
            return;
        }
        window.electronAPI?.profileGetPersona?.().then((res: any) => {
            if (res?.success) setPersona(res.content ?? '');
        }).catch(() => { });
    }, [hasProfileAccess]);

    const handleRemoveTavilyKey = async () => {
        if (!confirm('Are you sure you want to remove your Tavily API key?')) return;
        try {
            const res = await window.electronAPI?.setTavilyApiKey?.('');
            if (res && res.success) {
                setHasStoredTavilyKey(false);
                setTavilyApiKey('');
            } else {
                alert(res?.error || 'Failed to remove API key');
            }
        } catch (e) {
            alert('Error removing key');
        }
    };

    return (
        <div
            className="pi-root flex flex-col h-full bg-bg-main relative"
            data-theme={isLight ? 'light' : 'dark'}
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Geist", "Satoshi", system-ui, sans-serif', WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' as any }}
        >
            <style>{PI_CSS}</style>
            <motion.div
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...spring, delay: 0.1 }}
                className="flex items-center justify-between p-6 border-b border-white/5 bg-bg-surface/70 shrink-0 backdrop-blur-3xl sticky top-0 z-50"
            >
                <div className="flex items-center gap-5">
                    <div className="w-12 h-12 rounded-[1.25rem] bg-bg-input border border-border-subtle shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center text-text-primary">
                        <User size={22} strokeWidth={2} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5 mb-1.5">
                            <h2 className="text-[22px] font-bold text-text-primary leading-none" style={{ letterSpacing: '-0.025em' }}>Profile Intelligence</h2>
                            <span className="pi-beta-badge">BETA</span>
                            {isPremium && premiumPlan && (
                                <span className="pi-meta-badge pi-meta-badge--plan">{premiumPlan} Plan</span>
                            )}
                            {isTrialActive && !isPremium && (
                                <span className="pi-meta-badge pi-meta-badge--trial">Free Trial</span>
                            )}
                        </div>
                        <p className="text-[13px] text-text-secondary" style={{ letterSpacing: '-0.005em' }}>
                            Manage your persona, career history, and active job description
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsPremiumModalOpen(true)}
                        className={`pi-cta-group${isTrialActive && !isPremium ? ' pi-cta-group--trial' : ''}`}
                        aria-label={isPremium ? 'Manage Pro' : isTrialActive ? 'Upgrade trial' : 'Unlock Pro'}
                    >
                        <span>{isPremium ? 'Manage Pro' : isTrialActive ? 'Upgrade' : 'Unlock Pro'}</span>
                        <span className="pi-cta-icon-ring">
                            {isPremium
                                ? <CheckCircle size={14} strokeWidth={2.5} />
                                : isTrialActive
                                ? <Sparkles size={14} strokeWidth={2.5} />
                                : <ArrowUpRight size={14} strokeWidth={2.5} />}
                        </span>
                    </button>
                    <button
                        onClick={onClose}
                        className="pi-close-btn"
                        aria-label="Close"
                    >
                        <X size={18} strokeWidth={2} />
                    </button>
                </div>
            </motion.div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto p-5 pb-12">
                    <div className="space-y-6">
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, ...spring }} className="mb-4 pt-2">
                            <h3 className="text-lg font-bold text-text-primary tracking-tight">Professional Identity</h3>
                            <p className="text-[13px] text-text-secondary mt-1">
                                This engine constructs an intelligent representation of your career history and skills graph.
                            </p>
                        </motion.div>

                                    <BezelCard delay={0.2}>
                                        <div className="flex flex-col justify-between min-h-[200px]">

                                            {/* Header */}
                                            <div className="p-5 pb-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-bg-input border border-border-subtle flex items-center justify-center text-text-primary shadow-sm hover:scale-105 transition-transform duration-300">
                                                            <span className="font-bold text-sm tracking-tight">
                                                                {profileData?.identity?.name ? profileData.identity.name.charAt(0).toUpperCase() : 'U'}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <h4 className="text-sm font-bold text-text-primary tracking-tight">
                                                                {profileData?.identity?.name || 'Identity Node Inactive'}
                                                            </h4>
                                                            <p className="text-xs text-text-secondary mt-0.5 tracking-wide">
                                                                {profileData?.identity?.email || 'Upload a resume to begin mapping.'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-3">
                                                        {profileStatus.hasProfile && (
                                                            <button
                                                                onClick={async () => {
                                                                    if (!confirm('Are you sure you want to delete your mapped persona? This will destroy all structured timeline data.')) return;
                                                                    try {
                                                                        await window.electronAPI?.profileDelete?.();
                                                                        setProfileStatus({ hasProfile: false, profileMode: false });
                                                                        setProfileData(null);
                                                                    } catch (e) { console.error('Failed to delete profile:', e); }
                                                                }}
                                                                className="text-[12px] font-medium text-text-tertiary hover:text-red-500 transition-colors px-3 py-1.5 rounded-full hover:bg-red-500/10"
                                                            >
                                                                Disconnect
                                                            </button>
                                                        )}

                                                        {/* High-fidelity Toggle */}
                                                        <div className={`flex items-center gap-2 bg-bg-input px-3 py-1.5 rounded-full border border-border-subtle ${!hasProfileAccess ? 'opacity-40 cursor-not-allowed' : ''}`} title={!hasProfileAccess ? 'Requires Pro license' : ''}>
                                                            <span className="text-xs font-medium text-text-secondary">Persona Engine</span>
                                                            <div
                                                                onClick={async () => {
                                                                    if (!profileStatus.hasProfile || !hasProfileAccess) return;
                                                                    const newState = !profileStatus.profileMode;
                                                                    try {
                                                                        await window.electronAPI?.profileSetMode?.(newState);
                                                                        setProfileStatus(prev => ({ ...prev, profileMode: newState }));
                                                                    } catch (e) {
                                                                        console.error('Failed to toggle profile mode:', e);
                                                                    }
                                                                }}
                                                                className={`w-9 h-5 rounded-full relative transition-colors ${(!profileStatus.hasProfile || !hasProfileAccess) ? 'opacity-40 cursor-not-allowed bg-bg-toggle-switch' : profileStatus.profileMode ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                            >
                                                                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform ${profileStatus.profileMode && hasProfileAccess ? 'translate-x-4' : 'translate-x-0'}`} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Data Metrics & Extracted Skills */}
                                            <div className="p-5 pt-0 mt-auto">
                                                <div className="flex items-center justify-between bg-bg-input border border-border-subtle py-4 px-6 rounded-2xl shadow-sm">
                                                    <div className="flex flex-col items-center justify-center flex-1">
                                                        <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.experienceCount || 0}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                                            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Experience</span>
                                                        </div>
                                                    </div>

                                                    <div className="h-8 w-px bg-border-subtle/60" />

                                                    <div className="flex flex-col items-center justify-center flex-1">
                                                        <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.projectCount || 0}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                                                            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Projects</span>
                                                        </div>
                                                    </div>

                                                    <div className="h-8 w-px bg-border-subtle/60" />

                                                    <div className="flex flex-col items-center justify-center flex-1">
                                                        <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.nodeCount || 0}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                                                            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Nodes</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {profileData?.skills && profileData.skills.length > 0 && (
                                                    <div className="mt-5">
                                                        <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">
                                                            Top Skills
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {profileData.skills.slice(0, 15).map((skill: string, i: number) => (
                                                                <span key={i} className="text-[10px] font-medium text-text-secondary px-2 py-1 rounded-md border border-border-subtle bg-bg-input">
                                                                    {skill}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </BezelCard>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <BezelCard delay={0.3}>
                                        <div className="transition-all h-full">
                                            <div className="p-5 flex flex-col gap-5 h-full">
                                                <div className="flex items-start gap-4 min-w-0">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0 mt-0.5 shadow-sm">
                                                        <Upload size={20} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h4 className="text-[15px] font-bold text-text-primary mb-1 tracking-tight">
                                                            {profileStatus.hasProfile ? 'Overwrite Source Document' : 'Initialize Knowledge Base'}
                                                            {!hasProfileAccess && (
                                                                <span className="pi-upload-pill__pro-badge" aria-label="Pro feature">Pro</span>
                                                            )}
                                                        </h4>
                                                        <p className="text-xs text-text-secondary leading-relaxed pr-2">
                                                            {!hasProfileAccess
                                                                ? 'Resume ingestion is a Natively Pro feature. The Custom Context box below stays free.'
                                                                : 'Provide a resume file to seed the intelligence engine.'}
                                                        </p>
                                                    </div>
                                                </div>

                                                <button
                                                    style={{ marginTop: 'auto' }}
                                                    onClick={async () => {
                                                        if (!hasProfileAccess) {
                                                            setIsPremiumModalOpen(true);
                                                            return;
                                                        }
                                                        setProfileError('');
                                                        try {
                                                            const fileResult = await window.electronAPI?.profileSelectFile?.();
                                                            if (fileResult?.cancelled || !fileResult?.filePath) return;

                                                            setProfileUploading(true);
                                                            const result = await window.electronAPI?.profileUploadResume?.(fileResult.filePath);
                                                            if (result?.success) {
                                                                const status = await window.electronAPI?.profileGetStatus?.();
                                                                if (status) setProfileStatus(status);
                                                                const data = await window.electronAPI?.profileGetProfile?.();
                                                                if (data) setProfileData(data);
                                                            } else {
                                                                setProfileError(result?.error || 'Upload failed');
                                                            }
                                                        } catch (e: any) {
                                                            setProfileError(e.message || 'Upload failed');
                                                        } finally {
                                                            setProfileUploading(false);
                                                        }
                                                    }}
                                                    disabled={profileUploading}
                                                    className={`pi-upload-pill${profileStatus.hasProfile ? ' pi-upload-pill--secondary' : ''}`}
                                                    aria-busy={profileUploading}
                                                    aria-label={profileUploading ? 'Ingesting resume' : 'Select resume file'}
                                                >
                                                    {profileUploading && <span className="pi-upload-pill__fill" aria-hidden="true" />}
                                                    <span className="pi-upload-pill__content">
                                                        {profileUploading
                                                            ? <RefreshCw size={14} className="pi-upload-spinner" strokeWidth={2.5} />
                                                            : <Upload size={14} strokeWidth={2.5} />}
                                                        <span className="pi-upload-pill__label">
                                                            {profileUploading
                                                                ? 'Ingesting · Processing structural semantics…'
                                                                : profileStatus.hasProfile ? 'Replace resume file' : 'Select resume file'}
                                                        </span>
                                                    </span>
                                                    <span className="pi-upload-pill__ring">
                                                        <ArrowUpRight size={14} strokeWidth={2.5} />
                                                    </span>
                                                </button>
                                            </div>

                                            {profileError && (
                                                <div className="px-5 pb-4">
                                                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-[11px] text-red-500 font-medium">
                                                        <X size={12} /> {profileError}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </BezelCard>

                                    <BezelCard delay={0.4}>
                                        <div className="transition-all h-full">
                                            <div className="p-5 flex flex-col gap-5 h-full">
                                                <div className="flex items-start gap-4 min-w-0">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0 mt-0.5 shadow-sm">
                                                        <Briefcase size={20} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className="text-[15px] font-bold text-text-primary mb-1 tracking-tight">
                                                            {profileData?.hasActiveJD ? `${profileData.activeJD?.title} @ ${profileData.activeJD?.company}` : 'Upload Job Description'}
                                                            {!hasProfileAccess && (
                                                                <span className="pi-upload-pill__pro-badge" aria-label="Pro feature">Pro</span>
                                                            )}
                                                        </h4>
                                                        {profileData?.hasActiveJD ? (
                                                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                                <span className="text-[9px] font-bold text-blue-500 px-1.5 py-0.5 bg-blue-500/10 rounded uppercase tracking-wide border border-blue-500/20">
                                                                    {profileData.activeJD?.level || 'mid'}-level
                                                                </span>
                                                                <div className="flex gap-1.5 flex-wrap">
                                                                    {profileData.activeJD?.technologies?.slice(0, 3).map((t: string, i: number) => (
                                                                        <span key={i} className="text-[10px] text-text-secondary">{t}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-text-secondary leading-relaxed pr-2">
                                                                {!hasProfileAccess
                                                                    ? 'Job description parsing is a Natively Pro feature. The Custom Context box below stays free.'
                                                                    : 'Upload a JD to enable persona tuning and company research.'}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {profileData?.hasActiveJD && !jdUploading && (
                                                        <button
                                                            onClick={async () => {
                                                                await window.electronAPI?.profileDeleteJD?.();
                                                                const data = await window.electronAPI?.profileGetProfile?.();
                                                                if (data) setProfileData(data);
                                                                setCompanyDossier(null);
                                                            }}
                                                            className="shrink-0 mt-0.5 px-2.5 py-2 rounded-full text-xs text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
                                                            aria-label="Remove job description"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>

                                                <button
                                                    style={{ marginTop: 'auto' }}
                                                    onClick={async () => {
                                                        if (!hasProfileAccess) {
                                                            setIsPremiumModalOpen(true);
                                                            return;
                                                        }
                                                        setJdError('');
                                                        try {
                                                            const fileResult = await window.electronAPI?.profileSelectFile?.();
                                                            if (fileResult?.cancelled || !fileResult?.filePath) return;

                                                            setJdUploading(true);
                                                            const result = await window.electronAPI?.profileUploadJD?.(fileResult.filePath);
                                                            if (result?.success) {
                                                                const data = await window.electronAPI?.profileGetProfile?.();
                                                                if (data) setProfileData(data);
                                                            } else {
                                                                setJdError(result?.error || 'JD upload failed');
                                                            }
                                                        } catch (e: any) {
                                                            setJdError(e.message || 'JD upload failed');
                                                        } finally {
                                                            setJdUploading(false);
                                                        }
                                                    }}
                                                    disabled={jdUploading}
                                                    className={`pi-upload-pill${profileData?.hasActiveJD ? ' pi-upload-pill--secondary' : ''}`}
                                                    data-accent="blue"
                                                    aria-busy={jdUploading}
                                                    aria-label={jdUploading ? 'Parsing job description' : (profileData?.hasActiveJD ? 'Replace job description' : 'Upload job description')}
                                                >
                                                    {jdUploading && <span className="pi-upload-pill__fill" aria-hidden="true" />}
                                                    <span className="pi-upload-pill__content">
                                                        {jdUploading
                                                            ? <RefreshCw size={14} className="pi-upload-spinner" strokeWidth={2.5} />
                                                            : <Briefcase size={14} strokeWidth={2.5} />}
                                                        <span className="pi-upload-pill__label">
                                                            {jdUploading
                                                                ? 'Parsing · Decoding JD structure…'
                                                                : profileData?.hasActiveJD ? 'Replace job description' : 'Upload job description'}
                                                        </span>
                                                    </span>
                                                    <span className="pi-upload-pill__ring">
                                                        <ArrowUpRight size={14} strokeWidth={2.5} />
                                                    </span>
                                                </button>
                                            </div>

                                            {jdError && (
                                                <div className="px-5 pb-4">
                                                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-[11px] text-red-500 font-medium">
                                                        <X size={12} /> {jdError}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </BezelCard>
                                    </div>

                                    <BezelCard delay={0.3}>
                                            <div className="p-5">
                                                <div className="flex items-center gap-4 mb-4">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                        <Pencil size={20} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-sm font-bold text-text-primary">Custom Context</h4>
                                                            {customNotesSaved && (
                                                                <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide flex items-center gap-1">
                                                                    <Check size={8} /> Saved
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                                            Add any context the AI should know about you — saved across all sessions.
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="space-y-3">
                                                    <textarea
                                                        value={customNotes}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val.length > 4000) return;
                                                            setCustomNotes(val);
                                                            setCustomNotesSaved(false);
                                                            if (customNotesDebounceRef.current) clearTimeout(customNotesDebounceRef.current);
                                                            customNotesDebounceRef.current = setTimeout(async () => {
                                                                try {
                                                                    await window.electronAPI?.profileSaveNotes?.(val);
                                                                    setCustomNotesSaved(true);
                                                                    setTimeout(() => setCustomNotesSaved(false), 2000);
                                                                } catch (_) {}
                                                            }, 800);
                                                        }}
                                                        placeholder={`Examples:\n• Q4 ARR was $2.1M, grew 40% YoY — use when pitching growth story\n• Solved LRU Cache (LeetCode 146) with O(1) get/put using HashMap + doubly linked list\n• I prefer concise, direct answers without filler phrases\n• My target salary is $180k base — don't go below $160k`}
                                                        rows={6}
                                                        className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all resize-none leading-relaxed"
                                                    />
                                                    <div className="flex items-center justify-between px-0.5">
                                                        <p className="text-[10px] text-text-tertiary">
                                                            Auto-saved · Works with all modes and providers
                                                        </p>
                                                        <span className={`text-[10px] tabular-nums ${customNotes.length > 3600 ? 'text-amber-500' : 'text-text-tertiary'}`}>
                                                            {customNotes.length}/4000
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </BezelCard>

                                    <BezelCard delay={0.35}>
                                            <div className="p-5">
                                                <div className="flex items-center gap-4 mb-4">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-accent-primary shrink-0">
                                                        <Sparkles size={20} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-sm font-bold text-text-primary">AI Persona</h4>
                                                            {!hasProfileAccess && (
                                                                <span className="text-[9px] font-bold text-accent-primary px-1.5 py-0.5 bg-accent-primary/10 rounded-full border border-accent-primary/20 uppercase tracking-wide">Pro Only</span>
                                                            )}
                                                            {personaSaved && hasProfileAccess && (
                                                                <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide flex items-center gap-1">
                                                                    <Check size={8} /> Updated
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                                            Set the AI's behavior, tone, and role across providers.
                                                        </p>
                                                    </div>
                                                </div>
                                                <textarea
                                                    value={persona}
                                                    onChange={(e) => {
                                                        if (!hasProfileAccess) {
                                                            setIsPremiumModalOpen(true);
                                                            return;
                                                        }
                                                        const val = e.target.value;
                                                        if (val.length > 4000) return;
                                                        setPersona(val);
                                                        setPersonaSaved(false);
                                                        if (personaDebounceRef.current) clearTimeout(personaDebounceRef.current);
                                                        personaDebounceRef.current = setTimeout(async () => {
                                                            try {
                                                                const res = await window.electronAPI?.profileSavePersona?.(val);
                                                                if (res?.success) {
                                                                    setPersonaSaved(true);
                                                                    setTimeout(() => setPersonaSaved(false), 2000);
                                                                } else if (res?.error === 'pro_required') {
                                                                    setPersona('');
                                                                    setIsPremiumModalOpen(true);
                                                                }
                                                            } catch (_) {}
                                                        }, 800);
                                                    }}
                                                    onFocus={() => {
                                                        if (!hasProfileAccess) setIsPremiumModalOpen(true);
                                                    }}
                                                    placeholder="Example: You are a senior hiring manager. Keep answers concise and ask one focused follow-up when needed."
                                                    rows={5}
                                                    disabled={!hasProfileAccess}
                                                    className={`w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all resize-none leading-relaxed ${!hasProfileAccess ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                />
                                                <div className="flex items-center justify-between px-0.5 mt-3">
                                                    <p className="text-[10px] text-text-tertiary">
                                                        {hasProfileAccess ? 'Auto-saved · Treated as user-provided context' : 'Upgrade to Pro to personalize AI persona'}
                                                    </p>
                                                    <span className={`text-[10px] tabular-nums ${persona.length > 3600 ? 'text-amber-500' : 'text-text-tertiary'}`}>
                                                        {persona.length}/4000
                                                    </span>
                                                </div>
                                            </div>
                                        </BezelCard>

                                    <BezelCard delay={0.4}>
                                            <div className="p-5">
                                                <div className="flex items-center gap-4 mb-4">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-emerald-500 shrink-0">
                                                        <Globe size={20} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-sm font-bold text-text-primary">Tavily Search API</h4>
                                                            {hasStoredTavilyKey && (
                                                                <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide">Connected</span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                                            Powers live web search for company research.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="space-y-3">
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide block">API Key</label>
                                                            {hasStoredTavilyKey && (
                                                                <button
                                                                    onClick={handleRemoveTavilyKey}
                                                                    className="text-[10px] flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors bg-red-500/10 hover:bg-red-500/20 px-1.5 py-0.5 rounded"
                                                                    title="Remove API Key"
                                                                >
                                                                    <Trash2 size={10} strokeWidth={2} /> Remove
                                                                </button>
                                                            )}
                                                        </div>
                                                        <input
                                                            type="password"
                                                            value={tavilyApiKey}
                                                            onChange={(e) => { setTavilyApiKey(e.target.value); setTavilyError(''); }}
                                                            placeholder={hasStoredTavilyKey ? '••••••••••••' : 'Enter Tavily API key (tvly-...)'}
                                                            className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all"
                                                        />
                                                    </div>
                                                    {tavilyError && (
                                                        <p className="text-[10px] text-red-400 px-1">{tavilyError}</p>
                                                    )}
                                                    <MagneticButton
                                                        onClick={async () => {
                                                            if (!tavilyApiKey.trim()) return;
                                                            setTavilyError('');
                                                            setTavilySaving(true);
                                                            try {
                                                                const result = await window.electronAPI?.setTavilyApiKey?.(tavilyApiKey.trim());
                                                                if (result && !result.success) {
                                                                    setTavilyError(result.error ?? 'Failed to save API key.');
                                                                } else {
                                                                    setHasStoredTavilyKey(true);
                                                                    setTavilyApiKey('');
                                                                }
                                                            } catch (e: any) {
                                                                setTavilyError(e?.message ?? 'Unexpected error saving API key.');
                                                            } finally {
                                                                setTavilySaving(false);
                                                            }
                                                        }}
                                                        disabled={tavilySaving || !tavilyApiKey.trim()}
                                                        primary={true}
                                                        className="w-full"
                                                    >
                                                        {tavilySaving ? 'Saving...' : 'Save API Key'}
                                                    </MagneticButton>
                                                </div>

                                                <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-bg-input/50 rounded-lg">
                                                    <Info size={12} className="text-text-tertiary shrink-0 mt-0.5" />
                                                    <p className="text-[10px] text-text-tertiary leading-relaxed">
                                                        If not provided, LLM general knowledge is used for company research, which may be outdated. Get your free API key at <span className="text-emerald-500/80 hover:text-emerald-400 underline underline-offset-2 cursor-pointer" onClick={() => window.electronAPI?.openExternal?.('https://app.tavily.com/home')}>app.tavily.com</span>. Keys start with <code className="text-emerald-500/80">tvly-</code>.
                                                    </p>
                                                </div>
                                            </div>
                                        </BezelCard>

                                    {profileData?.hasActiveJD && profileData?.activeJD?.company && (
                                        <BezelCard delay={0.5}>
                                            <div className="p-5">
                                                <div className="flex items-center justify-between mb-4">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-purple-500">
                                                            <Building2 size={20} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h4 className="text-sm font-bold text-text-primary">
                                                                    Company Intel: <span className="text-purple-400">{profileData.activeJD.company}</span>
                                                                </h4>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-widest uppercase bg-purple-500/15 text-purple-400 border border-purple-500/25">Beta</span>
                                                            </div>
                                                            <p className="text-[11px] text-text-secondary mt-0.5">
                                                                {companyDossier ? 'Research complete' : 'Run research to get hiring strategy, salaries & competitors'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <MagneticButton
                                                        onClick={async () => {
                                                            setCompanyResearching(true);
                                                            setCompanySearchQuotaExhausted(false);
                                                            try {
                                                                const result = await window.electronAPI?.profileResearchCompany?.(profileData.activeJD.company);
                                                                if (result?.success && result.dossier) {
                                                                    setCompanyDossier(result.dossier);
                                                                }
                                                                if (result?.searchQuotaExhausted) {
                                                                    setCompanySearchQuotaExhausted(true);
                                                                }
                                                            } catch (e) {
                                                                console.error('Research failed:', e);
                                                            } finally {
                                                                setCompanyResearching(false);
                                                            }
                                                        }}
                                                        disabled={companyResearching}
                                                    >
                                                        {companyResearching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                                                        {companyResearching ? 'Researching...' : companyDossier ? 'Refresh' : 'Research Now'}
                                                    </MagneticButton>
                                                </div>

                                                {/* Search quota exhausted notice */}
                                                {companySearchQuotaExhausted && (
                                                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20 text-[11px] text-amber-400 leading-relaxed">
                                                        <span className="shrink-0 mt-[1px]">⚠</span>
                                                        <span>
                                                            Web search credits exhausted for this month — showing AI-only research instead.
                                                            Resets next billing cycle or <span className="underline cursor-pointer" onClick={() => (window.electronAPI as any)?.openExternal?.('https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl')}>upgrade your plan</span>.
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Dossier Results */}
                                                {companyDossier && (
                                                    <div className="space-y-4 border-t border-border-subtle pt-4 mt-2">

                                                        {/* Hiring Strategy */}
                                                        {companyDossier.hiring_strategy && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-1">Hiring Strategy</div>
                                                                <p className="text-xs text-text-secondary leading-relaxed bg-bg-input p-3 rounded-lg">{companyDossier.hiring_strategy}</p>
                                                            </div>
                                                        )}

                                                        {/* Interview Focus + Difficulty badge */}
                                                        {companyDossier.interview_focus && (
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">Interview Focus</div>
                                                                    {companyDossier.interview_difficulty && (
                                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                                                            companyDossier.interview_difficulty === 'easy' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                                            companyDossier.interview_difficulty === 'medium' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                                                            companyDossier.interview_difficulty === 'hard' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                                                                            'bg-red-500/10 text-red-400 border-red-500/20'
                                                                        }`}>
                                                                            {companyDossier.interview_difficulty.replace('_', ' ').toUpperCase()}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-xs text-text-secondary leading-relaxed bg-bg-input p-3 rounded-lg">{companyDossier.interview_focus}</p>
                                                            </div>
                                                        )}

                                                        {/* Salary Estimates */}
                                                        {companyDossier.salary_estimates?.length > 0 && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-1">Salary Estimates</div>
                                                                <div className="space-y-2 bg-bg-input p-3 rounded-lg">
                                                                    {companyDossier.salary_estimates.map((s: any, i: number) => (
                                                                        <div key={i} className="flex items-center justify-between pb-2 mb-2 border-b border-border-subtle last:border-0 last:pb-0 last:mb-0">
                                                                            <span className="text-xs text-text-primary font-medium">{s.title} <span className="text-text-tertiary">({s.location})</span></span>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs font-bold text-green-400">
                                                                                    {s.currency} {s.min?.toLocaleString()} – {s.max?.toLocaleString()}
                                                                                </span>
                                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${s.confidence === 'high' ? 'bg-green-500/10 text-green-500 border-green-500/20' : s.confidence === 'medium' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                                                                                    {s.confidence?.toUpperCase()}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Work Culture — 5-star ratings */}
                                                        {companyDossier.culture_ratings && typeof companyDossier.culture_ratings === 'object' &&
                                                          Object.values(companyDossier.culture_ratings).some(v => typeof v === 'number' && (v as number) > 0) && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">Work Culture</div>
                                                                <div className="bg-bg-input p-3 rounded-lg">
                                                                    {/* Overall score hero */}
                                                                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
                                                                        <div>
                                                                            <span className="text-2xl font-bold text-text-primary">{companyDossier.culture_ratings.overall.toFixed(1)}</span>
                                                                            <span className="text-xs text-text-tertiary"> / 5</span>
                                                                            {companyDossier.culture_ratings.review_count && (
                                                                                <div className="text-[10px] text-text-tertiary mt-0.5">{companyDossier.culture_ratings.review_count}</div>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <StarRating value={companyDossier.culture_ratings.overall} size={14} />
                                                                            {companyDossier.culture_ratings.data_sources?.length > 0 && (
                                                                                <div className="flex gap-1 mt-1 justify-end">
                                                                                    {companyDossier.culture_ratings.data_sources.map((src: string, i: number) => (
                                                                                        <span key={i} className="text-[9px] text-text-tertiary bg-bg-input px-1.5 py-0.5 rounded">{src}</span>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {/* Sub-ratings grid */}
                                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                                                        {[
                                                                            { label: 'Work-Life Balance', key: 'work_life_balance' },
                                                                            { label: 'Career Growth', key: 'career_growth' },
                                                                            { label: 'Compensation', key: 'compensation' },
                                                                            { label: 'Management', key: 'management' },
                                                                            { label: 'Diversity & Inclusion', key: 'diversity' },
                                                                        ].map(({ label, key }) => {
                                                                            const raw = (companyDossier.culture_ratings as any)[key];
                                                                            const val: number = typeof raw === 'number' ? raw : 0;
                                                                            return val > 0 ? (
                                                                                <div key={key} className="flex items-center justify-between gap-2">
                                                                                    <span className="text-[10px] text-text-tertiary truncate">{label}</span>
                                                                                    <div className="flex items-center gap-1 shrink-0">
                                                                                        <StarRating value={val} size={9} />
                                                                                        <span className="text-[10px] text-text-secondary font-medium">{val.toFixed(1)}</span>
                                                                                    </div>
                                                                                </div>
                                                                            ) : null;
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Employee Reviews */}
                                                        {companyDossier.employee_reviews?.length > 0 && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">Employee Reviews</div>
                                                                <div className="space-y-2">
                                                                    {companyDossier.employee_reviews.map((r: any, i: number) => (
                                                                        <div key={i} className="bg-bg-input p-3 rounded-lg">
                                                                            <div className="flex items-start gap-2">
                                                                                <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${r.sentiment === 'positive' ? 'bg-green-400' : r.sentiment === 'mixed' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                                                                                <p className="text-xs text-text-secondary leading-relaxed italic">"{r.quote}"</p>
                                                                            </div>
                                                                            <div className="flex items-center gap-2 mt-2 ml-4">
                                                                                {r.role && <span className="text-[10px] text-text-tertiary">{r.role}</span>}
                                                                                {r.role && r.source && <span className="text-text-tertiary/40 text-[10px]">·</span>}
                                                                                {r.source && <span className="text-[10px] text-text-tertiary/70 bg-bg-input px-1.5 py-0.5 rounded">{r.source}</span>}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Critics — common complaints */}
                                                        {companyDossier.critics?.length > 0 && (
                                                            <div>
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <AlertCircle size={11} className="text-orange-400" />
                                                                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">Common Complaints</div>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    {companyDossier.critics.map((c: any, i: number) => (
                                                                        <div key={i} className="bg-bg-input p-3 rounded-lg">
                                                                            <div className="flex items-center justify-between mb-1">
                                                                                <span className="text-[10px] font-semibold text-orange-400/90">{c.category}</span>
                                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                                                                    c.frequency === 'widespread' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                                                    c.frequency === 'frequently' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                                                                                    'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                                                                }`}>
                                                                                    {c.frequency?.toUpperCase()}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-xs text-text-secondary leading-relaxed">{c.complaint}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Benefits */}
                                                        {companyDossier.benefits?.length > 0 && (
                                                            <div>
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <Gift size={11} className="text-emerald-400" />
                                                                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">Benefits & Perks</div>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {companyDossier.benefits.map((b: string, i: number) => (
                                                                        <span key={i} className="text-[11px] text-emerald-400/90 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">{b}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Core Values */}
                                                        {companyDossier.core_values?.length > 0 && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">Core Values</div>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {companyDossier.core_values.map((v: string, i: number) => (
                                                                        <span key={i} className="text-[11px] text-purple-400/90 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">{v}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Recent News */}
                                                        {companyDossier.recent_news && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-1">Recent News</div>
                                                                <p className="text-xs text-text-secondary leading-relaxed bg-bg-input p-3 rounded-lg">{companyDossier.recent_news}</p>
                                                            </div>
                                                        )}

                                                        {/* Competitors */}
                                                        {companyDossier.competitors?.length > 0 && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">Competitors</div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {companyDossier.competitors.map((c: string, i: number) => (
                                                                        <span key={i} className="text-[11px] text-text-secondary px-2.5 py-1 rounded-full bg-bg-input flex items-center gap-1.5">
                                                                            <Building2 size={10} className="text-text-tertiary" /> {c}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Sources count */}
                                                        {companyDossier.sources?.length > 0 && (
                                                            <div className="text-[10px] text-text-tertiary mt-2">
                                                                Sources: {companyDossier.sources.filter(Boolean).length} references
                                                            </div>
                                                        )}

                                                        {/* Beta disclaimer */}
                                                        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-purple-500/5 border border-purple-500/15">
                                                            <span className="text-purple-400/70 mt-px shrink-0">⚠</span>
                                                            <p className="text-[10px] text-text-tertiary leading-relaxed">
                                                                <span className="font-semibold text-purple-400/80">Beta feature.</span> Company research is AI-generated and may contain inaccuracies. Verify salary figures and hiring details independently before use.
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </BezelCard>
                                    )}
                                    <div className="pt-4">
                                        <ProfileVisualizer profileData={profileData} />
                                    </div>

                                    {profileData?.hasActiveJD && (
                                        <BezelCard delay={0.6}>

                                                <div className="p-5">
                                                    {/* Header row */}
                                                    <div className="flex items-center justify-between mb-5">
                                                        <div className="flex items-center gap-3">
                                                            <div className="relative">
                                                                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(6,182,212,0.1) 100%)', border: '1px solid rgba(16,185,129,0.25)' }}>
                                                                    <Briefcase size={15} className="text-emerald-400" />
                                                                </div>
                                                                {negotiationScript && (
                                                                    <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-bg-item-surface" />
                                                                )}
                                                            </div>
                                                            <div>
                                                                <h3 className="text-[13px] font-bold text-text-primary tracking-tight">Negotiation Script</h3>
                                                                <p className="text-[10px] text-text-tertiary mt-0.5 tracking-wide uppercase">
                                                                    {negotiationScript ? `Tailored for ${profileData?.activeJD?.company || 'this role'}` : 'AI-powered salary coaching'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {negotiationScript && (
                                                                <button
                                                                    onClick={async () => {
                                                                        setNegotiationGenerating(true);
                                                                        setNegotiationError('');
                                                                        try {
                                                                            const result = await window.electronAPI?.profileGenerateNegotiation?.(true);
                                                                            if (result?.success && result.script) {
                                                                                setNegotiationScript(result.script);
                                                                            } else {
                                                                                setNegotiationError(result?.error || 'Failed to regenerate');
                                                                            }
                                                                        } catch { setNegotiationError('Generation failed'); }
                                                                        finally { setNegotiationGenerating(false); }
                                                                    }}
                                                                    disabled={negotiationGenerating}
                                                                    title="Regenerate script"
                                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-input transition-all border border-border-subtle"
                                                                >
                                                                    <RefreshCw size={12} className={negotiationGenerating ? 'animate-spin' : ''} />
                                                                </button>
                                                            )}
                                                            {!negotiationScript && (
                                                                <MagneticButton
                                                                    onClick={async () => {
                                                                        setNegotiationGenerating(true);
                                                                        setNegotiationError('');
                                                                        try {
                                                                            const result = await window.electronAPI?.profileGenerateNegotiation?.(false);
                                                                            if (result?.success && result.script) {
                                                                                setNegotiationScript(result.script);
                                                                            } else {
                                                                                setNegotiationError(result?.error || 'Failed to generate');
                                                                            }
                                                                        } catch { setNegotiationError('Generation failed'); }
                                                                        finally { setNegotiationGenerating(false); }
                                                                    }}
                                                                    disabled={negotiationGenerating}
                                                                    primary={true}
                                                                    style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(6,182,212,0.15) 100%)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}
                                                                >
                                                                    {negotiationGenerating ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                                    {negotiationGenerating ? 'Generating…' : 'Generate Script'}
                                                                </MagneticButton>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {negotiationError && (
                                                        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                                                            <AlertCircle size={12} className="text-red-400 shrink-0" />
                                                            <p className="text-[11px] text-red-400">{negotiationError}</p>
                                                        </div>
                                                    )}

                                                    {/* Empty state */}
                                                    {!negotiationScript && !negotiationGenerating && !negotiationError && (
                                                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                                                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.06) 100%)', border: '1px solid rgba(16,185,129,0.15)' }}>
                                                                <Briefcase size={20} className="text-emerald-500/50" />
                                                            </div>
                                                            <div className="text-center">
                                                                <p className="text-[12px] font-medium text-text-secondary">No script yet</p>
                                                                <p className="text-[10px] text-text-tertiary mt-0.5">Generate a personalized opening, justification &amp; counter-offer</p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* First-time generation skeleton — only when no prior script exists */}
                                                    {negotiationGenerating && !negotiationScript && (
                                                        <div className="space-y-3 py-2">
                                                            {[40, 70, 55].map((w, i) => (
                                                                <div key={i} className="h-3 rounded-full bg-bg-input animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }} />
                                                            ))}
                                                            <div className="h-12 rounded-lg bg-bg-input animate-pulse mt-2" style={{ animationDelay: '450ms' }} />
                                                        </div>
                                                    )}

                                                    {/* Existing script stays visible during regeneration to avoid a layout
                                                        collapse → re-expand jump (which Framer's layout animation amplifies).
                                                        We just dim it and let the spinner in the refresh button signal work. */}
                                                    {negotiationScript && (
                                                        <div
                                                            className="space-y-3 transition-opacity duration-300"
                                                            style={{
                                                                opacity: negotiationGenerating ? 0.45 : 1,
                                                                pointerEvents: negotiationGenerating ? 'none' : 'auto',
                                                            }}>
                                                            {/* Salary Range Hero */}
                                                            {negotiationScript.salary_range && (
                                                                <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.06) 100%)', border: '1px solid rgba(16,185,129,0.18)' }}>
                                                                    <div>
                                                                        <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70 mb-1">Target Compensation</div>
                                                                        <div className="text-xl font-bold tracking-tight" style={{ color: '#34d399' }}>
                                                                            {negotiationScript.salary_range.currency} {negotiationScript.salary_range.min.toLocaleString()}
                                                                            <span className="text-text-tertiary font-normal mx-2">–</span>
                                                                            {negotiationScript.salary_range.max.toLocaleString()}
                                                                        </div>
                                                                        {negotiationScript.sources?.length > 0 && (
                                                                            <div className="text-[9px] text-text-tertiary mt-1">{negotiationScript.sources.length} market source{negotiationScript.sources.length > 1 ? 's' : ''}</div>
                                                                        )}
                                                                    </div>
                                                                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full tracking-wide ${
                                                                        negotiationScript.salary_range.confidence === 'high' ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/25' :
                                                                        negotiationScript.salary_range.confidence === 'medium' ? 'text-yellow-400 bg-yellow-500/15 border border-yellow-500/25' :
                                                                        'text-text-tertiary bg-bg-input border border-border-subtle'
                                                                    }`}>
                                                                        {(negotiationScript.salary_range.confidence || 'low').toUpperCase()}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Step cards */}
                                                            {[
                                                                {
                                                                    step: '01',
                                                                    label: 'Opening',
                                                                    sublabel: 'When asked about salary expectations',
                                                                    content: negotiationScript.opening_line,
                                                                    accent: '#10b981',
                                                                    accentBg: 'rgba(16,185,129,0.07)',
                                                                    accentBorder: 'rgba(16,185,129,0.2)',
                                                                    quote: true,
                                                                },
                                                                {
                                                                    step: '02',
                                                                    label: 'Justify Your Ask',
                                                                    sublabel: 'Link your track record to the number',
                                                                    content: negotiationScript.justification,
                                                                    accent: '#60a5fa',
                                                                    accentBg: 'rgba(96,165,250,0.07)',
                                                                    accentBorder: 'rgba(96,165,250,0.2)',
                                                                    quote: false,
                                                                },
                                                                {
                                                                    step: '03',
                                                                    label: 'Counter & Hold',
                                                                    sublabel: 'If they come back lower',
                                                                    content: negotiationScript.counter_offer_fallback,
                                                                    accent: '#fb923c',
                                                                    accentBg: 'rgba(251,146,60,0.07)',
                                                                    accentBorder: 'rgba(251,146,60,0.2)',
                                                                    quote: true,
                                                                },
                                                            ].filter(s => s.content).map((s) => ({ ...s, content: s.content.replace(/^["'"']+|["'"']+$/g, '').trim() })).map((s) => (
                                                                <div key={s.step} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${s.accentBorder}`, background: s.accentBg }}>
                                                                    <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[10px] font-black tracking-widest" style={{ color: s.accent, opacity: 0.6 }}>STEP {s.step}</span>
                                                                            <span className="text-[11px] font-bold text-text-primary">{s.label}</span>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => navigator.clipboard?.writeText(s.content)}
                                                                            title="Copy to clipboard"
                                                                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium transition-all hover:bg-bg-input text-text-tertiary hover:text-text-secondary"
                                                                        >
                                                                            <Check size={9} />
                                                                            Copy
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-[10px] text-text-tertiary px-3.5 pb-2 -mt-1 tracking-wide">{s.sublabel}</p>
                                                                    <div className="mx-3.5 mb-3.5">
                                                                        <p className={`text-[12px] leading-relaxed text-text-primary ${s.quote ? 'pl-3 italic' : ''}`}>
                                                                            {s.content}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                        </BezelCard>
                                    )}

                    </div>
                </div>
            </div>

            <PremiumUpgradeModal
                isOpen={isPremiumModalOpen}
                onClose={() => setIsPremiumModalOpen(false)}
                isPremium={isPremium}
                onActivated={async () => {
                    setIsPremium(true);
                    // Refresh plan + cache from the canonical source so the
                    // header reflects the new state on every subsequent mount.
                    try {
                        const details = await window.electronAPI?.licenseGetDetails?.();
                        const plan = details?.plan ?? '';
                        if (plan) setPremiumPlan(plan);
                        writePremiumCache(true, plan);
                    } catch {
                        writePremiumCache(true, premiumPlan);
                    }
                    const status = await window.electronAPI?.profileGetStatus?.();
                    if (status) setProfileStatus(status);
                }}
                onDeactivated={() => {
                    setIsPremium(false);
                    setPremiumPlan('');
                    writePremiumCache(false, '');
                    // Auto-disable profile mode in UI when license is removed
                    setProfileStatus(prev => ({ ...prev, profileMode: false }));
                }}
            />
        </div>
    );
}
