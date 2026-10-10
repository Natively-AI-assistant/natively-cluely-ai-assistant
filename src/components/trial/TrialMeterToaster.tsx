// src/components/trial/TrialMeterToaster.tsx
//
// The launcher's small free-trial card (2026-10-10), in the bottom-right
// corner while a trial runs: the time left on the clock, and how much of the
// two allowances a trial can run out of before the clock does, voice and AI,
// has been used.
//
// The trial starts by itself with a meeting, so the launcher is the first
// place someone sees it between meetings. The card is the quota notice's
// sibling: the same clear Liquid Glass pane (.lg-notice), the same corner and
// the same slide. What it shows is decided by src/lib/trial/trialMeter.mjs.

import React, { useEffect, useRef, useState } from 'react';
import { Timer, X } from 'lucide-react';
import { GenieModal } from '../ui/GenieModal';
import SwapText from '../ui/SwapText';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { useT } from '../../i18n';
import { formatMeter, TRIAL_FALLBACK_LIMITS, type TrialLimits, type TrialUsage } from '../../types/nativelyUsage';
import { TRIAL_ENDING_MS } from '../../lib/trial/overlayTrialNotice.mjs';
import { shouldShowTrialMeter, trialClock, trialMeterView, type TrialMeterRow, type TrialMeterTone } from '../../lib/trial/trialMeter.mjs';
import '../../ui-components/LiquidGlassButton.css';
import './TrialMeterToaster.css';

/** Home is given this long to settle before the card slides in beside it. */
const SETTLE_MS = 900;

type TimePhase = 'over' | 'low' | 'ok';
const timePhase = (expiresMs: number): TimePhase => {
    const left = expiresMs - Date.now();
    return !(left > 0) ? 'over' : left <= TRIAL_ENDING_MS ? 'low' : 'ok';
};

const track = (action: 'shown' | 'clicked' | 'dismissed') => {
    window.electronAPI?.funnelTrack?.('upgrade_prompt', { surface: 'trial_meter', action })?.catch?.(() => {});
};

/**
 * The clock redraws itself: the card around it changes only when what it
 * shows does (new usage, the last five minutes), not once a second. The wall
 * clock is re-read on every tick, so a sleep shows the right time on wake.
 */
const TrialClock: React.FC<{ expiresMs: number; capMs?: number; className: string }> = ({ expiresMs, capMs, className }) => {
    const [clock, setClock] = useState(() => trialClock(expiresMs - Date.now(), capMs));
    useEffect(() => {
        const tick = () => setClock(trialClock(expiresMs - Date.now(), capMs));
        tick();
        const id = setInterval(tick, 500);
        return () => clearInterval(id);
    }, [expiresMs, capMs]);
    return <span role="timer" className={className}>{clock}</span>;
};

/**
 * True while the launcher is in front of someone, as far as it can tell: no
 * meeting has the screen, and its document is visible. A trial that starts
 * with a meeting reaches the launcher while it is hidden behind that meeting;
 * a card opened there would play its arrival to nobody.
 *
 * The meeting is the half that carries this. The launcher runs unthrottled
 * (WindowHelper.ts), which makes Page Visibility read 'visible' for a hidden
 * window, so that half only helps where throttling is on.
 */
function useOnScreen(): boolean {
    const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
    const [inMeeting, setInMeeting] = useState(false);
    useEffect(() => {
        const read = () => setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', read);
        return () => document.removeEventListener('visibilitychange', read);
    }, []);
    useEffect(() => {
        // An event that arrives first knows better than the answer still in flight.
        let heard = false;
        window.electronAPI?.getMeetingActive?.().then((isActive) => { if (!heard) setInMeeting(!!isActive); }).catch(() => {});
        const off = window.electronAPI?.onMeetingStateChanged?.((data) => { heard = true; setInMeeting(!!data?.isActive); });
        return () => { try { off?.(); } catch { /* window closing */ } };
    }, []);
    return visible && !inMeeting;
}

export interface TrialMeterToasterProps {
    /** The running trial as the launcher holds it, or null. */
    trial: { expiresAt: string; usage: TrialUsage; limits?: TrialLimits } | null;
    /** Home is on screen with nothing open over it. */
    ready: boolean;
    onSeePlans: () => void;
}

