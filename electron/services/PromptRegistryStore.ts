import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, BrowserWindow } from 'electron';
import type { BuiltinPromptId } from '../llm/promptCatalog';
import { PROMPT_CATALOG, BUILTIN_PROMPT_IDS } from '../llm/promptCatalog';
import { formatAcceleratorDisplay } from '../utils/formatAcceleratorDisplay';

export const CUSTOM_PROMPT_KEYBIND_PREFIX = 'chat:custom:';

export function customPromptKeybindId(customId: string): string {
    return `${CUSTOM_PROMPT_KEYBIND_PREFIX}${customId}`;
}

export interface CustomPromptEntry {
    id: string;
    label: string;
    tags: string[];
    enabled: boolean;
    body: string;
    /** Electron accelerator, e.g. CommandOrControl+Shift+9 */
    accelerator: string;
}

interface BuiltInPersist {
    tags?: string[];
    enabled?: boolean;
    bodyOverride?: string | null;
}

interface RegistryFileV2 {
    version: 2;
    builtIns: Partial<Record<BuiltinPromptId, BuiltInPersist>>;
    customs: CustomPromptEntry[];
}

interface RegistryFileV1 {
    version: 1;
    overrides: Partial<Record<BuiltinPromptId, string>>;
}

/**
 * Unified prompts registry: built-in overrides + metadata + custom prompts.
 */
export class PromptRegistryStore {
    private static instance: PromptRegistryStore | null = null;
    private filePath: string;
    private legacyPath: string;
    private builtIns: Partial<Record<BuiltinPromptId, BuiltInPersist>> = {};
    private customs: CustomPromptEntry[] = [];

    private constructor() {
        this.filePath = path.join(app.getPath('userData'), 'prompts-registry.json');
        this.legacyPath = path.join(app.getPath('userData'), 'prompt-overrides.json');
        this.load();
    }

    static getInstance(): PromptRegistryStore {
        if (!PromptRegistryStore.instance) {
            PromptRegistryStore.instance = new PromptRegistryStore();
        }
        return PromptRegistryStore.instance;
    }

    reload(): void {
        this.load();
    }

    private load(): void {
        let needsSave = false;
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as RegistryFileV2;
                if (raw?.version === 2) {
                    this.builtIns = raw.builtIns && typeof raw.builtIns === 'object' ? raw.builtIns : {};
                    this.customs = Array.isArray(raw.customs) ? raw.customs : [];
                    this.syncKeybindsToManager();
                    return;
                }
            }

            if (fs.existsSync(this.legacyPath)) {
                const old = JSON.parse(fs.readFileSync(this.legacyPath, 'utf-8')) as RegistryFileV1;
                if (old?.version === 1 && old.overrides && typeof old.overrides === 'object') {
                    this.builtIns = {};
                    for (const [k, v] of Object.entries(old.overrides)) {
                        if (BUILTIN_PROMPT_IDS.has(k) && typeof v === 'string' && v.trim()) {
                            this.builtIns[k as BuiltinPromptId] = { bodyOverride: v, enabled: true };
                        }
                    }
                    needsSave = true;
                }
            }

