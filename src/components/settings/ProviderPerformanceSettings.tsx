import { Activity, AlertTriangle, Gauge, Loader2, RefreshCw, Wifi } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';

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
 * presented follows from it being the only thing here that costs money: it sits
 * below the read-out rather than at the top, it is preceded by a sentence
 * stating that it uses the user's API key and that most people do not need it,
 * and its flags default OFF so the common outcome of pressing it is that
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

/**
 * One tone per grade, and reliability is the only one that gets the alarm
 * colour. A provider that answers in 900ms and fails a fifth of the time is not
 * "fast" — saying so would be the most misleading thing this panel could do.
 */
const GRADE_TONE: Record<Grade, string> = {
    fast: 'text-emerald-500',
    good: 'text-emerald-500',
    moderate: 'text-text-secondary',
    slow: 'text-amber-500',
    unreliable: 'text-red-500',
    unknown: 'text-text-tertiary',
};

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

const ProviderPerformanceSettings: React.FC = () => {
    const t = useT();
    const [data, setData] = useState<Diagnostics | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [calibrateNote, setCalibrateNote] = useState<string | null>(null);

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
                const ok = (r?.rungs ?? []).filter((x: any) => x.ok).length;
                setCalibrateNote(
                    t('Sent {n} test requests. {ok} succeeded.')
                        .replace('{n}', String(r?.requestsIssued ?? 0))
                        .replace('{ok}', String(ok)),
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

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                            <Gauge size={15} /> {t('Provider performance')}
                        </h3>
                        <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-secondary">
                            {t('Natively measures how each provider behaves on your network and adjusts its own timeouts to match. This happens while you use it — normal answers are the measurements, so nothing extra is billed.')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void load()}
                        disabled={loading}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-[colors,transform] hover:text-text-primary active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 motion-reduce:active:scale-100"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        {t('Refresh')}
                    </button>
                </div>

                {data?.network ? (
                    <div className="flex items-center gap-2 text-xs text-text-tertiary">
                        <Wifi size={13} />
                        {/* The interface CLASS, never the network id. The id is a local
                            key; showing it would invite a user to paste it somewhere. */}
                        <span>{t('Current network')}: {data.network.offline ? t('offline') : t(data.network.interfaceClass)}</span>
                    </div>
                ) : null}
            </section>

            {loading && !data ? (
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                    <Loader2 size={14} className="animate-spin" /> {t('Reading measurements…')}
                </div>
            ) : null}

            {!loading && profiles.length === 0 ? (
                <p className="rounded-lg border border-border-subtle bg-bg-input/40 px-3 py-3 text-xs leading-relaxed text-text-secondary">
                    {t('Nothing measured yet. Ask a question and Natively will start learning how your provider behaves.')}
                </p>
            ) : null}

            {current.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('On this network')}</h4>
                    {current.map((p) => (
                        <ProfileCard key={`${p.providerId}|${p.modelId}|${p.networkProfileId}`} p={p} t={t} />
                    ))}
                </section>
            ) : null}

            {others.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                        {t('Other networks and older measurements')}
                    </h4>
                    {others.map((p) => (
                        <ProfileCard key={`${p.providerId}|${p.modelId}|${p.networkProfileId}`} p={p} t={t} dimmed />
                    ))}
                </section>
            ) : null}

            {(data?.secondaryStreams ?? []).some((s) => s.firstTokenTimeouts > 0) ? (
                <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                        {t('Answer improvements')}
                    </h4>
                    {/* This block exists because the failure it reports is otherwise
                        SILENT: when a repair window expires before the provider's first
                        token, the user simply never sees their answer improve, and
                        nothing anywhere says so. */}
                    {(data?.secondaryStreams ?? [])
                        .filter((s) => s.firstTokenTimeouts > 0)
                        .map((s) => (
                            <div key={s.kind} className="rounded-lg border border-border-subtle bg-bg-input/40 px-3 py-2 text-xs text-text-secondary">
                                <span className="font-medium text-text-primary">{t(s.kind)}</span>
                                {' — '}
                                {t('{done} of {total} finished in time.')
                                    .replace('{done}', String(s.completed))
                                    .replace('{total}', String(s.attempts))}
                                {s.maxObservedTtftMs > 0
                                    ? ` ${t('Your provider has taken up to {n}s to start replying.').replace('{n}', (s.maxObservedTtftMs / 1000).toFixed(1))}`
                                    : ''}
                            </div>
                        ))}
                </section>
            ) : null}

            <section className="space-y-2 border-t border-border-subtle pt-4">
                <p className="max-w-xl text-xs leading-relaxed text-text-secondary">
                    {/* Said plainly, because this is the only thing on the page that
                        costs money. Phase 21's rule is that nothing is spent silently;
                        the honest way to honour it in the UI is to state the cost
                        before the button, not after. */}
                    {t('You can also send a few small test requests to measure large-context speed and check image support directly. These use your API key. Most people do not need this — normal use already teaches Natively everything here.')}
                </p>
                <button
                    type="button"
                    onClick={() => void calibrate()}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-[colors,transform] hover:text-text-primary active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 motion-reduce:active:scale-100"
                >
                    {busy === 'calibrate' ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
                    {t('Run calibration')}
                </button>
                {calibrateNote ? <p className="text-[11px] text-text-tertiary">{calibrateNote}</p> : null}
            </section>

            {profiles.length > 0 ? (
                <button
                    type="button"
                    onClick={() => void forget()}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-[colors,transform] hover:text-text-primary active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 motion-reduce:active:scale-100"
                >
                    {busy === '*' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {t('Forget all measurements')}
                </button>
            ) : null}
        </div>
    );
};

