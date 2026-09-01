import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Cloud, Download, FolderOpen, HardDrive, KeyRound, Loader2, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react';
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

interface LocalCatalogModel {
    id: string;
    name: string;
    runtime: 'onnx' | 'gguf';
    repo: string;
    params: string;
    note: string;
    bytes: number;
    recommended: boolean;
    license: { spdx: string; url: string; commercialUseRestricted: boolean; requiresAcknowledgement: boolean };
    state: 'not-installed' | 'partial' | 'installed';
    bytesOnDisk: number;
    selected: boolean;
    extensionId: string | null;
    extensionInstalled: boolean | null;
    requiresBinary: string | null;
    supported: boolean;
    unsupportedReason: string | null;
    activatable: boolean;
}

interface ExtensionModel {
    key: string;
    format: string;
    approxBytes: number;
    state: 'not-downloaded' | 'downloading' | 'ready' | 'verification-failed' | 'blocked-unacknowledged';
    bytes: number | null;
    reason: string | null;
    license: {
        spdx: string;
        url: string;
        commercialUseRestricted: boolean;
        requiresAcknowledgement: boolean;
        acknowledged: boolean;
    };
}

interface InstalledExtension {
    id: string;
    name: string;
    version: string;
    type: string;
    author: string;
    homepage: string;
    source: string;
    enabled: boolean;
    running: boolean;
    disabledReason: string | null;
    permissions: string[];
    models: ExtensionModel[];
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


/** Sizes in the UI, not in a log. Rounded the way a person reads them. */
function humanBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
    return `${Math.round(bytes / 1e3)} KB`;
}

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
    const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
    const [extensionsAvailable, setExtensionsAvailable] = useState(true);
    const [progress, setProgress] = useState<Record<string, number>>({});
    const [busyModel, setBusyModel] = useState<string | null>(null);
    const [installing, setInstalling] = useState(false);
    const [installError, setInstallError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [catalogModels, setCatalogModels] = useState<LocalCatalogModel[]>([]);
    const [builtInSelected, setBuiltInSelected] = useState(true);
    const [modelProgress, setModelProgress] = useState<Record<string, { fraction: number; file: string }>>({});
    const [busyCatalogId, setBusyCatalogId] = useState<string | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);

    const refreshStatus = useCallback(async () => {
        const next = await window.electronAPI.getRerankerStatus?.();
        if (next) setStatus(next as RerankerStatus);
    }, []);

    const loadCatalogModels = useCallback(async () => {
        const res = await window.electronAPI.listLocalRerankerModels?.();
        if (!res) return;
        setCatalogModels((res.models ?? []) as LocalCatalogModel[]);
        setBuiltInSelected(Boolean(res.builtInSelected));
    }, []);

    useEffect(() => {
        const off = window.electronAPI.onLocalRerankerModelProgress?.(({ id, fraction, currentFile }) => {
            setModelProgress(prev => ({ ...prev, [id]: { fraction, file: currentFile } }));
        });
        return () => { off?.(); };
    }, []);

    const loadExtensions = useCallback(async () => {
        const res = await window.electronAPI.listExtensions?.();
        if (!res) return;
        setExtensionsAvailable(Boolean(res.available));
        setExtensions((res.extensions ?? []) as InstalledExtension[]);
    }, []);

    // Download progress arrives as main-process events rather than a poll,
    // because a poll either lags visibly or costs more than the download.
    useEffect(() => {
        const off = window.electronAPI.onExtensionModelProgress?.(({ id, modelKey, fraction }) => {
            setProgress(prev => ({ ...prev, [`${id}::${modelKey}`]: fraction }));
        });
        return () => { off?.(); };
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
            try {
                await Promise.all([refreshStatus(), loadCatalog(false), loadExtensions(), loadCatalogModels()]);
            } catch (e) {
                // safeHandle does not wrap handler bodies, so an IPC handler that
                // throws rejects here. Without this the panel spins on "Loading…"
                // forever with no retry short of reopening Settings.
                if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [refreshStatus, loadCatalog, loadExtensions, loadCatalogModels]);

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
    const rerankerExtensions = useMemo(
        () => extensions.filter(e => e.type === 'reranker'),
        [extensions],
    );
    const enabledRerankerCount = useMemo(
        () => rerankerExtensions.filter(e => e.enabled).length,
        [rerankerExtensions],
    );

    const installCatalogModel = useCallback(async (id: string) => {
        setBusyCatalogId(id);
        setCatalogError(null);
        try {
            const res = await window.electronAPI.installLocalRerankerModel?.(id);
            if (res && !res.success) {
                setCatalogError(res.message || res.error || t('Download failed.'));
            }
            await loadCatalogModels();
        } finally {
            setBusyCatalogId(null);
            setModelProgress(prev => { const next = { ...prev }; delete next[id]; return next; });
        }
    }, [loadCatalogModels, t]);

    const useCatalogModel = useCallback(async (id: string | null) => {
        setBusyCatalogId(id ?? 'built-in');
        setCatalogError(null);
        try {
            const res = await window.electronAPI.useLocalRerankerModel?.(id);
            // Activation self-tests before committing, so a failure here means
            // the PREVIOUS reranker is still the active one — say that rather
            // than leaving the row looking selected.
            if (res && !res.success) setCatalogError(res.message || res.error || t('Could not activate this reranker.'));
            await Promise.all([loadCatalogModels(), refreshStatus()]);
        } finally {
            setBusyCatalogId(null);
        }
    }, [loadCatalogModels, refreshStatus, t]);

    const removeCatalogModel = useCallback(async (id: string) => {
        setBusyCatalogId(id);
        setCatalogError(null);
        try {
            const res = await window.electronAPI.removeLocalRerankerModel?.(id);
            if (res && !res.success) setCatalogError(res.message || res.error || t('Could not remove this model.'));
            await loadCatalogModels();
        } finally {
            setBusyCatalogId(null);
        }
    }, [loadCatalogModels, t]);

    const installFromFolder = useCallback(async () => {
        setInstalling(true);
        setInstallError(null);
        try {
            const res = await window.electronAPI.installExtensionFromFolder?.();
            if (res && !res.success && res.error !== 'cancelled') {
                setInstallError(res.errors?.join('; ') || res.error || 'Install failed.');
            }
            await loadExtensions();
        } finally {
            setInstalling(false);
        }
    }, [loadExtensions]);

    const downloadModel = useCallback(async (id: string, modelKey: string) => {
        const key = `${id}::${modelKey}`;
        setBusyModel(key);
        try {
            const res = await window.electronAPI.downloadExtensionModel?.(id, modelKey);
            if (res && !res.success) setInstallError(res.message || res.error || 'Download failed.');
            await loadExtensions();
        } finally {
            setBusyModel(null);
            setProgress(prev => { const next = { ...prev }; delete next[key]; return next; });
        }
    }, [loadExtensions]);

    const selectedMissing = useMemo(() => {
        const id = status?.openrouterModel;
        if (!id || catalog.length === 0) return false;
        return !catalog.some(m => m.id === id);
    }, [status?.openrouterModel, catalog]);

    if (loading || !status) {
        return (
            <div className="aip-root space-y-5 pb-10" data-theme={aipTheme}>
                <div className="aip-card p-5 flex items-center gap-2">
                    {loading && !loadError ? (
                        <>
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            <span className="aip-muted text-xs">{t('Loading reranker settings…')}</span>
                        </>
                    ) : (
                        <>
                            <AlertCircle size={14} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                            <span className="aip-muted text-xs flex-1">
                                {loadError ?? t('Could not read the reranker settings.')}
                            </span>
                            <button
                                type="button"
                                className="aip-btn"
                                data-size="sm"
                                onClick={() => {
                                    setLoadError(null);
                                    setLoading(true);
                                    void (async () => {
                                        try {
                                            await Promise.all([refreshStatus(), loadCatalog(false), loadExtensions(), loadCatalogModels()]);
                                        } catch (e) {
                                            setLoadError(e instanceof Error ? e.message : String(e));
                                        } finally {
                                            setLoading(false);
                                        }
                                    })();
                                }}
                            >
                                {t('Try again')}
                            </button>
                        </>
                    )}
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
        setInstallError(null);
        try {
            const res = await window.electronAPI.setRerankerOpenRouterKey?.(keyDraft.trim());
            if (res && res.success === false) {
                // The handler RETURNS a refusal rather than throwing, so the draft
                // must survive it — clearing the field on a failed save loses the
                // key the user just typed and leaves the badge reading "Not set"
                // with nothing shown.
                setInstallError(res.message || res.error || t('Could not save the key.'));
                return;
            }
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
                <>
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

                    {/* Direct install. No extension folder to stage: these download
                        straight from Hugging Face into the directory Natively's own
                        reranker already reads. */}
                    <div className="aip-card p-5 space-y-3">
                        <label className="block text-xs font-medium uppercase tracking-wide aip-hero">
                            {t('Download a different reranker')}
                        </label>
                        <p className="text-[10px] aip-muted">
                            {t('These download directly from Hugging Face. Natively never ships model files — nothing is downloaded until you ask.')}
                        </p>

                        {catalogError && (
                            <div className="aip-inline-warn flex items-start gap-2" role="status">
                                <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span className="min-w-0">{catalogError}</span>
                            </div>
                        )}

                        {/* The bundled model is a row like any other, so "go back to
                            the one that shipped" is one click and not a hunt. */}
                        <div className="aip-card p-3" data-active={builtInSelected ? 'true' : undefined}>
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs truncate">{status.builtIn.name}</div>
                                    <div className="text-[10px] aip-muted truncate">{t('Included with Natively')}</div>
                                </div>
                                {builtInSelected
                                    ? <AipBadge tone="ok" label={t('In use')} />
                                    : (
                                        <button type="button" className="aip-btn" data-size="sm"
                                            disabled={busyCatalogId !== null}
                                            onClick={() => void useCatalogModel(null)}>
                                            <span>{t('Use')}</span>
                                        </button>
                                    )}
                            </div>
                        </div>

                        {catalogModels.map(m => {
                            const prog = modelProgress[m.id];
                            const busy = busyCatalogId === m.id;
                            const installed = m.state === 'installed';
                            const needsExtension = m.runtime === 'gguf' && m.extensionInstalled === false;
                            return (
                                <div key={m.id} className="aip-card p-3 space-y-2" data-active={m.selected ? 'true' : undefined} data-off={m.supported ? undefined : 'true'}>
                                    <div className="flex items-center gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-xs truncate">{m.name}</span>
                                                {m.recommended && m.supported && <AipBadge tone="info" label={t('Recommended')} />}
                                            </div>
                                            <div className="text-[10px] aip-muted truncate">
                                                {[m.params, humanBytes(m.bytes), m.license.spdx,
                                                  m.license.commercialUseRestricted ? t('non-commercial') : null]
                                                    .filter(Boolean).join(' · ')}
                                            </div>
                                        </div>
                                        {m.selected
                                            ? <AipBadge tone="ok" label={t('In use')} />
                                            : installed
                                                ? <AipBadge tone="info" label={t('Downloaded')} />
                                                : null}
                                    </div>

                                    <p className="text-[10px] aip-muted">{m.note}</p>

                                    {/* An entry Core cannot execute says so instead of
                                        offering a button that cannot work. */}
                                    {!m.supported && m.unsupportedReason && (
                                        <div className="aip-inline-warn flex items-start gap-2" role="status">
                                            <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                            <span className="min-w-0">{m.unsupportedReason}</span>
                                        </div>
                                    )}

                                    {needsExtension && (
                                        <p className="text-[10px] aip-muted">
                                            {t('Runs through the')} <code>{m.extensionId}</code> {t('extension, which is not installed yet.')}
                                            {m.requiresBinary ? ` ${t('It also needs')} ${m.requiresBinary} ${t('on your PATH.')}` : ''}
                                        </p>
                                    )}

                                    {busy && prog && (
                                        <div className="text-[10px] aip-muted">
                                            {`${Math.round(prog.fraction * 100)}% · ${humanBytes(Math.round(prog.fraction * m.bytes))} / ${humanBytes(m.bytes)} · ${prog.file}`}
                                        </div>
                                    )}

                                    {m.supported && (
                                        <div className="flex items-center gap-2">
                                            {!installed && (
                                                busy ? (
                                                    <button type="button" className="aip-btn" data-size="sm"
                                                        onClick={() => void window.electronAPI.cancelLocalRerankerModel?.(m.id)}>
                                                        <X size={12} strokeWidth={1.75} aria-hidden="true" />
                                                        <span>{t('Cancel')}</span>
                                                    </button>
                                                ) : (
                                                    <button type="button" className="aip-btn" data-size="sm"
                                                        disabled={busyCatalogId !== null || needsExtension}
                                                        onClick={() => void installCatalogModel(m.id)}>
                                                        <Download size={12} strokeWidth={1.75} aria-hidden="true" />
                                                        <span>{t('Download')}</span>
                                                    </button>
                                                )
                                            )}
                                            {installed && m.activatable && !m.selected && (
                                                <button type="button" className="aip-btn" data-size="sm"
                                                    disabled={busyCatalogId !== null}
                                                    onClick={() => void useCatalogModel(m.id)}>
                                                    {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
                                                    <span>{t('Use')}</span>
                                                </button>
                                            )}
                                            {installed && !m.selected && (
                                                <button type="button" className="aip-btn ml-auto" data-size="sm"
                                                    disabled={busyCatalogId !== null}
                                                    onClick={() => void removeCatalogModel(m.id)}>
                                                    <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                                                    <span>{t('Remove')}</span>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Reranker extensions. Listed here rather than in a separate
                        pane: only one reranker owns the seam, so a second place to
                        configure one would let a user set two that cannot both run. */}
                    <div className="aip-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium uppercase tracking-wide aip-hero flex-1">
                                {t('Reranker extensions')}
                            </label>
                            <button
                                type="button"
                                className="aip-btn"
                                data-size="sm"
                                disabled={installing || !extensionsAvailable}
                                onClick={() => void installFromFolder()}
                            >
                                {installing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                                    : <FolderOpen size={12} strokeWidth={1.75} aria-hidden="true" />}
                                <span>{t('Install from folder')}</span>
                            </button>
                        </div>

                        <p className="text-[10px] aip-muted">
                            {t('An extension teaches Natively to use one other reranking model. Extensions are made by the community, not by Natively, and each carries its own licence. Natively never ships their model files.')}
                        </p>

                        {installError && (
                            <div className="aip-inline-warn flex items-start gap-2" role="status">
                                <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span className="min-w-0">{installError}</span>
                            </div>
                        )}

                        {rerankerExtensions.length === 0 && (
                            <p className="text-[10px] aip-muted">{t('No reranker extensions installed.')}</p>
                        )}

                        {/* Two enabled rerankers is ambiguous, and the registry
                            refuses to choose rather than silently reordering the
                            user's evidence by whichever sorted first. Say so. */}
                        {enabledRerankerCount > 1 && (
                            <div className="aip-inline-warn flex items-start gap-2" role="status">
                                <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{t('More than one reranker extension is turned on, so none of them is being used. Turn off all but one.')}</span>
                            </div>
                        )}

                        {rerankerExtensions.map(ext => (
                            <div key={ext.id} className="aip-card p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs truncate">{ext.name} <span className="aip-muted">{ext.version}</span></div>
                                        <div className="text-[10px] aip-muted truncate">{ext.author} · {ext.id}</div>
                                    </div>
                                    <AipBadge
                                        tone={ext.running ? 'ok' : ext.enabled ? 'info' : 'neutral'}
                                        label={ext.running ? t('Running') : ext.enabled ? t('Starting') : t('Off')}
                                    />
                                </div>

                                {ext.disabledReason && (
                                    <p className="text-[10px] aip-muted">{t('Turned off')}: {ext.disabledReason}</p>
                                )}

                                {ext.models.map(m => {
                                    const key = `${ext.id}::${m.key}`;
                                    const pct = progress[key];
                                    const downloading = busyModel === key || m.state === 'downloading';
                                    const blocked = m.state === 'blocked-unacknowledged';
                                    return (
                                        <div key={m.key} className="space-y-1 border-t border-white/5 pt-2">
                                            <div className="flex items-center gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[11px] truncate">{m.key}</div>
                                                    <div className="text-[10px] aip-muted truncate">
                                                        {[
                                                            m.format.toUpperCase(),
                                                            humanBytes(m.bytes ?? m.approxBytes),
                                                            m.license.spdx,
                                                            m.license.commercialUseRestricted ? t('non-commercial') : null,
                                                        ].filter(Boolean).join(' · ')}
                                                    </div>
                                                </div>
                                                {m.state === 'ready'
                                                    ? <AipBadge tone="ok" label={t('Ready')} />
                                                    : downloading
                                                        ? (
                                                            <button type="button" className="aip-btn" data-size="sm" onClick={() => void window.electronAPI.cancelExtensionModelDownload?.(ext.id, m.key)}>
                                                                <X size={12} strokeWidth={1.75} aria-hidden="true" />
                                                                <span>{t('Cancel')}</span>
                                                            </button>
                                                        )
                                                        : (
                                                            <button
                                                                type="button"
                                                                className="aip-btn"
                                                                data-size="sm"
                                                                disabled={blocked}
                                                                title={blocked ? (m.reason ?? undefined) : undefined}
                                                                onClick={() => void downloadModel(ext.id, m.key)}
                                                            >
                                                                <Download size={12} strokeWidth={1.75} aria-hidden="true" />
                                                                <span>{t('Download')}</span>
                                                            </button>
                                                        )}
                                            </div>

                                            {downloading && (
                                                <div className="text-[10px] aip-muted">
                                                    {typeof pct === 'number'
                                                        ? `${Math.round(pct * 100)}% · ${humanBytes(Math.round(pct * m.approxBytes))} / ${humanBytes(m.approxBytes)}`
                                                        : t('Starting…')}
                                                </div>
                                            )}

                                            {m.state === 'verification-failed' && (
                                                <div className="aip-inline-warn flex items-start gap-2" role="status">
                                                    <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                                    <span className="min-w-0">{m.reason ?? t('The downloaded file did not match its expected checksum.')}</span>
                                                </div>
                                            )}

                                            {/* Consent, not a formality. The model will not load
                                                without it, even if the file is already on disk. */}
                                            {m.license.requiresAcknowledgement && !m.license.acknowledged && (
                                                <div className="space-y-1">
                                                    <p className="text-[10px] aip-muted">
                                                        {t('This model is licensed')} {m.license.spdx}
                                                        {m.license.commercialUseRestricted ? ` — ${t('it may not be used commercially')}` : ''}
                                                        {'. '}
                                                        {t('Natively does not distribute it. Read the licence before downloading.')}
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <button type="button" className="aip-btn" data-size="sm" onClick={() => window.electronAPI.openExternal?.(m.license.url)}>
                                                            <span>{t('Read the licence')}</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="aip-btn"
                                                            data-size="sm"
                                                            onClick={async () => {
                                                                await window.electronAPI.acknowledgeExtensionLicense?.(ext.id, m.key);
                                                                await loadExtensions();
                                                            }}
                                                        >
                                                            <Check size={12} strokeWidth={1.75} aria-hidden="true" />
                                                            <span>{t('I accept these terms')}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                <div className="flex items-center gap-2 pt-1">
                                    <label className="flex items-center gap-2 text-[11px] flex-1">
                                        <input
                                            type="checkbox"
                                            checked={ext.enabled}
                                            disabled={!ext.enabled && !ext.models.every(m => m.state === 'ready')}
                                            onChange={async (e) => {
                                                await window.electronAPI.setExtensionEnabled?.(ext.id, e.target.checked);
                                                await Promise.all([loadExtensions(), refreshStatus()]);
                                            }}
                                        />
                                        <span>
                                            {t('Use this reranker')}
                                            {!ext.enabled && !ext.models.every(m => m.state === 'ready') && (
                                                <span className="aip-muted"> · {t('download its model first')}</span>
                                            )}
                                        </span>
                                    </label>
                                    <button
                                        type="button"
                                        className="aip-btn"
                                        data-size="sm"
                                        disabled={ext.enabled}
                                        title={ext.enabled ? t('Turn it off before removing it.') : undefined}
                                        onClick={async () => {
                                            await window.electronAPI.removeExtension?.(ext.id);
                                            await Promise.all([loadExtensions(), refreshStatus()]);
                                        }}
                                    >
                                        <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                                        <span>{t('Remove')}</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
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
                        {installError && (
                            <div className="aip-inline-warn flex items-start gap-2" role="status">
                                <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span className="min-w-0">{installError}</span>
                            </div>
                        )}
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
