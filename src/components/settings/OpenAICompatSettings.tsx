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
// QwenCloud URLs per docs.qwencloud.com/api-reference/preparation/api-key and
// /token-plan/personal/token-plan-personal-quickstart; Coding Plan is a legacy
// host missing from the current docs (its /coding-plan/faq 404s) but live, with
// a keyless GET /models that answers 200 (verified 2026-10-20).
// Choosing a preset only fills Base URL — the fields stay freely editable.
const norm = (u: string) => u.trim().replace(/\/+$/, '');
// Fallback = model ids the docs list for the plan, offered when Fetch fails:
// QwenCloud's compat endpoints do not publish GET /models (401/404 is the
// documented answer). Coding Plan needs none — its /models works keyless.
// NON_TEXT ids can appear on a live /models list but this app's compat lane is
// text-only, so the checklist groups them instead of offering them.
const NON_TEXT = /audio|image|video|tts|asr|wan|happyhorse/i;
const PRESETS: Array<{ label: string; baseURL: string; qwen?: { keyPrefix: 'sk-sp-' | 'sk-'; fallback?: string[] } }> = [
    { label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
    { label: 'Anthropic', baseURL: 'https://api.anthropic.com/v1/' },
    { label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
    { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
    { label: 'Ollama', baseURL: 'http://localhost:11434/v1' },
    { label: 'LM Studio', baseURL: 'http://localhost:1234/v1' },
    {
        label: 'QwenCloud Token Plan (Global)',
        baseURL: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
        qwen: {
            keyPrefix: 'sk-sp-',
            fallback: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.7-max', 'qwen3.6-flash', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-0731', 'glm-5.3', 'glm-5.2', 'auto'],
        },
    },
    {
        label: 'QwenCloud Pay-as-you-go (Global)',
        baseURL: 'https://maas.qwencloudapi.com/compatible-mode/v1',
        qwen: { keyPrefix: 'sk-', fallback: ['qwen-max', 'qwen-plus', 'qwen-flash'] },
    },
    {
        label: 'QwenCloud Coding Plan (Global)',
        baseURL: 'https://coding-intl.dashscope.aliyuncs.com/v1',
        qwen: { keyPrefix: 'sk-sp-' },
    },
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
    const [fetched, setFetched] = useState<string[] | null>(null);
    const [fetchedIsFallback, setFetchedIsFallback] = useState(false);
    const [fetchError, setFetchError] = useState('');
    // True after any fetch failure except 'invalid' — gates the fallback offer.
    const [fetchFailed, setFetchFailed] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [filter, setFilter] = useState('');

    const resetFetchState = () => {
        setFetched(null); setFetchedIsFallback(false); setFetchError(''); setFetchFailed(false); setFetching(false); setFilter('');
    };
    const startNew = () => {
        setEditingId('new'); setName(''); setBaseURL(''); setApiKey(''); setModelsText(''); setError(''); resetFetchState();
    };
    const startEdit = (ep: CompatEndpointRow) => {
        setEditingId(ep.id); setName(ep.name); setBaseURL(ep.baseURL); setApiKey(''); setModelsText(ep.models.join(', ')); setError(''); resetFetchState();
    };

    const preset = PRESETS.find(p => norm(p.baseURL) === norm(baseURL));
    const qw = preset?.qwen;
    const fallbackList = qw?.fallback;
    const typedKey = apiKey.trim();
    // Advisory only — never blocks Save. A blank key on edit can't be checked:
    // the stored key never reaches the renderer.
    const keyMismatch = !!qw && !!typedKey
        && (qw.keyPrefix === 'sk-sp-' ? !typedKey.startsWith('sk-sp-') : (!typedKey.startsWith('sk-') || typedKey.startsWith('sk-sp-')));
    const selected = modelsText.split(',').map(m => m.trim()).filter(Boolean);
    const matches = (fetched ?? []).filter(id => id.toLowerCase().includes(filter.trim().toLowerCase()));
    const chatModels = matches.filter(id => !NON_TEXT.test(id));
    const nonTextModels = matches.filter(id => NON_TEXT.test(id));

    const toggleModel = (id: string) => {
        const next = selected.includes(id)
            ? selected.filter(m => m !== id)
            : selected.length < 20 ? [...selected, id] : selected;
        setModelsText(next.join(', '));
    };

    const fetchModels = async () => {
        setFetching(true); setFetchError('');
        const res = await window.electronAPI?.openaiCompatFetchModels?.({
            baseURL: baseURL.trim(),
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            ...(editingId && editingId !== 'new' ? { id: editingId } : {}),
        }).catch(() => undefined);
        setFetching(false);
        if (res?.success) {
            if ((res.models ?? []).length > 0) {
                setFetched(res.models ?? []); setFetchedIsFallback(false); setFetchError(''); setFetchFailed(false);
            } else {
                setFetchError(t('The endpoint returned no models. Type model names below.'));
                setFetchFailed(true);
            }
            return;
        }
        const err = res?.error;
        let msg: string;
        switch (err) {
            case 'invalid': msg = t('Enter an http(s) base URL first.'); break;
            case 'unauthorized': msg = t('The endpoint rejected the API key (HTTP {status}). Check the key.').replace('{status}', String(res?.status ?? '?')); break;
            case 'not_found': msg = t('This endpoint has no /models list (HTTP 404). Type model names below.'); break;
            case 'timeout': msg = t('The endpoint did not answer within 10 seconds.'); break;
            case 'network': msg = t('Could not reach the endpoint. Check the base URL and your connection.'); break;
            case 'http': msg = t('The endpoint answered HTTP {status}.').replace('{status}', String(res?.status ?? '?')); break;
            case 'bad_response': msg = t('The endpoint answered, but not with an OpenAI-style model list.'); break;
            // undefined result — the IPC binding is missing or threw.
            default: msg = t('Could not reach the endpoint. Check the base URL and your connection.'); break;
        }
        if (qw && (err === 'unauthorized' || err === 'not_found')) {
            msg += ` ${t('QwenCloud does not publish a /models list on this endpoint, so 401/404 here is expected.')}`;
        }
        setFetchError(msg);
        setFetchFailed(err !== 'invalid');
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
                                        <button key={p.label} type="button" className={SETTINGS_BTN} onClick={() => { setBaseURL(p.baseURL); resetFetchState(); }}>
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
                                {qw && <p className="text-[10px] aip-muted mt-1">{t('Create a key at home.qwencloud.com/api-keys')}</p>}
                                {keyMismatch && <p className="text-[10px] text-amber-500 mt-1">{t('This key belongs to a different QwenCloud plan')}</p>}
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <label className={SETTINGS_FIELD_LABEL} htmlFor="compat-models">{t('Models (comma-separated)')}</label>
                                    <button type="button" className={SETTINGS_BTN} disabled={fetching || !baseURL.trim()} onClick={() => void fetchModels()}>
                                        {fetching ? t('Fetching…') : t('Fetch models')}
                                    </button>
                                </div>
                                <input id="compat-models" className={`${SETTINGS_INPUT} mt-1.5`} value={modelsText} onChange={e => setModelsText(e.target.value)} placeholder="llama3.2, qwen2.5:14b" />
                                <p className={`text-[10px] mt-1 ${selected.length > 20 ? 'text-red-500' : 'aip-muted'}`}>{selected.length} / 20</p>
                                {fetchError && <p className="text-[10px] text-red-500 mt-1">{fetchError}</p>}
                                {fetchFailed && fallbackList && !fetched && (
                                    <button type="button" className={`${SETTINGS_BTN} mt-1.5`} onClick={() => { setFetched(fallbackList); setFetchedIsFallback(true); }}>
                                        {t('Use QwenCloud fallback list')}
                                    </button>
                                )}
                                {fetched && (
                                    <div className="rounded-lg border border-border-subtle p-2 space-y-1.5 mt-1.5">
                                        {fetchedIsFallback && (
                                            <p className="text-[10px] text-amber-500">{t('Fallback list: built-in suggestions, not fetched from your account.')}</p>
                                        )}
                                        <input className={SETTINGS_INPUT} placeholder={t('Search models')} value={filter} onChange={e => setFilter(e.target.value)} />
                                        {matches.length === 0 && <p className="text-[10px] aip-muted">{t('No models match.')}</p>}
                                        {chatModels.length > 0 && (
                                            <div className="max-h-48 overflow-auto space-y-1">
                                                {chatModels.map(id => (
                                                    <label key={id} className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={selected.includes(id)}
                                                            disabled={!selected.includes(id) && selected.length >= 20}
                                                            onChange={() => toggleModel(id)}
                                                        />
                                                        <span className="text-xs text-text-primary">{id}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                        {nonTextModels.length > 0 && (
                                            <details>
                                                <summary className="text-[10px] aip-muted">{t('Not supported (non-text)')} ({nonTextModels.length})</summary>
                                                <p className="text-[10px] aip-muted mt-1 break-all">{nonTextModels.join(', ')}</p>
                                            </details>
                                        )}
                                    </div>
                                )}
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
