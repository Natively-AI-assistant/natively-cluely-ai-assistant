import React, { useState, useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { Trash2, AlertCircle, ExternalLink, Loader2, Check, KeyRound } from 'lucide-react';
// Primitives live in AIProvidersSettings.tsx, not in their own module:
// SettingsPeriwinklePortalScopeGuard.test.mjs asserts that the *.tsx files on disk in
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
    /** Promote a model to this provider's default (also allow-lists it). */
    onSetDefaultModel?: (modelId: string) => void;
    /** True once a catalog has been fetched for this provider; gates auto-discovery. */
    hasCatalog?: boolean;
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
    onSetDefaultModel,
    hasCatalog,
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
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>(preferredModel || '');

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

    const handleFetchModels = async () => {
        setIsFetching(true);
        setFetchError(null);

        try {
            // Deliberately does NOT save a typed-but-unsaved key. Save is the only
            // thing that saves; discovery uses the stored key.
            // Fetch models using the key (or stored key)
            const keyToUse = apiKey.trim() || '';
            // @ts-ignore
            const result = await window.electronAPI?.fetchProviderModels(providerId, keyToUse);

            if (result?.success && result.models) {
                // If we have a preferred model that exists in the list, keep it; otherwise auto-select first
                // Only adopt a default when the provider has none at all. Previously
                // this fired whenever the current default was absent from the returned
                // list, so a Refresh could silently change which model answers your
                // questions. A default that is missing from the catalog is surfaced as
                // "Not offered" in the list instead.
                if (result.models.length > 0) {
                    const existsInList = result.models.some((m: FetchedModel) => m.id === selectedModel);
                    if (!existsInList && !selectedModel && !preferredModel) {
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


    // ── Status. ONE vocabulary via AipBadge; nothing else here carries a status
    // colour. Key stored + on → ok "Connected"; key stored + off → neutral
    // "Off"; no key → no badge at all (there is nothing to report yet).
    // The badge carries only what NO control on the card already says.
    //
    // Testing / Failed / Saving were all echoes: press Test and the button reads
    // "Testing..." with a spinner while the badge read "Testing" with a second
    // spinner — one operation, two spinners, two words, 200px apart. The control you
    // pressed owns its own feedback; that is where you are already looking.
    //
    // "Off" is the exception and the reason the badge still exists: nothing else
    // states it in words, it persists rather than resolving on its own, and it is the
    // explanation for why the models control vanished from the row below.
    const statusBadge: { tone: AipTone; label: string; busy?: boolean } | null =
        (hasStoredKey && isDisabled) ? { tone: 'neutral', label: t('Off') } : null;


    return (
        // .aip-provider owns padding + an 8px flex column. No mb-* anywhere: the old
        // layout's trailing mb-3 stacked against p-5's bottom padding and produced a
        // 32px dead band, which was the largest single block of nothing in the card.
        <div className="aip-card aip-provider" data-off={isDisabled ? 'true' : undefined}>
            <div className="aip-provider-head">
                {/* The provider's official mark (vendored, MIT — see
                    src/assets/provider-logos/README.md). Falls back to a two-letter
                    monogram for providers with no licence-clean logo. */}
                <AipProviderMark provider={providerId} name={providerName} />
                {/* The mark is the identity and this is the title, so it is the provider
                    NAME — not "GROQ API KEY". "API key" names a field; using it as the
                    card's heading, uppercased, made an entity read as a form label. The
                    input keeps its aria-label, so nothing is lost to a screen reader. */}
                <h4 className="aip-card-title truncate min-w-0">{providerName}</h4>
                {statusBadge && (
                    <AipBadge tone={statusBadge.tone} label={statusBadge.label} busy={statusBadge.busy} />
                )}

                {/* Get Key stays here permanently now that Test has moved back down to
                    the body row. Key rotation is real, so the signpost is still useful
                    once configured — just demoted visually. */}
                <div className="ml-auto flex items-center gap-2 shrink-0">
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
                    {/* Only once a key is stored — nothing to switch off before that. The
                        key is never touched; this only hides the provider's models. */}
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

            <div className="aip-provider-row">
                <div className="aip-provider-field">
                    {/* One 32px shell: glyph + input + Save as an inset segment. */}
                    <div className="aip-field">
                        <KeyRound size={13} strokeWidth={1.75} className="aip-field-icon" aria-hidden="true" />
                        {/* No reveal-eye toggle, deliberately: these windows are marketed
                            for on-screen stealth, so a plaintext key in a screen-shared
                            overlay is a real hazard. */}
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => onKeyChange(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            data-1p-ignore
                            aria-label={`${providerName} ${t('API key')}`}
                            placeholder={hasStoredKey ? "••••••••••••" : keyPlaceholder}
                            className="aip-input"
                        />
                        {/* Rendered-and-disabled, never conditionally rendered: a button
                            that appears on the first keystroke shrinks the input ~88px
                            mid-typing and moves a target between aim and click. */}
                        <button
                            onClick={onSaveKey}
                            disabled={savingStatus || !apiKey.trim()}
                            className="aip-field-seg"
                            data-tone={savedStatus ? 'ok' : undefined}
                        >
                            {savingStatus
                                ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Saving...')}</>
                                : savedStatus
                                    ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Saved')}</>
                                    : t('Save')}
                        </button>
                    </div>
                    {hasStoredKey && (
                        <button
                            onClick={onRemoveKey}
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

            {/* Second row: Test leads, MODELS beside it — the arrangement these two had
                before the redesign. Costs 40px against putting Test after the trash on
                one row, and buys back the left-edge alignment that made Test read as the
                start of an action row rather than the tail of the credential row. */}
            <div className="aip-provider-row">
                {hasStoredKey && (
                    <button
                        onClick={onTestConnection}
                        disabled={testStatus === 'testing'}
                        className="aip-btn shrink-0"
                        data-tone={testStatus === 'success' ? 'ok' : testStatus === 'error' ? 'danger' : undefined}
                        title={testError || t('Test Connection')}
                    >
                        {testStatus === 'testing' ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Testing...')}</> :
                            testStatus === 'success' ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Passed')}</> :
                                testStatus === 'error' ? <><AlertCircle size={12} strokeWidth={1.75} /> {t('Error')}</> :
                                    <>{t('Test Connection')}</>}
                    </button>
                )}

                {/* Beside the key field, not under it. >= 1, not > 1: this is the only
                    discovery entry point, so gating it on "more than one model" left the
                    three 1-preset providers unable to fetch anything at all. */}
                {hasStoredKey && !isDisabled && onToggleModel && selectableModels && selectableModels.length >= 1 && (
                    <AipModelList
                        models={selectableModels}
                        enabled={enabledModels || []}
                        onToggle={onToggleModel}
                        onReset={onResetModels || (() => {})}
                        defaultId={selectedModel || preferredModel}
                        onSetDefault={onSetDefaultModel}
                        error={modelSaveError ? 'save-failed' : null}
                        refreshing={isFetching}
                        onRefresh={handleFetchModels}
                        onFirstOpen={() => {
                            if (hasStoredKey && !hasCatalog) handleFetchModels();
                        }}
                    />
                )}
            </div>

            {/* One note line, and only when something is actually wrong. */}
            {(testError || fetchError) && (
                <p className="aip-meta aip-danger-fg aip-provider-note">
                    {testError || `${t('Model fetch error:')} ${fetchError}`}
                </p>
            )}
        </div>
    );
};
