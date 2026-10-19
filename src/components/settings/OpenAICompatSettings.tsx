// Settings › AI Providers › Gateways: "OpenAI-compatible endpoints". Any
// service that speaks the OpenAI chat-completions API — OpenRouter, Ollama,
// LM Studio, a work proxy — configured here with NO code: the main process
// registers each endpoint as an OpenAICompatProvider (electron/llm/providers/)
// and routes its `compat:<id>/<model>` ids through the provider registry.
// Keys go into safeStorage and never come back: the list reports hasApiKey,
// and a blank key on edit means "keep the stored one". The parent
// (AIProvidersSettings) owns the list and reloads it on the
// credentials-changed broadcast that save/delete fire — no callback needed.
import React, { useState } from 'react';
import { Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { SETTINGS_BTN, SETTINGS_INPUT, SETTINGS_FIELD_LABEL } from './SettingsRow';

export interface CompatEndpointRow {
    id: string;
    name: string;
    baseURL: string;
    models: string[];
    hasApiKey: boolean;
}

// Official OpenAI-compatibility endpoints, verified against each vendor's own
// docs (docs.anthropic.com/en/api/openai-sdk, ai.google.dev/gemini-api/docs/openai).
// Choosing a preset only fills Base URL — the fields stay freely editable.
const PRESETS: Array<{ label: string; baseURL: string }> = [
    { label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
    { label: 'Anthropic', baseURL: 'https://api.anthropic.com/v1/' },
    { label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
    { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
    { label: 'Ollama', baseURL: 'http://localhost:11434/v1' },
    { label: 'LM Studio', baseURL: 'http://localhost:1234/v1' },
];

export const OpenAICompatSettings: React.FC<{ endpoints: CompatEndpointRow[] }> = ({ endpoints }) => {
    const t = useT();
    const [editingId, setEditingId] = useState<string | 'new' | null>(null);
    const [name, setName] = useState('');
    const [baseURL, setBaseURL] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [modelsText, setModelsText] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const startNew = () => {
        setEditingId('new'); setName(''); setBaseURL(''); setApiKey(''); setModelsText(''); setError('');
    };
    const startEdit = (ep: CompatEndpointRow) => {
        setEditingId(ep.id); setName(ep.name); setBaseURL(ep.baseURL); setApiKey(''); setModelsText(ep.models.join(', ')); setError('');
    };

    const save = async () => {
        setBusy(true); setError('');
        const models = modelsText.split(',').map(m => m.trim()).filter(Boolean);
        const res = await window.electronAPI?.openaiCompatSave?.({
            ...(editingId && editingId !== 'new' ? { id: editingId } : {}),
            name: name.trim(),
            baseURL: baseURL.trim(),
            models,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }).catch(() => undefined);
        setBusy(false);
        if (!res?.success) {
            setError(res?.error === 'settings_store_degraded'
                ? t('Settings storage is degraded — cannot save right now.')
                : t('Needs a name, an http(s) base URL, and 1–20 model names.'));
            return;
        }
        setEditingId(null); // the credentials-changed broadcast reloads the list
    };

    const remove = async (id: string) => {
        setBusy(true);
        await window.electronAPI?.openaiCompatDelete?.(id).catch(() => undefined);
        setBusy(false);
        if (editingId === id) setEditingId(null);
    };

    return (
        <div className="space-y-5">
            <div className="space-y-4">
                <div className="aip-card p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-bg-item-surface border border-border-subtle flex items-center justify-center shrink-0 mt-0.5 text-text-primary">
                                <Server size={16} />
                            </div>
                            <div className="min-w-0">
                                <label className="block text-xs font-bold aip-hero mb-0">{t('OpenAI-compatible endpoints')}</label>
                                <p className="text-[10px] aip-muted">
                                    {t('Any service that speaks the OpenAI API: OpenRouter, Ollama, LM Studio, a work proxy. Its models join the picker as soon as you save.')}
                                </p>
                            </div>
                        </div>
                        {editingId === null && (
                            <button type="button" className={SETTINGS_BTN} onClick={startNew}>
                                <Plus size={13} /> {t('Add endpoint')}
                            </button>
                        )}
                    </div>

                    {endpoints.length > 0 && (
                        <div className="space-y-2">
                            {endpoints.map(ep => (
                                <div key={ep.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-item-surface px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="text-xs font-semibold text-text-primary truncate">
                                            {ep.name}
                                            {ep.hasApiKey && (
                                                <span className="ml-2 text-[9px] font-medium uppercase tracking-wide text-text-secondary border border-border-subtle rounded px-1 py-0.5 align-middle">{t('key saved')}</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] aip-muted truncate">{ep.baseURL}</div>
                                        <div className="text-[10px] aip-muted truncate">{ep.models.join(', ')}</div>
                                    </div>
                                    <div className="flex gap-1.5 shrink-0">
                                        <button type="button" className={SETTINGS_BTN} onClick={() => startEdit(ep)}>
                                            <Pencil size={13} /> {t('Edit')}
                                        </button>
                                        <button type="button" className={SETTINGS_BTN} disabled={busy} onClick={() => void remove(ep.id)} aria-label={t('Delete')}>
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {editingId !== null && (
                        <div className="space-y-3 rounded-lg border border-border-subtle p-3">
                            <div>
                                <span className={SETTINGS_FIELD_LABEL}>{t('Preset')}</span>
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {PRESETS.map(p => (
                                        <button key={p.label} type="button" className={SETTINGS_BTN} onClick={() => setBaseURL(p.baseURL)}>
                                            {t(p.label)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className={SETTINGS_FIELD_LABEL} htmlFor="compat-name">{t('Name')}</label>
                                <input id="compat-name" className={`${SETTINGS_INPUT} mt-1.5`} value={name} onChange={e => setName(e.target.value)} placeholder={t('My Ollama')} maxLength={60} />
                            </div>
                            <div>
                                <label className={SETTINGS_FIELD_LABEL} htmlFor="compat-url">{t('Base URL')}</label>
                                <input id="compat-url" className={`${SETTINGS_INPUT} mt-1.5`} value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="http://localhost:11434/v1" />
                            </div>
                            <div>
                                <label className={SETTINGS_FIELD_LABEL} htmlFor="compat-key">{t('API key')}</label>
                                <input
                                    id="compat-key"
                                    type="password"
                                    className={`${SETTINGS_INPUT} mt-1.5`}
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder={editingId !== 'new' ? t('Saved — leave blank to keep') : t('Optional for local servers')}
                                />
                            </div>
                            <div>
                                <label className={SETTINGS_FIELD_LABEL} htmlFor="compat-models">{t('Models (comma-separated)')}</label>
                                <input id="compat-models" className={`${SETTINGS_INPUT} mt-1.5`} value={modelsText} onChange={e => setModelsText(e.target.value)} placeholder="llama3.2, qwen2.5:14b" />
                            </div>
                            {error && <p className="text-xs text-red-500">{error}</p>}
                            <div className="flex gap-2 justify-end">
                                <button type="button" className={SETTINGS_BTN} onClick={() => setEditingId(null)}>{t('Cancel')}</button>
                                <button type="button" className={SETTINGS_BTN} disabled={busy} onClick={() => void save()}>{t('Save endpoint')}</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