            if (needsSave || !fs.existsSync(this.filePath)) {
                needsSave = true;
            }
        } catch (e) {
            console.error('[PromptRegistryStore] load failed:', e);
            this.builtIns = {};
            this.customs = [];
            needsSave = true;
        }

        if (needsSave) {
            this.persistToDisk();
        } else {
            this.syncKeybindsToManager();
        }
    }

    private persistToDisk(): void {
        try {
            const data: RegistryFileV2 = {
                version: 2,
                builtIns: { ...this.builtIns },
                customs: this.customs.map((c) => ({ ...c })),
            };
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            console.error('[PromptRegistryStore] save failed:', e);
        }
        this.syncKeybindsToManager();
        this.broadcastChanged();
    }

    private broadcastChanged(): void {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
                win.webContents.send('prompts-registry:changed');
            }
        });
    }

    syncKeybindsToManager(): void {
        try {
            const { KeybindManager } = require('./KeybindManager');
            const rows: { id: string; label: string; accelerator: string }[] = [];
            for (const c of this.customs) {
                if (!c.enabled || !String(c.body || '').trim()) continue;
                const acc = String(c.accelerator || '').trim();
                rows.push({
                    id: customPromptKeybindId(c.id),
                    label: c.label || 'Custom prompt',
                    accelerator: acc,
                });
            }
            KeybindManager.getInstance().syncCustomPromptKeybinds(rows);
        } catch (e) {
            console.error('[PromptRegistryStore] syncKeybindsToManager failed:', e);
        }
    }

    getOverride(id: BuiltinPromptId): string | undefined {
        const o = this.builtIns[id]?.bodyOverride;
        if (typeof o !== 'string') return undefined;
        return o.trim().length ? o : undefined;
    }

    setBuiltinBody(id: BuiltinPromptId, body: string | null | undefined): void {
        if (!BUILTIN_PROMPT_IDS.has(id)) return;
        if (!this.builtIns[id]) this.builtIns[id] = {};
        const trimmed = (body ?? '').trim();
        if (!trimmed) {
            delete this.builtIns[id]!.bodyOverride;
        } else {
            this.builtIns[id]!.bodyOverride = typeof body === 'string' ? body : trimmed;
        }
        this.persistToDisk();
    }

    setBuiltinMeta(id: BuiltinPromptId, partial: { tags?: string[]; enabled?: boolean }): void {
        if (!BUILTIN_PROMPT_IDS.has(id)) return;
        if (!this.builtIns[id]) this.builtIns[id] = {};
        if (partial.tags !== undefined) {
            this.builtIns[id]!.tags = partial.tags.map((t) => String(t).slice(0, 48)).filter(Boolean).slice(0, 16);
        }
        if (partial.enabled !== undefined) {
            this.builtIns[id]!.enabled = partial.enabled;
        }
        this.persistToDisk();
    }

    getBuiltinMeta(id: BuiltinPromptId): { tags: string[]; enabled: boolean } {
        const row = PROMPT_CATALOG.find((e) => e.id === id);
        const p = this.builtIns[id];
        const enabled = p?.enabled !== false;
        const tags =
            Array.isArray(p?.tags) && p!.tags!.length > 0 ? [...p!.tags!] : [...(row?.defaultTags ?? [])];
        return { tags, enabled };
    }

    listCustom(): CustomPromptEntry[] {
        return this.customs.map((c) => ({ ...c }));
    }

    addCustom(input: Omit<CustomPromptEntry, 'id'>): string {
        const id = randomUUID();
        this.customs.push({
            id,
            label: (input.label || 'Custom prompt').slice(0, 80),
            tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 12) : [],
            enabled: input.enabled !== false,
            body: input.body || '',
            accelerator: String(input.accelerator || ''),
        });
        this.persistToDisk();
        return id;
    }

    updateCustom(id: string, partial: Partial<Omit<CustomPromptEntry, 'id'>>): void {
        const i = this.customs.findIndex((c) => c.id === id);
        if (i < 0) return;
        const cur = this.customs[i]!;
        this.customs[i] = {
            ...cur,
            ...partial,
            id: cur.id,
            label: partial.label !== undefined ? String(partial.label).slice(0, 80) : cur.label,
            tags:
                partial.tags !== undefined
                    ? partial.tags.map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 12)
                    : cur.tags,
            body: partial.body !== undefined ? partial.body : cur.body,
            accelerator: partial.accelerator !== undefined ? String(partial.accelerator) : cur.accelerator,
            enabled: partial.enabled !== undefined ? partial.enabled : cur.enabled,
        };
        this.persistToDisk();
    }

    removeCustom(id: string): void {
        this.customs = this.customs.filter((c) => c.id !== id);
        this.persistToDisk();
    }

    getCustomForRun(id: string): { label: string; body: string } | null {
        const c = this.customs.find((x) => x.id === id);
        if (!c || !c.enabled) return null;
        const body = (c.body || '').trim();
        if (!body) return null;
        return { label: c.label || 'Custom', body: c.body };
    }

    resetAllBuiltinBodies(): void {
        for (const id of BUILTIN_PROMPT_IDS) {
            const bid = id as BuiltinPromptId;
            if (this.builtIns[bid]) delete this.builtIns[bid]!.bodyOverride;
        }
        this.persistToDisk();
    }

    resetBuiltinBody(id: BuiltinPromptId): void {
        if (this.builtIns[id]) delete this.builtIns[id]!.bodyOverride;
        this.persistToDisk();
    }

    resetEverything(): void {
        this.builtIns = {};
        this.customs = [];
        this.persistToDisk();
    }

    /** Settings + overlay: built-ins with defaults, customs, shortcut display strings. */
    getFullState(getKeybindAccel: (id: string) => string | undefined): {
        builtIns: Array<{
            id: BuiltinPromptId;
            label: string;
            shortcutKey: string | null;
            defaultTags: string[];
            tags: string[];
            enabled: boolean;
            defaultBody: string;
            effectiveBody: string;
            hasCustomBody: boolean;
            shortcutDisplay: string;
        }>;
        customs: Array<
            CustomPromptEntry & {
                shortcutDisplay: string;
            }
        >;
    } {
        const { getDefaultPromptBody, getResolvedPromptBody } = require('../llm/promptResolver');
        const builtIns = PROMPT_CATALOG.map((e) => {
            const meta = this.getBuiltinMeta(e.id);
            const defBody = getDefaultPromptBody(e.id);
            const eff = getResolvedPromptBody(e.id);
            let shortcutDisplay = '';
            if (e.keybindBackendId) {
                const acc = getKeybindAccel(e.keybindBackendId);
                shortcutDisplay = acc ? formatAcceleratorDisplay(acc) : '';
            }
            return {
                id: e.id,
                label: e.label,
                shortcutKey: e.shortcutKey,
                keybindBackendId: e.keybindBackendId,
                defaultTags: [...e.defaultTags],
                tags: meta.tags,
                enabled: meta.enabled,
                defaultBody: defBody,
                effectiveBody: eff,
                hasCustomBody: this.getOverride(e.id) !== undefined,
                shortcutDisplay,
            };
        });

        const customs = this.customs.map((c) => ({
            ...c,
            shortcutDisplay: c.accelerator ? formatAcceleratorDisplay(c.accelerator) : '',
        }));

        return { builtIns, customs };
    }
}
