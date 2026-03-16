import { nativeTheme, ipcMain, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeConfig {
    mode: ThemeMode;
}

export class ThemeManager {
    private static instance: ThemeManager;
    private mode: ThemeMode = 'system';
    private configPath: string;

    private constructor() {
        this.configPath = path.join(app.getPath('userData'), 'theme-config.json');
        this.loadConfig();
        this.setupListeners();
    }

    public static getInstance(): ThemeManager {
        if (!ThemeManager.instance) {
            ThemeManager.instance = new ThemeManager();
        }
        return ThemeManager.instance;
    }

    private loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                const config = JSON.parse(data) as ThemeConfig;
                if (['system', 'light', 'dark'].includes(config.mode)) {
                    this.mode = config.mode;
                }
            }
        } catch (error) {
            console.error('Failed to load theme config:', error);
        }
    }

    private saveConfig() {
        try {
            const config: ThemeConfig = { mode: this.mode };
            const tmpPath = this.configPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
            fs.renameSync(tmpPath, this.configPath);
        } catch (error) {
            console.error('[ThemeManager] Failed to save config:', error);
        }
    }

    private setupListeners() {
        nativeTheme.on('updated', () => {
            if (this.mode === 'system') {
                this.broadcastThemeChange();
            }
        });
    }

    public getMode(): ThemeMode {
        return this.mode;
    }

    public setMode(mode: ThemeMode) {
        this.mode = mode;
        this.saveConfig();

        // Force native theme update if not system, so electron internal UI matches if possible
        if (mode === 'dark') {
            nativeTheme.themeSource = 'dark';
        } else if (mode === 'light') {
            nativeTheme.themeSource = 'light';
        } else {
            nativeTheme.themeSource = 'system';
        }

        this.broadcastThemeChange();
    }

    public getResolvedTheme(): ResolvedTheme {
        if (this.mode === 'system') {
            return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        }
        return this.mode;
    }

    public broadcastThemeChange() {
        const payload = {
            mode: this.mode,
            resolved: this.getResolvedTheme()
        };

        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('theme:changed', payload);
            }
        });
    }
}
