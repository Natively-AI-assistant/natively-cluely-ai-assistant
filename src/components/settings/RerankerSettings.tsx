import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Cloud, HardDrive, KeyRound, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { AIP_CSS, AipBadge, type AipTone } from './AIProvidersSettings';

/**
 * Settings > Reranker.
 *
 * ONE section, with the provider as a choice inside it. Splitting it into
 * "Local Reranker" and "OpenRouter Reranker" panes would let a user configure
 * two things that cannot both be active — only one reranker owns the seam.
 *
 * Configured independently of the embedding model on purpose. Embedding
 * retrieval finds the candidate set; reranking decides the order of that set,
 * and a local embedder with a hosted reranker (or the reverse) is a reasonable
 * thing to want.
 */

type RerankerProvider = 'local' | 'openrouter';
type ModelGroup = 'recommended' | 'quality' | 'fast' | 'multimodal' | 'other';

interface CatalogModel {
    id: string;
    label: string;
    vendor: string;
    contextLength?: number;
    free: boolean;
    multimodal: boolean;
    group: ModelGroup;
    note?: string;
    description?: string;
}

interface RerankerStatus {
    provider: RerankerProvider;
    openrouterModel: string | null;
    candidateCount: number | null;
    topN: number | null;
    fallbackToLocal: boolean;
    hasApiKey: boolean;
    eligible: boolean;
    ineligibleReason: string | null;
    ineligibleMessage: string | null;
    builtIn: { id: string; name: string; bundled: boolean; cached?: boolean; available?: boolean };
    effective: { kind: 'local' | 'extension' | 'openrouter'; id: string | null };
    lastTest: { at: string; model: string; latencyMs: number; ok: boolean; failure?: string } | null;
}

interface TestResult {
    success: boolean;
    latencyMs?: number;
    costUsd?: number | null;
    message?: string;
    error?: string;
}

const GROUP_ORDER: ModelGroup[] = ['recommended', 'quality', 'fast', 'multimodal', 'other'];

/**
 * Group headings say what the group IS, not that it is best. OpenRouter's own
 * rankings are usage-based; nothing here should read as a quality verdict the
 * app has not measured.
 */
const GROUP_LABELS: Record<ModelGroup, string> = {
    recommended: 'Recommended',
    quality: 'Highest quality',
    fast: 'Fast and economical',
    multimodal: 'Multimodal',
    other: 'Other models',
};

/** Depths offered. Never 50 — see the candidate-depth note in the panel. */
const CANDIDATE_CHOICES = [5, 10, 15, 20];

