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
    processScreenshots: string[];
    resetCancel: string[];
    takeScreenshot: string[];
    selectiveScreenshot: string[];
}

export type ShortcutActionId = keyof ShortcutConfig;

export interface ShortcutEnabledConfig {
    whatToAnswer: boolean;
    shorten: boolean;
    followUp: boolean;
    recap: boolean;
    answer: boolean;
    scrollUp: boolean;
    scrollDown: boolean;
    moveWindowUp: boolean;
    moveWindowDown: boolean;
    moveWindowLeft: boolean;
    moveWindowRight: boolean;
    toggleVisibility: boolean;
    processScreenshots: boolean;
    resetCancel: boolean;
    takeScreenshot: boolean;
    selectiveScreenshot: boolean;
}

interface BackendKeybind {
    id: string;
    label: string;
    accelerator: string;
    isGlobal: boolean;
    enabled: boolean;
    defaultEnabled: boolean;
    defaultAccelerator: string;
}

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
    whatToAnswer: acceleratorToKeys('CommandOrControl+Enter'),
    shorten: ['⌃', '⌥', '1'],
    followUp: ['⌃', '⌥', '2'],
    recap: ['⌃', '⌥', '3'],
    answer: ['⌃', '⌥', '4'],
    scrollUp: ['⌃', '⌥', 'I'],
    scrollDown: ['⌃', '⌥', 'K'],
    moveWindowUp: ['⌃', '⌥', 'W'],
    moveWindowDown: ['⌃', '⌥', 'S'],
    moveWindowLeft: ['⌃', '⌥', 'A'],
    moveWindowRight: ['⌃', '⌥', 'D'],
    toggleVisibility: ['⌃', '⌥', 'B'],
    processScreenshots: acceleratorToKeys('CommandOrControl+Shift+Enter'),
    resetCancel: ['⌃', '⌥', 'R'],
    takeScreenshot: ['⌃', '⌥', 'C'],
    selectiveScreenshot: ['⌃', '⌥', 'X']
};

export const DEFAULT_SHORTCUT_ENABLED: ShortcutEnabledConfig = {
    whatToAnswer: true,
    shorten: false,
    followUp: false,
    recap: false,
    answer: false,
    scrollUp: false,
    scrollDown: false,
    moveWindowUp: true,
    moveWindowDown: true,
    moveWindowLeft: true,
    moveWindowRight: true,
    toggleVisibility: true,
    processScreenshots: false,
    resetCancel: false,
    takeScreenshot: true,
    selectiveScreenshot: true
};

const FRONTEND_TO_BACKEND: Record<ShortcutActionId, string> = {
    whatToAnswer: 'chat:whatToAnswer',
    shorten: 'chat:shorten',
    followUp: 'chat:followUp',
    recap: 'chat:recap',
    answer: 'chat:answer',
    scrollUp: 'chat:scrollUp',
    scrollDown: 'chat:scrollDown',
    moveWindowUp: 'window:move-up',
    moveWindowDown: 'window:move-down',
    moveWindowLeft: 'window:move-left',
    moveWindowRight: 'window:move-right',
    toggleVisibility: 'general:toggle-visibility',
    processScreenshots: 'general:process-screenshots',
    resetCancel: 'general:reset-cancel',
    takeScreenshot: 'general:take-screenshot',
    selectiveScreenshot: 'general:selective-screenshot'
};

const BACKEND_TO_FRONTEND: Record<string, ShortcutActionId> = Object.entries(FRONTEND_TO_BACKEND).reduce(
    (mapping, [frontendId, backendId]) => {
        mapping[backendId] = frontendId as ShortcutActionId;
        return mapping;
    },
    {} as Record<string, ShortcutActionId>
);

export const useShortcuts = () => {
    // Initialize state with defaults
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUTS);
    const [enabledShortcuts, setEnabledShortcuts] = useState<ShortcutEnabledConfig>(DEFAULT_SHORTCUT_ENABLED);

    // Map backend keybinds (array of objects) to frontend state (ShortcutConfig)
    const mapBackendToFrontend = useCallback((backendKeybinds: BackendKeybind[]) => {
        const nextShortcuts: ShortcutConfig = { ...DEFAULT_SHORTCUTS };
        const nextEnabled: ShortcutEnabledConfig = { ...DEFAULT_SHORTCUT_ENABLED };

        backendKeybinds.forEach((kb) => {
            const actionId = BACKEND_TO_FRONTEND[kb.id];
            if (!actionId) return;

            nextShortcuts[actionId] = acceleratorToKeys(kb.accelerator);
            nextEnabled[actionId] = kb.enabled;
        });

        setShortcuts(nextShortcuts);
        setEnabledShortcuts(nextEnabled);
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
    const updateShortcut = useCallback(async (actionId: ShortcutActionId, keys: string[]) => {
        // Optimistic update
        setShortcuts(prev => ({ ...prev, [actionId]: keys }));

        const accelerator = keysToAccelerator(keys);
        const backendId = FRONTEND_TO_BACKEND[actionId];

        if (backendId) {
            try {
                await window.electronAPI.setKeybind(backendId, accelerator);
            } catch (error) {
                console.error(`Failed to set keybind for ${actionId}:`, error);
                // Revert optimistic update if needed? For now, we rely on the next update from backend or refresh.
            }
        }
    }, []);

    const updateShortcutEnabled = useCallback(async (actionId: ShortcutActionId, enabled: boolean) => {
        setEnabledShortcuts(prev => ({ ...prev, [actionId]: enabled }));

        const backendId = FRONTEND_TO_BACKEND[actionId];
        if (backendId) {
            try {
                await window.electronAPI.setKeybindEnabled(backendId, enabled);
            } catch (error) {
                console.error(`Failed to set enabled state for ${actionId}:`, error);
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
    const isShortcutPressed = useCallback((event: KeyboardEvent | React.KeyboardEvent, actionId: ShortcutActionId): boolean => {
        if (!enabledShortcuts[actionId]) return false;

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
    }, [enabledShortcuts, shortcuts]);

    return {
        shortcuts,
        enabledShortcuts,
        updateShortcut,
        updateShortcutEnabled,
        resetShortcuts,
        isShortcutPressed
    };
};
