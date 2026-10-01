import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MessageSquare, Camera, Zap, Eye } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getModifierSymbol } from '../utils/platformUtils';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import {
    clampOverlayOpacity,
    getDefaultOverlayOpacity,
    getGlassOverlayAppearance,
    getOverlayAppearance,
    OVERLAY_OPACITY_DEFAULT,
} from '../lib/overlayAppearance';
import { useToggleInit } from './settings/useToggleInit';

/**
 * The quick-settings popup's switch (`sm` variant: a 30x13.64 track — the
 * canonical toggle scaled uniformly to the width this 180px popup can afford,
 * so track AND knob keep the reference proportions; see the
 * `.t-toggle.t-toggle-sm` comment in index.css). Same shared `.t-toggle`
 * contract as the main settings panels: track colours, thumb fill, curves, and press
 * character all come from index.css, so this reads identically to every other
 * toggle in the app. Only the `active:scale-[0.92]` press feedback on the
 * whole button is local, layered on top of (not replacing) the shared thumb's
 * own press-squish.
 *
 * The knob is deliberately NOT overridden here. An earlier version passed a
 * `knobClassName` (`bg-black` on dark) through a `t-toggle-thumb-custom`
 * opt-out class; that opt-out outranked the caller's own utility and reset
 * background-color to transparent, so every knob in this popup rendered
 * INVISIBLE — the reported "toggles look wrong in the meeting overlay's
 * settings". Track classes still flow through `onClassName`/`offClassName`,
 * but note that only their box-shadow (the ON glow) and `glass-toggle-track`
 * survive the cascade — the shared `--toggle-on`/`--toggle-off` fills win
 * over their `bg-*` utility on purpose (see the `:root` block in index.css).
 *
 * `shrink-0` matters: this popup is a fixed 180px window, and without it the
 * flex row squashes the track while the absolutely-positioned thumb keeps its
 * full width. The box itself (width/height/padding) is owned entirely by
 * index.css — utilities here would only lose to it on specificity and drift.
 *
 * `useToggleInit()` is currently inert — see useToggleInit's docstring; the
 * CSS bounce it used to arm was replaced by a plain transition.
 */
const PopupToggle: React.FC<{
    checked: boolean;
    onChange: () => void;
    label: string;
    disabled?: boolean;
    /** Track classes when on — only the box-shadow glow survives the cascade. */
    onClassName: string;
    /** Track classes when off — carries `glass-toggle-track` for glass themes. */
    offClassName: string;
}> = ({ checked, onChange, label, disabled = false, onClassName, offClassName }) => {
    const toggleInit = useToggleInit();
    return (
        <button
            type="button"
            role="switch"
            data-on={String(checked)}
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => { toggleInit.arm(); onChange(); }}
            className={`t-toggle t-toggle-sm shrink-0 active:scale-[0.92] ${checked ? onClassName : offClassName} ${toggleInit.className}`}
        >
            <span className="t-toggle-thumb" aria-hidden="true" />
        </button>
    );
};

