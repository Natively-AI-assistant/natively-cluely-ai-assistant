import { useState, useEffect, useCallback } from 'react';
import { acceleratorToKeys, keysToAccelerator } from '../utils/keyboardUtils';

// Define the shape of our shortcuts configuration
export interface ShortcutConfig {
    whatToAnswer: string[];
    shorten: string[];
    followUp: string[];
    recap: string[];
    answer: string[];
    scrollUp: string[];
    scrollDown: string[];
    // Window Movement
    moveWindowUp: string[];
    moveWindowDown: string[];
    moveWindowLeft: string[];
    moveWindowRight: string[];
    // General
    toggleVisibility: string[];
    toggleMousePassthrough: string[];
    processScreenshots: string[];
    resetCancel: string[];
    takeScreenshot: string[];
    selectiveScreenshot: string[];
}

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
    whatToAnswer: ['⌘', '1'],
    shorten: ['⌘', '2'],
    followUp: ['⌘', '3'],
    recap: ['⌘', '4'],
    answer: ['⌘', '5'],
    scrollUp: ['↑'],
    scrollDown: ['↓'],
    moveWindowUp: ['⌘', '↑'],
    moveWindowDown: ['⌘', '↓'],
    moveWindowLeft: ['⌘', '←'],
    moveWindowRight: ['⌘', '→'],
    toggleVisibility: ['⌘', 'B'],
    toggleMousePassthrough: ['⌘', 'Shift', 'B'],
    processScreenshots: ['⌘', 'Enter'],
    resetCancel: ['⌘', 'R'],
    takeScreenshot: ['⌘', 'H'],
    selectiveScreenshot: ['⌘', 'Shift', 'H']
};

export const useShortcuts = () => {
    // Initialize state with defaults
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUTS);

    // Map backend keybinds (array of objects) to frontend state (ShortcutConfig)
    const mapBackendToFrontend = useCallback((backendKeybinds: any[]) => {
        setShortcuts(prev => {
            const newShortcuts: any = { ...prev };

            backendKeybinds.forEach(kb => {
                const keys = acceleratorToKeys(kb.accelerator);

                // Map backend IDs to frontend keys
                if (kb.id === 'chat:whatToAnswer') newShortcuts.whatToAnswer = keys;
                else if (kb.id === 'chat:shorten') newShortcuts.shorten = keys;
                else if (kb.id === 'chat:followUp') newShortcuts.followUp = keys;
                else if (kb.id === 'chat:recap') newShortcuts.recap = keys;
                else if (kb.id === 'chat:answer') newShortcuts.answer = keys;
                else if (kb.id === 'chat:scrollUp') newShortcuts.scrollUp = keys;
                else if (kb.id === 'chat:scrollDown') newShortcuts.scrollDown = keys;
                // Window
                else if (kb.id === 'window:move-up') newShortcuts.moveWindowUp = keys;
                else if (kb.id === 'window:move-down') newShortcuts.moveWindowDown = keys;
                else if (kb.id === 'window:move-left') newShortcuts.moveWindowLeft = keys;
                else if (kb.id === 'window:move-right') newShortcuts.moveWindowRight = keys;
                // General
                else if (kb.id === 'general:toggle-visibility') newShortcuts.toggleVisibility = keys;
                else if (kb.id === 'general:toggle-mouse-passthrough') newShortcuts.toggleMousePassthrough = keys;
                else if (kb.id === 'general:process-screenshots') newShortcuts.processScreenshots = keys;
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
        if (actionId === 'whatToAnswer') backendId = 'chat:whatToAnswer';
        else if (actionId === 'shorten') backendId = 'chat:shorten';
        else if (actionId === 'followUp') backendId = 'chat:followUp';
        else if (actionId === 'recap') backendId = 'chat:recap';
        else if (actionId === 'answer') backendId = 'chat:answer';
        else if (actionId === 'scrollUp') backendId = 'chat:scrollUp';
        else if (actionId === 'scrollDown') backendId = 'chat:scrollDown';
        // Window
        else if (actionId === 'moveWindowUp') backendId = 'window:move-up';
        else if (actionId === 'moveWindowDown') backendId = 'window:move-down';
        else if (actionId === 'moveWindowLeft') backendId = 'window:move-left';
        else if (actionId === 'moveWindowRight') backendId = 'window:move-right';
        // General
        else if (actionId === 'toggleVisibility') backendId = 'general:toggle-visibility';
        else if (actionId === 'toggleMousePassthrough') backendId = 'general:toggle-mouse-passthrough';
        else if (actionId === 'processScreenshots') backendId = 'general:process-screenshots';
        else if (actionId === 'resetCancel') backendId = 'general:reset-cancel';
        else if (actionId === 'takeScreenshot') backendId = 'general:take-screenshot';
        else if (actionId === 'selectiveScreenshot') backendId = 'general:selective-screenshot';

        if (backendId) {
            try {
                await window.electronAPI.setKeybind(backendId, accelerator);
            } catch (error) {
                console.error(`Failed to set keybind for ${actionId}:`, error);
                // Revert optimistic update if needed? For now, we rely on the next update from backend or refresh.
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

        // Check modifiers
        // Note: We use the symbols now in UI, but keyboard events still use standard properties
        const hasMeta = keys.some(k => ['⌘', 'Command', 'Meta'].includes(k));
        const hasCtrl = keys.some(k => ['⌃', 'Control', 'Ctrl'].includes(k));
        const hasAlt = keys.some(k => ['⌥', 'Alt', 'Option'].includes(k));
        const hasShift = keys.some(k => ['⇧', 'Shift'].includes(k));

        if (event.metaKey !== hasMeta) return false;
        if (event.ctrlKey !== hasCtrl) return false;
        if (event.altKey !== hasAlt) return false;
        if (event.shiftKey !== hasShift) return false;

        // Find the main non-modifier key
        const mainKey = keys.find(k =>
            !['⌘', 'Command', 'Meta', '⇧', 'Shift', '⌥', 'Alt', 'Option', '⌃', 'Control', 'Ctrl'].includes(k)
        );

        if (!mainKey) return false; // Modifiers only

        // Normalize checks
        const eventKey = event.key.toLowerCase();
        const configKey = mainKey.toLowerCase();

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
