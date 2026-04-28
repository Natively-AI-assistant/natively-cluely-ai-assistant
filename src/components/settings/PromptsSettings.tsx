import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { KeyRecorder } from '../ui/KeyRecorder';
import { useShortcuts, type ShortcutConfig } from '../../hooks/useShortcuts';
import { acceleratorToKeys, keysToAccelerator } from '../../utils/keyboardUtils';
type BuiltinRow = {
    id: string;
    label: string;
    shortcutKey: string | null;
    keybindBackendId: string | null;
    defaultTags: string[];
    tags: string[];
    enabled: boolean;
    defaultBody: string;
    effectiveBody: string;
    hasCustomBody: boolean;
    shortcutDisplay: string;
};

type CustomRow = {
    id: string;
    label: string;
    tags: string[];
    enabled: boolean;
    body: string;
    accelerator: string;
    shortcutDisplay: string;
};

function tagsString(tags: string[]): string {
    return tags.join(', ');
}

function parseTagsInput(s: string): string[] {
    return s
        .split(/[,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 16);
}

export const PromptsSettings: React.FC = () => {
    const { shortcuts, updateShortcut } = useShortcuts();
    const [builtIns, setBuiltIns] = useState<BuiltinRow[]>([]);
    const [customs, setCustoms] = useState<CustomRow[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [bulkWorking, setBulkWorking] = useState(false);

    const [newLabel, setNewLabel] = useState('My prompt');
    const [newTags, setNewTags] = useState('Custom');
    const [newBody, setNewBody] = useState('');
    const [newAccelKeys, setNewAccelKeys] = useState<string[]>([]);

    const load = useCallback(async () => {
        if (!window.electronAPI?.promptRegistryGetState) {
            setLoading(false);
            return;
        }
        try {
            const st = await window.electronAPI.promptRegistryGetState();
            setBuiltIns((st.builtIns ?? []) as BuiltinRow[]);
            setCustoms((st.customs ?? []) as CustomRow[]);
            const d: Record<string, string> = {};
            const td: Record<string, string> = {};
            (st.builtIns ?? []).forEach((b: BuiltinRow) => {
                d[`b:${b.id}`] = b.effectiveBody;
                td[`b:${b.id}`] = tagsString(b.tags);
            });
            (st.customs ?? []).forEach((c: CustomRow) => {
                d[`c:${c.id}`] = c.body;
                td[`c:${c.id}`] = tagsString(c.tags);
            });
            setDrafts(d);
            setTagDrafts(td);
        } catch (e) {
            console.error('[PromptsSettings] load failed', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!window.electronAPI?.onPromptsRegistryChanged) return;
        return window.electronAPI.onPromptsRegistryChanged(() => void load());
    }, [load]);

    const saveBuiltinBody = async (id: string) => {
        const text = drafts[`b:${id}`] ?? '';
        setSavingKey(`b:${id}`);
        try {
            await window.electronAPI.promptRegistrySetBuiltinBody(id, text);
            await load();
        } catch (e) {
            console.error('[PromptsSettings] save builtin failed', e);
        } finally {
            setSavingKey(null);
        }
    };

    const saveBuiltinTags = async (id: string) => {
        const tags = parseTagsInput(tagDrafts[`b:${id}`] ?? '');
        setSavingKey(`tags-b:${id}`);
        try {
            await window.electronAPI.promptRegistrySetBuiltinMeta(id, { tags });
            await load();
        } catch (e) {
            console.error('[PromptsSettings] save builtin tags failed', e);
        } finally {
            setSavingKey(null);
        }
    };

    const toggleBuiltin = async (id: string, enabled: boolean) => {
        try {
            await window.electronAPI.promptRegistrySetBuiltinMeta(id, { enabled });
            await load();
        } catch (e) {
            console.error('[PromptsSettings] toggle builtin failed', e);
        }
    };

    const resetBuiltinBody = async (id: string) => {
        setSavingKey(`rb:${id}`);
        try {
            await window.electronAPI.promptRegistryResetBuiltinBody(id);
            await load();
        } catch (e) {
            console.error('[PromptsSettings] reset builtin failed', e);
        } finally {
            setSavingKey(null);
        }
    };

    const saveCustom = async (id: string) => {
        setSavingKey(`c:${id}`);
        try {
            const labelDraft = (drafts[`c:${id}-label`] ?? '').trim();
            await window.electronAPI.promptRegistryUpdateCustom(id, {
                ...(labelDraft ? { label: labelDraft } : {}),
                body: drafts[`c:${id}`],
                tags: parseTagsInput(tagDrafts[`c:${id}`] ?? ''),
            });
            await load();
        } catch (e) {
            console.error('[PromptsSettings] save custom failed', e);
        } finally {
            setSavingKey(null);
        }
    };

    const toggleCustom = async (id: string, enabled: boolean) => {
        try {
            await window.electronAPI.promptRegistryUpdateCustom(id, { enabled });
            await load();
        } catch (e) {
            console.error('[PromptsSettings] toggle custom failed', e);
        }
    };

    const removeCustom = async (id: string) => {
        setSavingKey(`rm:${id}`);
        try {
            await window.electronAPI.promptRegistryRemoveCustom(id);
            await load();
            setOpenId((o) => (o === `c:${id}` ? null : o));
        } catch (e) {
            console.error('[PromptsSettings] remove custom failed', e);
        } finally {
            setSavingKey(null);
        }
    };

    const addCustom = async () => {
        setSavingKey('add');
        try {
            const acc = keysToAccelerator(newAccelKeys);
            await window.electronAPI.promptRegistryAddCustom({
                label: newLabel.trim() || 'Custom prompt',
                tags: parseTagsInput(newTags),
                body: newBody.trim(),
                accelerator: acc,
                enabled: true,
            });
            setNewBody('');
            setNewAccelKeys([]);
            await load();
        } catch (e) {
            console.error('[PromptsSettings] add custom failed', e);
        } finally {
            setSavingKey(null);
        }
    };

    const resetAll = async () => {
        setBulkWorking(true);
        try {
            await window.electronAPI.promptRegistryResetAll();
            await load();
        } catch (e) {
            console.error('[PromptsSettings] reset all failed', e);
        } finally {
            setBulkWorking(false);
        }
    };

    if (loading) {
        return <div className="text-sm text-text-secondary py-8">Loading prompts…</div>;
    }

    if (!window.electronAPI?.promptRegistryGetState) {
        return (
            <div className="text-sm text-text-secondary py-8">Prompt registry is not available in this build.</div>
        );
    }

    const busy = !!savingKey || bulkWorking;

    return (
        <div className="space-y-8 animated fadeIn select-text pb-4 max-w-4xl">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">Prompts</h3>
                    <p className="text-xs text-text-secondary max-w-xl">
                        Built-in actions can be disabled, retagged, and given custom system text. Custom prompts can have
                        their own shortcut (global) and appear as chips in the meeting overlay. Chip labels use{' '}
                        <span className="font-medium text-text-primary">tags · shortcut</span> when a shortcut is set.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void resetAll()}
                    disabled={busy}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-red-500/30 transition-all duration-200 text-xs font-medium text-text-secondary hover:text-red-400 active:scale-95 shrink-0"
                >
                    <RotateCcw size={13} strokeWidth={2.5} />
                    Reset all
                </button>
            </div>

            <section className="space-y-2">
                <h4 className="text-sm font-bold text-text-primary">Built-in</h4>
                {builtIns.map((row) => {
                    const sk = row.shortcutKey as keyof ShortcutConfig | null;
                    const keys = sk ? shortcuts[sk] : [];
                    const rowKey = `b:${row.id}`;
                    const isOpen = openId === rowKey;
                    const draft = drafts[rowKey] ?? row.effectiveBody;
                    const tagDraft = tagDrafts[rowKey] ?? tagsString(row.tags);

                    return (
                        <div key={row.id} className="rounded-xl border border-border-subtle bg-bg-card/50 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setOpenId(isOpen ? null : rowKey)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-bg-item-active/30 transition-colors"
                            >
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-sm font-medium ${row.enabled ? 'text-text-primary' : 'text-text-tertiary line-through'}`}>
                                            {row.label}
                                        </span>
                                        {row.hasCustomBody && (
                                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
                                                Custom text
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-text-tertiary">
                                        {(row.tags.length ? row.tags.join(', ') : '') +
                                            (row.shortcutDisplay ? (row.tags.length ? ' · ' : '') + row.shortcutDisplay : '')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={row.enabled}
                                            disabled={busy}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => void toggleBuiltin(row.id, e.target.checked)}
                                            className="rounded border-border-subtle"
                                        />
                                        On
                                    </label>
                                    {sk ? (
                                        <KeyRecorder currentKeys={keys} onSave={(k) => void updateShortcut(sk, k)} />
                                    ) : (
                                        <span className="text-[11px] text-text-tertiary px-2">No shortcut</span>
                                    )}
                                    {isOpen ? <ChevronUp size={16} className="text-text-tertiary" /> : <ChevronDown size={16} className="text-text-tertiary" />}
                                </div>
                            </button>
                            {isOpen && (
                                <div className="px-4 pb-4 space-y-3 border-t border-border-subtle/80 pt-3">
                                    <div>
                                        <label className="text-[11px] font-medium text-text-secondary block mb-1">Tags (comma-separated)</label>
                                        <div className="flex gap-2">
                                            <input
                                                value={tagDraft}
                                                onChange={(e) => setTagDrafts((t) => ({ ...t, [rowKey]: e.target.value }))}
                                                className="flex-1 rounded-lg border border-border-subtle bg-bg-input text-sm text-text-primary px-3 py-2"
                                                placeholder="e.g. Copilot, Interview"
                                            />
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => void saveBuiltinTags(row.id)}
                                                className="px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle hover:bg-bg-item-active/50"
                                            >
                                                Save tags
                                            </button>
                                        </div>
                                    </div>
                                    <textarea
                                        value={draft}
                                        onChange={(e) => setDrafts((d) => ({ ...d, [rowKey]: e.target.value }))}
                                        spellCheck={false}
                                        className="w-full min-h-[200px] max-h-[45vh] text-[12px] font-mono leading-relaxed rounded-lg border border-border-subtle bg-bg-input text-text-primary p-3 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={busy || draft.trim() === row.effectiveBody.trim()}
                                            onClick={() => void saveBuiltinBody(row.id)}
                                            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
                                        >
                                            {savingKey === rowKey ? 'Saving…' : 'Save prompt'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy || !row.hasCustomBody}
                                            onClick={() => void resetBuiltinBody(row.id)}
                                            className="px-4 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-40"
                                        >
                                            Revert text
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>

            <section className="space-y-3">
                <h4 className="text-sm font-bold text-text-primary">Custom prompts</h4>
                <div className="rounded-xl border border-dashed border-border-subtle bg-bg-card/30 p-4 space-y-3">
                    <p className="text-[11px] text-text-secondary">Add a prompt with optional global shortcut. Requires non-empty body.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <input
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="Label"
                            className="rounded-lg border border-border-subtle bg-bg-input text-sm px-3 py-2"
                        />
                        <input
                            value={newTags}
                            onChange={(e) => setNewTags(e.target.value)}
                            placeholder="Tags, comma separated"
                            className="rounded-lg border border-border-subtle bg-bg-input text-sm px-3 py-2"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-[11px] text-text-secondary">Shortcut (optional)</span>
                        <KeyRecorder currentKeys={newAccelKeys} onSave={(k) => setNewAccelKeys(k)} />
                    </div>
                    <textarea
                        value={newBody}
                        onChange={(e) => setNewBody(e.target.value)}
                        placeholder="System instructions for this custom action…"
                        className="w-full min-h-[100px] text-[12px] font-mono rounded-lg border border-border-subtle bg-bg-input p-3"
                    />
                    <button
                        type="button"
                        disabled={busy || !newBody.trim()}
                        onClick={() => void addCustom()}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                        <Plus size={14} />
                        {savingKey === 'add' ? 'Adding…' : 'Add prompt'}
                    </button>
                </div>

                <div className="space-y-2">
                    {customs.map((row) => {
                        const rowKey = `c:${row.id}`;
                        const isOpen = openId === rowKey;
                        const draft = drafts[rowKey] ?? row.body;
                        const tagDraft = tagDrafts[rowKey] ?? tagsString(row.tags);
                        return (
                            <div key={row.id} className="rounded-xl border border-border-subtle bg-bg-card/50 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setOpenId(isOpen ? null : rowKey)}
                                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-bg-item-active/30 transition-colors"
                                >
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-sm font-medium ${row.enabled ? 'text-text-primary' : 'text-text-tertiary line-through'}`}>
                                                {row.label}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-text-tertiary">
                                            {(row.tags.length ? row.tags.join(', ') : '') +
                                                (row.shortcutDisplay ? (row.tags.length ? ' · ' : '') + row.shortcutDisplay : '')}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={row.enabled}
                                                disabled={busy}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => void toggleCustom(row.id, e.target.checked)}
                                                className="rounded border-border-subtle"
                                            />
                                            On
                                        </label>
                                        <KeyRecorder
                                            currentKeys={row.accelerator ? acceleratorToKeys(row.accelerator) : []}
                                            onSave={async (k) => {
                                                const acc = keysToAccelerator(k);
                                                await window.electronAPI.promptRegistryUpdateCustom(row.id, { accelerator: acc });
                                                await load();
                                            }}
                                        />
                                        <button
                                            type="button"
                                            title="Remove"
                                            disabled={busy}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void removeCustom(row.id);
                                            }}
                                            className="p-1.5 rounded-lg text-text-tertiary hover:text-red-400 hover:bg-red-500/10"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                        {isOpen ? <ChevronUp size={16} className="text-text-tertiary" /> : <ChevronDown size={16} className="text-text-tertiary" />}
                                    </div>
                                </button>
                                {isOpen && (
                                    <div className="px-4 pb-4 space-y-3 border-t border-border-subtle/80 pt-3">
                                        <div>
                                            <label className="text-[11px] font-medium text-text-secondary block mb-1">Tags</label>
                                            <input
                                                value={tagDraft}
                                                onChange={(e) => setTagDrafts((t) => ({ ...t, [rowKey]: e.target.value }))}
                                                className="w-full rounded-lg border border-border-subtle bg-bg-input text-sm px-3 py-2"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-medium text-text-secondary block mb-1">Label</label>
                                            <input
                                                value={drafts[`${rowKey}-label`] ?? row.label}
                                                onChange={(e) => setDrafts((d) => ({ ...d, [`${rowKey}-label`]: e.target.value }))}
                                                className="w-full rounded-lg border border-border-subtle bg-bg-input text-sm px-3 py-2"
                                            />
                                        </div>
                                        <textarea
                                            value={draft}
                                            onChange={(e) => setDrafts((d) => ({ ...d, [rowKey]: e.target.value }))}
                                            spellCheck={false}
                                            className="w-full min-h-[180px] text-[12px] font-mono rounded-lg border border-border-subtle bg-bg-input p-3"
                                        />
                                        <div className="flex gap-2 flex-wrap">
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => void saveCustom(row.id)}
                                                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-500"
                                            >
                                                {savingKey === rowKey ? 'Saving…' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
};
