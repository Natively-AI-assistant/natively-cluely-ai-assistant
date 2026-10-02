import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Check, ImageOff, Loader2 } from 'lucide-react';
import { groupModelOptions, type ModelSelectorOption } from './ui/modelSelectorGroups';
import { MODEL_SELECTOR_WIDTH } from './ui/modelSelectorLabelText';
import { CODEX_CLI_MODEL, codexCliSelectorId, codexModelOptions, gatewayModelLabel, isModelAllowed, litellmModelLabel, STANDARD_CLOUD_MODELS, prettifyModelId } from '../utils/modelUtils';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import {
    clampOverlayOpacity,
    getDefaultOverlayOpacity,
    getGlassOverlayAppearance,
    getOverlayAppearance,
    OVERLAY_OPACITY_DEFAULT,
} from '../lib/overlayAppearance';

type ModelOption = ModelSelectorOption;

/** Tallest the list gets before it scrolls: about ten rows and two headers. */
const LIST_MAX_HEIGHT = 340;
/** The panel's p-1 padding plus its 1px border, top and bottom. */
const PANEL_CHROME = 10;

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
        // Only the NEWEST run may commit. A cold LiteLLM discovery can take up
        // to 5s, so without this an in-flight load started before a credential
        // change could land after the reload it triggered and overwrite the
        // fresher list with the stale one.
        let runToken = 0;

        const loadModels = async () => {
            const myToken = ++runToken;
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
                // Codex is only offered with a usable ChatGPT sign-in (Natively's
                // own or `codex login`) — the same gate Settings applies. Listing
                // it regardless let a signed-out user pick a model that routing
                // then silently answered from another provider (issue #558).
                const codexSignedIn = codexCliConfig?.enabled
                    ? !!(await window.electronAPI?.codexLoginStatus?.().catch(() => null))?.signedIn
                    : false;
                // The installed Codex CLI's own model list; presets when there is none.
                const codexModels = codexSignedIn
                    ? codexModelOptions(await window.electronAPI?.getCodexCliModels?.().catch(() => undefined))
                    : [];

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

                // Cloud Models — live fetched models (with fallback to standard models) + preferred model
                for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                    if (!cfg.hasKeyCheck(creds)) continue;
                    const fetched = creds?.cloudFetchedModels?.[prov];
                    if (Array.isArray(fetched) && fetched.length > 0) {
                        fetched.forEach((m: { id: string; label: string }) => {
                            models.push({ id: m.id, name: m.label || m.id, type: 'cloud', provider: prov });
                        });
                    } else {
                        cfg.ids.forEach((id, i) => {
                            models.push({ id, name: cfg.names[i], type: 'cloud', provider: prov });
                        });
                    }
                    const pm = creds?.[cfg.pmKey];
                    if (pm && !models.some(m => m.id === pm)) {
                        models.push({ id: pm, name: prettifyModelId(pm), type: 'cloud', provider: prov });
                    }
                }

                try {
                    const result = await window.electronAPI.antigravityModels();
                    for (const model of result.models) {
                        models.push({ id: `antigravity:${model.id}`, name: `${model.label} (Antigravity)`, type: 'cloud', provider: 'antigravity' });
                    }
                } catch { /* Offline or signed out; other providers remain available. */ }

                // Custom Providers
                customProviders.forEach((p: any) => {
                    models.push({ id: p.id, name: p.name, type: 'custom' });
                });

                // Codex CLI
                if (codexCliConfig?.enabled && codexSignedIn) {
                    const configuredName = codexModels.find(model => model.id === codexCliConfig.model)?.name || prettifyModelId(codexCliConfig.model);
                    models.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${configuredName})`, type: 'codex-cli', provider: 'codex-cli' });
                    codexModels.forEach(model => {
                        models.push({ id: codexCliSelectorId(model.id), name: model.name, type: 'codex-cli', provider: 'codex-cli' });
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
                        // Label is the bare model name — `m` still carries the proxy's
                        // own `<upstream>/` prefix (see litellmModelLabel).
                        models.push({ id: `litellm/${m}`, name: `${litellmModelLabel(m)} (LiteLLM)`, type: 'cloud', provider: 'litellm' });
                    });
                } catch {
                    // LiteLLM proxy may not be running — ignore.
                }

                // 9Router — auto-discovered from the configured instance. Same
                // shape and the same try/catch: an instance that is not running
                // must never block the rest of the list.
                try {
                    const ninerouterModels = await window.electronAPI?.getAvailableNinerouterModels?.() || [];
                    ninerouterModels.forEach((m: string) => {
                        // `m` still carries 9Router's own `<upstreamAlias>/` prefix, so
                        // the label takes the last segment the same way LiteLLM's does.
                        models.push({ id: `ninerouter/${m}`, name: `${gatewayModelLabel(m)} (9Router)`, type: 'cloud', provider: 'ninerouter' });
                    });
                } catch {
                    // 9Router may not be running — ignore.
                }

                if (cancelled || myToken !== runToken) return;

                // Settings → AI Providers is where the user curates this list, and
                // until now NOTHING here honoured it: a provider switched off and a
                // model un-ticked both still showed up in the meeting overlay. That
                // is load-bearing for a gateway like LiteLLM, whose catalogue can run
                // to 300+ models — its allow-list is opt-in (empty = none), so
                // without this gate the picker would list every model on the proxy.
                //
                // `family` mirrors providerFamily() in ipcHandlers.ts. Custom
                // providers have no allow-list UI, so their empty list means "no
                // filter" and isModelAllowed lets them through unchanged.
                const disabled = new Set(creds?.disabledProviders || []);
                const allowLists: Record<string, string[]> = creds?.cloudEnabledModels || {};
                const visibleModels = models.filter(m => {
                    const family = m.provider
                        ?? (m.type === 'ollama' ? 'ollama' : m.type === 'custom' ? 'custom' : null);
                    if (!family) return true;
                    if (disabled.has(family)) return false;
                    // The bare Codex entry runs the Codex default model, so it is
                    // allowed exactly when that model is (modelAvailable does the same).
                    const allowId = m.id === CODEX_CLI_MODEL.id && codexCliConfig?.model
                        ? codexCliSelectorId(codexCliConfig.model) : m.id;
                    return isModelAllowed(family, allowId, allowLists[family] || []);
                });

                localStorage.setItem('cached-models', JSON.stringify(visibleModels));
                setAvailableModels(visibleModels);

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
                if (!cancelled && myToken === runToken) setIsLoading(false);
            }
        };

        loadModels();

        // Listen for changes
        const unsubscribe = window.electronAPI?.onModelChanged?.((modelId: string) => {
            setCurrentModel(modelId);
        });
        // This window is REUSED, never destroyed: ModelSelectorWindowHelper
        // pre-warms it offscreen and thereafter only hide()s and show()s it. So
        // the effect above runs ONCE per app lifetime, and without this the list
        // is frozen at its startup snapshot — a provider configured afterwards
        // (an API key, a LiteLLM proxy, a Codex sign-in) never appears until the
        // app is restarted.
        //
        // It failed SILENTLY, which is why it went unnoticed: availableModels
        // seeds from localStorage and isLoading stays false whenever that cache
        // is non-empty, so a stale list renders with no spinner and no error.
        //
        // onModelChanged above is NOT a substitute — it only moves the
        // checkmark; it never rebuilds the list.
        const unsubCredentials = window.electronAPI?.onCredentialsChanged?.(() => {
            loadModels();
        });
        const unsubLiveCatalog = window.electronAPI?.onLiveCatalogUpdated?.(() => {
            loadModels();
        });
        return () => {
            cancelled = true;
            unsubscribe?.();
            unsubCredentials?.();
            unsubLiveCatalog?.();
        };
    }, []);

    // Which listed models cannot read a screenshot (2026-10-01). Marked on the
    // row, because that is the moment it matters: picking one means a screen
    // question is answered by another provider, or not at all. Only the
    // exception is marked — most models read images, and a glyph on every row
    // would cost each name 16px of a 141px panel. Main owns the answer
    // (the user's Auto / On / Off in Settings included); a custom provider has
    // none here (its own Settings control decides), so it is never marked.
    const [textOnlyIds, setTextOnlyIds] = useState<ReadonlySet<string>>(() => new Set());
    const visionIdsKey = useMemo(
        () => availableModels.filter(m => m.type !== 'custom').map(m => m.id).join('\n'),
        [availableModels],
    );
    useEffect(() => {
        if (!visionIdsKey) { setTextOnlyIds(new Set()); return; }
        let cancelled = false;
        let token = 0;
        const load = async () => {
            const mine = ++token;
            try {
                const result = await window.electronAPI?.getVisionModelStates?.(visionIdsKey.split('\n'));
                if (cancelled || mine !== token || !result?.states) return;
                setTextOnlyIds(new Set(Object.entries(result.states).filter(([, s]) => s?.reads === 'no').map(([id]) => id)));
            } catch { /* no marker is the safe default */ }
        };
        void load();
        // A setting changed in Settings, or a background image test finished.
        const off = window.electronAPI?.onVisionCapabilityChanged?.(() => { void load(); });
        return () => { cancelled = true; off?.(); };
    }, [visionIdsKey]);

    const handleSelectFn = (modelId: string) => {
        setCurrentModel(modelId);
        localStorage.setItem('cached-current-model', modelId);
        
        window.electronAPI?.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    // The empty list's one row. A model is added in Settings, so go there and
    // take this menu out of the way (it would otherwise stay open over it).
    const openProviders = () => {
        window.electronAPI?.openSettingsTab?.('ai-providers')?.catch?.(() => {});
        window.electronAPI?.modelSelectorCloseIfOpen?.()?.catch?.(() => {});
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
        ? 'bg-[#1E1E1E]/80 border-white/10'
        : 'bg-[#F3F4F6]/92 border-black/10';
    // Glass and modern repaint rows from index.css (.model-selector-row), so
    // these only decide the default theme.
    const rowHoverClass = isDarkBg ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]';
    // --overlay-text-muted is too faint for an 11px header on the light panel,
    // so light uses Apple's secondary label color instead.
    const headerColor = isDarkBg ? 'var(--overlay-text-muted)' : 'rgba(60, 60, 67, 0.64)';

    const groups = useMemo(() => groupModelOptions(availableModels), [availableModels]);
    const showHeaders = groups.length > 1;

    const panelRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [fade, setFade] = useState({ top: false, bottom: false });
    // Main's cap for where the dropdown sits (modelSelectorHeightBudget): a low
    // overlay gets a shorter list, not a dropdown pushed up over the answer.
    const [heightBudget, setHeightBudget] = useState<number>(Number.POSITIVE_INFINITY);
    const listMaxHeight = Math.min(LIST_MAX_HEIGHT, heightBudget - PANEL_CHROME);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onModelSelectorHeightBudget?.((maxHeight: number) => {
            if (Number.isFinite(maxHeight) && maxHeight > 0) setHeightBudget(maxHeight);
        });
        return () => unsubscribe?.();
    }, []);

    const updateFade = () => {
        const list = listRef.current;
        if (!list) return;
        const top = list.scrollTop > 1;
        const bottom = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
        setFade(prev => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };

    // Keeps the checked row in view. Manual scrollTop rather than
    // scrollIntoView, which would also scroll PanelShell's overflow-hidden box.
    const revealSelected = () => {
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>('[data-selected="true"]');
        if (!list || !row) return;
        // Out of view: centre it, so its neighbours (and header) show too
        // instead of the row sitting under the edge fade.
        const inView = row.offsetTop >= list.scrollTop + 18
            && row.offsetTop + row.offsetHeight <= list.scrollTop + list.clientHeight - 18;
        if (!inView) {
            list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
        }
        updateFade();
    };

    // The window is sized to the panel, so a short list leaves no transparent
    // strip under it (on Windows that strip would still take clicks).
    // The computed size, not getBoundingClientRect (the open animation scales
    // the panel, so a mid-animation rect under-reports) and not offsetWidth
    // (rounded to the nearest pixel: a content-fit 174.44px panel would lose
    // a sliver of its right border). Border-box, rounded UP.
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const report = () => {
            const style = getComputedStyle(panel);
            window.electronAPI?.updateContentDimensions?.({
                width: Math.ceil(parseFloat(style.width)),
                height: Math.ceil(parseFloat(style.height)),
            })?.catch?.(() => {});
            updateFade();
        };
        report();
        const observer = new ResizeObserver(report);
        observer.observe(panel);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(revealSelected, [groups, currentModel, showHeaders, listMaxHeight]);

    // The window is pre-warmed once and then only hidden and shown, so a mount
    // animation would play a single time, offscreen. Main says when it opens.
    useEffect(() => {
        const unsubscribe = window.electronAPI?.onModelSelectorShown?.(() => {
            revealSelected();
            const panel = panelRef.current;
            if (!panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            panel.animate(
                [
                    { opacity: 0, transform: 'translateY(-4px) scale(0.98)' },
                    { opacity: 1, transform: 'none' },
                ],
                { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
            );
        });
        return () => unsubscribe?.();
    }, []);

    const fadeMask = fade.top || fade.bottom
        ? `linear-gradient(to bottom, ${fade.top ? 'transparent 0, #000 18px' : '#000 0'}, ${fade.bottom ? '#000 calc(100% - 18px), transparent 100%' : '#000 100%'})`
        : undefined;

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div
                ref={panelRef}
                className={`backdrop-blur-md border rounded-[14px] overflow-hidden p-1 flex flex-col origin-top-left overlay-shell-surface overlay-popover-surface ${panelClass}`}
                // Same width as the toolbar button that opens it.
                style={{ ...appearance.shellStyle, width: MODEL_SELECTOR_WIDTH }}
            >
                <div className="relative z-[1] flex flex-col">
                    {isLoading ? (
                        <div className="flex items-center gap-2 px-2 h-[30px] overlay-text-muted">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span className="text-[12px]">Loading models…</span>
                        </div>
                    ) : availableModels.length === 0 ? (
                        // An empty state, not a list: one quiet line that says
                        // why there is nothing here, and one button that fixes
                        // it (the owner's pick of three). The button fills the
                        // menu and has a resting fill, so it reads as something
                        // to press; a plain row here looked like a model that
                        // was permanently hovered. Its 10px corners sit
                        // concentric with the panel's 14px ones across the 4px
                        // of padding. Both lines are short on purpose: at this
                        // width "No models connected" and "Connect one in
                        // Settings." each wrapped.
                        <div className="flex flex-col gap-1.5 pt-1.5">
                            <div className="text-center text-[11px] leading-4 select-none whitespace-nowrap" style={{ color: headerColor }}>
                                No models yet
                            </div>
                            <button
                                type="button"
                                onClick={openProviders}
                                // Answers on press, not on release: the fill
                                // and the 3% squeeze start at pointer-down.
                                className="w-full h-[28px] rounded-[10px] text-[12px] font-medium whitespace-nowrap overlay-text-primary bg-[var(--overlay-control-bg)] hover:bg-[var(--overlay-control-hover-bg)] transition-[background-color,transform] duration-100 ease-out active:scale-[0.97] motion-reduce:transform-none"
                            >
                                Add a model
                            </button>
                        </div>
                    ) : (
                        <div
                            ref={listRef}
                            role="listbox"
                            aria-label="Model"
                            onScroll={updateFade}
                            className="relative overflow-y-auto overscroll-contain scrollbar-hide flex flex-col"
                            style={{ maxHeight: listMaxHeight, maskImage: fadeMask, WebkitMaskImage: fadeMask }}
                        >
                            {groups.map((group, groupIndex) => (
                                <div
                                    key={`${group.key}-${groupIndex}`}
                                    role="group"
                                    aria-label={group.label}
                                    className={groupIndex > 0 ? 'mt-1' : undefined}
                                >
                                    {showHeaders && group.showHeader && (
                                        <div className="px-2 pt-1 pb-0.5 text-[11px] leading-4 font-semibold select-none" style={{ color: headerColor }}>
                                            {group.label}
                                        </div>
                                    )}
                                    <div className="flex flex-col gap-px">
                                        {group.rows.map((model) => {
                                            const isSelected = currentModel === model.id;
                                            return (
                                                <button
                                                    key={model.id}
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    data-selected={isSelected ? 'true' : undefined}
                                                    onClick={() => handleSelectFn(model.id)}
                                                    className={`w-full h-[30px] pl-2 pr-1.5 flex items-center gap-1.5 text-left rounded-[10px] transition-colors duration-100 overlay-text-primary model-selector-row ${rowHoverClass} ${isSelected ? 'model-selector-row-selected' : ''}`}
                                                >
                                                    <span className="text-[12px] font-medium truncate flex-1 min-w-0">{model.label}</span>
                                                    {/* No `title`: an overlay tooltip is a separate window
                                                        that screen capture can see. */}
                                                    {textOnlyIds.has(model.id) && (
                                                        <ImageOff className="w-3 h-3 shrink-0 opacity-50" strokeWidth={1.75} role="img" aria-label="Can't read screenshots" />
                                                    )}
                                                    {/* Only the checked row gives up room for the check:
                                                        reserving it on every row left a visible gap beside
                                                        names that were being cut short. */}
                                                    {isSelected && <Check className="w-3 h-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ModelSelectorWindow;
