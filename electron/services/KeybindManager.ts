import { app, globalShortcut, Menu, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

export interface KeybindConfig {
    id: string;
    label: string;
    accelerator: string; // Electron Accelerator string
    isGlobal: boolean;   // Registered with globalShortcut
    enabled: boolean;
    defaultEnabled: boolean;
    defaultAccelerator: string;
}

const createKeybind = (
    id: string,
    label: string,
    accelerator: string,
    defaultEnabled: boolean,
    isGlobal: boolean = true
): KeybindConfig => ({
    id,
    label,
    accelerator,
    isGlobal,
    enabled: defaultEnabled,
    defaultEnabled,
    defaultAccelerator: accelerator
});

const AUTO_MIGRATED_ACCELERATORS: Partial<Record<string, string[]>> = {
    'general:toggle-visibility': ['CommandOrControl+B', 'Control+Alt+Shift+B'],
    'general:process-screenshots': ['CommandOrControl+Enter', 'Control+Alt+Enter'],
    'general:reset-cancel': ['CommandOrControl+R', 'Control+Alt+Shift+R'],
    'general:take-screenshot': ['CommandOrControl+H', 'Control+Alt+Shift+C'],
    'general:selective-screenshot': ['CommandOrControl+Shift+H', 'Control+Alt+Shift+X'],
    'chat:whatToAnswer': ['CommandOrControl+1', 'Control+Alt+Shift+Q', 'Control+Alt+Q'],
    'chat:shorten': ['CommandOrControl+2', 'Control+Alt+Shift+1'],
    'chat:followUp': ['CommandOrControl+3', 'Control+Alt+Shift+2'],
    'chat:recap': ['CommandOrControl+4', 'Control+Alt+Shift+3'],
    'chat:answer': ['CommandOrControl+5', 'Control+Alt+Shift+4'],
    'chat:scrollUp': ['CommandOrControl+Up'],
    'chat:scrollDown': ['CommandOrControl+Down'],
    'window:move-up': ['CommandOrControl+Up', 'Control+Alt+Shift+W'],
    'window:move-down': ['CommandOrControl+Down', 'Control+Alt+Shift+S'],
    'window:move-left': ['CommandOrControl+Left', 'Control+Alt+Shift+A'],
    'window:move-right': ['CommandOrControl+Right', 'Control+Alt+Shift+D']
};

export const DEFAULT_KEYBINDS: KeybindConfig[] = [
    // General
    createKeybind('general:toggle-visibility', 'Toggle Visibility', 'Control+Alt+B', true),
    createKeybind('general:process-screenshots', 'Process Screenshots', 'CommandOrControl+Shift+Enter', false),
    createKeybind('general:reset-cancel', 'Reset / Cancel', 'Control+Alt+R', false),
    createKeybind('general:take-screenshot', 'Take Screenshot', 'Control+Alt+C', true),
    createKeybind('general:selective-screenshot', 'Selective Screenshot', 'Control+Alt+X', true),

    // Chat
    createKeybind('chat:whatToAnswer', 'What to Answer', 'CommandOrControl+Enter', true),
    createKeybind('chat:shorten', 'Shorten', 'Control+Alt+1', false),
    createKeybind('chat:followUp', 'Follow Up', 'Control+Alt+2', false),
    createKeybind('chat:recap', 'Recap', 'Control+Alt+3', false),
    createKeybind('chat:answer', 'Answer / Record', 'Control+Alt+4', false),
    createKeybind('chat:scrollUp', 'Scroll Up', 'Control+Alt+I', false),
    createKeybind('chat:scrollDown', 'Scroll Down', 'Control+Alt+K', false),

    // Window Movement
    createKeybind('window:move-up', 'Move Window Up', 'Control+Alt+W', true),
    createKeybind('window:move-down', 'Move Window Down', 'Control+Alt+S', true),
    createKeybind('window:move-left', 'Move Window Left', 'Control+Alt+A', true),
    createKeybind('window:move-right', 'Move Window Right', 'Control+Alt+D', true),
];

export class KeybindManager {
    private static instance: KeybindManager;
    private keybinds: Map<string, KeybindConfig> = new Map();
    private filePath: string;
    private windowHelper: any; // Type avoided for circular dep, passed in init
    private onUpdateCallbacks: (() => void)[] = [];
    private onShortcutTriggeredCallbacks: ((actionId: string) => void)[] = [];

    private constructor() {
        this.filePath = path.join(app.getPath('userData'), 'keybinds.json');
        this.load();
    }

    private normalizeAccelerator(accelerator: string): string {
        return accelerator.trim().toLowerCase();
    }

    private resolveEnabledConflicts(preferredId?: string) {
        if (preferredId) {
            const preferred = this.keybinds.get(preferredId);
            if (!preferred?.enabled || !preferred.accelerator.trim()) {
                return;
            }

            const normalizedPreferred = this.normalizeAccelerator(preferred.accelerator);
            this.keybinds.forEach((kb, id) => {
                if (
                    id !== preferredId &&
                    kb.enabled &&
                    kb.accelerator.trim() !== '' &&
                    this.normalizeAccelerator(kb.accelerator) === normalizedPreferred
                ) {
                    kb.enabled = false;
                    this.keybinds.set(id, kb);
                    console.warn(`[KeybindManager] Disabled conflicting shortcut ${id} in favor of ${preferredId}`);
                }
            });
            return;
        }

        const seen = new Map<string, string>();
        this.keybinds.forEach((kb, id) => {
            if (!kb.enabled || kb.accelerator.trim() === '') {
                return;
            }

            const normalized = this.normalizeAccelerator(kb.accelerator);
            const owner = seen.get(normalized);
            if (!owner) {
                seen.set(normalized, id);
                return;
            }

            kb.enabled = false;
            this.keybinds.set(id, kb);
            console.warn(`[KeybindManager] Disabled conflicting shortcut ${id} while loading settings; ${owner} keeps ${kb.accelerator}`);
        });
    }

    public onUpdate(callback: () => void) {
        this.onUpdateCallbacks.push(callback);
    }

    public onShortcutTriggered(callback: (actionId: string) => void) {
        this.onShortcutTriggeredCallbacks.push(callback);
    }

    public static getInstance(): KeybindManager {
        if (!KeybindManager.instance) {
            KeybindManager.instance = new KeybindManager();
        }
        return KeybindManager.instance;
    }

    public setWindowHelper(windowHelper: any) {
        this.windowHelper = windowHelper;
        // Re-register globals now that we have the helper
        this.registerGlobalShortcuts();
    }

    private load() {
        // 1. Load Defaults
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));

        // 2. Load Overrides
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
                // Validate and merge
                for (const fileKb of data) {
                    if (this.keybinds.has(fileKb.id)) {
                        const current = this.keybinds.get(fileKb.id)!;
                        if (typeof fileKb.accelerator === 'string') {
                            const legacyDefaults = AUTO_MIGRATED_ACCELERATORS[fileKb.id] || [];
                            const shouldPreserveNewDefault =
                                legacyDefaults.includes(fileKb.accelerator);

                            if (!shouldPreserveNewDefault) {
                                current.accelerator = fileKb.accelerator;
                            }
                        }
                        if (typeof fileKb.enabled === 'boolean') {
                            current.enabled = fileKb.enabled;
                        }
                        this.keybinds.set(fileKb.id, current);
                    }
                }
            }
            this.resolveEnabledConflicts();
        } catch (error) {
            console.error('[KeybindManager] Failed to load keybinds:', error);
        }
    }

    private save() {
        try {
            const data = Array.from(this.keybinds.values()).map(kb => ({
                id: kb.id,
                accelerator: kb.accelerator,
                enabled: kb.enabled
            }));
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
            fs.renameSync(tmpPath, this.filePath);
        } catch (error) {
            console.error('[KeybindManager] Failed to save keybinds:', error);
        }
    }

    public getKeybind(id: string): string | undefined {
        return this.keybinds.get(id)?.accelerator;
    }

    public getKeybindConfig(id: string): KeybindConfig | undefined {
        return this.keybinds.get(id);
    }

    public isKeybindEnabled(id: string): boolean {
        return this.keybinds.get(id)?.enabled ?? false;
    }

    public getAllKeybinds(): KeybindConfig[] {
        return Array.from(this.keybinds.values());
    }

    public setKeybind(id: string, accelerator: string) {
        if (!this.keybinds.has(id)) return;

        const kb = this.keybinds.get(id)!;
        kb.accelerator = accelerator;
        this.keybinds.set(id, kb);
        this.resolveEnabledConflicts(id);

        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public setKeybindEnabled(id: string, enabled: boolean) {
        if (!this.keybinds.has(id)) return;

        const kb = this.keybinds.get(id)!;
        kb.enabled = enabled;
        this.keybinds.set(id, kb);

        if (enabled) {
            this.resolveEnabledConflicts(id);
        }

        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public resetKeybinds() {
        this.keybinds.clear();
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));
        this.resolveEnabledConflicts();
        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public registerGlobalShortcuts() {
        globalShortcut.unregisterAll();

        // Register global shortcuts
        this.keybinds.forEach(kb => {
            if (kb.isGlobal && kb.enabled && kb.accelerator && kb.accelerator.trim() !== '') {
                try {
                    globalShortcut.register(kb.accelerator, () => {
                        this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
                    });
                    if (!globalShortcut.isRegistered(kb.accelerator)) {
                        console.error(`[KeybindManager] Failed to register global shortcut ${kb.accelerator}`);
                    }
                } catch (e) {
                    console.error(`[KeybindManager] Failed to register global shortcut ${kb.accelerator}:`, e);
                }
            }
        });

        this.updateMenu();
    }

    public updateMenu() {
        const template: any[] = [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide', accelerator: 'CommandOrControl+Option+H' },
                    { role: 'hideOthers', accelerator: 'CommandOrControl+Option+Shift+H' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            {
                role: 'editMenu'
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Toggle Visibility',
                        click: () => {
                            // Require AppState dynamically to avoid circular dependencies
                            const { AppState } = require('../main');
                            AppState.getInstance().toggleMainWindow();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Move Window Up',
                        click: () => this.windowHelper?.moveWindowUp()
                    },
                    {
                        label: 'Move Window Down',
                        click: () => this.windowHelper?.moveWindowDown()
                    },
                    {
                        label: 'Move Window Left',
                        click: () => this.windowHelper?.moveWindowLeft()
                    },
                    {
                        label: 'Move Window Right',
                        click: () => this.windowHelper?.moveWindowRight()
                    },
                    { type: 'separator' },
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            },
            {
                role: 'windowMenu'
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Learn More',
                        click: async () => {
                            const { shell } = require('electron');
                            await shell.openExternal('https://electronjs.org');
                        }
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
        console.log('[KeybindManager] Application menu updated');
    }

    private broadcastUpdate() {
        // Notify main process listeners
        this.onUpdateCallbacks.forEach(cb => cb());

        const windows = BrowserWindow.getAllWindows();
        const allKeybinds = this.getAllKeybinds();
        windows.forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('keybinds:update', allKeybinds);
            }
        });
    }

    public setupIpcHandlers() {
        ipcMain.handle('keybinds:get-all', () => {
            return this.getAllKeybinds();
        });

        ipcMain.handle('keybinds:set', (_, id: string, accelerator: string) => {
            console.log(`[KeybindManager] Set ${id} -> ${accelerator}`);
            this.setKeybind(id, accelerator);
            return true;
        });

        ipcMain.handle('keybinds:set-enabled', (_, id: string, enabled: boolean) => {
            console.log(`[KeybindManager] Set enabled ${id} -> ${enabled}`);
            this.setKeybindEnabled(id, enabled);
            return true;
        });

        ipcMain.handle('keybinds:reset', () => {
            console.log('[KeybindManager] Reset defaults');
            this.resetKeybinds();
            return this.getAllKeybinds();
        });
    }
}
