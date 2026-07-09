import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2, LogOut } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { ProviderCard } from './ProviderCard';

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
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model", className = "" }) => {
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

    const paddingClass = className.includes('py-') ? '' : 'py-1.5';

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-40 bg-bg-input border border-border-subtle rounded-lg px-3 ${paddingClass} ${className} text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors`}
                type="button"
            >
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : placeholder}</span>
                <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-full bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto animated fadeIn">
                    <div className="p-1 space-y-0.5">
                        {options.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${value === option.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                type="button"
                            >
                                <span className="truncate">{option.name}</span>
                                {value === option.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-500 italic">No models available</div>
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
}> = ({ label, value, placeholder, onChange, onSelect, onSave }) => (
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
                placeholder="Preset"
                className="py-2"
            />
        </div>
    </label>
);

export const AIProvidersSettings: React.FC = () => {
    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [deepseekApiKey, setDeepseekApiKey] = useState('');

    // --- LiteLLM proxy (OpenAI-compatible gateway: baseURL + optional virtual key) ---
    const [litellmBaseURL, setLitellmBaseURL] = useState('');
    const [litellmApiKey, setLitellmApiKey] = useState('');
    // Max output tokens for proxied models. '' = Auto: per-model budget from the
    // proxy's /model/info (standard registry value), falling back to 8192.
    const [litellmMaxTokens, setLitellmMaxTokens] = useState('');

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

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.5-flash');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    const canUseFastMode = !!(hasStoredKey.groq || hasStoredKey.natively || codexOauthStatus.signedIn);

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- Screen Understanding (vision routing) ---
    const [screenUnderstandingMode, setScreenUnderstandingMode] = useState<'vision_first' | 'vision_only' | 'private_vision'>('vision_first');
    const [technicalInterviewVisionFirst, setTechnicalInterviewVisionFirst] = useState<boolean>(true);

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }>({});

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                // Load credentials FIRST so canUseFastMode is correct before we set fastResponseMode.
                // If we set fastResponseMode before hasStoredKey is populated, the enforcement
                // effect below fires with canUseFastMode=false and immediately resets fast mode
                // to false — writing that reset back to SettingsManager on every startup.
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        deepseek: creds.hasDeepseekKey || false,
                        litellm: creds.hasLitellmBaseURL || false,
                        natively: creds.hasNativelyKey || false
                    });
                    // Prefill stored LiteLLM config so re-saving doesn't silently reset it.
                    // (baseURL is config, not a secret; the key stays masked/blank = keep.)
                    if (creds.litellmBaseURL) setLitellmBaseURL(creds.litellmBaseURL);
                    if (creds.litellmMaxTokens) setLitellmMaxTokens(String(creds.litellmMaxTokens));
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    if (creds.deepseekPreferredModel) pm.deepseek = creds.deepseekPreferredModel;
                    setPreferredModels(pm);
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

                // Mark credentials as fully loaded so the enforcement effect can fire
                setCredentialsLoaded(true);

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

            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true); // Unblock even on error
            }
        };
        loadCredentials();

        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            // @ts-ignore
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

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
                    setCodexAuthMessage(`Signed in to ChatGPT${info?.email ? ` as ${info.email}` : ''}.`);
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
                    setCodexAuthMessage(info?.message || 'Codex sign-in failed.');
                }));
            }
            if (api?.onCodexSignedOut) {
                unsubs.push(api.onCodexSignedOut(() => {
                    setCodexOauthStatus({ signedIn: false });
                    setCodexAuthStatus('idle');
                    setCodexAuthMessage('Signed out of ChatGPT.');
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
                setCodexCliError(result?.error || 'Codex CLI test failed');
            }
        } catch (e: any) {
            setCodexCliStatus('error');
            setCodexCliError(e.message || 'Codex CLI test failed');
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
                setCodexAuthMessage('Opening browser — complete sign-in there, then return here.');
                const result = await api.codexStartLogin();
                // The actual UI update happens via the onCodexLoginComplete
                // / onCodexLoginFailed events; this is the success/fail
                // path in case the events miss (e.g. the renderer reloaded
                // mid-flow).
                setCodexOauthInProgress(false);
                if (result?.success) {
                    setCodexAuthStatus('success');
                    setCodexAuthMessage(`Signed in to ChatGPT${result.email ? ` as ${result.email}` : ''}.`);
                    setCodexOauthStatus({ signedIn: true, email: result.email, expiresAt: result.expiresAt });
                } else {
                    setCodexAuthStatus('error');
                    setCodexAuthMessage(result?.error || 'Codex sign-in failed.');
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
        setCodexAuthMessage('Refreshing tokens…');
        try {
            const result = await api?.codexRefreshTokens?.();
            if (result?.success) {
                setCodexAuthStatus('success');
                setCodexAuthMessage('Tokens refreshed.');
                setCodexOauthStatus(prev => ({ ...prev, expiresAt: result.expiresAt, email: result.email || prev.email }));
            } else {
                setCodexAuthStatus('error');
                setCodexAuthMessage(result?.error || 'Refresh failed.');
            }
        } catch (e: any) {
            setCodexAuthStatus('error');
            setCodexAuthMessage(e?.message || 'Refresh failed.');
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
                setTimeout(() => setSavedStatus(prev => ({ ...prev, litellm: false })), 2000);
            }
        } catch (e) {
            console.error('Failed to save LiteLLM config:', e);
        } finally {
            setSavingStatus(prev => ({ ...prev, litellm: false }));
        }
    };

    const handleRemoveLitellm = async () => {
        if (!confirm('Are you sure you want to remove the LiteLLM proxy configuration?')) return;
        try {
            const result = await window.electronAPI.setLitellmConfig({ apiKey: '', baseURL: '' });
            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, litellm: false }));
                setLitellmBaseURL('');
                setLitellmApiKey('');
                setLitellmMaxTokens('');
            }
        } catch (e) {
            console.error('Failed to remove LiteLLM config:', e);
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        if (!confirm(`Are you sure you want to remove the ${provider} API key?`)) return;
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

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} key:`, e);
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
                setTestError(prev => ({ ...prev, [provider]: result.error || 'Connection failed' }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || 'Connection failed' }));
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
            setCurlError("Provider Name is required.");
            return;
        }

        const validation = validateCurl(customCurl);
        if (!validation.isValid) {
            setCurlError(validation.message || "Invalid cURL command.");
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
        if (!confirm("Are you sure you want to delete this provider?")) return;
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
                <h3 className="text-lg font-bold text-text-primary mb-1">AI Providers</h3>
                <p className="text-xs text-text-secondary mb-5">
                    Pick a default model and connect the cloud, local, or custom providers you want available.
                </p>
            </header>

            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Active Model</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: { id: string; name: string }[] = [];

                            if (hasStoredKey.natively) {
                                opts.push({ id: 'natively', name: 'Natively API' });
                            }

                            for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                                if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
                                cfg.ids.forEach((id, i) => opts.push({ id, name: cfg.names[i] }));
                                const pm = preferredModels[prov as keyof typeof preferredModels];
                                if (pm && !cfg.ids.includes(pm)) {
                                    opts.push({ id: pm, name: prettifyModelId(pm) });
                                }
                            }
                            if (codexOauthStatus.signedIn || codexCliConfig.enabled) {
                                opts.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${prettifyModelId(codexCliConfig.model)})` });
                                CODEX_CLI_MODEL_PRESETS.forEach(model => {
                                    const id = codexCliSelectorId(model.id);
                                    if (!opts.find(o => o.id === id)) {
                                        opts.push({ id, name: `${CODEX_CLI_MODEL.name}: ${model.name}` });
                                    }
                                });
                            }
                            customProviders.forEach(p => opts.push({ id: p.id, name: p.name }));
                            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)` }));

                            if (defaultModel && !opts.find(o => o.id === defaultModel)) {
                                opts.unshift({ id: defaultModel, name: prettifyModelId(defaultModel) });
                            }
                            return opts;
                        })()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>

                {/* Fast Response Mode */}
                <div
                    className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between gap-4 ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? "Requires Groq, Natively API, or Codex CLI to be configured" : ""}
                >
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Fast Response Mode</label>
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/20">NEW</span>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-0.5">Routes responses through the fastest available provider (Codex fast mode model, Groq, or Natively). Turn off to use your selected model above.</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] text-orange-500 mt-0.5 font-medium">Requires Groq, Natively API, or Codex CLI to be configured.</p>
                        )}
                    </div>
                    <div
                        onClick={async () => {
                            if (!canUseFastMode) {
                                alert("Please configure Groq, Natively API, or Codex CLI first to enable Fast Response Mode.");
                                return;
                            }
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('natively_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                        className={`shrink-0 w-11 h-6 rounded-full relative cursor-pointer transition-colors ${!canUseFastMode ? 'cursor-not-allowed bg-bg-toggle-switch' : fastResponseMode ? 'bg-orange-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${fastResponseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>
            </div>

            {/* Cloud Providers */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Cloud Providers</h3>
                    <p className="text-xs text-text-secondary mb-2">Add API keys to unlock cloud AI models.</p>
                </div>

                <div className="space-y-4">

                    {/* Gemini */}
                    <ProviderCard
                        providerId="gemini"
                        providerName="Gemini"
                        apiKey={apiKey}
                        preferredModel={preferredModels.gemini}
                        hasStoredKey={!!hasStoredKey.gemini}
                        onKeyChange={setApiKey}
                        onSaveKey={async () => { await handleSaveKey('gemini', apiKey, setApiKey); }}
                        onRemoveKey={() => handleRemoveKey('gemini', setApiKey)}
                        onTestConnection={() => handleTestConnection('gemini', apiKey)}
                        testStatus={testStatus.gemini || 'idle'}
                        testError={testError.gemini}
                        savingStatus={!!savingStatus.gemini}
                        savedStatus={!!savedStatus.gemini}
                        keyPlaceholder="AIzaSy..."
                        keyUrl="https://aistudio.google.com/app/apikey"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, gemini: model }))}
                    />

                    {/* Groq */}
                    <ProviderCard
                        providerId="groq"
                        providerName="Groq"
                        apiKey={groqApiKey}
                        preferredModel={preferredModels.groq}
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
                    />

                    {/* OpenAI */}
                    <ProviderCard
                        providerId="openai"
                        providerName="OpenAI"
                        apiKey={openaiApiKey}
                        preferredModel={preferredModels.openai}
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
                    />

                    {/* Claude */}
                    <ProviderCard
                        providerId="claude"
                        providerName="Claude"
                        apiKey={claudeApiKey}
                        preferredModel={preferredModels.claude}
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
                    />

                    {/* DeepSeek — text-only; intentionally not part of the screenshot/vision fallback chain. */}
                    <ProviderCard
                        providerId="deepseek"
                        providerName="DeepSeek"
                        apiKey={deepseekApiKey}
                        preferredModel={preferredModels.deepseek}
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
                    />

                    {/* LiteLLM — OpenAI-compatible AI gateway (100+ providers via one proxy).
                        Three fields: proxy base URL (required), optional virtual key, and an
                        optional max-output-tokens override. Models are auto-discovered from
                        the proxy and appear in the model selector with a "litellm/" prefix. */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <label className="block text-xs font-bold text-text-primary mb-0">LiteLLM Proxy</label>
                                <p className="text-[10px] text-text-secondary">
                                    OpenAI-compatible gateway to 100+ providers. Models auto-discovered from the proxy.{' '}
                                    <a href="https://docs.litellm.ai/docs/simple_proxy" target="_blank" rel="noreferrer" className="text-accent-primary hover:underline">Docs</a>
                                </p>
                            </div>
                            {hasStoredKey.litellm && (
                                <span className="text-[10px] font-medium text-emerald-500 uppercase tracking-wide">Configured</span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="space-y-1 block">
                                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Proxy Base URL</span>
                                <input
                                    value={litellmBaseURL}
                                    onChange={e => setLitellmBaseURL(e.target.value)}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                    placeholder="http://localhost:4000/v1"
                                />
                            </label>

                            <label className="space-y-1 block">
                                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Virtual Key (optional)</span>
                                <input
                                    type="password"
                                    value={litellmApiKey}
                                    onChange={e => setLitellmApiKey(e.target.value)}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                    placeholder={hasStoredKey.litellm ? '•••••••• (leave blank to keep)' : 'sk-... (only if proxy requires auth)'}
                                />
                            </label>
                        </div>

                        <div className="space-y-1">
                            <span className="block text-[10px] font-medium text-text-secondary uppercase tracking-wide">Max Output Tokens</span>
                            <ModelSelect
                                value={litellmMaxTokens}
                                options={LITELLM_MAX_TOKENS_OPTIONS}
                                onChange={setLitellmMaxTokens}
                                placeholder="Auto (per-model)"
                                className="py-2"
                            />
                            <p className="text-[10px] text-text-secondary">
                                Auto reads each model's real output budget from the proxy's <span className="font-mono">/model/info</span> (falls back to 8,192 if unavailable). Pick a fixed value to override.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSaveLitellm}
                                disabled={!litellmBaseURL.trim() || !!savingStatus.litellm}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-primary text-white disabled:opacity-50 transition-opacity"
                            >
                                {savingStatus.litellm ? 'Saving…' : savedStatus.litellm ? 'Saved ✓' : 'Save'}
                            </button>
                            {hasStoredKey.litellm && (
                                <button
                                    type="button"
                                    onClick={handleRemoveLitellm}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* Codex — ChatGPT subscription proxy */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">ChatGPT (Codex)</h3>
                    <p className="text-xs text-text-secondary">Use your ChatGPT Plus/Pro subscription as an AI provider — no API key needed.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                    {/* Header row: title + sign-in state + actions — mirrors ProviderCard */}
                    <div className="flex items-center justify-between mb-2">
                        <label className="flex items-center text-xs font-medium text-text-primary uppercase tracking-wide">
                            ChatGPT Account
                            {codexOauthStatus.signedIn && (
                                <span className="ml-2 text-green-500 normal-case">✓ Connected</span>
                            )}
                        </label>
                        {codexOauthStatus.signedIn ? (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleCodexRefresh}
                                    disabled={codexOauthInProgress}
                                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors disabled:opacity-60"
                                    title="Refresh session"
                                >
                                    <RefreshCw size={12} />
                                    <span className="text-[10px] uppercase tracking-wide">Refresh</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCodexSignOut}
                                    disabled={codexOauthInProgress}
                                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors disabled:opacity-60"
                                >
                                    <LogOut size={12} />
                                    <span className="text-[10px] uppercase tracking-wide">Sign out</span>
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Sign-in area or signed-in account display */}
                    {codexOauthStatus.signedIn ? (
                        <div className="flex gap-2 mb-3">
                            <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                <span>{codexOauthStatus.email || 'ChatGPT account connected'}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-2 mb-3">
                            <button
                                type="button"
                                onClick={() => handleCodexAuthAction('login')}
                                disabled={codexOauthInProgress || codexAuthAction !== 'idle'}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                            >
                                {codexOauthInProgress || codexAuthAction === 'login'
                                    ? <><Loader2 size={13} className="animate-spin" /> Waiting for browser…</>
                                    : <><ExternalLink size={13} /> Sign in with ChatGPT</>}
                            </button>
                        </div>
                    )}

                    {codexAuthMessage && (
                        <p className={`text-[10px] mt-1.5 mb-2 ${codexAuthStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                            {codexAuthMessage}
                        </p>
                    )}

                    {/* Model + settings — only shown once signed in */}
                    {codexOauthStatus.signedIn && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <CodexCliModelField
                                    label="Model"
                                    value={codexCliConfig.model}
                                    placeholder="gpt-5.5"
                                    onChange={(model) => setCodexCliConfig(prev => ({ ...prev, model }))}
                                    onSelect={(model) => saveCodexCliConfig({ ...codexCliConfig, model })}
                                    onSave={() => saveCodexCliConfig()}
                                />
                                <CodexCliModelField
                                    label="Fast Mode Model"
                                    value={codexCliConfig.fastModel}
                                    placeholder="gpt-5.3-codex"
                                    onChange={(fastModel) => setCodexCliConfig(prev => ({ ...prev, fastModel }))}
                                    onSelect={(fastModel) => saveCodexCliConfig({ ...codexCliConfig, fastModel })}
                                    onSave={() => saveCodexCliConfig()}
                                />
                                <label className="space-y-1">
                                    <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Reasoning Effort</span>
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
                                                { id: '', name: 'None (default)' },
                                                ...CODEX_MODEL_REASONING_EFFORTS
                                                    .filter(e => e !== 'none' && valid.includes(e))
                                                    .map(e => ({ id: e, name: e.charAt(0).toUpperCase() + e.slice(1) })),
                                            ];
                                        })()}
                                        onChange={(effort) => saveCodexCliConfig({ ...codexCliConfig, modelReasoningEffort: effort || undefined })}
                                        placeholder="None (default)"
                                        className="py-2"
                                    />
                                    {(() => {
                                        const valid = getValidCodexReasoningEfforts(codexCliConfig.model);
                                        const saved = codexCliConfig.modelReasoningEffort;
                                        if (saved && !valid.includes(saved)) {
                                            return (
                                                <p className="text-[9px] text-amber-400 flex items-center gap-1">
                                                    <AlertCircle size={10} />
                                                    '{saved}' unsupported by this model — will default to 'low'.
                                                </p>
                                            );
                                        }
                                        return null;
                                    })()}
                                </label>
                                <label className="space-y-1">
                                    <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Service Tier</span>
                                    <ModelSelect
                                        value={codexCliConfig.serviceTier ?? 'default'}
                                        options={CODEX_SERVICE_TIERS.map(t => ({ id: t, name: t.charAt(0).toUpperCase() + t.slice(1) }))}
                                        onChange={(serviceTier) => saveCodexCliConfig({ ...codexCliConfig, serviceTier: serviceTier as typeof CODEX_SERVICE_TIERS[number] })}
                                        placeholder="Default"
                                        className="py-2"
                                    />
                                </label>
                            </div>
                            <div className="flex items-end justify-between gap-4 mt-1">
                                <label className="space-y-1">
                                    <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Timeout (ms)</span>
                                    <input
                                        type="number"
                                        value={codexCliConfig.timeoutMs}
                                        onChange={e => setCodexCliConfig(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                                        onBlur={() => saveCodexCliConfig()}
                                        className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                        min={1000}
                                    />
                                    {codexCliStatus === 'error' && codexCliError && (
                                        <p className="text-[10px] text-red-400 mt-1">{codexCliError}</p>
                                    )}
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
                                        <><Loader2 size={12} className="animate-spin" /> Testing…</>
                                    ) : codexCliStatus === 'success' ? (
                                        <><CheckCircle size={12} /> Connected</>
                                    ) : codexCliStatus === 'error' ? (
                                        <><AlertCircle size={12} /> Failed</>
                                    ) : (
                                        'Test Connection'
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Local (Ollama) Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-1">Local Models (Ollama)</h3>
                        <p className="text-xs text-text-secondary">Run open-source models locally.</p>
                    </div>
                    <button
                        onClick={async () => {
                            setIsRefreshingOllama(true);
                            await checkOllama(false);
                            // Add a small delay for visual feedback if the check is too fast
                            setTimeout(() => setIsRefreshingOllama(false), 500);
                        }}
                        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                        title="Refresh Ollama"
                        disabled={isRefreshingOllama}
                    >
                        <RefreshCw size={18} className={isRefreshingOllama ? "animate-spin" : ""} />
                    </button>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                    {ollamaStatus === 'checking' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">⏳</span> Checking for Ollama...
                        </div>
                    )}

                    {ollamaStatus === 'fixing' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">🔧</span> Attempting to auto-fix connection...
                        </div>
                    )}

                    {ollamaStatus === 'not-found' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-xs text-red-400">
                                <AlertCircle size={14} />
                                <span>Ollama not detected</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-text-secondary">
                                    Ensure Ollama is running (`ollama serve`).
                                </p>
                                <button
                                    onClick={handleFixOllama}
                                    className="text-[10px] bg-bg-elevated hover:bg-bg-input px-2 py-1 rounded border border-border-subtle"
                                >
                                    Auto-Fix Connection
                                </button>
                            </div>
                        </div>
                    )}

                    {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs text-green-400 mb-3">
                                <CheckCircle size={14} />
                                <span>Ollama connected</span>
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
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="text-xs text-text-secondary">
                            Ollama is running but no models found. Run `ollama pull llama3` to get started.
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold text-text-primary">Custom Providers</h3>
                            <span className="px-1.5 py-0 rounded-full text-[7px] font-bold bg-yellow-500/10 text-yellow-500 uppercase tracking-widest border border-yellow-500/20 leading-loose mt-0.5">Experimental</span>
                        </div>
                        <p className="text-xs text-text-secondary">Add your own AI endpoints via cURL.</p>
                    </div>
                    {!isEditingCustom && (
                        <button
                            onClick={handleNewProvider}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors"
                        >
                            <Plus size={14} /> Add Provider
                        </button>
                    )}
                </div>

                {isEditingCustom ? (
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle animated fadeIn">
                        <h4 className="text-sm font-bold text-text-primary mb-4">{editingProvider ? 'Edit Provider' : 'New Provider'}</h4>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">Provider Name</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder="My Custom LLM"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">cURL Command</label>
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
                                    Response JSON Path <span className="text-text-tertiary normal-case font-normal">(Optional)</span>
                                </label>
                                <input
                                    type="text"
                                    value={customResponsePath}
                                    onChange={(e) => setCustomResponsePath(e.target.value)}
                                    placeholder="e.g. choices[0].message.content"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">
                                    Dot notation path to the answer text in the JSON response. If empty, the full JSON is returned.
                                </p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">
                                    Screenshot / Vision Support
                                </label>
                                <select
                                    value={customVision}
                                    onChange={(e) => setCustomVision(e.target.value as 'auto' | 'on' | 'off')}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                >
                                    <option value="auto">Auto-detect (recommended)</option>
                                    <option value="on">Always send screenshots</option>
                                    <option value="off">Never send screenshots (text only)</option>
                                </select>
                                <p className="text-[10px] text-text-secondary mt-1">
                                    Auto-detect enables vision when your cURL uses <code className="font-mono">{"{{IMAGE_BASE64}}"}</code> or an OpenAI-style <code className="font-mono">messages</code> body. Choose “Always” only if your endpoint accepts images another way; “Never” keeps this provider out of screenshot analysis.
                                </p>
                            </div>

                            <div className="bg-bg-elevated/30 rounded-lg overflow-hidden border border-border-subtle mt-4">
                                <div className="px-4 py-3 bg-bg-elevated/50 border-b border-border-subtle flex items-center justify-between">
                                    <h5 className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                        Configuration Guide
                                    </h5>
                                </div>

                                <div className="p-4 space-y-4">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">Available Variables</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{TEXT}}"}</code>
                                                <span className="text-text-tertiary">Combined System + Context + Message (Recommended)</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{IMAGE_BASE64}}"}</code>
                                                <span className="text-text-tertiary">Screenshot data (if available)</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">Examples</p>
                                        <div className="space-y-3">
                                            {/* Ollama Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">Local (Ollama)</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto group relative">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        curl http://localhost:11434/api/generate -d '{"{"}"model": "llama3", "prompt": "{`{{TEXT}}`}"{"}"}'
                                                    </code>
                                                </div>
                                            </div>

                                            {/* OpenAI Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">OpenAI Compatible</div>
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
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveCustom}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-primary text-white hover:bg-accent-secondary transition-colors flex items-center gap-2"
                                >
                                    <Save size={14} /> Save Provider
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {customProviders.length === 0 ? (
                            <div className="text-center py-8 bg-bg-item-surface rounded-xl border border-border-subtle border-dashed">
                                <p className="text-xs text-text-tertiary">No custom providers added yet.</p>
                            </div>
                        ) : (
                            customProviders.map((provider) => (
                                <div key={provider.id} className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-bg-input flex items-center justify-center text-text-secondary font-mono text-xs font-bold">
                                            {provider.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-text-primary">{provider.name}</h4>
                                            <p className="text-[10px] text-text-tertiary font-mono truncate max-w-[200px] opacity-60">
                                                {provider.curlCommand.substring(0, 30)}...
                                            </p>
                                            {provider.responsePath && (
                                                <p className="text-[9px] text-text-tertiary font-mono opacity-40 mt-0.5">
                                                    path: {provider.responsePath}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditProvider(provider)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                                            title="Edit"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustom(provider.id)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                            title="Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

            {/* Screen Understanding — vision-first routing */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Screen understanding</h3>
                    <p className="text-xs text-text-secondary mb-2">Pick how Natively reads what is on your screen. All paths use the vision-capable AI provider directly; OCR is no longer used.</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        {
                            value: 'vision_first' as const,
                            label: 'Vision first',
                            description: 'Recommended. Try every configured vision provider in order; first success wins.',
                        },
                        {
                            value: 'vision_only' as const,
                            label: 'Vision only',
                            description: 'Stricter. Require a vision-capable provider; never silently drop the screenshot.',
                        },
                        {
                            value: 'private_vision' as const,
                            label: 'Private vision (local only)',
                            description: 'Use a local vision model (Ollama) only. Never call cloud vision. Clear error if no local provider is configured.',
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
                                className={`px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border-subtle hover:border-border-muted bg-bg-elevated/50'}`}
                                role="radio"
                                aria-checked={selected}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex flex-col">
                                        <span className={`text-xs font-semibold ${selected ? 'text-emerald-300' : 'text-text-primary'}`}>{label}</span>
                                        <span className="text-[11px] text-text-secondary leading-snug mt-0.5">{description}</span>
                                    </div>
                                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${selected ? 'border-emerald-400 bg-emerald-400' : 'border-border-muted'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-border-subtle">
                        <div className="flex flex-col">
                            <span className="text-xs text-text-primary font-semibold">Technical interview direct vision</span>
                            <span className="text-[11px] text-text-secondary leading-snug mt-0.5">Use the highest-resolution image profile so code text stays sharp in interview mode.</span>
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
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Cloud provider data scopes</h3>
                    <p className="text-xs text-text-secondary mb-2">Control what data cloud AI providers can access. Disabled types are handled locally for privacy.</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        { key: 'transcript', label: 'Transcripts' },
                        { key: 'screenshots', label: 'Screenshots' },
                        { key: 'reference_files', label: 'Reference files' },
                        { key: 'profile_history', label: 'Profile history' },
                        { key: 'embeddings', label: 'Cloud embeddings' },
                        { key: 'post_call_summary', label: 'Post-call summaries' },
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
                                    className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${allowed ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch"
                                    aria-checked={allowed}
                                    aria-label={`Allow ${label} to cloud providers`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-start gap-2 mt-1 pt-3 border-t border-border-subtle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        <p className="text-[11px] text-text-tertiary leading-relaxed">When a data type is disabled, Natively falls back to the best available local model to keep that data on-device.</p>
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
};
