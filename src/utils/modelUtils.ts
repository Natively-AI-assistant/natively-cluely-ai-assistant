export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: 'geminiPreferredModel' | 'openaiPreferredModel' | 'claudePreferredModel' | 'groqPreferredModel' | 'deepseekPreferredModel' | 'nvidia_nimPreferredModel' | 'openrouterPreferredModel' | 'fluxionPreferredModel';
}> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        // ids and names are zipped positionally by the picker — they must be
        // bumped together or a row shows one model's label and selects another.
        ids: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.8 Flash', 'Gemini 3.1 Flash Lite', 'Gemini 3.1 Pro'],
        descs: ['Fastest • Multimodal', 'Reasoning • High Quality'],
        pmKey: 'geminiPreferredModel'
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4'],
        names: ['GPT 5.4'],
        descs: ['OpenAI'],
        pmKey: 'openaiPreferredModel'
    },
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel'
    },
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        // Groq retired every Llama id it hosted (llama-3.3-70b-versatile on
        // 2026-08-16, llama-4-scout on 2026-07-17). qwen3.6-27b leads because it
        // is the only Groq model that still accepts images, so it covers both the
        // text and the screenshot paths; the GPT-OSS pair is here so a user who
        // wants a text-only production-tier model can switch the default.
        ids: ['qwen/qwen3.6-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
        names: ['Groq Qwen 3.6', 'Groq GPT-OSS 120B', 'Groq GPT-OSS 20B'],
        descs: ['Ultra Fast • Multimodal', 'Highest Quality • Text-only', 'Fastest • Text-only'],
        pmKey: 'groqPreferredModel'
    },
    deepseek: {
        hasKeyCheck: (creds) => !!creds?.hasDeepseekKey,
        ids: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        names: ['DeepSeek V4 Flash', 'DeepSeek V4 Pro'],
        descs: ['Fast • Text-only', 'Reasoning • Text-only'],
        pmKey: 'deepseekPreferredModel'
    },
    nvidia_nim: {
        hasKeyCheck: (creds) => !!creds?.hasNvidiaNimKey,
        // NVIDIA retired BOTH ids this list used to offer — z-ai/glm4.7 on
        // 2026-05-14 and meta/llama-3.1-8b-instruct in the 2026-08-26 batch EOL
        // that also took every meta/* chat id — so the picker was offering two
        // models that answer 410 Gone to any request. The retired set itself
        // lives in electron/llm/nvidiaNimModels.ts.
        //
        // These presets are BEST-EFFORT, and cannot be more than that: NVIDIA's
        // catalogue lists ids that /chat/completions refuses, `GET /v1/models`
        // answers 200 to an invalid key, and there is no public signal for which
        // ids a given account may actually call. "Refresh" on the provider card
        // reads the account's own catalogue and is the authoritative list; a
        // preset that turns out to be unservable is handled at runtime, where a
        // 404/410 classifies as model_gone.
        ids: [
            'nvidia_nim/nvidia/llama-3.1-nemotron-70b-instruct',
            'nvidia_nim/nvidia/nemotron-3-super-120b-a12b',
            'nvidia_nim/openai/gpt-oss-20b',
        ],
        names: ['Llama 3.1 Nemotron 70B (Nvidia Nim)', 'Nemotron 3 Super (Nvidia Nim)', 'GPT-OSS 20B (Nvidia Nim)'],
        descs: ['Llama • Nvidia hosted', 'Reasoning • Nvidia hosted', 'Open weights • Nvidia hosted'],
        pmKey: 'nvidia_nimPreferredModel'
    },
    openrouter: {
        hasKeyCheck: (creds) => !!creds?.hasOpenrouterKey,
        // NOT a curated set. OpenRouter is a gateway — its catalogue was 444
        // models when this was written — so these three exist only so the card
        // and the overlay picker have SOMETHING to show before the account's own
        // catalogue is fetched. "Refresh" on the provider card reads
        // GET /api/v1/models and is the authoritative list.
        //
        // OpenRouter is an OPT-IN provider (isOptInModelProvider): an empty
        // allow-list means NOTHING is selected, so these rows start unticked and
        // "Set default" on one is the one-click way to put it into routing.
        // Seeding the allow-list instead would create a selection the user
        // cannot clear.
        //
        // All three take images, so the screenshot path works on a fresh setup;
        // each also survives stripProviderRoutingPrefix() into a bare id the
        // capability table already knows (claude-/gpt-/gemini-), which is what
        // keeps Code Hint from refusing them. Verified against the live
        // catalogue 2026-09-17.
        ids: [
            'openrouter/anthropic/claude-sonnet-5',
            'openrouter/openai/gpt-5.6-terra',
            'openrouter/google/gemini-3.8-flash',
        ],
        names: ['Claude Sonnet 5 (OpenRouter)', 'GPT-5.6 Terra (OpenRouter)', 'Gemini 3.8 Flash (OpenRouter)'],
        descs: ['Balanced • Multimodal', 'Reasoning • Multimodal', 'Fastest • Multimodal'],
        pmKey: 'openrouterPreferredModel'
    },
    fluxion: {
        hasKeyCheck: (creds) => !!creds?.hasFluxionKey,
        // Like OpenRouter's, these exist only so the card and the overlay picker
        // have something to show before the account's own catalogue is fetched.
        // "Refresh" reads GET /v1/models, which on Fluxion is GROUP-SCOPED — it
        // returns what this key can actually reach — and is authoritative.
        //
        // Fluxion is NOT opt-in (deliberately, unlike OpenRouter): its public
        // catalogue was 36 models on 2026-09-17, and the group scoping means a
        // fetched list contains no unreachable rows. That puts it in nvidia_nim
        // territory, not gateway-flood territory.
        //
        // ORDER: Claude leads. An earlier version led with the GPT preset on the
        // theory that a Claude model was unreachable until the user flipped the
        // protocol selector — driving a real Claude-group key on 2026-09-18
        // disproved that (it answered on /v1/chat/completions, the default
        // protocol, without touching the selector).
        //
        // With that constraint gone the tie-break is which group a new user is
        // most likely on, and Claude is 5 of Fluxion's 11 groups and the whole
        // of its cheapest tier. The first entry is what "Set default" tends to
        // land on, and a preset outside the key's group is a hard 404
        // `model_not_found` until Refresh replaces these with the real list.
        //
        // Every id here is a REAL entry in the live catalogue (verified against
        // /api/v1/model-plaza/public, 2026-09-17) and each strips to a bare id
        // the capability table already knows, which is what keeps Code Hint
        // from refusing them.
        ids: [
            'fluxion/claude-sonnet-5',
            'fluxion/gpt-5.6-terra',
            'fluxion/gemini-3.7-flash',
        ],
        names: ['Claude Sonnet 5 (Fluxion)', 'GPT-5.6 Terra (Fluxion)', 'Gemini 3.7 Flash (Fluxion)'],
        descs: ['Balanced • Multimodal', 'Reasoning • Multimodal', 'Fastest • Multimodal'],
        pmKey: 'fluxionPreferredModel'
    },
};

