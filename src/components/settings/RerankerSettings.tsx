import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Cloud, Download, ExternalLink, Filter, FolderOpen, HardDrive, KeyRound, Loader2, Monitor, Puzzle, RefreshCw, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { AIP_CSS, AipBadge, AipModelList, AipProviderMark, AipSelect, AipSwitch, type AipSelectOption, type AipTone } from './AIProvidersSettings';
import { isMac, isWindows } from '../../utils/platformUtils';

/**
 * "Built-in" / Local model tile mark matching EmbeddingSettings design.
 */
/**
 * A model gets TWO names — the same rule EmbeddingSettings uses, and the reason
 * these two panels finally read alike.
 *
 * Closed, the trigger is a statement of fact: the model you are using. Open,
 * the list is a comparison, and there the qualifier is the whole point — the
 * same reranker is reachable locally, through OpenRouter and through Jina, and
 * the rows have to be told apart.
 *
 * `voyage/rerank-2.5-lite` -> `rerank-2.5-lite`. The LAST path segment: taking
 * the first type-checks, passes a curated-label case, and silently renames
 * every hosted model to its vendor.
 */
const bareModelName = (label: string): string => {
    // TWO prefix shapes, because the two catalogues store different things.
    //
    // openrouterRerankModels.ts sets `label` from OpenRouter's `name`, which is
    // a DISPLAY name of the form `Vendor: Model` — "Voyage AI by MongoDB:
    // Rerank 2.5 Lite". openrouterEmbeddingModels.ts sets `label` from the id
    // instead (`voyage/voyage-4-lite`), which is why the embedding panel only
    // ever needed the slash case and this one does not.
    //
    // Strip the vendor prefix first, then any path namespace. Missing this made
    // the closed trigger read "Voyage AI by MongoDB: Rerank 2.5 Lite" — the
    // vendor said twice over, in the one place that should name only the model.
    const colon = label.indexOf(': ');
    const afterVendor = colon > 0 ? label.slice(colon + 2) : label;
    const segments = afterVendor.split('/');
    return segments[segments.length - 1] || afterVendor;
};

/**
 * Drop the acquirer from a vendor's name.
 *
 * OpenRouter writes the full corporate attribution into its display label —
 * "Voyage AI by MongoDB: Rerank 2.5 Lite", "Qwen by Alibaba: ...". Who owns the
 * lab is not what someone picking a reranker is choosing between, and it pushes
 * the actual model out of a narrow control.
 *
 * Only the VENDOR segment is touched, never the model: the split is on the
 * first `: `, so a model whose own name contains " by " survives.
 */
const trimVendorAttribution = (label: string): string => {
    const colon = label.indexOf(': ');
    if (colon <= 0) return label;
    const vendor = label.slice(0, colon).replace(/ by .+$/, '');
    return vendor + label.slice(colon);
};

/**
 * `provider/model`, for the open menu. Provider IDs, not display names, because
 * a path segment is built from the short single tokens the catalogue defines —
 * `local`, `openrouter`, `jina`, `extension`.
 *
 * Qualifying the BARE name matters: a hosted label may already be namespaced
 * (`voyage/rerank-2.5-lite`), and qualifying that raw would render
 * `openrouter/voyage/rerank-2.5-lite` — three names for one model.
 */
const qualifiedModelName = (providerId: string, label: string): string =>
    `${providerId}/${bareModelName(label)}`;

const PlatformMark: React.FC = () => (
    <span className="aip-tile aip-tile--mark" aria-hidden="true" title={isMac ? 'macOS' : isWindows ? 'Windows' : 'This device'}>
        {isMac ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
        ) : isWindows ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M1.5 3.2 7 2.4v5.1H1.5V3.2Zm0 8.3H7v5.1l-5.5-.8V8.5Zm6.5-6.2 6.5-.9v6.4H8V2.3Zm0 6.2h6.5v6.4L8 14V8.5Z" />
            </svg>
        ) : (
            <Monitor size={16} strokeWidth={1.75} />
        )}
    </span>
);

type RerankerProvider = 'local' | 'openrouter' | 'jina';
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
    jinaModel: string | null;
    /** The model id for whichever hosted provider is selected. */
    hostedModel: string | null;
    candidateCount: number | null;
    fallbackToLocal: boolean;
    hasApiKey: boolean;
    eligible: boolean;
    ineligibleReason: string | null;
    ineligibleMessage: string | null;
    builtIn: { id: string; name: string; bundled: boolean; cached?: boolean; available?: boolean };
    selectedLocal: { id: string; name: string } | null;
    effective: { kind: 'local' | 'extension' | 'openrouter' | 'jina'; id: string | null };
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

interface ExtensionVariantGroup {
    id: string;
    label: string;
    files: ExtensionModel[];
    totalBytes: number;
    allReady: boolean;
    anyDownloading: boolean;
    anyBlocked: boolean;
    anyFailed: boolean;
    unacknowledgedLicense: ExtensionModel['license'] | null;
    format: string;
    spdx: string;
    commercialUseRestricted: boolean;
}

