import { useState, useEffect, useCallback, useRef } from 'react';
import { acceleratorToKeys, keysToAccelerator } from '../utils/keyboardUtils';
import { getPlatformShortcut, isMac } from '../utils/platformUtils';

// Define the shape of our shortcuts configuration
export interface ShortcutConfig {
    whatToAnswer: string[];
    autoAnswerMode: string[];
    clarify: string[];
    followUp: string[];
    dynamicAction4: string[];
    answer: string[];
    codeHint: string[];
    brainstorm: string[];
    shorten: string[];
    recap: string[];
    scrollUp: string[];
    scrollDown: string[];
    scrollLeft: string[];
    scrollRight: string[];
    focusInput: string[];
    // Window Movement
    moveWindowUp: string[];
    moveWindowDown: string[];
    moveWindowLeft: string[];
    moveWindowRight: string[];
    // General
    toggleVisibility: string[];
    toggleMousePassthrough: string[];
    processScreenshots: string[];
    captureAndProcess: string[];
    capturePage: string[];
    resetCancel: string[];
    takeScreenshot: string[];
    selectiveScreenshot: string[];
}

function buildDefaultShortcuts(): ShortcutConfig {
    const mod = isMac ? '⌘' : 'Ctrl';
    const shift = isMac ? '⇧' : 'Shift';
    return {
        whatToAnswer: [mod, '1'],
        autoAnswerMode: [mod, 'f'],
        clarify: [mod, '2'],
        dynamicAction4: [mod, '3'],
        followUp: [mod, '4'],
        answer: [mod, '5'],
        codeHint: [mod, '6'],
        brainstorm: [mod, '7'],
        shorten: [],
        recap: [],
        scrollUp: [mod, '↑'],
        scrollDown: [mod, '↓'],
        scrollLeft: [mod, isMac ? '⌥' : 'Alt', '←'],
        scrollRight: [mod, isMac ? '⌥' : 'Alt', '→'],
        focusInput: [mod, shift, 'Space'],
        moveWindowUp: [mod, shift, '↑'],
        moveWindowDown: [mod, shift, '↓'],
        moveWindowLeft: [mod, shift, '←'],
        moveWindowRight: [mod, shift, '→'],
        toggleVisibility: [mod, 'B'],
        toggleMousePassthrough: [mod, shift, 'B'],
        processScreenshots: [mod, 'Enter'],
        captureAndProcess: [mod, shift, 'Enter'],
        capturePage: [mod, 'Y'],
        resetCancel: [mod, 'R'],
        takeScreenshot: [mod, 'H'],
        selectiveScreenshot: [mod, shift, 'H']
    };
}

/**
 * Platform-aware default shortcuts. Computed once at module load using the
 * current process platform — same source of truth as `buildDefaultShortcuts()`
 * below, which is the actual hook initializer. Kept as a named export so
 * consumers that need the defaults synchronously (without invoking the hook)
 * don't see Mac glyphs on Windows.
 *
 * Historical note: this export was previously hardcoded to '⌘'/'⌥'/'⇧'
 * literals, which would surface Mac symbols in any Windows surface that
 * consumed it directly. Replacing the literal with `buildDefaultShortcuts()`
 * keeps the two code paths consistent.
 */
export const DEFAULT_SHORTCUTS: ShortcutConfig = buildDefaultShortcuts();

