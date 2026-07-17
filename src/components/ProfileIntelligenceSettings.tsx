import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
    X, RefreshCw, Upload, Briefcase, Trash2, Check, Globe,
    Building2, Search, AlertCircle, AlertTriangle, Gift, Info, Star, Sparkles,
    User, CheckCircle, ArrowUpRight, Paperclip, Plus, FileText,
    GraduationCap, FolderKanban, Layers, Mail,
} from 'lucide-react';
import { PremiumUpgradeModal } from '../premium';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { truncateResumeSummary } from '../utils/resumeSummary.mjs';

// ─── CSS ──────────────────────────────────────────────────────────────────────
const PI_CSS = `
    .pi-root {
        --pi-bg: #111111;
        --pi-sidebar-bg: #0a0a0a;
        --pi-border: rgba(255,255,255,0.07);
        --pi-hero: #ffffff;
        --pi-primary: rgba(255,255,255,0.85);
        --pi-secondary: rgba(255,255,255,0.55);
        --pi-tertiary: rgba(255,255,255,0.35);
        --pi-btn-bg: rgba(255,255,255,0.06);
        --pi-btn-bg-hover: rgba(255,255,255,0.10);
        --pi-btn-border: rgba(255,255,255,0.10);
        --pi-item-hover: rgba(255,255,255,0.04);
        --pi-item-active: rgba(255,255,255,0.10);
        --pi-input-bg: transparent;
        --pi-input-border: rgba(255,255,255,0.10);
        --pi-danger: #ef4444;
        --pi-danger-bg: rgba(239,68,68,0.12);
        --pi-accent: #818cf8;
        --pi-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
        --pi-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
        --pi-input-border-focus: rgba(129,140,248,0.40);
        --pi-input-bg-focus: rgba(129,140,248,0.04);
        --pi-cta-bg: #ffffff;
        --pi-cta-text: #141414;
        --pi-cta-ring: rgba(0,0,0,0.08);
        --pi-close-bg: rgba(255,255,255,0.06);
        --pi-close-hover: rgba(255,255,255,0.12);
        --pi-card-bg: rgba(255,255,255,0.015);
        /* Radius system */
        --pi-r-sm: 6px;
        --pi-r-md: 10px;
        --pi-r-lg: 12px;
        --pi-r-pill: 9999px;
    }
    .pi-root[data-theme='light'] {
        --pi-bg: #ffffff;
        --pi-sidebar-bg: #f5f5f5;
        --pi-border: rgba(0,0,0,0.08);
        --pi-hero: #111827;
        --pi-primary: #374151;
        --pi-secondary: #6b7280;
        --pi-tertiary: #9ca3af;
        --pi-btn-bg: rgba(0,0,0,0.04);
        --pi-btn-bg-hover: rgba(0,0,0,0.08);
        --pi-btn-border: rgba(0,0,0,0.05);
        --pi-item-hover: rgba(0,0,0,0.03);
        --pi-item-active: rgba(0,0,0,0.06);
        --pi-input-border: rgba(0,0,0,0.10);
        --pi-accent: #6366f1;
        --pi-input-border-focus: rgba(99,102,241,0.40);
        --pi-input-bg-focus: rgba(99,102,241,0.04);
        --pi-cta-bg: #000000;
        --pi-cta-text: #ffffff;
        --pi-cta-ring: rgba(255,255,255,0.10);
        --pi-close-bg: rgba(0,0,0,0.05);
        --pi-close-hover: rgba(0,0,0,0.10);
        --pi-card-bg: rgba(0,0,0,0.015);
    }

    /* ── Keyframes ── */
    @keyframes pi-list-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes pi-panel-fade {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes pi-check-in {
        from { opacity: 0; transform: scale(0.5); }
        to   { opacity: 1; transform: scale(1); }
    }
    @keyframes pi-save-pulse {
        0%   { transform: scale(1); }
        45%  { transform: scale(1.045); }
        100% { transform: scale(1); }
    }
    @keyframes pi-spin { to { transform: rotate(360deg); } }
    @keyframes pi-shimmer {
        from { transform: translateX(-120%); }
        to   { transform: translateX(220%); }
    }
    @keyframes pi-shimmer-pulse {
        0%, 100% { opacity: 0.55; }
        50%       { opacity: 1; }
    }
    .pi-panel-fade { animation: pi-panel-fade 180ms var(--pi-ease-out) both; }
    .pi-list-item  { animation: pi-list-in 280ms var(--pi-ease-out) both; }
    .pi-spinner    { animation: pi-spin 0.8s linear infinite; }
    .pi-save-pulse { animation: pi-save-pulse 360ms var(--pi-ease-spring); }
    .pi-skeleton   {
        background: var(--pi-btn-bg);
        animation: pi-shimmer-pulse 1.4s ease-in-out infinite;
    }

    /* ── Press feedback ── */
    .pi-press {
        transition: background 180ms var(--pi-ease-out), color 180ms ease,
                    border-color 180ms ease, transform 160ms var(--pi-ease-out);
    }
    .pi-press:active { transform: scale(0.97); }
    .pi-press-soft {
        transition: background 180ms var(--pi-ease-out), color 180ms ease,
                    transform 140ms var(--pi-ease-out);
    }
    .pi-press-soft:active { transform: scale(0.92); }

    /* ── Sliding selection indicator ── */
    .pi-sel-indicator {
        position: absolute;
        left: 8px; right: 8px;
        background: var(--pi-item-active);
        border-radius: 6px;
        pointer-events: none;
        z-index: 0;
        transition:
            top 280ms cubic-bezier(0.23, 1, 0.32, 1),
            height 280ms cubic-bezier(0.23, 1, 0.32, 1),
            opacity 200ms ease;
    }
    .pi-sel-indicator[data-instant='true'] { transition: opacity 160ms ease; }

    /* ── Nav items ── */
    .pi-nav-item {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 10px; border-radius: 6px;
        cursor: pointer; font-size: 13px; font-weight: 500;
        color: var(--pi-secondary); background: transparent;
        user-select: none; margin-bottom: 2px;
        position: relative; z-index: 1;
        transition: background 180ms cubic-bezier(0.23, 1, 0.32, 1), color 180ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
        animation: pi-list-in 280ms var(--pi-ease-out) both;
    }
    .pi-nav-item:hover { background: var(--pi-item-hover); }
    .pi-nav-item.active { color: var(--pi-primary); }
    .pi-nav-item:active { transform: scale(0.97); }

    /* Staggered nav entry */
    .pi-nav-item:nth-child(2) { animation-delay: 0ms; }
    .pi-nav-item:nth-child(3) { animation-delay: 30ms; }
    .pi-nav-item:nth-child(4) { animation-delay: 60ms; }
    .pi-nav-item:nth-child(5) { animation-delay: 90ms; }
    .pi-nav-item:nth-child(6) { animation-delay: 120ms; }
    .pi-nav-item:nth-child(n+7) { animation-delay: 150ms; }

    /* Nav icon */
    .pi-nav-item svg { color: var(--pi-tertiary); flex-shrink: 0; }
    .pi-nav-item.active svg { color: var(--pi-secondary); }

    /* ── Content boxes ── */
    .pi-content-box {
        border: 1px solid var(--pi-input-border);
        border-radius: var(--pi-r-lg);
        overflow: hidden;
        transition: border-color 180ms var(--pi-ease-out), background 180ms ease,
                    box-shadow 180ms ease;
        background: var(--pi-input-bg);
    }
    .pi-content-box:focus-within {
        border-color: var(--pi-input-border-focus);
        background: var(--pi-input-bg-focus);
        box-shadow: 0 0 0 3px rgba(129,140,248,0.12);
    }
    .pi-root[data-theme='light'] .pi-content-box:focus-within {
        box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
    }

    /* ── Textarea / Input ── */
    .pi-textarea {
        width: 100%; background: transparent; border: none; outline: none;
        padding: 12px 14px; font-size: 12px; color: var(--pi-primary);
        line-height: 1.6; resize: none; font-family: inherit; box-sizing: border-box;
    }
    .pi-textarea::placeholder { color: var(--pi-tertiary); }
    .pi-input {
        width: 100%; background: transparent; border: none; outline: none;
        padding: 10px 14px; font-size: 12px; color: var(--pi-primary);
        font-family: inherit; box-sizing: border-box;
    }
    .pi-input::placeholder { color: var(--pi-tertiary); }

    /* ── Toggle track/thumb ── */
    .pi-toggle-track {
        width: 44px; height: 24px; border-radius: 12px; position: relative;
        cursor: pointer; flex-shrink: 0;
        background: rgba(255,255,255,0.12);
        transition: background 220ms var(--pi-ease-out);
    }
    .pi-toggle-track[data-checked='true'] { background: var(--pi-accent); }
    .pi-toggle-track[data-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
    .pi-root[data-theme='light'] .pi-toggle-track { background: rgba(0,0,0,0.12); }
    .pi-toggle-thumb {
        position: absolute; top: 3px; left: 3px;
        width: 18px; height: 18px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        transition: transform 260ms var(--pi-ease-spring);
    }
    .pi-toggle-track[data-checked='true'] .pi-toggle-thumb { transform: translateX(20px); }

    /* ── Toggle card (neutral — no accent tint when on; the toggle itself signals state) ── */
    .pi-toggle-card {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 14px 16px; border: 1px solid var(--pi-border);
        border-radius: var(--pi-r-md); background: rgba(255,255,255,0.015);
        transition: border-color 220ms ease, background 220ms ease;
    }
    .pi-root[data-theme='light'] .pi-toggle-card { background: rgba(0,0,0,0.015); }

    /* ── CTA pill ── */
    .pi-cta {
        padding: 5px 5px 5px 16px; height: 36px; border-radius: 18px;
        background: var(--pi-cta-bg); color: var(--pi-cta-text);
        font-size: 13px; font-weight: 600; letter-spacing: -0.01em;
        border: none; cursor: pointer;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        transition: transform 200ms var(--pi-ease-out), box-shadow 200ms ease;
        white-space: nowrap; position: relative; overflow: hidden;
    }
    .pi-cta:hover { transform: translateY(-1px) scale(1.01); box-shadow: 0 6px 16px rgba(0,0,0,0.28); }
    .pi-cta:active { transform: scale(0.96); box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
    .pi-cta-ring {
        width: 26px; height: 26px; border-radius: 50%;
        background: var(--pi-cta-ring);
        display: flex; align-items: center; justify-content: center;
        transition: transform 280ms var(--pi-ease-out);
        position: relative; z-index: 1;
    }
    .pi-cta:hover .pi-cta-ring { transform: translateX(1px) scale(1.05); }
    .pi-cta--trial { background: linear-gradient(135deg,#8b5cf6,#7c3aed); color:#fff; box-shadow:0 2px 8px rgba(124,58,237,0.30); }
    .pi-cta--trial .pi-cta-ring { background: rgba(255,255,255,0.18); }
    .pi-cta--shimmer::after {
        content: '';
        position: absolute; top: 0; bottom: 0; left: 0; width: 45%;
        background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.09) 50%, transparent 100%);
        animation: pi-shimmer 3.2s cubic-bezier(0.4, 0, 0.6, 1) 2.0s infinite;
        pointer-events: none;
    }
    .pi-cta--trial::after {
        background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.14) 50%, transparent 100%);
    }

    /* ── Util buttons ── */
    .pi-close-btn {
        background: none; border: none; cursor: pointer;
        color: var(--pi-tertiary); display: flex; align-items: center;
        justify-content: center; padding: 4px 8px;
        border-radius: var(--pi-r-sm); align-self: flex-start;
        transition: color 180ms var(--pi-ease-out), transform 140ms var(--pi-ease-out);
    }
    .pi-close-btn:hover { color: var(--pi-primary); }
    .pi-close-btn:active { transform: scale(0.92); }

    .pi-pill-btn {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 12px; border-radius: var(--pi-r-pill); font-size: 12px; font-weight: 500;
        cursor: pointer; border: 1px solid var(--pi-btn-border);
        background: var(--pi-btn-bg); color: var(--pi-secondary);
        transition: background 180ms var(--pi-ease-out), color 180ms ease,
                    transform 160ms var(--pi-ease-out);
    }
    .pi-pill-btn:hover:not(:disabled) { background: var(--pi-btn-bg-hover); color: var(--pi-primary); }
    .pi-pill-btn:active:not(:disabled) { transform: scale(0.97); }
    .pi-pill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pi-pill-btn--primary { background: var(--pi-accent); color: #fff; border-color: transparent; }
    .pi-pill-btn--primary:hover:not(:disabled) { filter: brightness(1.1); }
    .pi-pill-btn--danger { color: var(--pi-danger); }
    .pi-pill-btn--danger:hover:not(:disabled) { background: var(--pi-danger-bg); color: var(--pi-danger); border-color: var(--pi-danger-bg); }

    /* ── Section label ── */
    .pi-section-label {
        font-size: 14px; line-height: 1.3; font-weight: 600;
        color: var(--pi-hero); margin: 0 0 10px;
    }

    /* ── Section card ── */
    .pi-section-card {
        border: 1px solid var(--pi-border);
        border-radius: var(--pi-r-lg);
        background: var(--pi-card-bg);
        padding: 14px 16px;
    }
    .pi-section-card + .pi-section-card { margin-top: 16px; }

    .pi-section-header {
        display: flex; align-items: center; gap: 8px;
        margin: 0 0 10px;
    }
    .pi-section-header-icon {
        display: flex; align-items: center; justify-content: center;
        width: 20px; height: 20px; border-radius: var(--pi-r-sm);
        background: var(--pi-btn-bg); color: var(--pi-secondary);
        flex-shrink: 0;
    }
    .pi-section-header-label {
        font-size: 12px; font-weight: 700; color: var(--pi-hero);
        letter-spacing: -0.01em; margin: 0;
    }

    .pi-chip-overflow { display: block; margin-top: 6px; }

    /* ── Sticky panel header ── */
    .pi-panel-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 32px; height: 46px;
        border-bottom: 1px solid var(--pi-border);
        flex-shrink: 0; gap: 12px;
    }
    .pi-panel-header-title {
        font-size: 14px; font-weight: 600;
        color: var(--pi-hero);
        margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* ── File upload (Modes-style) ── */
    .pi-file-empty {
        border: 1px solid var(--pi-input-border); border-radius: var(--pi-r-lg);
        padding: 22px 24px; display: flex; flex-direction: column;
        align-items: center; gap: 12; text-align: center;
        background: var(--pi-input-bg);
        margin-bottom: 16px;
    }
    .pi-file-row {
        display: grid; grid-template-columns: 13px 1fr 20px;
        align-items: center; gap: 8; padding: 8px 12px;
        background: var(--pi-btn-bg); border: 1px solid var(--pi-btn-border);
        border-radius: var(--pi-r-md); margin-bottom: 6px;
    }
    .pi-upload-btn {
        display: flex; align-items: center; gap: 7;
        padding: 7px 18px; background: var(--pi-btn-bg);
        border: 1px solid var(--pi-btn-border); border-radius: 20px;
        color: var(--pi-primary); font-size: 12px; font-weight: 500;
        cursor: pointer; font-family: inherit;
        transition: background 180ms var(--pi-ease-out), transform 160ms var(--pi-ease-out);
    }
    .pi-upload-btn:hover:not(:disabled) { background: var(--pi-btn-bg-hover); }
    .pi-upload-btn:active:not(:disabled) { transform: scale(0.97); }
    .pi-upload-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pi-add-file-btn {
        display: flex; align-items: center; gap: 6;
        background: none; border: none; cursor: pointer;
        color: var(--pi-tertiary); font-size: 12px; font-family: inherit;
        padding: 6px 2px; margin-top: 2px;
        transition: color 180ms var(--pi-ease-out), transform 140ms var(--pi-ease-out);
    }
    .pi-add-file-btn:hover { color: var(--pi-primary); }
    .pi-add-file-btn:active { transform: scale(0.97); }

    /* ── Sub-list staggered reveal ── */
    .pi-stagger > .pi-list-item:nth-child(1) { animation-delay: 0ms; }
    .pi-stagger > .pi-list-item:nth-child(2) { animation-delay: 40ms; }
    .pi-stagger > .pi-list-item:nth-child(3) { animation-delay: 80ms; }
    .pi-stagger > .pi-list-item:nth-child(4) { animation-delay: 120ms; }
    .pi-stagger > .pi-list-item:nth-child(5) { animation-delay: 160ms; }
    .pi-stagger > .pi-list-item:nth-child(6) { animation-delay: 200ms; }
    .pi-stagger > .pi-list-item:nth-child(n+7) { animation-delay: 220ms; }

    /* ── Skill chips ── */
    .pi-chip {
        font-size: 10px; font-weight: 500; color: var(--pi-secondary);
        padding: 3px 8px; border-radius: var(--pi-r-pill);
        border: 1px solid var(--pi-border); background: var(--pi-btn-bg);
        display: inline-block;
        animation: pi-list-in 220ms var(--pi-ease-out) both;
        transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 160ms ease, border-color 160ms ease, color 160ms ease;
        cursor: default;
    }
    @media (hover: hover) and (pointer: fine) {
        .pi-chip:hover {
            border-color: var(--pi-btn-bg-hover);
            color: var(--pi-primary);
        }
    }
    /* "+N more" chip — reads as secondary, not a real skill */
    .pi-chip--more {
        color: var(--pi-tertiary); background: transparent;
        border-style: dashed; cursor: default;
    }

    /* ── Status dot ── */
    .pi-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

    /* ── Reduced motion ── */
    @media (prefers-reduced-motion: reduce) {
        .pi-panel-fade { animation: none; }
        .pi-list-item  { animation-duration: 100ms; animation-delay: 0ms !important; }
        .pi-press:active, .pi-press-soft:active { transform: none; }
        .pi-cta--shimmer::after { animation: none; }
        .pi-skeleton { animation: none; opacity: 0.5; }
    }
`;

