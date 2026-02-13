import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';

// Define Model Types
interface ModelOption {
    id: string;
    name: string;
    type: 'cloud' | 'local' | 'custom' | 'ollama';
    provider?: string;
}



const ModelSelectorWindow = () => {
    const [currentModel, setCurrentModel] = useState<string>('');
    const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
        try {
            const cached = localStorage.getItem('cached-models');
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => availableModels.length === 0);





    // Load Data
    useEffect(() => {
        const loadModels = async () => {
            setIsLoading(true);
            try {
                // 1. Get Stored Credentials (to know which Cloud providers are active)
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();

                // 2. Get Custom Providers
                // @ts-ignore
                const customProviders = await window.electronAPI?.invoke('get-custom-providers') || [];

                // 3. Get Ollama Models (if any available/checked previously)
                // We won't trigger a fresh check here to avoid startup delay, just check if we have any cached?
                // Actually, let's just ask for available ones. If none, user has to go to settings to refresh.
                // Or maybe we do a quick check if they have used it before?
                // Let's rely on what the backend might know or just skip for now if not easy.
                // The implementation plan said "unified list of connected models".
                // Let's invoke 'get-available-ollama-models' - active check?
                // It's fast if Ollama server is running.
                let ollamaModels: string[] = [];
                try {
                    // @ts-ignore
                    let oModels = await window.electronAPI?.invoke('get-available-ollama-models');

                    // If no models found, try to fix/restart Ollama (server might be down)
                    if (!oModels || oModels.length === 0) {
                        try {
                            // @ts-ignore
                            await window.electronAPI?.invoke('force-restart-ollama');
                            // Wait a moment for server to come up
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            // Retry fetch
                            // @ts-ignore
                            oModels = await window.electronAPI?.invoke('get-available-ollama-models');
                        } catch (e) {
                            console.warn("Retrying Ollama failed", e);
                        }
                    }

                    if (oModels) ollamaModels = oModels;
                } catch (e) {
                    // Ignore ollama errors here
                }

                // Build the list
                const models: ModelOption[] = [];

                // Cloud Models (only if key exists)
                if (creds?.hasGeminiKey) {
                    models.push({ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', type: 'cloud', provider: 'gemini' });
                    models.push({ id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'cloud', provider: 'gemini' });
                }
                if (creds?.hasOpenaiKey) {
                    models.push({ id: 'gpt-5.2-chat-latest', name: 'GPT 5.2', type: 'cloud', provider: 'openai' });
                }
                if (creds?.hasClaudeKey) {
                    models.push({ id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', type: 'cloud', provider: 'claude' });
                }
                if (creds?.hasGroqKey) {
                    models.push({ id: 'llama-3.3-70b-versatile', name: 'Groq Llama 3.3', type: 'cloud', provider: 'groq' });
                }

                // Custom Providers
                customProviders.forEach((p: any) => {
                    models.push({ id: p.id, name: p.name, type: 'custom' });
                });

                // Ollama
                ollamaModels.forEach((m: string) => {
                    models.push({ id: `ollama-${m}`, name: `${m} (Local)`, type: 'ollama' });
                });

                localStorage.setItem('cached-models', JSON.stringify(models));
                setAvailableModels(models);

                // 4. Get Current Active Model
                // @ts-ignore
                const config = await window.electronAPI?.invoke('get-current-llm-config'); // Get runtime model
                if (config && config.model) {
                    setCurrentModel(config.model);
                }

            } catch (err) {
                console.error("Failed to load models:", err);
            } finally {
                setIsLoading(false);
            }
        };

        loadModels();

        // Listen for changes
        // @ts-ignore
        const unsubscribe = window.electronAPI?.onModelChanged?.((modelId: string) => {
            setCurrentModel(modelId);
        });
        return () => unsubscribe?.();
    }, []);

    const handleSelectFn = (modelId: string) => {
        setCurrentModel(modelId);
        // @ts-ignore - this will set model + close window
        window.electronAPI?.invoke('set-model', modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div className="w-[140px] h-[200px] bg-[#1E1E1E]/80 backdrop-blur-md border border-white/10 rounded-[16px] overflow-hidden shadow-2xl shadow-black/40 p-2 flex flex-col animate-scale-in origin-top-left">

                {isLoading ? (
                    <div className="flex items-center justify-center py-4 text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-xs">Loading models...</span>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-0.5">
                        {availableModels.length === 0 ? (
                            <div className="px-4 py-3 text-center text-xs text-slate-500">
                                No models connected.<br />Check Settings.
                            </div>
                        ) : (
                            availableModels.map((model) => {
                                const isSelected = currentModel === model.id;
                                return (
                                    <button
                                        key={model.id}
                                        onClick={() => handleSelectFn(model.id)}
                                        className={`
                                            w-full text-left px-3 py-2 flex items-center justify-between group transition-colors duration-200 rounded-lg
                                            ${isSelected ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}
                                        `}
                                    >
                                        <span className="text-[12px] font-medium truncate flex-1 min-w-0">{model.name}</span>
                                        {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />}
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}

            </div>
        </div >
    );
};

export default ModelSelectorWindow;
