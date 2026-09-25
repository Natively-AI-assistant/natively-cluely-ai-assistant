/**
 * modelFetcher.ts - Dynamic Model Discovery
 * Fetches available models from AI provider APIs
 */

import axios from 'axios';
import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_PRO_MODEL, isDeepseekModelId } from '../llm/deepseekModels';

export interface ProviderModel {
    id: string;
    label: string;
}

type Provider = 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek' | 'nvidia_nim' | 'openrouter' | 'fluxion';

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
        case 'nvidia_nim':
            return fetchNvidiaNimModels(apiKey);
        case 'openrouter':
            return fetchOpenRouterModels(apiKey);
        case 'fluxion':
            return fetchFluxionModels(apiKey);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

/**
 * OpenRouter's catalogue — the authoritative list for an account, and the reason
 * OpenRouter is an opt-in provider (isOptInModelProvider in modelUtils.ts): the
 * endpoint answered with 444 models on 2026-09-17.
 *
 * Unauthenticated on OpenRouter's side — GET /models is public — but the key is
 * still sent, because this is reached from "Refresh" on a card whose key the
 * user just saved and an eventual per-account catalogue should Just Work.
 *
 * `:batch` ids are dropped. They are not distinct models: every one is a
 * duplicate of the base id exposed on OpenRouter's asynchronous batch endpoint
 * (`anthropic/claude-sonnet-5:batch` carries the same description as
 * `anthropic/claude-sonnet-5`), and Natively only ever issues streaming or
 * blocking chat calls. Keeping them would have put 74 look-alike rows in the
 * picker, each one a way to pick a model that cannot answer this app.
 * `:free` variants are NOT dropped — those are real, callable routes.
 *
 * The label is OpenRouter's own `name` ("Anthropic: Claude Sonnet 5"), not the
 * raw id: unlike NVIDIA's catalogue this one ships display names, and a
 * vendor-prefixed name is what makes a 400-row list scannable.
 */
async function fetchOpenRouterModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000,
    });
    return (response.data?.data || [])
        .filter((m: any) => m?.id && !String(m.id).endsWith(':batch'))
        // `openrouter/` is Natively's own routing prefix and is NOT optional:
        // OpenRouter ids are vendor-namespaced (`openai/gpt-oss-120b`), which
        // collides head-on with Groq's catalogue and with providerFamily()'s
        // `includes('openai')` catch-all in ipcHandlers.ts. Without the prefix
        // an OpenRouter model would be billed to the wrong provider's key.
        .map((m: any) => ({ id: `openrouter/${m.id}`, label: m.name || m.id }))
        .sort((a: ProviderModel, b: ProviderModel) => a.label.localeCompare(b.label));
}

/**
 * Fluxion AI's catalogue. GET /v1/models is UNDOCUMENTED — the published docs
 * tell users to copy model names out of the console's Model Marketplace by hand
 * — but it exists and is group-scoped, which is what makes it the right source:
 * it returns the models THIS key can actually reach, so the picker cannot offer
 * one that answers `model_not_found`.
 *
 * Group scoping CONFIRMED on two keys: a Claude-group key saw exactly its own
 * 11 models of the 36 in the public catalogue (2026-09-18), and a GLM-group key
 * saw exactly 1 (2026-09-19). Out-of-group ids are a clean HTTP 404
 * `model_not_found` on both. That is why Fluxion is not an opt-in provider — a
 * fetched catalogue contains no unreachable rows.
 *
 * Non-chat ids are dropped. Fluxion's image models answer on
 * /v1/images/generations, NOT chat/completions (its Help Center §5 says so
 * explicitly and warns that channel monitoring only probes text endpoints), so
 * leaving them in would put rows in the picker that cannot answer this app.
 * `codex-auto-review` is an internal review route, not a chat model.
 *
 * The `fluxion/` prefix is NOT optional and NOT cosmetic. Fluxion resells the
 * real vendors, so its ids are byte-identical to Natively's own defaults —
 * `claude-sonnet-4-6` and `gpt-5.4` are literally this app's fallback-ladder
 * entries. Unprefixed, providerFamily() would classify a Fluxion model as
 * Anthropic/OpenAI/Gemini and the request would be billed to the user's own
 * key for that vendor, succeed, and look completely normal.
 */
const FLUXION_NON_CHAT_MODEL_IDS = new Set([
    'gpt-image-2',
    'nano-banana-2',
    'grok-imagine',
    'codex-auto-review',
]);

async function fetchFluxionModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://fluxionai.world/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000,
    });
    return (response.data?.data || [])
        .filter((m: any) => m?.id && !FLUXION_NON_CHAT_MODEL_IDS.has(String(m.id)))
        .map((m: any) => ({ id: `fluxion/${m.id}`, label: String(m.id) }))
        .sort((a: ProviderModel, b: ProviderModel) => a.label.localeCompare(b.label));
}

