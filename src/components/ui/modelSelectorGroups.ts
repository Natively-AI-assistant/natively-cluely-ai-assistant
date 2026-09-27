/**
 * Sections for the meeting overlay's model dropdown (ModelSelectorWindow).
 *
 * The picker builds one flat list, already ordered provider by provider. This
 * splits it at each provider change and gives every section a header, so the
 * row itself no longer has to say where the model comes from: a row under
 * "Ollama" reads `llama3.2:3b`, not `llama3.2:3b (Local)`.
 */

export interface ModelSelectorOption {
    id: string;
    name: string;
    type: 'cloud' | 'local' | 'custom' | 'ollama' | 'codex-cli';
    provider?: string;
}

export interface ModelSelectorRow extends ModelSelectorOption {
    /** What the row shows. `name` stays untouched for everything else. */
    label: string;
}

export interface ModelSelectorGroup {
    key: string;
    label: string;
    rows: ModelSelectorRow[];
    /**
     * False when the header would only repeat its one row: "Natively" above
     * "Natively API" says nothing the row does not.
     */
    showHeader: boolean;
}

const GROUP_LABELS: Record<string, string> = {
    natively: 'Natively',
    gemini: 'Google',
    openai: 'OpenAI',
    claude: 'Anthropic',
    groq: 'Groq',
    deepseek: 'DeepSeek',
    nvidia_nim: 'NVIDIA NIM',
    openrouter: 'OpenRouter',
    fluxion: 'Fluxion',
    antigravity: 'Antigravity',
    'codex-cli': 'OpenAI Codex',
    litellm: 'LiteLLM',
    ninerouter: '9Router',
    custom: 'Custom',
    ollama: 'Ollama',
};

/**
 * The trailing "(…)" tags the picker appends to say where a model runs. Only
 * these are removed: any other parenthesis is part of the model's name.
 */
const SUFFIX_TAGS: Record<string, string[]> = {
    ollama: ['Local'],
    nvidia_nim: ['Nvidia Nim'],
    openrouter: ['OpenRouter'],
    antigravity: ['Antigravity'],
    litellm: ['LiteLLM'],
    ninerouter: ['9Router'],
};

/** Host names the built-in lists prefix, e.g. "Groq Qwen 3.8". */
const PREFIX_TAGS: Record<string, string[]> = {
    groq: ['Groq'],
};

export function modelSelectorGroupKey(model: ModelSelectorOption): string {
    if (model.provider) return model.provider;
    if (model.type === 'ollama' || model.type === 'local') return 'ollama';
    if (model.type === 'codex-cli') return 'codex-cli';
    if (model.type === 'custom') return 'custom';
    return 'other';
}

export function modelSelectorGroupLabel(key: string): string {
    if (GROUP_LABELS[key]) return GROUP_LABELS[key];
    if (key === 'other') return 'Other';
    return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function modelSelectorRowLabel(model: ModelSelectorOption, groupKey: string): string {
    let label = model.name.trim();

    for (const tag of SUFFIX_TAGS[groupKey] ?? []) {
        const suffix = ` (${tag})`;
        if (label.toLowerCase().endsWith(suffix.toLowerCase()) && label.length > suffix.length) {
            label = label.slice(0, -suffix.length).trimEnd();
        }
    }

    for (const tag of PREFIX_TAGS[groupKey] ?? []) {
        const prefix = `${tag} `;
        if (label.startsWith(prefix) && label.length > prefix.length) {
            label = label.slice(prefix.length);
        }
    }

    // The bare Codex entry runs the configured default and is named
    // "OpenAI Codex (GPT-5.5)". Under an "OpenAI Codex" header, say "Default".
    if (groupKey === 'codex-cli') {
        const match = /^OpenAI Codex \((.+)\)$/.exec(label);
        if (match) label = `Default (${match[1]})`;
    }

    return label || model.name;
}

/**
 * Consecutive models with the same provider form one section. A provider that
 * shows up again later (the list is built provider by provider, so it should
 * not) opens a new section instead of reordering the user's list.
 */
export function groupModelOptions(models: ModelSelectorOption[]): ModelSelectorGroup[] {
    const groups: ModelSelectorGroup[] = [];
    for (const model of models) {
        const key = modelSelectorGroupKey(model);
        let group = groups[groups.length - 1];
        if (!group || group.key !== key) {
            group = { key, label: modelSelectorGroupLabel(key), rows: [], showHeader: true };
            groups.push(group);
        }
        group.rows.push({ ...model, label: modelSelectorRowLabel(model, key) });
    }
    for (const group of groups) {
        const only = group.rows.length === 1 ? group.rows[0].label.toLowerCase() : null;
        group.showHeader = !(only && only.startsWith(group.label.toLowerCase()));
    }
    return groups;
}
