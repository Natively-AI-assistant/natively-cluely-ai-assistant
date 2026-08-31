import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Cloud, ExternalLink, HardDrive, KeyRound, Loader2, Monitor, Server, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { AIP_CSS, AipBadge, AipModelList, AipProviderMark, type AipSelectOption, type AipTone } from './AIProvidersSettings';
import { isMac, isWindows } from '../../utils/platformUtils';

// Embeddings — configured INDEPENDENTLY of the generation model.

interface CatalogModel {
    id: string;
    label: string;
    dimensions: number;
    dimensionsVerified: boolean;
    /** Widths the provider documents as selectable. Absent = fixed. */
    supportedDimensions?: number[];
    /** OpenRouter only: list price in USD per million tokens. 0 means free. */
    pricePerMillion?: number;
    lightweight?: boolean;
    recommended?: boolean;
    note?: string;
}

interface CatalogProvider {
    id: 'natively' | 'ollama' | 'custom' | 'openrouter' | 'voyage' | 'openai' | 'gemini' | 'local';
    name: string;
    cloud: boolean;
    managed?: boolean;
    available: boolean;
    unavailableReason?: 'no_key' | 'not_running' | 'blocked_by_policy' | 'not_configured';
    models: CatalogModel[];
    endpoint?: string;
    capabilityUnknown?: boolean;
}

/**
 * "Built-in" means the model that ships with the app, so its mark is the
 * PLATFORM it ships on rather than a vendor logo.
 */
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

interface ActiveDescription {
    configured: boolean;
    provider?: string | null;
    model?: string | null;
    dimensions?: number | null;
    space?: string | null;
    location?: 'on-device' | 'cloud' | 'unknown';
    lightweight?: boolean;
}

interface TestResult {
    ok: boolean;
    model?: string;
    dimensions?: number;
    latencyMs?: number;
    message?: string;
}

/** The user-hosted endpoint has no vendor; a server glyph beats a monogram. */
const CustomEndpointMark: React.FC = () => (
    <span className="aip-tile aip-tile--mark" aria-hidden="true" title="Custom endpoint">
        <Server size={16} strokeWidth={1.75} />
    </span>
);

/** First-paint placeholder card. */
const SkeletonProviderCard: React.FC = () => (
    <div className="aip-card aip-provider" aria-hidden="true">
        <div className="aip-provider-head">
            <span className="aip-skeleton" style={{ width: 26, height: 26, borderRadius: 8 }} />
            <span className="aip-skeleton" style={{ width: 84, height: 10 }} />
            <span className="aip-skeleton ml-auto" style={{ width: 62, height: 10 }} />
        </div>
        <div className="aip-provider-row">
            <span className="aip-skeleton" style={{ flex: '1 1 240px', height: 'var(--aip-h-ctl)' }} />
        </div>
    </div>
);

const KEY_URLS: Record<string, string> = {
    gemini: 'https://aistudio.google.com/app/apikey',
    openai: 'https://platform.openai.com/api-keys',
    openrouter: 'https://openrouter.ai/keys',
    voyage: 'https://dashboard.voyageai.com/organization/api-keys',
};

const KEY_PLACEHOLDERS: Record<string, string> = {
    gemini: 'AIzaSy...',
    openai: 'sk-...',
    openrouter: 'sk-or-v1-...',
    voyage: 'pa-...',
    custom: 'sk-... (optional for auth)',
};

/**
 * Floating popover model selector for Active Model card.
 * Uses floating absolute positioning (`aip-float.absolute.top-full.right-0.z-50`)
 * so opening the menu floats on top without extending or expanding the card container height.
 */
