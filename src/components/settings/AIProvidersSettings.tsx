import React, { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2, LogOut, Info, Globe, SlidersHorizontal, Filter } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { ProviderCard } from './ProviderCard';
import { Dialog, DialogContent } from '../ui/dialog';

import { LobeProviderIcon } from './LobeProviderIcon';

const CODEX_SERVICE_TIERS = ['default', 'fast', 'flex'] as const;
// Must mirror CodexCliService.CODEX_MODEL_REASONING_EFFORTS in
// electron/services/CodexCliService.ts. Kept in sync manually because the
// Settings UI runs in the renderer (no direct module access to main).
const CODEX_MODEL_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

// Per-model valid reasoning-effort sets (mirrors CodexCliService's
// CODEX_MODEL_REASONING_SETS). Longest-match wins so gpt-5.4-codex beats
// gpt-5. The dropdown hides unsupported values per the currently-selected
// model so a user can't pick e.g. xhigh for gpt-5.3-codex (which the codex
// CLI binary rejects with a 400).
const CODEX_MODEL_REASONING_SETS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['gpt-5-2025-08-07', ['low', 'medium', 'high']],
    ['gpt-5-mini',       ['low', 'medium', 'high']],
    ['gpt-5-nano',       ['low', 'medium', 'high']],
    ['gpt-5',            ['low', 'medium', 'high']],
    ['gpt-5.1',          ['none', 'low', 'medium', 'high']],
    ['gpt-5.2',          ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.4',          ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.5',          ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.5-codex',    ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.4-codex',    ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.3-codex-spark', ['low', 'medium', 'high']],
    ['gpt-5.3-codex',    ['low', 'medium', 'high']],
    ['gpt-5.2-codex',    ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.1-codex',    ['low', 'medium', 'high']],
    ['gpt-5-codex',      ['low', 'medium', 'high']],
];

function getValidCodexReasoningEfforts(modelId: string): readonly string[] {
    const id = (modelId || '').toLowerCase();
    let best: readonly [string, readonly string[]] | null = null;
    for (const entry of CODEX_MODEL_REASONING_SETS) {
        if (id.includes(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
    }
    return best ? best[1] : ['low', 'medium', 'high'];
}

// LiteLLM max-output-token presets — the standard per-model output budgets
// (powers of two used across the LiteLLM model registry). '' = Auto: resolve
// each model's real budget from the proxy's /model/info, fallback 8192.
const LITELLM_MAX_TOKENS_OPTIONS: ModelOption[] = [
    { id: '', name: 'Auto (per-model)' },
    { id: '4096', name: '4,096 (4K)' },
    { id: '8192', name: '8,192 (8K)' },
    { id: '16384', name: '16,384 (16K)' },
    { id: '32768', name: '32,768 (32K)' },
    { id: '65536', name: '65,536 (64K)' },
    { id: '131072', name: '131,072 (128K)' },
    { id: '262144', name: '262,144 (256K)' },
    { id: '524288', name: '524,288 (512K)' },
    { id: '1048576', name: '1,048,576 (1M)' },
];

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string;
    /** Whether this provider accepts screenshots. undefined = auto-detect from the cURL template. */
    multimodal?: boolean;
}

interface ModelOption {
    id: string;
    name: string;
    icon?: React.ReactNode;
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder, className = "" }) => {
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
    const resolvedPlaceholder = placeholder ?? t('Select model');

    const paddingClass = className.includes('py-') ? '' : 'py-2';

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-64 sm:w-72 md:w-80 bg-bg-input border border-border-subtle rounded-lg px-3 ${paddingClass} ${className} text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-all shadow-sm cursor-pointer`}
                type="button"
            >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                    {selectedOption?.icon && <div className="shrink-0 flex items-center justify-center">{selectedOption.icon}</div>}
                    <span className="truncate font-medium">{selectedOption ? selectedOption.name : resolvedPlaceholder}</span>
                </div>
                <ChevronDown size={14} className={`text-text-secondary transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-full min-w-[260px] bg-bg-elevated border border-border-subtle rounded-lg shadow-2xl z-50 max-h-64 overflow-y-auto animated fadeIn ring-1 ring-border-subtle/50">
                    <div className="p-1 space-y-0.5">
                        {options.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors cursor-pointer ${value === option.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary font-semibold' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                type="button"
                            >
                                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                    {option.icon && <div className="shrink-0 flex items-center justify-center">{option.icon}</div>}
                                    <span className="truncate">{option.name}</span>
                                </div>
                                {value === option.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-text-tertiary italic">{t('No models available')}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const CodexCliModelField: React.FC<{
    label: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onSelect: (value: string) => void;
    onSave: () => void;
}> = ({ label, value, placeholder, onChange, onSelect, onSave }) => {
    const t = useT();
    return (
    <label className="space-y-1">
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{label}</span>
        <div className="flex gap-2">
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onSave}
                className="min-w-0 flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                placeholder={placeholder}
            />
            <ModelSelect
                value={value}
                options={value && !CODEX_CLI_MODEL_PRESETS.some(option => option.id === value)
                    ? [{ id: value, name: prettifyModelId(value) }, ...CODEX_CLI_MODEL_PRESETS]
                    : CODEX_CLI_MODEL_PRESETS}
                onChange={(modelId) => {
                    onChange(modelId);
                    onSelect(modelId);
                }}
                placeholder={t("Preset")}
                className="py-2"
            />
        </div>
    </label>
    );
};

interface AIProvidersSettingsProps {
    aiResponseLanguage: string;
    availableAiLanguages: any[];
    isAiLangDropdownOpen: boolean;
    onToggleAiLangDropdown: () => void;
    onSelectAiLanguage: (code: string) => void;
    aiLangDropdownRef: React.RefObject<HTMLDivElement | null>;
}

export const AIProvidersSettings: React.FC<AIProvidersSettingsProps> = ({
    aiResponseLanguage,
    availableAiLanguages,
    isAiLangDropdownOpen,
    onToggleAiLangDropdown,
    onSelectAiLanguage,
    aiLangDropdownRef,
}) => {
    const t = useT();
    // --- Navigation Tabs ---
    const [activeTab, setActiveTab] = useState<'cloud' | 'gateways' | 'vision'>('cloud');

    // --- Standard Providers ---
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [deepseekApiKey, setDeepseekApiKey] = useState('');
    const [openrouterApiKey, setOpenrouterApiKey] = useState('');
    const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
    const [litellmEnabledModels, setLitellmEnabledModels] = useState<string[]>([]);
    const [isManageModelsOpen, setIsManageModelsOpen] = useState(false);
    const [isRefreshingLiteLLM, setIsRefreshingLiteLLM] = useState(false);
    const [litellmSearchQuery, setLitellmSearchQuery] = useState('');
    const [litellmModelTestStatus, setLitellmModelTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [litellmModelTestError, setLitellmModelTestError] = useState<Record<string, string>>({});

    // --- LiteLLM proxy (OpenAI-compatible gateway: baseURL + optional virtual key) ---
    const [litellmBaseURL, setLitellmBaseURL] = useState('');
    const [litellmApiKey, setLitellmApiKey] = useState('');
    // Max output tokens for proxied models. '' = Auto: per-model budget from the
    // proxy's /model/info (standard registry value), falling back to 8192.
    const [litellmMaxTokens, setLitellmMaxTokens] = useState('');
    const [litellmModels, setLitellmModels] = useState<string[]>([]);

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});

    // --- Custom Providers ---
    const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
    const [isEditingCustom, setIsEditingCustom] = useState(false);
    const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
    const [customName, setCustomName] = useState('');
    const [customCurl, setCustomCurl] = useState('');
    const [customResponsePath, setCustomResponsePath] = useState('');
    // 'auto' = detect vision support from the template; 'on'/'off' = explicit override.
    const [customVision, setCustomVision] = useState<'auto' | 'on' | 'off'>('auto');
    const [curlError, setCurlError] = useState<string | null>(null);

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);

    // --- Local (Codex CLI) ---
    const [codexCliConfig, setCodexCliConfig] = useState({ enabled: false, path: 'codex', model: 'gpt-5.4', fastModel: 'gpt-5.3-codex-spark', timeoutMs: 60000, sandboxMode: 'read-only' as string, serviceTier: 'default', modelReasoningEffort: undefined as string | undefined });
    const [codexCliStatus, setCodexCliStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [codexCliError, setCodexCliError] = useState('');
    const [codexAuthAction, setCodexAuthAction] = useState<'idle' | 'status' | 'logout' | 'login' | 'doctor'>('idle');
    const [codexAuthStatus, setCodexAuthStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [codexAuthMessage, setCodexAuthMessage] = useState('');

    // --- ChatGPT OAuth (new — replaces `codex login` CLI subprocess) ---
    // The OAuth flow runs entirely in the main process; the renderer just
    // kicks it off and listens for IPC events. We keep the auth state
    // visible so the user can see who's signed in and re-auth / sign out
    // without leaving Settings.
    const [codexOauthStatus, setCodexOauthStatus] = useState<{ signedIn: boolean; email?: string; expiresAt?: number }>({ signedIn: false });
    const [codexOauthInProgress, setCodexOauthInProgress] = useState(false);
    const [litellmShowSelectedOnly, setLitellmShowSelectedOnly] = useState(false);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.6-flash');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    const canUseFastMode = !!(hasStoredKey.groq || hasStoredKey.natively || (codexCliConfig.enabled && codexOauthStatus.signedIn));

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});
    const [cloudEnabledModels, setCloudEnabledModels] = useState<Record<string, string[]>>({});

    // --- Screen Understanding (vision routing) ---
    const [screenUnderstandingMode, setScreenUnderstandingMode] = useState<'vision_first' | 'vision_only' | 'private_vision'>('vision_first');
    const [technicalInterviewVisionFirst, setTechnicalInterviewVisionFirst] = useState<boolean>(true);

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }>({});
    const [showDataScopesInfo, setShowDataScopesInfo] = useState(false);

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                setCredentialsLoaded(false);
                // Load credentials FIRST so canUseFastMode is correct before we set fastResponseMode.
                // If we set fastResponseMode before hasStoredKey is populated, the enforcement
                // effect below fires with canUseFastMode=false and immediately resets fast mode
                // to false — writing that reset back to SettingsManager on every startup.
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                console.log('[AIProvidersSettings] getStoredCredentials returned:', creds);
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        deepseek: creds.hasDeepseekKey || false,
                        openrouter: creds.hasOpenrouterKey || false,
                        litellm: creds.hasLitellmBaseURL || false,
                        natively: creds.hasNativelyKey || false
                    });
                    // Prefill stored LiteLLM config so re-saving doesn't silently reset it.
                    // (baseURL is config, not a secret; the key stays masked/blank = keep.)
                    // Also clear the fields when another window removes the proxy.
                    setLitellmBaseURL(creds.litellmBaseURL || '');
                    setLitellmMaxTokens(creds.litellmMaxTokens ? String(creds.litellmMaxTokens) : '');
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    if (creds.deepseekPreferredModel) pm.deepseek = creds.deepseekPreferredModel;
                    if (creds.openrouterPreferredModel) pm.openrouter = creds.openrouterPreferredModel;
                    setPreferredModels(pm);
                    setDisabledProviders(creds.disabledProviders || []);
                    setLitellmEnabledModels(creds.litellmEnabledModels || []);
                    setCloudEnabledModels(creds.cloudEnabledModels || {});
                }

                // Now it's safe to read fast mode — hasStoredKey is already set so
                // canUseFastMode will be correct when the enforcement effect runs.
                // @ts-ignore
                const cliConfig = await window.electronAPI?.getCodexCliConfig?.();
                if (cliConfig) setCodexCliConfig(cliConfig as typeof codexCliConfig);

                // Codex OAuth status — read once on mount so the Settings UI
                // shows the right state without waiting for a user click.
                // @ts-ignore
                const oauthStatus = await window.electronAPI?.codexLoginStatus?.();
                if (oauthStatus?.success) {
                    setCodexOauthStatus({
                        signedIn: !!oauthStatus.signedIn,
                        email: oauthStatus.email,
                        expiresAt: oauthStatus.expiresAt,
                    });
                }

                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                if (fastMode) setFastResponseMode(fastMode.enabled);

                // @ts-ignore
                const custom = await window.electronAPI?.getCustomProviders();
                if (custom) {
                    setCustomProviders(custom);
                }

                // Load persisted default model
                // @ts-ignore
                const result = await window.electronAPI?.getDefaultModel();
                if (result && result.model) {
                    setDefaultModel(result.model);
                }

                // Check Ollama
                checkOllama();

                // Mark credentials as fully loaded only after custom/default model
                // state is refreshed, so the stale-default guard doesn't reset a
                // still-loading custom/LiteLLM/Codex selection.
                setCredentialsLoaded(true);

            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true); // Unblock even on error
            }
        };
        loadCredentials();

        // Listen for changes from other windows (2-way sync)
        const unsubs: Array<() => void> = [];
        if (window.electronAPI?.onGroqFastTextChanged) {
            // @ts-ignore
            unsubs.push(window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            }));
        }
        if (window.electronAPI?.onCredentialsChanged) {
            // @ts-ignore
            unsubs.push(window.electronAPI.onCredentialsChanged(() => {
                loadCredentials();
            }));
        }
        return () => { unsubs.forEach(unsub => unsub?.()); };
    }, []);

    const isCodexReady = codexCliConfig.enabled && codexOauthStatus.signedIn;

    const buildAvailableModelOptions = (): ModelOption[] => {
        const opts: ModelOption[] = [];

        if (hasStoredKey.natively && !disabledProviders.includes('natively')) {
            opts.push({ id: 'natively', name: 'Natively API', icon: <span className="text-[10px] font-bold text-accent-primary">⚡</span> });
        }

        const getProviderIcon = (prov: string) => {
            switch (prov) {
                case 'gemini': return <LobeProviderIcon provider="gemini" name="Gemini" size={16} className="shrink-0" />;
                case 'groq': return <LobeProviderIcon provider="groq" name="Groq" size={16} className="shrink-0" />;
                case 'openai': return <LobeProviderIcon provider="openai" name="OpenAI" size={16} className="shrink-0" />;
                case 'claude': return <LobeProviderIcon provider="claude" name="Claude" size={16} className="shrink-0" />;
                case 'deepseek': return <LobeProviderIcon provider="deepseek" name="DeepSeek" size={16} className="shrink-0" />;
                case 'openrouter': return <LobeProviderIcon provider="openrouter" name="OpenRouter" size={16} className="shrink-0" />;
                default: return undefined;
            }
        };

        for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
            if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
            if (disabledProviders.includes(prov)) continue;
            const icon = getProviderIcon(prov);
            const enabledList = cloudEnabledModels[prov] || [];
            if (enabledList.includes('_none_')) continue;

            const providerPool: { id: string; label: string }[] = cfg.ids.map((id, i) => ({ id, label: cfg.names[i] || id }));
            const cacheKey = `cached-models-${prov}`;
            const cachedStr = localStorage.getItem(cacheKey);
            if (cachedStr) {
                try {
                    const parsed = JSON.parse(cachedStr);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        parsed.forEach((m: any) => {
                            if (m?.id && !providerPool.some(p => p.id === m.id)) {
                                providerPool.push({ id: m.id, label: m.label || m.id });
                            }
                        });
                    }
                } catch { /* noop */ }
            }

            if (enabledList.length > 0) {
                providerPool.forEach(m => {
                    if (enabledList.includes(m.id)) {
                        opts.push({ id: m.id, name: m.label, icon });
                    }
                });
                enabledList.forEach(id => {
                    if (id !== '_none_' && !opts.some(o => o.id === id)) {
                        opts.push({ id, name: prettifyModelId(id), icon });
                    }
                });
            } else {
                providerPool.forEach(m => {
                    opts.push({ id: m.id, name: m.label, icon });
                });
            }
        }
        if (isCodexReady && !disabledProviders.includes('codex')) {
            const icon = <LobeProviderIcon provider="codex" name="Codex" size={16} className="shrink-0" />;
            opts.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${prettifyModelId(codexCliConfig.model)})`, icon });
            CODEX_CLI_MODEL_PRESETS.forEach(model => {
                const id = codexCliSelectorId(model.id);
                if (!opts.find(o => o.id === id)) {
                    opts.push({ id, name: `${CODEX_CLI_MODEL.name}: ${model.name}`, icon });
                }
            });
        }
        if (hasStoredKey.litellm && !disabledProviders.includes('litellm')) {
            const icon = <LobeProviderIcon provider="litellm" name="LiteLLM" size={16} className="shrink-0" />;

            litellmModels.forEach(model => {
                const isModelEnabled = litellmEnabledModels.length === 0 || (litellmEnabledModels.includes(model) && !litellmEnabledModels.includes('_none_'));
                if (isModelEnabled) {
                    opts.push({ id: `litellm/${model}`, name: `${prettifyModelId(model)} (LiteLLM)`, icon });
                }
            });
        }
        if (!disabledProviders.includes('custom')) {
            customProviders.forEach(p => opts.push({
                id: p.id,
                name: p.name,
                icon: <div className="w-4 h-4 rounded bg-amber-500/20 text-amber-400 font-mono text-[9px] flex items-center justify-center font-bold">C</div>
            }));
        }
        if (!disabledProviders.includes('ollama')) {
            const icon = <LobeProviderIcon provider="ollama" name="Ollama" size={16} className="shrink-0" />;
            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)`, icon }));
        }
        return opts;
    };

    // Keep the persisted default model from pointing at a provider the user just
    // removed/signed out of. This turns credential changes into immediate routing
    // changes instead of waiting for a failing request to discover stale state.
    useEffect(() => {
        if (!credentialsLoaded) return;
        const opts = buildAvailableModelOptions();
        if (!defaultModel || opts.some(o => o.id === defaultModel) || opts.length === 0) return;
        const next = opts[0].id;
        setDefaultModel(next);
        window.electronAPI?.setDefaultModel?.(next).catch(console.error);
    }, [credentialsLoaded, defaultModel, hasStoredKey, preferredModels, isCodexReady, codexCliConfig.model, customProviders, ollamaModels, litellmModels, disabledProviders, litellmEnabledModels]);

    // Load LiteLLM model IDs only when the proxy is configured. The active-model
    // selector should not expose stale `litellm/...` choices after the proxy is
    // removed, but it should keep real proxy models selectable while configured.
    useEffect(() => {
        let cancelled = false;
        if (!hasStoredKey.litellm) {
            setLitellmModels([]);
            return;
        }
        window.electronAPI?.getAllDiscoveredLiteLLMModels?.()
            .then((models) => {
                if (!cancelled) setLitellmModels(Array.isArray(models) ? models.filter(Boolean) : []);
            })
            .catch(() => {
                if (!cancelled) setLitellmModels([]);
            });
        return () => { cancelled = true; };
    }, [hasStoredKey.litellm, litellmBaseURL]);

    // Effect to enforce fast mode disabled if neither Groq key nor Natively API is configured.
    // Guard with credentialsLoaded so this never fires during the initial async load phase
    // (when hasStoredKey is still empty and canUseFastMode is incorrectly false).
    useEffect(() => {
        if (!credentialsLoaded) return;
        if (!canUseFastMode && fastResponseMode) {
            setFastResponseMode(false);
            localStorage.setItem('natively_groq_fast_text', 'false');
            // @ts-ignore
            window.electronAPI?.setGroqFastTextMode(false);
        }
    }, [credentialsLoaded, canUseFastMode, fastResponseMode]);

    // Poll for Ollama status every 3 seconds requesting smart start on mount
    useEffect(() => {
        // Immediate "Smart Start" check
        ensureOllamaStartup();

        // Background polling for maintenance
        const interval = setInterval(() => {
            checkOllama(false);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    // Wire up Codex OAuth IPC events. The main process emits these as
    // login progresses (or fails, or refreshes in the background) and
    // we mirror the state into the React tree. Each subscription
    // returns an unsubscribe function; clean up on unmount.
    useEffect(() => {
        const api = window.electronAPI as any;
        const unsubs: Array<() => void> = [];
        try {
            if (api?.onCodexLoginComplete) {
                unsubs.push(api.onCodexLoginComplete((info: any) => {
                    setCodexOauthInProgress(false);
                    setCodexOauthStatus(prev => ({ ...prev, signedIn: true, email: info?.email || prev.email }));
                    setCodexAuthStatus('success');
                    setCodexAuthMessage(`${t('Signed in to ChatGPT')}${info?.email ? ` ${t('as')} ${info.email}` : ''}.`);
                    // Auto-enable codex now that we're signed in.
                    setCodexCliConfig(prev => {
                        const next = { ...prev, enabled: true };
                        window.electronAPI?.setCodexCliConfig?.(next);
                        return next;
                    });
                }));
            }
            if (api?.onCodexLoginFailed) {
                unsubs.push(api.onCodexLoginFailed((info: any) => {
                    setCodexOauthInProgress(false);
                    setCodexAuthStatus('error');
                    setCodexAuthMessage(info?.message || t('Codex sign-in failed.'));
                }));
            }
            if (api?.onCodexSignedOut) {
                unsubs.push(api.onCodexSignedOut(() => {
                    setCodexOauthStatus({ signedIn: false });
                    setCodexAuthStatus('idle');
                    setCodexAuthMessage(t('Signed out of ChatGPT.'));
                }));
            }
            if (api?.onCodexTokensRefreshed) {
                unsubs.push(api.onCodexTokensRefreshed((info: any) => {
                    setCodexOauthStatus(prev => ({ ...prev, expiresAt: info?.expiresAt || prev.expiresAt }));
                }));
            }
        } catch { /* subscriptions are best-effort */ }
        return () => { for (const u of unsubs) try { u(); } catch { /* noop */ } };
    }, []);

    // Load Screen Understanding (vision routing) settings
    useEffect(() => {
        window.electronAPI?.getScreenUnderstandingMode?.().then(setScreenUnderstandingMode as any).catch(() => { });
        (window.electronAPI as any)?.getTechnicalInterviewVisionFirst?.()
            .then(setTechnicalInterviewVisionFirst)
            .catch(() => {
                // Fallback to deprecated alias if the renderer is talking to an older main process.
                window.electronAPI?.getTechnicalInterviewDirectVision?.().then(setTechnicalInterviewVisionFirst).catch(() => { });
            });
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        if (!api?.onScreenUnderstandingModeChanged) return;
        const unsubscribe = api.onScreenUnderstandingModeChanged(setScreenUnderstandingMode);
        return () => unsubscribe?.();
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        const handler = (enabled: boolean) => setTechnicalInterviewVisionFirst(enabled);
        const unsub1 = api?.onTechnicalInterviewVisionFirstChanged?.(handler);
        const unsub2 = api?.onTechnicalInterviewDirectVisionChanged?.(handler);
        return () => {
            unsub1?.();
            unsub2?.();
        };
    }, []);

    // Load Cloud Provider Data Scopes and subscribe to cross-window changes
    useEffect(() => {
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { });
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onProviderDataScopesChanged) {
            const unsubscribe = window.electronAPI.onProviderDataScopesChanged(setProviderDataScopes);
            return () => unsubscribe();
        }
    }, []);

    const ensureOllamaStartup = async () => {
        setOllamaStatus('checking');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('ensure-ollama-running');
            if (result && result.success) {
                // It's running (or just started), now fetch models
                checkOllama(true);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.warn("Ollama ensure startup failed:", e);
            setOllamaStatus('not-found');
        }
    };

    const checkOllama = async (_isInitial = true) => {
        // Don't override 'checking' if we are already in smart-start mode
        // if (isInitial) setOllamaStatus('checking'); 

        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else {
                // Silent failure on background checks
                // Only set not-found if we haven't detected it yet
                if (ollamaStatus !== 'detected') {
                    setOllamaStatus('not-found');
                }
            }
        } catch (e) {
            // console.warn(`Ollama check failed:`, e);
            if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('force-restart-ollama');
            if (result && result.success) {
                setOllamaRestarted(true);
                // Wait for server to be ready
                setTimeout(() => checkOllama(false), 2000);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.error("Fix failed", e);
            setOllamaStatus('not-found');
        }
    };

    const saveCodexCliConfig = async (next = codexCliConfig) => {
        // Auto-enable when signed in; no manual toggle needed.
        const enabled = codexOauthStatus.signedIn || next.enabled;
        const normalized = { ...next, enabled, timeoutMs: Number(next.timeoutMs) || 60000 };
        setCodexCliConfig(normalized);
        const result = await window.electronAPI?.setCodexCliConfig?.(normalized);
        if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
        return result;
    };

    const handleTestCodexCli = async () => {
        setCodexCliStatus('testing');
        setCodexCliError('');
        try {
            const saveResult = await saveCodexCliConfig();
            const configToTest = saveResult?.config || codexCliConfig;
            const result = await window.electronAPI?.testCodexCli?.(configToTest);
            if (result?.success) {
                // If the main process auto-detected an install, reflect the
                // resolved path in the form so the user sees what got picked.
                if (result.config) setCodexCliConfig(result.config as typeof codexCliConfig);
                setCodexCliStatus('success');
                setTimeout(() => setCodexCliStatus('idle'), 3000);
            } else {
                setCodexCliStatus('error');
                setCodexCliError(result?.error || t('Codex CLI test failed'));
            }
        } catch (e: any) {
            setCodexCliStatus('error');
            setCodexCliError(e.message || t('Codex CLI test failed'));
        }
    };

    const handleCodexAuthAction = async (action: 'status' | 'logout' | 'login' | 'doctor') => {
        setCodexAuthAction(action);
        setCodexAuthStatus('idle');
        setCodexAuthMessage('');
        try {
            const saveResult = await saveCodexCliConfig();
            const configToUse = saveResult?.config || codexCliConfig;
            const api = window.electronAPI as any;
            // The new OAuth flow uses dedicated IPCs: codexStartLogin opens
            // the system browser and resolves when the callback fires.
            // For 'login' we kick that off and let the IPC events drive
            // the UI; the other actions still go through the legacy
            // wrappers (which are now OAuth-aware).
            if (action === 'login' && api?.codexStartLogin) {
                setCodexOauthInProgress(true);
                setCodexAuthMessage(t('Opening browser — complete sign-in there, then return here.'));
                const result = await api.codexStartLogin();
                // The actual UI update happens via the onCodexLoginComplete
                // / onCodexLoginFailed events; this is the success/fail
                // path in case the events miss (e.g. the renderer reloaded
                // mid-flow).
                setCodexOauthInProgress(false);
                if (result?.success) {
                    setCodexAuthStatus('success');
                    setCodexAuthMessage(`${t('Signed in to ChatGPT')}${result.email ? ` ${t('as')} ${result.email}` : ''}.`);
                    setCodexOauthStatus({ signedIn: true, email: result.email, expiresAt: result.expiresAt });
                } else {
                    setCodexAuthStatus('error');
                    setCodexAuthMessage(result?.error || t('Codex sign-in failed.'));
                }
                return;
            }
            const fn = action === 'status'
                ? api?.codexCliAuthStatus
                : action === 'logout'
                    ? api?.codexCliLogout
                    : action === 'login'
                        ? api?.codexCliLogin
                        : api?.codexCliDoctor;
            const result = await fn?.(configToUse);
            if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
            if (result?.success) {
                setCodexAuthStatus('success');
                setCodexAuthMessage(result.output || `Codex ${action} succeeded.`);
                // Sync OAuth status after status/logout IPCs.
                if (action === 'status' || action === 'logout') {
                    const status = await api?.codexLoginStatus?.();
                    if (status?.success) {
                        setCodexOauthStatus({ signedIn: !!status.signedIn, email: status.email, expiresAt: status.expiresAt });
                    }
                }
            } else {
                setCodexAuthStatus('error');
                const msg = result?.error || result?.output || `Codex ${action} failed.`;
                setCodexAuthMessage(msg);
            }
        } catch (e: any) {
            setCodexAuthStatus('error');
            setCodexAuthMessage(e.message || `Codex ${action} failed.`);
        } finally {
            setCodexAuthAction('idle');
        }
    };

    // Convenience: one-click "Sign in with ChatGPT" — same as clicking
    // the "Login / Reconnect" button, but with a primary-style highlight
    // and the email field prominent when already signed in.
    const handleCodexSignOut = async () => {
        const api = window.electronAPI as any;
        try {
            await api?.codexSignOut?.();
            setCodexOauthStatus({ signedIn: false });
        } catch { /* noop */ }
    };

    const handleCodexRefresh = async () => {
        const api = window.electronAPI as any;
        setCodexAuthMessage(t('Refreshing tokens…'));
        try {
            const result = await api?.codexRefreshTokens?.();
            if (result?.success) {
                setCodexAuthStatus('success');
                setCodexAuthMessage(t('Tokens refreshed.'));
                setCodexOauthStatus(prev => ({ ...prev, expiresAt: result.expiresAt, email: result.email || prev.email }));
            } else {
                setCodexAuthStatus('error');
                setCodexAuthMessage(result?.error || t('Refresh failed.'));
            }
        } catch (e: any) {
            setCodexAuthStatus('error');
            setCodexAuthMessage(e?.message || t('Refresh failed.'));
        }
    };

    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void) => {
        if (!key.trim()) return;
        setSavingStatus(prev => ({ ...prev, [provider]: true }));
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey(key);
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey(key);
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey(key);
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey(key);
            // @ts-ignore
            if (provider === 'deepseek') result = await window.electronAPI.setDeepseekApiKey(key);
            // @ts-ignore
            if (provider === 'openrouter') result = await window.electronAPI.setOpenrouterApiKey(key);

            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
            }
        } catch (e) {
            console.error(`Failed to save ${provider} key:`, e);
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
        }
    };

    // LiteLLM needs three fields (baseURL + optional key + optional max-tokens),
    // so it can't use the single-key ProviderCard contract. baseURL is required
    // to enable the proxy; maxTokens empty → backend default (8192).
    const handleSaveLitellm = async () => {
        const url = litellmBaseURL.trim();
        if (!url) return;
        setSavingStatus(prev => ({ ...prev, litellm: true }));
        try {
            const parsedMax = parseInt(litellmMaxTokens, 10);
            const result = await window.electronAPI.setLitellmConfig({
                apiKey: litellmApiKey.trim(),
                baseURL: url,
                maxTokens: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined,
            });
            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, litellm: true }));
                setHasStoredKey(prev => ({ ...prev, litellm: true }));
                setLitellmApiKey('');
                window.electronAPI?.refreshLiteLLMModels?.()
                    .then((models) => setLitellmModels(Array.isArray(models) ? models.filter(Boolean) : []))
                    .catch(() => setLitellmModels([]));
                setTimeout(() => setSavedStatus(prev => ({ ...prev, litellm: false })), 2000);
            }
        } catch (e) {
            console.error('Failed to save LiteLLM config:', e);
        } finally {
            setSavingStatus(prev => ({ ...prev, litellm: false }));
        }
    };

    const handleRemoveLitellm = async () => {
        try {
            const result = await window.electronAPI.setLitellmConfig({ apiKey: '', baseURL: '' });
            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, litellm: false }));
                setLitellmBaseURL('');
                setLitellmApiKey('');
                setLitellmMaxTokens('');
                setLitellmModels([]);
            }
        } catch (e) {
            console.error('Failed to remove LiteLLM config:', e);
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey('');
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey('');
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey('');
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey('');
            // @ts-ignore
            if (provider === 'deepseek') result = await window.electronAPI.setDeepseekApiKey('');
            // @ts-ignore
            if (provider === 'openrouter') result = await window.electronAPI.setOpenrouterApiKey('');

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} key:`, e);
        }
    };

    const handleToggleProviderDisabled = async (providerId: string, disabled: boolean) => {
        let nextDisabled;
        if (disabled) {
            nextDisabled = [...disabledProviders, providerId];
        } else {
            nextDisabled = disabledProviders.filter(p => p !== providerId);
        }
        setDisabledProviders(nextDisabled);
        await window.electronAPI?.setDisabledProviders?.(nextDisabled);
    };

    const handleRefreshLiteLLM = async () => {
        setIsRefreshingLiteLLM(true);
        try {
            const models = await window.electronAPI?.refreshLiteLLMModels?.() || [];
            setLitellmModels(models.filter(Boolean));
        } catch (e) {
            console.error('Failed to refresh LiteLLM models:', e);
        } finally {
            setIsRefreshingLiteLLM(false);
        }
    };

    const handleToggleLiteLLMModel = async (modelId: string, enabled: boolean) => {
        let nextEnabled;
        if (enabled) {
            if (litellmEnabledModels.includes('_none_')) {
                nextEnabled = [modelId];
            } else {
                nextEnabled = [...litellmEnabledModels];
                if (!nextEnabled.includes(modelId)) {
                    nextEnabled.push(modelId);
                }
            }
        } else {
            if (litellmEnabledModels.length === 0) {
                nextEnabled = litellmModels.filter(m => m !== modelId);
            } else {
                nextEnabled = litellmEnabledModels.filter(m => m !== modelId && m !== '_none_');
            }
            if (nextEnabled.length === 0) {
                nextEnabled = ['_none_'];
            }
        }
        console.log('[AIProvidersSettings] handleToggleLiteLLMModel:', { modelId, enabled, currentEnabled: litellmEnabledModels, nextEnabled });
        setLitellmEnabledModels(nextEnabled);
        await window.electronAPI?.setLitellmEnabledModels?.(nextEnabled);
    };

    const handleTestLiteLLMModelConnection = async (modelId: string) => {
        setLitellmModelTestStatus(prev => ({ ...prev, [modelId]: 'testing' }));
        setLitellmModelTestError(prev => ({ ...prev, [modelId]: '' }));
        try {
            const result = await window.electronAPI?.testLiteLLMModelConnection?.(modelId);
            if (result?.success) {
                setLitellmModelTestStatus(prev => ({ ...prev, [modelId]: 'success' }));
                setTimeout(() => {
                    setLitellmModelTestStatus(prev => ({ ...prev, [modelId]: 'idle' }));
                }, 3000);
            } else {
                setLitellmModelTestStatus(prev => ({ ...prev, [modelId]: 'error' }));
                setLitellmModelTestError(prev => ({ ...prev, [modelId]: result?.error || 'Connection failed' }));
            }
        } catch (e: any) {
            setLitellmModelTestStatus(prev => ({ ...prev, [modelId]: 'error' }));
            setLitellmModelTestError(prev => ({ ...prev, [modelId]: e.message || 'Connection failed' }));
        }
    };

    const handleTestConnection = async (provider: string, key: string) => {
        // Allow testing if key is provided OR if we have a stored key
        if (!key.trim() && !hasStoredKey[provider]) {
            return;
        }
        setTestStatus(prev => ({ ...prev, [provider]: 'testing' }));
        setTestError(prev => ({ ...prev, [provider]: '' }));

        try {
            // @ts-ignore
            const result = await window.electronAPI.testLlmConnection(provider, key);
            if (result.success) {
                setTestStatus(prev => ({ ...prev, [provider]: 'success' }));
                setTimeout(() => setTestStatus(prev => ({ ...prev, [provider]: 'idle' })), 3000);
            } else {
                setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
                setTestError(prev => ({ ...prev, [provider]: result.error || t('Connection failed') }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || t('Connection failed') }));
        }
    };

    const openKeyUrl = (provider: string) => {
        const urls: Record<string, string> = {
            gemini: 'https://aistudio.google.com/app/apikey',
            groq: 'https://console.groq.com/keys',
            openai: 'https://platform.openai.com/api-keys',
            claude: 'https://console.anthropic.com/settings/keys'
        };
        // @ts-ignore
        window.electronAPI?.openExternal(urls[provider]);
    };


    // --- Custom Provider Handlers ---

    const handleEditProvider = (provider: CustomProvider) => {
        setEditingProvider(provider);
        setCustomName(provider.name);
        setCustomCurl(provider.curlCommand);
        setCustomResponsePath(provider.responsePath || '');
        setCustomVision(provider.multimodal === true ? 'on' : provider.multimodal === false ? 'off' : 'auto');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleNewProvider = () => {
        setEditingProvider(null);
        setCustomName('');
        setCustomCurl('');
        setCustomResponsePath('');
        setCustomVision('auto');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleSaveCustom = async () => {
        setCurlError(null);
        if (!customName.trim()) {
            setCurlError(t("Provider Name is required."));
            return;
        }

        const validation = validateCurl(customCurl);
        if (!validation.isValid) {
            setCurlError(validation.message || t("Invalid cURL command."));
            return;
        }

        const newProvider: CustomProvider = {
            id: editingProvider ? editingProvider.id : crypto.randomUUID(),
            name: customName,
            curlCommand: customCurl,
            responsePath: customResponsePath,
            // 'auto' → omit the flag so the backend auto-detects from the template.
            ...(customVision === 'on' ? { multimodal: true } : customVision === 'off' ? { multimodal: false } : {}),
        };

        try {
            // @ts-ignore
            const result = await window.electronAPI.saveCustomProvider(newProvider);
            if (result.success) {
                // Refresh list
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
                setIsEditingCustom(false);
            } else {
                setCurlError(result.error ?? null);
            }
        } catch (e: any) {
            setCurlError(e.message);
        }
    };

    const handleDeleteCustom = async (id: string) => {
        try {
            // @ts-ignore
            const result = await window.electronAPI.deleteCustomProvider(id);
            if (result.success) {
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
            }
        } catch (e) {
            console.error("Failed to delete provider:", e);
        }
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <header>
                <h3 className="text-lg font-bold text-text-primary mb-1">{t('AI Providers')}</h3>
                <p className="text-xs text-text-secondary mb-5">
                    {t('Pick a default model and connect the cloud, local, or custom providers you want available.')}
                </p>
            </header>

            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">{t('Active Model')}</label>
                        <p className="text-[10px] text-text-secondary">{t('Applies to new chats instantly.')}</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={buildAvailableModelOptions()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>
                    className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between gap-4 ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? t("Requires Groq, Natively API, or Codex CLI to be configured") : ""}
                >
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">{t('Fast Response Mode')}</label>
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/20">NEW</span>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-0.5">{t('Routes responses through the fastest available provider (Codex fast mode model, Groq, or Natively). Turn off to use your selected model above.')}</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] text-orange-500 mt-0.5 font-medium">{t('Requires Groq, Natively API, or Codex CLI to be configured.')}</p>
                        )}
                    </div>
                    <div
                        onClick={async () => {
                            if (!canUseFastMode) {
                                alert(t("Please configure Groq, Natively API, or Codex CLI first to enable Fast Response Mode."));
                                return;
                            }
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('natively_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                        className={`shrink-0 w-11 h-6 rounded-full relative cursor-pointer transition-colors ${!canUseFastMode ? 'cursor-not-allowed bg-bg-toggle-switch' : fastResponseMode ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${fastResponseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>

                {/* AI Response Language */}
                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between gap-4">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">{t('AI Response Language')}</label>
                        <p className="text-[10px] text-text-secondary mt-0.5">
                            {aiResponseLanguage === 'auto'
                                ? t('Mirrors user\'s language automatically')
                                : t('Language for AI suggestions and notes')
                            }
                        </p>
                    </div>
                    <div className="relative" ref={aiLangDropdownRef}>
                        <button
                            onClick={onToggleAiLangDropdown}
                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                        >
                            <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap flex items-center gap-1">
                                {aiResponseLanguage === 'auto' ? t('Auto') : aiResponseLanguage}
                            </span>
                            <ChevronDown size={12} className={`shrink-0 transition-transform ${isAiLangDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isAiLangDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none max-h-60 overflow-y-auto custom-scrollbar">
                                {availableAiLanguages.map((option) => (
                                    <button
                                        key={option.code}
                                        onClick={() => onSelectAiLanguage(option.code)}
                                        className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${aiResponseLanguage === option.code ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                    >
                                        {option.code === 'auto' ? (
                                            <span className="font-medium">{t('Auto')}</span>
                                        ) : (
                                            <span className="font-medium">{option.label}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
>>>>>>> origin/main
            </div>

            {/* Segmented Pill Navigation */}
            <div className="flex items-center gap-1.5 p-1 bg-bg-input rounded-xl border border-border-subtle my-2">
                <button
                    type="button"
                    onClick={() => setActiveTab('cloud')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'cloud' ? 'bg-accent-primary/20 text-accent-primary shadow-sm border border-accent-primary/50 font-bold' : 'text-text-secondary hover:text-text-primary'}`}
                >
                    <span>☁</span>
                    <span>{t('Cloud Providers')}</span>
                    <span className="text-[9px] px-1.5 py-0.2 bg-bg-item-surface rounded-full text-text-tertiary font-mono">7</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('gateways')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'gateways' ? 'bg-accent-primary/20 text-accent-primary shadow-sm border border-accent-primary/50 font-bold' : 'text-text-secondary hover:text-text-primary'}`}
                >
                    <span>🔌</span>
                    <span>{t('Local & Gateways')}</span>
                    <span className="text-[9px] px-1.5 py-0.2 bg-bg-item-surface rounded-full text-text-tertiary font-mono">3</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('vision')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'vision' ? 'bg-accent-primary/20 text-accent-primary shadow-sm border border-accent-primary/50 font-bold' : 'text-text-secondary hover:text-text-primary'}`}
                >
                    <span>👁</span>
                    <span>{t('Vision & Privacy')}</span>
                </button>
            </div>

            {/* TAB 1: Cloud Providers */}
            {activeTab === 'cloud' && (
                <div className="space-y-5 animated fadeIn">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-1">{t('Cloud Providers')}</h3>
                        <p className="text-xs text-text-secondary mb-2">{t('Add API keys or subscriptions to unlock cloud AI models.')}</p>
                    </div>

                    <div className="space-y-4">
                        {/* Gemini */}
                        <ProviderCard
                            id="provider-card-gemini"
                            providerId="gemini"
                            providerName="Gemini"
                            icon={<LobeProviderIcon provider="gemini" name="Gemini" size={20} />}
                            apiKey={geminiApiKey}
                            preferredModel={preferredModels.gemini}
                            enabledModels={cloudEnabledModels.gemini}
                            onSetEnabledModels={(models) => setCloudEnabledModels(prev => ({ ...prev, gemini: models }))}
                            hasStoredKey={!!hasStoredKey.gemini}
                            onKeyChange={setGeminiApiKey}
                            onSaveKey={async () => { await handleSaveKey('gemini', geminiApiKey, setGeminiApiKey); }}
                            onRemoveKey={() => handleRemoveKey('gemini', setGeminiApiKey)}
                            onTestConnection={() => handleTestConnection('gemini', geminiApiKey)}
                            testStatus={testStatus.gemini || 'idle'}
                            testError={testError.gemini}
                            savingStatus={!!savingStatus.gemini}
                            savedStatus={!!savedStatus.gemini}
                            keyPlaceholder="AIzaSy..."
                            keyUrl="https://aistudio.google.com/app/apikey"
                            onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, gemini: model }))}
                            isDisabled={disabledProviders.includes('gemini')}
                            onToggleDisabled={(disabled) => handleToggleProviderDisabled('gemini', disabled)}
                        />

                        {/* Groq */}
                        <ProviderCard
                            id="provider-card-groq"
                            providerId="groq"
                            providerName="Groq"
                            icon={<LobeProviderIcon provider="groq" name="Groq" size={20} />}
                            isFastProvider={true}
                            fastModeEnabled={fastResponseMode}
                            onToggleFastMode={async (enabled) => {
                                setFastResponseMode(enabled);
                                localStorage.setItem('natively_groq_fast_text', String(enabled));
                                // @ts-ignore
                                await window.electronAPI?.setGroqFastTextMode?.(enabled);
                            }}
                            apiKey={groqApiKey}
                            preferredModel={preferredModels.groq}
                            enabledModels={cloudEnabledModels.groq}
                            onSetEnabledModels={(models) => setCloudEnabledModels(prev => ({ ...prev, groq: models }))}
                            hasStoredKey={!!hasStoredKey.groq}
                            onKeyChange={setGroqApiKey}
                            onSaveKey={async () => { await handleSaveKey('groq', groqApiKey, setGroqApiKey); }}
                            onRemoveKey={() => handleRemoveKey('groq', setGroqApiKey)}
                            onTestConnection={() => handleTestConnection('groq', groqApiKey)}
                            testStatus={testStatus.groq || 'idle'}
                            testError={testError.groq}
                            savingStatus={!!savingStatus.groq}
                            savedStatus={!!savedStatus.groq}
                            keyPlaceholder="gsk_..."
                            keyUrl="https://console.groq.com/keys"
                            onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, groq: model }))}
                            isDisabled={disabledProviders.includes('groq')}
                            onToggleDisabled={(disabled) => handleToggleProviderDisabled('groq', disabled)}
                        />

                        {/* OpenAI */}
                        <ProviderCard
                            id="provider-card-openai"
                            providerId="openai"
                            providerName="OpenAI"
                            icon={<LobeProviderIcon provider="openai" name="OpenAI" size={20} />}
                            apiKey={openaiApiKey}
                            preferredModel={preferredModels.openai}
                            enabledModels={cloudEnabledModels.openai}
                            onSetEnabledModels={(models) => setCloudEnabledModels(prev => ({ ...prev, openai: models }))}
                            hasStoredKey={!!hasStoredKey.openai}
                            onKeyChange={setOpenaiApiKey}
                            onSaveKey={async () => { await handleSaveKey('openai', openaiApiKey, setOpenaiApiKey); }}
                            onRemoveKey={() => handleRemoveKey('openai', setOpenaiApiKey)}
                            onTestConnection={() => handleTestConnection('openai', openaiApiKey)}
                            testStatus={testStatus.openai || 'idle'}
                            testError={testError.openai}
                            savingStatus={!!savingStatus.openai}
                            savedStatus={!!savedStatus.openai}
                            keyPlaceholder="sk-..."
                            keyUrl="https://platform.openai.com/api-keys"
                            onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, openai: model }))}
                            isDisabled={disabledProviders.includes('openai')}
                            onToggleDisabled={(disabled) => handleToggleProviderDisabled('openai', disabled)}
                        />

                        {/* Claude */}
                        <ProviderCard
                            id="provider-card-claude"
                            providerId="claude"
                            providerName="Claude"
                            icon={<LobeProviderIcon provider="claude" name="Claude" size={20} />}
                            apiKey={claudeApiKey}
                            preferredModel={preferredModels.claude}
                            enabledModels={cloudEnabledModels.claude}
                            onSetEnabledModels={(models) => setCloudEnabledModels(prev => ({ ...prev, claude: models }))}
                            hasStoredKey={!!hasStoredKey.claude}
                            onKeyChange={setClaudeApiKey}
                            onSaveKey={async () => { await handleSaveKey('claude', claudeApiKey, setClaudeApiKey); }}
                            onRemoveKey={() => handleRemoveKey('claude', setClaudeApiKey)}
                            onTestConnection={() => handleTestConnection('claude', claudeApiKey)}
                            testStatus={testStatus.claude || 'idle'}
                            testError={testError.claude}
                            savingStatus={!!savingStatus.claude}
                            savedStatus={!!savedStatus.claude}
                            keyPlaceholder="sk-ant-..."
                            keyUrl="https://console.anthropic.com/settings/keys"
                            onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, claude: model }))}
                            isDisabled={disabledProviders.includes('claude')}
                            onToggleDisabled={(disabled) => handleToggleProviderDisabled('claude', disabled)}
                        />

                        {/* DeepSeek */}
                        <ProviderCard
                            id="provider-card-deepseek"
                            providerId="deepseek"
                            providerName="DeepSeek"
                            icon={<LobeProviderIcon provider="deepseek" name="DeepSeek" size={20} />}
                            apiKey={deepseekApiKey}
                            preferredModel={preferredModels.deepseek}
                            enabledModels={cloudEnabledModels.deepseek}
                            onSetEnabledModels={(models) => setCloudEnabledModels(prev => ({ ...prev, deepseek: models }))}
                            hasStoredKey={!!hasStoredKey.deepseek}
                            onKeyChange={setDeepseekApiKey}
                            onSaveKey={async () => { await handleSaveKey('deepseek', deepseekApiKey, setDeepseekApiKey); }}
                            onRemoveKey={() => handleRemoveKey('deepseek', setDeepseekApiKey)}
                            onTestConnection={() => handleTestConnection('deepseek', deepseekApiKey)}
                            testStatus={testStatus.deepseek || 'idle'}
                            testError={testError.deepseek}
                            savingStatus={!!savingStatus.deepseek}
                            savedStatus={!!savedStatus.deepseek}
                            keyPlaceholder="sk-..."
                            keyUrl="https://platform.deepseek.com/api_keys"
                            onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, deepseek: model }))}
                            isDisabled={disabledProviders.includes('deepseek')}
                            onToggleDisabled={(disabled) => handleToggleProviderDisabled('deepseek', disabled)}
                        />

                        {/* ChatGPT (Codex) — OpenAI Cloud Subscription */}
                        <div id="provider-card-codex" className={`bg-bg-item-surface rounded-xl p-5 border transition-all ${disabledProviders.includes('codex') ? 'border-transparent bg-bg-item-surface/40 opacity-70 shadow-none' : 'border-border-subtle'} space-y-4`}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2.5">
                                    <LobeProviderIcon provider="codex" name="ChatGPT Codex" size={20} />
                                    <label className="flex items-center gap-2 text-xs font-bold text-text-primary uppercase tracking-wide">
                                        ChatGPT (Codex)
                                    </label>
                                    {disabledProviders.includes('codex') ? (
                                        <span className="text-[10px] font-semibold text-amber-500/90 dark:text-amber-400/90 uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                                            {t('Disabled')}
                                        </span>
                                    ) : codexOauthStatus.signedIn ? (
                                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center gap-1">
                                            ✓ {t('Connected')}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-2 py-0.5 bg-bg-input border border-border-subtle rounded-full">
                                            {t('Not Signed In')}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {codexOauthStatus.signedIn && !disabledProviders.includes('codex') && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={handleCodexRefresh}
                                                disabled={codexOauthInProgress}
                                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors disabled:opacity-60"
                                                title={t("Refresh session")}
                                            >
                                                <RefreshCw size={12} />
                                                <span className="text-[10px] uppercase tracking-wide">{t('Refresh')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCodexSignOut}
                                                disabled={codexOauthInProgress}
                                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors disabled:opacity-60"
                                            >
                                                <LogOut size={12} />
                                                <span className="text-[10px] uppercase tracking-wide">{t('Sign out')}</span>
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleProviderDisabled('codex', !disabledProviders.includes('codex'));
                                        }}
                                        className={`shrink-0 w-9 h-5 rounded-full relative cursor-pointer transition-colors border ${disabledProviders.includes('codex') ? 'bg-zinc-300 dark:bg-zinc-700/80 border-zinc-400/40 dark:border-zinc-600/50' : 'bg-emerald-500 border-emerald-400'}`}
                                        title={disabledProviders.includes('codex') ? t("Enable Provider") : t("Disable Provider")}
                                    >
                                        <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${disabledProviders.includes('codex') ? 'translate-x-0' : 'translate-x-4'}`} />
                                    </button>
                                </div>
                            </div>

                            {!disabledProviders.includes('codex') && (
                                <>
                                    <p className="text-xs text-text-secondary">{t('Use your ChatGPT Plus/Pro subscription as a cloud AI provider — no API key needed.')}</p>

                            {/* Sign-in area or signed-in account display */}
                            {codexOauthStatus.signedIn ? (
                                <div className="flex gap-2 mb-3">
                                    <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary flex items-center gap-2 font-mono">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                        <span>{codexOauthStatus.email || t('ChatGPT account connected')}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex gap-2 mb-3">
                                    <button
                                        type="button"
                                        onClick={() => handleCodexAuthAction('login')}
                                        disabled={codexOauthInProgress || codexAuthAction !== 'idle' || disabledProviders.includes('codex')}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                                    >
                                        {codexOauthInProgress || codexAuthAction === 'login'
                                            ? <><Loader2 size={13} className="animate-spin" /> {t('Waiting for browser…')}</>
                                            : <><ExternalLink size={13} /> {t('Sign in with ChatGPT')}</>}
                                    </button>
                                </div>
                            )}

                            {codexAuthMessage && (
                                <p className={`text-[10px] mt-1.5 mb-2 ${codexAuthStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                                    {codexAuthMessage}
                                </p>
                            )}

                            {/* Model + settings — only shown once signed in */}
                            {codexOauthStatus.signedIn && !disabledProviders.includes('codex') && (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <CodexCliModelField
                                            label={t("Model")}
                                            value={codexCliConfig.model}
                                            placeholder="gpt-5.5"
                                            onChange={(model) => setCodexCliConfig(prev => ({ ...prev, model }))}
                                            onSelect={(model) => saveCodexCliConfig({ ...codexCliConfig, model })}
                                            onSave={() => saveCodexCliConfig()}
                                        />
                                        <CodexCliModelField
                                            label={t("Fast Mode Model")}
                                            value={codexCliConfig.fastModel}
                                            placeholder="gpt-5.3-codex"
                                            onChange={(fastModel) => setCodexCliConfig(prev => ({ ...prev, fastModel }))}
                                            onSelect={(fastModel) => saveCodexCliConfig({ ...codexCliConfig, fastModel })}
                                            onSave={() => saveCodexCliConfig()}
                                        />
                                        <label className="space-y-1">
                                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Reasoning Effort')}</span>
                                            <ModelSelect
                                                value={(() => {
                                                    const valid = getValidCodexReasoningEfforts(codexCliConfig.model);
                                                    if (!codexCliConfig.modelReasoningEffort) return '';
                                                    return valid.includes(codexCliConfig.modelReasoningEffort)
                                                        ? codexCliConfig.modelReasoningEffort
                                                        : '';
                                                })()}
                                                options={(() => {
                                                    const valid = getValidCodexReasoningEfforts(codexCliConfig.model);
                                                    return [
                                                        { id: '', name: t('None (default)') },
                                                        ...CODEX_MODEL_REASONING_EFFORTS
                                                            .filter(e => e !== 'none' && valid.includes(e))
                                                            .map(e => ({ id: e, name: e.charAt(0).toUpperCase() + e.slice(1) })),
                                                    ];
                                                })()}
                                                onChange={(effort) => saveCodexCliConfig({ ...codexCliConfig, modelReasoningEffort: effort || undefined })}
                                                placeholder={t("None (default)")}
                                                className="py-2"
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Service Tier')}</span>
                                            <ModelSelect
                                                value={codexCliConfig.serviceTier ?? 'default'}
                                                options={CODEX_SERVICE_TIERS.map(t => ({ id: t, name: t.charAt(0).toUpperCase() + t.slice(1) }))}
                                                onChange={(serviceTier) => saveCodexCliConfig({ ...codexCliConfig, serviceTier: serviceTier as typeof CODEX_SERVICE_TIERS[number] })}
                                                placeholder={t("Default")}
                                                className="py-2"
                                            />
                                        </label>
                                    </div>
                                    <div className="flex items-end justify-between gap-4 mt-1">
                                        <label className="space-y-1">
                                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Timeout (ms)')}</span>
                                            <input
                                                type="number"
                                                value={codexCliConfig.timeoutMs}
                                                onChange={e => setCodexCliConfig(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                                                onBlur={() => saveCodexCliConfig()}
                                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                                min={1000}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={handleTestCodexCli}
                                            disabled={codexCliStatus === 'testing'}
                                            className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 border flex items-center gap-1.5 min-w-[110px] justify-center disabled:opacity-50 ${
                                                codexCliStatus === 'success'
                                                    ? 'border-green-500/40 bg-green-500/10 text-green-400'
                                                    : codexCliStatus === 'error'
                                                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                                                    : 'border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary'
                                            }`}
                                        >
                                            {codexCliStatus === 'testing' ? (
                                                <><Loader2 size={12} className="animate-spin" /> {t('Testing…')}</>
                                            ) : codexCliStatus === 'success' ? (
                                                <><CheckCircle size={12} /> {t('Connected')}</>
                                            ) : codexCliStatus === 'error' ? (
                                                <><AlertCircle size={12} /> {t('Failed')}</>
                                            ) : (
                                                t('Test Connection')
                                            )}
                                        </button>
                                    </div>
                                </>
                            )}
                                </>
                            )}
                        </div>

                        {/* OpenRouter — Last Cloud Model Option */}
                        <ProviderCard
                            id="provider-card-openrouter"
                            providerId="openrouter"
                            providerName="OpenRouter"
                            icon={<LobeProviderIcon provider="openrouter" name="OpenRouter" size={20} />}
                            apiKey={openrouterApiKey}
                            preferredModel={preferredModels.openrouter}
                            enabledModels={cloudEnabledModels.openrouter}
                            onSetEnabledModels={(models) => setCloudEnabledModels(prev => ({ ...prev, openrouter: models }))}
                            hasStoredKey={!!hasStoredKey.openrouter}
                            onKeyChange={setOpenrouterApiKey}
                            onSaveKey={async () => { await handleSaveKey('openrouter', openrouterApiKey, setOpenrouterApiKey); }}
                            onRemoveKey={() => handleRemoveKey('openrouter', setOpenrouterApiKey)}
                            onTestConnection={() => handleTestConnection('openrouter', openrouterApiKey)}
                            testStatus={testStatus.openrouter || 'idle'}
                            testError={testError.openrouter}
                            savingStatus={!!savingStatus.openrouter}
                            savedStatus={!!savedStatus.openrouter}
                            keyPlaceholder="sk-or-v1-..."
                            keyUrl="https://openrouter.ai/keys"
                            onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, openrouter: model }))}
                            isDisabled={disabledProviders.includes('openrouter')}
                            onToggleDisabled={(disabled) => handleToggleProviderDisabled('openrouter', disabled)}
                        />
                    </div>
                </div>
            )}

            {/* TAB 2: Local & Gateways */}
            {activeTab === 'gateways' && (
                <div className="space-y-6 animated fadeIn">
                    {/* LiteLLM Proxy */}
                    <div id="provider-card-litellm" className={`bg-bg-item-surface rounded-xl p-5 border transition-all ${disabledProviders.includes('litellm') ? 'border-transparent bg-bg-item-surface/40 opacity-70 shadow-none' : 'border-border-subtle'} space-y-4`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <LobeProviderIcon provider="litellm" name="LiteLLM" size={20} />
                                <label className="block text-xs font-bold text-text-primary mb-0 uppercase tracking-wide">LiteLLM Proxy</label>
                                {disabledProviders.includes('litellm') ? (
                                    <span className="text-[10px] font-semibold text-amber-500/90 dark:text-amber-400/90 uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                                        {t('Disabled')}
                                    </span>
                                ) : hasStoredKey.litellm ? (
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
                                <a href="https://docs.litellm.ai/docs/simple_proxy" target="_blank" rel="noreferrer" className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors">
                                    <span className="text-[10px] uppercase tracking-wide">{t('Docs')}</span>
                                    <ExternalLink size={12} />
                                </a>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleProviderDisabled('litellm', !disabledProviders.includes('litellm'));
                                    }}
                                    className={`shrink-0 w-9 h-5 rounded-full relative cursor-pointer transition-colors border ${disabledProviders.includes('litellm') ? 'bg-zinc-300 dark:bg-zinc-700/80 border-zinc-400/40 dark:border-zinc-600/50' : 'bg-emerald-500 border-emerald-400'}`}
                                    title={disabledProviders.includes('litellm') ? t("Enable Provider") : t("Disable Provider")}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${disabledProviders.includes('litellm') ? 'translate-x-0' : 'translate-x-4'}`} />
                                </button>
                            </div>
                        </div>

                        {!disabledProviders.includes('litellm') && (
                            <>
                                <p className="text-xs text-text-secondary">
                                    {t('OpenAI-compatible gateway to 100+ providers. Models auto-discovered from the proxy.')}
                                </p>

                                {/* UNCONFIGURED STATE: Inputs + Save Button */}
                                {!hasStoredKey.litellm ? (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <label className="space-y-1 block">
                                                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Proxy Base URL')}</span>
                                                <input
                                                    value={litellmBaseURL}
                                                    onChange={e => setLitellmBaseURL(e.target.value)}
                                                    disabled={disabledProviders.includes('litellm')}
                                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary disabled:opacity-50"
                                                    placeholder="http://localhost:4000/v1"
                                                />
                                            </label>

                                            <label className="space-y-1 block">
                                                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Virtual Key (optional)')}</span>
                                                <input
                                                    type="password"
                                                    value={litellmApiKey}
                                                    onChange={e => setLitellmApiKey(e.target.value)}
                                                    disabled={disabledProviders.includes('litellm')}
                                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary disabled:opacity-50"
                                                    placeholder={t('sk-... (only if proxy requires auth)')}
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-1">
                                            <span className="block text-[10px] font-medium text-text-secondary uppercase tracking-wide">{t('Max Output Tokens')}</span>
                                            <ModelSelect
                                                value={litellmMaxTokens}
                                                options={LITELLM_MAX_TOKENS_OPTIONS}
                                                onChange={setLitellmMaxTokens}
                                                placeholder={t("Auto (per-model)")}
                                                className="py-2"
                                            />
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleSaveLitellm}
                                                disabled={!litellmBaseURL.trim() || !!savingStatus.litellm || disabledProviders.includes('litellm')}
                                                className="px-5 py-2.5 rounded-lg text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary-hover disabled:opacity-50 transition-colors cursor-pointer"
                                            >
                                                {savingStatus.litellm ? t('Saving…') : savedStatus.litellm ? t('Saved!') : t('Save')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* CONFIGURED STATE: Proxy URL Indicator + Single Action Row */
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-primary">
                                            <Globe size={14} className="text-accent-primary shrink-0" />
                                            <span className="text-text-tertiary uppercase text-[10px] font-sans tracking-wide shrink-0">{t('Proxy URL')}:</span>
                                            <span className="text-text-primary truncate font-bold">{litellmBaseURL || 'http://localhost:4000/v1'}</span>
                                        </div>

                                        <div className="flex items-center justify-between gap-2.5 w-full">
                                            {/* 1. Manage Models Button */}
                                            <button
                                                type="button"
                                                onClick={() => setIsManageModelsOpen(true)}
                                                disabled={disabledProviders.includes('litellm')}
                                                className="flex-1 max-w-[320px] bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <div className="flex items-center gap-2 truncate">
                                                    <SlidersHorizontal size={13} className="text-accent-primary shrink-0" />
                                                    <span className="truncate font-medium">
                                                        {t('Manage Models')} ({
                                                            litellmEnabledModels.includes('_none_')
                                                                ? 0
                                                                : litellmEnabledModels.length === 0
                                                                    ? litellmModels.length
                                                                    : litellmModels.filter(m => litellmEnabledModels.includes(m)).length
                                                        }/{litellmModels.length})
                                                    </span>
                                                </div>
                                                <ChevronDown size={14} className="text-text-secondary shrink-0 ml-1" />
                                            </button>

                                            <div className="flex items-center gap-2 shrink-0">
                                                {/* 2. Test Connection / Refresh Button */}
                                                <button
                                                    type="button"
                                                    onClick={handleRefreshLiteLLM}
                                                    disabled={isRefreshingLiteLLM || disabledProviders.includes('litellm')}
                                                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                                                >
                                                    {isRefreshingLiteLLM ? <><Loader2 size={12} className="animate-spin text-accent-primary" /> {t('Testing...')}</> : <><CheckCircle size={12} className="text-green-500" /> {t('Connected')}</>}
                                                </button>

                                                {/* 3. Remove Configuration Button */}
                                                <button
                                                    type="button"
                                                    onClick={handleRemoveLitellm}
                                                    disabled={disabledProviders.includes('litellm')}
                                                    className="p-2 rounded-md text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center"
                                                    title={t("Remove Configuration")}
                                                >
                                                    <Trash2 size={14} strokeWidth={1.5} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Local (Ollama) Providers */}
                    <div id="provider-card-ollama" className={`bg-bg-item-surface rounded-xl p-5 border transition-all ${disabledProviders.includes('ollama') ? 'border-transparent bg-bg-item-surface/40 opacity-70 shadow-none' : 'border-border-subtle'} space-y-4`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <LobeProviderIcon provider="ollama" name="Ollama" size={20} />
                                <div>
                                    <h3 className="text-xs font-bold text-text-primary uppercase tracking-wide">{t('Local Models (Ollama)')}</h3>
                                </div>
                                {disabledProviders.includes('ollama') ? (
                                    <span className="text-[10px] font-semibold text-amber-500/90 dark:text-amber-400/90 uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                                        {t('Disabled')}
                                    </span>
                                ) : ollamaStatus === 'detected' ? (
                                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                                        {t('Connected')}
                                    </span>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={async () => {
                                        setIsRefreshingOllama(true);
                                        await checkOllama(false);
                                        setTimeout(() => setIsRefreshingOllama(false), 500);
                                    }}
                                    className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors cursor-pointer"
                                    title={t("Refresh Ollama")}
                                    disabled={isRefreshingOllama || disabledProviders.includes('ollama')}
                                >
                                    <RefreshCw size={14} className={isRefreshingOllama ? "animate-spin" : ""} />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleProviderDisabled('ollama', !disabledProviders.includes('ollama'));
                                    }}
                                    className={`shrink-0 w-9 h-5 rounded-full relative cursor-pointer transition-colors border ${disabledProviders.includes('ollama') ? 'bg-zinc-300 dark:bg-zinc-700/80 border-zinc-400/40 dark:border-zinc-600/50' : 'bg-emerald-500 border-emerald-400'}`}
                                    title={disabledProviders.includes('ollama') ? t("Enable Provider") : t("Disable Provider")}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${disabledProviders.includes('ollama') ? 'translate-x-0' : 'translate-x-4'}`} />
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-text-secondary">{t('Run open-source models locally.')}</p>

                        {!disabledProviders.includes('ollama') && (
                            <div>
                                {ollamaStatus === 'checking' && (
                                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                                        <span className="animate-spin">⏳</span> {t('Checking for Ollama...')}
                                    </div>
                                )}

                                {ollamaStatus === 'not-found' && (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-xs text-red-400 font-medium">
                                            <AlertCircle size={14} />
                                            <span>{t('Ollama not detected')}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs text-text-secondary">
                                                {t('Ensure Ollama is running (`ollama serve`).')}
                                            </p>
                                            <button
                                                onClick={handleFixOllama}
                                                className="text-[10px] bg-bg-elevated hover:bg-bg-input px-2 py-1 rounded border border-border-subtle cursor-pointer"
                                            >
                                                {t('Auto-Fix Connection')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-xs text-green-400 font-medium">
                                            <CheckCircle size={14} />
                                            <span>{t('Ollama connected')} ({ollamaModels.length} {t('models available')})</span>
                                        </div>

                                        <div className="grid grid-cols-1 gap-2">
                                            {ollamaModels.map(model => (
                                                <div key={model} className="flex items-center justify-between p-2 bg-bg-input rounded-lg border border-border-subtle">
                                                    <span className="text-xs text-text-primary font-mono">{model}</span>
                                                    <span className="text-[10px] text-bg-elevated bg-text-secondary px-1.5 py-0.5 rounded-full font-bold">LOCAL</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Custom Providers */}
                    <div id="provider-card-custom" className={`bg-bg-item-surface rounded-xl p-5 border transition-all ${disabledProviders.includes('custom') ? 'border-transparent bg-bg-item-surface/40 opacity-70 shadow-none' : 'border-border-subtle'} space-y-4`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <LobeProviderIcon provider="custom" name="Custom Endpoints" size={20} />
                                <h3 className="text-xs font-bold text-text-primary uppercase tracking-wide">{t('Custom Endpoints')}</h3>
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-yellow-500/10 text-yellow-500 dark:text-yellow-400 border border-yellow-500/20">{t('EXPERIMENTAL')}</span>
                                {disabledProviders.includes('custom') && (
                                    <span className="text-[10px] font-semibold text-amber-500/90 dark:text-amber-400/90 uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                                        {t('Disabled')}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleNewProvider}
                                    disabled={disabledProviders.includes('custom')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    <Plus size={14} /> {t('Add Provider')}
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleProviderDisabled('custom', !disabledProviders.includes('custom'));
                                    }}
                                    className={`shrink-0 w-9 h-5 rounded-full relative cursor-pointer transition-colors border ${disabledProviders.includes('custom') ? 'bg-zinc-300 dark:bg-zinc-700/80 border-zinc-400/40 dark:border-zinc-600/50' : 'bg-emerald-500 border-emerald-400'}`}
                                    title={disabledProviders.includes('custom') ? t("Enable Provider") : t("Disable Provider")}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${disabledProviders.includes('custom') ? 'translate-x-0' : 'translate-x-4'}`} />
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-text-secondary">{t('Add your own AI endpoints via cURL.')}</p>

                        {!disabledProviders.includes('custom') && (
                            <div className="space-y-3">
                                {customProviders.length === 0 ? (
                                    <div className="text-center py-6 bg-bg-input rounded-xl border border-border-subtle border-dashed">
                                        <p className="text-xs text-text-tertiary">{t('No custom providers added yet.')}</p>
                                    </div>
                                ) : (
                                    customProviders.map((provider) => (
                                        <div key={provider.id} className="bg-bg-input rounded-xl p-3 border border-border-subtle flex items-center justify-between group">
                                            <div className="flex items-center gap-3">
                                                <div className="w-7 h-7 rounded-lg bg-bg-elevated flex items-center justify-center text-text-secondary font-mono text-xs font-bold border border-border-subtle">
                                                    {provider.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-semibold text-text-primary">{provider.name}</h4>
                                                    <p className="text-[10px] text-text-tertiary font-mono truncate max-w-[200px]">
                                                        {provider.curlCommand.substring(0, 30)}...
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleEditProvider(provider)}
                                                    className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
                                                    title={t("Edit")}
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCustom(provider.id)}
                                                    className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                                    title={t("Delete")}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: Vision & Privacy */}
            {activeTab === 'vision' && (
                <div className="space-y-6 animated fadeIn">
                    {/* Screen Understanding — vision-first routing */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                        <div>
                            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wide mb-1">{t('Screen understanding strategy')}</h3>
                            <p className="text-xs text-text-secondary">{t('Select how Natively reads what is on your screen. All options use vision-capable providers directly.')}</p>
                        </div>

                        <div className="flex flex-col gap-2">
                            {([
                                {
                                    value: 'vision_first' as const,
                                    label: t('Vision first'),
                                    description: t('Recommended. Try every configured vision provider in order; first success wins.'),
                                },
                                {
                                    value: 'vision_only' as const,
                                    label: t('Vision only'),
                                    description: t('Stricter. Require a vision-capable provider; never silently drop the screenshot.'),
                                },
                                {
                                    value: 'private_vision' as const,
                                    label: t('Private vision (local only)'),
                                    description: t('Use a local vision model (Ollama) only. Never call cloud vision. Clear error if no local provider is configured.'),
                                },
                            ]).map(({ value, label, description }) => {
                                const selected = screenUnderstandingMode === value;
                                return (
                                    <div
                                        key={value}
                                        onClick={() => {
                                            setScreenUnderstandingMode(value);
                                            window.electronAPI?.setScreenUnderstandingMode?.(value);
                                        }}
                                        className={`px-3.5 py-3 rounded-xl border cursor-pointer transition-colors ${selected ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border-subtle hover:border-border-muted bg-bg-input'}`}
                                        role="radio"
                                        aria-checked={selected}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex flex-col">
                                                <span className={`text-xs font-bold ${selected ? 'text-emerald-300' : 'text-text-primary'}`}>{label}</span>
                                                <span className="text-[11px] text-text-secondary leading-snug mt-0.5">{description}</span>
                                            </div>
                                            <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${selected ? 'border-emerald-400 bg-emerald-400' : 'border-border-muted'}`} />
                                        </div>
                                    </div>
                                );
                            })}

                            <div className="flex items-center justify-between pt-3 mt-1 border-t border-border-subtle">
                                <div className="flex flex-col">
                                    <span className="text-xs text-text-primary font-bold">{t('Technical interview direct vision')}</span>
                                    <span className="text-[11px] text-text-secondary leading-snug mt-0.5">{t('Use the highest-resolution image profile so code text stays sharp in interview mode.')}</span>
                                </div>
                                <div
                                    onClick={() => {
                                        const next = !technicalInterviewVisionFirst;
                                        setTechnicalInterviewVisionFirst(next);
                                        const api: any = window.electronAPI;
                                        if (api?.setTechnicalInterviewVisionFirst) {
                                            api.setTechnicalInterviewVisionFirst(next);
                                        } else {
                                            window.electronAPI?.setTechnicalInterviewDirectVision?.(next);
                                        }
                                    }}
                                    className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer shrink-0 ${technicalInterviewVisionFirst ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch"
                                    aria-checked={technicalInterviewVisionFirst}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${technicalInterviewVisionFirst ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Cloud Provider Data Scopes — fail-closed cloud share controls */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-xs font-bold text-text-primary uppercase tracking-wide mb-0">{t('Cloud provider data scopes')}</h3>
                                    <button
                                        type="button"
                                        onClick={() => setShowDataScopesInfo(!showDataScopesInfo)}
                                        className="text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
                                        title={t("Detailed Info")}
                                    >
                                        <Info size={14} />
                                    </button>
                                </div>
                                <p className="text-xs text-text-secondary">{t('Control what data types cloud AI providers can access.')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const allOn = { transcript: true, screenshots: true, reference_files: true, profile_history: true, embeddings: true, post_call_summary: true };
                                        setProviderDataScopes(allOn);
                                        window.electronAPI?.setProviderDataScopes?.(allOn);
                                    }}
                                    className="px-3 py-1.5 text-xs font-semibold bg-bg-input hover:bg-bg-elevated border border-border-subtle hover:border-emerald-500/50 text-text-primary rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
                                >
                                    <span>☁</span> {t('Allow All')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const allOff = { transcript: false, screenshots: false, reference_files: false, profile_history: false, embeddings: false, post_call_summary: false };
                                        setProviderDataScopes(allOff);
                                        window.electronAPI?.setProviderDataScopes?.(allOff);
                                    }}
                                    className="px-3 py-1.5 text-xs font-semibold bg-bg-input hover:bg-bg-elevated border border-border-subtle hover:border-amber-500/50 text-amber-400 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
                                >
                                    <span>🔒</span> {t('Private Mode')}
                                </button>
                            </div>
                        </div>

                        {showDataScopesInfo && (
                            <div className="p-3 bg-accent-primary/10 border border-accent-primary/20 rounded-xl text-xs text-text-secondary leading-relaxed space-y-1 animated fadeIn">
                                <p className="font-semibold text-text-primary">{t('How Cloud Data Scopes Work:')}</p>
                                <p>{t('You can toggle access per data category. Any data scope disabled here will never leave your device for cloud processing — Natively automatically falls back to local models (such as Ollama or local Whisper) for those specific data types.')}</p>
                            </div>
                        )}

                        <div className="flex flex-col gap-2.5">
                            {([
                                { key: 'transcript', label: t('Transcripts') },
                                { key: 'screenshots', label: t('Screenshots') },
                                { key: 'reference_files', label: t('Reference files') },
                                { key: 'profile_history', label: t('Profile history') },
                                { key: 'embeddings', label: t('Cloud embeddings') },
                                { key: 'post_call_summary', label: t('Post-call summaries') },
                            ] as const).map(({ key, label }) => {
                                const allowed = providerDataScopes[key] !== false;
                                return (
                                    <div key={key} className="flex items-center justify-between p-2.5 rounded-lg bg-bg-input border border-transparent hover:border-border-subtle/30 transition-colors">
                                        <span className="text-xs text-text-secondary font-medium">{label}</span>
                                        <div
                                            onClick={() => {
                                                const next = { ...providerDataScopes, [key]: !allowed };
                                                setProviderDataScopes(next);
                                                window.electronAPI?.setProviderDataScopes?.(next);
                                            }}
                                            className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer border ${allowed ? 'bg-emerald-500 border-emerald-400' : 'bg-zinc-300 dark:bg-zinc-700/80 border-zinc-400/40 dark:border-zinc-600/50'}`}
                                            role="switch"
                                            aria-checked={allowed}
                                        >
                                            <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="flex items-start gap-2 mt-1 pt-3 border-t border-border-subtle">
                                <Info size={14} className="text-text-tertiary shrink-0 mt-0.5" />
                                <p className="text-[11px] text-text-tertiary leading-relaxed">{t('When a data type is disabled, Natively falls back to the best available local model to keep that data on-device.')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Provider Edit Modal */}
            <Dialog open={isEditingCustom} onOpenChange={setIsEditingCustom}>
                <DialogContent className="w-[540px] max-w-[92vw] bg-bg-elevated border border-border-subtle p-6 rounded-2xl shadow-2xl z-50 animated fadeIn text-xs text-text-primary opacity-100 max-h-[88vh] overflow-y-auto ring-1 ring-border-subtle/50">
                    <h4 className="text-sm font-bold text-text-primary mb-4">{editingProvider ? t('Edit Custom Provider') : t('New Custom Provider')}</h4>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1">{t('Provider Name')}</label>
                            <input
                                type="text"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder={t("My Custom LLM")}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1">{t('cURL Command')}</label>
                            <textarea
                                value={customCurl}
                                onChange={(e) => setCustomCurl(e.target.value)}
                                placeholder={`curl https://api.openai.com/v1/chat/completions ... "content": "{{TEXT}}"`}
                                className="w-full h-32 bg-bg-input border border-border-subtle rounded-lg p-4 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary transition-colors resize-none leading-relaxed"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1">
                                {t('Response JSON Path')} <span className="text-text-tertiary normal-case font-normal">{t('(Optional)')}</span>
                            </label>
                            <input
                                type="text"
                                value={customResponsePath}
                                onChange={(e) => setCustomResponsePath(e.target.value)}
                                placeholder={t("e.g. choices[0].message.content")}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1">
                                {t('Screenshot / Vision Support')}
                            </label>
                            <select
                                value={customVision}
                                onChange={(e) => setCustomVision(e.target.value as 'auto' | 'on' | 'off')}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                            >
                                <option value="auto">{t('Auto-detect (recommended)')}</option>
                                <option value="on">{t('Always send screenshots')}</option>
                                <option value="off">{t('Never send screenshots (text only)')}</option>
                            </select>
                        </div>

                        {curlError && (
                            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                <span>{curlError}</span>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setIsEditingCustom(false)}
                                className="px-4 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors cursor-pointer"
                            >
                                {t('Cancel')}
                            </button>
                            <button
                                onClick={handleSaveCustom}
                                className="px-4 py-2 rounded-lg text-xs font-semibold bg-accent-primary text-white hover:bg-accent-secondary transition-colors flex items-center gap-2 cursor-pointer"
                            >
                                <Save size={14} /> {t('Save Provider')}
                            </button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isManageModelsOpen} onOpenChange={setIsManageModelsOpen}>
                <DialogContent className="w-[520px] max-w-[92vw] bg-bg-elevated border border-border-subtle p-6 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animated fadeIn text-xs text-text-primary opacity-100 ring-1 ring-border-subtle/50">
                    <div className="flex items-center justify-between mb-4 border-b border-border-subtle pb-3">
                        <div>
                            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                {t('Manage Selectable Models')}
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                                    {litellmEnabledModels.length === 0 || !litellmEnabledModels.includes('_none_')
                                        ? `${litellmEnabledModels.length === 0 ? litellmModels.length : litellmModels.filter(m => litellmEnabledModels.includes(m)).length} / ${litellmModels.length} Enabled`
                                        : `0 / ${litellmModels.length} Enabled`}
                                </span>
                            </h3>
                            <p className="text-[11px] text-text-secondary mt-0.5">{t('Select which models appear in your active model dropdowns.')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsManageModelsOpen(false)}
                            className="p-1.5 rounded-lg hover:bg-bg-input text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                        >
                            ✕
                        </button>
                </div>

                {isEditingCustom ? (
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle animated fadeIn">
                        <h4 className="text-sm font-bold text-text-primary mb-4">{editingProvider ? t('Edit Provider') : t('New Provider')}</h4>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">{t('Provider Name')}</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder={t("My Custom LLM")}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">{t('cURL Command')}</label>
                                <div className="relative">
                                    <textarea
                                        value={customCurl}
                                        onChange={(e) => setCustomCurl(e.target.value)}
                                        placeholder={`curl https://api.openai.com/v1/chat/completions ... "content": "{{TEXT}}"`}
                                        className="w-full h-32 bg-bg-input border border-border-subtle rounded-lg p-4 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary transition-colors resize-none leading-relaxed"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">
                                    {t('Response JSON Path')} <span className="text-text-tertiary normal-case font-normal">{t('(Optional)')}</span>
                                </label>
                                <input
                                    type="text"
                                    value={customResponsePath}
                                    onChange={(e) => setCustomResponsePath(e.target.value)}
                                    placeholder={t("e.g. choices[0].message.content")}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">
                                    {t('Dot notation path to the answer text in the JSON response. If empty, the full JSON is returned.')}
                                </p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">
                                    {t('Screenshot / Vision Support')}
                                </label>
                                <select
                                    value={customVision}
                                    onChange={(e) => setCustomVision(e.target.value as 'auto' | 'on' | 'off')}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                >
                                    <option value="auto">{t('Auto-detect (recommended)')}</option>
                                    <option value="on">{t('Always send screenshots')}</option>
                                    <option value="off">{t('Never send screenshots (text only)')}</option>
                                </select>
                                <p className="text-[10px] text-text-secondary mt-1">
                                    {t('Auto-detect enables vision when your cURL uses')} <code className="font-mono">{"{{IMAGE_BASE64}}"}</code> {t('or an OpenAI-style')} <code className="font-mono">messages</code> {t('body. Choose “Always” only if your endpoint accepts images another way; “Never” keeps this provider out of screenshot analysis.')}
                                </p>
                            </div>

                            <div className="bg-bg-elevated/30 rounded-lg overflow-hidden border border-border-subtle mt-4">
                                <div className="px-4 py-3 bg-bg-elevated/50 border-b border-border-subtle flex items-center justify-between">
                                    <h5 className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                        {t('Configuration Guide')}
                                    </h5>
                                </div>

                                <div className="p-4 space-y-4">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">{t('Available Variables')}</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{TEXT}}"}</code>
                                                <span className="text-text-tertiary">{t('Combined System + Context + Message (Recommended)')}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{IMAGE_BASE64}}"}</code>
                                                <span className="text-text-tertiary">{t('Screenshot data (if available)')}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">{t('Examples')}</p>
                                        <div className="space-y-3">
                                            {/* Ollama Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">{t('Local (Ollama)')}</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto group relative">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        curl http://localhost:11434/api/generate -d '{"{"}"model": "llama3", "prompt": "{`{{TEXT}}`}"{"}"}'
                                                    </code>
                                                </div>
                                            </div>

                                            {/* OpenAI Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">{t('OpenAI Compatible')}</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        {`curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "{{TEXT}}"}
    ],
    "temperature": 0.7
  }'`}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {curlError && (
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                    <span>{curlError}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={() => setIsEditingCustom(false)}
                                    className="px-4 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                                >
                                    {t('Cancel')}
                                </button>
                                <button
                                    onClick={handleSaveCustom}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-legacy-action-bg text-legacy-action-fg hover:bg-legacy-action-hover transition-colors flex items-center gap-2"
                                >
                                    <Save size={14} /> {t('Save Provider')}
                                </button>
                            </div>
                        </div>
>>>>>>> origin/main
                    </div>

                    {/* Search & Refresh Actions */}
                    <div className="flex gap-2 mb-3 shrink-0">
                        <input
                            type="text"
                            placeholder={t('Search models...')}
                            value={litellmSearchQuery}
                            onChange={(e) => setLitellmSearchQuery(e.target.value)}
                            className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary font-mono"
                        />
                        <button
                            type="button"
                            onClick={handleRefreshLiteLLM}
                            disabled={isRefreshingLiteLLM}
                            className="px-3.5 py-2 bg-accent-primary hover:bg-accent-primary-hover text-white rounded-lg font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                        >
                            <RefreshCw size={13} className={isRefreshingLiteLLM ? 'animate-spin' : ''} />
                            {isRefreshingLiteLLM ? t('Refreshing...') : t('Refresh Discovery')}
                        </button>
                    </div>

                    {/* Quick Selection Buttons & Counter */}
                    <div className="flex items-center justify-between mb-3 shrink-0">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setLitellmEnabledModels([]);
                                    window.electronAPI?.setLitellmEnabledModels?.([]);
                                }}
                                className="px-2.5 py-1 bg-bg-input hover:bg-bg-item-surface border border-border-subtle rounded-md text-[11px] font-medium text-text-primary transition-colors cursor-pointer"
                            >
                                {t('Enable All')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setLitellmEnabledModels(['_none_']);
                                    window.electronAPI?.setLitellmEnabledModels?.(['_none_']);
                                }}
                                className="px-2.5 py-1 bg-bg-input hover:bg-bg-item-surface border border-border-subtle rounded-md text-[11px] font-medium text-text-primary transition-colors cursor-pointer"
                            >
                                {t('Disable All')}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setLitellmShowSelectedOnly(!litellmShowSelectedOnly)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                                litellmShowSelectedOnly
                                    ? 'bg-accent-primary/20 border-accent-primary/50 text-accent-primary font-bold'
                                    : 'bg-bg-input hover:bg-bg-item-surface border-border-subtle text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            <Filter size={11} />
                            {litellmShowSelectedOnly ? t('Selected Only') : t('Show All')}
                        </button>
                    </div>

                    {/* Scrollable Model List */}
                    <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[360px] border border-border-subtle rounded-xl bg-bg-input p-2 space-y-1.5">
                        {litellmModels
                            .filter(model => {
                                const isEnabled = litellmEnabledModels.length === 0 || (litellmEnabledModels.includes(model) && !litellmEnabledModels.includes('_none_'));
                                if (litellmShowSelectedOnly && !isEnabled) return false;
                                return model.toLowerCase().includes(litellmSearchQuery.toLowerCase());
                            })
                            .map((model) => {
                                const isEnabled = litellmEnabledModels.length === 0 || (litellmEnabledModels.includes(model) && !litellmEnabledModels.includes('_none_'));
                                const testStatus = litellmModelTestStatus[model] || 'idle';
                                const testError = litellmModelTestError[model] || '';

                                return (
                                    <div
                                        key={model}
                                        onClick={() => handleToggleLiteLLMModel(model, !isEnabled)}
                                        className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors duration-150 cursor-pointer ${
                                            isEnabled
                                                ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-900 dark:text-emerald-300'
                                                : 'bg-bg-item-surface dark:bg-zinc-900/60 border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-700/60 dark:hover:bg-zinc-800/80'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className={`w-4 h-4 rounded border transition-colors flex items-center justify-center shrink-0 ${
                                                isEnabled
                                                    ? 'bg-emerald-500 border-emerald-400 text-white'
                                                    : 'bg-bg-input border-zinc-400 dark:border-zinc-500 text-transparent hover:border-zinc-500 dark:hover:border-zinc-400'
                                            }`}>
                                                <Check size={11} strokeWidth={3} />
                                            </div>
                                            <span className="font-mono text-xs text-text-primary truncate" title={model}>
                                                {model}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3 shrink-0 pl-3" onClick={(e) => e.stopPropagation()}>
                                            {testStatus === 'error' && (
                                                <span className="text-[10px] text-red-400 font-medium max-w-[120px] truncate" title={testError}>
                                                    {testError}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleTestLiteLLMModelConnection(model)}
                                                disabled={testStatus === 'testing'}
                                                className={`px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                                                    testStatus === 'success'
                                                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                                                        : testStatus === 'error'
                                                        ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                                        : 'bg-bg-input hover:bg-bg-item-surface border-border-subtle text-text-primary'
                                                }`}
                                            >
                                                {testStatus === 'testing' ? t('Testing...') : testStatus === 'success' ? t('Connected') : t('Test')}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        {litellmModels.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-10 text-text-tertiary text-[11px] italic gap-1">
                                <span>{t('No models discovered.')}</span>
                                <span>{t('Click "Refresh Discovery" or check your Base URL settings.')}</span>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
            {/* Screen Understanding — vision-first routing */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">{t('Screen understanding')}</h3>
                    <p className="text-xs text-text-secondary mb-2">{t('Pick how Natively reads what is on your screen. All paths use the vision-capable AI provider directly; OCR is no longer used.')}</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        {
                            value: 'vision_first' as const,
                            label: t('Vision first'),
                            description: t('Recommended. Try every configured vision provider in order; first success wins.'),
                        },
                        {
                            value: 'vision_only' as const,
                            label: t('Vision only'),
                            description: t('Stricter. Require a vision-capable provider; never silently drop the screenshot.'),
                        },
                        {
                            value: 'private_vision' as const,
                            label: t('Private vision (local only)'),
                            description: t('Use a local vision model (Ollama) only. Never call cloud vision. Clear error if no local provider is configured.'),
                        },
                    ]).map(({ value, label, description }) => {
                        const selected = screenUnderstandingMode === value;
                        return (
                            <div
                                key={value}
                                onClick={() => {
                                    setScreenUnderstandingMode(value);
                                    window.electronAPI?.setScreenUnderstandingMode?.(value);
                                }}
                                className={`px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-accent-primary bg-accent-subtle' : 'border-border-subtle hover:border-border-muted bg-bg-elevated/50'}`}
                                role="radio"
                                aria-checked={selected}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex flex-col">
                                        <span className={`text-xs font-semibold ${selected ? 'text-accent-primary' : 'text-text-primary'}`}>{label}</span>
                                        <span className="text-[11px] text-text-secondary leading-snug mt-0.5">{description}</span>
                                    </div>
                                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${selected ? 'border-accent-primary bg-accent-primary' : 'border-border-muted'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-border-subtle">
                        <div className="flex flex-col">
                            <span className="text-xs text-text-primary font-semibold">{t('Technical interview direct vision')}</span>
                            <span className="text-[11px] text-text-secondary leading-snug mt-0.5">{t('Use the highest-resolution image profile so code text stays sharp in interview mode.')}</span>
                        </div>
                        <div
                            onClick={() => {
                                const next = !technicalInterviewVisionFirst;
                                setTechnicalInterviewVisionFirst(next);
                                const api: any = window.electronAPI;
                                if (api?.setTechnicalInterviewVisionFirst) {
                                    api.setTechnicalInterviewVisionFirst(next);
                                } else {
                                    window.electronAPI?.setTechnicalInterviewDirectVision?.(next);
                                }
                            }}
                            className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer shrink-0 ${technicalInterviewVisionFirst ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                            role="switch"
                            aria-checked={technicalInterviewVisionFirst}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${technicalInterviewVisionFirst ? 'translate-x-4' : 'translate-x-0'}`} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Cloud Provider Data Scopes — fail-closed cloud share controls */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">{t('Cloud provider data scopes')}</h3>
                    <p className="text-xs text-text-secondary mb-2">{t('Control what data cloud AI providers can access. Disabled types are handled locally for privacy.')}</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        { key: 'transcript', label: t('Transcripts') },
                        { key: 'screenshots', label: t('Screenshots') },
                        { key: 'reference_files', label: t('Reference files') },
                        { key: 'profile_history', label: t('Profile history') },
                        { key: 'embeddings', label: t('Cloud embeddings') },
                        { key: 'post_call_summary', label: t('Post-call summaries') },
                    ] as const).map(({ key, label }) => {
                        const allowed = providerDataScopes[key] !== false;
                        return (
                            <div key={key} className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">{label}</span>
                                <div
                                    onClick={() => {
                                        const next = { ...providerDataScopes, [key]: !allowed };
                                        setProviderDataScopes(next);
                                        window.electronAPI?.setProviderDataScopes?.(next);
                                    }}
                                    className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${allowed ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch"
                                    aria-checked={allowed}
                                    aria-label={`${t('Allow')} ${label} ${t('to cloud providers')}`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-start gap-2 mt-1 pt-3 border-t border-border-subtle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        <p className="text-[11px] text-text-tertiary leading-relaxed">{t('When a data type is disabled, Natively falls back to the best available local model to keep that data on-device.')}</p>
                    </div>
                </div>
            </div>
            </div>
>>>>>>> origin/main
        </div>
    );
};
