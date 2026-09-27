import React, { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { ArrowRight, Loader, Check } from 'lucide-react';
// Static import keeps Vite from warning about a "mixed" dynamic+static import
// graph for analytics.service (App.tsx, Launcher.tsx, NativelyInterface.tsx,
// and SettingsOverlay.tsx all import it statically). The previous
// `import('../../lib/analytics/analytics.service')` was a tiny "split off
// the analytics chunk" gesture, but it triggered Vite's dynamic-import
// warning at build time and made the chunk boundary platform-dependent.
import { analytics } from '../../lib/analytics/analytics.service';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import { useTextsReveal } from './useTextsReveal';
import './textsReveal.css';

/*
  Liquid Glass (src/ui-components/design.md) at UI scale, in the box of the
  button it replaced. `sky` is used because it has ONE treatment for both
  themes: this button always sits on the calendar card's indigo backdrop, so
  `clear`'s light-theme inversion (a dark rim meant for a white panel) would be
  wrong here. The body is fed a translucent white so the backdrop shows
  through; the white label on it measures 5.85:1 at its worst point.
*/
const GLASS_STYLE = {
    '--lg-sky-bg': 'rgba(255, 255, 255, .14)',
    '--lg-sky-hover': 'rgba(255, 255, 255, .22)',
    '--lg-pill-h': '36px',
    '--lg-label-size': '13px',
    '--lg-icon-gap': '10px',
    padding: '0 20px 0 16px',
} as React.CSSProperties;

const ConnectedLabel: React.FC<{ reveal: boolean; text: string }> = ({ reveal, text }) => {
    const { ref, shown } = useTextsReveal<HTMLSpanElement>(reveal);
    return (
        <span ref={ref} className={`t-stagger cal-connected-label inline-block${shown ? ' is-shown' : ''}`}>
            <span className="t-stagger-line t-stagger-line--1 !inline-flex items-center gap-2.5 font-semibold">
                <Check size={15} strokeWidth={2.5} />
                {text}
            </span>
        </span>
    );
};

interface ConnectCalendarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'dark';
    /**
     * The calendar is connected. `fresh` is true only when this click's
     * sign-in just completed; the status check on mount reports an existing
     * connection with `fresh: false`, so a host can animate the moment of
     * linking without replaying it on every launch.
     */
    onConnect?: (info: { fresh: boolean }) => void;
}

const ConnectCalendarButton: React.FC<ConnectCalendarButtonProps> = ({ className = '', variant = 'default', onConnect, ...props }) => {
    const t = useT();
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    // Connected by this click, as opposed to found connected on mount: only
    // then does the label swap animate.
    const [justConnected, setJustConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.getCalendarStatus().then(status => {
                setConnected(status.connected);
                if (status.connected) {
                    onConnect?.({ fresh: false });
                }
            });
        }
        // Only check the persisted calendar status on mount; callers may pass inline callbacks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
        if (props.onClick) props.onClick(e);
        if (connected) return; // For now no disconnect here

        setLoading(true);
        setError(null);
        try {
            const res = await window.electronAPI.calendarConnect();
            if (res.success) {
                setConnected(true);
                setJustConnected(true);
                setError(null);
                onConnect?.({ fresh: true });
                // Track calendar connection (analytics imported statically above)
                analytics.trackCalendarConnected();
            } else if (res.error) {
                console.error('[ConnectCalendarButton] Connection error:', res.error);
                setError(res.error);
            }
        } catch (err: any) {
            console.error('[ConnectCalendarButton] Connection exception:', err);
            setError(err?.message || 'Failed to connect calendar');
        } finally {
            setLoading(false);
        }
    };

    if (connected) {
        // The same glass button, now a status: the label swaps to "Connected"
        // with the Texts reveal (textsReveal.css), a short blurred rise. It
        // used to become a different, violet pill with a looping aurora and
        // shimmer; a static status has no use for endless motion, and keeping
        // the material means the button doesn't turn into another object.
        // Same element types as the button below, so React keeps the glass
        // node and only the label changes.
        return (
            <div className={`flex flex-col items-center gap-1.5 w-fit ${className}`}>
                <LiquidGlassButton
                    variant="sky"
                    className="lg-sm pointer-events-none"
                    style={GLASS_STYLE}
                    tabIndex={-1}
                    aria-disabled="true"
                >
                    <ConnectedLabel reveal={justConnected} text={t('Connected')} />
                </LiquidGlassButton>
            </div>
        );
    }

    return (
        // The caller's className lands here, not on the button: a Tailwind
        // translate is a `transform`, which the material's :active scale would
        // replace, so the pill would jump on every press.
        <div className={`flex flex-col items-center gap-1.5 w-fit ${className}`}>
            <LiquidGlassButton
                {...props}
                variant="sky"
                className="lg-sm"
                style={GLASS_STYLE}
                onClick={handleClick}
                disabled={loading}
                icon={loading ? (
                    <Loader size={14} className="animate-spin" />
                ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-90">
                        <path d="M23.52 12.212c0-.848-.076-1.654-.216-2.428H12v4.594h6.473c-.28 1.503-1.12 2.775-2.38 3.619v3.01h3.84c2.247-2.07 3.54-5.118 3.54-8.795z" fill="white" />
                        <path d="M12 24c3.24 0 5.957-1.074 7.942-2.906l-3.84-3.01c-1.078.722-2.454 1.15-4.102 1.15-3.124 0-5.77-2.112-6.72-4.954H1.322v3.106C3.38 21.442 7.378 24 12 24z" fill="white" />
                        <path d="M5.28 14.28A7.276 7.276 0 0 1 4.908 12c0-.8.14-1.57.387-2.28V6.613H1.322A11.968 11.968 0 0 0 0 12c0 1.943.468 3.774 1.322 5.387l3.96-3.107z" fill="white" />
                        <path d="M12 4.75c1.764 0 3.345.607 4.588 1.795l3.433-3.434C17.95 1.258 15.234 0 12 0 7.378 0 3.378 2.558 1.322 6.613l3.957 3.107c.95-2.842 3.595-4.97 6.72-4.97z" fill="white" />
                    </svg>
                )}
            >
                {/* The label box clips, so the arrow no longer nudges on hover;
                    the lens is the hover cue now. */}
                <span className="inline-flex items-center gap-2.5">
                    {loading ? t('Connecting...') : t('Connect calendar')}
                    {!loading && <ArrowRight size={13} style={{ color: 'rgba(244, 246, 250, 0.9)' }} />}
                </span>
            </LiquidGlassButton>
            {error && (
                <span
                    className="text-[11px] text-red-300 bg-red-950/95 backdrop-blur-sm border border-red-500/30 rounded-lg px-2.5 py-1 max-w-[280px] leading-tight text-center"
                    title={error}
                >
                    {error}
                </span>
            )}
        </div>
    );
};

export default ConnectCalendarButton;
