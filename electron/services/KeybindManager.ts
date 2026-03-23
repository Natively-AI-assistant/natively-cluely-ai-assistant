import { app, globalShortcut, Menu, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

export interface KeybindConfig {
    id: string;
    label: string;
    accelerator: string; // Electron Accelerator string
    isGlobal: boolean;   // Registered with globalShortcut
    defaultAccelerator: string;
}

export const DEFAULT_KEYBINDS: KeybindConfig[] = [
    // General
    { id: 'general:toggle-visibility', label: 'Toggle Visibility', accelerator: 'CommandOrControl+B', isGlobal: true, defaultAccelerator: 'CommandOrControl+B' },
    { id: 'general:toggle-mouse-passthrough', label: 'Toggle Mouse Passthrough', accelerator: 'CommandOrControl+Shift+B', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+B' },
    { id: 'general:process-screenshots', label: 'Process Screenshots', accelerator: 'CommandOrControl+Enter', isGlobal: true, defaultAccelerator: 'CommandOrControl+Enter' },
    { id: 'general:capture-and-process', label: 'Capture Screen & Ask AI (Global)', accelerator: 'CommandOrControl+Shift+Enter', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Enter' },
    { id: 'general:reset-cancel', label: 'Reset / Cancel', accelerator: 'CommandOrControl+R', isGlobal: true, defaultAccelerator: 'CommandOrControl+R' },
    { id: 'general:take-screenshot', label: 'Take Screenshot', accelerator: 'CommandOrControl+H', isGlobal: true, defaultAccelerator: 'CommandOrControl+H' },
    { id: 'general:selective-screenshot', label: 'Selective Screenshot', accelerator: 'CommandOrControl+Shift+H', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+H' },

    // Chat - Global shortcuts (work even when app is not focused - stealth mode)
    { id: 'chat:whatToAnswer', label: 'What to Answer', accelerator: 'CommandOrControl+1', isGlobal: true, defaultAccelerator: 'CommandOrControl+1' },
    { id: 'chat:clarify', label: 'Clarify', accelerator: 'CommandOrControl+2', isGlobal: true, defaultAccelerator: 'CommandOrControl+2' },
    { id: 'chat:followUp', label: 'Follow Up', accelerator: 'CommandOrControl+3', isGlobal: true, defaultAccelerator: 'CommandOrControl+3' },
    { id: 'chat:dynamicAction4', label: 'Recap / Brainstorm', accelerator: 'CommandOrControl+4', isGlobal: true, defaultAccelerator: 'CommandOrControl+4' },
    { id: 'chat:answer', label: 'Answer / Record', accelerator: 'CommandOrControl+5', isGlobal: true, defaultAccelerator: 'CommandOrControl+5' },
    { id: 'chat:codeHint', label: 'Get Code Hint', accelerator: 'CommandOrControl+6', isGlobal: true, defaultAccelerator: 'CommandOrControl+6' },
    { id: 'chat:brainstorm', label: 'Brainstorm Approaches', accelerator: 'CommandOrControl+7', isGlobal: true, defaultAccelerator: 'CommandOrControl+7' },
    { id: 'chat:scrollUp', label: 'Scroll Up', accelerator: 'CommandOrControl+Up', isGlobal: true, defaultAccelerator: 'CommandOrControl+Up' },
    { id: 'chat:scrollDown', label: 'Scroll Down', accelerator: 'CommandOrControl+Down', isGlobal: true, defaultAccelerator: 'CommandOrControl+Down' },

    // Window Movement - Global shortcuts (stealth window positioning)
    { id: 'window:move-up', label: 'Move Window Up', accelerator: 'CommandOrControl+Shift+Up', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Up' },
    { id: 'window:move-down', label: 'Move Window Down', accelerator: 'CommandOrControl+Shift+Down', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Down' },
    { id: 'window:move-left', label: 'Move Window Left', accelerator: 'CommandOrControl+Shift+Left', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Left' },
    { id: 'window:move-right', label: 'Move Window Right', accelerator: 'CommandOrControl+Shift+Right', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Right' },
];

export class KeybindManager {
    private static instance: KeybindManager;
    private keybinds: Map<string, KeybindConfig> = new Map();
    private filePath: string;
    private windowHelper: any; // Type avoided for circular dep, passed in init
    private onUpdateCallbacks: (() => void)[] = [];
    private onShortcutTriggeredCallbacks: ((actionId: string) => void)[] = [];
    private activeMode: 'launcher' | 'overlay' = 'launcher';

    public setMode(mode: 'launcher' | 'overlay') {
        if (this.activeMode === mode) return;
        this.activeMode = mode;
        console.log(`[KeybindManager] Mode changed to: ${mode}. Refreshing global shortcuts.`);
        this.registerGlobalShortcuts();
    }

    private shouldRegister(actionId: string): boolean {
        if (this.activeMode === 'overlay') return true;
        
        // In launcher mode, only register specific shortcuts
        if (actionId === 'general:toggle-visibility') return true;
        if (actionId === 'general:toggle-mouse-passthrough') return true;
        if (actionId.startsWith('window:move-')) return true;
        
        return false;
    }

    private normalizeAccelerator(acc: string): string {
        if (!acc) return '';
        // Electron accelerators are case-insensitive and order-independent for modifiers.
        // We split, lowercase, and sort to ensure consistent string matching.
        // E.g., 'Shift+CommandOrControl+Up' === 'CommandOrControl+Shift+Up'
        const parts = acc.split('+').map(p => p.trim().toLowerCase());
        parts.sort();
        return parts.join('+');
    }

    private constructor() {
        this.filePath = path.join(app.getPath('userData'), 'keybinds.json');
        this.load();
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

                // Migrate renamed IDs so saved user customizations survive renames
                const ID_MIGRATIONS: Record<string, string> = {
                    'chat:recap': 'chat:dynamicAction4',
                };
                for (const fileKb of data) {
                    if (ID_MIGRATIONS[fileKb.id]) {
                        fileKb.id = ID_MIGRATIONS[fileKb.id];
                    }
                }

                // Validate and merge
                let hadConflicts = false;
                for (const fileKb of data) {
                    if (this.keybinds.has(fileKb.id)) {
                        const current = this.keybinds.get(fileKb.id)!;

                        // Deduplicate: If another keybind is already using this accelerator, skip or clear it
                        if (fileKb.accelerator && fileKb.accelerator.trim() !== '') {
                            let conflictId: string | null = null;
                            const normalizedNew = this.normalizeAccelerator(fileKb.accelerator);
                            this.keybinds.forEach((kb, existingId) => {
                                if (existingId !== fileKb.id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                                    conflictId = existingId;
                                }
                            });
                            
                            if (conflictId) {
                                // EC-03 fix: mark that we resolved a conflict so we can persist below
                                const conflictKb = this.keybinds.get(conflictId)!;
                                conflictKb.accelerator = '';
                                this.keybinds.set(conflictId, conflictKb);
                                hadConflicts = true;
                            }
                        }

                        current.accelerator = fileKb.accelerator;
                        this.keybinds.set(fileKb.id, current);
                    }
                }

                // EC-03 fix: persist resolved conflicts so they are not re-detected on next launch
                if (hadConflicts) {
                    this.save();
                }
            }
        } catch (error) {
            console.error('[KeybindManager] Failed to load keybinds:', error);
        }
    }

    private save() {
        try {
            const data = Array.from(this.keybinds.values()).map(kb => ({
                id: kb.id,
                accelerator: kb.accelerator
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

    public getAllKeybinds(): KeybindConfig[] {
        return Array.from(this.keybinds.values());
    }

    public setKeybind(id: string, accelerator: string) {
        if (!this.keybinds.has(id)) return;

        const currentKb = this.keybinds.get(id)!;
        const oldAccelerator = currentKb.accelerator || '';

        // Fallback: If assigning a new accelerator, swap any existing action using it
        if (accelerator && accelerator.trim() !== '') {
            const normalizedNew = this.normalizeAccelerator(accelerator);
            let swappedId: string | null = null;

            this.keybinds.forEach((kb, existingId) => {
                if (existingId !== id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                    swappedId = existingId;
                }
            });

            if (swappedId) {
                const conflictKb = this.keybinds.get(swappedId)!;
                conflictKb.accelerator = oldAccelerator; // Give the conflicting one our old shortcut
                this.keybinds.set(swappedId, conflictKb);
            }
        }

        currentKb.accelerator = accelerator;
        this.keybinds.set(id, currentKb);

        this.save();
        this.registerGlobalShortcuts(); // Re-register if it was a global one
        this.broadcastUpdate();
    }

    public resetKeybinds() {
        this.keybinds.clear();
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));
        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public registerGlobalShortcuts() {
        globalShortcut.unregisterAll();

        this.keybinds.forEach(kb => {
            if (kb.isGlobal && kb.accelerator && kb.accelerator.trim() !== '') {
                if (!this.shouldRegister(kb.id)) return;

                const acc = kb.accelerator.trim();
                try {
                    globalShortcut.register(acc, () => {
                        this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
                    });
                    if (globalShortcut.isRegistered(acc)) {
                        console.log(`[KeybindManager] Registered global shortcut: ${acc} -> ${kb.id}`);
                    } else {
                        console.warn(`[KeybindManager] Failed to register global shortcut (likely in use by OS): ${acc}`);
                    }
                } catch (e) {
                    console.error(`[KeybindManager] Exception while registering global shortcut ${acc}:`, e);
                }
            }
        });

        this.updateMenu();
    }

    public updateMenu() {
        // Don't set application menu on Windows/Linux - hide it completely
        if (process.platform !== 'darwin') {
            Menu.setApplicationMenu(null);
            return;
        }

        const toggleKb = this.keybinds.get('general:toggle-visibility');
        const toggleAccelerator = toggleKb ? toggleKb.accelerator : 'CommandOrControl+B';

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
                        accelerator: toggleAccelerator || undefined,
                        click: () => {
                            // Require AppState dynamically to avoid circular dependencies
                            const { AppState } = require('../main');
                            AppState.getInstance().toggleMainWindow();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Move Window Up',
                        accelerator: this.getKeybind('window:move-up') || undefined,
                        click: () => this.windowHelper?.moveWindowUp()
                    },
                    {
                        label: 'Move Window Down',
                        accelerator: this.getKeybind('window:move-down') || undefined,
                        click: () => this.windowHelper?.moveWindowDown()
                    },
                    {
                        label: 'Move Window Left',
                        accelerator: this.getKeybind('window:move-left') || undefined,
                        click: () => this.windowHelper?.moveWindowLeft()
                    },
                    {
                        label: 'Move Window Right',
                        accelerator: this.getKeybind('window:move-right') || undefined,
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

        ipcMain.handle('keybinds:reset', () => {
            console.log('[KeybindManager] Reset defaults');
            this.resetKeybinds();
            return this.getAllKeybinds();
        });
    }
}
