import { useState, useEffect, useCallback } from 'react';
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
        capturePage: [mod, shift, 'Y'],
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

export const useShortcuts = () => {
    // Initialize state with platform-aware defaults
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(buildDefaultShortcuts);

    // Map backend keybinds (array of objects) to frontend state (ShortcutConfig)
    const mapBackendToFrontend = useCallback((backendKeybinds: any[]) => {
        setShortcuts(prev => {
            const newShortcuts: any = { ...prev };

            backendKeybinds.forEach(kb => {
                const keys = acceleratorToKeys(kb.accelerator);

                // Map backend IDs to frontend keys
                if (kb.id === 'chat:whatToAnswer') newShortcuts.whatToAnswer = keys;
                else if (kb.id === 'app:toggle-global-overlay') newShortcuts.toggleGlobalOverlay = keys;
                else if (kb.id === 'chat:followUp') newShortcuts.followUp = keys;
                else if (kb.id === 'chat:followup') newShortcuts.followUp = keys; // backwards compat
                else if (kb.id === 'chat:clarify') newShortcuts.clarify = keys;
                else if (kb.id === 'chat:dynamicAction4') newShortcuts.dynamicAction4 = keys;
                else if (kb.id === 'chat:answer') newShortcuts.answer = keys;
                else if (kb.id === 'chat:codeHint') newShortcuts.codeHint = keys;
                else if (kb.id === 'chat:brainstorm') newShortcuts.brainstorm = keys;
                else if (kb.id === 'chat:shorten') newShortcuts.shorten = keys;
                else if (kb.id === 'chat:recap') newShortcuts.recap = keys;
                else if (kb.id === 'chat:scrollUp') newShortcuts.scrollUp = keys;
                else if (kb.id === 'chat:scrollDown') newShortcuts.scrollDown = keys;
                else if (kb.id === 'chat:scrollLeft') newShortcuts.scrollLeft = keys;
                else if (kb.id === 'chat:scrollRight') newShortcuts.scrollRight = keys;
                else if (kb.id === 'chat:focusInput') newShortcuts.focusInput = keys;
                else if (kb.id === 'chat:auto-answer-mode') newShortcuts.autoAnswerMode = keys;
                // Window
                else if (kb.id === 'window:move-up') newShortcuts.moveWindowUp = keys;
                else if (kb.id === 'window:move-down') newShortcuts.moveWindowDown = keys;
                else if (kb.id === 'window:move-left') newShortcuts.moveWindowLeft = keys;
                else if (kb.id === 'window:move-right') newShortcuts.moveWindowRight = keys;
                // General
                else if (kb.id === 'general:toggle-visibility') newShortcuts.toggleVisibility = keys;
                else if (kb.id === 'general:toggle-mouse-passthrough') newShortcuts.toggleMousePassthrough = keys;
                else if (kb.id === 'general:process-screenshots') newShortcuts.processScreenshots = keys;
                else if (kb.id === 'general:capture-and-process') newShortcuts.captureAndProcess = keys;
                else if (kb.id === 'general:capture-dom') newShortcuts.capturePage = keys;
                else if (kb.id === 'general:reset-cancel') newShortcuts.resetCancel = keys;
                else if (kb.id === 'general:take-screenshot') newShortcuts.takeScreenshot = keys;
                else if (kb.id === 'general:selective-screenshot') newShortcuts.selectiveScreenshot = keys;
            });

            return newShortcuts;
        });
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
        isShortcutPressed
    };
};
