import { Activity, AlertTriangle, Gauge, History, Loader2, Play, RefreshCw, RotateCcw, Timer, Wifi } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import {
    Collapse, CollapseItem, Presence, SETTINGS_BTN, SettingsGroupLabel, SettingsMotionReady, SettingsNotice, SettingsRow,
    SettingsSectionHeading, useMotionReadyAfter, useSettingsTones, useSettledFlag,
} from './SettingsRow';

/**
 * Provider performance — what Natively has learned about each provider on this
 * machine, and what it does with it.
 *
 * DESIGN CONSTRAINT, taken from the spec that produced this feature: "Do not
 * expose misleading precision such as 'P95 = 83.274 seconds'." Everything a
 * user sees here is either a WORD (Fast / Good / Moderate / Slow / Unreliable)
 * or a number they can act on (the stall guard in seconds, the sample count
 * behind it). The raw distributions stay in the diagnostics dump, which is what
 * a bug report carries.
 *
 * The second constraint is that calibration must not feel intrusive. It is
 * PASSIVE by default — ordinary answers are the samples — so the page opens
 * having already learned things without ever having sent a request of its own.
 *
 * There IS an explicit "Run calibration" button, and everything about how it is
 * presented follows from it being the only thing here that costs money: its row
 * sits directly under the two switches that permit it (2026-09-25 layout — the
 * settings first, then the read-out), its own line says "Optional" and "Uses
 * your API key" before the button, the section subtitle names it as the only
 * cost, and its flags default OFF so the common outcome of pressing it is that
 * nothing is sent and the note says so. No progress bar, because at 3-4 small
 * requests there is nothing to watch.
 */

type Grade = 'fast' | 'good' | 'moderate' | 'slow' | 'unreliable' | 'unknown';
type Confidence = 'none' | 'low' | 'medium' | 'high';

interface StreamIdleDecision {
    valueMs: number;
    source: 'shipped_prior' | 'profile' | 'clamped_floor' | 'clamped_ceiling';
    sampleCount: number;
}

interface ProfileRow {
    providerId: string;
    modelId: string;
    networkProfileId: string;
    route: string;
    grade: Grade;
    confidence: Confidence;
    sampleCount: number;
    lastUpdated: number;
    stale: boolean;
    capability: { visionVerdict: string; contextWindowTokens: number; source: string };
    streamIdle: StreamIdleDecision;
    projected100k: { predictedTtftMs: number; actionable: boolean } | null;
    largeContextWarning: string | null;
    isCurrentNetwork: boolean;
}

interface SecondaryTally {
    kind: string;
    attempts: number;
    completed: number;
    firstTokenTimeouts: number;
    maxObservedTtftMs: number;
}

interface Diagnostics {
    ok: boolean;
    network?: { id: string; interfaceClass: string; offline: boolean };
    profiles: ProfileRow[];
    secondaryStreams?: SecondaryTally[];
}

const GRADE_LABEL: Record<Grade, string> = {
    fast: 'Fast',
    good: 'Good',
    moderate: 'Moderate',
    slow: 'Slow',
    unreliable: 'Unreliable',
    unknown: 'Not measured yet',
};

/**
 * How much to trust the grade, in words.
 *
 * `none`/`low` are shown as "learning" rather than as a number, because "3
 * samples" invites a user to reason about a statistic that cannot yet support
 * it. `high` is not shown at all — a grade with nothing next to it IS the
 * confident case, and a "high confidence" chip on every healthy row is noise.
 */
function confidenceNote(c: Confidence, samples: number): string | null {
    if (c === 'none') return 'no samples yet';
    if (c === 'low') return 'still learning';
    if (c === 'medium') return `${samples} answers`;
    return null;
}