// The id stays 'codex-cli' (persisted in settings and routing), but the provider
// is not a CLI: Natively calls the ChatGPT Codex backend with its own ChatGPT
// sign-in and never runs the `codex` binary (issue #558).
export const CODEX_CLI_MODEL = {
    id: 'codex-cli',
    name: 'OpenAI Codex',
    desc: 'ChatGPT sign-in',
};

/**
 * Built-in Codex models, used when the user has no Codex CLI catalogue to read
 * (see codexModelOptions) — which is most users, since Natively does not need
 * the CLI. Also the name source for surfaces that only have a selector id
 * (getCodexCliModelDisplayName).
 *
 * Each one answered a live request with a ChatGPT sign-in on 2026-09-11. The
 * previous gpt-5.4 / gpt-5.3-codex / gpt-5.3-codex-spark presets are rejected
 * for a ChatGPT account (CHATGPT_UNSUPPORTED_CODEX_MODELS in
 * electron/services/CodexModelCatalog.ts); a test keeps the two apart.
 */
export const CODEX_CLI_MODEL_PRESETS = [
    { id: 'gpt-5.5', name: 'ChatGPT 5.5' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
];

/** Result of the `codex-cli:models` IPC — CodexModelCatalog in the main process. */
export interface CodexModelCatalogResult {
    source: 'codex-cli' | 'unavailable';
    models: { id: string; name: string }[];
    fetchedAt?: string;
    clientVersion?: string;
}

/**
 * The Codex models to offer: the installed Codex CLI's own catalogue when one
 * was found, otherwise the built-in presets. `undefined`/`null` covers an older
 * preload without the IPC.
 */
export const codexModelOptions = (catalog: CodexModelCatalogResult | null | undefined): { id: string; name: string }[] =>
    catalog?.source === 'codex-cli' && catalog.models.length > 0 ? catalog.models : CODEX_CLI_MODEL_PRESETS;

export const codexCliSelectorId = (modelId: string): string => `codex-cli:${modelId}`;

export const getCodexCliModelDisplayName = (id: string): string | null => {
    if (id === CODEX_CLI_MODEL.id) return CODEX_CLI_MODEL.name;
    if (!id.startsWith('codex-cli:')) return null;

    const modelId = id.slice('codex-cli:'.length);
    const preset = CODEX_CLI_MODEL_PRESETS.find(model => model.id === modelId);
    return preset?.name || prettifyModelId(modelId);
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

/**
 * Providers whose model allow-list is OPT-IN: an empty list means NOTHING is
 * selected, not "everything".
 *
 * Every other provider ships a curated handful of preset models, so "empty =
 * all" is the right default there and stays. A GATEWAY fronts the upstream's
 * entire catalogue — a LiteLLM proxy runs to 300+ models, OpenRouter answered
 * 444 on 2026-09-17 — and defaulting that to "all" floods the meeting-overlay
 * picker with a list nobody chose.
 *
 * OpenRouter needs this even more than LiteLLM does, because ProviderCard
 * auto-fetches the catalogue on the model list's FIRST OPEN (`onFirstOpen`,
 * gated on `hasStoredKey && !hasCatalog`). Under "empty = all" a user who
 * merely opened the list once would have put all 444 into routing without ever
 * pressing Refresh.
 *
 * MIRRORED in ipcHandlers.ts modelAvailable(). The two must agree: this one
 * decides what the user can pick, that one decides what routing will accept.
 * A drift guard test pins them together.
 */
// Fluxion is deliberately ABSENT: 36 models, and its /v1/models is scoped to
// the key's group, so the auto-fetch cannot flood routing the way OpenRouter's
// 444 would. Adding it here would also need the mirror in modelAvailable().
// 9Router is opt-in for the plainest version of the reason: it exists to
// aggregate 40+ upstreams, and a stock local instance already answers
// /v1/models with 47 models across 6 aliases from one user's connected
// accounts. "Empty = all" would put a catalogue nobody chose into the
// picker. Adding a member here REQUIRES the mirror in modelAvailable()
// (ipcHandlers.ts); a drift-guard test pins the two together.
export const isOptInModelProvider = (provider: string): boolean => provider === 'litellm' || provider === 'openrouter' || provider === 'ninerouter';

/**
 * Does `modelId` survive `provider`'s allow-list?
 *
 * The single definition of the allow-list contract, so the settings panel, the
 * meeting-overlay picker and routing cannot disagree about what "empty" means.
 */
export const isModelAllowed = (provider: string, modelId: string, allowList: string[]): boolean => {
    // Opt-in: nothing is permitted until the user ticks it.
    if (isOptInModelProvider(provider)) return allowList.includes(modelId);
    // Everyone else: empty means no filter at all.
    return allowList.length === 0 || allowList.includes(modelId);
};

/**
 * The display label for a LiteLLM-proxied model.
 *
 * TWO prefixes stack on these ids, and neither is identity:
 *   1. `litellm/` — Natively's own routing prefix. providerFamily() and
 *      modelAvailable() (ipcHandlers.ts) key off it, so it can never be
 *      dropped from the ID; it just has no business being on screen.
 *   2. `<upstream>/` — the PROXY's own model id. Most LiteLLM configs name
 *      models `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`, `bedrock/...`,
 *      so a raw id reads `litellm/openai/gpt-4o`.
 *
 * The label is therefore the LAST segment. Accepts prefixed and bare ids
 * alike, because the two callers hold different forms: the picker and the
 * allow-list hold `litellm/<id>`, while the discovery cache
 * (getAvailableLiteLLMModels) holds the proxy's `<id>` verbatim.
 *
 * Deliberately NOT prettifyModelId(): that is built for our own hyphenated
 * ids and mangles proxy ids — `bedrock/anthropic.claude-v2` came out as
 * "Bedrock/Anthropic.Claude V2". A proxy model id is a literal the user typed
 * into their own config, so it renders verbatim.
 *
 * KNOWN, ACCEPTED: two upstreams can expose the same model name, so
 * `openai/gpt-4o` and `azure/gpt-4o` both label as "gpt-4o" and are
 * indistinguishable in a list. Showing the bare name was chosen with that
 * trade-off understood; disambiguating is a change to this one function.
 */
export const litellmModelLabel = (id: string): string => {
    if (!id) return '';
    const segments = id.replace(/^litellm\//, '').split('/').filter(Boolean);
    // Degenerate ids ("litellm/", "///") keep the input rather than becoming
    // an empty label — a blank row is worse than an ugly one.
    return segments.length ? segments[segments.length - 1] : id;
};

/**
 * The display label for any gateway-routed model id.
 *
 * Identical rule to litellmModelLabel — drop Natively's routing prefix, drop
 * the gateway's own upstream segment, show the last one — but it strips ANY
 * known routing prefix rather than the literal `litellm/`.
 *
 * That difference is small and real. litellmModelLabel returns the right
 * answer for `ninerouter/gemini/gemini-3.6-flash` only because it takes the
 * last segment and `ninerouter/` happens to be a segment worth dropping. A
 * single-segment id breaks the coincidence: `ninerouter/vip` — 9Router's
 * combos are single-segment — would label as "vip" correctly, but a bare
 * `ninerouter` would label as "ninerouter". Relying on the accident also
 * leaves a function whose NAME tells the next reader it does not apply.
 */

/** What 9Router's catalogue says about one model's reasoning behaviour. */
export interface NinerouterThinkingCaps {
    reasoning?: boolean;
    thinkingCanDisable?: boolean;
    /** 9Router's own enum: openai | claude-adaptive | claude-budget | gemini-level | … */
    thinkingFormat?: string | null;
}

/**
 * 9Router's per-format level vocabulary, mirrored from FORMAT_LEVELS in
 * `open-sse/providers/thinkingLevels.js`.
 *
 * WHY A TABLE AND NOT ONE LIST — this is the thing an earlier version of this
 * file got wrong. 9Router does not pass `reasoning_effort` through to the
 * upstream: `extractThinking()` reads it as client INTENT, `applyFormat()`
 * deletes it, and rewrites that intent into whatever the backend speaks —
 * `thinking: {budget_tokens}` for claude-budget, `setGeminiThinking({
 * thinkingLevel })` for gemini-level, a clamp to high|max for deepseek.
 *
 * That translation is exactly why ONE control can drive every backend. But the
 * legal levels differ per format, so a flat none/low/medium/high both invents
 * levels that do not exist (minimax and zai are BINARY — none or thinking) and
 * hides ones that do (claude's `max`, openai's `xhigh`).
 */
const NINEROUTER_FORMAT_LEVELS: Readonly<Record<string, readonly string[]>> = {
    openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    'claude-adaptive': ['none', 'low', 'medium', 'high', 'max'],
    'claude-budget': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    // No 'none' upstream either: gemini-3's thinkingLevel starts at minimal.
    'gemini-level': ['minimal', 'low', 'medium', 'high'],
    'gemini-budget': ['none', 'low', 'medium', 'high'],
    zai: ['none', 'thinking'],
    qwen: ['none', 'low', 'medium', 'high'],
    kimi: ['none', 'low', 'medium', 'high', 'max'],
    deepseek: ['none', 'high', 'max'],
    minimax: ['none', 'thinking'],
    hunyuan: ['none', 'low', 'medium', 'high'],
    step: ['none', 'low', 'medium', 'high'],
    commandcode: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};

/** Their `L.base` — the fallback for a format this table has not seen. */
const NINEROUTER_BASE_LEVELS: readonly string[] = ['none', 'low', 'medium', 'high'];

const NINEROUTER_LEVEL_LABELS: Readonly<Record<string, string>> = {
    none: 'Off — fastest',
    minimal: 'Minimal — fastest',
    thinking: 'Thinking on',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Very high',
    max: 'Maximum — slowest',
};

/**
 * The thinking levels worth offering for ONE 9Router model.
 *
 * `reasoning: false` -> no control at all; gemini/gemma-4-31b-it is the only
 * such chat model on a stock instance and a picker for it would do nothing.
 *
 * `thinkingCanDisable === false` -> 'none' is filtered out, which is precisely
 * what their own `getThinkingLevels()` does. Note this leaves gemini-level
 * starting at 'minimal', which is both their vocabulary and the honest label:
 * that model can be turned DOWN but not off.
 *
 * `reasoning_effort` is genuinely honoured rather than accepted-and-ignored —
 * latency moves monotonically across the scale, reproduced on two models. How
 * much it buys is model- and prompt-dependent, and 'auto' is a reasonable
 * default rather than something to escape: on Gemini, which varies its own
 * effort per prompt, auto was the fastest setting measured.
 */
export const ninerouterThinkingOptions = (
    caps?: NinerouterThinkingCaps | null,
): { id: string; name: string }[] => {
    if (caps && caps.reasoning === false) return [];
    const format = caps?.thinkingFormat || '';
    let levels = NINEROUTER_FORMAT_LEVELS[format] || NINEROUTER_BASE_LEVELS;
    if (caps?.thinkingCanDisable === false) levels = levels.filter(l => l !== 'none');
    return [
        { id: 'auto', name: 'Auto (model decides)' },
        ...levels.map(id => ({ id, name: NINEROUTER_LEVEL_LABELS[id] || id })),
    ];
};

/**
 * Every level any format can yield. The wire validator checks against this, so
 * it must be the UNION of the table above — a level the picker offers and the
 * validator drops is a silent no-op. A test pins the two together.
 */
export const NINEROUTER_THINKING_LEVELS = [
    'none', 'minimal', 'thinking', 'low', 'medium', 'high', 'xhigh', 'max',
] as const;

export const gatewayModelLabel = (id: string): string => {
    if (!id) return '';
    const segments = id.replace(/^(?:litellm|ninerouter|openrouter|nvidia_nim|fluxion)\//, '').split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : id;
};