const ProfileCard: React.FC<{ p: ProfileRow; t: (s: string) => string; dimmed?: boolean }> = ({ p, t, dimmed }) => {
    const note = confidenceNote(p.confidence, p.sampleCount);
    // Only worth saying when evidence actually moved it. "8.0s (default)" on
    // every row is noise; "2.5s" on the row that changed is information.
    const guardMoved = p.streamIdle.source !== 'shipped_prior';
    return (
        <div className={`rounded-lg border border-border-subtle bg-bg-input/40 px-3 py-3 ${dimmed ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{p.modelId}</div>
                    <div className="text-[11px] text-text-tertiary">{p.providerId} · {p.route.replace(/_/g, ' ')}</div>
                </div>
                <div className={`text-sm font-semibold ${GRADE_TONE[p.grade] ?? GRADE_TONE.unknown}`}>
                    {t(GRADE_LABEL[p.grade] ?? GRADE_LABEL.unknown)}
                    {note ? <span className="ml-2 text-[11px] font-normal text-text-tertiary">{t(note)}</span> : null}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
                {guardMoved ? (
                    <span className="inline-flex items-center gap-1">
                        <Activity size={12} />
                        {t('Stalled replies detected after {n}s').replace('{n}', (p.streamIdle.valueMs / 1000).toFixed(1))}
                    </span>
                ) : null}
                {p.capability.contextWindowTokens > 0 ? (
                    <span>{t('Context')}: {Math.round(p.capability.contextWindowTokens / 1000)}K</span>
                ) : null}
                {p.capability.visionVerdict === 'SUPPORTED' ? <span>{t('Images supported')}</span> : null}
                {p.capability.visionVerdict === 'UNSUPPORTED' ? <span>{t('No image support')}</span> : null}
                {/* Only shown when the fit explains more than it invents. An
                    unactionable projection is a number with no meaning. */}
                {p.projected100k?.actionable ? (
                    <span>
                        {t('Very large requests: about {n}s to start').replace('{n}', (p.projected100k.predictedTtftMs / 1000).toFixed(0))}
                    </span>
                ) : null}
                {p.stale ? <span>{t('measurements are old')}</span> : null}
            </div>

            {p.largeContextWarning ? (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-500">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {/* Phrased as RELIABILITY, never as capability. Repeated failure at
                        a large size is not evidence the model cannot accept it. */}
                    <span>{t(p.largeContextWarning)}</span>
                </div>
            ) : null}
        </div>
    );
};

export default ProviderPerformanceSettings;
export { ProviderPerformanceSettings };