// ─── StarRating ───────────────────────────────────────────────────────────────
const StarRating = ({ value, size = 11 }: { value: number; size?: number }) => {
    const clamped = Math.min(5, Math.max(0, value ?? 0));
    const rounded = Math.round(clamped * 2) / 2;
    const full = Math.floor(rounded);
    const half = rounded - full === 0.5;
    const empty = 5 - full - (half ? 1 : 0);
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {Array.from({ length: full }).map((_, i) => <Star key={`f${i}`} size={size} style={{ color: '#facc15', fill: '#facc15' }} />)}
            {half && <Star size={size} style={{ color: '#facc15', fill: 'rgba(250,204,21,0.4)' }} />}
            {Array.from({ length: empty }).map((_, i) => <Star key={`e${i}`} size={size} style={{ color: 'rgba(255,255,255,0.15)', fill: 'transparent' }} />)}
        </span>
    );
};

// ─── Premium cache ────────────────────────────────────────────────────────────
const PI_PREMIUM_CACHE_KEY = 'pi:isPremium';
const PI_PREMIUM_PLAN_CACHE_KEY = 'pi:premiumPlan';
const readPremiumCache = () => {
    if (typeof window === 'undefined') return { isPremium: false, plan: '' };
    try {
        return {
            isPremium: window.localStorage.getItem(PI_PREMIUM_CACHE_KEY) === '1',
            plan: window.localStorage.getItem(PI_PREMIUM_PLAN_CACHE_KEY) ?? '',
        };
    } catch { return { isPremium: false, plan: '' }; }
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
    } catch { /**/ }
};

// ─── Divider ──────────────────────────────────────────────────────────────────
const Divider = () => (
    <div style={{ height: 1, background: 'var(--pi-border)', margin: '24px 0' }} />
);

// ─── IndexBadge (ported from ModesSettings) ───────────────────────────────────
const MIN_INDEXING_MS = 2000;
const PI_INDEX_BADGES: Record<string, { label: string; color: string; bg: string; title: string }> = {
    uploading:  { label: 'Uploading…',  color: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  title: 'Uploading file' },
    processing: { label: 'Processing…', color: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  title: 'Extracting profile data' },
    ready:      { label: 'Ready',       color: '#22c55e', bg: 'rgba(34,197,94,0.14)',    title: 'Profile data extracted' },
    failed:     { label: 'Failed',      color: '#ef4444', bg: 'rgba(239,68,68,0.14)',    title: 'Upload failed' },
};

function useDisplayedStatus(rawStatus: string | undefined): string | undefined {
    const indexingStartRef = useRef<number | null>(null);
    const [displayed, setDisplayed] = useState<string | undefined>(rawStatus);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const isInProgress = rawStatus === 'uploading' || rawStatus === 'processing';
        const wasInProgress = displayed === 'uploading' || displayed === 'processing';
        if (isInProgress) {
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
            if (indexingStartRef.current === null) indexingStartRef.current = Date.now();
            setDisplayed(rawStatus);
            return;
        }
        if (wasInProgress && indexingStartRef.current !== null) {
            const elapsed = Date.now() - indexingStartRef.current;
            const remaining = MIN_INDEXING_MS - elapsed;
            if (remaining > 0) {
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => {
                    setDisplayed(rawStatus);
                    indexingStartRef.current = null;
                    timerRef.current = null;
                }, remaining);
                return;
            }
        }
        setDisplayed(rawStatus);
        indexingStartRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawStatus]);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
    return displayed;
}

const PIIndexBadge: React.FC<{ status?: string }> = ({ status }) => {
    const displayedStatus = useDisplayedStatus(status);
    const badge = displayedStatus ? PI_INDEX_BADGES[displayedStatus] : undefined;
    const prevLabelRef = useRef<string | undefined>(undefined);
    const [fading, setFading] = useState(false);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (prevLabelRef.current !== undefined && badge?.label !== prevLabelRef.current) {
            setFading(true);
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = setTimeout(() => { setFading(false); fadeTimerRef.current = null; }, 210);
        }
        prevLabelRef.current = badge?.label;
        return () => { if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current); };
    }, [badge?.label]);
    if (!badge) return <span style={{ width: 100, flexShrink: 0 }} />;
    const isInProgress = displayedStatus === 'uploading' || displayedStatus === 'processing';
    return (
        <span style={{ display: 'grid', gridTemplateColumns: '14px 6px 80px', alignItems: 'center', width: 100, flexShrink: 0 }}>
            <span aria-hidden="true" style={{ gridColumn: 1, display: 'flex', alignItems: 'center', opacity: isInProgress ? 1 : 0, transition: 'opacity 180ms ease-out', flexShrink: 0 }}>
                <svg className="pi-spinner" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
                    <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            </span>
            <span title={badge.title} style={{
                gridColumn: 3, justifySelf: 'start' as const,
                fontSize: 9.5, fontWeight: 600, letterSpacing: 0.2, padding: '2px 6px',
                borderRadius: 999, color: badge.color, background: badge.bg, flexShrink: 0,
                textTransform: 'uppercase' as const,
                opacity: fading ? 0 : 1,
                filter: fading ? 'blur(3px)' : 'blur(0px)',
                transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1), filter 200ms cubic-bezier(0.23,1,0.32,1), color 220ms cubic-bezier(0.23,1,0.32,1), background 220ms cubic-bezier(0.23,1,0.32,1)',
            }}>
                {badge.label}
            </span>
        </span>
    );
};

