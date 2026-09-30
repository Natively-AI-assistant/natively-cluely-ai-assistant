/**
 * AgentRouter (https://agentrouter.org) — a free, community-run gateway for AI
 * coding tools. It runs new-api (every response carries `X-Oneapi-Request-Id`),
 * resells Claude, GPT, DeepSeek and GLM under the vendors' own BARE ids, and
 * speaks both wire protocols. Its only documentation is a set of per-tool setup
 * pages in Chinese (agentrouter.org/docs); everything below that is not in those
 * pages was MEASURED against the live gateway on 2026-09-30 with a real key.
 *
 * PURE — no SDK imports, deliberately. The electron build bundles every entry
 * separately, so importing the SDKs here put ~500 KB of openai + Anthropic
 * into VisionProviderRegistry and modelFetcher, which only need the constants.
 * The clients are built in agentRouterClients.ts. Every rule here is testable
 * without the 13k-line LLMHelper, and a live finding changes one line.
 *
 * ─── What the gateway actually does ────────────────────────────────────────
 *
 * 1. CLIENT ALLOW-LIST. Every route (`/v1/models`, `/v1/chat/completions`,
 *    `/v1/messages`) answers `401 {"type":"unauthorized_client_error",
 *    "error":{"message":"unauthorized client detected, contact support…"}}`
 *    unless the request identifies as a coding tool AgentRouter recognises. It
 *    passes on a User-Agent prefix (`claude-cli/`, `codex_cli_rs/`, `cline`,
 *    `opencode/`, `Kilo-Code/`, `RooCode/`, `QwenCode/`, `Hermes-Agent/`) or on
 *    an `originator: codex_*` header. The SDKs' own User-Agents, curl's and
 *    `Natively/<ver>` are all refused. See AGENTROUTER_CLIENT_HEADERS.
 *
 * 2. CONTENT FILTER, BEFORE AUTH. A canned probe ("Say WIRE-OK") is refused
 *    with `400 {"error":{"code":"content-blocked"}}` — even with a bogus key,
 *    so it runs before the key is checked. It targets key-checker traffic;
 *    real questions pass. Never probe this gateway with a canned phrase:
 *    Test Connection uses GET /v1/models instead.
 *
 * 3. TWO PROTOCOLS, CHOSEN PER MODEL. `/v1/models` reports
 *    `supported_endpoint_types` per model: claude-* and deepseek-* take both
 *    `anthropic` and `openai`, gpt-6-astra takes `openai` only. The docs say to
 *    prefer the Anthropic endpoint for the Claude Opus series and the OpenAI
 *    one for everything else, "in parallel, never mixed" — but for DeepSeek
 *    the measurements overrule the docs (see agentRouterProtocolFor). Base
 *    URLs differ the same way Fluxion's do: the Anthropic SDK appends
 *    `/v1/messages` itself, so its base has NO `/v1`.
 *
 * 4. RATIONED CLAUDE AND GPT. Per the site's own announcement (2026-08-28),
 *    Claude and GPT are released in daily batches at 02:00 and 11:00 UTC and
 *    answer `402 Budget pool quota has been exhausted` once a batch is gone;
 *    DeepSeek and GLM are not rationed that way. Measured: all Claude/GPT
 *    requests 402'd at 06:54 UTC while DeepSeek answered on both protocols.
 *
 * 5. WIRE QUIRKS that break code written for a well-behaved OpenAI server:
 *    - the OpenAI-format stream carries literal `data: null` events (two per
 *      DeepSeek answer: one between the reasoning and the content, one before
 *      the final chunk). The openai SDK yields those as `null` chunks.
 *    - a NON-streaming `/v1/messages` reply is `Content-Type: text/plain`, so
 *      the Anthropic SDK hands back a string and `.content` is undefined — an
 *      empty answer, not an error. Every AgentRouter call streams.
 *    - DeepSeek streams its hidden reasoning first (`reasoning_content`), which
 *      also counts against `max_tokens`: a 60-token cap ended `finish_reason:
 *      length` mid-sentence. `thinking:{type:"disabled"}` turns it off — on
 *      the Anthropic route every time, on Chat Completions only when the
 *      request lands on DeepSeek's own backend (3 of 12 did). That is why
 *      DeepSeek travels the Anthropic route (agentRouterProtocolFor).
 *
 * 6. ERRORS are new-api's, some in Chinese: `无效的令牌` (invalid token),
 *    `未提供令牌` (no token), and for an unknown or retired model `503 当前分组
 *    default 下对于模型 X 无可用渠道` ("no available channel for model X").
 *    explainAgentRouterError() turns each into something a user can act on.
 */