function formatModelKeyLabel(rawKey: string): string {
    // 1. Strip file suffixes
    let str = rawKey.replace(/-(model|tokenizer|config|weights|bin|safetensors|vocab|json)$/i, '');

    // 2. Normalize quantization tokens: Q4_K_M, q4_k_m, Q4KM, q4km -> Q4
    str = str.replace(/[-_]?(q4_k_m|q4km|q4_0|q4_1)/i, ' Q4');
    str = str.replace(/[-_]?(q8_0|q8km|q8_1)/i, ' Q8');
    str = str.replace(/[-_]?(q5_k_m|q5km|q5_0)/i, ' Q5');

    // Split by hyphens, underscores, or spaces
    const parts = str.split(/[-_\s]+/).filter(Boolean);

    return parts.map(p => {
        const lower = p.toLowerCase();
        if (/^\d+(\.\d+)?[mbk]$/i.test(p)) return p.toUpperCase();
        if (/^v\d+(\.\d+)?$/i.test(p)) return lower;
        if (lower === 'bge') return 'BGE';
        if (lower === 'qwen3' || lower === 'qwen') return 'Qwen3';
        if (lower === 'jina') return 'Jina';
        if (lower === 'ettin') return 'Ettin';
        if (lower === 'mxbai') return 'mxbai';
        if (lower === 'reranker' || lower === 'rerank') return 'Reranker';
        if (lower === 'q4' || lower === 'q8' || lower === 'q5') return lower.toUpperCase();
        return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
}

function getExtensionVariantGroups(models: ExtensionModel[]): ExtensionVariantGroup[] {
    const groupMap = new Map<string, ExtensionModel[]>();
    for (const m of models) {
        const baseId = m.key.replace(/-(model|tokenizer|config|weights|bin|safetensors|vocab|json)$/i, '');
        if (!groupMap.has(baseId)) groupMap.set(baseId, []);
        groupMap.get(baseId)!.push(m);
    }

    const groups: ExtensionVariantGroup[] = [];
    groupMap.forEach((files, baseId) => {
        const totalBytes = files.reduce((acc, f) => acc + (f.bytes ?? f.approxBytes ?? 0), 0);
        const allReady = files.every(f => f.state === 'ready');
        const anyDownloading = files.some(f => f.state === 'downloading');
        const anyBlocked = files.some(f => f.state === 'blocked-unacknowledged');
        const anyFailed = files.some(f => f.state === 'verification-failed');
        const unack = files.find(f => f.license.requiresAcknowledgement && !f.license.acknowledged)?.license ?? null;
        const format = files[0]?.format?.toUpperCase() || 'ONNX';
        const spdx = files[0]?.license.spdx || 'Apache-2.0';
        const commercialUseRestricted = files.some(f => f.license.commercialUseRestricted);

        const label = formatModelKeyLabel(files.length === 1 ? files[0].key : baseId);

        groups.push({
            id: baseId,
            label,
            files,
            totalBytes,
            allReady,
            anyDownloading,
            anyBlocked,
            anyFailed,
            unacknowledgedLicense: unack,
            format,
            spdx,
            commercialUseRestricted,
        });
    });

    return groups;
}

interface TestResult {
    success: boolean;
    latencyMs?: number;
    costUsd?: number | null;
    message?: string;
    error?: string;
    /**
     * Whether the measured latency can actually rerank inside the budget.
     * A probe that says "ok, 2052ms" without this reported success for a model
     * that lost its race on every query and changed nothing.
     */
    budgetFit?: {
        liveBudgetMs: number;
        manualBudgetMs: number;
        fitsLive: boolean;
        fitsManual: boolean;
        warning?: string;
    };
}

const CANDIDATE_CHOICES = [5, 10, 15, 20];

function humanBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
    return `${Math.round(bytes / 1e3)} KB`;
}

interface FloatingSelectOption {
    id: string;
    name: string;
    /** Shown on the CLOSED trigger instead of `name`. See bareModelName. */
    triggerName?: string;
}

interface FloatingSelectProps {
    value: string;
    options: FloatingSelectOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    containerClassName?: string;
    ariaLabel?: string;
    title?: string;
    disabledHint?: string;
}

/**
 * Floating select matching EmbeddingModelSelect design in EmbeddingSettings.
 * Menu floats absolutely so opening it does NOT expand or stretch the parent card container.
 */
const RerankerModelSelect: React.FC<FloatingSelectProps> = ({
    value,
    options,
    onChange,
    placeholder,
    disabled = false,
    className = '',
    containerClassName = 'relative min-w-[200px] max-w-[320px] w-full sm:w-64',
    ariaLabel,
    title,
    disabledHint,
}) => {
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

    const selectedOption = options.find(o => o.id === value);
    // triggerName first: closed, the control names the model, not the route.
    const resolvedLabel = selectedOption
        ? (selectedOption.triggerName || selectedOption.name)
        : (placeholder || t('Select reranker'));

    return (
        <div className={containerClassName} ref={containerRef}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                title={disabled ? disabledHint || title : title}
                disabled={disabled}
                className={`aip-select-trigger cursor-pointer flex items-center justify-between w-full ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
            >
                <span className="truncate pr-2 text-xs font-medium text-white">{resolvedLabel}</span>
                <ChevronDown size={14} strokeWidth={1.75} className={`aip-select-chevron transition-transform duration-150 shrink-0 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {isOpen && (
                <div
                    role="listbox"
                    className="aip-float aip-scroll-y aip-panel-fade absolute top-full right-0 mt-1.5 w-full min-w-[240px] z-50 max-h-64 p-1 custom-scrollbar shadow-2xl rounded-md border border-white/10 bg-[#161618]"
                >
                    {options.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={value === option.id}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange(option.id);
                                setIsOpen(false);
                            }}
                            className={`aip-select-option flex items-center justify-between w-full text-left px-3 py-2 rounded-md text-xs cursor-pointer transition-colors hover:bg-white/10 ${value === option.id ? 'aip-text font-medium bg-white/5' : ''}`}
                        >
                            <span className="truncate flex-1">{option.name}</span>
                            {value === option.id && (
                                <Check size={13} strokeWidth={1.75} className="aip-accent-fg shrink-0 ml-2" aria-hidden="true" />
                            )}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="aip-select-empty px-3 py-2 text-xs aip-muted">{t('No rerankers available')}</div>
                    )}
                </div>
            )}
        </div>
    );
};


/**
 * What the panel shows before the first IPC reply lands.
 *
 * AI Providers renders immediately and fills in; this does the same. The
 * alternative — gating the whole panel on a status call — is what made this tab
 * sit on skeletons whenever that call was slow, and the call turned out to be
 * loading a model.
 *
 * Every value here is the conservative truth for an unconfigured install, so a
 * first paint that is replaced a moment later never says anything false.
 */
const INITIAL_STATUS: RerankerStatus = {
    provider: 'local',
    openrouterModel: null,
    jinaModel: null,
    hostedModel: null,
    candidateCount: null,
    fallbackToLocal: false,
    hasApiKey: false,
    eligible: false,
    ineligibleReason: null,
    ineligibleMessage: null,
    // The placeholder shown before reranker:get-status answers. It named
    // bge-reranker-base, which is no longer bundled — so the built-in row read
    // as the wrong model for the first frame of every visit to this panel.
    builtIn: { id: 'ms-marco-MiniLM-L-6-v2', name: 'MS MARCO MiniLM L6', bundled: true },
    selectedLocal: null,
    effective: { kind: 'local', id: 'ms-marco-MiniLM-L-6-v2' },
    lastTest: null,
};