const SettingsPopup = () => {
    const { shortcuts } = useShortcuts();
    const isLightTheme = useResolvedTheme() === 'light';
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [useGroqFastText, setUseGroqFastText] = useState(() => {
        return localStorage.getItem('natively_groq_fast_text') === 'true';
    });
    const isFirstRender = React.useRef(true);

    // Same rule as AI Providers' canUseFastMode: a Background Model pick, a key
    // for any vendor with a fast tier (Auto uses it), Natively, or a Codex
    // sign-in. Key-based, like Settings — the on/off switches decide whether it
    // APPLIES, not whether the toggle can be used, so the two never disagree.
    const [fastResponseAvailable, setFastResponseAvailable] = useState(false);
    const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
        return getMeetingInterfaceTheme();
    });

    // Overlay opacity — same localStorage key + init logic SettingsOverlay.tsx
    // and App.tsx use ('natively_overlay_opacity', theme-aware default when
    // unset). This window (the settings-popup BrowserWindow, ?window=settings)
    // is a SEPARATE Electron window from both the real meeting overlay
    // (?window=overlay) and the launcher — App.tsx's own `overlayOpacity`
    // state exists in this window's App.tsx instance too, but its live IPC
    // listener is deliberately gated `if (!isOverlayWindow) return;`
    // (App.tsx ~719), so it would be a stale mount-time snapshot here, not
    // live-tracking the opacity slider while this popup stays open. Reading
    // and subscribing independently, the same way `interfaceTheme` above
    // already does for itself in this exact component, keeps this correct
    // without touching App.tsx (which has unrelated work in progress on it
    // right now — see git status).
    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('natively_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    // Load credentials func
    const loadCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            const fast = await window.electronAPI?.getFastModel?.().catch(() => null);
            const codexCfg = await window.electronAPI?.getCodexCliConfig?.().catch(() => null);
            const codexSignedIn = codexCfg?.enabled
                ? !!(await window.electronAPI?.codexLoginStatus?.().catch(() => null))?.signedIn
                : false;
            const autoFastTier = !!(creds?.hasGroqKey || creds?.hasDeepseekKey || creds?.hasGeminiKey || creds?.hasOpenaiKey || creds?.hasClaudeKey);
            setFastResponseAvailable(!!(fast?.model || autoFastTier || creds?.hasNativelyKey || codexSignedIn));
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    };

    // Load Initial Data and refresh on focus
    useEffect(() => {
        loadCredentials();
        const handleFocus = () => loadCredentials();
        window.addEventListener('focus', handleFocus);

        // Settings staleness fix (2026-08-21): this window mounts ONCE at app
        // start and is hidden/shown afterwards, so the mount fetches above go
        // stale. The focus handler never fires for the overlay-anchored
        // popover (main shows it with showInactive()), so re-pull everything
        // pull-based each time the main process shows the window. Broadcast-
        // synced state (undetectable, groq mode, opacity, theme) already stays
        // live via its own listeners.
        // @ts-ignore
        const unsubscribeShown = window.electronAPI?.onSettingsWindowShown?.(() => {
            loadCredentials();
            try {
                // Undetectable's INITIAL fetch is mount-only; its change
                // listener only covers changes made while this window exists.
                window.electronAPI?.getUndetectable?.().then((state: boolean) => setIsUndetectable(state));
            } catch { /* non-fatal */ }
        });

        return () => {
            window.removeEventListener('focus', handleFocus);
            unsubscribeShown?.();
        };
    }, []);

    // Sync meeting interface theme from localStorage and main process
    useEffect(() => {
        const handleStorage = () => {
            setInterfaceTheme(getMeetingInterfaceTheme());
        };
        window.addEventListener('storage', handleStorage);
        // @ts-ignore
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

    // Sync overlay opacity live while this popup window stays open. Real-time
    // slider drags (SettingsOverlay.tsx handleOpacityChange) broadcast via
    // `window.electronAPI.setOverlayOpacity()` at 60fps — never through
    // localStorage (that's debounced 150ms and only for persistence), so a
    // `storage` listener alone would miss the live drag entirely. The main
    // process relays every call to ALL BrowserWindows via
    // `BrowserWindow.getAllWindows().forEach(...)` (electron/ipcHandlers.ts
    // `set-overlay-opacity`), this popup window included, which is exactly
    // what `onOverlayOpacityChanged` below picks up — the identical listener
    // NativelyInterface's own overlay window uses (App.tsx ~720-722) for the
    // real panel shell.
    useEffect(() => {
        const unsubscribe = window.electronAPI?.onOverlayOpacityChanged?.((opacity: number) => {
            setOverlayOpacity(opacity);
        });
        return () => unsubscribe?.();
    }, []);

    // Fetch initial undetectable state from main process (source of truth)
    useEffect(() => {
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((state: boolean) => {
                setIsUndetectable(state);
            });
        }
    }, []);

    // One-way listener: receive state changes from main process, never echo back
    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
                localStorage.setItem('natively_undetectable', String(newState));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setUseGroqFastText(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Skip initial render to avoid unnecessary IPC calls
        if (isFirstRender.current) {
            isFirstRender.current = false;
            // Ensure backend is synced on mount (even if no change)
            try {
                // @ts-ignore
                window.electronAPI?.setGroqFastTextMode(useGroqFastText);
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Apply Groq Text Mode
        localStorage.setItem('natively_groq_fast_text', String(useGroqFastText));
        try {
            // @ts-ignore - electronAPI not typed in this file yet
            window.electronAPI?.setGroqFastTextMode(useGroqFastText);
        } catch (e) {
            console.error(e);
        }
    }, [useGroqFastText]);

    const [actionButtonMode, setActionButtonModeState] = useState<'recap' | 'brainstorm'>('recap');

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false'; // Default to true if not set
    });

    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('natively_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Load action button mode and subscribe to changes from other windows
    useEffect(() => {
        // @ts-ignore
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode ?? 'recap');
        }).catch(() => {});
        // @ts-ignore
        if (!window.electronAPI?.onActionButtonModeChanged) return;
        // @ts-ignore
        const unsubscribe = window.electronAPI.onActionButtonModeChanged((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode);
        });
        return () => unsubscribe();
    }, []);

    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-resize Window. The window hugs the panel, so it is told the panel's
    // size: the computed border-box, rounded UP. Not getBoundingClientRect —
    // the open animation scales the panel, and a mid-animation rect
    // under-reports (it measured 175x228 for a 180x235 panel) — and not
    // offsetWidth, which rounds to the nearest pixel.
    useLayoutEffect(() => {
        const panel = contentRef.current;
        if (!panel) return;
        const report = () => {
            const style = getComputedStyle(panel);
            try {
                window.electronAPI?.updateContentDimensions?.({
                    width: Math.ceil(parseFloat(style.width)),
                    height: Math.ceil(parseFloat(style.height)),
                })?.catch?.(() => {});
            } catch (e) {
                console.warn("Failed to update dimensions", e);
            }
        };
        report();
        const observer = new ResizeObserver(report);
        observer.observe(panel);
        return () => observer.disconnect();
    }, []);

    // The window is pre-warmed once and then only hidden and shown, so a mount
    // animation played a single time, offscreen. Replay it on every open.
    useEffect(() => {
        // @ts-ignore
        const unsubscribe = window.electronAPI?.onSettingsWindowShown?.(() => {
            const panel = contentRef.current;
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

    // Determine if the background is dark (glass themes are always dark glass)
    const isDarkBg = interfaceTheme === 'liquid-glass' || interfaceTheme === 'modern' || !isLightTheme;

    const popupPanelClass = isDarkBg
        ? 'bg-[#1E1E1E]/80 border-white/10'
        : 'bg-[#F3F4F6]/92 border-black/10';
    // Same row metrics and hover as the model dropdown next to it
    // (ModelSelectorWindow), so the two popovers read as one family.
    const itemHoverClass = isDarkBg ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]';
    const labelColorClass = isDarkBg ? 'text-white' : 'text-slate-900';
    // An icon is lit when its switch is on and muted when it is off; the
    // switch carries the state, so the icon never fills or takes the accent.
    const iconOnClass = isDarkBg ? 'text-white' : 'text-slate-900';
    const iconOffClass = isDarkBg ? 'text-white/55' : 'text-slate-500';
    const headerColor = isDarkBg ? 'var(--overlay-text-muted)' : 'rgba(60, 60, 67, 0.64)';
    const shortcutKeyClass = isDarkBg
        ? 'border-white/10 bg-white/[0.06] text-white/70 glass-shortcut-key'
        : 'border-black/10 bg-black/[0.04] text-slate-600 glass-shortcut-key';
    const defaultToggleTrackClass = isDarkBg ? 'bg-white/10 glass-toggle-track' : 'bg-black/[0.22] glass-toggle-track';
    const accentTrackClass = 'bg-accent-primary shadow-[0_2px_10px_var(--accent-shadow-20)]';

    // Real per-theme panel material — same computation NativelyInterface uses
    // for its own shell: isGlassTheme ? getGlassOverlayAppearance() :
    // getOverlayAppearance(opacity, theme), applied inline alongside the
    // overlay-shell-surface class so the DEFAULT theme tracks the live
    // overlay-opacity slider. For liquid-glass this resolves to {} and the
    // [data-interface-theme="liquid-glass"] .overlay-shell-surface !important
    // rule governs; for modern its own !important rule wins over the inline
    // style the same way.
    const isGlassTheme = interfaceTheme === 'liquid-glass';
    const appearance = useMemo(
        () =>
            isGlassTheme
                ? getGlassOverlayAppearance()
                : getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
        [isGlassTheme, overlayOpacity, isLightTheme]
    );

    // A plain render function, not a component: a component declared here
    // would be a new type every render, remounting each switch and cutting
    // its slide short.
    const renderToggleRow = (row: {
        key: string;
        icon: React.ReactNode;
        label: string;
        checked: boolean;
        onToggle: () => void;
        onClassName: string;
        disabled?: boolean;
    }) => (
        <div
            key={row.key}
            // The whole row flips the switch, not only the 30px track. A click
            // on the switch itself (PopupToggle, marked data-on) is left to the
            // switch, or it would flip twice.
            onClick={(e) => {
                if (row.disabled) return;
                if ((e.target as HTMLElement).closest('[data-on]')) return;
                row.onToggle();
            }}
            className={`h-[30px] px-2 flex items-center gap-2 rounded-[10px] select-none cursor-default transition-colors duration-100 ${row.disabled ? 'opacity-45' : `${itemHoverClass} glass-popup-row`}`}
        >
            <span className={`w-3.5 h-3.5 shrink-0 flex items-center justify-center transition-colors ${row.checked && !row.disabled ? iconOnClass : iconOffClass}`}>
                {row.icon}
            </span>
            <span className={`flex-1 min-w-0 truncate text-[12px] font-medium ${labelColorClass}`}>{row.label}</span>
            <PopupToggle
                checked={row.checked}
                label={row.label}
                disabled={row.disabled}
                onChange={row.onToggle}
                onClassName={row.onClassName}
                offClassName={defaultToggleTrackClass}
            />
        </div>
    );

    const renderShortcutRow = (row: { key: string; icon: React.ReactNode; label: string; keys: string[] }) => (
        // Not clickable, so no hover or press: the keys are the information.
        <div key={row.key} className="h-[30px] px-2 flex items-center gap-2 select-none cursor-default">
            <span className={`w-3.5 h-3.5 shrink-0 flex items-center justify-center ${iconOffClass}`}>{row.icon}</span>
            <span className={`flex-1 min-w-0 truncate text-[12px] font-medium ${labelColorClass}`}>{row.label}</span>
            <span className="flex items-center gap-[3px] shrink-0">
                {row.keys.map((key, index) => (
                    <kbd
                        key={index}
                        className={`min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-[5px] border font-sans text-[10px] font-medium leading-none ${shortcutKeyClass}`}
                    >
                        {key}
                    </kbd>
                ))}
            </span>
        </div>
    );

    const iconClass = 'w-3.5 h-3.5';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div
                ref={contentRef}
                className={`w-[180px] backdrop-blur-md border rounded-[14px] overflow-hidden p-1 flex flex-col origin-top-left overlay-shell-surface overlay-popover-surface ${popupPanelClass}`}
                style={{ ...appearance.shellStyle }}
            >
                <div className="relative z-[1] flex flex-col">
                    {renderToggleRow({
                        key: 'undetectable',
                        icon: <CustomGhost className={iconClass} />,
                        label: isUndetectable ? 'Undetectable' : 'Detectable',
                        checked: isUndetectable,
                        onToggle: () => {
                            const newState = !isUndetectable;
                            setIsUndetectable(newState);
                            localStorage.setItem('natively_undetectable', String(newState));
                            window.electronAPI?.setUndetectable(newState);
                        },
                        onClassName: isDarkBg
                            ? 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]'
                            : 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]',
                    })}

                    {/* See fastResponseAvailable. */}
                    {renderToggleRow({
                        key: 'fast-response',
                        icon: <Zap className={iconClass} />,
                        label: 'Fast Response',
                        checked: useGroqFastText,
                        disabled: !fastResponseAvailable,
                        onToggle: () => {
                            if (!fastResponseAvailable) return;
                            setUseGroqFastText(!useGroqFastText);
                        },
                        onClassName: accentTrackClass,
                    })}

                    {renderToggleRow({
                        key: 'transcript',
                        icon: <MessageSquare className={iconClass} />,
                        label: 'Transcript',
                        checked: showTranscript,
                        onToggle: () => {
                            const newState = !showTranscript;
                            setShowTranscript(newState);
                            localStorage.setItem('natively_interviewer_transcript', String(newState));
                            // Dispatch event for same-window listeners
                            window.dispatchEvent(new Event('storage'));
                        },
                        onClassName: accentTrackClass,
                    })}

                    {/* Interview Mode = the Brainstorm action button. */}
                    {renderToggleRow({
                        key: 'interview-mode',
                        icon: (
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={iconClass}
                            >
                                <line x1="6" y1="3" x2="6" y2="15" />
                                <circle cx="18" cy="6" r="3" />
                                <circle cx="6" cy="18" r="3" />
                                <path d="M18 9a9 9 0 0 1-9 9" />
                            </svg>
                        ),
                        label: 'Interview Mode',
                        checked: actionButtonMode === 'brainstorm',
                        onToggle: async () => {
                            const newMode: 'recap' | 'brainstorm' = actionButtonMode === 'brainstorm' ? 'recap' : 'brainstorm';
                            setActionButtonModeState(newMode);
                            try {
                                // @ts-ignore
                                await window.electronAPI?.setActionButtonMode?.(newMode);
                            } catch (e) { console.error(e); }
                        },
                        onClassName: accentTrackClass,
                    })}

                    {/* Profile Mode lives in Settings › Profile Intelligence only;
                        it was dropped from this popup by owner request. */}

                    <div className="px-2 pt-2 pb-0.5 text-[11px] leading-4 font-semibold select-none" style={{ color: headerColor }}>
                        Shortcuts
                    </div>
                    {renderShortcutRow({
                        key: 'show-hide',
                        icon: <Eye className={iconClass} />,
                        label: 'Show/Hide',
                        keys: shortcuts.toggleVisibility || [getModifierSymbol('cmd'), 'B'],
                    })}
                    {renderShortcutRow({
                        key: 'screenshot',
                        icon: <Camera className={iconClass} />,
                        label: 'Screenshot',
                        keys: shortcuts.takeScreenshot || [getModifierSymbol('cmd'), 'H'],
                    })}
                </div>
            </div>
        </div>
    );
};

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: CustomGhostProps) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);

export default SettingsPopup;