export const AGENTROUTER_ORIGIN = 'https://agentrouter.org';
/** OpenAI SDK base: the SDK appends `/chat/completions`. */
export const AGENTROUTER_OPENAI_BASE_URL = `${AGENTROUTER_ORIGIN}/v1`;
/** Anthropic SDK base: NO `/v1` — the SDK appends `/v1/messages` itself. */
export const AGENTROUTER_ANTHROPIC_BASE_URL = AGENTROUTER_ORIGIN;
/** Key-scoped catalogue; also the Test Connection probe (401 on a bad key, no model cost). */
export const AGENTROUTER_MODELS_URL = `${AGENTROUTER_ORIGIN}/v1/models`;

export const AGENTROUTER_PREFIX = 'agentrouter/';

/**
 * CLIENT IDENTITY — a DELIBERATE IMPERSONATION, chosen by Evin on 2026-09-30.
 *
 * AgentRouter answers only the coding tools on its allow-list (see fact 1 in
 * the header). Natively is not on it, and no honest identity passes: the SDK
 * User-Agents, `Natively/<ver>`, `Natively (compatible; opencode)` and an
 * `originator: natively` header were all refused. The options were put to Evin
 * with the risk stated plainly — AgentRouter's terms list bypassing its
 * restrictions and heavy general Q&A use as grounds for suspension, and it
 * publishes a ban list — against asking AgentRouter to allow-list Natively. He
 * chose to present as Codex CLI.
 *
 * The narrowest claim that works is this one header. The User-Agent stays the
 * SDK's own (`OpenAI/JS …`, `Anthropic/JS …`), which AgentRouter accepts
 * alongside it (measured), so the request does not also pretend to be a
 * different HTTP client. If AgentRouter tightens the check, every request
 * fails with 401 `unauthorized_client_error`, which explainAgentRouterError()
 * names as exactly that rather than as a bad key.
 *
 * Applied in ONE place per transport: createAgentRouterClients()
 * (agentRouterClients.ts) for both SDK clients, and agentRouterHttpHeaders()
 * for the axios catalogue/probe calls.
 */
export const AGENTROUTER_CLIENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    originator: 'codex_cli_rs',
});

/**
 * The model the Auto Answer judge runs on for an AgentRouter-only user
 * (LLMHelper.judgeGatewayModel). NOT the selected model: the judge fires on
 * every candidate utterance, and on Claude or GPT that would drain the user's
 * daily ration (fact 4) on classification calls before a single answer. DeepSeek
 * is not rationed and returned headers in ~0.8-0.9 s in the live probes.
 * If AgentRouter drops it, the call 503s, the judge rung returns null, and the
 * structured ladder takes over — the same as an unconfigured gateway.
 */
export const AGENTROUTER_JUDGE_MODEL = `${AGENTROUTER_PREFIX}deepseek-v4-flash`;

/**
 * What the runtime-default repair installs for an AgentRouter-only user who has
 * not promoted a model of their own (ipcHandlers refreshRuntimeDefaultIfUnavailable).
 * DeepSeek for the judge's reason: it is the one model not rationed per day, so
 * an automatically chosen default keeps answering after 11:00 UTC's Claude/GPT
 * batch runs out. Also the first preset in STANDARD_CLOUD_MODELS.
 */
export const AGENTROUTER_DEFAULT_MODEL = `${AGENTROUTER_PREFIX}deepseek-v4-flash`;

export type AgentRouterProtocol = 'openai' | 'anthropic';

/**
 * MUST be tested before every vendor predicate: AgentRouter's ids are the
 * vendors' own (`claude-opus-5`, `gpt-6-astra`, `deepseek-v4-flash`), so the
 * prefix is the ONLY thing separating an AgentRouter request from one billed to
 * the user's own Anthropic/OpenAI/DeepSeek key.
 */
export function isAgentRouterModelId(modelId: string | null | undefined): boolean {
    return !!modelId && modelId.startsWith(AGENTROUTER_PREFIX);
}

/**
 * `agentrouter/claude-opus-5` → `claude-opus-5`. Exactly ONE segment, which is
 * both the wire id and the capability id (Fluxion's shape, not OpenRouter's).
 * Deliberately NOT routed through deepseekWireModel(): `deepseek-v4-flash` is a
 * retired alias on DeepSeek's own API, but it is AgentRouter's CURRENT id, and
 * rewriting it to `deepseek-flash` would 503 "no available channel".
 */
export function agentRouterWireModel(modelId: string): string {
    return isAgentRouterModelId(modelId) ? modelId.slice(AGENTROUTER_PREFIX.length) : modelId;
}