export const RerankerSettings: React.FC = () => {
    const t = useT();
    const aipTheme = useResolvedTheme();

    const [status, setStatus] = useState<RerankerStatus>(INITIAL_STATUS);
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [catalogStale, setCatalogStale] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    // Keyed by provider id, not a single draft: OpenRouter and Jina each have
    // their own credential, and one shared draft would let a keystroke meant
    // for one card be saved into the other.
    const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
    const [savingKeyFor, setSavingKeyFor] = useState<string | null>(null);
    const [savedKeyFor, setSavedKeyFor] = useState<string | null>(null);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
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
    const [hostedProviders, setHostedProviders] = useState<Array<{
        id: 'openrouter' | 'jina'; name: string; keyUrl: string; keyPlaceholder: string;
        staticCatalogue: boolean; hasApiKey: boolean;
        models: Array<{ id: string; label: string; note?: string; recommended?: boolean }>;
    }>>([]);

    // Model Library UI Optimization States
    const [filterTab, setFilterTab] = useState<'all' | 'installed' | 'recommended'>('all');
    const [modelQuery, setModelQuery] = useState('');
    const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
    const [expandedFileDrawers, setExpandedFileDrawers] = useState<Record<string, boolean>>({});

    const refreshStatus = useCallback(async () => {
        const next = await window.electronAPI.getRerankerStatus?.();
        if (next) setStatus(next as RerankerStatus);
    }, []);

    // Every hosted card is rendered from this list, so an empty list means no
    // key field at all — the failure that made Jina v3.5 unreachable. If
    // discovery fails, fall back to the one provider whose shape this panel
    // has always known, rather than rendering nothing.
    const loadHostedProviders = useCallback(async () => {
        try {
            const res = await window.electronAPI.getRerankerHostedProviders?.();
            if (res?.providers?.length) { setHostedProviders(res.providers as never); return; }
        } catch { /* fall through to the built-in descriptor */ }
        // Mirrors HOSTED_RERANK_PROVIDERS. Listing OpenRouter alone here meant
        // that when discovery degraded, the Jina card vanished AND the fallback
        // copy (built from this list) went back to naming one provider for a
        // switch that governs both. Models stay empty on this path — a name and
        // a key field is the useful degradation; the catalogue is not.
        setHostedProviders(cur => (cur.length ? cur : [{
            id: 'openrouter', name: 'OpenRouter',
            keyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-v1-…',
            staticCatalogue: false, hasApiKey: false, models: [],
        }, {
            id: 'jina', name: 'Jina AI',
            keyUrl: 'https://jina.ai/api-dashboard/', keyPlaceholder: 'jina_…',
            staticCatalogue: true, hasApiKey: false, models: [],
        }]));
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
                await Promise.all([refreshStatus(), loadCatalog(false), loadExtensions(), loadCatalogModels(), loadHostedProviders()]);
            } catch (e) {
                // safeHandle does not wrap handler bodies, so a throwing IPC
                // handler rejects here. The panel is already on screen; this
                // only adds the strip that explains why parts of it are empty.
                if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => { cancelled = true; };
    }, [refreshStatus, loadCatalog, loadExtensions, loadCatalogModels, loadHostedProviders]);

    const setConfig = useCallback(async (next: Parameters<NonNullable<typeof window.electronAPI.setRerankerConfig>>[0]) => {
        await window.electronAPI.setRerankerConfig?.(next);
        await refreshStatus();
    }, [refreshStatus]);

    const activeOptions: AipSelectOption[] = useMemo(() => {
        // Every row: `provider/model` open, bare model closed. One helper so a
        // new provider cannot invent a fourth label format — this panel had
        // three (` — Included`, ` — Extension`, ` — OpenRouter`) while
        // EmbeddingSettings used `provider/model` for the same job.
        const opt = (id: string, providerId: string, label: string): AipSelectOption => ({
            id,
            name: qualifiedModelName(providerId, label),
            triggerName: bareModelName(label),
        });

        const options: AipSelectOption[] = [
            // No `?? 'MS MARCO MiniLM L6'` here: `status` is typed non-nullable and
            // initialised from INITIAL_STATUS, so that branch was unreachable — a
            // fourth copy of the bundled model's name that could only ever go stale.
            opt('local::built-in', 'local', status.builtIn.name),
        ];

        for (const m of catalogModels) {
            if (!m.activatable || m.state !== 'installed') continue;
            options.push(opt(`local::${m.id}`, 'local', m.name));
        }

        for (const ext of extensions.filter(e => e.type === 'reranker')) {
            if (!ext.models.every(m => m.state === 'ready')) continue;
            options.push(opt(`extension::${ext.id}`, 'extension', ext.name));
        }

        // OpenRouter's catalogue is discovered live; Jina publishes a fixed
        // enum. Both are offered only once their own key is configured, since
        // selecting one without a key would activate something that cannot run.
        const openrouter = hostedProviders.find(p => p.id === 'openrouter');
        if (openrouter?.hasApiKey ?? status?.hasApiKey) {
            for (const m of catalog) {
                options.push(opt(`openrouter::${m.id}`, 'openrouter', m.label));
            }
        }
        for (const provider of hostedProviders.filter(p => p.staticCatalogue && p.hasApiKey)) {
            for (const m of provider.models) {
                options.push(opt(`${provider.id}::${m.id}`, provider.id, m.label));
            }
        }

        return options;
    }, [status?.builtIn.name, status?.hasApiKey, catalogModels, extensions, catalog, hostedProviders, t]);

    const activeOptionId = useMemo(() => {
        if (status?.effective.kind === 'openrouter' || status?.effective.kind === 'jina') {
            return `${status.effective.kind}::${status.effective.id ?? ''}`;
        }
        if (status?.effective.kind === 'extension') return `extension::${status.effective.id ?? ''}`;
        const selected = catalogModels.find(m => m.selected);
        return selected ? `local::${selected.id}` : 'local::built-in';
    }, [status?.effective, catalogModels]);

    const chooseActive = useCallback(async (optionId: string) => {
        const [kind, ...rest] = optionId.split('::');
        const id = rest.join('::');
        setBusyCatalogId(optionId);
        setCatalogError(null);
        try {
            if (kind === 'openrouter') {
                await window.electronAPI.setRerankerConfig?.({ provider: 'openrouter', openrouterModel: id });
            } else if (kind === 'jina') {
                await window.electronAPI.setRerankerConfig?.({ provider: 'jina', jinaModel: id });
            } else if (kind === 'extension') {
                await window.electronAPI.setRerankerConfig?.({ provider: 'local' });
                for (const ext of extensions.filter(e => e.type === 'reranker' && e.enabled && e.id !== id)) {
                    await window.electronAPI.setExtensionEnabled?.(ext.id, false);
                }
                await window.electronAPI.setExtensionEnabled?.(id, true);
            } else {
                await window.electronAPI.setRerankerConfig?.({ provider: 'local' });
                for (const ext of extensions.filter(e => e.type === 'reranker' && e.enabled)) {
                    await window.electronAPI.setExtensionEnabled?.(ext.id, false);
                }
                const res = await window.electronAPI.useLocalRerankerModel?.(id === 'built-in' ? null : id);
                if (res && !res.success) {
                    setCatalogError(res.message || res.error || t('Could not activate this reranker.'));
                }
            }
            await Promise.all([refreshStatus(), loadCatalogModels(), loadExtensions(), loadHostedProviders()]);
        } finally {
            setBusyCatalogId(null);
        }
    }, [extensions, refreshStatus, loadCatalogModels, loadExtensions, loadHostedProviders, t]);

    const activeDetail = useMemo(() => {
        if (!status) return '';
        const parts: string[] = [];

        if (status.effective.kind === 'openrouter') {
            parts.push(t('Hosted'), t('Document text is sent to OpenRouter'));
            if (status.lastTest?.ok) parts.push(`${Math.round(status.lastTest.latencyMs)} ms ${t('last test')}`);
        } else if (status.effective.kind === 'extension') {
            parts.push(t('On-device'), t('Provided by an extension'));
        } else {
            const selected = catalogModels.find(m => m.selected);
            parts.push(t('On-device'));
            parts.push(selected ? humanBytes(selected.bytesOnDisk || selected.bytes) : t('Included with Natively'));
        }
        return parts.join(' · ');
    }, [status, catalogModels, t]);

    const rerankerExtensions = useMemo(
        () => extensions.filter(e => e.type === 'reranker'),
        [extensions],
    );
    const enabledRerankerCount = useMemo(
        () => rerankerExtensions.filter(e => e.enabled).length,
        [rerankerExtensions],
    );

    // Model Library statistics & filtering logic
    const installedCount = useMemo(() => {
        let count = builtInSelected || status?.builtIn.available ? 1 : 0;
        count += catalogModels.filter(m => m.state === 'installed').length;
        return count;
    }, [builtInSelected, status?.builtIn.available, catalogModels]);

    const totalCount = useMemo(() => 1 + catalogModels.length, [catalogModels]);

    const installedBytes = useMemo(() => {
        return catalogModels.filter(m => m.state === 'installed').reduce((acc, m) => acc + (m.bytesOnDisk || m.bytes), 0);
    }, [catalogModels]);

    /**
     * The one model named in "Best for this Mac".
     *
     * Several entries carry the Recommended badge, so this used to be whichever
     * one happened to sit earliest in the catalogue array — a headline
     * recommendation decided by array order.
     *
     * The rule, stated: prefer a recommended model the user can actually use
     * WITHOUT a licence problem. jina-reranker-v3.5 is the strongest local
     * reranker measured (MRR 0.9514 against a 0.8368 no-reranker baseline, and
     * it never moved a query down), but it is CC-BY-NC — putting it in a
     * headline inside a commercial product recommends a licence the user
     * probably cannot honour. It keeps its badge and its note; the headline
     * goes to the strongest Apache-licensed model instead.
     *
     * The fallback is deliberate rather than defensive: if the catalogue ever
     * recommends only restricted models, naming one is still better than
     * naming none.
     */
    const recommendedModelName = useMemo(() => {
        const recommended = catalogModels.filter(m => m.recommended && m.supported);
        const unrestricted = recommended.find(m => !m.license?.commercialUseRestricted);
        return (unrestricted ?? recommended[0])?.name ?? 'mxbai Rerank XSmall';
    }, [catalogModels]);

    const filteredCatalogModels = useMemo(() => {
        return catalogModels.filter(m => {
            if (filterTab === 'installed' && m.state !== 'installed') return false;
            if (filterTab === 'recommended' && !m.recommended) return false;
            if (modelQuery.trim()) {
                const q = modelQuery.toLowerCase().trim();
                const matchesName = m.name.toLowerCase().includes(q);
                const matchesParams = m.params.toLowerCase().includes(q);
                const matchesNote = m.note?.toLowerCase().includes(q) ?? false;
                return matchesName || matchesParams || matchesNote;
            }
            return true;
        });
    }, [catalogModels, filterTab, modelQuery]);

    const filteredOnnxModels = useMemo(() => filteredCatalogModels.filter(m => m.runtime === 'onnx'), [filteredCatalogModels]);
    const filteredGgufModels = useMemo(() => filteredCatalogModels.filter(m => m.runtime === 'gguf'), [filteredCatalogModels]);

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

    const downloadExtensionGroup = useCallback(async (extId: string, files: ExtensionModel[]) => {
        for (const m of files) {
            if (m.state !== 'ready') {
                await downloadModel(extId, m.key);
            }
        }
    }, [downloadModel]);

    const cancelExtensionGroup = useCallback(async (extId: string, files: ExtensionModel[]) => {
        for (const m of files) {
            const key = `${extId}::${m.key}`;
            if (busyModel === key || m.state === 'downloading') {
                await window.electronAPI.cancelExtensionModelDownload?.(extId, m.key);
            }
        }
    }, [busyModel]);

    const groupProgressFraction = useCallback((extId: string, files: ExtensionModel[]) => {
        let totalBytes = 0;
        let downloadedBytes = 0;
        for (const m of files) {
            const bytes = m.bytes ?? m.approxBytes ?? 0;
            totalBytes += bytes;
            if (m.state === 'ready') {
                downloadedBytes += bytes;
            } else {
                const key = `${extId}::${m.key}`;
                const pct = progress[key];
                if (typeof pct === 'number') {
                    downloadedBytes += pct * bytes;
                }
            }
        }
        return totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
    }, [progress]);

    const selectedMissing = useMemo(() => {
        const id = status?.openrouterModel;
        if (!id || catalog.length === 0) return false;
        return !catalog.some(m => m.id === id);
    }, [status?.openrouterModel, catalog]);

    // No loading gate, and no skeleton gate. AI Providers renders immediately
    // and fills in as its data lands; this now does the same. A failure is the
    // one thing worth interrupting for, and it is shown as a strip ABOVE the
    // panel rather than instead of it — the rest of the settings still work.

    // Both writes go through the provider-generic channel. OpenRouter's own
    // catalogue is discovered with the key, so it is refetched after a save;
    // a static catalogue has nothing to refetch.
    const saveKey = async (providerId: string, staticCatalogue: boolean) => {
        const draft = (keyDrafts[providerId] ?? '').trim();
        if (!draft) return;
        setSavingKeyFor(providerId);
        setSavedKeyFor(null);
        setInstallError(null);
        try {
            const res = await window.electronAPI.setRerankerHostedKey?.(providerId, draft);
            if (res && res.success === false) {
                setInstallError(res.message || res.error || t('Could not save the key.'));
                return;
            }
            setSavedKeyFor(providerId);
            setKeyDrafts(prev => ({ ...prev, [providerId]: '' }));
            setTimeout(() => setSavedKeyFor(cur => (cur === providerId ? null : cur)), 3000);
            await Promise.all([
                refreshStatus(),
                loadHostedProviders(),
                ...(staticCatalogue ? [] : [loadCatalog(true)]),
            ]);
        } finally {
            setSavingKeyFor(null);
        }
    };

    const removeKey = async (providerId: string, staticCatalogue: boolean) => {
        setSavingKeyFor(providerId);
        setInstallError(null);
        try {
            await window.electronAPI.setRerankerHostedKey?.(providerId, '');
            setKeyDrafts(prev => ({ ...prev, [providerId]: '' }));
            await Promise.all([
                refreshStatus(),
                loadHostedProviders(),
                ...(staticCatalogue ? [] : [loadCatalog(true)]),
            ]);
        } finally {
            setSavingKeyFor(null);
        }
    };

    // The main process tests whichever provider is SELECTED — it does not take
    // one as an argument, and it must not, because probing a provider would
    // otherwise mean quietly switching to it. So Test is offered only on the
    // card that is already active.
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

    const renderCatalogModelRow = (m: LocalCatalogModel) => {
        const prog = modelProgress[m.id];
        const busy = busyCatalogId === m.id;
        const installed = m.state === 'installed';
        // Only an entry that actually names an extension needs one. GGUF runs
        // in Core now; this used to fire on every GGUF model and disable its
        // Download button while claiming an extension was missing.
        const needsExtension = m.extensionId != null && m.extensionInstalled === false;

        return (
            <div
                key={m.id}
                className="aip-card p-3 space-y-1.5 transition-colors hover:bg-white/[0.03]"
                data-active={m.selected ? 'true' : undefined}
                data-off={m.supported ? undefined : 'true'}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap sm:flex-nowrap">
                        <span
                            aria-hidden="true"
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                                background: m.selected ? 'var(--aip-accent)' : installed ? 'var(--aip-tertiary)' : 'transparent',
                                border: installed || m.selected ? undefined : '1px solid var(--aip-border-strong)',
                            }}
                        />
                        <span className="text-xs font-semibold text-white truncate">{m.name}</span>
                        {m.recommended && m.supported && <AipBadge tone="info" label={t('Recommended')} />}
                        {m.selected && <AipBadge tone="ok" label={t('In use')} />}
                        {installed && !m.selected && (
                            <AipBadge
                                tone={m.supported ? 'neutral' : 'warn'}
                                label={m.supported ? t('Downloaded') : t('Downloaded · not usable yet')}
                            />
                        )}
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                        {!installed && (
                            busy ? (
                                <button
                                    type="button"
                                    className="aip-btn"
                                    data-size="sm"
                                    onClick={() => void window.electronAPI.cancelLocalRerankerModel?.(m.id)}
                                >
                                    <X size={12} strokeWidth={1.75} aria-hidden="true" />
                                    <span>{t('Cancel')}</span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="aip-btn"
                                    data-size="sm"
                                    disabled={busyCatalogId !== null || needsExtension}
                                    onClick={() => void installCatalogModel(m.id)}
                                >
                                    <Download size={12} strokeWidth={1.75} aria-hidden="true" />
                                    <span>{t('Download')}</span>
                                </button>
                            )
                        )}
                        {installed && m.activatable && !m.selected && (
                            <button
                                type="button"
                                className="aip-btn"
                                data-size="sm"
                                disabled={busyCatalogId !== null}
                                onClick={() => void useCatalogModel(m.id)}
                            >
                                {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
                                <span>{t('Use')}</span>
                            </button>
                        )}
                        {installed && !m.selected && (
                            <button
                                type="button"
                                className="aip-btn"
                                data-size="sm"
                                data-variant="danger-ghost"
                                disabled={busyCatalogId !== null}
                                onClick={() => void removeCatalogModel(m.id)}
                                title={t('Remove model')}
                            >
                                <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                </div>

                <div className="text-[10.5px] aip-muted pl-3.5 flex items-center gap-2 flex-wrap">
                    <span>
                        {[m.params, humanBytes(m.bytes), m.license.spdx, m.license.commercialUseRestricted ? t('non-commercial') : null]
                            .filter(Boolean).join(' · ')}
                    </span>
                </div>

                {m.note && (
                    <p className="text-[10px] aip-muted leading-relaxed pl-3.5 text-white/60">
                        {m.note}
                    </p>
                )}

                {!m.supported && m.unsupportedReason && (
                    <div className="aip-inline-warn flex items-start gap-2 ml-3.5 mt-1" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="min-w-0">{m.unsupportedReason}</span>
                    </div>
                )}

                {needsExtension && (
                    <p className="text-[10px] aip-muted ml-3.5">
                        {t('Runs through the')} <code className="px-1.5 py-0.5 rounded bg-white/10 text-[9.5px] font-mono">{m.extensionId}</code> {t('extension, which is not installed yet.')}
                        {m.requiresBinary ? ` ${t('It also needs')} ${m.requiresBinary} ${t('on your PATH.')}` : ''}
                    </p>
                )}

                {busy && prog && (
                    <div className="space-y-1 pl-3.5 pt-1">
                        <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-[var(--aip-accent)] transition-all duration-150" style={{ width: `${Math.round(prog.fraction * 100)}%` }} />
                        </div>
                        <div className="text-[10px] aip-muted flex justify-between">
                            <span>{`${Math.round(prog.fraction * 100)}% · ${prog.file}`}</span>
                            <span>{`${humanBytes(Math.round(prog.fraction * m.bytes))} / ${humanBytes(m.bytes)}`}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    /**
     * Who the hosted fallback actually covers.
     *
     * The switch is wired to RerankerRegistry.resolveHostedPort, which wraps
     * WHICHEVER hosted provider is selected — so the old label ("if OpenRouter
     * is unavailable") was wrong the moment Jina shipped: a failed Jina rerank
     * took the same branch while the UI said nothing about it. Built from the
     * live provider list rather than a hardcoded pair, so a third hosted
     * provider needs no copy change.
     */
    const hostedFallbackSubject = useMemo(() => {
        const names = hostedProviders.map(p => p.name).filter(Boolean);
        if (names.length === 0) return t('a hosted reranker');
        if (names.length === 1) return names[0];
        return `${names.slice(0, -1).join(', ')} ${t('or')} ${names[names.length - 1]}`;
    }, [hostedProviders, t]);

    return (
        <div className="aip-root space-y-5 pb-10" data-theme={aipTheme} data-settings-stagger>
            <header className="space-y-1">
                <h3 className="aip-title">{t('Reranker')}</h3>
                <p className="aip-subtitle">
                    {t('After Natively searches your documents, the reranker decides which passages actually answer the question. It is chosen separately from your embedding model and your AI model.')}
                </p>
            </header>

            {loadError && (
                <div className="aip-card p-3 flex items-start gap-2" role="status">
                    <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="aip-muted text-xs flex-1">{loadError}</span>
                    <button
                        type="button"
                        className="aip-btn"
                        data-size="sm"
                        onClick={() => {
                            setLoadError(null);
                            void (async () => {
                                try {
                                    await Promise.all([refreshStatus(), loadCatalog(false), loadExtensions(), loadCatalogModels(), loadHostedProviders()]);
                                } catch (e) {
                                    setLoadError(e instanceof Error ? e.message : String(e));
                                }
                            })();
                        }}
                    >
                        {t('Try again')}
                    </button>
                </div>
            )}

            {/* Active Reranker Hero Card — matching EmbeddingSettings */}
            <div className="aip-card p-5">
                <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">
                            {t('Active Reranker')}
                        </label>
                        <p className="text-[10px] aip-muted mt-0.5">
                            {activeDetail}
                        </p>
                    </div>

                    <div className="shrink-0 relative">
                        <RerankerModelSelect
                            ariaLabel={t('Active Reranker')}
                            value={activeOptionId}
                            options={activeOptions}
                            placeholder={t('No rerankers available')}
                            disabled={busyCatalogId !== null}
                            disabledHint={busyCatalogId !== null ? t('Switching…') : undefined}
                            onChange={(id) => { void chooseActive(id); }}
                        />
                    </div>
                </div>

                {catalogError && (
                    <div className="aip-inline-warn flex items-start gap-2 pt-3" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="min-w-0">{catalogError}</span>
                    </div>
                )}

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

            {/* Hosted fallback — its own card, directly under Active Reranker.
                It answers "what happens when the hosted service fails", which is
                a question about the ACTIVE choice. It used to ride along at the
                bottom of the candidates card, where it read as a footnote to a
                setting it has nothing to do with. */}
            <div className="aip-card p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                        <span className="block text-xs font-medium uppercase tracking-wide aip-hero">
                            {t('Fall back to the local reranker')}
                        </span>
                        <p className="text-[10px] aip-muted">
                            {`${t('Off by default. If')} ${hostedFallbackSubject} ${t('fails, rerank locally instead of keeping the original order.')}`}
                        </p>
                    </div>
                    <div className="shrink-0">
                        <AipSwitch
                            label={t('Fall back to the local reranker')}
                            checked={status.fallbackToLocal}
                            onChange={(next) => void setConfig({ fallbackToLocal: next })}
                        />
                    </div>
                </div>

                {/* Both halves matter. `provider` is what was SELECTED, `effective.kind`
                    is what actually runs, and they diverge in two states this hint
                    would otherwise lie in: a selected-but-ineligible hosted provider
                    (effective falls to local — the hero card already explains that
                    one), and an enabled reranker EXTENSION (on-device, but "choose a
                    hosted one" is the wrong instruction for someone who just
                    installed one). */}
                {status.provider === 'local' && status.effective.kind === 'local' && (
                    <p className="text-[10px] aip-muted pt-3">
                        {t('Your active reranker already runs on this device, so this changes nothing until you choose a hosted one.')}
                    </p>
                )}
            </div>

            {/* Provider Card 1: Unified Local Reranker & Model Library Card */}
            <div className="aip-card aip-provider space-y-3">
                <div className="aip-provider-head">
                    <PlatformMark />
                    <h4 className="aip-card-title truncate min-w-0">{t('Local Reranker')}</h4>
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        <AipBadge
                            tone={status.builtIn.available ? 'ok' : status.builtIn.cached ? 'info' : 'neutral'}
                            label={status.builtIn.available ? t('Ready') : status.builtIn.cached ? t('Downloaded') : t('Local')}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap text-[10px] aip-muted px-1">
                    <p className="min-w-0 flex-1">
                        {t('Runs on this device with zero data sent externally. Built-in BGE model shipped with Natively, or download open models directly from Hugging Face.')}
                    </p>
                    <span className="shrink-0 font-medium tabular-nums text-white/70">
                        {installedCount}/{totalCount} {t('installed')}
                        {installedBytes > 0 && <> · {humanBytes(installedBytes)}</>}
                    </span>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                    {recommendedModelName ? (
                        <p className="text-[11px] px-1" style={{ color: 'var(--aip-tertiary)' }}>
                            {t('Best for this')} {isMac ? 'Mac' : 'PC'}: <span className="font-medium" style={{ color: 'var(--aip-secondary)' }}>{recommendedModelName}</span>
                        </p>
                    ) : <div />}

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-md text-[11px]">
                        <button
                            type="button"
                            className="px-2 py-0.5 rounded text-white transition-colors"
                            style={{
                                background: filterTab === 'all' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                fontWeight: filterTab === 'all' ? 600 : 400,
                            }}
                            onClick={() => setFilterTab('all')}
                        >
                            {t('All')} ({totalCount})
                        </button>
                        <button
                            type="button"
                            className="px-2 py-0.5 rounded text-white transition-colors"
                            style={{
                                background: filterTab === 'installed' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                fontWeight: filterTab === 'installed' ? 600 : 400,
                            }}
                            onClick={() => setFilterTab('installed')}
                        >
                            {t('Installed')} ({installedCount})
                        </button>
                        <button
                            type="button"
                            className="px-2 py-0.5 rounded text-white transition-colors"
                            style={{
                                background: filterTab === 'recommended' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                fontWeight: filterTab === 'recommended' ? 600 : 400,
                            }}
                            onClick={() => setFilterTab('recommended')}
                        >
                            {t('Recommended')}
                        </button>
                    </div>
                </div>

                {/* Instant Search Bar */}
                <div className="aip-field">
                    <Search size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                    <input
                        type="text"
                        className="aip-input"
                        value={modelQuery}
                        placeholder={t('Filter models by name, size, or format…')}
                        onChange={(e) => setModelQuery(e.target.value)}
                    />
                    {modelQuery && (
                        <button
                            type="button"
                            className="aip-btn text-[10px] shrink-0"
                            data-size="sm"
                            data-variant="ghost"
                            onClick={() => setModelQuery('')}
                        >
                            <X size={12} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                    )}
                </div>

                {/* Scrollable Model Library Container */}
                <div className="aip-well aip-scroll-y p-2.5 space-y-3.5" style={{ maxHeight: 380 }}>
                    {/* Section 1: Bundled Models */}
                    {(filterTab === 'all' || filterTab === 'installed') && !modelQuery && (
                        <section className="space-y-1.5">
                            <header className="flex items-baseline justify-between gap-3 px-1">
                                <h5 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--aip-secondary)' }}>
                                    {t('Bundled with Natively')}
                                </h5>
                                <span className="text-[10px] tabular-nums" style={{ color: 'var(--aip-tertiary)' }}>1/1</span>
                            </header>

                            <div className="aip-card flex items-center justify-between gap-3 p-2.5" data-active={builtInSelected ? 'true' : undefined}>
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <span
                                        aria-hidden="true"
                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                        style={{ background: builtInSelected ? 'var(--aip-accent)' : 'var(--aip-tertiary)' }}
                                    />
                                    <span className="text-xs font-semibold text-white truncate">{status.builtIn.name}</span>
                                    <AipBadge tone="neutral" label={t('Included')} />
                                    {builtInSelected && <AipBadge tone="ok" label={t('In use')} />}
                                </div>
                                <div className="shrink-0">
                                    {!builtInSelected && (
                                        <button
                                            type="button"
                                            className="aip-btn"
                                            data-size="sm"
                                            disabled={busyCatalogId !== null}
                                            onClick={() => void useCatalogModel(null)}
                                        >
                                            <span>{t('Use')}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Section 2: ONNX Models */}
                    {filteredOnnxModels.length > 0 && (
                        <section className="space-y-1.5">
                            <header className="flex items-baseline justify-between gap-3 px-1">
                                <h5 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--aip-secondary)' }}>
                                    {t('Hugging Face ONNX Models')}
                                </h5>
                                <span className="text-[10px] tabular-nums" style={{ color: 'var(--aip-tertiary)' }}>
                                    {filteredOnnxModels.filter(m => m.state === 'installed').length}/{filteredOnnxModels.length}
                                </span>
                            </header>
                            <div className="space-y-1.5">
                                {filteredOnnxModels.map(renderCatalogModelRow)}
                            </div>
                        </section>
                    )}

                    {/* Section 3: GGUF Extension Models */}
                    {filteredGgufModels.length > 0 && (
                        <section className="space-y-1.5">
                            <header className="flex items-baseline justify-between gap-3 px-1">
                                <h5 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--aip-secondary)' }}>
                                    {t('Extension Rerankers (GGUF)')}
                                </h5>
                                <span className="text-[10px] tabular-nums" style={{ color: 'var(--aip-tertiary)' }}>
                                    {filteredGgufModels.filter(m => m.state === 'installed').length}/{filteredGgufModels.length}
                                </span>
                            </header>
                            <div className="space-y-1.5">
                                {filteredGgufModels.map(renderCatalogModelRow)}
                            </div>
                        </section>
                    )}

                    {filteredCatalogModels.length === 0 && (
                        <p className="text-[10px] aip-muted text-center py-4">
                            {t('No models match your current filter query.')}
                        </p>
                    )}
                </div>
            </div>

            {/* Provider Card 3+: hosted rerankers, one card per provider.
                OpenRouter discovers its catalogue live; Jina publishes a fixed
                enum. Jina was added for jina-reranker-v3.5 when that model could
                only run hosted. It runs locally now — Core implements the
                listwise protocol and the catalogue entry downloads the projector
                — so the hosted card is the no-download, no-warm-up route to the
                same model, not the only one. */}
            {hostedProviders.map(p => {
                const isActive = status.effective.kind === p.id;
                const isSelected = status.provider === p.id;
                // status.hasApiKey is the presence flag for the SELECTED
                // provider. Preferring the per-provider flag but falling back
                // to it keeps the badge honest if discovery degraded.
                const hasKey = p.hasApiKey || (isSelected && status.hasApiKey);
                const draft = keyDrafts[p.id] ?? '';
                const saving = savingKeyFor === p.id;
                const saved = savedKeyFor === p.id;
                const selectedModel = p.id === 'jina' ? status.jinaModel : status.openrouterModel;
                // A live catalogue arrives from OpenRouter; a static one ships
                // with the app and is listed even before a key exists, so the
                // user can see what a key would buy them.
                const models = p.staticCatalogue
                    ? p.models.map(m => ({ id: m.id, label: m.label }))
                    : catalog.map(m => ({ id: m.id, label: trimVendorAttribution(m.label) }));

                return (
                    <div className="aip-card aip-provider" key={p.id}>
                        {/* Header */}
                        <div className="aip-provider-head">
                            <AipProviderMark provider={p.id} name={p.name} />
                            <h4 className="aip-card-title truncate min-w-0">{t(p.name)}</h4>
                            <div className="ml-auto flex items-center gap-2 shrink-0">
                                <AipBadge tone={hasKey ? 'ok' : 'warn'} label={hasKey ? t('Key set') : t('No key')} />

                                <button
                                    type="button"
                                    className="aip-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                    onClick={() => window.electronAPI.openExternal?.(p.keyUrl)}
                                    title={`Get ${p.name} API Key`}
                                >
                                    <span className="uppercase tracking-wide">{t('Get Key')}</span>
                                    <ExternalLink size={12} strokeWidth={1.75} />
                                </button>
                            </div>
                        </div>

                        {/* API Key Credential Row matching EmbeddingSettings */}
                        <div className="aip-provider-row">
                            <div className="aip-provider-field">
                                <div className="aip-field">
                                    <KeyRound size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                    <input
                                        type="password"
                                        className="aip-input"
                                        value={draft}
                                        placeholder={hasKey ? '••••••••••••••••' : p.keyPlaceholder}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setKeyDrafts(prev => ({ ...prev, [p.id]: v }));
                                            setSavedKeyFor(cur => (cur === p.id ? null : cur));
                                        }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(p.id, p.staticCatalogue); }}
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-label={`${p.name} ${t('API key')}`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void saveKey(p.id, p.staticCatalogue)}
                                        disabled={saving || !draft.trim()}
                                        className="aip-btn-seg aip-field-seg"
                                        data-tone={saved ? 'ok' : undefined}
                                    >
                                        {saving
                                            ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Saving...')}</>
                                            : saved
                                                ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Saved')}</>
                                                : t('Save')}
                                    </button>
                                </div>
                                {hasKey && (
                                    <button
                                        type="button"
                                        onClick={() => void removeKey(p.id, p.staticCatalogue)}
                                        className="aip-btn shrink-0"
                                        data-icon="true"
                                        data-variant="danger-ghost"
                                        title={t('Remove API Key')}
                                    >
                                        <Trash2 size={14} strokeWidth={1.75} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Action Row: Test Connection & Model List Selector matching EmbeddingSettings */}
                        {(hasKey || models.length > 0) && (
                            <div className="aip-provider-row">
                                {hasKey && (
                                    <button
                                        type="button"
                                        onClick={() => void runTest()}
                                        disabled={testing || !isSelected || !selectedModel}
                                        className="aip-btn shrink-0"
                                        data-tone={isSelected && testResult?.success ? 'ok' : isSelected && testResult ? 'danger' : undefined}
                                        title={!isSelected
                                            ? t('Pick a model from this provider first — testing sends a real request through whichever provider is selected.')
                                            : (testResult?.message || t('Test Connection'))}
                                    >
                                        {testing && isSelected
                                            ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Testing...')}</>
                                            : isSelected && testResult?.success
                                                ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Passed')}</>
                                                : isSelected && testResult
                                                    ? <><AlertCircle size={12} strokeWidth={1.75} /> {t('Error')}</>
                                                    : <>{t('Test Connection')}</>}
                                    </button>
                                )}

                                {isSelected && testResult?.success && testResult.budgetFit?.warning && (
                                    <div className="aip-inline-warn flex items-start gap-2" role="status">
                                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                        <span className="min-w-0">{t(testResult.budgetFit.warning)}</span>
                                    </div>
                                )}

                                {/* Provider Model Selector matching EmbeddingSettings */}
                                {models.length > 0 && (
                                    <AipModelList
                                        models={models}
                                        optIn
                                        enabled={isActive && selectedModel ? [selectedModel] : []}
                                        defaultId={isActive ? (selectedModel ?? undefined) : undefined}
                                        onToggle={(id) => void setConfig(
                                            p.id === 'jina' ? { provider: 'jina', jinaModel: id } : { provider: 'openrouter', openrouterModel: id })}
                                        onSetDefault={(id) => void setConfig(
                                            p.id === 'jina' ? { provider: 'jina', jinaModel: id } : { provider: 'openrouter', openrouterModel: id })}
                                        onReset={() => {}}
                                        refreshing={p.staticCatalogue ? false : refreshing}
                                        onRefresh={p.staticCatalogue
                                            ? undefined
                                            : async () => { setRefreshing(true); try { await loadCatalog(true); } finally { setRefreshing(false); } }}
                                    />
                                )}
                            </div>
                        )}

                        {/* Notes carried by a static catalogue are the whole reason it is
                            static: they say what the model is for, and for v3.5 that it
                            cannot be run any other way. */}
                        {p.staticCatalogue && p.models.some(m => m.note) && (
                            <div className="px-1 space-y-1">
                                {p.models.filter(m => m.note).map(m => (
                                    <p key={m.id} className="aip-meta aip-provider-note">
                                        <span className="font-medium">{m.label}</span>{' — '}{t(m.note as string)}
                                    </p>
                                ))}
                            </div>
                        )}

                        {!p.staticCatalogue && catalogStale && (
                            <p className="aip-meta aip-provider-note">
                                {t('Could not reach OpenRouter. Showing the models from the last successful check.')}
                            </p>
                        )}

                        {!p.staticCatalogue && selectedMissing && (
                            <p className="aip-meta aip-provider-note">
                                {t('The selected reranker is no longer offered by OpenRouter. Your local reranker will be used until you pick another.')}
                            </p>
                        )}
                    </div>
                );
            })}
            {/* Provider Card 4: Community Extensions — High-End Minimalist Design */}
            <div className="aip-card aip-provider space-y-3">
                <div className="aip-provider-head">
                    <AipProviderMark provider="natively" name={t('Reranker Extensions')} />
                    <h4 className="aip-card-title truncate min-w-0">{t('Reranker Extensions')}</h4>
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            className="aip-btn"
                            data-size="sm"
                            data-variant="ghost"
                            disabled={installing || !extensionsAvailable}
                            onClick={() => void installFromFolder()}
                        >
                            {installing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                                : <FolderOpen size={12} strokeWidth={1.75} aria-hidden="true" />}
                            <span>{t('Install from folder')}</span>
                        </button>
                    </div>
                </div>

                <p className="text-[10px] aip-muted px-1">
                    {t('An extension teaches Natively to use custom reranking models. Extensions run locally with full data privacy.')}
                </p>

                {installError && (
                    <div className="aip-inline-warn flex items-start gap-2" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="min-w-0">{installError}</span>
                    </div>
                )}

                {enabledRerankerCount > 1 && (
                    <div className="aip-inline-warn flex items-start gap-2" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{t('More than one reranker extension is turned on, so none of them is being used. Turn off all but one.')}</span>
                    </div>
                )}

                <div className="aip-well p-2.5 space-y-2.5">
                    {rerankerExtensions.length === 0 ? (
                        <div className="text-center py-6 px-4 space-y-2 border border-dashed border-white/10 rounded-md">
                            <Puzzle size={20} className="mx-auto text-white/30" aria-hidden="true" />
                            <p className="text-xs text-white/70 font-medium">{t('No custom extensions installed')}</p>
                            <p className="text-[10px] aip-muted max-w-xs mx-auto">
                                {t('Install a local reranker extension from a folder to use custom scoring models.')}
                            </p>
                            <button
                                type="button"
                                className="aip-btn mt-2"
                                data-size="sm"
                                disabled={installing || !extensionsAvailable}
                                onClick={() => void installFromFolder()}
                            >
                                <FolderOpen size={12} strokeWidth={1.75} aria-hidden="true" />
                                <span>{t('Install Extension')}</span>
                            </button>
                        </div>
                    ) : (
                        rerankerExtensions.map(ext => {
                            const modelsReady = ext.models.every(m => m.state === 'ready');
                            const groups = getExtensionVariantGroups(ext.models);
                            return (
                                <div key={ext.id} className="aip-card p-3 space-y-2.5 transition-colors hover:bg-white/[0.02]">
                                    {/* Extension Header Row */}
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                            <span
                                                aria-hidden="true"
                                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                                style={{
                                                    background: ext.running ? 'var(--aip-accent)' : ext.enabled ? 'var(--aip-tertiary)' : 'transparent',
                                                    border: ext.enabled || ext.running ? undefined : '1px solid var(--aip-border-strong)',
                                                }}
                                            />
                                            <span className="text-xs font-semibold text-white truncate">{ext.name}</span>
                                            <span className="text-[10px] aip-muted font-mono">{ext.version}</span>
                                            <AipBadge
                                                tone={ext.running ? 'ok' : ext.enabled ? 'info' : 'neutral'}
                                                label={ext.running ? t('Running') : ext.enabled ? t('Starting') : t('Off')}
                                            />
                                        </div>

                                        {/* Header Controls: Switch Toggle & Delete */}
                                        <div className="shrink-0 flex items-center gap-3">
                                            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                                <AipSwitch
                                                    label={`${t('Use')} ${ext.name}`}
                                                    checked={ext.enabled}
                                                    disabled={!ext.enabled && !modelsReady}
                                                    onChange={async (next) => {
                                                        await window.electronAPI.setExtensionEnabled?.(ext.id, next);
                                                        await Promise.all([loadExtensions(), refreshStatus()]);
                                                    }}
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                className="aip-btn shrink-0"
                                                data-size="sm"
                                                data-variant="danger-ghost"
                                                disabled={ext.enabled}
                                                title={ext.enabled ? t('Turn off before removing') : t('Remove extension')}
                                                onClick={async () => {
                                                    await window.electronAPI.removeExtension?.(ext.id);
                                                    await Promise.all([loadExtensions(), refreshStatus()]);
                                                }}
                                            >
                                                <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>

                                    {ext.disabledReason && (
                                        <p className="text-[10px] aip-muted pl-3.5">{t('Turned off')}: {ext.disabledReason}</p>
                                    )}

                                    {/* Extension Model Variant Groups */}
                                    {groups.map(group => {
                                        const drawerKey = `${ext.id}::${group.id}`;
                                        const isExpanded = expandedFileDrawers[drawerKey] ?? false;
                                        const isDownloading = group.anyDownloading || group.files.some(f => busyModel === `${ext.id}::${f.key}`);
                                        const pctFraction = groupProgressFraction(ext.id, group.files);

                                        return (
                                            <div key={group.id} className="space-y-1.5 pl-3.5 pt-2 border-t border-white/5">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11px] font-semibold text-white truncate">{group.label}</span>
                                                            {group.files.length > 1 && (
                                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono shrink-0">
                                                                    {group.files.length} {t('files')}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] aip-muted truncate mt-0.5">
                                                            {[
                                                                group.format,
                                                                humanBytes(group.totalBytes),
                                                                group.spdx,
                                                                group.commercialUseRestricted ? t('non-commercial') : null,
                                                            ].filter(Boolean).join(' · ')}
                                                        </div>
                                                    </div>

                                                    <div className="shrink-0 flex items-center gap-1.5">
                                                        {group.files.length > 1 && (
                                                            <button
                                                                type="button"
                                                                className="aip-btn text-[9.5px] px-1.5 py-0.5"
                                                                data-size="sm"
                                                                data-variant="ghost"
                                                                onClick={() => setExpandedFileDrawers(prev => ({ ...prev, [drawerKey]: !prev[drawerKey] }))}
                                                            >
                                                                <ChevronDown size={11} strokeWidth={1.75} className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                                                                <span>{isExpanded ? t('Less') : t('Files')}</span>
                                                            </button>
                                                        )}

                                                        {group.allReady ? (
                                                            <AipBadge tone="ok" label={t('Ready')} />
                                                        ) : isDownloading ? (
                                                            <button
                                                                type="button"
                                                                className="aip-btn"
                                                                data-size="sm"
                                                                onClick={() => void cancelExtensionGroup(ext.id, group.files)}
                                                            >
                                                                <X size={12} strokeWidth={1.75} aria-hidden="true" />
                                                                <span>{t('Cancel')}</span>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className="aip-btn"
                                                                data-size="sm"
                                                                disabled={group.anyBlocked || busyCatalogId !== null || busyModel !== null}
                                                                title={group.anyBlocked ? (group.files.find(f => f.reason)?.reason ?? undefined) : undefined}
                                                                onClick={() => void downloadExtensionGroup(ext.id, group.files)}
                                                            >
                                                                <Download size={12} strokeWidth={1.75} aria-hidden="true" />
                                                                <span>{t('Download')}</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Aggregate Download Progress Bar */}
                                                {isDownloading && (
                                                    <div className="space-y-1 pt-1">
                                                        <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-[var(--aip-accent)] transition-all duration-150"
                                                                style={{ width: `${Math.round(pctFraction * 100)}%` }}
                                                            />
                                                        </div>
                                                        <div className="text-[10px] aip-muted flex justify-between">
                                                            <span>{`${Math.round(pctFraction * 100)}%`}</span>
                                                            <span>{`${humanBytes(Math.round(pctFraction * group.totalBytes))} / ${humanBytes(group.totalBytes)}`}</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Verification Failure Warning */}
                                                {group.anyFailed && (
                                                    <div className="aip-inline-warn flex items-start gap-2 mt-1" role="status">
                                                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                                                        <span className="min-w-0">
                                                            {group.files.find(f => f.reason)?.reason ?? t('The downloaded file did not match its expected checksum.')}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* License Acceptance Banner */}
                                                {group.unacknowledgedLicense && (
                                                    <div className="space-y-1.5 p-2 rounded bg-white/5 border border-white/5 mt-1">
                                                        <p className="text-[10px] aip-muted">
                                                            {t('This model requires licence acceptance')} ({group.unacknowledgedLicense.spdx})
                                                            {group.unacknowledgedLicense.commercialUseRestricted ? ` — ${t('non-commercial use only')}` : ''}.
                                                        </p>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                className="aip-btn"
                                                                data-size="sm"
                                                                data-variant="ghost"
                                                                onClick={() => window.electronAPI.openExternal?.(group.unacknowledgedLicense!.url)}
                                                            >
                                                                <ExternalLink size={12} strokeWidth={1.75} />
                                                                <span>{t('Read licence')}</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="aip-btn"
                                                                data-size="sm"
                                                                onClick={async () => {
                                                                    for (const f of group.files) {
                                                                        if (f.license.requiresAcknowledgement && !f.license.acknowledged) {
                                                                            await window.electronAPI.acknowledgeExtensionLicense?.(ext.id, f.key);
                                                                        }
                                                                    }
                                                                    await loadExtensions();
                                                                }}
                                                            >
                                                                <Check size={12} strokeWidth={1.75} aria-hidden="true" />
                                                                <span>{t('Accept terms')}</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Collapsible Individual Files Breakdown */}
                                                {isExpanded && group.files.length > 1 && (
                                                    <div className="space-y-1 mt-1 pl-2 border-l-2 border-white/10 py-1 bg-white/[0.01] rounded-r">
                                                        {group.files.map(m => {
                                                            const key = `${ext.id}::${m.key}`;
                                                            const pct = progress[key];
                                                            const fileDownloading = busyModel === key || m.state === 'downloading';

                                                            return (
                                                                <div key={m.key} className="flex items-center justify-between text-[10px] py-1 px-1.5 rounded hover:bg-white/5">
                                                                    <div className="min-w-0 flex-1 flex items-center gap-2">
                                                                        <span className="font-mono text-white/80 truncate">{m.key}</span>
                                                                        <span className="aip-muted">{humanBytes(m.bytes ?? m.approxBytes)}</span>
                                                                    </div>
                                                                    <div className="shrink-0 flex items-center gap-1.5">
                                                                        {m.state === 'ready' ? (
                                                                            <span className="text-[9.5px] text-[var(--aip-accent)] font-medium">{t('Ready')}</span>
                                                                        ) : fileDownloading ? (
                                                                            <span className="text-[9.5px] aip-muted">
                                                                                {typeof pct === 'number' ? `${Math.round(pct * 100)}%` : t('Downloading…')}
                                                                            </span>
                                                                        ) : (
                                                                            <button
                                                                                type="button"
                                                                                className="aip-btn text-[9.5px] px-1.5 py-0.5"
                                                                                data-size="sm"
                                                                                disabled={busyModel !== null}
                                                                                onClick={() => void downloadModel(ext.id, m.key)}
                                                                            >
                                                                                {t('Download')}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Provider Card 5: Candidates. The hosted fallback used to share this
                card; it now sits under Active Reranker, where it belongs. */}
            <div className="aip-card p-5">
                <div className="space-y-1.5">
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
            </div>

            {/* Provider Card 6: Privacy Notice */}
            <div className="aip-card p-4 flex items-start gap-3">
                <ShieldAlert size={14} strokeWidth={1.75} className="shrink-0 mt-0.5 aip-muted" aria-hidden="true" />
                <p className="text-[10px] aip-muted">
                    {t('Only your question and the retrieved passages are sent — never whole files, and never your file names or paths. For fully local retrieval, choose the Local provider.')}
                </p>
            </div>

            <style>{AIP_CSS}</style>
        </div>
    );
};

export default RerankerSettings;
