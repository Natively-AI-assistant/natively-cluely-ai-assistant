import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
    X, RefreshCw, Upload, Briefcase, Trash2, Check, Globe,
    Building2, Search, AlertCircle, Gift, Info, Star, Sparkles,
    User, CheckCircle, ArrowUpRight, Pencil, Paperclip, Plus, FileText,
} from 'lucide-react';
import { PremiumUpgradeModal } from '../premium';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

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
    }

    /* ── Keyframes ── */
    @keyframes pi-list-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes pi-panel-fade {
        from { opacity: 0; transform: translateY(6px); filter: blur(2px); }
        to   { opacity: 1; transform: translateY(0);   filter: blur(0); }
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
    @keyframes pi-num-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes pi-fill-in {
        from { width: 0; }
        to   { width: var(--pi-fill-w, 60%); }
    }
    @keyframes pi-shimmer {
        from { transform: translateX(-120%); }
        to   { transform: translateX(220%); }
    }
    @keyframes pi-shimmer-pulse {
        0%, 100% { opacity: 0.35; }
        50%       { opacity: 0.65; }
    }

    .pi-panel-fade { animation: pi-panel-fade 380ms var(--pi-ease-out) both; }
    .pi-list-item  { animation: pi-list-in 280ms var(--pi-ease-out) both; }
    .pi-spinner    { animation: pi-spin 0.8s linear infinite; }
    .pi-save-pulse { animation: pi-save-pulse 360ms var(--pi-ease-spring); }
    .pi-skeleton   { animation: pi-shimmer-pulse 1.5s ease-in-out infinite; }

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

    /* ── Toggle card ── */
    .pi-toggle-card {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 14px 16px; border: 1px solid var(--pi-border);
        border-radius: var(--pi-r-md); background: rgba(255,255,255,0.015);
        transition: border-color 220ms ease, background 220ms ease;
    }
    .pi-toggle-card[data-on='true'] {
        border-color: rgba(129,140,248,0.22);
        background: rgba(129,140,248,0.03);
    }
    .pi-root[data-theme='light'] .pi-toggle-card { background: rgba(0,0,0,0.015); }
    .pi-root[data-theme='light'] .pi-toggle-card[data-on='true'] {
        border-color: rgba(99,102,241,0.22); background: rgba(99,102,241,0.03);
    }

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
        font-size: 14px; font-weight: 600; color: var(--pi-hero); margin: 0 0 10px;
    }

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

    /* ── Metric row ── */
    .pi-metric-row {
        display: flex; align-items: center; justify-content: center;
        border: 1px solid var(--pi-border); border-radius: var(--pi-r-md); overflow: hidden;
    }
    .pi-metric-cell {
        flex: 1; padding: 14px 10px;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .pi-metric-cell + .pi-metric-cell { border-left: 1px solid var(--pi-border); }
    .pi-metric-fill {
        height: 5px; border-radius: 3px;
        width: var(--pi-fill-w, 60%);
        box-shadow: 0 0 8px var(--pi-fill-color, currentColor);
        animation: pi-fill-in 640ms cubic-bezier(0.23, 1, 0.32, 1) 160ms both;
    }

    /* ── Skill chips ── */
    .pi-chip {
        font-size: 10px; font-weight: 500; color: var(--pi-secondary);
        padding: 3px 8px; border-radius: var(--pi-r-pill);
        border: 1px solid var(--pi-border); background: var(--pi-btn-bg);
        display: inline-block;
        animation: pi-list-in 220ms var(--pi-ease-out) both;
        transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 160ms ease, border-color 160ms ease, color 160ms ease;
        cursor: default;
    }
    @media (hover: hover) and (pointer: fine) {
        .pi-chip:hover {
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(0,0,0,0.20);
            border-color: rgba(255,255,255,0.18);
            color: var(--pi-primary);
        }
    }

    /* ── Status dot ── */
    .pi-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

    /* ── Reduced motion ── */
    @media (prefers-reduced-motion: reduce) {
        .pi-panel-fade { animation-duration: 150ms; filter: none !important; }
        .pi-list-item  { animation-duration: 100ms; }
        .pi-press:active, .pi-press-soft:active { transform: none; }
        .pi-metric-fill { animation: none; }
        .pi-cta--shimmer::after { animation: none; }
        .pi-skeleton { animation: none; opacity: 0.5; }
        .pi-chip:hover { transform: none; }
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
    { id: 'context',     label: 'Custom Context',     Icon: Pencil },
    { id: 'persona',     label: 'AI Persona',         Icon: Sparkles },
    { id: 'tavily',      label: 'Tavily Search',      Icon: Globe },
    { id: 'company',     label: 'Company Intel',      Icon: Building2 },
    { id: 'negotiation', label: 'Negotiation Script', Icon: Gift },
];

// ─── Main export ──────────────────────────────────────────────────────────────
export function ProfileIntelligenceSettings({ onClose }: { onClose: () => void }) {
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

    // JD
    const [jdUploading, setJdUploading] = useState(false);
    const [jdUploadStatus, setJdUploadStatus] = useState<string | undefined>(undefined);
    const [jdError, setJdError] = useState('');
    const jdAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

    // Custom context
    const [customNotes, setCustomNotes] = useState('');
    const [customNotesSaved, setCustomNotesSaved] = useState(false);
    const [customNotesSavedKey, setCustomNotesSavedKey] = useState(0);
    const customNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Persona
    const [persona, setPersona] = useState('');
    const [personaSaved, setPersonaSaved] = useState(false);
    const [personaSavedKey, setPersonaSavedKey] = useState(0);
    const personaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        }).catch(() => {});
        window.electronAPI?.profileGetNotes?.().then((res: any) => {
            if (res?.success) setCustomNotes(res.content ?? '');
        }).catch(() => {});
        window.electronAPI?.getStoredCredentials?.().then((creds: any) => {
            if (creds?.hasTavilyKey) setHasStoredTavilyKey(true);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!hasProfileAccess) { setPersona(''); return; }
        window.electronAPI?.profileGetPersona?.().then((res: any) => {
            if (res?.success) setPersona(res.content ?? '');
        }).catch(() => {});
    }, [hasProfileAccess]);

    const handleRemoveTavilyKey = async () => {
        if (!confirm('Remove your Tavily API key?')) return;
        try {
            const res = await window.electronAPI?.setTavilyApiKey?.('');
            if (res?.success) { setHasStoredTavilyKey(false); setTavilyApiKey(''); }
        } catch { /**/ }
    };

    const visibleNav = NAV_ITEMS.filter(n => {
        if (n.id === 'company') return !!(profileData?.hasActiveJD && profileData?.activeJD?.company);
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
                        const summary = id.summary ? (id.summary.length > 90 ? id.summary.slice(0, 88) + '…' : id.summary) : null;
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
                                    <p style={{ fontSize: 11, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.5 }}>{summary}</p>
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
                        const levelMap: Record<string, string> = { intern: 'Intern', entry: 'Entry', mid: 'Mid', senior: 'Senior', staff: 'Staff', principal: 'Principal' };
                        return (
                            <div style={{ padding: '10px 12px', border: '1px solid var(--pi-border)', borderRadius: 'var(--pi-r-md)', background: 'rgba(255,255,255,0.015)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {jd.level && (
                                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 'var(--pi-r-pill)', background: 'rgba(129,140,248,0.12)', color: 'var(--pi-accent)', border: '1px solid rgba(129,140,248,0.2)', letterSpacing: '0.02em', textTransform: 'uppercase' as const }}>
                                            {levelMap[jd.level] ?? jd.level}
                                        </span>
                                    )}
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

    const renderContext = () => (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="pi-section-label" style={{ margin: 0 }}>Custom Context</h3>
                {customNotesSaved && (
                    <span key={customNotesSavedKey} style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4, animation: 'pi-check-in 320ms var(--pi-ease-spring) both' }}>
                        <Check size={10} /> Saved
                    </span>
                )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
                Anything the AI should know about you — facts, constraints, preferences. Saved across all sessions and modes.
            </p>
            <div className="pi-content-box">
                <textarea
                    value={customNotes}
                    className="pi-textarea"
                    rows={8}
                    placeholder={`Examples:\n• Q4 ARR was $2.1M, grew 40% YoY\n• Target salary $180k, floor $160k\n• I prefer concise answers without filler phrases`}
                    onChange={e => {
                        const val = e.target.value;
                        if (val.length > 4000) return;
                        setCustomNotes(val);
                        setCustomNotesSaved(false);
                        if (customNotesDebounceRef.current) clearTimeout(customNotesDebounceRef.current);
                        customNotesDebounceRef.current = setTimeout(async () => {
                            try {
                                await window.electronAPI?.profileSaveNotes?.(val);
                                setCustomNotesSavedKey(k => k + 1);
                                setCustomNotesSaved(true);
                                setTimeout(() => setCustomNotesSaved(false), 2000);
                            } catch { /**/ }
                        }, 800);
                    }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderTop: '1px solid var(--pi-input-border)' }}>
                    <span style={{ fontSize: 10, color: customNotes.length > 3600 ? '#f59e0b' : 'var(--pi-tertiary)' }}>
                        {customNotes.length}/4000
                    </span>
                </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--pi-tertiary)', margin: '8px 0 0' }}>Auto-saved · Works with all modes and providers</p>
        </>
    );

    const renderPersona = () => (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="pi-section-label" style={{ margin: 0 }}>AI Persona</h3>
                {personaSaved && hasProfileAccess && (
                    <span key={personaSavedKey} style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4, animation: 'pi-check-in 320ms var(--pi-ease-spring) both' }}>
                        <Check size={10} /> Updated
                    </span>
                )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
                {hasProfileAccess ? "Set the AI's behavior, tone, and role across providers." : 'Upgrade to Pro to personalise the AI persona.'}
            </p>
            <div className="pi-content-box">
                <textarea
                    value={persona}
                    className="pi-textarea"
                    rows={6}
                    disabled={!hasProfileAccess}
                    placeholder="Example: You are a senior hiring manager. Keep answers concise and ask one focused follow-up when needed."
                    onFocus={() => { if (!hasProfileAccess) setIsPremiumModalOpen(true); }}
                    onChange={e => {
                        if (!hasProfileAccess) { setIsPremiumModalOpen(true); return; }
                        const val = e.target.value;
                        if (val.length > 4000) return;
                        setPersona(val);
                        setPersonaSaved(false);
                        if (personaDebounceRef.current) clearTimeout(personaDebounceRef.current);
                        personaDebounceRef.current = setTimeout(async () => {
                            try {
                                const res = await window.electronAPI?.profileSavePersona?.(val);
                                if (res?.success) {
                                    setPersonaSavedKey(k => k + 1);
                                    setPersonaSaved(true);
                                    setTimeout(() => setPersonaSaved(false), 2000);
                                } else if (res?.error === 'pro_required') {
                                    setPersona(''); setIsPremiumModalOpen(true);
                                }
                            } catch { /**/ }
                        }, 800);
                    }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderTop: '1px solid var(--pi-input-border)' }}>
                    <span style={{ fontSize: 10, color: persona.length > 3600 ? '#f59e0b' : 'var(--pi-tertiary)' }}>
                        {persona.length}/4000
                    </span>
                </div>
            </div>
        </>
    );

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
        if (!profileData?.hasActiveJD || !profileData?.activeJD?.company) {
            return <p style={{ fontSize: 13, color: 'var(--pi-secondary)' }}>Upload a job description first to enable company research.</p>;
        }
        return (
            <>
                {companySearchQuotaExhausted && (
                    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: 12, fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
                        <span style={{ flexShrink: 0 }}>⚠</span>
                        Web search credits exhausted — showing AI-only research.
                    </div>
                )}
                {!companyDossier && !companyResearching && (
                    <div style={{ padding: '32px 0', textAlign: 'center' }}>
                        <Building2 size={28} style={{ color: 'var(--pi-tertiary)', marginBottom: 10 }} />
                        <p style={{ fontSize: 13, color: 'var(--pi-secondary)', margin: '0 0 16px' }}>
                            No research yet for <strong style={{ color: 'var(--pi-primary)' }}>{profileData.activeJD.company}</strong>
                        </p>
                        <button className="pi-upload-btn pi-press" onClick={doCompanyResearch}>
                            <Search size={13} /> Research Now
                        </button>
                    </div>
                )}
                {companyResearching && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0' }}>
                        {[80, 60, 70, 50].map((w, i) => (
                            <div key={i} style={{ height: 11, borderRadius: 6, background: 'var(--pi-btn-bg)', width: `${w}%`, opacity: 0.7 }} />
                        ))}
                    </div>
                )}
                {companyDossier && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="pi-add-file-btn pi-press-soft" disabled={companyResearching} onClick={doCompanyResearch}>
                                <RefreshCw size={12} className={companyResearching ? 'pi-spinner' : ''} />
                                {companyResearching ? 'Refreshing…' : 'Refresh'}
                            </button>
                        </div>
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Interview Focus</div>
                                    {companyDossier.interview_difficulty && (
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
                                            ...(companyDossier.interview_difficulty === 'easy' ? { color: '#22c55e', background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.20)' }
                                                : companyDossier.interview_difficulty === 'medium' ? { color: '#f59e0b', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)' }
                                                : companyDossier.interview_difficulty === 'hard' ? { color: '#fb923c', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.20)' }
                                                : { color: '#ef4444', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)' })
                                        }}>
                                            {companyDossier.interview_difficulty.replace('_', ' ')}
                                        </span>
                                    )}
                                </div>
                                <p style={{ fontSize: 12, color: 'var(--pi-secondary)', margin: 0, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, background: 'var(--pi-btn-bg)', border: '1px solid var(--pi-border)' }}>
                                    {companyDossier.interview_focus}
                                </p>
                            </div>
                        )}
                        {companyDossier.salary_estimates?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Salary Estimates</div>
                                <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, overflow: 'hidden' }}>
                                    {companyDossier.salary_estimates.map((s: any, i: number) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: i < companyDossier.salary_estimates.length - 1 ? '1px solid var(--pi-border)' : 'none' }}>
                                            <span style={{ fontSize: 12, color: 'var(--pi-primary)' }}>{s.title} <span style={{ color: 'var(--pi-tertiary)' }}>({s.location})</span></span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>{s.currency} {s.min?.toLocaleString()} – {s.max?.toLocaleString()}</span>
                                                <span style={{
                                                    fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, textTransform: 'uppercase',
                                                    ...(s.confidence === 'high' ? { color: '#22c55e', background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.20)' }
                                                        : s.confidence === 'medium' ? { color: '#f59e0b', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)' }
                                                        : { color: '#ef4444', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)' })
                                                }}>{s.confidence}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {companyDossier.culture_ratings && (
                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Work Culture</div>
                                <div style={{ border: '1px solid var(--pi-border)', borderRadius: 8, padding: '12px 14px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--pi-border)' }}>
                                        <div>
                                            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--pi-hero)' }}>{companyDossier.culture_ratings.overall?.toFixed(1)}</span>
                                            <span style={{ fontSize: 12, color: 'var(--pi-tertiary)' }}> / 5</span>
                                            {companyDossier.culture_ratings.review_count && (
                                                <div style={{ fontSize: 10, color: 'var(--pi-tertiary)', marginTop: 2 }}>{companyDossier.culture_ratings.review_count}</div>
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
                                                    <span style={{ fontSize: 10, color: 'var(--pi-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                                        <StarRating value={val} size={9} />
                                                        <span style={{ fontSize: 10, color: 'var(--pi-secondary)', fontWeight: 500 }}>{val.toFixed(1)}</span>
                                                    </div>
                                                </div>
                                            ) : null;
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                        {companyDossier.benefits?.length > 0 && (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <Gift size={11} style={{ color: '#22c55e' }} />
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Benefits</div>
                                </div>
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
                                        <span key={i} style={{ fontSize: 11, color: '#c084fc', padding: '3px 10px', borderRadius: 20, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.18)' }}>{v}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {companyDossier.critics?.length > 0 && (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <AlertCircle size={11} style={{ color: '#fb923c' }} />
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pi-hero)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Common Complaints</div>
                                </div>
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
                        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.14)', fontSize: 11, color: 'var(--pi-tertiary)', lineHeight: 1.5 }}>
                            <span style={{ color: '#a855f7', flexShrink: 0 }}>⚠</span>
                            <span><strong style={{ color: '#c084fc' }}>Beta.</strong> AI-generated — verify salary figures and hiring details independently.</span>
                        </div>
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
                            <Sparkles size={13} /> Generate Script
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

    const SECTION_RENDERERS: Record<string, () => React.ReactNode> = {
        identity: renderIdentity,
        context: renderContext,
        persona: renderPersona,
        tavily: renderTavily,
        company: renderCompany,
        negotiation: renderNegotiation,
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