export const TrialMeterToaster: React.FC<TrialMeterToasterProps> = ({ trial, ready, onSeePlans }) => {
    const t = useT();
    const isLight = useResolvedTheme() === 'light';
    const amber = isLight ? 'text-amber-600' : 'text-amber-400';
    const red = isLight ? 'text-red-600' : 'text-red-400';
    const toneText: Record<TrialMeterTone, string> = { ok: 'text-text-primary', low: amber, out: red };

    const expiresMs = trial ? new Date(trial.expiresAt).getTime() : NaN;

    // Only the moments that change the card re-render it: the last five
    // minutes, and 0:00. Setting the same phase again is a no-op.
    const [, setPhase] = useState<TimePhase>(() => timePhase(expiresMs));
    useEffect(() => {
        if (!Number.isFinite(expiresMs)) return;
        setPhase(timePhase(expiresMs));
        const id = setInterval(() => setPhase(timePhase(expiresMs)), 1000);
        return () => clearInterval(id);
    }, [expiresMs]);

    const onScreen = useOnScreen();
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        if (!ready || !onScreen) { setSettled(false); return; }
        const id = setTimeout(() => setSettled(true), SETTLE_MS);
        return () => clearTimeout(id);
    }, [ready, onScreen]);

    // What the card showed when it was closed. A new trial is a new card.
    const [closedAt, setClosedAt] = useState<TrialMeterTone | null>(null);
    useEffect(() => { setClosedAt(null); }, [expiresMs]);

    const live = trial
        ? trialMeterView({
            now: Date.now(),
            expiresAt: expiresMs,
            usage: trial.usage,
            limits: { ...TRIAL_FALLBACK_LIMITS, ...trial.limits },
        })
        : null;
    const open = settled && !!live && shouldShowTrialMeter(live.tone, closedAt);

    // The close plays on the last reading, not on an empty pane.
    const capMs = trial?.limits?.duration_ms;
    const lastRef = useRef({ view: live, expiresMs, capMs });
    if (live) lastRef.current = { view: live, expiresMs, capMs };
    const view = live ?? lastRef.current.view;
    const clockEndsAt = live ? expiresMs : lastRef.current.expiresMs;
    const clockCapMs = live ? capMs : lastRef.current.capMs;

    // Reported once per trial, not once per appearance: the card closes for
    // every meeting and comes back after it. And only to a window in use: the
    // launcher's Page Visibility always reads 'visible' (it runs unthrottled,
    // WindowHelper.ts), so focus is the one honest sign someone is looking.
    const reportedFor = useRef<number | null>(null);
    useEffect(() => {
        const report = () => {
            if (!open || reportedFor.current === expiresMs || !document.hasFocus()) return;
            reportedFor.current = expiresMs;
            track('shown');
        };
        report();
        window.addEventListener('focus', report);
        return () => window.removeEventListener('focus', report);
    }, [open, expiresMs]);

    const label = (row: TrialMeterRow) => (row.id === 'voice' ? t('Voice') : t('AI'));

    return (
        <GenieModal
            open={open}
            label="TrialMeterToaster"
            modal={false}
            placement="bottom-right"
            keepPictures={false}
            // Under the corner's passing notices (update, memory): they land
            // on top of it and it is there again when they leave.
            zIndex={9998}
            padding={24}
            wrapClassName="w-[256px]"
            cardProps={{ role: 'group', 'aria-label': t('Free trial') }}
            cardClassName={`lg-notice${view?.tone === 'out' ? ' lg-notice-alert' : view?.tone === 'low' ? ' lg-notice-warn' : ''} trial-meter-card p-3.5 flex flex-col`}
            // The stand-in for .lg-notice's lift while the slide runs.
            shadow={isLight ? '0 16px 36px -14px rgba(0,0,0,0.22)' : '0 22px 44px -18px rgba(0,0,0,0.7)'}
            radius={18}
        >
            {view && (
                <>
                    {/* Header: what it is, the time left, and a close */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            {/* Keyed: the timer pops again when the clock turns amber. */}
                            <span className={`trial-meter-icon ${view.timeLow ? amber : 'text-text-secondary'}`} key={view.timeLow ? 'low' : 'ok'}>
                                <Timer size={14} strokeWidth={2} />
                            </span>
                            <span className="text-[13px] font-semibold text-text-primary truncate">{t('Free trial')}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <TrialClock
                                expiresMs={clockEndsAt}
                                capMs={clockCapMs}
                                className={`text-[13px] font-semibold tabular-nums transition-colors duration-500 ease-out ${view.timeLow ? amber : 'text-text-primary'}`}
                            />
                            <button
                                onClick={() => { setClosedAt(view.tone); track('dismissed'); }}
                                aria-label={t('Dismiss')}
                                className="trial-meter-close flex text-text-tertiary hover:text-text-primary transition-colors shrink-0 cursor-pointer"
                            >
                                <X size={14} strokeWidth={2} />
                            </button>
                        </div>
                    </div>

                    {/* The two allowances a trial can run out of */}
                    <div className="flex flex-col gap-2 mt-2.5">
                        {view.rows.map((row) => (
                            <div key={row.id} className="flex flex-col gap-1.5" data-meter={row.id} data-tone={row.tone}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[12px] text-text-secondary shrink-0">{label(row)}</span>
                                    <span className={`text-[12px] font-medium tabular-nums text-right transition-colors duration-500 ease-in-out ${toneText[row.tone]}`}>
                                        {/* A new reading swaps in place. */}
                                        <SwapText swapKey={formatMeter(row)}>{formatMeter(row)}</SwapText>
                                    </span>
                                </div>
                                <div className="trial-meter-track">
                                    <div className="trial-meter-fill" data-tone={row.tone} style={{ width: `${row.fill}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* The way to keep going, once something is running out.
                        Always in the card, folded to nothing until then, so
                        the card grows instead of jumping. */}
                    <div className="trial-meter-more" data-open={view.tone !== 'ok'} aria-hidden={view.tone === 'ok'}>
                        <div className="trial-meter-more-inner">
                            <button
                                tabIndex={view.tone !== 'ok' ? 0 : -1}
                                onClick={() => { track('clicked'); onSeePlans(); }}
                                className={`text-[11px] font-semibold ${view.tone === 'out' ? red : amber} hover:text-text-primary transition-colors duration-500 cursor-pointer`}
                            >
                                {t('See plans')}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </GenieModal>
    );
};
