import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { validateCurl } from '../../lib/curl-validator';

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string;
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
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model" }) => {
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

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-40 bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
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

export const AIProvidersSettings: React.FC = () => {
    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');

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
    const [curlError, setCurlError] = useState<string | null>(null);

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3-flash-preview');

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey
                    });
                }

                // @ts-ignore
                const custom = await window.electronAPI?.invoke('get-custom-providers');
                if (custom) {
                    setCustomProviders(custom);
                }

                // Load persisted default model
                // @ts-ignore
                const result = await window.electronAPI?.invoke('get-default-model');
                if (result && result.model) {
                    setDefaultModel(result.model);
                }

                // Check Ollama
                checkOllama();

            } catch (e) {
                console.error("Failed to load settings:", e);
            }
        };
        loadCredentials();
    }, []);

    const checkOllama = async (isInitial = true) => {
        if (isInitial) setOllamaStatus('checking');
        try {
            // @ts-ignore
            const models = await window.electronAPI?.invoke('get-available-ollama-models');
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else {
                if (isInitial && !ollamaRestarted) {
                    handleFixOllama();
                } else {
                    setOllamaStatus('not-found');
                }
            }
        } catch (e) {
            console.warn("Ollama check failed:", e);
            if (isInitial && !ollamaRestarted) {
                handleFixOllama();
            } else {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke('force-restart-ollama');
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
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleNewProvider = () => {
        setEditingProvider(null);
        setCustomName('');
        setCustomCurl('');
        setCustomResponsePath('');
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
            responsePath: customResponsePath
        };

        try {
            // @ts-ignore
            const result = await window.electronAPI.invoke('save-custom-provider', newProvider);
            if (result.success) {
                // Refresh list
                // @ts-ignore
                const updated = await window.electronAPI.invoke('get-custom-providers');
                setCustomProviders(updated);
                setIsEditingCustom(false);
            } else {
                setCurlError(result.error);
            }
        } catch (e: any) {
            setCurlError(e.message);
        }
    };

    const handleDeleteCustom = async (id: string) => {
        if (!confirm("Are you sure you want to delete this provider?")) return;
        try {
            // @ts-ignore
            const result = await window.electronAPI.invoke('delete-custom-provider', id);
            if (result.success) {
                // @ts-ignore
                const updated = await window.electronAPI.invoke('get-custom-providers');
                setCustomProviders(updated);
            }
        } catch (e) {
            console.error("Failed to delete provider:", e);
        }
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Default Model for Chat</h3>
                    <p className="text-xs text-text-secondary mb-2">Primary model for new chats. Other configured models act as fallbacks.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Active Model</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={[
                            ...(hasStoredKey.gemini ? [{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' }, { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' }] : []),
                            ...(hasStoredKey.openai ? [{ id: 'gpt-5.2-chat-latest', name: 'GPT 5.2' }] : []),
                            ...(hasStoredKey.claude ? [{ id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' }] : []),
                            ...(hasStoredKey.groq ? [{ id: 'llama-3.3-70b-versatile', name: 'Groq Llama 3.3' }] : []),
                            ...customProviders.map(p => ({ id: p.id, name: p.name })),
                            ...ollamaModels.map(m => ({ id: `ollama-${m}`, name: `${m} (Local)` }))
                        ]}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.invoke('set-default-model', val).catch(console.error);
                        }}
                    />
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
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <div className="mb-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                Gemini API Key
                                {hasStoredKey.gemini && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                            </label>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={hasStoredKey.gemini ? "••••••••••••" : "AIzaSy..."}
                                className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                            />
                            <button
                                onClick={() => handleSaveKey('gemini', apiKey, setApiKey)}
                                disabled={savingStatus.gemini || !apiKey.trim()}
                                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus.gemini
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                                    }`}
                            >
                                {savingStatus.gemini ? 'Saving...' : savedStatus.gemini ? 'Saved!' : 'Save'}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleTestConnection('gemini', apiKey)}
                                disabled={(!apiKey.trim() && !hasStoredKey.gemini) || testStatus.gemini === 'testing'}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 ${testStatus.gemini === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                    testStatus.gemini === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                        'bg-bg-input hover:bg-bg-elevated text-text-primary'
                                    }`}
                                title={testError.gemini || "Test Connection"}
                            >
                                {testStatus.gemini === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                                    testStatus.gemini === 'success' ? <><CheckCircle size={12} /> Connected</> :
                                        testStatus.gemini === 'error' ? <><AlertCircle size={12} /> Error</> :
                                            <>{/* No Icon */} Test Connection</>}
                            </button>
                            <button
                                onClick={() => openKeyUrl('gemini')}
                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                                title="Get API Key"
                            >
                                <ExternalLink size={12} />
                            </button>
                        </div>
                        {testError.gemini && <p className="text-[10px] text-red-400 mt-1.5">{testError.gemini}</p>}
                    </div>

                    {/* Groq */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <div className="mb-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                Groq API Key
                                {hasStoredKey.groq && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                            </label>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="password"
                                value={groqApiKey}
                                onChange={(e) => setGroqApiKey(e.target.value)}
                                placeholder={hasStoredKey.groq ? "••••••••••••" : "gsk_..."}
                                className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                            />
                            <button
                                onClick={() => handleSaveKey('groq', groqApiKey, setGroqApiKey)}
                                disabled={savingStatus.groq || !groqApiKey.trim()}
                                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus.groq
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                                    }`}
                            >
                                {savingStatus.groq ? 'Saving...' : savedStatus.groq ? 'Saved!' : 'Save'}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleTestConnection('groq', groqApiKey)}
                                disabled={(!groqApiKey.trim() && !hasStoredKey.groq) || testStatus.groq === 'testing'}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 ${testStatus.groq === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                    testStatus.groq === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                        'bg-bg-input hover:bg-bg-elevated text-text-primary'
                                    }`}
                                title={testError.groq || "Test Connection"}
                            >
                                {testStatus.groq === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                                    testStatus.groq === 'success' ? <><CheckCircle size={12} /> Connected</> :
                                        testStatus.groq === 'error' ? <><AlertCircle size={12} /> Error</> :
                                            <>{/* No Icon */} Test Connection</>}
                            </button>
                            <button
                                onClick={() => openKeyUrl('groq')}
                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                                title="Get API Key"
                            >
                                <ExternalLink size={12} />
                            </button>
                        </div>
                        {testError.groq && <p className="text-[10px] text-red-400 mt-1.5">{testError.groq}</p>}
                    </div>

                    {/* OpenAI */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <div className="mb-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                OpenAI API Key
                                {hasStoredKey.openai && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                            </label>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="password"
                                value={openaiApiKey}
                                onChange={(e) => setOpenaiApiKey(e.target.value)}
                                placeholder={hasStoredKey.openai ? "••••••••••••" : "sk-..."}
                                className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                            />
                            <button
                                onClick={() => handleSaveKey('openai', openaiApiKey, setOpenaiApiKey)}
                                disabled={savingStatus.openai || !openaiApiKey.trim()}
                                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus.openai
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                                    }`}
                            >
                                {savingStatus.openai ? 'Saving...' : savedStatus.openai ? 'Saved!' : 'Save'}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleTestConnection('openai', openaiApiKey)}
                                disabled={(!openaiApiKey.trim() && !hasStoredKey.openai) || testStatus.openai === 'testing'}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 ${testStatus.openai === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                    testStatus.openai === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                        'bg-bg-input hover:bg-bg-elevated text-text-primary'
                                    }`}
                                title={testError.openai || "Test Connection"}
                            >
                                {testStatus.openai === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                                    testStatus.openai === 'success' ? <><CheckCircle size={12} /> Connected</> :
                                        testStatus.openai === 'error' ? <><AlertCircle size={12} /> Error</> :
                                            <>{/* No Icon */} Test Connection</>}
                            </button>
                            <button
                                onClick={() => openKeyUrl('openai')}
                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                                title="Get API Key"
                            >
                                <ExternalLink size={12} />
                            </button>
                        </div>
                        {testError.openai && <p className="text-[10px] text-red-400 mt-1.5">{testError.openai}</p>}
                    </div>

                    {/* Claude */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <div className="mb-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                Claude API Key
                                {hasStoredKey.claude && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                            </label>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="password"
                                value={claudeApiKey}
                                onChange={(e) => setClaudeApiKey(e.target.value)}
                                placeholder={hasStoredKey.claude ? "••••••••••••" : "sk-ant-..."}
                                className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                            />
                            <button
                                onClick={() => handleSaveKey('claude', claudeApiKey, setClaudeApiKey)}
                                disabled={savingStatus.claude || !claudeApiKey.trim()}
                                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus.claude
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                                    }`}
                            >
                                {savingStatus.claude ? 'Saving...' : savedStatus.claude ? 'Saved!' : 'Save'}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleTestConnection('claude', claudeApiKey)}
                                disabled={(!claudeApiKey.trim() && !hasStoredKey.claude) || testStatus.claude === 'testing'}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 ${testStatus.claude === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                    testStatus.claude === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                        'bg-bg-input hover:bg-bg-elevated text-text-primary'
                                    }`}
                                title={testError.claude || "Test Connection"}
                            >
                                {testStatus.claude === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                                    testStatus.claude === 'success' ? <><CheckCircle size={12} /> Connected</> :
                                        testStatus.claude === 'error' ? <><AlertCircle size={12} /> Error</> :
                                            <>{/* No Icon */} Test Connection</>}
                            </button>
                            <button
                                onClick={() => openKeyUrl('claude')}
                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                                title="Get API Key"
                            >
                                <ExternalLink size={12} />
                            </button>
                        </div>
                        {testError.claude && <p className="text-[10px] text-red-400 mt-1.5">{testError.claude}</p>}
                    </div>

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
            </div>
        </div>
    );
};
