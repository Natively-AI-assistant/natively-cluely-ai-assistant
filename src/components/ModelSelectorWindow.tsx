import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, getCodexCliModelDisplayName, STANDARD_CLOUD_MODELS, prettifyModelId } from '../utils/modelUtils';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import {
    clampOverlayOpacity,
    getDefaultOverlayOpacity,
    getGlassOverlayAppearance,
    getOverlayAppearance,
    OVERLAY_OPACITY_DEFAULT,
} from '../lib/overlayAppearance';

// Define Model Types
interface ModelOption {
    id: string;
    name: string;
    type: 'cloud' | 'local' | 'custom' | 'ollama' | 'codex-cli';
    provider?: string;
}



const ModelSelectorWindow = () => {
    const isLight = useResolvedTheme() === 'light';
    const [currentModel, setCurrentModel] = useState<string>(() => localStorage.getItem('cached-current-model') || '');
    // Meeting-interface theme (default/liquid-glass/modern) + live overlay
    // opacity — same pattern SettingsPopup.tsx already uses for its own
    // popup window (see its comment block, ~SettingsPopup.tsx:33-45 and
    // ~268-287, for the full rationale). This window previously used a
    // static isLight-only panelClass (`bg-[#1E1E1E]/80` / `bg-[#F3F4F6]/92`)
    // that never adapted to liquid-glass/modern and never tracked the user's
    // configured overlay-opacity slider — the `.overlay-shell-surface`
    // CSS class (see index.css) already wins the cascade over that literal
    // class for glass/modern via its `!important` per-theme rules, so the
    // MATERIAL already looked correct, but opacity was stuck at whatever
    // --overlay-opacity happens to cascade in by default, not the user's
    // actual live-configured value — the same gap SettingsPopup.tsx's
    // already-committed fix (7c4f3bd2) closed for that window.
    const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => getMeetingInterfaceTheme());
    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('natively_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    useEffect(() => {
        const handleStorage = () => setInterfaceTheme(getMeetingInterfaceTheme());
        window.addEventListener('storage', handleStorage);
        const unsubscribe = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme: string) => {
            const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
            if (valid.includes(theme as MeetingInterfaceTheme)) {
                setInterfaceTheme(theme as MeetingInterfaceTheme);
            }
        });
        return () => {
            window.removeEventListener('storage', handleStorage);
            unsubscribe?.();
        };
    }, []);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onOverlayOpacityChanged?.((opacity: number) => {
            setOverlayOpacity(opacity);
        });
        return () => unsubscribe?.();
    }, []);

    const isGlassTheme = interfaceTheme === 'liquid-glass';
    const appearance = useMemo(
        () =>
            isGlassTheme
                ? getGlassOverlayAppearance()
                : getOverlayAppearance(overlayOpacity, isLight ? 'light' : 'dark'),
        [isGlassTheme, overlayOpacity, isLight],
    );
    const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
        try {
            const cached = localStorage.getItem('cached-models');
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => availableModels.length === 0);





    // Load Data
    // StrictMode-safe: dev-mode mount→unmount→remount would otherwise issue a
    // second `forceRestartOllama` IPC round-trip (and double-paint the spinner)
    // on every launcher paint. The `loadModelsOnceRef` survives the second
    // mount. Live updates from settings/model-changes still come through the
    // `onModelChanged` IPC subscription below — the previous `focus` listener
    // was redundant and high-frequency when toggling launcher ↔ overlay.
    useEffect(() => {
        let cancelled = false;

        const loadModels = async () => {
            try {
                // If we already have models, don't show loading to avoid flicker
                if (availableModels.length === 0) {
                    setIsLoading(true);
                }

                // 1. Get Stored Credentials (to know which Cloud providers are active)
                const creds = await window.electronAPI?.getStoredCredentials?.();

                // 2. Custom Providers
                const customProviders = await window.electronAPI?.getCustomProviders?.() || [];

                // 3. Codex CLI
                const codexCliConfig = await window.electronAPI?.getCodexCliConfig?.();

                // 4. Ollama
                let ollamaModels: string[] = [];
                try {
                    let oModels = await window.electronAPI?.getAvailableOllamaModels?.();

                    // If no models found, the daemon might be DOWN — or it might
                    // simply be UP with zero models pulled. Only restart in the
                    // former case: getAvailableOllamaModels returns [] for BOTH,
                    // and forceRestartOllama does a `kill -9` that would tear down a
                    // perfectly healthy user-managed daemon (and abort an in-flight
                    // embedding-model pull). Probe reachability first.
                    if (!oModels || oModels.length === 0) {
                        try {
                            const reachable = await window.electronAPI?.isOllamaReachable?.();
                            // Reachable === false means the daemon isn't answering; only
                            // then is a restart warranted. If reachable (or the probe is
                            // unavailable on an older preload → undefined), leave it alone.
                            if (reachable === false && window.electronAPI?.forceRestartOllama) {
                                await window.electronAPI.forceRestartOllama();
                                // Wait a moment for server to come up
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                // Retry fetch
                                oModels = await window.electronAPI?.getAvailableOllamaModels?.();
                            }
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

                if (creds?.hasNativelyKey) {
                    models.push({ id: 'natively', name: 'Natively API', type: 'cloud', provider: 'natively' });
                }

                // Cloud Models — standard models + unique preferred models
                for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                    if (!cfg.hasKeyCheck(creds)) continue;
                    cfg.ids.forEach((id, i) => {
                        models.push({ id, name: cfg.names[i], type: 'cloud', provider: prov });
                    });
                    const pm = creds?.[cfg.pmKey];
                    if (pm && !cfg.ids.includes(pm)) {
                        models.push({ id: pm, name: prettifyModelId(pm), type: 'cloud', provider: prov });
                    }
                }

                // Custom Providers
                customProviders.forEach((p: any) => {
                    models.push({ id: p.id, name: p.name, type: 'custom' });
                });

                // Codex CLI
                if (codexCliConfig?.enabled) {
                    models.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${prettifyModelId(codexCliConfig.model)})`, type: 'codex-cli', provider: 'codex-cli' });
                    CODEX_CLI_MODEL_PRESETS.forEach(model => {
                        const id = codexCliSelectorId(model.id);
                        models.push({ id, name: getCodexCliModelDisplayName(id) || model.name, type: 'codex-cli', provider: 'codex-cli' });
                    });
                }

                // Ollama
                ollamaModels.forEach((m: string) => {
                    models.push({ id: `ollama-${m}`, name: `${m} (Local)`, type: 'ollama' });
                });

                // LiteLLM proxy — auto-discovered from the configured proxy's /v1/models.
                // Wrapped in try/catch so a missing/offline proxy never blocks the list.
                try {
                    const litellmModels = await window.electronAPI?.getAvailableLiteLLMModels?.() || [];
                    litellmModels.forEach((m: string) => {
                        models.push({ id: `litellm/${m}`, name: `${m} (LiteLLM)`, type: 'cloud', provider: 'litellm' });
                    });
                } catch {
                    // LiteLLM proxy may not be running — ignore.
                }

                if (cancelled) return;

                localStorage.setItem('cached-models', JSON.stringify(models));
                setAvailableModels(models);

                // 4. Get Current Active Model
                const config = await window.electronAPI?.getCurrentLlmConfig?.(); // Get runtime model
                if (config && config.modelId) {
                    // Compare on `modelId` (stable identifier) — using `displayName`
                    // or the legacy `model` would mismatch against option IDs and
                    // hide the selected checkmark on the custom-provider row.
                    setCurrentModel(config.modelId);
                    localStorage.setItem('cached-current-model', config.modelId);
                }

            } catch (err) {
                console.error("Failed to load models:", err);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        loadModels();

        // Listen for changes
        const unsubscribe = window.electronAPI?.onModelChanged?.((modelId: string) => {
            setCurrentModel(modelId);
        });
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, []);

    const handleSelectFn = (modelId: string) => {
        setCurrentModel(modelId);
        localStorage.setItem('cached-current-model', modelId);
        
        window.electronAPI?.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    // Same isDarkBg concept SettingsPopup.tsx already established for this
    // exact reason: liquid-glass and modern meeting-interface themes always
    // render a dark panel regardless of the OS light/dark setting, so row
    // text/hover colors must follow the THEME, not raw OS-level `isLight` —
    // otherwise a user on a light OS theme with liquid-glass or modern
    // selected would get light-colored row text on a dark glass/modern
    // panel, unreadable low-contrast.
    const isDarkBg = interfaceTheme === 'liquid-glass' || interfaceTheme === 'modern' || !isLight;
    const panelClass = isDarkBg
        ? 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40'
        : 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div
                className={`w-[140px] h-[200px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl p-2 flex flex-col animate-scale-in origin-top-left overlay-shell-surface ${panelClass}`}
                style={{ ...appearance.shellStyle }}
            >
                <div className="relative z-[1] flex-1 min-h-0 flex flex-col">
                    {isLoading ? (
                        <div className={`flex items-center justify-center py-4 overlay-text-muted ${isDarkBg ? 'text-slate-500' : 'text-slate-400'}`}>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            <span className="text-xs">Loading models...</span>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-0.5">
                            {availableModels.length === 0 ? (
                                <div className={`px-4 py-3 text-center text-xs overlay-text-muted ${isDarkBg ? 'text-slate-500' : 'text-slate-400'}`}>
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
                                                w-full text-left px-3 py-2 flex items-center justify-between group transition-colors duration-200 rounded-lg model-selector-row
                                                ${isSelected
                                                    ? `model-selector-row-selected overlay-text-primary ${isDarkBg ? 'bg-white/10 text-white' : 'bg-black/[0.07] text-slate-900'}`
                                                    : `overlay-text-interactive ${isDarkBg ? 'text-slate-400 hover:bg-white/5 hover:text-slate-200' : 'text-slate-500 hover:bg-black/[0.04] hover:text-slate-800'}`
                                                }
                                            `}
                                        >
                                            <span className="text-[12px] font-medium truncate flex-1 min-w-0">{model.name}</span>
                                            {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ml-2 ${isDarkBg ? 'text-emerald-400' : 'text-emerald-600'}`} />}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ModelSelectorWindow;
