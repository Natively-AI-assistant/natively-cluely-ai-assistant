import React, { useState, useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { Trash2, AlertCircle, ExternalLink, Loader2, ChevronDown, Check, RefreshCw } from 'lucide-react';
// Primitives live in AIProvidersSettings.tsx, not in their own module:
// SettingsOrchidPortalScopeGuard.test.mjs asserts that the *.tsx files on disk in
// src/components/settings/ EXACTLY equal its GUARDED_FILES list, so adding a file
// here fails that suite. The resulting import cycle is safe — every reference
// below is inside a render function, never at module-evaluation time.
import { AipBadge, AipSwitch, AipProviderMark, AipModelList, type AipTone } from './AIProvidersSettings';

interface FetchedModel {
    id: string;
    label: string;
}

interface ProviderCardProps {
    providerId: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';
    /** Provider switched off in Settings — keeps the key, hides the models. */
    isDisabled?: boolean;
    onToggleDisabled?: (enabled: boolean) => void;
    /** The provider's full model universe: presets ∪ catalog ∪ allow-listed ids. */
    selectableModels?: { id: string; label: string }[];
    /** Allow-list of model ids; empty means all of `selectableModels` are shown. */
    enabledModels?: string[];
    onToggleModel?: (modelId: string) => void;
    /** Clears the allow-list back to "all". */
    onResetModels?: () => void;
    /** A persist failed; the control reports it instead of lying about the state. */
    modelSaveError?: boolean;
    providerName: string;
    apiKey: string;
    preferredModel?: string;
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
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId,
    isDisabled = false,
    onToggleDisabled,
    selectableModels,
    enabledModels,
    onToggleModel,
    onResetModels,
    modelSaveError,
    providerName,
    apiKey,
    preferredModel,
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
    onPreferredModelChange,
}) => {
    const t = useT();
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>(preferredModel || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Refs to avoid stale closures in the auto-save timer
    const savedRef = useRef(savedStatus);
    const savingRef = useRef(savingStatus);
    savedRef.current = savedStatus;
    savingRef.current = savingStatus;

    // Auto-save API key after 5 seconds of inactivity
    useEffect(() => {
        if (!apiKey.trim()) return;
        const timer = setTimeout(() => {
            if (!savedRef.current && !savingRef.current) {
                onSaveKey().catch(console.error);
            }
        }, 5000);
        return () => clearTimeout(timer);
    }, [apiKey]);

    // Sync preferredModel prop
    useEffect(() => {
        if (preferredModel) setSelectedModel(preferredModel);
    }, [preferredModel]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleFetchModels = async () => {
        setIsFetching(true);
        setFetchError(null);

        try {
            // If a new key is entered, save it first
            if (apiKey.trim()) {
                await onSaveKey();
            }

            // Fetch models using the key (or stored key)
            const keyToUse = apiKey.trim() || '';
            // @ts-ignore
            const result = await window.electronAPI?.fetchProviderModels(providerId, keyToUse);

            if (result?.success && result.models) {
                setFetchedModels(result.models);
                // If we have a preferred model that exists in the list, keep it; otherwise auto-select first
                if (result.models.length > 0) {
                    const existsInList = result.models.some((m: FetchedModel) => m.id === selectedModel);
                    if (!existsInList) {
                        const firstModel = result.models[0].id;
                        setSelectedModel(firstModel);
                        // @ts-ignore
                        await window.electronAPI?.setProviderPreferredModel(providerId, firstModel);
                        if (onPreferredModelChange) {
                            onPreferredModelChange(firstModel);
                        }
                    }
                }
            } else {
                setFetchError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            setFetchError(e.message || 'Failed to fetch models');
        } finally {
            setIsFetching(false);
        }
    };

    const handleSelectModel = async (modelId: string) => {
        setSelectedModel(modelId);
        setIsDropdownOpen(false);
        try {
            // @ts-ignore
            await window.electronAPI?.setProviderPreferredModel(providerId, modelId);
            if (onPreferredModelChange) {
                onPreferredModelChange(modelId);
            }
        } catch (e) {
            console.error('Failed to save preferred model:', e);
        }
    };

    const selectedOption = fetchedModels.find(m => m.id === selectedModel);

    // ── Status. ONE vocabulary via AipBadge; nothing else here carries a status
    // colour. Key stored + on → ok "Connected"; key stored + off → neutral
    // "Off"; no key → no badge at all (there is nothing to report yet).
    const statusBadge: { tone: AipTone; label: string; busy?: boolean } | null = (() => {
        if (testStatus === 'testing') return { tone: 'info', label: t('Testing'), busy: true };
        if (testStatus === 'error') return { tone: 'danger', label: t('Failed') };
        if (savingStatus) return { tone: 'info', label: t('Saving'), busy: true };
        if (!hasStoredKey) return null;
        if (isDisabled) return { tone: 'neutral', label: t('Off') };
        return { tone: 'ok', label: t('Connected') };
    })();


    return (
        <div className={`aip-card p-5 ${isDisabled ? 'opacity-60' : ''}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 min-w-0 text-xs font-medium uppercase tracking-wide aip-hero">
                    {/* The provider's official mark (vendored, MIT — see
                        src/assets/provider-logos/README.md). Falls back to a
                        two-letter monogram for providers with no licence-clean
                        logo, so the tile is never an empty gap. */}
                    <AipProviderMark provider={providerId} name={providerName} />
                    <span className="truncate">{providerName} {t('API Key')}</span>
                    {statusBadge && (
                        <AipBadge tone={statusBadge.tone} label={statusBadge.label} busy={statusBadge.busy} title={testError} />
                    )}
                </label>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => {
                            // @ts-ignore
                            window.electronAPI?.openExternal(keyUrl);
                        }}
                        className="aip-btn"
                        data-size="sm"
                        data-variant="ghost"
                        title={`Get ${providerName} API Key`}
                    >
                        <span className="uppercase tracking-wide">{t('Get Key')}</span>
                        <ExternalLink size={12} strokeWidth={1.75} />
                    </button>
                    {/* Provider on/off. Only offered once a key is stored — there is
                        nothing to switch off before that. The key is never touched;
                        this only controls whether the provider's models are offered. */}
                    {hasStoredKey && onToggleDisabled && (
                        <AipSwitch
                            checked={!isDisabled}
                            onChange={() => onToggleDisabled(isDisabled)}
                            label={`${isDisabled ? t('Enable') : t('Disable')} ${providerName}`}
                            title={isDisabled ? t('Enable provider') : t('Disable provider (keeps your key)')}
                        />
                    )}
                </div>
            </div>
            <div className="flex gap-2 mb-3">
                {/* No reveal-eye toggle, deliberately: these windows are marketed for
                    on-screen stealth, so a plaintext key in a screen-shared overlay
                    is a real hazard. */}
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => onKeyChange(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore
                    placeholder={hasStoredKey ? "••••••••••••" : keyPlaceholder}
                    className="aip-input flex-1"
                />
                <button
                    onClick={onSaveKey}
                    disabled={savingStatus || !apiKey.trim()}
                    className="aip-btn min-w-[84px]"
                    data-tone={savedStatus ? 'ok' : undefined}
                >
                    {savingStatus
                        ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Saving...')}</>
                        : savedStatus
                            ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Saved')}</>
                            : t('Save')}
                </button>
                {hasStoredKey && (
                    <button
                        onClick={onRemoveKey}
                        className="aip-btn"
                        data-icon="true"
                        data-variant="danger-ghost"
                        title={t("Remove API Key")}
                    >
                        <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                )}
            </div>

            {/* Action Row: Test Connection + Conditional Dropdown + Fetch Models */}
            <div className="flex items-center gap-2 mb-3 w-full">
                {/* Fixed min-width + centred content, so a label change cannot
                    reflow the row. */}
                <button
                    onClick={onTestConnection}
                    disabled={(!apiKey.trim() && !hasStoredKey) || testStatus === 'testing'}
                    className="aip-btn shrink-0 min-w-[132px]"
                    data-size="sm"
                    data-tone={testStatus === 'success' ? 'ok' : testStatus === 'error' ? 'danger' : undefined}
                    title={testError || t("Test Connection")}
                >
                    {testStatus === 'testing' ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Testing...')}</> :
                        testStatus === 'success' ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Connected')}</> :
                            testStatus === 'error' ? <><AlertCircle size={12} strokeWidth={1.75} /> {t('Error')}</> :
                                <>{t('Test Connection')}</>}
                </button>

                {/* Inline Model Dropdown. Still a floating layer here — turning it
                    into the in-flow AipSelect expander is Stage 4's job, together
                    with the collapsible row. */}
                {fetchedModels.length > 0 || preferredModel ? (
                    <div className="relative flex-1 min-w-0" ref={dropdownRef}>
                        <button
                            onClick={() => fetchedModels.length > 0 && setIsDropdownOpen(!isDropdownOpen)}
                            className="aip-select-trigger"
                            aria-expanded={isDropdownOpen}
                            aria-haspopup="listbox"
                            aria-disabled={fetchedModels.length === 0 || undefined}
                            title={fetchedModels.length === 0 ? t('Fetch models to change this.') : undefined}
                            type="button"
                        >
                            <span className="truncate pr-2">{selectedOption ? selectedOption.label : (preferredModel || t('Select model'))}</span>
                            <ChevronDown size={14} strokeWidth={1.75} className="aip-select-chevron" aria-hidden="true" />
                        </button>

                        {isDropdownOpen && fetchedModels.length > 0 && (
                            <div
                                role="listbox"
                                aria-label={`${providerName} ${t('Select model')}`}
                                onKeyDown={(e) => { if (e.key === 'Escape') setIsDropdownOpen(false); }}
                                className="aip-float aip-scroll-y aip-panel-fade absolute top-full left-0 mt-1 w-full z-50 max-h-60 p-1 custom-scrollbar"
                            >
                                {fetchedModels.map((model) => (
                                    <button
                                        key={model.id}
                                        onClick={() => handleSelectModel(model.id)}
                                        role="option"
                                        aria-selected={selectedModel === model.id}
                                        className="aip-select-option"
                                        type="button"
                                    >
                                        <span className="truncate">{model.label}</span>
                                        {selectedModel === model.id && <Check size={13} strokeWidth={1.75} className="aip-accent-fg shrink-0 ml-2" aria-hidden="true" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 min-w-0" />
                )}

                {hasStoredKey && (
                    <button
                        onClick={handleFetchModels}
                        disabled={isFetching}
                        className="aip-btn shrink-0 min-w-[118px]"
                        data-size="sm"
                    >
                        {isFetching ? (
                            <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Fetching...')}</>
                        ) : (
                            <><RefreshCw size={12} strokeWidth={1.75} /> {t('Fetch Models')}</>
                        )}
                    </button>
                )}
            </div>

            {/* Which of this provider's models appear in the active-model picker.
                Inline rather than in a modal: it is a handful of checkboxes and
                the card already owns this provider's settings. All-on is the
                default and shows as every chip lit, so the control reads as
                "narrow this down" instead of "configure me before use". */}
            {hasStoredKey && !isDisabled && onToggleModel && selectableModels && selectableModels.length > 1 && (
                <AipModelList
                    models={selectableModels}
                    enabled={enabledModels || []}
                    onToggle={onToggleModel}
                    onReset={onResetModels || (() => {})}
                    defaultLabel={selectedOption?.label || (preferredModel ? preferredModel : undefined)}
                    error={modelSaveError ? 'save-failed' : null}
                />
            )}

            {/* Error from test or fetch */}
            {testError && <p className="aip-meta aip-danger-fg mt-1.5 mb-2">{testError}</p>}
            {fetchError && <p className="aip-meta aip-danger-fg mt-1.5 mb-2">{t('Model fetch error:')} {fetchError}</p>}


        </div>
    );
};