// Backend keybind id -> frontend ShortcutConfig key. Shared between the
// backend->frontend state mapper and the registration-failure listener below
// so both stay in sync as new keybinds are added.
const BACKEND_ID_TO_ACTION: Partial<Record<string, keyof ShortcutConfig>> = {
    'chat:whatToAnswer': 'whatToAnswer',
    'chat:followUp': 'followUp',
    'chat:followup': 'followUp', // backwards compat
    'chat:clarify': 'clarify',
    'chat:dynamicAction4': 'dynamicAction4',
    'chat:answer': 'answer',
    'chat:codeHint': 'codeHint',
    'chat:brainstorm': 'brainstorm',
    'chat:shorten': 'shorten',
    'chat:recap': 'recap',
    'chat:scrollUp': 'scrollUp',
    'chat:scrollDown': 'scrollDown',
    'chat:scrollLeft': 'scrollLeft',
    'chat:scrollRight': 'scrollRight',
    'chat:focusInput': 'focusInput',
    'chat:auto-answer-mode': 'autoAnswerMode',
    // Window
    'window:move-up': 'moveWindowUp',
    'window:move-down': 'moveWindowDown',
    'window:move-left': 'moveWindowLeft',
    'window:move-right': 'moveWindowRight',
    // General
    'general:toggle-visibility': 'toggleVisibility',
    'general:toggle-mouse-passthrough': 'toggleMousePassthrough',
    'general:process-screenshots': 'processScreenshots',
    'general:capture-and-process': 'captureAndProcess',
    'general:capture-dom': 'capturePage',
    'general:reset-cancel': 'resetCancel',
    'general:take-screenshot': 'takeScreenshot',
    'general:selective-screenshot': 'selectiveScreenshot',
};