// ─── FileUploadEmpty — Modes-style empty state ────────────────────────────────
interface FileUploadEmptyProps {
    hint: string;
    uploading: boolean;
    hasAccess: boolean;
    onBrowse: () => void;
    onNeedUpgrade: () => void;
}
const FileUploadEmpty = ({ hint, uploading, hasAccess, onBrowse, onNeedUpgrade }: FileUploadEmptyProps) => (
    <div className="pi-file-empty" style={{ gap: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--pi-tertiary)', margin: 0 }}>{hint}{!hasAccess ? ' Requires Pro.' : ''}</p>
        <button
            className="pi-upload-btn"
            disabled={uploading}
            onClick={() => { if (!hasAccess) { onNeedUpgrade(); return; } onBrowse(); }}
        >
            {uploading
                ? <><RefreshCw size={13} className="pi-spinner" /> Processing…</>
                : <><Paperclip size={13} /> Upload file</>}
        </button>
    </div>
);

// ─── Nav items ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
    { id: 'identity',    label: 'Identity',           Icon: User },
    { id: 'insights',    label: 'Profile',            Icon: FileText },
    { id: 'company',     label: 'Company Intel',      Icon: Building2 },
    { id: 'coverletter', label: 'Cover Letter',       Icon: Mail },
    { id: 'negotiation', label: 'Negotiation Script', Icon: Gift },
    { id: 'tavily',      label: 'Tavily Search',      Icon: Globe },
];