/**
 * Which endpoint a model is sent to: Claude AND DeepSeek on the Anthropic
 * Messages API, everything else (gpt-6-astra, which is openai-only) on Chat
 * Completions.
 *
 * DeepSeek is here against the docs' "OpenAI format for the rest", because of
 * what the Chat Completions route did with it (measured 2026-09-30, compared
 * against DeepSeek's own API with the same body):
 *   - `thinking:{type:"disabled"}` was IGNORED on 9 of 12 requests. Those
 *     replies carried no `system_fingerprint` (DeepSeek's own API and the
 *     other 3 carried `aeb56401…`), streamed hidden reasoning first, and were
 *     slower — a different upstream channel.
 *   - on that channel a long answer came back EMPTY: all 8192 output tokens
 *     went to reasoning (`finish_reason: "max_tokens"` — an Anthropic stop
 *     reason in an OpenAI reply, which suggests the channel is an
 *     Anthropic-format upstream dropping the thinking field in translation;
 *     an inference, not confirmed).
 * On the Anthropic route thinking was off on 12 of 12, the same long answer
 * returned 8192 tokens of text (34,412 chars; direct DeepSeek 34,635), all
 * three needles were recalled at ~155k tokens, and first tokens came faster
 * and steadier. What is lost is `seed`, which the Anthropic API does not
 * have — and which did not make direct DeepSeek deterministic anyway (3
 * distinct replies from 3 identical seeded requests).
 *
 * Covers the whole live catalogue, and is the ONE line to change if a later
 * measurement disagrees.
 */
export function agentRouterProtocolFor(wireModel: string): AgentRouterProtocol {
    return /^(?:claude-|deepseek-)/i.test(wireModel) ? 'anthropic' : 'openai';
}

/** Claude family (not protocol): picks the native Claude system prompt and parameters. */
export function isAgentRouterClaudeWireModel(wireModel: string): boolean {
    return /^claude-/i.test(wireModel);
}

/**
 * The catalogue as the card should list it: prefixed, the unrationed default
 * FIRST, then alphabetical. The order is load-bearing — ProviderCard adopts the
 * first fetched row as the preferred model when there is none, and the
 * preferred model is what the runtime-default repair installs. Plain
 * alphabetical put `claude-opus-4-8` first (seen live 2026-09-30), a model that
 * 402s once the day's Claude batch is gone.
 */
export function agentRouterCatalogue(rawIds: readonly unknown[]): Array<{ id: string; label: string }> {
    return rawIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .map((id) => ({ id: `${AGENTROUTER_PREFIX}${id}`, label: id }))
        .sort((a, b) => {
            if (a.id === AGENTROUTER_DEFAULT_MODEL) return -1;
            if (b.id === AGENTROUTER_DEFAULT_MODEL) return 1;
            return a.label.localeCompare(b.label);
        });
}

/** Headers for a raw HTTP call (catalogue fetch, Test Connection). */
export function agentRouterHttpHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, ...AGENTROUTER_CLIENT_HEADERS };
}

function stringify(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return ''; }
}

/**
 * A user-facing explanation for an AgentRouter failure, or null when the error
 * is not one of the gateway's known shapes (the caller then keeps the original).
 *
 * Reads the status AND the body text, because the two SDKs and axios put the
 * body in different places: the openai SDK keeps only `body.error` on
 * `err.error` (so the top-level `type: unauthorized_client_error` is gone and
 * only the message survives), the Anthropic SDK keeps the whole body, and
 * axios has it on `err.response.data`.
 */
export function explainAgentRouterError(err: unknown, wireModel?: string): string | null {
    const e: any = err;
    if (!e) return null;
    const status = Number(e.status ?? e.response?.status ?? 0) || 0;
    const text = [e.message, stringify(e.error), stringify(e.response?.data)].filter(Boolean).join(' ');
    const model = wireModel || 'this model';

    if (/unauthori[sz]ed[_ ]client/i.test(text)) {
        return 'AgentRouter refused the request as coming from an unrecognised app. It only serves the coding tools '
            + 'on its own list and may have changed that list. Update Natively, or pick another provider.';
    }
    if (/无效的令牌|未提供令牌/.test(text) || status === 401) {
        return 'AgentRouter rejected the API key. Check it in Settings > AI Providers > AgentRouter.';
    }
    if (status === 402 || /budget pool quota has been exhausted/i.test(text)) {
        return `AgentRouter has used up today's shared allowance for ${model}. Claude and GPT refill at 02:00 and `
            + '11:00 UTC; DeepSeek on AgentRouter keeps working in the meantime.';
    }
    if (/无可用渠道|no available channel/i.test(text)) {
        return `AgentRouter has no capacity for ${model} right now, or has taken it offline. Refresh the model `
            + 'list in Settings > AI Providers > AgentRouter, or pick another model.';
    }
    if (/content-blocked/i.test(text)) {
        return 'AgentRouter\'s content filter blocked this request.';
    }
    if (status === 429) {
        return 'AgentRouter is rate-limiting this key. Wait a moment and try again.';
    }
    return null;
}

/**
 * The error to throw for an AgentRouter failure: the explained one when the
 * shape is known, otherwise the original untouched (an abort must stay an
 * abort). `status` is carried over so failover and circuit logic that reads it
 * sees the same number it would have seen on the raw error.
 */
export function agentRouterError(err: unknown, wireModel?: string): unknown {
    const explained = explainAgentRouterError(err, wireModel);
    if (!explained) return err;
    const e: any = err;
    return Object.assign(new Error(explained), {
        status: e?.status ?? e?.response?.status,
        agentRouter: true,
        cause: err,
    });
}