interface EmbeddingModelSelectProps {
    value: string;
    options: { id: string; name: string }[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    /**
     * Sizing for the positioning wrapper. Defaults to the Active Model card's
     * width; a narrow control (the width picker) overrides it. Kept separate
     * from `className`, which lands on the trigger.
     */
    containerClassName?: string;
    /** Accessible name when the trigger text is a value, not a name. */
    ariaLabel?: string;
    /** Native tooltip — used to explain why the control is disabled. */
    title?: string;
}

const EmbeddingModelSelect: React.FC<EmbeddingModelSelectProps> = ({
    value,
    options,
    onChange,
    placeholder,
    disabled = false,
    className = '',
    containerClassName = 'relative min-w-[200px] max-w-[320px] w-full sm:w-64',
    ariaLabel,
    title,
}) => {
    const t = useT();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

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
    const resolvedLabel = selectedOption ? selectedOption.name : (placeholder || t('Select model'));

    return (
        <div className={containerClassName} ref={containerRef}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                title={title}
                disabled={disabled}
                className={`aip-select-trigger cursor-pointer flex items-center justify-between w-full ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
            >
                <span className="truncate pr-2 text-xs">{resolvedLabel}</span>
                <ChevronDown size={14} strokeWidth={1.75} className={`aip-select-chevron transition-transform duration-150 shrink-0 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {isOpen && (
                <div
                    role="listbox"
                    className="aip-float aip-scroll-y aip-panel-fade absolute top-full right-0 mt-1 w-full z-50 max-h-60 p-1 custom-scrollbar shadow-lg"
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
                            className={`aip-select-option flex items-center justify-between w-full text-left px-3 py-2 rounded-md text-xs cursor-pointer ${value === option.id ? 'aip-text font-medium' : ''}`}
                        >
                            <span className="truncate flex-1">{option.name}</span>
                            {value === option.id && (
                                <Check size={13} strokeWidth={1.75} className="aip-accent-fg shrink-0 ml-2" aria-hidden="true" />
                            )}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="aip-select-empty px-3 py-2 text-xs aip-muted">{t('No embedding models available')}</div>
                    )}
                </div>
            )}
        </div>
    );
};