// ─── Main export ──────────────────────────────────────────────────────────────
export function ProfileIntelligenceSettings({
    onClose,
}: {
    onClose: () => void;
}) {
    const cachedPremium = readPremiumCache();
    const [isPremium, setIsPremium] = useState(cachedPremium.isPremium);
    const [premiumPlan, setPremiumPlan] = useState<string>(cachedPremium.plan);
    const [isTrialActive] = useState(false);
    const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);
    const hasProfileAccess = isPremium || isTrialActive;
    const theme = useResolvedTheme();

    const [activeSection, setActiveSection] = useState('identity');

    // ── Sliding indicator refs ─────────────────────────────────────────────────
    const navItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [indicatorState, setIndicatorState] = useState<{ top: number; height: number; visible: boolean; ready: boolean }>({
        top: 0, height: 0, visible: false, ready: false,
    });

    // Profile
    const [profileStatus, setProfileStatus] = useState<{
        hasProfile: boolean; profileMode: boolean; name?: string; role?: string;
        totalExperienceYears?: number; profileFactsReady?: boolean;
        extractionMode?: 'llm' | 'heuristic' | 'none';
    }>({ hasProfile: false, profileMode: false });
    const [profileUploading, setProfileUploading] = useState(false);
    const [profileUploadStatus, setProfileUploadStatus] = useState<string | undefined>(undefined);
    const [profileError, setProfileError] = useState('');
    const profileAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
    const [profileData, setProfileData] = useState<any>(null);

    // ── Hero stat (static rounded value, no count-up) ────────────────────────
    const heroYearsRounded = (profileStatus.totalExperienceYears != null && Number.isFinite(profileStatus.totalExperienceYears))
        ? Math.round(profileStatus.totalExperienceYears)
        : null;

    // JD
    const [jdUploading, setJdUploading] = useState(false);
    const [jdUploadStatus, setJdUploadStatus] = useState<string | undefined>(undefined);
    const [jdError, setJdError] = useState('');
    const jdAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

    // Tavily
    const [tavilyApiKey, setTavilyApiKey] = useState('');
    const [hasStoredTavilyKey, setHasStoredTavilyKey] = useState(false);
    const [tavilySaving, setTavilySaving] = useState(false);
    const [tavilyError, setTavilyError] = useState('');

    // Company
    const [companyResearching, setCompanyResearching] = useState(false);
    const [companyDossier, setCompanyDossier] = useState<any>(null);
    const [companySearchQuotaExhausted, setCompanySearchQuotaExhausted] = useState(false);

    // Negotiation
    const [negotiationScript, setNegotiationScript] = useState<any>(null);
    const [negotiationGenerating, setNegotiationGenerating] = useState(false);
    const [negotiationError, setNegotiationError] = useState('');

    // Cover Letter
    const [coverLetter, setCoverLetter] = useState<any>(null);
    const [coverLetterGenerating, setCoverLetterGenerating] = useState(false);
    const [coverLetterError, setCoverLetterError] = useState('');

    // ── Measure & update indicator on section change ───────────────────────────
    useLayoutEffect(() => {
        const el = navItemRefs.current.get(activeSection);
        if (!el) { setIndicatorState(prev => ({ ...prev, visible: false })); return; }
        setIndicatorState(prev => ({
            top: el.offsetTop,
            height: el.offsetHeight,
            visible: true,
            ready: prev.ready || prev.visible,
        }));
    }, [activeSection]);

    useEffect(() => {
        if (window.electronAPI?.licenseGetDetails) {
            window.electronAPI.licenseGetDetails().then((details: any) => {
                const live = !!details?.isPremium;
                const plan = details?.plan ?? '';
                setIsPremium(live);
                if (plan) setPremiumPlan(plan);
                else if (!live) setPremiumPlan('');
                writePremiumCache(live, plan);
            }).catch(() => {});
        } else {
            window.electronAPI?.licenseCheckPremium?.().then((live: boolean) => {
                setIsPremium(!!live);
                writePremiumCache(!!live, premiumPlan);
            }).catch(() => {});
        }
        window.electronAPI?.profileGetStatus?.().then(setProfileStatus).catch(() => {});
        window.electronAPI?.profileGetProfile?.().then((data: any) => {
            setProfileData(data);
            if (data?.negotiationScript) setNegotiationScript(data.negotiationScript);
            if (data?.coverLetter) setCoverLetter(data.coverLetter);
            // Rehydrate the cached company-research dossier on mount so it persists
            // across app restarts (engine saves every successful research to the
            // company_dossiers table; we just surface what's already on disk).
            // Normalize: profileGetCompanyDossier returns the wrapper { dossier,
            // sources, last_checked }; getProfileData's payload carries the inner
            // dossier directly. Unwrap so the Company Intel panel always sees the
            // inner dossier shape — required by the live-search vs LLM-only branch.
            if (data?.companyDossier) {
                const cd = data.companyDossier;
                setCompanyDossier(cd?.dossier ?? cd);
            }
            // Fallback path — if the full profile payload's companyDossier is
            // missing for any reason (cache race, schema mismatch), fetch it
            // directly off disk via the dedicated channel.
            if (!data?.companyDossier) {
                window.electronAPI?.profileGetCompanyDossier?.().then(d => {
                    if (d) setCompanyDossier(d?.dossier ?? d);
                }).catch(() => {});
            }
        }).catch(() => {});
        window.electronAPI?.getStoredCredentials?.().then((creds: any) => {
            if (creds?.hasTavilyKey) setHasStoredTavilyKey(true);
        }).catch(() => {});
    }, []);

    const handleRemoveTavilyKey = async () => {
        if (!confirm('Remove your Tavily API key?')) return;
        try {
            const res = await window.electronAPI?.setTavilyApiKey?.('');
            if (res?.success) { setHasStoredTavilyKey(false); setTavilyApiKey(''); }
        } catch { /**/ }
    };

    const visibleNav = NAV_ITEMS.filter(n => {
        // Cover Letter & Company Intel: always visible — the panel's empty state
        // explains what's missing instead of hiding the tab.
        if (n.id === 'negotiation') return !!(profileData?.hasActiveJD);
        return true;
    });

    // ── Upload helpers ────────────────────────────────────────────────────────
    const doResumeUpload = async (filePath: string) => {
        const token = { cancelled: false };
        profileAbortRef.current = token;
        setProfileError(''); setProfileUploading(true); setProfileUploadStatus('uploading');
        try {
            setProfileUploadStatus('processing');
            const result = await window.electronAPI?.profileUploadResume?.(filePath);
            if (token.cancelled) return;
            if (result?.success) {
                const [status, data] = await Promise.all([
                    window.electronAPI?.profileGetStatus?.(),
                    window.electronAPI?.profileGetProfile?.(),
                ]);
                if (token.cancelled) return;
                if (status) setProfileStatus(status);
                if (data) setProfileData(data);
                setProfileUploadStatus('ready');
            } else {
                setProfileError(result?.error || 'Upload failed');
                setProfileUploadStatus('failed');
            }
        } catch (e: any) {
            if (token.cancelled) return;
            setProfileError(e.message || 'Upload failed');
            setProfileUploadStatus('failed');
        } finally {
            if (!token.cancelled) {
                setProfileUploading(false);
                setTimeout(() => setProfileUploadStatus(undefined), 3000);
            }
        }
    };

    const doJdUpload = async (filePath: string) => {
        const token = { cancelled: false };
        jdAbortRef.current = token;
        setJdError(''); setJdUploading(true); setJdUploadStatus('uploading');
        try {
            setJdUploadStatus('processing');
            const result = await window.electronAPI?.profileUploadJD?.(filePath);
            if (token.cancelled) return;
            if (result?.success) {
                const data = await window.electronAPI?.profileGetProfile?.();
                if (token.cancelled) return;
                if (data) setProfileData(data);
                setJdUploadStatus('ready');
            } else {
                setJdError(result?.error || 'JD upload failed');
                setJdUploadStatus('failed');
            }
        } catch (e: any) {
            if (token.cancelled) return;
            setJdError(e.message || 'JD upload failed');
            setJdUploadStatus('failed');
        } finally {
            if (!token.cancelled) {
                setJdUploading(false);
                setTimeout(() => setJdUploadStatus(undefined), 3000);
            }
        }
    };

    const browseResume = async () => {
        const fileResult = await window.electronAPI?.profileSelectFile?.();
        if (fileResult?.cancelled || !fileResult?.filePath) return;
        await doResumeUpload(fileResult.filePath);
    };

    const browseJD = async () => {
        const fileResult = await window.electronAPI?.profileSelectFile?.();
        if (fileResult?.cancelled || !fileResult?.filePath) return;
        await doJdUpload(fileResult.filePath);
    };

    const doCompanyResearch = async () => {
        const company = profileData?.activeJD?.company;
        if (!company) return;
        setCompanyResearching(true); setCompanySearchQuotaExhausted(false);
        try {
            const result = await window.electronAPI?.profileResearchCompany?.(company);
            if (result?.success && result.dossier) setCompanyDossier(result.dossier);
            if (result?.searchQuotaExhausted) setCompanySearchQuotaExhausted(true);
        } catch { /**/ }
        finally { setCompanyResearching(false); }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Section renderers
    // ─────────────────────────────────────────────────────────────────────────

    const renderIdentity = () => {
        const isActive = profileStatus.profileMode && hasProfileAccess;
        const isDisabled = !profileStatus.hasProfile || !hasProfileAccess;
        return (
        <>
            {/* Persona Engine toggle card */}
            <div
                className="pi-toggle-card"
                data-on={isActive ? 'true' : 'false'}
                style={{ marginBottom: 20 }}
            >
                <div>
                    <h3 className="pi-section-label" style={{ margin: 0 }}>Persona Engine</h3>
                    <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '4px 0 0' }}>
                        {profileStatus.profileMode
                            ? 'Answers rewired around your profile, the role, and your voice.'
                            : 'Dormant. Your profile is loaded but not shaping answers yet.'}
                    </p>
                </div>
                <div
                    className="pi-toggle-track"
                    data-checked={profileStatus.profileMode && hasProfileAccess ? 'true' : 'false'}
                    data-disabled={(!profileStatus.hasProfile || !hasProfileAccess) ? 'true' : 'false'}
                    onClick={async () => {
                        if (!profileStatus.hasProfile || !hasProfileAccess) return;
                        const newState = !profileStatus.profileMode;
                        try {
                            await window.electronAPI?.profileSetMode?.(newState);
                            setProfileStatus(prev => ({ ...prev, profileMode: newState }));
                        } catch { /**/ }
                    }}
                >
                    <div className="pi-toggle-thumb" />
                </div>
            </div>

            {/* Resume */}
            <h3 className="pi-section-label">Resume</h3>
            {!profileStatus.hasProfile && !profileUploading ? (
                <FileUploadEmpty
                    hint="Add your resume as real-time context."
                    uploading={profileUploading}
                    hasAccess={hasProfileAccess}
                    onBrowse={browseResume}
                    onNeedUpgrade={() => setIsPremiumModalOpen(true)}
                />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '13px 1fr 100px 20px', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-btn-border)', borderRadius: 'var(--pi-r-md)' }}>
                        <FileText size={13} style={{ color: 'var(--pi-secondary)', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--pi-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {profileData?.identity?.name || 'Resume.pdf'}
                        </span>
                        <PIIndexBadge status={profileUploadStatus} />
                        <button
                            className="pi-press-soft"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pi-tertiary)', padding: 4, display: 'flex', borderRadius: 4, transition: 'color 180ms ease' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--pi-danger)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--pi-tertiary)')}
                            onClick={async () => {
                                if (profileUploading) {
                                    profileAbortRef.current.cancelled = true;
                                    setProfileUploading(false);
                                    setProfileUploadStatus(undefined);
                                    setProfileStatus({ hasProfile: false, profileMode: false });
                                    const cancelData = await window.electronAPI?.profileGetProfile?.();
                                    setProfileData(cancelData ?? null);
                                    return;
                                }
                                if (!confirm('Delete your resume and its extracted data?')) return;
                                try {
                                    await window.electronAPI?.profileDelete?.();
                                    setProfileStatus({ hasProfile: false, profileMode: false });
                                    const freshData = await window.electronAPI?.profileGetProfile?.();
                                    setProfileData(freshData ?? null);
                                } catch { /**/ }
                            }}
                        >
                            <X size={12} />
                        </button>
                    </div>
                    {/* Candidate snapshot — shown once extraction is done */}
                    {profileStatus.hasProfile && !profileUploading && profileData?.identity && (() => {
                        const id = profileData.identity;
                        const latestExp = profileData.experience?.[0];
                        const topSkills: string[] = (profileData.skillsFlat ?? []).slice(0, 4);
                        // Resume summary: cap at 30 words, snap to sentence terminator inside the
                        // cap. See utils/resumeSummary.ts — pure function, unit-tested.
                        const summary = truncateResumeSummary(id.summary);
                        return (
                            <div style={{ padding: '10px 12px', border: '1px solid var(--pi-border)', borderRadius: 'var(--pi-r-md)', background: 'rgba(255,255,255,0.015)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {latestExp && (
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pi-primary)', lineHeight: 1.3 }}>
                                        {latestExp.role}
                                        {latestExp.company && <span style={{ fontWeight: 400, color: 'var(--pi-secondary)' }}> · {latestExp.company}</span>}
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    {id.location && (
                                        <span style={{ fontSize: 11, color: 'var(--pi-tertiary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <Globe size={10} /> {id.location}
                                        </span>
                                    )}
                                    {profileStatus.totalExperienceYears != null && profileStatus.totalExperienceYears > 0 && (
                                        <span style={{ fontSize: 11, color: 'var(--pi-tertiary)' }}>
                                            {profileStatus.totalExperienceYears}y exp
                                        </span>
                                    )}
                                </div>
                                {summary && (
                                    <p style={{
                                        fontSize: 11, color: 'var(--pi-secondary)', margin: 0,
                                        lineHeight: 1.55,
                                        // Lock the summary to ≥3 lines so the card silhouette
                                        // stays stable. If the summary is longer than 3 lines
                                        // the card grows — we never chop the text.
                                        minHeight: `calc(1.55em * 3)`,
                                    }}>{summary}</p>
                                )}
                                {topSkills.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                                        {topSkills.map(s => (
                                            <span key={s} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 'var(--pi-r-pill)', background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-btn-border)', color: 'var(--pi-secondary)' }}>{s}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                    {!profileUploading && (
                        <button className="pi-add-file-btn" onClick={browseResume}>
                            <Plus size={12} /> Replace file
                        </button>
                    )}
                </div>
            )}
            {profileError && (
                <div style={{ fontSize: 11, color: 'var(--pi-danger)', padding: '6px 10px', borderRadius: 6, background: 'var(--pi-danger-bg)', marginBottom: 12 }}>
                    {profileError}
                </div>
            )}

            {/* Job Description */}
            <h3 className="pi-section-label">Job Description</h3>
            {!profileData?.hasActiveJD && !jdUploading ? (
                <FileUploadEmpty
                    hint="Add a job description as real-time context."
                    uploading={jdUploading}
                    hasAccess={hasProfileAccess}
                    onBrowse={browseJD}
                    onNeedUpgrade={() => setIsPremiumModalOpen(true)}
                />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '13px 1fr 100px 20px', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-btn-border)', borderRadius: 'var(--pi-r-md)' }}>
                        <FileText size={13} style={{ color: 'var(--pi-secondary)', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--pi-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {profileData?.activeJD?.title
                                ? `${profileData.activeJD.title}${profileData.activeJD.company ? ` @ ${profileData.activeJD.company}` : ''}`
                                : 'Job Description'}
                        </span>
                        <PIIndexBadge status={jdUploadStatus} />
                        <button
                            className="pi-press-soft"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pi-tertiary)', padding: 4, display: 'flex', borderRadius: 4, transition: 'color 180ms ease' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--pi-danger)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--pi-tertiary)')}
                            onClick={async () => {
                                if (jdUploading) {
                                    jdAbortRef.current.cancelled = true;
                                    setJdUploading(false);
                                    setJdUploadStatus(undefined);
                                    return;
                                }
                                try {
                                    await window.electronAPI?.profileDeleteJD?.();
                                    const data = await window.electronAPI?.profileGetProfile?.();
                                    setProfileData(data ?? null);
                                    setCompanyDossier(null);
                                } catch { /**/ }
                            }}
                        >
                            <X size={12} />
                        </button>
                    </div>
                    {/* JD snapshot — shown once extraction is done */}
                    {profileData?.hasActiveJD && !jdUploading && profileData?.activeJD && (() => {
                        const jd = profileData.activeJD;
                        const reqs: string[] = (jd.requirements ?? []).slice(0, 3);
                        const techs: string[] = (jd.technologies ?? []).slice(0, 4);
                        return (
                            <div style={{ padding: '10px 12px', border: '1px solid var(--pi-border)', borderRadius: 'var(--pi-r-md)', background: 'rgba(255,255,255,0.015)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {jd.min_years_experience > 0 && (
                                        <span style={{ fontSize: 11, color: 'var(--pi-tertiary)' }}>{jd.min_years_experience}+ yrs</span>
                                    )}
                                    {jd.location && (
                                        <span style={{ fontSize: 11, color: 'var(--pi-tertiary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <Globe size={10} /> {jd.location}
                                        </span>
                                    )}
                                </div>
                                {jd.compensation_hint && (
                                    <div style={{ fontSize: 11, fontWeight: 600, color: '#34d399' }}>{jd.compensation_hint}</div>
                                )}
                                {reqs.length > 0 && (
                                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {reqs.map((r, i) => (
                                            <li key={i} style={{ fontSize: 11, color: 'var(--pi-secondary)', display: 'flex', alignItems: 'flex-start', gap: 5, lineHeight: 1.4 }}>
                                                <span style={{ color: 'var(--pi-accent)', flexShrink: 0, marginTop: 1 }}>·</span>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {techs.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                                        {techs.map(t => (
                                            <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 'var(--pi-r-pill)', background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-btn-border)', color: 'var(--pi-secondary)' }}>{t}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                    {!jdUploading && (
                        <button className="pi-add-file-btn" onClick={browseJD}>
                            <Plus size={12} /> Replace file
                        </button>
                    )}
                </div>
            )}
            {jdError && (
                <div style={{ fontSize: 11, color: 'var(--pi-danger)', padding: '6px 10px', borderRadius: 6, background: 'var(--pi-danger-bg)' }}>
                    {jdError}
                </div>
            )}

        </>
        );
    };

    const renderInsights = () => {
        // Empty state — no resume yet.
        if (!profileStatus.hasProfile) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileText size={18} style={{ color: 'var(--pi-accent)' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>No resume yet</div>
                        <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                            Add your resume in <strong style={{ color: 'var(--pi-primary)' }}>Identity</strong> and I'll summarize it here.
                        </div>
                    </div>
                </div>
            );
        }

        // ── Data (all optional; guard every access) ──
        const experienceCount: number = profileData?.experienceCount ?? 0;
        const experience: any[] = Array.isArray(profileData?.experience) ? profileData.experience : [];
        const education: any[] = Array.isArray(profileData?.education) ? profileData.education : [];
        const projects: any[] = Array.isArray(profileData?.projects) ? profileData.projects : [];
        const skills = profileData?.skills;
        const skillsFlat: string[] = Array.isArray(profileData?.skillsFlat) ? profileData.skillsFlat : [];

        // Sentence-case sub-block header — quieter than an all-caps micro-label.
        const sectionLabel: React.CSSProperties = {
            fontSize: 11, fontWeight: 600, color: 'var(--pi-secondary)', textTransform: 'none', letterSpacing: 'normal', marginBottom: 10,
        };
        // Small tertiary style kept for the skills-category sub-labels.
        const categoryLabel: React.CSSProperties = {
            fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--pi-tertiary)',
        };

        // Single hero stat — total experience. Display the precise decimal below 1
        // (e.g. "0.4 years") and round up once we cross the year mark — so the number
        // is always faithful and we never claim "Less than a year" for someone who
        // genuinely has 8 months or 0.6 years of recorded experience. Distinguish
        // "genuinely sub-year" from "years unknown": the backend can report roles
        // while omitting totalExperienceYears (degraded processing), and we must
        // not claim 0.X when we simply don't have the number.
        const yrs = profileStatus.totalExperienceYears;
        const yrsKnown = yrs != null && Number.isFinite(yrs);
        const rounded = heroYearsRounded ?? 0;
        // Hero display: rounded whole years when >= 1, precise 1-decimal value below.
        const heroDisplay = yrsKnown && rounded >= 1
            ? String(rounded)
            : (yrsKnown ? yrs!.toFixed(1) : '0');
        const roleClause = experienceCount > 0
            ? `${experienceCount} ${experienceCount === 1 ? 'role' : 'roles'}`
            : '';

        // Skills → categorized entries. Handle categorized object, array, or empty.
        const ACRONYMS: Record<string, string> = { ml: 'ML', ai: 'AI', ui: 'UI', ux: 'UX', qa: 'QA', devops: 'DevOps', db: 'DB' };
        const humanizeCategory = (raw: string) =>
            raw.replace(/_/g, ' ').replace(/\S+/g, w => ACRONYMS[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1)));
        // Cross-category dedupe (case-insensitive) so chip counts stay in sync with
        // the backend's already-deduped skillsFlat — a skill placed in two buckets by
        // the extractor renders once, and "+N more" never under/over-reports.
        const seenSkill = new Set<string>();
        const skillCategories: { name: string; items: string[] }[] = [];
        if (skills && !Array.isArray(skills) && typeof skills === 'object') {
            for (const [cat, items] of Object.entries(skills)) {
                if (!Array.isArray(items) || items.length === 0) continue;
                const uniqueItems = (items as string[]).filter(s => {
                    const key = String(s).toLowerCase();
                    if (seenSkill.has(key)) return false;
                    seenSkill.add(key);
                    return true;
                });
                if (uniqueItems.length > 0) {
                    skillCategories.push({ name: humanizeCategory(cat), items: uniqueItems });
                }
            }
        }
        const hasCategorizedSkills = skillCategories.length > 0;
        // Chip-cloud cap across all shown skills (~30).
        const SKILL_CAP = 30;
        let chipsUsed = 0;

        const fmtDate = (d: any) => (d == null || d === '' ? null : String(d));
        const dateRange = (start: any, end: any) => {
            const s = fmtDate(start);
            const e = fmtDate(end) ?? 'Present';
            if (!s && (e === 'Present')) return null;
            return `${s ?? '—'} – ${e}`;
        };

        const EXP_CAP = 6;
        const PROJ_CAP = 5;

        return (
            <>
                {/* Header */}
                <div className="pi-list-item" style={{ marginBottom: 24 }}>
                    <h3 className="pi-section-label" style={{ margin: 0 }}>Your profile</h3>
                    <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                        Pulled from your resume. This is what I'll draw on to help you answer questions during interviews.
                    </p>
                </div>

                {/* Quiet notice — only when the resume was read without AI */}
                {profileStatus.extractionMode === 'heuristic' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, padding: '10px 12px', borderRadius: 'var(--pi-r-md)', border: '1px solid rgba(245,158,11,0.20)', background: 'rgba(245,158,11,0.06)' }}>
                        <Info size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.5, flex: 1 }}>Read without AI, so some details may be missing.</span>
                        <button className="pi-pill-btn pi-press" style={{ flexShrink: 0 }} onClick={browseResume}><RefreshCw size={12} /> Re-upload</button>
                    </div>
                )}

                {/* Hero stat — total experience.
                    Shows precise decimal (e.g. "0.4") when sub-year, rounded whole
                    years once >= 1. The big number + label is the same component for
                    both ranges; we just toggle the displayed value. */}
                {yrsKnown ? (
                    <div className="pi-list-item" style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 28 }}>
                        <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--pi-hero)', fontVariantNumeric: 'tabular-nums' }}>{heroDisplay}</span>
                        <span style={{ fontSize: 13, color: 'var(--pi-secondary)' }}>
                            {heroDisplay === '1' ? 'year of experience' : 'years of experience'}
                            {roleClause && (
                                <span style={{ color: 'var(--pi-tertiary)' }}> · {roleClause}</span>
                            )}
                        </span>
                    </div>
                ) : roleClause ? (
                    <div className="pi-list-item" style={{ fontSize: 13, color: 'var(--pi-secondary)', marginBottom: 28 }}>
                        {roleClause}
                    </div>
                ) : null}

                {/* Experience */}
                {experience.length > 0 && (
                    <div className="pi-section-card">
                        <div className="pi-section-header">
                            <span className="pi-section-header-icon"><Briefcase size={12} /></span>
                            <h4 className="pi-section-header-label">Experience</h4>
                        </div>
                        <div className="pi-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {experience.slice(0, EXP_CAP).map((exp, i) => {
                                const range = dateRange(exp?.start_date, exp?.end_date);
                                return (
                                    <div key={i} className="pi-list-item" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                        <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pi-primary)' }}>{exp?.role || 'Role'}</span>
                                            {exp?.company && (
                                                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--pi-secondary)' }}> · {exp.company}</span>
                                            )}
                                        </div>
                                        {range && (
                                            <span style={{ fontSize: 11, color: 'var(--pi-tertiary)', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{range}</span>
                                        )}
                                    </div>
                                );
                            })}
                            {experience.length > EXP_CAP && (
                                <div className="pi-chip-overflow" style={{ fontSize: 11, color: 'var(--pi-tertiary)' }}>+{experience.length - EXP_CAP} more</div>
                            )}
                        </div>
                    </div>
                )}

                {/* Skills */}
                {(hasCategorizedSkills || skillsFlat.length > 0) && (
                    <div className="pi-section-card">
                        <div className="pi-section-header">
                            <span className="pi-section-header-icon"><Layers size={12} /></span>
                            <h4 className="pi-section-header-label">Skills</h4>
                        </div>
                        {hasCategorizedSkills ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {skillCategories.map(({ name, items }) => {
                                    if (chipsUsed >= SKILL_CAP) return null;
                                    const remaining = SKILL_CAP - chipsUsed;
                                    const shown = items.slice(0, remaining);
                                    chipsUsed += shown.length;
                                    return (
                                        <div key={name}>
                                            <div style={{ ...categoryLabel, marginBottom: 7 }}>{name}</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                                {shown.map(s => (
                                                    <span key={s} className="pi-chip">{s}</span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {chipsUsed < seenSkill.size && (
                                    <div className="pi-chip-overflow"><span className="pi-chip pi-chip--more">+{seenSkill.size - chipsUsed} more</span></div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                    {skillsFlat.slice(0, SKILL_CAP).map(s => (
                                        <span key={s} className="pi-chip">{s}</span>
                                    ))}
                                </div>
                                {skillsFlat.length > SKILL_CAP && (
                                    <div className="pi-chip-overflow"><span className="pi-chip pi-chip--more">+{skillsFlat.length - SKILL_CAP} more</span></div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Projects */}
                {projects.length > 0 && (
                    <div className="pi-section-card">
                        <div className="pi-section-header">
                            <span className="pi-section-header-icon"><FolderKanban size={12} /></span>
                            <h4 className="pi-section-header-label">Projects</h4>
                        </div>
                        <div className="pi-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {projects.slice(0, PROJ_CAP).map((proj, i) => {
                                const title = proj?.name || proj?.title;
                                const desc = proj?.description;
                                if (!title && !desc) return null;
                                return (
                                    <div key={i} className="pi-list-item" style={{ minWidth: 0 }}>
                                        {title && (
                                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pi-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                                        )}
                                        {desc && (
                                            <div style={{ fontSize: 11, color: 'var(--pi-secondary)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>
                                        )}
                                    </div>
                                );
                            })}
                            {projects.length > PROJ_CAP && (
                                <div className="pi-chip-overflow" style={{ fontSize: 11, color: 'var(--pi-tertiary)' }}>+{projects.length - PROJ_CAP} more</div>
                            )}
                        </div>
                    </div>
                )}

                {/* Education */}
                {education.length > 0 && (
                    <div className="pi-section-card">
                        <div className="pi-section-header">
                            <span className="pi-section-header-icon"><GraduationCap size={12} /></span>
                            <h4 className="pi-section-header-label">Education</h4>
                        </div>
                        <div className="pi-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {education.map((ed, i) => {
                                const primary = [ed?.degree, ed?.field ? `in ${ed.field}` : '']
                                    .filter(Boolean).join(' ');
                                const end = fmtDate(ed?.end_date);
                                if (!primary && !ed?.institution && !end) return null;
                                return (
                                    <div key={i} className="pi-list-item" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                                            {primary && (
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pi-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary}</div>
                                            )}
                                            {ed?.institution && (
                                                <div style={{ fontSize: 11, color: 'var(--pi-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ed.institution}</div>
                                            )}
                                        </div>
                                        {end && (
                                            <span style={{ fontSize: 11, color: 'var(--pi-tertiary)', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{end}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </>
        );
    };

    const renderTavily = () => (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 className="pi-section-label" style={{ margin: 0 }}>Tavily Search API</h3>
                {hasStoredTavilyKey && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', padding: '2px 7px', borderRadius: 4, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.20)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Check size={9} strokeWidth={2.5} /> Connected
                    </span>
                )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
                Powers live web search for company research. If not provided, LLM general knowledge is used (may be outdated).
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pi-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>API Key</label>
                {hasStoredTavilyKey && (
                    <button className="pi-pill-btn pi-pill-btn--danger pi-press" style={{ fontSize: 11, padding: '3px 8px' }} onClick={handleRemoveTavilyKey}>
                        <Trash2 size={10} /> Remove
                    </button>
                )}
            </div>
            <div className="pi-content-box" style={{ marginBottom: 8 }}>
                <input
                    type="password"
                    value={tavilyApiKey}
                    className="pi-input"
                    placeholder={hasStoredTavilyKey ? '••••••••••••••••' : 'tvly-...'}
                    onChange={e => { setTavilyApiKey(e.target.value); setTavilyError(''); }}
                />
            </div>
            {tavilyError && <p style={{ fontSize: 11, color: 'var(--pi-danger)', margin: '0 0 8px' }}>{tavilyError}</p>}
            <button
                className="pi-pill-btn pi-press"
                style={{ width: '100%', justifyContent: 'center', padding: '8px 12px', borderRadius: 9 }}
                disabled={tavilySaving || !tavilyApiKey.trim()}
                onClick={async () => {
                    if (!tavilyApiKey.trim()) return;
                    setTavilyError(''); setTavilySaving(true);
                    try {
                        const result = await window.electronAPI?.setTavilyApiKey?.(tavilyApiKey.trim());
                        if (result && !result.success) { setTavilyError(result.error ?? 'Failed to save API key.'); }
                        else { setHasStoredTavilyKey(true); setTavilyApiKey(''); }
                    } catch (e: any) { setTavilyError(e?.message ?? 'Unexpected error.'); }
                    finally { setTavilySaving(false); }
                }}
            >
                {tavilySaving ? <><RefreshCw size={12} className="pi-spinner" /> Saving…</> : 'Save API Key'}
            </button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-border)' }}>
                <Info size={12} style={{ color: 'var(--pi-tertiary)', flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: 'var(--pi-tertiary)', margin: 0, lineHeight: 1.6 }}>
                    Get your free key at{' '}
                    <span style={{ color: '#22c55e', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(34,197,94,0.4)', textUnderlineOffset: 2 }}
                        onClick={() => window.electronAPI?.openExternal?.('https://app.tavily.com/home')}>
                        app.tavily.com
                    </span>. Keys start with <code style={{ fontSize: 11, color: '#22c55e' }}>tvly-</code>.
                </p>
            </div>
        </>
    );

    const renderCompany = () => {
        const hasJD = !!profileData?.hasActiveJD;
        const companyName = profileData?.activeJD?.company?.trim();

        // Empty-state branches — this tab is always visible (Cover Letter parity).
        // Company research keys off the active JD's company, not the resume.
        if (!hasJD) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(217,167,232,0.08)', border: '1px solid rgba(217,167,232,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Building2 size={18} style={{ color: '#D9A7E8' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>No job description yet</div>
                        <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                            Upload a job description in <strong style={{ color: 'var(--pi-primary)' }}>Identity</strong> so I can research the target company.
                        </div>
                    </div>
                </div>
            );
        }
        if (!companyName) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(217,167,232,0.08)', border: '1px solid rgba(217,167,232,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Building2 size={18} style={{ color: '#D9A7E8' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>Company name not detected</div>
                        <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                            Your JD didn't name a company clearly. Re-upload a JD with the company in the first few lines, or ask for company research directly.
                        </div>
                    </div>
                </div>
            );
        }
        const loaded = !!companyDossier;
        return (
            <>
                {/* Header — Refresh pill sits next to the title once the dossier is
                    loaded (Cover Letter parity). In the empty state, the CTA stays
                    inline inside its own card via the "Research Now" button below. */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                        <h3 className="pi-section-label" style={{ margin: 0 }}>Company Intel</h3>
                        <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                            Culture, salary, hiring signal and interview difficulty for {companyName}.
                        </p>
                    </div>
                    {loaded && (
                        <button className="pi-pill-btn pi-press" disabled={companyResearching} onClick={doCompanyResearch}>
                            <RefreshCw size={12} className={companyResearching ? 'pi-spinner' : ''} />
                            {companyResearching ? 'Refreshing' : 'Refresh'}
                        </button>
                    )}
                </div>

                {companySearchQuotaExhausted && (
                    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: 12, fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
                        <span style={{ flexShrink: 0 }}>⚠</span>
                        Web search credits exhausted — showing AI-only research.
                    </div>
                )}
                {!companyDossier && !companyResearching && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(217,167,232,0.08)', border: '1px solid rgba(217,167,232,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Building2 size={18} style={{ color: '#D9A7E8' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>Ready to research</div>
                            <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                                Hiring strategy, interview focus, salary signals and culture for <strong style={{ color: 'var(--pi-primary)' }}>{companyName}</strong>.
                            </div>
                        </div>
                        <button
                            className="pi-pill-btn pi-press"
                            style={{ color: '#D9A7E8', borderColor: 'rgba(217,167,232,0.25)', background: 'rgba(217,167,232,0.08)', fontWeight: 600, padding: '8px 20px' }}
                            onClick={doCompanyResearch}
                        >
                            Research Now
                        </button>
                    </div>
                )}
                {companyResearching && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Work Culture skeleton — overall rating + 4 sub-ratings grid.
                            Card shell is solid (no pulse); only the inner text placeholders breathe. */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Work Culture</div>
                            <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, padding: '12px 14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--pi-border)' }}>
                                    <div className="pi-skeleton" style={{ height: 18, width: 64, borderRadius: 4 }} />
                                    <div className="pi-skeleton" style={{ height: 14, width: 70, borderRadius: 4 }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                                    {[1, 2, 3, 4].map(i => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                            <div className="pi-skeleton" style={{ height: 9, width: 80, borderRadius: 3 }} />
                                            <div className="pi-skeleton" style={{ height: 9, width: 56, borderRadius: 3 }} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Salary Estimates skeleton — list of role rows */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Salary Estimates</div>
                            <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, overflow: 'hidden' }}>
                                {[1, 2].map(i => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                                        padding: '10px 14px',
                                        borderBottom: i < 1 ? '1px solid var(--pi-border)' : 'none',
                                    }}>
                                        <div className="pi-skeleton" style={{ height: 10, width: 180, borderRadius: 3 }} />
                                        <div className="pi-skeleton" style={{ height: 10, width: 120, borderRadius: 3 }} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Hiring Strategy skeleton — prose block.
                            Card shell solid, 3 line placeholders inside breathe like real text lines. */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Hiring Strategy</div>
                            <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div className="pi-skeleton" style={{ height: 9, width: '95%', borderRadius: 3 }} />
                                <div className="pi-skeleton" style={{ height: 9, width: '88%', borderRadius: 3 }} />
                                <div className="pi-skeleton" style={{ height: 9, width: '60%', borderRadius: 3 }} />
                            </div>
                        </div>

                        {/* Interview Focus skeleton — prose block + difficulty bar */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Interview Focus</div>
                            <div style={{ borderRadius: 8, border: '1px solid var(--pi-border)', padding: '10px 12px' }}>
                                <div className="pi-skeleton" style={{ height: 10, width: '95%', borderRadius: 3, marginBottom: 6 }} />
                                <div className="pi-skeleton" style={{ height: 10, width: '70%', borderRadius: 3 }} />
                                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--pi-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <div className="pi-skeleton" style={{ height: 9, width: 56, borderRadius: 3 }} />
                                        <div className="pi-skeleton" style={{ height: 10, width: 48, borderRadius: 3 }} />
                                    </div>
                                    <div style={{ height: 6, borderRadius: 3, background: 'var(--pi-btn-bg)', overflow: 'hidden' }}>
                                        <div className="pi-skeleton" style={{ height: '100%', width: '60%', borderRadius: 3 }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Benefits skeleton — chip-row */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <Gift size={11} style={{ color: '#22c55e' }} />
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Benefits</div>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="pi-skeleton" style={{ height: 22, width: 60 + (i * 12), borderRadius: 20 }} />
                                ))}
                            </div>
                        </div>

                        {/* Core Values skeleton — chip-row (purple pills like the real section) */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Core Values</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="pi-skeleton" style={{ height: 22, width: 70 + (i * 14), borderRadius: 20 }} />
                                ))}
                            </div>
                        </div>

                        {/* Common Complaints skeleton — prose-card stack */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <AlertCircle size={11} style={{ color: '#fb923c' }} />
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Common Complaints</div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {[1, 2].map(i => (
                                    <div key={i} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pi-border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                            <div className="pi-skeleton" style={{ height: 11, width: 90, borderRadius: 3 }} />
                                            <div className="pi-skeleton" style={{ height: 9, width: 50, borderRadius: 3 }} />
                                        </div>
                                        <div className="pi-skeleton" style={{ height: 9, width: '90%', borderRadius: 3, marginBottom: 4 }} />
                                        <div className="pi-skeleton" style={{ height: 9, width: '70%', borderRadius: 3 }} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recent News skeleton — prose block.
                            Card shell solid, two line placeholders breathe like real text lines. */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Recent News</div>
                            <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div className="pi-skeleton" style={{ height: 9, width: '90%', borderRadius: 3 }} />
                                <div className="pi-skeleton" style={{ height: 9, width: '70%', borderRadius: 3 }} />
                            </div>
                        </div>

                        {/* Source-of-truth disclaimer — green "Scraped / Live Web Data" when
                            Tavily ran, amber "LLM-Generated / Training Data Only" otherwise. */}
                        <div style={{ border: '1px solid rgba(217,167,232,0.14)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="pi-skeleton" style={{ height: 11, width: 11, borderRadius: '50%', flexShrink: 0 }} />
                            <div className="pi-skeleton" style={{ height: 9, width: '70%', borderRadius: 3 }} />
                        </div>
                    </div>
                )}
                {companyDossier && !companyResearching && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {companyDossier.culture_ratings && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Work Culture</div>
                                <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, padding: '12px 14px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--pi-border)' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                                <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--pi-hero)', fontVariantNumeric: 'tabular-nums' }}>{companyDossier.culture_ratings.overall?.toFixed(1)}</span>
                                                <span style={{ fontSize: 14, color: 'var(--pi-tertiary)' }}> / 5</span>
                                            </div>
                                            {companyDossier.culture_ratings.review_count && (
                                                <div style={{ fontSize: 10, color: 'var(--pi-tertiary)', marginTop: 4 }}>{companyDossier.culture_ratings.review_count}</div>
                                            )}
                                        </div>
                                        <StarRating value={companyDossier.culture_ratings.overall} size={14} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                                        {[
                                            { label: 'Work-Life Balance', key: 'work_life_balance' },
                                            { label: 'Career Growth', key: 'career_growth' },
                                            { label: 'Compensation', key: 'compensation' },
                                            { label: 'Management', key: 'management' },
                                        ].map(({ label, key }) => {
                                            const val = typeof (companyDossier.culture_ratings as any)[key] === 'number' ? (companyDossier.culture_ratings as any)[key] : 0;
                                            return val > 0 ? (
                                                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                    <span style={{ fontSize: 12, color: 'var(--pi-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                                        <StarRating value={val} size={11} />
                                                        <span style={{ fontSize: 12, color: 'var(--pi-secondary)', fontWeight: 500 }}>{val.toFixed(1)}</span>
                                                    </div>
                                                </div>
                                            ) : null;
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                        {companyDossier.salary_estimates?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Salary Estimates</div>
                                <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, overflow: 'hidden' }}>
                                    {companyDossier.salary_estimates.map((s: any, i: number) => {
                                        // Confidence is now encoded by the amount's color + weight
                                        // instead of a separate badge that gets orphaned when the row
                                        // is long. high = solid, medium = 65% opacity, low = 45%.
                                        const confOpacity = s.confidence === 'high' ? 1 : s.confidence === 'medium' ? 0.65 : 0.45;
                                        return (
                                            <div key={i} style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                                                padding: '10px 14px',
                                                borderBottom: i < companyDossier.salary_estimates.length - 1 ? '1px solid var(--pi-border)' : 'none',
                                            }}>
                                                <span style={{ fontSize: 12, color: 'var(--pi-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {s.title} <span style={{ color: 'var(--pi-tertiary)' }}>({s.location})</span>
                                                </span>
                                                <span style={{
                                                    fontSize: 12, fontWeight: 700,
                                                    color: '#22c55e',
                                                    opacity: confOpacity,
                                                    flexShrink: 0, fontVariantNumeric: 'tabular-nums' as const,
                                                }}>
                                                    {s.currency} {s.min?.toLocaleString()} – {s.max?.toLocaleString()}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {companyDossier.hiring_strategy && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Hiring Strategy</div>
                                <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-border)' }}>
                                    {companyDossier.hiring_strategy}
                                </p>
                            </div>
                        )}
                        {companyDossier.interview_focus && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Interview Focus</div>
                                <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-border)' }}>
                                    {companyDossier.interview_focus}
                                    {/* Difficulty progress bar — sits inline at the bottom of the
                                        description card so the rating lives with the text it qualifies.
                                        Fill % = (level index + 1) / 4 * 100. Track is muted, filled
                                        portion is the level's accent color. Active level label
                                        (Easy / Medium / Hard / Extreme) is shown in the header row
                                        above the bar — no per-step labels under the bar. */}
                                    {companyDossier.interview_difficulty && (() => {
                                        const LEVEL: Array<{ key: string; label: string; color: string }> = [
                                            { key: 'easy',      label: 'Easy',    color: '#22c55e' },
                                            { key: 'medium',    label: 'Medium',  color: '#f59e0b' },
                                            { key: 'hard',      label: 'Hard',    color: '#fb923c' },
                                            { key: 'very_hard', label: 'Extreme', color: '#ef4444' },
                                        ];
                                        const idx = LEVEL.findIndex(l => l.key === companyDossier.interview_difficulty);
                                        const current = idx >= 0 ? LEVEL[idx] : LEVEL[1];
                                        const fillPct = idx >= 0 ? ((idx + 1) / LEVEL.length) * 100 : 50;
                                        return (
                                            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--pi-border)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--pi-tertiary)' }}>Difficulty</span>
                                                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: current.color }}>{current.label}</span>
                                                </div>
                                                <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--pi-btn-bg)', overflow: 'hidden' }}>
                                                    <div style={{
                                                        position: 'absolute', top: 0, bottom: 0, left: 0,
                                                        width: `${fillPct}%`,
                                                        background: current.color,
                                                        borderRadius: 3,
                                                        transition: 'width 360ms cubic-bezier(0.23, 1, 0.32, 1)',
                                                    }} />
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </p>
                            </div>
                        )}
                        {companyDossier.benefits?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Benefits</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {companyDossier.benefits.map((b: string, i: number) => (
                                        <span key={i} style={{ fontSize: 11, color: '#34d399', padding: '3px 10px', borderRadius: 20, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.18)' }}>{b}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {companyDossier.core_values?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Core Values</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {companyDossier.core_values.map((v: string, i: number) => (
                                        <span key={i} style={{ fontSize: 11, color: '#D9A7E8', padding: '3px 10px', borderRadius: 20, background: 'rgba(217,167,232,0.08)', border: '1px solid rgba(217,167,232,0.18)' }}>{v}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {companyDossier.critics?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Common Complaints</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {companyDossier.critics.map((c: any, i: number) => (
                                        <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-border)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <span style={{ fontSize: 11, fontWeight: 600, color: '#fb923c' }}>{c.category}</span>
                                                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: 'var(--pi-tertiary)' }}>{c.frequency}</span>
                                            </div>
                                            <p style={{ fontSize: 11, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.5 }}>{c.complaint}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {companyDossier.recent_news && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Recent News</div>
                                <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-border)' }}>
                                    {companyDossier.recent_news}
                                </p>
                            </div>
                        )}
                        {(() => {
                            // Two truths about a Company Intel dossier:
                            //   1. dossier.sources.length > 0  → live web scrape ran
                            //      (Tavily hit, page text fetched, LLM summarized over real URLs).
                            //   2. dossier.sources.length === 0 → LLM-only dossier
                            //      (no search provider, quota exhausted, OR all searches returned empty).
                            // The disclaimer must reflect which world the user is reading.
                            const sourcesLen: number = Array.isArray(companyDossier?.sources)
                                ? companyDossier.sources.length
                                : 0;
                            const isLive = sourcesLen > 0;
                            const accent = isLive ? '#34d399' : '#f59e0b';
                            const accentBg = isLive ? 'rgba(52,211,153,0.12)' : 'rgba(245,158,11,0.12)';
                            const accentBorder = isLive ? 'rgba(52,211,153,0.22)' : 'rgba(245,158,11,0.22)';
                            const cardBg = isLive ? 'rgba(52,211,153,0.06)' : 'rgba(245,158,11,0.06)';
                            const cardBorder = isLive ? 'rgba(52,211,153,0.18)' : 'rgba(245,158,11,0.18)';
                            return (
                                <div style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 10,
                                    padding: '12px 14px', borderRadius: 'var(--pi-r-md)',
                                    background: cardBg, border: `1px solid ${cardBorder}`,
                                }}>
                                    <span style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 24, height: 24, borderRadius: 'var(--pi-r-sm)',
                                        background: accentBg, color: accent, flexShrink: 0,
                                    }}>
                                        <AlertTriangle size={12} strokeWidth={2.25} />
                                    </span>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                            <span style={{
                                                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                                                textTransform: 'uppercase' as const,
                                                color: accent,
                                                padding: '1px 6px', borderRadius: 999,
                                                background: accentBg,
                                                border: `1px solid ${accentBorder}`,
                                            }}>{isLive ? 'Scraped' : 'LLM-Generated'}</span>
                                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--pi-secondary)' }}>
                                                {isLive ? 'Live Web Data' : 'Training Data Only'}
                                            </span>
                                        </div>
                                        <p style={{ fontSize: 11.5, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.55 }}>
                                            {isLive
                                                ? 'Compiled from recent web sources. Verify before relying on it.'
                                                : 'No live search ran — figures come from general knowledge and may be outdated.'}
                                        </p>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </>
        );
    };

    const renderNegotiation = () => {
        const doGenerate = async (regen: boolean) => {
            setNegotiationGenerating(true); setNegotiationError('');
            try {
                const result = await window.electronAPI?.profileGenerateNegotiation?.(regen);
                if (result?.success && result.script) setNegotiationScript(result.script);
                else setNegotiationError(result?.error || 'Generation failed');
            } catch { setNegotiationError('Generation failed'); }
            finally { setNegotiationGenerating(false); }
        };

        const STEPS = [
            { step: '01', label: 'Opening',        hint: 'When asked about salary',      field: 'opening_line',          accent: '#10b981', bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.16)'  },
            { step: '02', label: 'Justify',         hint: 'Link your record to the ask',  field: 'justification',          accent: '#818cf8', bg: 'rgba(129,140,248,0.06)', border: 'rgba(129,140,248,0.16)' },
            { step: '03', label: 'Counter & Hold',  hint: 'If they push back',            field: 'counter_offer_fallback', accent: '#fb923c', bg: 'rgba(251,146,60,0.06)',  border: 'rgba(251,146,60,0.16)'  },
        ];

        return (
            <>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                        <h3 className="pi-section-label" style={{ margin: 0 }}>Negotiation Script</h3>
                        <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                            AI-crafted salary negotiation based on your resume & JD.
                        </p>
                    </div>
                    {negotiationScript && (
                        <button className="pi-pill-btn pi-press" disabled={negotiationGenerating} onClick={() => doGenerate(true)}>
                            <RefreshCw size={12} className={negotiationGenerating ? 'pi-spinner' : ''} />
                            Regenerate
                        </button>
                    )}
                </div>

                {/* Error */}
                {negotiationError && (
                    <div style={{ fontSize: 11, color: 'var(--pi-danger)', padding: '8px 12px', borderRadius: 8, background: 'var(--pi-danger-bg)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertCircle size={12} style={{ flexShrink: 0 }} /> {negotiationError}
                    </div>
                )}

                {/* Skeleton while generating fresh */}
                {negotiationGenerating && !negotiationScript && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* salary skeleton */}
                        <div className="pi-skeleton" style={{ height: 72, borderRadius: 10, background: 'var(--pi-btn-bg)' }} />
                        {/* step skeletons */}
                        {[1,2,3].map(i => (
                            <div key={i} className="pi-skeleton" style={{ height: 88, borderRadius: 10, background: 'var(--pi-btn-bg)', opacity: 1 - i * 0.12 }} />
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {!negotiationScript && !negotiationGenerating && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Gift size={18} style={{ color: '#34d399' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>Ready to negotiate</div>
                            <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                                Generate a personalised salary script with opening line, justification, and counter-offer phrasing.
                            </div>
                        </div>
                        <button
                            className="pi-pill-btn pi-press"
                            style={{ color: '#34d399', borderColor: 'rgba(52,211,153,0.25)', background: 'rgba(52,211,153,0.08)', fontWeight: 600, padding: '8px 20px' }}
                            onClick={() => doGenerate(false)}
                        >
                            Generate Script
                        </button>
                    </div>
                )}

                {/* Script output */}
                {negotiationScript && (
                    <div style={{ opacity: negotiationGenerating ? 0.45 : 1, transition: 'opacity 0.3s', pointerEvents: negotiationGenerating ? 'none' : 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>

                        {/* Salary range card */}
                        {negotiationScript.salary_range && (() => {
                            const { currency, min, max } = negotiationScript.salary_range;
                            const prefix = currency ? `${currency} ` : '';
                            const range = `${prefix}${min?.toLocaleString()} – ${max?.toLocaleString()}`;
                            return (
                                <div style={{ borderRadius: 12, padding: '14px 18px', background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-btn-border)', marginBottom: 2 }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--pi-tertiary)', marginBottom: 6 }}>Target Compensation</div>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: '#34d399', letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap' }}>
                                        {range}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Step cards */}
                        {STEPS.filter(s => negotiationScript[s.field]).map(s => {
                            const text = (negotiationScript[s.field] as string).replace(/^["'"']+|["'"']+$/g, '').trim();
                            return (
                                <div key={s.step} style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${s.border}`, background: s.bg }}>
                                    {/* Card header */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: `1px solid ${s.border}` }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: s.accent, background: `${s.accent}18`, padding: '2px 7px', borderRadius: 20 }}>
                                                {s.step}
                                            </span>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)' }}>{s.label}</span>
                                            <span style={{ fontSize: 11, color: 'var(--pi-tertiary)' }}>· {s.hint}</span>
                                        </div>
                                        <button
                                            onClick={() => navigator.clipboard?.writeText(text)}
                                            className="pi-press-soft"
                                            style={{ fontSize: 11, color: 'var(--pi-tertiary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6 }}
                                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--pi-primary)')}
                                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--pi-tertiary)')}
                                        >
                                            <Check size={11} /> Copy
                                        </button>
                                    </div>
                                    {/* Quote body */}
                                    <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--pi-primary)', padding: '12px 14px', margin: 0, fontStyle: s.step !== '02' ? 'italic' : 'normal' }}>
                                        {text}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </>
        );
    };

    const renderCoverLetter = () => {
        const doGenerate = async (regen: boolean) => {
            setCoverLetterGenerating(true); setCoverLetterError('');
            try {
                const result = await window.electronAPI?.profileGenerateCoverLetter?.(regen);
                if (result?.success && result.letter) setCoverLetter(result.letter);
                else setCoverLetterError(result?.error || 'Generation failed');
            } catch { setCoverLetterError('Generation failed'); }
            finally { setCoverLetterGenerating(false); }
        };

        // Three prerequisite gates — the cached cover letter is meaningless once
        // the user clears the resume or active JD, since regeneration would re-need
        // them anyway. We hide both the output card AND the Regenerate button
        // whenever the prerequisites drop, so the empty-state copy is the only thing
        // the user sees.
        const hasResume = !!profileStatus.hasProfile;
        const hasJD = !!profileData?.hasActiveJD;
        const prerequisitesMet = hasResume && hasJD;
        // A previously-cached letter only stays visible when its inputs still exist.
        const letterRenderable = !!coverLetter && prerequisitesMet;
        // Show the skeleton any time we're generating AND prerequisites are met —
        // both the first generation (no letter yet) AND regeneration (existing
        // letter). The previous !coverLetter gate suppressed the skeleton during
        // regeneration, which made the panel feel blank mid-cycle.
        const showSkeleton = coverLetterGenerating && prerequisitesMet;
        const showGenerateCTA = !coverLetter && !coverLetterGenerating && prerequisitesMet;
        // The output card is replaced by the skeleton during generation. When
        // generating finishes (success or error), the new letter (or empty
        // state + error banner) takes over.
        const showOutput = letterRenderable && !coverLetterGenerating;

        return (
            <>
                {/* Header — Regenerate button gated by prerequisitesMet so we don't
                    offer to "regenerate" something whose inputs no longer exist. */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                        <h3 className="pi-section-label" style={{ margin: 0 }}>Cover Letter</h3>
                        <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                            A tailored letter from your resume and this job description.
                        </p>
                    </div>
                    {showOutput && (
                        <button className="pi-pill-btn pi-press" onClick={() => doGenerate(true)}>
                            <RefreshCw size={12} className={coverLetterGenerating ? 'pi-spinner' : ''} />
                            Regenerate
                        </button>
                    )}
                </div>

                {/* Error */}
                {coverLetterError && (
                    <div style={{ fontSize: 11, color: 'var(--pi-danger)', padding: '8px 12px', borderRadius: 8, background: 'var(--pi-danger-bg)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertCircle size={12} style={{ flexShrink: 0 }} /> {coverLetterError}
                    </div>
                )}

                {/* Skeleton while generating fresh — prose-only layout (no address furniture).
                    Each placeholder rect breathes; the card shell stays solid. */}
                {showSkeleton && (
                    <div>
                        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(96,165,250,0.18)', background: 'rgba(96,165,250,0.04)' }}>
                            {/* Header row */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: '1px solid rgba(96,165,250,0.18)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div className="pi-skeleton" style={{ height: 12, width: 50, borderRadius: 20 }} />
                                    <div className="pi-skeleton" style={{ height: 13, width: 110, borderRadius: 3 }} />
                                    <div className="pi-skeleton" style={{ height: 11, width: 90, borderRadius: 3 }} />
                                </div>
                                <div className="pi-skeleton" style={{ height: 11, width: 96, borderRadius: 3 }} />
                            </div>
                            {/* Prose body — greeting + 1-2 paragraph placeholders + closing */}
                            <div style={{ padding: '14px 18px' }}>
                                <div className="pi-skeleton" style={{ height: 11, width: '40%', borderRadius: 3, marginBottom: 12 }} />
                                <div className="pi-skeleton" style={{ height: 11, width: '92%', borderRadius: 3, marginBottom: 6 }} />
                                <div className="pi-skeleton" style={{ height: 11, width: '88%', borderRadius: 3, marginBottom: 6 }} />
                                <div className="pi-skeleton" style={{ height: 11, width: '70%', borderRadius: 3, marginBottom: 14 }} />
                                <div className="pi-skeleton" style={{ height: 11, width: '85%', borderRadius: 3, marginBottom: 6 }} />
                                <div className="pi-skeleton" style={{ height: 11, width: '55%', borderRadius: 3, marginBottom: 14 }} />
                                <div className="pi-skeleton" style={{ height: 11, width: '65%', borderRadius: 3 }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Empty: no resume yet — always wins over any cached letter */}
                {!hasResume && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={18} style={{ color: '#60a5fa' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>No resume yet</div>
                            <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                                Upload your resume in <strong style={{ color: 'var(--pi-primary)' }}>Identity</strong> first — cover letters are tailored from it.
                            </div>
                        </div>
                    </div>
                )}

                {/* Empty: resume present, no active JD yet */}
                {hasResume && !hasJD && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={18} style={{ color: '#60a5fa' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>No job description yet</div>
                            <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                                Upload a job description in <strong style={{ color: 'var(--pi-primary)' }}>Identity</strong> so the letter can be tailored to the role.
                            </div>
                        </div>
                    </div>
                )}

                {/* Empty: resume + JD present, no letter generated yet */}
                {showGenerateCTA && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', border: '1px dashed var(--pi-border)', borderRadius: 12, gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={18} style={{ color: '#60a5fa' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)', marginBottom: 4 }}>Ready to write</div>
                            <div style={{ fontSize: 12, color: 'var(--pi-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
                                Generate a personalised cover letter from your resume and this job description.
                            </div>
                        </div>
                        <button
                            className="pi-pill-btn pi-press"
                            style={{ color: '#60a5fa', borderColor: 'rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.08)', fontWeight: 600, padding: '8px 20px' }}
                            onClick={() => doGenerate(false)}
                        >
                            Generate Letter
                        </button>
                    </div>
                )}

                {/* Letter output — gated by showOutput so the cached letter
                    disappears once its prerequisites (resume + active JD) drop. */}
                {showOutput && (
                    <div style={{ opacity: coverLetterGenerating ? 0.45 : 1, transition: 'opacity 0.3s', pointerEvents: coverLetterGenerating ? 'none' : 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Single continuous letter card — prose, not discrete step-cards like negotiation */}
                        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(96,165,250,0.18)', background: 'rgba(96,165,250,0.04)' }}>
                            {/* Card header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: '1px solid rgba(96,165,250,0.18)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#60a5fa', background: 'rgba(96,165,250,0.12)', padding: '2px 7px', borderRadius: 20 }}>
                                        COVER
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pi-primary)' }}>Tailored Letter</span>
                                    <span style={{ fontSize: 11, color: 'var(--pi-tertiary)' }}>· for {profileData?.activeJD?.title ? `${profileData.activeJD.title}${profileData.activeJD.company ? ` @ ${profileData.activeJD.company}` : ''}` : 'this role'}</span>
                                </div>
                                <button
                                    onClick={() => navigator.clipboard?.writeText(coverLetter.full_text || '')}
                                    className="pi-press-soft"
                                    style={{ fontSize: 11, color: 'var(--pi-tertiary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6 }}
                                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--pi-primary)')}
                                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--pi-tertiary)')}
                                >
                                    <Check size={11} /> Copy Full Letter
                                </button>
                            </div>
                            {/* Letter body — prose-only flow: salutation → opening
                                hook → body paragraphs → closing. The formal-letter
                                furniture (sender block, date, recipient block,
                                signature) is still produced by the LLM on the engine
                                side and stitched into full_text for the rare case
                                someone copies + pastes the whole blob — but it
                                isn't rendered here, since the user just wants the
                                letter content. */}
                            <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.7, color: 'var(--pi-primary)' }}>
                                {/* Salutation */}
                                {coverLetter.greeting && (
                                    <p style={{ margin: '0 0 12px' }}>{coverLetter.greeting}</p>
                                )}
                                {/* Opening hook (slight visual emphasis) */}
                                {coverLetter.opening_hook && (
                                    <p style={{ margin: '0 0 12px', fontWeight: 500 }}>{coverLetter.opening_hook}</p>
                                )}
                                {/* Body paragraphs */}
                                {Array.isArray(coverLetter.body_paragraphs) && coverLetter.body_paragraphs.map((p: string, i: number) => (
                                    <p key={i} style={{ margin: '0 0 12px' }}>{p}</p>
                                ))}
                                {/* Closing line — whiteSpace: pre-line so the embedded
                                    double-newline separating the thank-you paragraph
                                    from the candidate's name renders as a blank line +
                                    the name on its own row inside this single <p>. */}
                                {coverLetter.closing && (
                                    <p style={{ margin: '12px 0 0', whiteSpace: 'pre-line' }}>{coverLetter.closing}</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    };

    const SECTION_RENDERERS: Record<string, () => React.ReactNode> = {
        identity: renderIdentity,
        insights: renderInsights,
        tavily: renderTavily,
        company: renderCompany,
        negotiation: renderNegotiation,
        coverletter: renderCoverLetter,
    };

    // ── CTA class ─────────────────────────────────────────────────────────────
    const ctaClass = [
        'pi-cta',
        isTrialActive && !isPremium  ? 'pi-cta--trial'   : '',
        !isPremium && !isTrialActive  ? 'pi-cta--shimmer' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className="pi-root"
            data-theme={theme}
            style={{
                display: 'flex', height: '100%', background: 'var(--pi-bg)',
                borderRadius: 16, overflow: 'hidden',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
                WebkitFontSmoothing: 'antialiased', color: 'var(--pi-primary)',
            } as React.CSSProperties}
        >
            <style>{PI_CSS}</style>

            {/* ── Sidebar ── */}
            <div style={{
                width: 220, borderRight: '1px solid var(--pi-border)',
                display: 'flex', flexDirection: 'column', flexShrink: 0,
                background: 'var(--pi-sidebar-bg)', paddingTop: 12,
                boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
            }}>
                {/* Close */}
                <button onClick={onClose} className="pi-close-btn" style={{ marginLeft: 8, marginBottom: 4 }} title="Close">
                    <X size={15} />
                </button>

                {/* Header */}
                <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--pi-hero)', margin: 0, letterSpacing: '0.01em', textTransform: 'uppercase' as const }}>Profile Intelligence</h2>
                </div>

                {/* Nav — position:relative for sliding indicator */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px', position: 'relative' }}>
                    {/* Sliding selection indicator — first child so it renders behind items */}
                    <div
                        className="pi-sel-indicator"
                        data-instant={!indicatorState.ready}
                        style={{
                            top: indicatorState.top,
                            height: indicatorState.height,
                            opacity: indicatorState.visible ? 1 : 0,
                        }}
                    />

                    {visibleNav.map(({ id, label, Icon }) => (
                        <div
                            key={id}
                            ref={el => {
                                if (el) navItemRefs.current.set(id, el);
                                else navItemRefs.current.delete(id);
                            }}
                            className={`pi-nav-item${activeSection === id ? ' active' : ''}`}
                            onClick={() => setActiveSection(id)}
                        >
                            <Icon size={15} />
                            <span>{label}</span>
                        </div>
                    ))}
                </div>

                {/* CTA footer */}
                <div style={{ padding: '12px', borderTop: '1px solid var(--pi-border)', flexShrink: 0 }}>
                    <button
                        onClick={() => setIsPremiumModalOpen(true)}
                        className={ctaClass}
                        style={{ width: '100%' }}
                        aria-label={isPremium ? 'Manage Pro' : 'Unlock Pro'}
                    >
                        <span style={{ flex: 1, textAlign: 'left', position: 'relative', zIndex: 1 }}>
                            {isPremium ? 'Manage Pro' : isTrialActive ? 'Upgrade' : 'Unlock Pro'}
                        </span>
                        <div className="pi-cta-ring">
                            {isPremium
                                ? <CheckCircle size={13} strokeWidth={2.5} />
                                : isTrialActive
                                    ? <Sparkles size={13} strokeWidth={2.5} />
                                    : <ArrowUpRight size={13} strokeWidth={2.5} />}
                        </div>
                    </button>
                </div>
            </div>

            {/* ── Right panel ── */}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Scrollable content — key triggers blur-fade animation on each switch */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', boxSizing: 'border-box' }}>
                    <div key={activeSection} className="pi-panel-fade">
                        {(SECTION_RENDERERS[activeSection] ?? renderIdentity)()}
                    </div>
                </div>
            </div>

            <PremiumUpgradeModal
                isOpen={isPremiumModalOpen}
                onClose={() => setIsPremiumModalOpen(false)}
                isPremium={isPremium}
                onActivated={async () => {
                    setIsPremium(true);
                    try {
                        const details = await window.electronAPI?.licenseGetDetails?.();
                        const plan = details?.plan ?? '';
                        if (plan) setPremiumPlan(plan);
                        writePremiumCache(true, plan);
                    } catch { writePremiumCache(true, premiumPlan); }
                    const status = await window.electronAPI?.profileGetStatus?.();
                    if (status) setProfileStatus(status);
                }}
                onDeactivated={() => {
                    setIsPremium(false); setPremiumPlan('');
                    writePremiumCache(false, '');
                    setProfileStatus(prev => ({ ...prev, profileMode: false }));
                }}
            />
        </div>
    );
}