export const useShortcuts = () => {
    // Initialize state with platform-aware defaults
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(buildDefaultShortcuts);
    // Backend ids whose globalShortcut.register() call failed (OS or another
    // app already owns that accelerator) — surfaced in Settings so the user
    // knows to rebind rather than assuming the feature is broken.
    const [conflicts, setConflicts] = useState<Set<keyof ShortcutConfig>>(new Set());

    // Map backend keybinds (array of objects) to frontend state (ShortcutConfig)
    const mapBackendToFrontend = useCallback((backendKeybinds: any[]) => {
        setShortcuts(prev => {
            const newShortcuts: any = { ...prev };

            backendKeybinds.forEach(kb => {
                const action = BACKEND_ID_TO_ACTION[kb.id];
                if (action) newShortcuts[action] = acceleratorToKeys(kb.accelerator);
            });

            return newShortcuts;
        });
    }, []);

    // Actions a live event (or the user's own rebind) has already settled
    // since mount. The startup snapshot below resolves asynchronously, so
    // without this an event arriving mid-flight would be overwritten by the
    // older snapshot it raced.
    const pushSettledRef = useRef<Set<keyof ShortcutConfig>>(new Set());

    // Track shortcuts the OS/another app is refusing to hand over, so
    // Settings can flag them instead of leaving a silently dead hotkey.
    useEffect(() => {
        if (!window.electronAPI?.onKeybindRegistrationFailed) return;
        const unsubscribe = window.electronAPI.onKeybindRegistrationFailed(({ id }) => {
            const action = BACKEND_ID_TO_ACTION[id];
            if (!action) return;
            pushSettledRef.current.add(action);
            setConflicts(prev => {
                if (prev.has(action)) return prev;
                const next = new Set(prev);
                next.add(action);
                return next;
            });
        });
        return unsubscribe;
    }, []);

    // Clear the flag once a shortcut re-registers successfully (e.g. right
    // after the user records a new combo for it, or when the health check
    // recovers a combo whose thief has since quit).
    useEffect(() => {
        if (!window.electronAPI?.onKeybindRegistrationSucceeded) return;
        const unsubscribe = window.electronAPI.onKeybindRegistrationSucceeded(({ id }) => {
            const action = BACKEND_ID_TO_ACTION[id];
            if (!action) return;
            pushSettledRef.current.add(action);
            setConflicts(prev => {
                if (!prev.has(action)) return prev;
                const next = new Set(prev);
                next.delete(action);
                return next;
            });
        });
        return unsubscribe;
    }, []);

    // Seed from main's current registration state.
    //
    // The two listeners above only see events fired while this hook is
    // mounted, and the first registration pass runs from KeybindManager's
    // constructor — before any BrowserWindow exists — so a conflict that was
    // present at launch is broadcast to nobody. That is the common case: the
    // rival app is usually already running when Natively starts. Without this
    // snapshot the badges only ever appeared after the user edited some
    // unrelated shortcut and incidentally triggered a full re-registration.
    useEffect(() => {
        if (!window.electronAPI?.getKeybindRegistrationFailures) return;
        let cancelled = false;

        (async () => {
            try {
                const failures = await window.electronAPI.getKeybindRegistrationFailures();
                if (cancelled) return;
                setConflicts(prev => {
                    const next = new Set(prev);
                    let changed = false;
                    failures.forEach(({ id }) => {
                        const action = BACKEND_ID_TO_ACTION[id];
                        // A live event already has the last word for this action.
                        if (!action || pushSettledRef.current.has(action) || next.has(action)) return;
                        next.add(action);
                        changed = true;
                    });
                    return changed ? next : prev;
                });
            } catch (error) {
                console.error('Failed to fetch keybind registration failures:', error);
            }
        })();

        return () => { cancelled = true; };
    }, []);

    // Load from Main Process on mount
    useEffect(() => {
        const fetchKeybinds = async () => {
            try {
                const keybinds = await window.electronAPI.getKeybinds();
                mapBackendToFrontend(keybinds);
            } catch (error) {
                console.error('Failed to fetch keybinds:', error);
            }
        };

        fetchKeybinds();

        // Listen for updates
        const unsubscribe = window.electronAPI.onKeybindsUpdate((keybinds) => {
            mapBackendToFrontend(keybinds);
        });

        return unsubscribe;
    }, [mapBackendToFrontend]);

    // Function to update a specific shortcut
    const updateShortcut = useCallback(async (actionId: keyof ShortcutConfig, keys: string[]) => {
        // Optimistic update
        setShortcuts(prev => ({ ...prev, [actionId]: keys }));
        // Give the conflict badge a chance to clear right away instead of
        // waiting on the round-trip to main and back. Marked as settled so a
        // slow startup snapshot cannot resurrect the badge the user just
        // cleared by rebinding.
        pushSettledRef.current.add(actionId);
        setConflicts(prev => {
            if (!prev.has(actionId)) return prev;
            const next = new Set(prev);
            next.delete(actionId);
            return next;
        });

        const accelerator = keysToAccelerator(keys);
        let backendId = '';

        // Map frontend key back to backend ID
        switch (actionId) {
            case 'whatToAnswer': backendId = 'chat:whatToAnswer'; break;
            case 'autoAnswerMode': backendId = 'chat:auto-answer-mode'; break;
            case 'clarify': backendId = 'chat:clarify'; break;
            case 'followUp': backendId = 'chat:followUp'; break;
            case 'dynamicAction4': backendId = 'chat:dynamicAction4'; break;
            case 'answer': backendId = 'chat:answer'; break;
            case 'codeHint': backendId = 'chat:codeHint'; break;
            case 'brainstorm': backendId = 'chat:brainstorm'; break;
            case 'shorten': backendId = 'chat:shorten'; break;
            case 'recap': backendId = 'chat:recap'; break;
            case 'scrollUp': backendId = 'chat:scrollUp'; break;
            case 'scrollDown': backendId = 'chat:scrollDown'; break;
            case 'scrollLeft': backendId = 'chat:scrollLeft'; break;
            case 'scrollRight': backendId = 'chat:scrollRight'; break;
            case 'focusInput': backendId = 'chat:focusInput'; break;
            // Window
            case 'moveWindowUp': backendId = 'window:move-up'; break;
            case 'moveWindowDown': backendId = 'window:move-down'; break;
            case 'moveWindowLeft': backendId = 'window:move-left'; break;
            case 'moveWindowRight': backendId = 'window:move-right'; break;
            // General
            case 'toggleVisibility': backendId = 'general:toggle-visibility'; break;
            case 'toggleMousePassthrough': backendId = 'general:toggle-mouse-passthrough'; break;
            case 'processScreenshots': backendId = 'general:process-screenshots'; break;
            case 'captureAndProcess': backendId = 'general:capture-and-process'; break;
            case 'capturePage': backendId = 'general:capture-dom'; break;
            case 'resetCancel': backendId = 'general:reset-cancel'; break;
            case 'takeScreenshot': backendId = 'general:take-screenshot'; break;
            case 'selectiveScreenshot': backendId = 'general:selective-screenshot'; break;
            default: break;
        }

        if (backendId) {
            try {
                await window.electronAPI.setKeybind(backendId, accelerator);
            } catch (error) {
                console.error(`Failed to set keybind for ${actionId}:`, error);
            }
        }
    }, []);

    // Function to reset all shortcuts to defaults
    const resetShortcuts = useCallback(async () => {
        try {
            const defaults = await window.electronAPI.resetKeybinds();
            mapBackendToFrontend(defaults);
        } catch (error) {
            console.error('Failed to reset keybinds:', error);
        }
    }, [mapBackendToFrontend]);

    // Helper to check if a keyboard event matches a configured shortcut
    const isShortcutPressed = useCallback((event: KeyboardEvent | React.KeyboardEvent, actionId: keyof ShortcutConfig): boolean => {
        const keys = shortcuts[actionId];
        if (!keys || keys.length === 0) return false;

        // Check modifiers — platform-aware:
        // On Mac: ⌘ = metaKey. On Win/Linux: Ctrl maps to ctrlKey.
        // 'CommandOrControl' (⌘/Ctrl) matches metaKey on Mac, ctrlKey on Win/Linux.
        const isCommandOrControl = (k: string) =>
            ['⌘', 'Command', 'Meta', 'CommandOrControl'].includes(k);
        const isCtrl = (k: string) =>
            ['⌃', 'Control', 'Ctrl'].includes(k);

        const hasCommandOrControl = keys.some(isCommandOrControl);
        const hasCtrlOnly = !hasCommandOrControl && keys.some(isCtrl);
        const hasAlt = keys.some(k => ['⌥', 'Alt', 'Option'].includes(k));
        const hasShift = keys.some(k => ['⇧', 'Shift'].includes(k));

        if (isMac) {
            // On Mac: ⌘ = metaKey, ⌃ = ctrlKey
            if (event.metaKey !== hasCommandOrControl) return false;
            if (event.ctrlKey !== hasCtrlOnly) return false;
        } else {
            // On Win/Linux: both ⌘ and Ctrl map to ctrlKey
            const needsCtrl = hasCommandOrControl || hasCtrlOnly;
            if (event.ctrlKey !== needsCtrl) return false;
            if (event.metaKey) return false; // metaKey should never be pressed on Windows
        }
        if (event.altKey !== hasAlt) return false;
        if (event.shiftKey !== hasShift) return false;

        // Find the main non-modifier key
        const mainKey = keys.find(k =>
            !['⌘', 'Command', 'Meta', '⇧', 'Shift', '⌥', 'Alt', 'Option', '⌃', 'Control', 'Ctrl'].includes(k)
        );

        if (!mainKey) return false; // Modifiers only

        // Normalize checks
        const eventKey = event.key.toLowerCase();
        let configKey = mainKey.toLowerCase();

        if (configKey === '↑') configKey = 'arrowup';
        if (configKey === '↓') configKey = 'arrowdown';
        if (configKey === '←') configKey = 'arrowleft';
        if (configKey === '→') configKey = 'arrowright';

        // Handle Space specifically
        if (configKey === 'space') {
            return event.code === 'Space';
        }

        // Handle Arrow keys
        // Electron accelerator uses 'ArrowUp' (mapped from 'Up'), event.key is 'ArrowUp'
        // So direct comparison usually works

        return eventKey === configKey;
    }, [shortcuts]);

    return {
        shortcuts,
        updateShortcut,
        resetShortcuts,
        isShortcutPressed,
        conflicts
    };
};