export const EmbeddingSettings: React.FC<{ onNavigate?: (tab: string) => void }> = () => {
    const t = useT();
    const aipTheme = useResolvedTheme();

    const [providers, setProviders] = useState<CatalogProvider[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [hasCatalog, setHasCatalog] = useState<Record<string, boolean>>({});
    const [fetchingModels, setFetchingModels] = useState<string | null>(null);
    const [active, setActive] = useState<ActiveDescription>({ configured: false });
    const [configured, setConfigured] = useState<{ mode?: 'auto' | 'manual'; provider?: string; model?: string }>({ mode: 'auto' });
    const [acknowledged, setAcknowledged] = useState(false);

    const [pending, setPending] = useState<string | null>(null);
    const [testingActive, setTestingActive] = useState(false);
    const [activeTestResult, setActiveTestResult] = useState<TestResult | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [reindexing, setReindexing] = useState(false);

    // Per-provider API Key states
    const [keyState, setKeyState] = useState<Record<string, string>>({ gemini: '', openai: '', custom: '' });
    const [storedKeys, setStoredKeys] = useState<Record<string, boolean>>({});
    const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
    const [savedKey, setSavedKey] = useState<Record<string, boolean>>({});
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testErrors, setTestErrors] = useState<Record<string, string>>({});

    // Custom endpoint draft
    const [endpointDraft, setEndpointDraft] = useState('');
    const [customApiKeyDraft, setCustomApiKeyDraft] = useState('');
    const [endpointSaving, setEndpointSaving] = useState(false);
    const [endpointSaved, setEndpointSaved] = useState(false);
    const [endpointNote, setEndpointNote] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const s = await window.electronAPI.getEmbeddingStatus?.();
            if (s) {
                setActive(s.active as ActiveDescription);
                setConfigured(s.configured || { mode: 'auto' });
                setAcknowledged(!!s.acknowledged);
            }
        } catch { /* best-effort */ }
        try {
            // @ts-ignore
            const creds = await window.electronAPI.getStoredCredentials?.();
            if (creds) {
                setStoredKeys({
                    gemini: !!creds.hasGeminiKey,
                    openai: !!creds.hasOpenaiKey,
                    natively: !!creds.hasNativelyKey,
                });
            }
        } catch { /* best-effort */ }
        try {
            const c = await window.electronAPI.getEmbeddingCatalog?.();
            const list = (c?.providers ?? []) as CatalogProvider[];
            setProviders(list);
            // getStoredCredentials() has no OpenRouter field — its key lives in
            // the embeddings credential slot. The catalogue already distinguishes
            // "no key" from "blocked by policy", which is exactly the question.
            const or = list.find(x => x.id === 'openrouter');
            if (or) setStoredKeys(prev => ({ ...prev, openrouter: or.unavailableReason !== 'no_key' }));
            const voy = list.find(x => x.id === 'voyage');
            if (voy) setStoredKeys(prev => ({ ...prev, voyage: voy.unavailableReason !== 'no_key' }));
            setHasCatalog((c as any)?.hasCatalog ?? {});
            setEndpointDraft(prev => (prev ? prev : (list.find(p => p.id === 'custom')?.endpoint ?? '')));
        } catch { setProviders([]); }
        finally { setLoaded(true); }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const select = useCallback(async (providerId: string, modelId: string, dimensions?: number) => {
        setPending(`${providerId}:${modelId}:${dimensions ?? ''}`);
        setNote(null);
        setReindexing(false);
        setActiveTestResult(null);

        // Optimistically reflect selected provider and model in local React state
        setActive(prev => ({
            ...prev,
            configured: true,
            provider: providerId,
            model: modelId,
            dimensions: dimensions ?? prev.dimensions,
        }));

        try {
            const r = await window.electronAPI.setEmbeddingConfig?.({ mode: 'manual', provider: providerId, model: modelId, dimensions });
            if (!r?.success) {
                setNote(r?.message || t('Could not apply that embedding model.'));
                await refresh();
                return;
            }
            if (r.reindexRequired) setReindexing(true);
            await refresh();
        } catch (e: any) {
            setNote(e?.message || t('Could not apply that embedding model.'));
            await refresh();
        } finally { setPending(null); }
    }, [refresh, t]);

    const runActiveTest = useCallback(async () => {
        setTestingActive(true);
        setActiveTestResult(null);
        try {
            const r = await window.electronAPI.testEmbeddingModel?.();
            setActiveTestResult(r as TestResult);
        } catch (e: any) {
            setActiveTestResult({ ok: false, message: e?.message || t('Embedding request failed.') });
        } finally { setTestingActive(false); }
    }, [t]);

    const handleTestProvider = useCallback(async (providerId: string) => {
        setTestStatus(prev => ({ ...prev, [providerId]: 'testing' }));
        setTestErrors(prev => ({ ...prev, [providerId]: '' }));
        try {
            const p = providers.find(item => item.id === providerId);
            const testModel = p?.models?.[0]?.id;
            const res = await window.electronAPI.testEmbeddingModel?.(
                testModel ? { provider: providerId, model: testModel } : undefined
            );
            if (res?.ok) {
                setTestStatus(prev => ({ ...prev, [providerId]: 'success' }));
                setTimeout(() => {
                    setTestStatus(prev => ({ ...prev, [providerId]: 'idle' }));
                }, 4000);
            } else {
                setTestStatus(prev => ({ ...prev, [providerId]: 'error' }));
                setTestErrors(prev => ({ ...prev, [providerId]: res?.message || t('Connection test failed') }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [providerId]: 'error' }));
            setTestErrors(prev => ({ ...prev, [providerId]: e?.message || t('Connection test failed') }));
        }
    }, [providers, t]);

    const handleSaveKey = useCallback(async (providerId: 'gemini' | 'openai' | 'openrouter' | 'voyage') => {
        const key = (keyState[providerId] || '').trim();
        if (!key && !storedKeys[providerId]) return;
        setSavingKey(prev => ({ ...prev, [providerId]: true }));
        setSavedKey(prev => ({ ...prev, [providerId]: false }));

        try {
            let res: { success: boolean; error?: string } = { success: false };
            if (providerId === 'gemini') {
                res = await window.electronAPI.setGeminiApiKey(key);
            } else if (providerId === 'openai') {
                res = await window.electronAPI.setOpenaiApiKey(key);
            } else if (providerId === 'voyage') {
                // Voyage is embeddings-only here, so AI Providers has no slot for it.
                res = await window.electronAPI.setEmbeddingVoyageKey!(key);
            } else if (providerId === 'openrouter') {
                // OpenRouter has no slot in AI Providers (it is only reachable
                // there as a cURL provider), so the embeddings panel owns its key.
                res = await window.electronAPI.setEmbeddingOpenRouterKey!(key);
            }

            if (res?.success) {
                setSavedKey(prev => ({ ...prev, [providerId]: true }));
                setStoredKeys(prev => ({ ...prev, [providerId]: true }));
                setKeyState(prev => ({ ...prev, [providerId]: '' }));
                setTimeout(() => {
                    setSavedKey(prev => ({ ...prev, [providerId]: false }));
                }, 3000);
                await refresh();
            } else {
                // A refused write (a degraded credential store) returns
                // {success:false, message}. With no else branch the spinner just
                // stopped and the user concluded the key was saved. saveEndpoint
                // and select() both surface r.message; this did not.
                setTestErrors(prev => ({
                    ...prev,
                    [providerId]: (res as any)?.message || t('Could not save that key.'),
                }));
            }
        } catch (e) {
            console.error(`Failed to save ${providerId} API key:`, e);
        } finally {
            setSavingKey(prev => ({ ...prev, [providerId]: false }));
        }
    }, [keyState, storedKeys, refresh]);

    const handleRemoveKey = useCallback(async (providerId: 'gemini' | 'openai' | 'openrouter' | 'voyage') => {
        try {
            if (providerId === 'gemini') {
                await window.electronAPI.setGeminiApiKey('');
            } else if (providerId === 'openai') {
                await window.electronAPI.setOpenaiApiKey('');
            } else if (providerId === 'openrouter') {
                await window.electronAPI.setEmbeddingOpenRouterKey!('');
            } else if (providerId === 'voyage') {
                await window.electronAPI.setEmbeddingVoyageKey!('');
            }
            setStoredKeys(prev => ({ ...prev, [providerId]: false }));
            setKeyState(prev => ({ ...prev, [providerId]: '' }));
            setSavedKey(prev => ({ ...prev, [providerId]: false }));
            await refresh();
        } catch (e) {
            console.error(`Failed to remove ${providerId} API key:`, e);
        }
    }, [refresh]);

    const fetchModels = useCallback(async (providerId: string) => {
        setFetchingModels(providerId);
        try {
            await window.electronAPI.fetchEmbeddingModels?.(providerId);
            await refresh();
        } finally { setFetchingModels(null); }
    }, [refresh]);

    const saveEndpoint = useCallback(async () => {
        setEndpointSaving(true);
        setEndpointNote(null);
        setEndpointSaved(false);
        try {
            const r = await window.electronAPI.setEmbeddingCustomEndpoint?.({
                url: endpointDraft,
                apiKey: customApiKeyDraft || undefined
            });
            if (!r?.success) { setEndpointNote(r?.message || t('Could not save that endpoint.')); return; }
            setEndpointSaved(true);
            setTimeout(() => setEndpointSaved(false), 3000);
            if (endpointDraft.trim() && !r.reachable) {
                setEndpointNote(t('Saved, but no embedding models were found there. Check the server is running and serving an embeddings API.'));
            }
            await refresh();
        } finally { setEndpointSaving(false); }
    }, [endpointDraft, customApiKeyDraft, refresh, t]);

    const activeOptions: AipSelectOption[] = useMemo(() => {
        return providers
            .flatMap(p => {
                const primaryModels = p.models.filter(m =>
                    m.recommended ||
                    (active.provider === p.id && active.model === m.id)
                );
                const targetModels = primaryModels.length > 0 ? primaryModels : p.models.slice(0, 1);
                return targetModels.map(m => ({
                    id: `${p.id}::${m.id}`,
                    name: `${m.label || m.id} — ${p.name}`,
                }));
            });
    }, [providers, active]);

    const activeOptionId = active.provider && active.model ? `${active.provider}::${active.model}` : '';

    const activeDisplayLabel = useMemo(() => {
        if (!active.model) return t('Select embedding model');
        const matched = activeOptions.find(o => o.id === activeOptionId);
        if (matched) return matched.name;
        const providerName = active.provider ? (active.provider.charAt(0).toUpperCase() + active.provider.slice(1)) : '';
        return `${active.model}${providerName ? ` — ${providerName}` : ''}`;
    }, [active, activeOptionId, activeOptions, t]);

    const activeModelDetails = useMemo(() => {
        if (!active.configured) return null;

        const providerId = active.provider || 'local';
        const modelId = active.model || 'Xenova/all-MiniLM-L6-v2';

        const prov = providers.find(p => p.id === providerId);
        const mod = prov?.models.find(m => m.id === modelId);

        const dims = active.dimensions || mod?.dimensions || (providerId === 'gemini' ? 3072 : providerId === 'openai' ? 1536 : providerId === 'local' ? 384 : 768);

        const isLocal = active.location === 'on-device' || (prov ? !prov.cloud : (providerId === 'local' || providerId === 'ollama'));
        const isCloud = active.location === 'cloud' || (prov ? prov.cloud : (providerId === 'gemini' || providerId === 'openai' || providerId === 'natively'));
        const locationStr = isLocal ? t('On-device') : isCloud ? t('Cloud') : t('On-device');

        return {
            dims,
            locationStr,
            providerName: prov?.name || providerId,
            modelLabel: mod?.label || modelId,
        };
    }, [active, providers, t]);

    const CARD_ORDER = ['gemini', 'openai', 'voyage', 'openrouter', 'ollama', 'custom'] as const;
    const cardProviders = useMemo(
        () => CARD_ORDER
            .map(id => providers.find(p => p.id === id))
            .filter((p): p is CatalogProvider => !!p),
        [providers],
    );

    const providerBadge = (p: CatalogProvider): { tone: AipTone; label: string } | null => {
        if (p.available) return null;
        switch (p.unavailableReason) {
            case 'not_running': return { tone: 'neutral', label: t('Not running') };
            case 'blocked_by_policy': return { tone: 'warn', label: t('Blocked') };
            default: return null;
        }
    };

    const emptyLine = (p: CatalogProvider): string | null => {
        if (p.models.length > 0) return null;
        if (p.id === 'ollama') {
            return p.available
                ? t('Ollama is running but no embedding models are pulled. Pull one, for example nomic-embed-text or qwen3-embedding.')
                : t('Start Ollama to use local embedding models.');
        }
        return null;
    };

    const reasonLine = (p: CatalogProvider): string | null => {
        if (p.available || p.models.length === 0) return null;
        switch (p.unavailableReason) {
            case 'blocked_by_policy': return t('Your privacy settings do not allow embeddings to be sent to a cloud provider.');
            default: return null;
        }
    };

    const renderProvider = (p: CatalogProvider) => {
        const badge = providerBadge(p);
        const empty = emptyLine(p);
        const reason = reasonLine(p);
        const isActiveProvider = active.provider === p.id;
        // Gemini, OpenAI and Voyage document selectable output widths, so they get
        // a width control — and they may omit the width from the model labels,
        // because the control states it authoritatively right beside them.
        // (Voyage's domain models — code-4, finance-2, law-2 — are fixed at 1024;
        // the control renders disabled for those rather than disappearing.)
        const hasWidthPicker = p.id === 'gemini' || p.id === 'openai' || p.id === 'voyage' || p.id === 'openrouter';
        const enabled = isActiveProvider && active.model ? [active.model] : [];
        const isCloudWithKey = (p.id === 'gemini' || p.id === 'openai' || p.id === 'openrouter' || p.id === 'voyage');
        const hasStored = isCloudWithKey ? !!storedKeys[p.id] : p.id === 'custom' ? !!endpointDraft.trim() : p.available;
        const keyUrl = KEY_URLS[p.id];
        const placeholder = KEY_PLACEHOLDERS[p.id] || 'API key';

        return (
            <div key={p.id} className="aip-card aip-provider" data-off={p.available ? undefined : 'true'}>
                {/* Header */}
                <div className="aip-provider-head">
                    {p.id === 'local' ? <PlatformMark />
                        : p.id === 'custom' ? <CustomEndpointMark />
                            : <AipProviderMark provider={p.id} name={p.name} />}
                    <h4 className="aip-card-title truncate min-w-0">{p.name}</h4>
                    {badge && <AipBadge tone={badge.tone} label={badge.label} />}

                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        <span className="aip-meta inline-flex items-center gap-1.5">
                            {p.cloud
                                ? <><Cloud size={12} strokeWidth={1.75} /> {t('Cloud')}</>
                                : <><HardDrive size={12} strokeWidth={1.75} /> {t('On-device')}</>}
                        </span>

                        {keyUrl && (
                            <button
                                type="button"
                                className="aip-btn"
                                data-size="sm"
                                data-variant="ghost"
                                onClick={() => window.electronAPI.openExternal?.(keyUrl)}
                                title={`Get ${p.name} API Key`}
                            >
                                <span className="uppercase tracking-wide">{t('Get Key')}</span>
                                <ExternalLink size={12} strokeWidth={1.75} />
                            </button>
                        )}
                    </div>
                </div>

                {/* API Key Credential Row for Gemini and OpenAI */}
                {isCloudWithKey && (
                    <div className="aip-provider-row">
                        <div className="aip-provider-field">
                            <div className="aip-field">
                                <KeyRound size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                <input
                                    type="password"
                                    value={keyState[p.id] || ''}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setKeyState(prev => ({ ...prev, [p.id]: val }));
                                        setSavedKey(prev => ({ ...prev, [p.id]: false }));
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveKey(p.id as 'gemini' | 'openai' | 'openrouter' | 'voyage'); }}
                                    autoComplete="off"
                                    spellCheck={false}
                                    data-1p-ignore
                                    aria-label={`${p.name} ${t('API key')}`}
                                    placeholder={storedKeys[p.id] ? "••••••••••••" : placeholder}
                                    className="aip-input"
                                />
                                <button
                                    onClick={() => void handleSaveKey(p.id as 'gemini' | 'openai' | 'openrouter' | 'voyage')}
                                    disabled={savingKey[p.id] || (!keyState[p.id]?.trim() && !storedKeys[p.id])}
                                    className="aip-btn-seg aip-field-seg"
                                    data-tone={savedKey[p.id] ? 'ok' : undefined}
                                >
                                    {savingKey[p.id]
                                        ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Saving...')}</>
                                        : savedKey[p.id]
                                            ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Saved')}</>
                                            : t('Save')}
                                </button>
                            </div>
                            {storedKeys[p.id] && (
                                <button
                                    onClick={() => void handleRemoveKey(p.id as 'gemini' | 'openai' | 'openrouter' | 'voyage')}
                                    className="aip-btn shrink-0"
                                    data-icon="true"
                                    data-variant="danger-ghost"
                                    title={t("Remove API Key")}
                                >
                                    <Trash2 size={14} strokeWidth={1.75} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Custom Endpoint Credential & API Key Row */}
                {p.id === 'custom' && (
                    <div className="aip-provider-row flex-col sm:flex-row gap-2">
                        <div className="aip-provider-field flex-1">
                            <div className="aip-field">
                                <Server size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                                <input
                                    type="text"
                                    value={endpointDraft}
                                    onChange={(e) => { setEndpointDraft(e.target.value); setEndpointSaved(false); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEndpoint(); }}
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-label={t('Custom embedding endpoint URL')}
                                    placeholder="http://localhost:1234"
                                    className="aip-input"
                                />
                                <button
                                    onClick={() => { void saveEndpoint(); }}
                                    disabled={endpointSaving}
                                    className="aip-field-seg"
                                    data-tone={endpointSaved ? 'ok' : undefined}
                                >
                                    {endpointSaving
                                        ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Saving...')}</>
                                        : endpointSaved
                                            ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Saved')}</>
                                            : t('Save')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Action row: Test Connection & Models List */}
                <div className="aip-provider-row">
                    {hasStored && (
                        <button
                            type="button"
                            onClick={() => void handleTestProvider(p.id)}
                            disabled={testStatus[p.id] === 'testing'}
                            className="aip-btn shrink-0"
                            data-tone={testStatus[p.id] === 'success' ? 'ok' : testStatus[p.id] === 'error' ? 'danger' : undefined}
                            title={testErrors[p.id] || t('Test Connection')}
                        >
                            {testStatus[p.id] === 'testing' ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Testing...')}</> :
                                testStatus[p.id] === 'success' ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Passed')}</> :
                                    testStatus[p.id] === 'error' ? <><AlertCircle size={12} strokeWidth={1.75} /> {t('Error')}</> :
                                        <>{t('Test Connection')}</>}
                        </button>
                    )}

                    {/* Dimensions — between Test and the model list, and RENDERED
                        WHENEVER THE PROVIDER SUPPORTS WIDTHS rather than only while
                        it is the active one. It used to disappear the moment you
                        switched provider, so the row's controls moved under the
                        cursor; ProviderCard's rule is rendered-and-disabled, never
                        conditionally removed.

                        Only OpenAI and Gemini document selectable widths. Ollama,
                        the custom endpoint and the bundled model have a width fixed
                        by the model itself (we measure it), so a picker there would
                        be a control that cannot do anything. */}
                    {hasWidthPicker && (() => {
                        // The model this width would apply to: the active one when
                        // this provider is active, otherwise the one that would be
                        // picked if you chose this provider now.
                        const target =
                            (isActiveProvider && active.model
                                ? p.models.find(m => m.id === active.model)
                                : undefined)
                            ?? p.models.find(m => m.recommended)
                            ?? p.models[0];

                        const widths = target?.supportedDimensions;
                        // ada-002 takes no `dimensions` parameter at all, so offering
                        // one option would imply a choice that does not exist.
                        const fixedWidth = !!target && (!widths || widths.length < 2);

                        // Width is a property OF THE MODEL, so it may only show the
                        // live value when `target` really is the model in use.
                        // Keying it on isActiveProvider alone showed the active
                        // model's width against a DIFFERENT model whenever the
                        // active one was missing from this list (a stale id, or a
                        // refresh that no longer returns it) — the target then fell
                        // back to the recommended model while the number did not.
                        const showsActiveModel = isActiveProvider && !!target && target.id === active.model;
                        const current = (showsActiveModel && active.dimensions)
                            ? active.dimensions
                            : (target?.dimensions ?? 0);

                        // "Fixed" and "not known yet" are different states and must
                        // not share a message. OpenRouter's listing carries no
                        // dimension data, so an unrecognised model there has an
                        // UNKNOWN width — it is measured when you select it — while
                        // ada-002 or voyage-code-4 are genuinely fixed.
                        const widthUnknown = !!target && !widths && current === 0;
                        const hint = !p.available
                            ? t('Add a key to change the width.')
                            : !target
                                ? t('Pick a model first.')
                                : widthUnknown
                                    ? t('Width is measured when you select this model.')
                                    : fixedWidth
                                        ? t('This model has a fixed output width.')
                                        : undefined;

                        return (
                            // EmbeddingModelSelect, not AipSelect: the shared one
                            // opens an IN-FLOW .aip-reveal (grid-rows 0fr->1fr), so
                            // expanding it pushed the card taller and shoved the
                            // rows below it down. This one floats the menu
                            // (.aip-float + absolute top-full), which is why the
                            // Active Model card does not move when you open it.
                            <EmbeddingModelSelect
                                // Names the model, because the number alone is
                                // ambiguous: when this provider is not the active
                                // one the models list reads "None selected", so
                                // nothing else on the row says which model this
                                // width belongs to.
                                ariaLabel={target ? `${t('Output width for')} ${target.label || target.id}` : t('Output width')}
                                title={hint}
                                // Narrow: it holds "3072d", not a model name.
                                containerClassName="relative shrink-0 w-[104px]"
                                value={current ? String(current) : ''}
                                options={(fixedWidth || !widths ? (current ? [current] : []) : widths)
                                    .map(d => ({ id: String(d), name: `${d}d` }))}
                                // Short: the control is 104px and holds a value
                                // like '3072d'. 'Dimensions' truncated to 'Dimens…'.
                                placeholder={t('Width')}
                                disabled={!!pending || !p.available || !!p.managed || fixedWidth || !target}
                                // Changing the width selects this provider and model
                                // at that width — the same act as picking a row in
                                // the list, and it re-indexes for the same reason.
                                onChange={(d) => { if (target) void select(p.id, target.id, Number(d)); }}
                            />
                        );
                    })()}

                    {p.models.length > 0 && (
                        <AipModelList
                            models={p.models.map(m => ({
                                id: m.id,
                                // The width belongs to the width control, not here.
                                // Repeating it made every row read
                                // "model · 3072d · default" beside a picker already
                                // showing 3072d.
                                //
                                // Ollama, the custom endpoint and the bundled model
                                // have NO picker — their width is fixed by the model
                                // and only MEASURED — so there it stays, including
                                // the "reported" qualifier that flags a width the
                                // provider declared rather than one we verified.
                                // OpenRouter fronts many vendors, so choosing a
                                // model there IS a price decision — and it has no
                                // width picker, so the label is the only surface.
                                // Price comes from OpenRouter's own listing.
                                label: p.id === 'openrouter'
                                    ? (m.pricePerMillion === undefined
                                        ? m.label
                                        : m.pricePerMillion === 0
                                            ? `${m.label} · ${t('free')}`
                                            : `${m.label} · $${m.pricePerMillion}/1M`)
                                    : (!hasWidthPicker && m.dimensions > 0)
                                        ? `${m.label} · ${m.dimensions}d${m.dimensionsVerified ? '' : ' ' + t('reported')}`
                                        : m.label,
                            }))}
                            optIn
                            enabled={enabled}
                            defaultId={isActiveProvider ? (active.model ?? undefined) : undefined}
                            onToggle={(id) => { if (!p.managed && p.available) void select(p.id, id); }}
                            onSetDefault={(id) => { if (!p.managed && p.available) void select(p.id, id); }}
                            onReset={() => { }}
                            error={note && isActiveProvider ? 'save-failed' : null}
                            refreshing={fetchingModels === p.id || !!pending}
                            onRefresh={
                                p.id === 'openai' || p.id === 'gemini'
                                    ? () => { void fetchModels(p.id); }
                                    : p.id === 'ollama' || p.id === 'custom'
                                        ? () => { void refresh(); }
                                        : undefined
                            }
                            onFirstOpen={() => {
                                if ((p.id === 'openai' || p.id === 'gemini') && p.available && !hasCatalog[p.id]) {
                                    void fetchModels(p.id);
                                }
                            }}
                        />
                    )}

                </div>

                {empty && <p className="aip-meta aip-provider-note">{empty}</p>}
                {reason && <p className="aip-meta aip-provider-note">{reason}</p>}
                {testErrors[p.id] && (
                    <p className="aip-meta aip-danger-fg aip-provider-note">{testErrors[p.id]}</p>
                )}
                {p.id === 'custom' && !p.endpoint && (
                    <p className="aip-meta aip-provider-note">
                        {t('Any OpenAI-compatible embeddings server — LM Studio (port 1234), llama.cpp\'s llama-server started with --embedding (port 8080), vLLM, or a proxy.')}
                    </p>
                )}
                {p.id === 'custom' && p.capabilityUnknown && p.models.length > 0 && (
                    <p className="aip-meta aip-provider-note">
                        {t('This server does not report which models can embed, so all of them are listed. One that cannot embed will fail the size check rather than be stored.')}
                    </p>
                )}
                {p.id === 'custom' && endpointNote && (
                    <p className="aip-meta aip-danger-fg aip-provider-note">{endpointNote}</p>
                )}
            </div>
        );
    };

    return (
        <div className="aip-root space-y-5 pb-10" data-theme={aipTheme} data-settings-stagger>
            <header className="space-y-1">
                <h3 className="aip-title">{t('Embeddings')}</h3>
                <p className="aip-subtitle">
                    {t('Pick the model that indexes your documents for retrieval. It is chosen separately from your AI model, and changing it re-indexes your project.')}
                </p>
            </header>

            {/* Active Model Card — matches AI Providers Active Model card styling */}
            <div className="aip-card p-5">
                <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                        {/* No "Lightweight" badge. AI Providers' own rule is that a
                            badge carries only what NO other control already says —
                            and the notice below states it in words, with the reason
                            and a way to dismiss it. The badge was an echo. */}
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">
                            {t('Active Embedding Model')}
                        </label>
                        <p className="text-[10px] aip-muted mt-0.5">
                            {active.configured && activeModelDetails
                                ? `${activeModelDetails.dims} dimensions · ${activeModelDetails.locationStr} · ${t('Changing model re-indexes your project')}`
                                : active.configured
                                    ? `${t('Configured')} · ${t('Changing model re-indexes your project')}`
                                    : t('Natively could not resolve an embedding provider.')}
                        </p>
                    </div>

                    <div className="shrink-0">
                        <EmbeddingModelSelect
                            value={activeOptionId}
                            options={activeOptions}
                            placeholder={activeDisplayLabel}
                            disabled={!!pending || activeOptions.length === 0}
                            onChange={(id) => {
                                const [providerId, ...rest] = id.split('::');
                                void select(providerId, rest.join('::'));
                            }}
                        />
                    </div>
                </div>

                {active.lightweight && !acknowledged && (
                    <div className="aip-inline-warn flex items-start gap-2 pt-3" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="min-w-0">
                            {t('This is the compatibility default. It may retrieve less well on large projects, which can affect answer quality even with a strong AI model.')}
                        </span>
                        <button
                            type="button"
                            className="aip-btn shrink-0 ml-auto"
                            data-size="sm"
                            onClick={async () => {
                                await window.electronAPI.acknowledgeLightweightEmbeddings?.(true);
                                setAcknowledged(true);
                            }}
                        >
                            {t('Keep it')}
                        </button>
                    </div>
                )}

                {reindexing && (
                    <p className="aip-meta aip-provider-note pt-2">
                        {t('Re-indexing your project — embeddings from a different model cannot be compared with the new one.')}
                    </p>
                )}

                {(activeTestResult?.message || note) && (
                    <p className="aip-meta aip-danger-fg aip-provider-note pt-2">{activeTestResult?.message || note}</p>
                )}
            </div>

            {/* Provider Cards Stack */}
            {!loaded ? (
                <div
                    className="aip-cq space-y-4"
                    role="status"
                    aria-label={t('Loading embedding providers')}
                    data-stagger-skip
                >
                    <SkeletonProviderCard />
                    <SkeletonProviderCard />
                </div>
            ) : cardProviders.length === 0 ? (
                <div className="aip-card aip-card-dashed text-center py-8">
                    <p className="text-xs aip-muted">{t('No configurable embedding providers were found.')}</p>
                </div>
            ) : (
                <div className="aip-cq space-y-4">
                    {cardProviders.map(renderProvider)}
                </div>
            )}

            <style>{AIP_CSS}</style>
        </div>
    );
};