export const RerankerSettings: React.FC = () => {
    const t = useT();
    const aipTheme = useResolvedTheme();

    const [status, setStatus] = useState<RerankerStatus | null>(null);
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [catalogStale, setCatalogStale] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [keyDraft, setKeyDraft] = useState('');
    const [savingKey, setSavingKey] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

    const refreshStatus = useCallback(async () => {
        const next = await window.electronAPI.getRerankerStatus?.();
        if (next) setStatus(next as RerankerStatus);
    }, []);

    const loadCatalog = useCallback(async (refresh = false) => {
        const res = await window.electronAPI.getRerankerCatalog?.({ refresh });
        if (!res) return;
        setCatalog((res.models ?? []) as CatalogModel[]);
        setCatalogStale(Boolean(res.stale));
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await Promise.all([refreshStatus(), loadCatalog(false)]);
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [refreshStatus, loadCatalog]);

    const setConfig = useCallback(async (next: Parameters<NonNullable<typeof window.electronAPI.setRerankerConfig>>[0]) => {
        await window.electronAPI.setRerankerConfig?.(next);
        await refreshStatus();
    }, [refreshStatus]);

    const grouped = useMemo(() => {
        const byGroup = new Map<ModelGroup, CatalogModel[]>();
        for (const m of catalog) {
            const list = byGroup.get(m.group) ?? [];
            list.push(m);
            byGroup.set(m.group, list);
        }
        // Only render a group that actually has a model in the CURRENT catalogue.
        return GROUP_ORDER
            .map(g => ({ group: g, models: byGroup.get(g) ?? [] }))
            .filter(g => g.models.length > 0);
    }, [catalog]);

    /**
     * A selected model that is no longer in the catalogue must still be visible,
     * marked unavailable. Dropping it would leave the panel showing nothing
     * selected while the setting still holds it.
     */
    const selectedMissing = useMemo(() => {
        const id = status?.openrouterModel;
        if (!id || catalog.length === 0) return false;
        return !catalog.some(m => m.id === id);
    }, [status?.openrouterModel, catalog]);

    if (loading || !status) {
        return (
            <div className="aip-root space-y-5 pb-10" data-theme={aipTheme}>
                <div className="aip-card p-5 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    <span className="aip-muted text-xs">{t('Loading reranker settings…')}</span>
                </div>
                <style>{AIP_CSS}</style>
            </div>
        );
    }

    const effectiveLabel = status.effective.kind === 'openrouter'
        ? (catalog.find(m => m.id === status.effective.id)?.label ?? status.effective.id ?? t('OpenRouter'))
        : status.effective.kind === 'extension'
            ? status.effective.id ?? t('Extension')
            : status.builtIn.name;

    const effectiveTone: AipTone = status.effective.kind === 'local' ? 'neutral' : 'ok';
    const effectiveLocation = status.effective.kind === 'openrouter' ? t('Hosted') : t('On-device');

    const saveKey = async () => {
        if (!keyDraft.trim()) return;
        setSavingKey(true);
        try {
            await window.electronAPI.setRerankerOpenRouterKey?.(keyDraft.trim());
            setKeyDraft('');
            await Promise.all([refreshStatus(), loadCatalog(true)]);
        } finally {
            setSavingKey(false);
        }
    };

    const runTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await window.electronAPI.testReranker?.({});
            setTestResult((res ?? { success: false, message: t('No response.') }) as TestResult);
            await refreshStatus();
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="aip-root space-y-5 pb-10" data-theme={aipTheme} data-settings-stagger>
            <header className="space-y-1">
                <h3 className="aip-title">{t('Reranker')}</h3>
                <p className="aip-subtitle">
                    {t('After Natively searches your documents, the reranker decides which passages actually answer the question. It is chosen separately from your embedding model and your AI model.')}
                </p>
            </header>

            {/* What is actually running right now — resolved the same way retrieval
                resolves it, so this card cannot disagree with reality. */}
            <div className="aip-card p-5">
                <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">
                            {t('Active Reranker')}
                        </label>
                        <p className="text-[10px] aip-muted mt-0.5 truncate">
                            {`${effectiveLabel} · ${effectiveLocation}`}
                        </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                        {status.effective.kind === 'openrouter'
                            ? <Cloud size={14} strokeWidth={1.75} aria-hidden="true" />
                            : <HardDrive size={14} strokeWidth={1.75} aria-hidden="true" />}
                        <AipBadge tone={effectiveTone} label={status.effective.kind === 'local' ? t('Built in') : t('Active')} />
                    </div>
                </div>

                {/* The user picked OpenRouter but something stops it. Say so, and say
                    what is running instead — never switch silently. */}
                {status.provider === 'openrouter' && !status.eligible && (
                    <div className="aip-inline-warn flex items-start gap-2 pt-3" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="min-w-0">
                            {status.ineligibleMessage}{' '}
                            {t('Your local reranker is being used until this is resolved.')}
                        </span>
                    </div>
                )}
            </div>

            {/* Provider */}
            <div className="aip-card p-5 space-y-3">
                <label className="block text-xs font-medium uppercase tracking-wide aip-hero">{t('Provider')}</label>
                <div className="flex gap-2 flex-wrap">
                    {(['local', 'openrouter'] as RerankerProvider[]).map(p => (
                        <button
                            key={p}
                            type="button"
                            className="aip-btn"
                            data-active={status.provider === p ? 'true' : undefined}
                            aria-pressed={status.provider === p}
                            onClick={() => void setConfig({ provider: p })}
                        >
                            {p === 'local' ? <HardDrive size={13} strokeWidth={1.75} /> : <Cloud size={13} strokeWidth={1.75} />}
                            <span>{p === 'local' ? t('Local') : t('OpenRouter')}</span>
                            {status.provider === p && <Check size={13} strokeWidth={1.75} className="aip-accent-fg" aria-hidden="true" />}
                        </button>
                    ))}
                </div>
                <p className="text-[10px] aip-muted">
                    {status.provider === 'local'
                        ? t('Everything stays on this device. Works offline.')
                        : t('Hosted reranking sends the retrieved document text to OpenRouter. For fully private retrieval, use a local reranker.')}
                </p>
            </div>

            {status.provider === 'local' && (
                <div className="aip-card aip-provider">
                    <div className="aip-provider-head">
                        <HardDrive size={16} strokeWidth={1.75} aria-hidden="true" />
                        <h4 className="aip-card-title truncate min-w-0">{status.builtIn.name}</h4>
                        <div className="ml-auto flex items-center gap-2 shrink-0">
                            <AipBadge
                                tone={status.builtIn.available ? 'ok' : status.builtIn.cached ? 'warn' : 'neutral'}
                                label={status.builtIn.available ? t('Ready') : status.builtIn.cached ? t('Downloaded') : t('Not loaded')}
                            />
                        </div>
                    </div>
                    <p className="text-[10px] aip-muted px-1 pb-1">
                        {t('Included with Natively. Runs on this device and needs no account.')}
                    </p>
                </div>
            )}

            {status.provider === 'openrouter' && (
                <>
                    {/* Key. Presence only — the stored key is never read back into
                        the renderer, so there is nothing here to leak. */}
                    <div className="aip-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium uppercase tracking-wide aip-hero flex-1">
                                {t('OpenRouter API key')}
                            </label>
                            <AipBadge tone={status.hasApiKey ? 'ok' : 'warn'} label={status.hasApiKey ? t('Configured') : t('Not set')} />
                        </div>
                        <p className="text-[10px] aip-muted">
                            {t('This is the same OpenRouter key Natively uses elsewhere. Setting it here updates it everywhere.')}
                        </p>
                        <div className="aip-provider-row">
                            <div className="aip-provider-field">
                                <div className="aip-field">
                                    <KeyRound size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                    <input
                                        type="password"
                                        className="aip-input"
                                        value={keyDraft}
                                        placeholder={status.hasApiKey ? '••••••••••••••••' : 'sk-or-v1-…'}
                                        onChange={(e) => setKeyDraft(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                            </div>
                            <button type="button" className="aip-btn" disabled={!keyDraft.trim() || savingKey} onClick={() => void saveKey()}>
                                {savingKey ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                                <span>{t('Save')}</span>
                            </button>
                        </div>
                    </div>

                    {/* Model picker */}
                    <div className="aip-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium uppercase tracking-wide aip-hero flex-1">{t('Model')}</label>
                            <button
                                type="button"
                                className="aip-btn"
                                data-size="sm"
                                disabled={refreshing}
                                onClick={async () => { setRefreshing(true); try { await loadCatalog(true); } finally { setRefreshing(false); } }}
                            >
                                <RefreshCw size={12} strokeWidth={1.75} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
                                <span>{t('Refresh')}</span>
                            </button>
                        </div>

                        {catalogStale && (
                            <div className="aip-inline-warn flex items-start gap-2" role="status">
                                <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{t('Could not reach OpenRouter. Showing the models from the last successful check.')}</span>
                            </div>
                        )}

                        {selectedMissing && (
                            <div className="aip-inline-warn flex items-start gap-2" role="status">
                                <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span>
                                    {t('The selected reranker is no longer offered by OpenRouter. Your local reranker will be used until you pick another.')}
                                </span>
                            </div>
                        )}

                        {catalog.length === 0 && (
                            <p className="text-[10px] aip-muted">{t('No rerank models available right now.')}</p>
                        )}

                        {grouped.map(({ group, models }) => (
                            <div key={group} className="space-y-1">
                                <div className="text-[10px] uppercase tracking-wide aip-muted pt-1">{t(GROUP_LABELS[group])}</div>
                                {models.map(m => {
                                    const selected = status.openrouterModel === m.id;
                                    const open = expanded === m.id;
                                    return (
                                        <div key={m.id} className="aip-card p-3" data-active={selected ? 'true' : undefined}>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    className="min-w-0 flex-1 text-left"
                                                    onClick={() => void setConfig({ openrouterModel: m.id })}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="truncate text-xs">{m.label}</span>
                                                        {selected && <Check size={13} strokeWidth={1.75} className="aip-accent-fg shrink-0" aria-hidden="true" />}
                                                    </div>
                                                    <div className="text-[10px] aip-muted truncate">
                                                        {[m.vendor, m.note].filter(Boolean).join(' · ')}
                                                    </div>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="aip-btn shrink-0"
                                                    data-size="sm"
                                                    aria-expanded={open}
                                                    onClick={() => setExpanded(open ? null : m.id)}
                                                >
                                                    <ChevronDown size={12} strokeWidth={1.75} style={{ transform: open ? 'rotate(180deg)' : undefined }} aria-hidden="true" />
                                                    <span>{t('Details')}</span>
                                                </button>
                                            </div>
                                            {open && (
                                                <div className="pt-2 text-[10px] aip-muted space-y-1">
                                                    <div><code>{m.id}</code></div>
                                                    {m.contextLength ? <div>{t('Context')}: {m.contextLength.toLocaleString()} {t('tokens')}</div> : null}
                                                    <div>{t('Input')}: {m.multimodal ? t('text and images') : t('text')}</div>
                                                    {/* Deliberately no price. OpenRouter's model list reports
                                                        pricing 0 for every rerank model, including paid ones,
                                                        so any figure here would read as "free" and be wrong.
                                                        The real charge is shown after a Test, from the
                                                        response's own usage.cost. */}
                                                    <div>{t('Pricing is not published in OpenRouter\'s model list. Run a test to see the actual charge for one request.')}</div>
                                                    {m.description ? <div className="line-clamp-3">{m.description}</div> : null}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    {/* Depth */}
                    <div className="aip-card p-5 space-y-3">
                        <label className="block text-xs font-medium uppercase tracking-wide aip-hero">{t('Candidates to rerank')}</label>
                        <div className="flex gap-2 flex-wrap">
                            {CANDIDATE_CHOICES.map(n => (
                                <button
                                    key={n}
                                    type="button"
                                    className="aip-btn"
                                    data-active={status.candidateCount === n ? 'true' : undefined}
                                    onClick={() => void setConfig({ candidateCount: n })}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] aip-muted">
                            {t('More candidates can improve the answer but cost more and take longer. Leave this alone unless you have a reason.')}
                        </p>
                    </div>

                    {/* Fallback — opt-in, because a silent substitution reorders
                        evidence with a model the user did not choose. */}
                    <div className="aip-card p-5 space-y-2">
                        <label className="flex items-center gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={status.fallbackToLocal}
                                onChange={(e) => void setConfig({ fallbackToLocal: e.target.checked })}
                            />
                            <span>{t('Use the local reranker if OpenRouter is unavailable')}</span>
                        </label>
                        <p className="text-[10px] aip-muted">
                            {t('Off by default. When off, a failed hosted rerank leaves the search results in their original order rather than quietly reordering them with a different model.')}
                        </p>
                    </div>

                    {/* Test */}
                    <div className="aip-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium uppercase tracking-wide aip-hero flex-1">{t('Test connection')}</label>
                            <button
                                type="button"
                                className="aip-btn"
                                disabled={testing || !status.hasApiKey || !status.openrouterModel}
                                onClick={() => void runTest()}
                            >
                                {testing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                                <span>{t('Test')}</span>
                            </button>
                        </div>
                        <p className="text-[10px] aip-muted">
                            {t('Sends one real rerank request using the selected model, through the same path retrieval uses.')}
                        </p>
                        {testResult && (
                            <div className={testResult.success ? 'aip-inline-ok flex items-start gap-2' : 'aip-inline-warn flex items-start gap-2'} role="status">
                                {testResult.success
                                    ? <Check size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                    : <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />}
                                <span className="min-w-0">
                                    {testResult.success
                                        // "Rerank request latency" — this includes the network round
                                        // trip and is not model inference time.
                                        ? `${t('Connected')} · ${t('Rerank request latency')}: ${Math.round(testResult.latencyMs ?? 0)} ms${
                                            typeof testResult.costUsd === 'number' ? ` · ${t('Cost')}: $${testResult.costUsd.toFixed(6)}` : ''}`
                                        : testResult.message}
                                </span>
                            </div>
                        )}
                        {!testResult && status.lastTest && (
                            <p className="text-[10px] aip-muted">
                                {status.lastTest.ok
                                    ? `${t('Last successful test')}: ${Math.round(status.lastTest.latencyMs)} ms`
                                    : `${t('Last test failed')}: ${status.lastTest.failure}`}
                            </p>
                        )}
                    </div>

                    <div className="aip-card p-5 flex items-start gap-2">
                        <ShieldAlert size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-[10px] aip-muted">
                            {t('Only your question and the retrieved passages are sent — never whole files, and never your file names or paths. For fully local retrieval, choose the Local provider.')}
                        </p>
                    </div>
                </>
            )}

            <style>{AIP_CSS}</style>
        </div>
    );
};

export default RerankerSettings;
