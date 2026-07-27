import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useT } from '../../i18n';
import { Trash2, AlertCircle, CheckCircle, ExternalLink, Loader2, ChevronDown, Check, RefreshCw, SlidersHorizontal, Filter, Eye, Brain, FileText, Zap, DollarSign } from 'lucide-react';
import { STANDARD_CLOUD_MODELS } from '../../utils/modelUtils';
import { Dialog, DialogContent } from '../ui/dialog';

interface FetchedModel {
    id: string;
    label: string;
    supportsVision?: boolean;
    supportsReasoning?: boolean;
    contextLength?: number;
    pricing?: { prompt?: string; completion?: string };
}

interface ProviderCardProps {
    providerId: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek' | 'openrouter';
    providerName: string;
    apiKey: string;
    preferredModel?: string;
    enabledModels?: string[];
    onSetEnabledModels?: (models: string[]) => void;
    hasStoredKey: boolean;
    onKeyChange: (key: string) => void;
    onSaveKey: () => Promise<void>;
    onRemoveKey: () => void;
    onTestConnection: () => void;
    testStatus: 'idle' | 'testing' | 'success' | 'error';
    testError?: string;
    savingStatus: boolean;
    savedStatus: boolean;
    keyPlaceholder: string;
    keyUrl: string;
    onPreferredModelChange?: (modelId: string) => void;
    isDisabled?: boolean;
    onToggleDisabled?: (disabled: boolean) => void;
    icon?: React.ReactNode;
    isFastProvider?: boolean;
    fastModeEnabled?: boolean;
    onToggleFastMode?: (enabled: boolean) => void;
    id?: string;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId,
    providerName,
    apiKey,
    preferredModel: _preferredModel,
    enabledModels = [],
    onSetEnabledModels,
    hasStoredKey,
    onKeyChange,
    onSaveKey,
    onRemoveKey,
    onTestConnection,
    testStatus,
    testError,
    savingStatus,
    savedStatus,
    keyPlaceholder,
    keyUrl,
    onPreferredModelChange: _onPreferredModelChange,
    isDisabled = false,
    onToggleDisabled,
    icon,
    isFastProvider = false,
    fastModeEnabled = false,
    onToggleFastMode,
    id,
}) => {
    const t = useT();
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);
    const [modalityFilter, setModalityFilter] = useState<'all' | 'vision' | 'reasoning'>('all');

    // OpenRouter Specific State
    const [openrouterKeyInfo, setOpenrouterKeyInfo] = useState<{ usage?: number; limit?: number | null; is_free_tier?: boolean; label?: string } | null>(null);
    const [isLoadingKeyInfo, setIsLoadingKeyInfo] = useState(false);
    const [openrouterPrefs, setOpenrouterPrefs] = useState<{
        reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';
        providerSort?: 'latency' | 'price' | 'throughput';
        allowFallbacks?: boolean;
    }>({ reasoningEffort: 'medium', providerSort: 'latency', allowFallbacks: true });

    // Refs to avoid stale closures in the auto-save timer
    const savedRef = useRef(savedStatus);
    const savingRef = useRef(savingStatus);
    savedRef.current = savedStatus;
    savingRef.current = savingStatus;

    // Load cached models or fallback to standard models
    useEffect(() => {
        const cacheKey = `cached-models-${providerId}`;
        const cachedStr = localStorage.getItem(cacheKey);
        let list: FetchedModel[] = [];
        let cacheHasModalityData = false;

        if (cachedStr) {
            try {
                const parsed = JSON.parse(cachedStr);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    list = parsed;
                    // Check if cached data has real modality fields (not just heuristic placeholders).
                    // If even one model has the flag explicitly set (true or false), we treat it as rich.
                    cacheHasModalityData = parsed.some((m: any) => m.supportsVision === true || m.supportsVision === false);
                }
            } catch { /* noop */ }
        }

        // If cache lacks real modality data, discard it — the auto-fetch on modal open
        // will pull fresh accurate data from the API instead.
        if (!cacheHasModalityData) {
            list = [];
        }

        // Merge in standard preset models (only if not already in list)
        const std = STANDARD_CLOUD_MODELS[providerId];
        if (std) {
            std.ids.forEach((id, i) => {
                if (!list.some(m => m.id === id)) {
                    list.push({ id, label: std.names[i] || id });
                }
            });
        }

        setFetchedModels(list);
    }, [providerId]);

    // Load OpenRouter key info & preferences
    const fetchOpenrouterKeyInfo = async () => {
        if (providerId !== 'openrouter' || !hasStoredKey) return;
        setIsLoadingKeyInfo(true);
        try {
            // @ts-ignore
            const result = await window.electronAPI?.getOpenrouterKeyInfo();
            if (result?.success && result.data) {
                setOpenrouterKeyInfo(result.data);
            }
        } catch { /* noop */ }
        finally { setIsLoadingKeyInfo(false); }
    };

    // Load OpenRouter key info & preferences — guarded so it only fires
    // once when the key first becomes available, not on every parent re-render.
    const keyInfoFetchedRef = useRef(false);
    useEffect(() => {
        if (providerId === 'openrouter' && hasStoredKey && !keyInfoFetchedRef.current) {
            keyInfoFetchedRef.current = true;
            fetchOpenrouterKeyInfo();
            // @ts-ignore
            window.electronAPI?.getOpenrouterPreferences().then((res: any) => {
                if (res?.success && res.preferences) {
                    setOpenrouterPrefs(res.preferences);
                }
            }).catch(() => {});
        }
        // Reset so fetching retriggers if the key is removed then re-added
        if (!hasStoredKey) keyInfoFetchedRef.current = false;
    }, [providerId, hasStoredKey]);

    const handleUpdateOpenrouterPrefs = async (newPrefs: Partial<typeof openrouterPrefs>) => {
        const updated = { ...openrouterPrefs, ...newPrefs };
        setOpenrouterPrefs(updated);
        try {
            // @ts-ignore
            await window.electronAPI?.setOpenrouterPreferences(updated);
        } catch { /* noop */ }
    };

    // Auto-save API key after 5 seconds of inactivity when not saved
    useEffect(() => {
        if (hasStoredKey || !apiKey.trim()) return;
        const timer = setTimeout(() => {
            if (!savedRef.current && !savingRef.current) {
                onSaveKey().catch(console.error);
            }
        }, 5000);
        return () => clearTimeout(timer);
    }, [apiKey, hasStoredKey]);

    const handleFetchModels = async () => {
        setIsFetching(true);
        setFetchError(null);

        try {
            if (!hasStoredKey && apiKey.trim()) {
                await onSaveKey();
            }

            const keyToUse = apiKey.trim() || '';
            // @ts-ignore
            const result = await window.electronAPI?.fetchProviderModels(providerId, keyToUse);

            if (result?.success && result.models && result.models.length > 0) {
                setFetchedModels(result.models);
                try {
                    localStorage.setItem(`cached-models-${providerId}`, JSON.stringify(result.models));
                } catch { /* noop */ }
            } else {
                setFetchError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            setFetchError(e.message || 'Failed to fetch models');
        } finally {
            setIsFetching(false);
        }
    };

    // Auto-fetch full model catalog when modal opens — only if we're showing
    // fewer than 10 models (preset-only state) and haven't already fetched.
    // A ref guard prevents duplicate calls if the effect fires more than once.
    const autoFetchedRef = useRef(false);
    useEffect(() => {
        if (isManageModalOpen && !autoFetchedRef.current && fetchedModels.length <= 10 && hasStoredKey && !isFetching) {
            autoFetchedRef.current = true;
            handleFetchModels();
        }
        // Reset guard when modal is closed so next open can re-fetch if still stale
        if (!isManageModalOpen) autoFetchedRef.current = false;
    }, [isManageModalOpen, hasStoredKey]);

    const handleToggleModel = (modelId: string) => {
        if (!onSetEnabledModels) return;

        let currentEnabled: string[];
        if (!enabledModels || enabledModels.length === 0) {
            // When all are enabled by default, toggling off one model leaves all remaining enabled
            currentEnabled = fetchedModels.map(m => m.id);
        } else {
            currentEnabled = enabledModels.filter(m => m !== '_none_');
        }

        const enabledSet = new Set(currentEnabled);
        if (enabledSet.has(modelId)) {
            enabledSet.delete(modelId);
        } else {
            enabledSet.add(modelId);
        }

        let next = Array.from(enabledSet);
        if (next.length === 0) next = ['_none_'];
        onSetEnabledModels(next);
        // @ts-ignore
        window.electronAPI?.setCloudEnabledModels?.(providerId, next);
    };

    const handleEnableAll = () => {
        if (!onSetEnabledModels) return;
        const allIds = fetchedModels.map(m => m.id);
        onSetEnabledModels(allIds);
        // @ts-ignore
        window.electronAPI?.setCloudEnabledModels?.(providerId, allIds);
    };

    const handleDisableAll = () => {
        if (!onSetEnabledModels) return;
        onSetEnabledModels(['_none_']);
        // @ts-ignore
        window.electronAPI?.setCloudEnabledModels?.(providerId, ['_none_']);
    };

    const totalModels = fetchedModels.length;
    const isNone = enabledModels.includes('_none_');
    const enabledCount = isNone
        ? 0
        : (!enabledModels || enabledModels.length === 0)
            ? totalModels
            : fetchedModels.filter(m => enabledModels.includes(m.id)).length;

    const filteredModels = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        return fetchedModels.filter(m => {
            if (query && !m.label.toLowerCase().includes(query) && !m.id.toLowerCase().includes(query)) {
                return false;
            }
            if (showSelectedOnly) {
                const isEnabled = (!enabledModels || enabledModels.length === 0) || (enabledModels.includes(m.id) && !enabledModels.includes('_none_'));
                if (!isEnabled) return false;
            }
            if (modalityFilter === 'vision' && !m.supportsVision) return false;
            if (modalityFilter === 'reasoning' && !m.supportsReasoning) return false;
            return true;
        });
    }, [fetchedModels, searchQuery, showSelectedOnly, modalityFilter, enabledModels]);

    return (
        <div id={id || `provider-card-${providerId}`} className={`bg-bg-item-surface rounded-xl p-5 border transition-all ${isDisabled ? 'border-transparent bg-bg-item-surface/40 opacity-70 shadow-none' : 'border-border-subtle'}`}>
            {/* Header Row */}
            <div className={`flex items-center justify-between ${isDisabled ? 'mb-0' : 'mb-3'}`}>
                <div className="flex items-center gap-2.5">
                    {icon && <div className="shrink-0 flex items-center justify-center">{icon}</div>}
                    <label className="flex items-center gap-2 text-xs font-bold text-text-primary uppercase tracking-wide">
                        {providerName} {t('API Key')}
                    </label>
                    {isDisabled ? (
                        <span className="text-[10px] font-semibold text-amber-500/90 dark:text-amber-400/90 uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                            {t('Disabled')}
                        </span>
                    ) : hasStoredKey ? (
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center gap-1">
                            ✓ {t('Configured')}
                        </span>
                    ) : (
                        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-2 py-0.5 bg-bg-input border border-border-subtle rounded-full">
                            {t('Not Set')}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {isFastProvider && onToggleFastMode && !isDisabled && (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 rounded-lg border border-orange-500/20" title={t("Fast Response Mode for this provider")}>
                            <span className="text-[10px] font-bold text-orange-500 dark:text-orange-400 flex items-center gap-0.5">⚡ {t('Fast Mode')}</span>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleFastMode(!fastModeEnabled);
                                }}
                                className={`w-7 h-4 rounded-full relative cursor-pointer transition-colors ${fastModeEnabled ? 'bg-orange-500' : 'bg-zinc-300 dark:bg-zinc-700/80 border border-zinc-400/40 dark:border-zinc-600/50'}`}
                            >
                                <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${fastModeEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    )}
                    <button
                        onClick={() => {
                            if (isDisabled) return;
                            // @ts-ignore
                            window.electronAPI?.openExternal(keyUrl);
                        }}
                        className={`text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}
                        title={`Get ${providerName} API Key`}
                        disabled={isDisabled}
                    >
                        <span className="text-[10px] uppercase tracking-wide">{t('Get Key')}</span>
                        <ExternalLink size={12} />
                    </button>
                    {onToggleDisabled && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleDisabled(!isDisabled);
                            }}
                            className={`shrink-0 w-9 h-5 rounded-full relative cursor-pointer transition-colors border ${isDisabled ? 'bg-zinc-300 dark:bg-zinc-700/80 border-zinc-400/40 dark:border-zinc-600/50' : 'bg-emerald-500 border-emerald-400'}`}
                            title={isDisabled ? t("Enable Provider") : t("Disable Provider")}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${isDisabled ? 'translate-x-0' : 'translate-x-4'}`} />
                        </button>
                    )}
                </div>
            </div>

            {!isDisabled && (
                <>
                    {/* UNCONFIGURED STATE: Show API Key Input + Save Button only */}
                    {!hasStoredKey ? (
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => onKeyChange(e.target.value)}
                                placeholder={keyPlaceholder}
                                disabled={isDisabled}
                                className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors disabled:opacity-50"
                            />
                            <button
                                onClick={onSaveKey}
                                disabled={savingStatus || !apiKey.trim() || isDisabled}
                                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${savedStatus
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                                    }`}
                            >
                                {savingStatus ? t('Saving...') : savedStatus ? t('Saved!') : t('Save')}
                            </button>
                        </div>
                    ) : (
                        /* CONFIGURED STATE: Show Manage Models + Test Connection + Remove Key */
                        <div className="flex items-center justify-between gap-2.5 w-full">
                            {/* 1. Manage Models Button */}
                            <button
                                type="button"
                                onClick={() => setIsManageModalOpen(true)}
                                disabled={isDisabled}
                                className="flex-1 max-w-[320px] bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between transition-colors cursor-pointer disabled:opacity-50"
                            >
                                <div className="flex items-center gap-2 truncate">
                                    <SlidersHorizontal size={13} className="text-accent-primary shrink-0" />
                                    <span className="truncate font-medium">
                                        {t('Manage Models')} ({enabledCount}/{totalModels})
                                    </span>
                                </div>
                                <ChevronDown size={14} className="text-text-secondary shrink-0 ml-1" />
                            </button>

                            <div className="flex items-center gap-2 shrink-0">
                                {/* 2. Test Connection Button */}
                                <button
                                    onClick={onTestConnection}
                                    disabled={testStatus === 'testing' || isDisabled}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 cursor-pointer ${testStatus === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                        testStatus === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                        'bg-bg-input hover:bg-bg-elevated text-text-primary'
                                        } disabled:opacity-50`}
                                    title={testError || t("Test Connection")}
                                >
                                    {testStatus === 'testing' ? <><Loader2 size={12} className="animate-spin" /> {t('Testing...')}</> :
                                        testStatus === 'success' ? <><CheckCircle size={12} /> {t('Connected')}</> :
                                        testStatus === 'error' ? <><AlertCircle size={12} /> {t('Error')}</> :
                                        <>{t('Test Connection')}</>}
                                </button>

                                {/* 3. Remove API Key Button */}
                                <button
                                    onClick={onRemoveKey}
                                    disabled={isDisabled}
                                    className="p-2 rounded-md text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center"
                                    title={t("Remove API Key")}
                                >
                                    <Trash2 size={14} strokeWidth={1.5} />
                                </button>
                            </div>
                        </div>
                    )}

                    {testStatus === 'error' && testError && (
                        <div className="mt-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-2 flex items-center gap-2">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>{testError}</span>
                        </div>
                    )}

                    {/* OpenRouter Token Budget / Credit Info & Advanced Controls */}
                    {providerId === 'openrouter' && hasStoredKey && (
                        <div className="mt-4 pt-3.5 border-t border-border-subtle/60 space-y-3">
                            {/* Credit Info Badge */}
                            <div className="flex items-center justify-between bg-bg-input/60 rounded-lg p-2.5 border border-border-subtle/50 text-xs">
                                <div className="flex items-center gap-2">
                                    <DollarSign size={14} className="text-emerald-500" />
                                    <span className="font-semibold text-text-primary">{t('OpenRouter Account Budget')}</span>
                                    {openrouterKeyInfo?.is_free_tier && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase">{t('Free Tier')}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {openrouterKeyInfo ? (
                                        <span className="font-mono text-[11px] text-text-secondary">
                                            {t('Usage')}: ${openrouterKeyInfo.usage ? openrouterKeyInfo.usage.toFixed(4) : '0.00'}
                                            {openrouterKeyInfo.limit ? ` / $${openrouterKeyInfo.limit}` : ''}
                                        </span>
                                    ) : (
                                        <span className="text-[11px] text-text-tertiary">{t('Key Info Available')}</span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={fetchOpenrouterKeyInfo}
                                        disabled={isLoadingKeyInfo}
                                        className="p-1 text-text-tertiary hover:text-text-primary rounded hover:bg-bg-item-surface transition-colors cursor-pointer"
                                        title={t('Refresh Account Balance')}
                                    >
                                        <RefreshCw size={12} className={isLoadingKeyInfo ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                            </div>

                            {/* OpenRouter Advanced Tuning Controls */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* Reasoning / Thinking Control */}
                                <div className="bg-bg-input/40 p-2.5 rounded-lg border border-border-subtle/40 space-y-1">
                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
                                        <Brain size={12} className="text-purple-400" />
                                        <span>{t('Reasoning / Thinking Effort')}</span>
                                    </div>
                                    <select
                                        value={openrouterPrefs.reasoningEffort || 'medium'}
                                        onChange={(e) => handleUpdateOpenrouterPrefs({ reasoningEffort: e.target.value as any })}
                                        className="w-full bg-bg-input border border-border-subtle rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                                    >
                                        <option value="none">{t('Disabled (No Thinking Tokens)')}</option>
                                        <option value="low">{t('Low Effort')}</option>
                                        <option value="medium">{t('Medium Effort (Default)')}</option>
                                        <option value="high">{t('High Effort')}</option>
                                        <option value="max">{t('Max Effort')}</option>
                                    </select>
                                </div>

                                {/* Provider Routing Strategy */}
                                <div className="bg-bg-input/40 p-2.5 rounded-lg border border-border-subtle/40 space-y-1">
                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
                                        <Zap size={12} className="text-amber-400" />
                                        <span>{t('Upstream Routing Strategy')}</span>
                                    </div>
                                    <select
                                        value={openrouterPrefs.providerSort || 'latency'}
                                        onChange={(e) => handleUpdateOpenrouterPrefs({ providerSort: e.target.value as any })}
                                        className="w-full bg-bg-input border border-border-subtle rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                                    >
                                        <option value="latency">{t('Lowest Latency (Fastest Response)')}</option>
                                        <option value="price">{t('Lowest Price (Cheapest Provider)')}</option>
                                        <option value="throughput">{t('Highest Throughput')}</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}
                    {fetchError && (
                        <div className="mt-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-md p-2 flex items-center gap-2">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>{fetchError}</span>
                        </div>
                    )}
                </>
            )}

            {/* MANAGE SELECTABLE MODELS MODAL FOR THIS PROVIDER */}
            <Dialog open={isManageModalOpen} onOpenChange={setIsManageModalOpen}>
                <DialogContent className="w-[540px] max-w-[92vw] bg-bg-elevated border border-border-subtle p-6 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animated fadeIn text-xs text-text-primary opacity-100 ring-1 ring-border-subtle/50">
                    <div className="flex items-center justify-between mb-4 border-b border-border-subtle pb-3">
                        <div>
                            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                {t('Manage Selectable')} {providerName} {t('Models')}
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                                    {enabledCount} / {totalModels} Enabled
                                </span>
                            </h3>
                            <p className="text-[11px] text-text-secondary mt-0.5">{t('Select which models appear in your active model dropdowns.')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsManageModalOpen(false)}
                            className="p-1.5 rounded-lg hover:bg-bg-input text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Search & Refresh Actions */}
                    <div className="flex gap-2 mb-3 shrink-0">
                        <input
                            type="text"
                            placeholder={t('Search models...')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary font-mono"
                        />
                        <button
                            type="button"
                            onClick={handleFetchModels}
                            disabled={isFetching}
                            className="px-3.5 py-2 bg-accent-primary hover:bg-accent-primary-hover text-white rounded-lg font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                            title={t("Fetch/Discover latest models for this provider")}
                        >
                            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
                            {isFetching ? t('Fetching...') : t('Fetch Models')}
                        </button>
                    </div>

                    {/* Quick Selection Buttons + Modality Filter Chips + Show Selected Filter */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={handleEnableAll}
                                className="px-2.5 py-1 bg-bg-input hover:bg-bg-item-surface border border-border-subtle rounded-md text-[11px] font-medium text-text-primary transition-colors cursor-pointer"
                            >
                                {t('Enable All')}
                            </button>
                            <button
                                type="button"
                                onClick={handleDisableAll}
                                className="px-2.5 py-1 bg-bg-input hover:bg-bg-item-surface border border-border-subtle rounded-md text-[11px] font-medium text-text-primary transition-colors cursor-pointer"
                            >
                                {t('Disable All')}
                            </button>
                        </div>

                        {/* Modality Filters — Only rendered for OpenRouter provider */}
                        {providerId === 'openrouter' && (
                            <div className="flex items-center gap-1 bg-bg-input p-0.5 rounded-lg border border-border-subtle">
                                <button
                                    type="button"
                                    onClick={() => setModalityFilter('all')}
                                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${modalityFilter === 'all' ? 'bg-accent-primary text-white font-bold' : 'text-text-tertiary hover:text-text-primary'}`}
                                >
                                    {t('All')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setModalityFilter('vision')}
                                    className={`px-2 py-0.5 text-[10px] font-medium rounded flex items-center gap-1 transition-colors ${modalityFilter === 'vision' ? 'bg-accent-primary text-white font-bold' : 'text-text-tertiary hover:text-text-primary'}`}
                                >
                                    <Eye size={10} />
                                    {t('Vision')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setModalityFilter('reasoning')}
                                    className={`px-2 py-0.5 text-[10px] font-medium rounded flex items-center gap-1 transition-colors ${modalityFilter === 'reasoning' ? 'bg-accent-primary text-white font-bold' : 'text-text-tertiary hover:text-text-primary'}`}
                                >
                                    <Brain size={10} />
                                    {t('Reasoning')}
                                </button>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                                showSelectedOnly
                                    ? 'bg-accent-primary/20 border-accent-primary/50 text-accent-primary font-bold'
                                    : 'bg-bg-input hover:bg-bg-item-surface border-border-subtle text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            <Filter size={11} />
                            {showSelectedOnly ? t('Selected Only') : t('Show All')}
                        </button>
                    </div>

                    {/* Scrollable Model List */}
                    <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[360px] border border-border-subtle rounded-xl bg-bg-input p-2 space-y-1.5">
                        {filteredModels.map((model) => {
                            const isModelEnabled = (!enabledModels || enabledModels.length === 0) || (enabledModels.includes(model.id) && !enabledModels.includes('_none_'));

                            return (
                                <div
                                    key={model.id}
                                    onClick={() => handleToggleModel(model.id)}
                                    className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors duration-150 cursor-pointer ${
                                        isModelEnabled
                                            ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-900 dark:text-emerald-300'
                                            : 'bg-bg-item-surface dark:bg-zinc-900/60 border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-700/60 dark:hover:bg-zinc-800/80'
                                    }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className={`w-4 h-4 rounded border transition-colors flex items-center justify-center shrink-0 ${
                                            isModelEnabled
                                                ? 'bg-emerald-500 border-emerald-400 text-white'
                                                : 'bg-bg-input border-zinc-400 dark:border-zinc-500 text-transparent hover:border-zinc-500 dark:hover:border-zinc-400'
                                        }`}>
                                            <Check size={11} strokeWidth={3} />
                                        </div>
                                        <div className="flex flex-col truncate flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs text-text-primary truncate" title={model.id}>
                                                    {model.label}
                                                </span>
                                                {/* Capability / Modality Badges — Only for OpenRouter models when API data is present */}
                                                {providerId === 'openrouter' && (
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        {model.supportsVision === true && (
                                                            <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 text-[9px] font-semibold flex items-center gap-0.5" title={t('Vision / Image Input Supported')}>
                                                                <Eye size={9} />
                                                                {t('Vision')}
                                                            </span>
                                                        )}
                                                        {model.supportsReasoning === true && (
                                                            <span className="px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-400 text-[9px] font-semibold flex items-center gap-0.5" title={t('Reasoning / Extended Thinking Supported')}>
                                                                <Brain size={9} />
                                                                {t('Reasoning')}
                                                            </span>
                                                        )}
                                                        {model.supportsVision === false && model.supportsReasoning !== true && (
                                                            <span className="px-1.5 py-0.2 rounded bg-zinc-500/10 text-zinc-400 text-[9px] font-medium flex items-center gap-0.5" title={t('Text-only Input')}>
                                                                <FileText size={9} />
                                                                {t('Text')}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {model.id !== model.label && (
                                                <span className="font-mono text-[10px] text-text-tertiary truncate">
                                                    {model.id}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredModels.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-10 text-text-tertiary text-[11px] italic gap-1">
                                <span>{showSelectedOnly ? t('No selected models to display.') : t('No models found.')}</span>
                                <span>{t('Click "Fetch Models" to discover available models for this provider.')}</span>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
