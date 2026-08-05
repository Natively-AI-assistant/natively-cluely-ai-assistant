/**
 * modelFetcher.ts - Dynamic Model Discovery
 * Fetches available models from AI provider APIs
 */

import axios from 'axios';

export interface ProviderModel {
    id: string;
    label: string;
}

type Provider = 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';

/**
 * Fetch available models from a provider's API.
 * Returns a filtered, sorted array of { id, label } objects.
 */
export async function fetchProviderModels(
    provider: Provider,
    apiKey: string
): Promise<ProviderModel[]> {
    switch (provider) {
        case 'openai':
            return fetchOpenAIModels(apiKey);
        case 'groq':
            return fetchGroqModels(apiKey);
        case 'claude':
            return fetchAnthropicModels(apiKey);
        case 'gemini':
            return fetchGeminiModels(apiKey);
        case 'deepseek':
            return fetchDeepSeekModels(apiKey);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function fetchOpenAIModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
    });

    const models: any[] = response.data?.data || [];

    // Only include: gpt-4o series, gpt-5.x+, o1, o3, o4 series
    const filtered = models.filter((m: any) => {
        const id = (m.id || '').toLowerCase();
        // Include gpt-4o variants
        if (id.includes('gpt-4o')) return true;
        // Include gpt-5 and above
        if (/gpt-[5-9]/.test(id)) return true;
        // Include o1/o3/o4 reasoning models (but not audio/realtime variants)
        if (/^o[134]/.test(id) && !id.includes('audio') && !id.includes('realtime')) return true;
        return false;
    });

    return filtered
        .map((m: any) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Groq ────────────────────────────────────────────────────────────────────

async function fetchGroqModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
    });

    const models: any[] = response.data?.data || [];

    // Only include text/chat models — exclude everything non-chat
    const excludePatterns = [
        'whisper', 'distil', 'guard', 'tool-use',
        'vision-preview', 'tts', 'playai', 'speech',
    ];

    const filtered = models.filter((m: any) => {
        const id = (m.id || '').toLowerCase();
        return !excludePatterns.some(p => id.includes(p));
    });

    return filtered
        .map((m: any) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

/**
 * A readable label for a Claude model id — "Claude Sonnet 4.6", never
 * "claude-sonnet-4-6-20251114". Only used when /v1/models omits `display_name`;
 * Anthropic's own label is already in this shape and is preferred.
 *
 * Anthropic ids come in two shapes, and BOTH are live on /v1/models:
 *   current  claude-sonnet-4-6 / claude-opus-5 / claude-haiku-4-5-20251001
 *            → claude-<family>-<major>[-<minor>][-<date>]
 *   legacy   claude-3-5-sonnet-20241022
 *            → claude-<major>-<minor>-<family>-<date>
 *
 * THE BUG THIS REPLACES: the old catalog filter matched /claude-(\d+)-(\d+)?/,
 * which requires digits immediately after "claude-". That is the LEGACY shape
 * only, so every current-generation id — including the plain, undated
 * `claude-sonnet-4-6` — was dropped and the catalog came back empty. The
 * caller's `models.length > 0` persist guard then skipped it, and Settings fell
 * back to the single hardcoded STANDARD_CLOUD_MODELS preset with no error.
 *
 * Exported for tests.
 */
export function formatClaudeLabel(modelId: string): string {
    const id = (modelId || '').toLowerCase();
    // Drop the release-date snapshot suffix: claude-haiku-4-5-20251001 → claude-haiku-4-5
    const base = id.replace(/-\d{8}$/, '');

    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    // Any remaining trailing segments ("-latest") become title-cased words.
    const tag = (rest?: string) => (rest ? ' ' + rest.slice(1).split('-').map(cap).join(' ') : '');

    // Current shape. The family segment is alphabetic, so this cannot match a
    // legacy id, whose first segment is a digit.
    let m = base.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?(-.+)?$/);
    if (m) {
        return `Claude ${cap(m[1])} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}${tag(m[4])}`;
    }

    // Legacy shape.
    m = base.match(/^claude-(\d+)(?:-(\d+))?-([a-z]+)(-.+)?$/);
    if (m) {
        return `Claude ${m[2] ? `${m[1]}.${m[2]}` : m[1]} ${cap(m[3])}${tag(m[4])}`;
    }

    return base.split('-').map(cap).join(' ');
}

async function fetchAnthropicModels(apiKey: string): Promise<ProviderModel[]> {
    // /v1/models is newest-first and defaults to a page size of 20 — the old
    // call passed no limit, so a key with a long model history got truncated at
    // 20 with no indication. `limit` is documented as ranging 1..1000, so one
    // page covers any real catalog; the loop is a formality that follows
    // has_more/last_id if the cap ever moves.
    const models: any[] = [];
    let afterId: string | null = null;

    for (let page = 0; page < 5; page++) {
        const url: string = afterId
            ? `https://api.anthropic.com/v1/models?limit=1000&after_id=${encodeURIComponent(afterId)}`
            : 'https://api.anthropic.com/v1/models?limit=1000';

        const response = await axios.get(url, {
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            timeout: 15000,
        });

        models.push(...(response.data?.data || []));

        if (response.data?.has_more !== true) break;
        afterId = response.data?.last_id || null;
        if (!afterId) break;
    }

    // No version filter. /v1/models already returns exactly the models this key
    // can use, and the old "Claude 3.5+" regex is what dropped the entire
    // current generation. Everything the endpoint offers is offered here.
    const claudeModels = models.filter((m: any) => (m.id || '').toLowerCase().includes('claude'));

    return pickLatestSnapshotPerModel(claudeModels).map((m: any) => ({
        id: m.id,
        // display_name is Anthropic's own label and is already date-free
        // ("Claude Sonnet 4.6"). Derive one only when the field is absent.
        label: m.display_name || formatClaudeLabel(m.id),
    }));
}