const ProviderPerformanceSettings: React.FC<{
    /** The pane's provider switches, listed under the heading above the read-out. */
    settings?: React.ReactNode;
}> = ({ settings }) => {
    const t = useT();
    const [data, setData] = useState<Diagnostics | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [calibrateNote, setCalibrateNote] = useState<string | null>(null);
    // Its own readiness, not the pane's: the diagnostics read lands on its own
    // schedule, and the first set of rows must appear settled, not grow in.
    const motionReady = useMotionReadyAfter(data !== null);
    // Spinners only for work long enough to notice: a local diagnostics read or a
    // calibration skipped by its flag answers in milliseconds, and a spinner that
    // swaps in and straight back out is a flicker (transitions-polish intent delay).
    // The first read has its own words ("Reading measurements…"), so only a Refresh
    // of data already on screen spins the button.
    const refreshing = useSettledFlag(loading && data !== null);
    const calibrating = useSettledFlag(busy === 'calibrate');
    const forgetting = useSettledFlag(busy === '*');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const api = (window as any).electronAPI;
            const res = await api?.providerPerformanceGetDiagnostics?.();
            setData(res ?? { ok: false, profiles: [] });
        } catch {
            // A diagnostics read must never look like an app failure.
            setData({ ok: false, profiles: [] });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const forget = useCallback(async (providerId?: string) => {
        setBusy(providerId ?? '*');
        try {
            await (window as any).electronAPI?.providerPerformanceReset?.(providerId);
            await load();
        } finally {
            setBusy(null);
        }
    }, [load]);

    /**
     * The one action here that can bill the user.
     *
     * Both its flags default OFF, so the common outcome of pressing this is
     * `skippedReason: 'flag_off'` and zero requests — which the note below says
     * plainly rather than showing a silent no-op. Nothing calls this on mount,
     * on provider-add or on a timer; a press is the only trigger.
     */
    const calibrate = useCallback(async () => {
        setBusy('calibrate');
        setCalibrateNote(null);
        try {
            const res = await (window as any).electronAPI?.providerPerformanceCalibrate?.();
            const r = res?.result;
            if (!res?.ok) setCalibrateNote(t('Calibration could not run.'));
            else if (r?.skippedReason === 'flag_off') setCalibrateNote(t('Calibration is turned off, so nothing was sent.'));
            else if (r?.skippedReason === 'cooldown') setCalibrateNote(t('Already calibrated recently — try again tomorrow.'));
            else if (r?.skippedReason) setCalibrateNote(t('Calibration was skipped.'));
            else {
                // The image probe is one of the requests, so a definite verdict
                // counts as a success — a probe-only run used to read "Sent 1 test
                // requests. 0 succeeded." — and the verdict itself is said aloud,
                // since it is now kept as the model's image support.
                const probeAnswered = r?.vision === 'SUPPORTED' || r?.vision === 'UNSUPPORTED';
                const ok = (r?.rungs ?? []).filter((x: any) => x.ok).length + (probeAnswered ? 1 : 0);
                const sent = Number(r?.requestsIssued ?? 0);
                const images = r?.vision === 'SUPPORTED'
                    ? ` ${t('Images: supported.')}`
                    : r?.vision === 'UNSUPPORTED' ? ` ${t('Images: not supported.')}` : '';
                setCalibrateNote(
                    (sent === 1 ? t('Sent 1 test request. {ok} succeeded.') : t('Sent {n} test requests. {ok} succeeded.'))
                        .replace('{n}', String(sent))
                        .replace('{ok}', String(ok)) + images,
                );
            }
            await load();
        } catch {
            setCalibrateNote(t('Calibration could not run.'));
        } finally {
            setBusy(null);
        }
    }, [load, t]);

    const profiles = data?.profiles ?? [];
    // The current network first: a row for a café Wi-Fi the user left last week
    // is history, not a description of what is happening now.
    const current = profiles.filter((p) => p.isCurrentNetwork && !p.stale);
    const others = profiles.filter((p) => !p.isCurrentNetwork || p.stale);
    const lateStreams = (data?.secondaryStreams ?? []).filter((s) => s.firstTokenTimeouts > 0);

    // The interface CLASS, never the network id. The id is a local key; showing
    // it would invite a user to paste it somewhere.
    const networkKey = loading && !data ? 'loading' : data?.network ? (data.network.offline ? 'offline' : data.network.interfaceClass) : 'none';
    const networkDescription = loading && !data
        ? t('Reading measurements…')
        : data?.network
            ? (data.network.offline ? t('offline') : t(NETWORK_LABEL[data.network.interfaceClass] ?? data.network.interfaceClass))
            : t('Not detected');

    // One category, laid out as General lays out a section: the settings first (the
    // three switches the pane hands in, then the calibration action they govern), then
    // ONE labelled group for the read-out. The read-out always has at least two rows —
    // Current network plus either the measurements or the empty row — so the label
    // never sits over a single row. Older / other-network rows say so in their own
    // description instead of under a second-level label.
    return (
        <SettingsMotionReady.Provider value={motionReady}>
            <SettingsSectionHeading
                title={t('Provider performance')}
                subtitle={t('Learns each provider’s speed from normal use. Only calibration costs extra.')}
            />

            {settings}

            {/* The one action here that costs money, so its row says so before the
                button, not after. Phase 21's rule is that nothing is spent silently. */}
            <SettingsRow
                icon={<Gauge size={20} />}
                title={t('Run calibration')}
                description={t('Sends small test requests to measure speed. Uses your API key.')}
                control={
                    <button type="button" className={SETTINGS_BTN} onClick={() => void calibrate()} disabled={busy !== null}>
                        <Presence kind="icon" id={calibrating ? 'busy' : 'idle'}>
                            {calibrating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        </Presence>
                        {t('Run')}
                    </button>
                }
            >
                {/* The outcome grows in under the row; a new outcome swaps in place. */}
                <Collapse open={!!calibrateNote}>
                    <p className="pb-3 text-xs text-text-secondary" role="status">
                        <Presence kind="text" id={calibrateNote} block>{calibrateNote}</Presence>
                    </p>
                </Collapse>
            </SettingsRow>

            <SettingsGroupLabel>{t('Measurements')}</SettingsGroupLabel>

            <SettingsRow
                icon={<Wifi size={20} />}
                title={t('Current network')}
                description={networkDescription}
                descriptionKey={networkKey}
                control={
                    <button type="button" className={SETTINGS_BTN} onClick={() => void load()} disabled={loading}>
                        <Presence kind="icon" id={refreshing ? 'busy' : 'idle'}>
                            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        </Presence>
                        {t('Refresh')}
                    </button>
                }
            />

            {/* Every read-out row grows in and folds away as the measurements change
                (a Refresh that learned a new model, a Forget that cleared them all),
                instead of the list jumping. Keys are the rows' identities. */}
            <AnimatePresence initial={false}>

            {/* Keyed on having data, not on `loading`: a Refresh of an empty read-out
                must not fold this row away and grow it back. */}
            {data !== null && profiles.length === 0 ? (
                <CollapseItem key="empty">
                    <SettingsRow
                        icon={<Activity size={20} />}
                        title={t('Nothing measured yet')}
                        description={t('Ask a question and Natively starts learning your provider’s speed.')}
                    />
                </CollapseItem>
            ) : null}

            {current.map((p) => (
                <CollapseItem key={`${p.providerId}|${p.modelId}|${p.networkProfileId}`}>
                    <MeasurementRow p={p} t={t} />
                </CollapseItem>
            ))}
            {others.map((p) => (
                <CollapseItem key={`${p.providerId}|${p.modelId}|${p.networkProfileId}`}>
                    <MeasurementRow p={p} t={t} older />
                </CollapseItem>
            ))}

            {/* This block exists because the failure it reports is otherwise SILENT:
                when a repair window expires before the provider's first token, the user
                simply never sees their answer improve, and nothing anywhere says so. */}
            {lateStreams.map((s) => (
                <CollapseItem key={`late-${s.kind}`}>
                <SettingsRow
                    icon={<Timer size={20} />}
                    title={t(s.kind)}
                    description={
                        <>
                            {t('{done} of {total} finished in time.')
                                .replace('{done}', String(s.completed))
                                .replace('{total}', String(s.attempts))}
                            {s.maxObservedTtftMs > 0
                                ? ` ${t('Slowest start: {n}s.').replace('{n}', (s.maxObservedTtftMs / 1000).toFixed(1))}`
                                : ''}
                        </>
                    }
                />
                </CollapseItem>
            ))}

            {profiles.length > 0 ? (
                <CollapseItem key="forget">
                <SettingsRow
                    icon={<RotateCcw size={20} />}
                    title={t('Forget all measurements')}
                    description={t('Clears what Natively has learned. It relearns from your next answer.')}
                    control={
                        <button type="button" className={SETTINGS_BTN} onClick={() => void forget()} disabled={busy !== null}>
                            <Presence kind="icon" id={forgetting ? 'busy' : 'idle'}>
                                {forgetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            </Presence>
                            {t('Forget')}
                        </button>
                    }
                />
                </CollapseItem>
            ) : null}
            </AnimatePresence>
        </SettingsMotionReady.Provider>
    );
};

const NETWORK_LABEL: Record<string, string> = {
    wifi: 'Wi-Fi',
    ethernet: 'Ethernet',
    cellular: 'Cellular',
    loopback: 'This computer only',
    other: 'Other network',
};

const MeasurementRow: React.FC<{ p: ProfileRow; t: (s: string) => string; older?: boolean }> = ({ p, t, older }) => {
    const tones = useSettingsTones();
    const note = confidenceNote(p.confidence, p.sampleCount);
    // Only worth saying when evidence actually moved it. "8.0s (default)" on
    // every row is noise; "2.5s" on the row that changed is information.
    const guardMoved = p.streamIdle.source !== 'shipped_prior';

    // One tone per grade, and reliability is the only one that gets the alarm
    // colour. A provider that answers in 900ms and fails a fifth of the time is
    // not "fast" — saying so would be the most misleading thing this panel could
    // do. The palette's 400/500 shades fall under 4.5:1 on the light canvas, so
    // the tones come from the shared theme-split set.
    const gradeTone: Record<Grade, string> = {
        fast: tones.text.ok,
        good: tones.text.ok,
        moderate: 'text-text-secondary',
        slow: tones.text.warn,
        unreliable: tones.text.danger,
        unknown: 'text-text-secondary',
    };

    const facts: string[] = [`${p.providerId} · ${p.route.replace(/_/g, ' ')}`];
    if (!p.isCurrentNetwork) facts.push(t('another network'));
    if (guardMoved) facts.push(t('Stalled replies detected after {n}s').replace('{n}', (p.streamIdle.valueMs / 1000).toFixed(1)));
    if (p.capability.contextWindowTokens > 0) facts.push(`${t('Context')}: ${Math.round(p.capability.contextWindowTokens / 1000)}K`);
    if (p.capability.visionVerdict === 'SUPPORTED') facts.push(t('Images supported'));
    if (p.capability.visionVerdict === 'UNSUPPORTED') facts.push(t('No image support'));
    // Only shown when the fit explains more than it invents. An unactionable
    // projection is a number with no meaning.
    if (p.projected100k?.actionable) {
        facts.push(t('Very large requests: about {n}s to start').replace('{n}', (p.projected100k.predictedTtftMs / 1000).toFixed(0)));
    }
    if (p.stale) facts.push(t('measurements are old'));

    return (
        <SettingsRow
            icon={older ? <History size={20} /> : <Activity size={20} />}
            title={p.modelId}
            truncateTitle
            description={facts.join(' · ')}
            control={
                <div className="text-right">
                    <div className={`text-xs font-semibold ${gradeTone[p.grade] ?? gradeTone.unknown}`}>
                        {/* A Refresh that re-grades a model swaps the word in place. */}
                        <Presence kind="text" id={p.grade}>{t(GRADE_LABEL[p.grade] ?? GRADE_LABEL.unknown)}</Presence>
                    </div>
                    {note ? <div className="text-[11px] text-text-secondary">{t(note)}</div> : null}
                </div>
            }
        >
            {p.largeContextWarning ? (
                // Phrased as RELIABILITY, never as capability. Repeated failure at a
                // large size is not evidence the model cannot accept it.
                <SettingsNotice tone={tones.warn} icon={<AlertTriangle size={14} />}>{t(p.largeContextWarning)}</SettingsNotice>
            ) : null}
        </SettingsRow>
    );
};

export default ProviderPerformanceSettings;
export { ProviderPerformanceSettings };