/**
 * Which wire protocol does THIS Fluxion key's group accept?
 *
 * Replaces a manual toggle the user had to get right from information they did
 * not have: the group is a property of the key, the console does not surface it
 * in the key string, and picking wrong produced a 403 that reads like a dead
 * key. Probing is deterministic, so there is nothing to guess.
 *
 * Measured rule (two real keys, 2026-09-19): `/v1/chat/completions` is
 * UNIVERSAL — a Claude-group key and a GLM-group key both answered 200 — while
 * `/v1/messages` is the restricted one (Claude group 200, GLM group 403
 * "This group does not allow /v1/messages dispatch"). So the OpenAI endpoint is
 * tried FIRST and the common case costs exactly one probe.
 *
 * The probes send `max_tokens: 1`, and a permission refusal is rejected BEFORE
 * forwarding (Fluxion's own terms: no model-usage fee for a platform rejection),
 * so the cost of a detection is at most one 1-token completion.
 */
export async function detectFluxionProtocol(apiKey: string): Promise<'openai' | 'anthropic'> {
    // `stream: true` is NOT incidental. Measured 2026-09-19: Fluxion's
    // NON-streaming /v1/chat/completions hangs on the GLM group (1 of 5 requests
    // completed; the rest were still open at 45s) while the streaming endpoint
    // answered 5/5 in ~4s. A non-streaming probe therefore burned its full
    // timeout on exactly the group it was meant to identify, turning a key save
    // into a 21s stall. Streaming also surfaces the accept/refuse decision in
    // the response STATUS, which is all this needs.
    const probeBody = (model: string) => ({
        model, max_tokens: 1, stream: true, messages: [{ role: 'user', content: 'hi' }],
    });
    let model = '';
    try {
        const models = await fetchFluxionModels(apiKey);
        // Already `fluxion/`-prefixed and already filtered of non-chat ids.
        model = (models[0]?.id || '').replace(/^fluxion\//, '');
    } catch { /* fall through to the default below */ }
    // No reachable model means no probe is possible — not that a protocol failed.
    if (!model) return 'openai';

    // `responseType: 'stream'` resolves as soon as the RESPONSE HEADERS arrive,
    // which is the whole answer here: an accepted protocol is a 200 and a
    // refused one is a 403, and both are known before a single token is
    // generated. Waiting for the body instead meant paying the model's full TTFT
    // per probe — ~5s on the GLM group — for information already in the status
    // line. The stream is destroyed immediately, so nothing is generated and
    // nothing is billed.
    const probe = async (url: string, headers: Record<string, string>) => {
        const res = await axios.post(url, probeBody(model), {
            headers, timeout: 12000, responseType: 'stream',
        });
        try { (res.data as any)?.destroy?.(); } catch { /* already closed */ }
    };

    try {
        await probe('https://fluxionai.world/v1/chat/completions', { Authorization: `Bearer ${apiKey}` });
        return 'openai';
    } catch { /* fall through and try the Anthropic endpoint */ }

    try {
        await probe('https://fluxionai.world/v1/messages', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
        return 'anthropic';
    } catch { /* neither probe succeeded */ }

    // Both failed: the key, the plan or the network is the problem, not the
    // protocol. Return the universal one so a transient failure cannot strand
    // the user on the restricted endpoint.
    return 'openai';
}

async function fetchNvidiaNimModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://integrate.api.nvidia.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000,
    });
    // NVIDIA's catalogue is authoritative. Keep every model returned by the
    // platform so users can choose newly published NIM models without waiting
    // for an app release. Non-chat entries may be rejected by chat/completions,
    // but they remain visible exactly as NVIDIA reports them.
    return (response.data?.data || [])
        .filter((m: any) => m?.id)
        .map((m: any) => ({ id: `nvidia_nim/${m.id}`, label: m.id }))
        .sort((a: ProviderModel, b: ProviderModel) => a.label.localeCompare(b.label));
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

// Documented current DeepSeek models (api-docs.deepseek.com/quick_start/pricing);
// used as fallback if /models call fails or returns an unexpected shape.
// deepseek-chat / deepseek-reasoner were discontinued 2026-07-24, and
// deepseek-v4-flash was retired 2026-09-10 in favour of deepseek-flash — all
// intentionally excluded (see llm/deepseekModels.ts).
const DEEPSEEK_DEFAULT_MODELS: ProviderModel[] = [
    { id: DEEPSEEK_DEFAULT_MODEL, label: DEEPSEEK_DEFAULT_MODEL },
    { id: DEEPSEEK_PRO_MODEL, label: DEEPSEEK_PRO_MODEL },
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
            if (!isDeepseekModelId(id)) return false;
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