/**
 * One row per model, keeping the newest release when a model ships under
 * several dated snapshots (claude-3-5-sonnet-20240620 vs -20241022).
 *
 * Identity is the date-stripped id, NOT the label. An earlier version of this
 * deduped on `display_name`, which fails the moment two snapshots of one model
 * carry different display names — and it kept whichever came first rather than
 * comparing the dates. `created_at` is documented as an RFC 3339 datetime, so
 * compare that and fall back to the id's own YYYYMMDD suffix when it is absent.
 *
 * Note this also folds a pre-4.6 alias into its snapshot (`claude-sonnet-4-5`
 * and `claude-sonnet-4-5-20250929` share a key) — correct, since the alias is
 * documented as a pointer to the most recent snapshot for that version. The
 * dateless 4.6-generation ids are NOT aliases; each is its own model and gets
 * its own key.
 *
 * Input order is preserved (the API returns newest-first). Exported for tests.
 */
export function pickLatestSnapshotPerModel<T extends { id?: string; created_at?: string }>(
    models: T[],
): T[] {
    // Sorts lexicographically in the same order it sorts chronologically, for
    // both RFC 3339 timestamps and bare YYYYMMDD suffixes.
    const releasedAt = (m: T): string =>
        m?.created_at || (m?.id || '').match(/-(\d{8})$/)?.[1] || '';

    const bestByModel = new Map<string, T>();
    const order: string[] = [];

    for (const m of models) {
        const id = (m?.id || '').toLowerCase();
        if (!id) continue;
        const key = id.replace(/-\d{8}$/, '');

        const incumbent = bestByModel.get(key);
        if (!incumbent) {
            bestByModel.set(key, m);
            order.push(key);
            continue;
        }
        // Strictly-newer only: on a tie the incumbent wins, which preserves the
        // API's newest-first ordering as the tiebreak.
        if (releasedAt(m) > releasedAt(incumbent)) bestByModel.set(key, m);
    }

    return order.map(key => bestByModel.get(key) as T);
}

// ─── DeepSeek ────────────────────────────────────────────────────────────────

// Documented current DeepSeek text models; used as fallback if /models call fails
// or returns an unexpected shape. deepseek-chat / deepseek-reasoner are deprecated
// (2026-07-24) and intentionally excluded.
const DEEPSEEK_DEFAULT_MODELS: ProviderModel[] = [
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
];

async function fetchDeepSeekModels(apiKey: string): Promise<ProviderModel[]> {
    try {
        const response = await axios.get('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 15000,
        });

        const models: any[] = response.data?.data || [];
        if (!Array.isArray(models) || models.length === 0) {
            return DEEPSEEK_DEFAULT_MODELS;
        }

        const excludePatterns = [
            'embedding', 'embed', 'vision', 'image', 'audio',
            'tts', 'speech', 'whisper', 'stt',
        ];

        const filtered = models.filter((m: any) => {
            const id = (m.id || '').toLowerCase();
            if (!/^deepseek-v\d/.test(id)) return false;
            if (excludePatterns.some(p => id.includes(p))) return false;
            return true;
        });

        if (filtered.length === 0) return DEEPSEEK_DEFAULT_MODELS;

        return filtered
            .map((m: any) => ({ id: m.id, label: m.id }))
            .sort((a, b) => a.label.localeCompare(b.label));
    } catch (error: any) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
            throw new Error('Invalid or unauthorized DeepSeek API key');
        }
        return DEEPSEEK_DEFAULT_MODELS;
    }
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function fetchGeminiModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        {
            timeout: 15000,
        }
    );

    const models: any[] = response.data?.models || [];

    // Only include Gemini 2.5+ models (gemini-2.5-*, gemini-3-*, etc.)
    // Must support generateContent
    const excludePatterns = ['nano', 'custom', 'computer-use', 'banana', 'tts', 'embedding', 'aqa', 'vision'];

    const filtered = models.filter((m: any) => {
        const name = (m.name || '').toLowerCase();
        const displayName = (m.displayName || '').toLowerCase();
        const combined = name + ' ' + displayName;

        // Must support generateContent
        const supportsChat = m.supportedGenerationMethods?.includes('generateContent');
        if (!supportsChat) return false;

        // Must NOT match any exclude patterns
        if (excludePatterns.some(p => combined.includes(p))) return false;

        // Match gemini-2.5, gemini-3, gemini-4, etc. (version 2.5 and above)
        return /gemini-([3-9]|2\.5)/.test(combined);
    });

    return filtered
        .map((m: any) => {
            const id = (m.name || '').replace(/^models\//, '');
            return { id, label: m.displayName || id };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
}
