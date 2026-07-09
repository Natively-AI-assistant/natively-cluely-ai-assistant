/**
 * CodexCliService — direct HTTPS ChatGPT Codex provider (replaces subprocess)
 *
 * History: the previous implementation spawned the `codex` CLI as a child
 * process and parsed its NDJSON event stream. This had two persistent
 * failure modes that drove the rewrite:
 *   1. Users without the @openai/codex binary (or with a stale one) hit
 *      ENOENT every chat. The auto-detect fallback covered common install
 *      locations but not, e.g., `nix run` or non-PATH installs.
 *   2. The CLI is a Rust binary that cold-loads the model on first
 *      invocation, so the first delta could take 5-8s and the subprocess
 *      IPC overhead added more. The 60s default timeout saved us from
 *      the most catastrophic hangs but the user-visible behavior was still
 *      "sometimes it works, sometimes it doesn't".
 *
 * The new design drops the subprocess entirely. We use ChatGPT OAuth
 * (see CodexOAuthService) to mint a bearer token, then call
 * `https://api.openai.com/v1/responses` directly with `fetch()` and
 * `ReadableStream` SSE. This is the same endpoint the open-sse
 * `CodexExecutor` calls (codex.md:1113 — `baseUrl: https://chatgpt.com/backend-api/codex/responses`),
 * adapted to Electron's Node runtime and pinned to the OpenAI-hosted
 * `/v1/responses` route that all ChatGPT-account bearer tokens accept.
 *
 * Public surface preserved for backward compatibility:
 *   - DEFAULT_CODEX_CLI_CONFIG (shape unchanged)
 *   - CodexCliService.run / .stream (signature unchanged)
 *   - CodexCliService.normalizeConfig (signature unchanged)
 *   - CodexCliService.buildArgs (DEPRECATED — returns [] but kept so the
 *     few tests that import it don't break; new code should not call it)
 *   - resolveCodexReasoningEffort (unchanged, per-model VALID set)
 *
 * Wire-level differences from the old subprocess design:
 *   - Bearer token is read from CodexOAuthService (not argv)
 *   - Reasoning effort goes in `body.reasoning.effort` (not -c flag)
 *   - `service_tier` goes in `body.service_tier` (not -c flag)
 *   - 401 → refresh-once-and-retry (matches open-sse chatCore:844-863)
 *   - 429 / 5xx → exponential backoff with jitter (up to 3 attempts)
 *   - AbortSignal cancels the in-flight fetch and propagates to the
 *     stream consumer; partial deltas yielded so far are NOT lost.
 */

import { CodexOAuthService } from './CodexOAuthService';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexServiceTier = 'default' | 'fast' | 'flex';
// 'none' is distinct from undefined: 'none' is the explicit user pick meaning
// "no reasoning_effort override"; undefined means "user didn't pick one" → also
// omit the field. 'minimal' is intentionally NOT in this union because no
// codex-supported model accepts it (OpenAI removed it after the original gpt-5
// line — see electron/llm/__tests__/OpenAiReasoningEffort.test.mjs).
export type CodexModelReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export const CODEX_SANDBOX_MODES: readonly CodexSandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'] as const;
export const CODEX_SERVICE_TIERS: readonly CodexServiceTier[] = ['default', 'fast', 'flex'] as const;
export const CODEX_MODEL_REASONING_EFFORTS: readonly CodexModelReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

// Per-model valid reasoning_effort sets. Mirrors the OpenAI HTTP VALID map at
// electron/llm/__tests__/OpenAiReasoningEffort.test.mjs:27-45. Sending
// e.g. xhigh to gpt-5.3-codex over the wire triggers a 400 turn.failed event
// that our fallback chain swallows into "Let me come back to that in just a
// moment." The user's pick is validated against the per-model set;
// unsupported values are silently downgraded to the LOWEST-latency valid
// value (matches the OpenAI HTTP picker's behaviour).
//
// NOTE: this table is now ALSO used for the HTTP request body's
// reasoning.effort field — the same per-family constraints apply, so
// keeping it as the single source of truth avoids drift.
const CODEX_MODEL_REASONING_SETS: ReadonlyArray<readonly [string, readonly CodexModelReasoningEffort[]]> = [
  // Original gpt-5 line — minimal accepted (not exposed); low/medium/high.
  ['gpt-5-2025-08-07', ['low', 'medium', 'high']],
  ['gpt-5-mini',       ['low', 'medium', 'high']],
  ['gpt-5-nano',       ['low', 'medium', 'high']],
  // Bare 'gpt-5' (NOT 5.x) — must come AFTER 5.x entries to avoid swallowing them.
  ['gpt-5',            ['low', 'medium', 'high']],
  // gpt-5.1+ chat — `none` accepted; `xhigh` only on 5.2+.
  ['gpt-5.1',          ['none', 'low', 'medium', 'high']],
  ['gpt-5.2',          ['none', 'low', 'medium', 'high', 'xhigh']],
  ['gpt-5.4',          ['none', 'low', 'medium', 'high', 'xhigh']],
  ['gpt-5.5',          ['none', 'low', 'medium', 'high', 'xhigh']],
  // codex variants — `none` not supported; `xhigh` only on 5.2-codex+.
  ['gpt-5.5-codex',    ['low', 'medium', 'high', 'xhigh']],
  ['gpt-5.4-codex',    ['low', 'medium', 'high', 'xhigh']],
  ['gpt-5.3-codex-spark', ['low', 'medium', 'high']],
  ['gpt-5.3-codex',    ['low', 'medium', 'high']],
  ['gpt-5.2-codex',    ['low', 'medium', 'high', 'xhigh']],
  ['gpt-5.1-codex',    ['low', 'medium', 'high']],
  ['gpt-5-codex',      ['low', 'medium', 'high']],
];

/**
 * Resolve the user's reasoning-effort pick against the model's per-family
 * VALID set. Mirrors getOpenAiReasoningEffort() (electron/llm/modelCapabilities.ts:217).
 *
 * Returns the value to emit as `body.reasoning.effort`, or undefined
 * to omit the field entirely (used when pick is undefined/null/empty).
 *
 * Downgrade policy (when the user's pick is NOT in the model's valid set):
 *  - If the user picked 'none' but the model doesn't accept 'none' → 'low'.
 *  - Otherwise → first entry of the valid set with 'none' removed (lowest-
 *    latency REASONING effort, not the lowest-latency of all values).
 *
 * Longest-key match wins so 'gpt-5.4-codex' resolves via its entry, not the
 * generic 'gpt-5' one.
 */
export function resolveCodexReasoningEffort(
  modelId: string,
  pick?: CodexModelReasoningEffort | string | null,
): CodexModelReasoningEffort | undefined {
  if (!pick) return undefined;
  const id = (modelId || '').toLowerCase();
  let bestEntry: readonly [string, readonly CodexModelReasoningEffort[]] | null = null;
  for (const entry of CODEX_MODEL_REASONING_SETS) {
    if (id.includes(entry[0]) && (!bestEntry || entry[0].length > bestEntry[0].length)) {
      bestEntry = entry;
    }
  }
  const valid = bestEntry ? bestEntry[1] : (['low', 'medium', 'high'] as const);
  // Exact match → honour the user's pick.
  if ((valid as readonly string[]).includes(pick)) return pick as CodexModelReasoningEffort;
  // Unsupported pick. Pick the lowest-latency REASONING effort (skip 'none').
  const reasoningOnly = (valid as readonly string[]).filter(v => v !== 'none');
  const fallback = reasoningOnly[0] || valid[0];
  return fallback as CodexModelReasoningEffort;
}

export interface CodexCliConfig {
  enabled: boolean;
  /**
   * @deprecated Kept for IPC backward-compat. The new implementation does
   * not spawn a CLI binary; `path` is ignored at runtime. The settings
   * field is still read/written so the Settings UI doesn't reset.
   */
  path: string;
  model: string;
  fastModel: string;
  timeoutMs: number;
  /** @deprecated Ignored — Codex CLI sandbox flags don't apply to HTTP. */
  sandboxMode: CodexSandboxMode;
  serviceTier: CodexServiceTier;
  modelReasoningEffort?: CodexModelReasoningEffort;
}

export interface CodexCliRunOptions {
  prompt: string;
  model: string;
  timeoutMs: number;
  imagePaths?: string[];
  /** @deprecated Ignored. */
  sandboxMode?: CodexSandboxMode;
  serviceTier?: CodexServiceTier;
  modelReasoningEffort?: CodexModelReasoningEffort;
  signal?: AbortSignal;
  /** Optional system prompt (used as the `instructions` field on the
   *  Responses API; matches open-sse CodexExecutor.transformRequest
   *  at codex.md:419-422). */
  instructions?: string;
  /**
   * Optional session-stable id used as the basis for `prompt_cache_key` and
   * the `session_id` request header. The Codex backend keys its server-side
   * cache + rate-limit bucket off `session_id`, so a stable value across
   * consecutive calls yields cache hits. When omitted, the service-wide
   * SESSION_ID (one per process) is used.
   */
  sessionId?: string;
}

// Default fast model: gpt-5.3-codex works with both ChatGPT-account and API-key
// auth. The faster gpt-5.3-codex-spark is API-key-only and 400s on ChatGPT auth.
export const DEFAULT_CODEX_CLI_CONFIG: CodexCliConfig = {
  enabled: false,
  path: 'codex', // deprecated — kept so older settings round-trip without resetting
  model: 'gpt-5.4',
  fastModel: 'gpt-5.3-codex',
  timeoutMs: 60_000,
  sandboxMode: 'read-only', // deprecated
  serviceTier: 'default',
  modelReasoningEffort: undefined,
};

// Codex backend endpoint. ChatGPT-subscription OAuth bearer tokens issued by
// `https://auth.openai.com/oauth/token` are routed to ChatGPT's own backend,
// not the public `api.openai.com` host — the open-sse reference (and the
// official `codex_cli_rs` binary) hit `chatgpt.com/backend-api/codex/responses`.
// Using `api.openai.com/v1/responses` here would 401 with a ChatGPT OAuth
// token, defeating the entire "no API key, just ChatGPT subscription" path.
// See codex.md:1113 (`baseUrl` in open-sse/providers/registry/codex.js) and
// codex.md:1149-1169 for the OAuth constants that map to this endpoint.
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

// Retry policy for transient upstream failures. Matches the open-sse
// chatCore 401-refresh (codex.md:844-863) and the 503-retry default in
// DEFAULT_RETRY_CONFIG (codex.md:283-317).
const TRANSIENT_RETRY_MAX = 3;
const TRANSIENT_RETRY_BASE_MS = 500;
const TRANSIENT_RETRY_CAP_MS = 8_000;

// Sentinel thrown from parseSseStream when the SSE body carries a transient
// error (e.g. "servers are currently overloaded"). fetchDeltas catches this
// and retries with backoff instead of surfacing it to the caller.
class TransientStreamError extends Error {
  readonly isTransient = true;
  constructor(message: string) {
    super(message);
    this.name = 'TransientStreamError';
  }
}

function isTransientStreamMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('overloaded') || lower.includes('try again') || lower.includes('service unavailable') || lower.includes('capacity');
}

// =============================================================================
// CodexCliService — public static surface
// =============================================================================

export class CodexCliService {
  /**
   * Process-stable session id used as the default value for
   * `CodexCliRunOptions.sessionId`. Generated once at module load and
   * reused for every Codex call within this run. The Codex backend uses
   * this as the basis for `prompt_cache_key` + `session_id` header, so a
   * stable value yields cache hits across consecutive calls. Mirrors
   * open-sse's `resolveCacheSessionId()` (codex.md:195-204).
   */
  public static readonly SESSION_ID: string =
    `natively-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  /**
   * @deprecated The HTTP-direct implementation does not use a CLI binary
   * and has no `argv`. Kept so callers that still import `buildArgs` for
   * tests/inspection don't crash; returns an empty array. The new
   * equivalents are `body.model`, `body.reasoning.effort`, and
   * `body.service_tier` in the request body.
   */
  public static buildArgs(
    _model: string,
    _imagePaths: string[] = [],
    _sandboxMode: CodexSandboxMode = 'read-only',
    _serviceTier?: CodexServiceTier,
    _modelReasoningEffort?: CodexModelReasoningEffort,
  ): string[] {
    return [];
  }

  public static normalizeConfig(config: Partial<CodexCliConfig> = {}): CodexCliConfig {
    const timeoutMs = Number(config.timeoutMs);
    const sandboxMode = (config.sandboxMode && (CODEX_SANDBOX_MODES as readonly string[]).includes(config.sandboxMode))
      ? config.sandboxMode
      : DEFAULT_CODEX_CLI_CONFIG.sandboxMode;
    const serviceTier = (config.serviceTier && (CODEX_SERVICE_TIERS as readonly string[]).includes(config.serviceTier))
      ? config.serviceTier
      : DEFAULT_CODEX_CLI_CONFIG.serviceTier;
    // Pick must be in the union type first; then resolveCodexReasoningEffort
    // downgrades unsupported values for the chosen model.
    let modelReasoningEffort: CodexModelReasoningEffort | undefined;
    if (config.modelReasoningEffort && (CODEX_MODEL_REASONING_EFFORTS as readonly string[]).includes(config.modelReasoningEffort)) {
      modelReasoningEffort = config.modelReasoningEffort;
    }
    const modelName = (config.model || DEFAULT_CODEX_CLI_CONFIG.model).trim() || DEFAULT_CODEX_CLI_CONFIG.model;
    modelReasoningEffort = resolveCodexReasoningEffort(modelName, modelReasoningEffort);
    return {
      enabled: !!config.enabled,
      // `path` is preserved verbatim for backward-compat (Settings UI
      // may still display it). New HTTP-direct code does not use it.
      path: (config.path || DEFAULT_CODEX_CLI_CONFIG.path).trim() || DEFAULT_CODEX_CLI_CONFIG.path,
      model: modelName,
      fastModel: (config.fastModel || DEFAULT_CODEX_CLI_CONFIG.fastModel).trim() || DEFAULT_CODEX_CLI_CONFIG.fastModel,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CODEX_CLI_CONFIG.timeoutMs,
      sandboxMode,
      serviceTier,
      modelReasoningEffort,
    };
  }

  /**
   * Collect the full response into a single string. Thin wrapper over
   * `stream()` that buffers all deltas. Prefer `stream()` for user-visible
   * surfaces (so the UI can show progress).
   */
  public static async run(_path: string, options: CodexCliRunOptions): Promise<string> {
    if (options.signal?.aborted) throw new Error('Codex request aborted before start.');
    let out = '';
    for await (const chunk of this.stream('', options)) {
      out += chunk;
    }
    return out;
  }

  /**
   * Stream the Codex response as a series of text deltas.
   *
   * The `_path` parameter is preserved for backward-compat with the old
   * subprocess surface (LLMHelper.streamWithCodexCli still passes
   * `this.codexCliConfig.path`); it is ignored.
   */
  public static async *stream(_path: string, options: CodexCliRunOptions): AsyncGenerator<string, void, unknown> {
    if (options.signal?.aborted) throw new Error('Codex request aborted before start.');

    const oauth = CodexOAuthService.getInstance();
    const status = oauth.getStatus();
    if (!status.signedIn) {
      throw new Error('Not signed in to ChatGPT. Please complete Codex OAuth login from Settings → AI Providers.');
    }

    // Build the request body ONCE outside the retry loop — refreshing
    // tokens doesn't change the prompt.
    const body = this.buildRequestBody(options);
    const headers = this.buildHeaders();

    // Idle-timeout guard: aborts the HTTP connection if no bytes arrive for
    // `timeoutMs` ms. The timer RESETS on every yielded delta, so a long
    // answer that is actively streaming (even slowly) is never cut off.
    // This is intentionally NOT a wall-clock cap from request start — that
    // would abort long but healthy responses (e.g. gpt-5.5 with a large
    // system prompt routinely takes >30s total). The outer
    // raceStreamWithDeadline() already handles the first-useful-token
    // deadline and the inter-token stall guard independently; this guard
    // serves as a belt-and-suspenders kill for a truly stuck HTTP connection
    // (server accepted the request but sends nothing at all for timeoutMs).
    const deadlineController = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout> = setTimeout(() => deadlineController.abort(), options.timeoutMs);
    const resetDeadline = () => {
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => deadlineController.abort(), options.timeoutMs);
    };
    // Combine user-supplied signal with our idle-timeout signal.
    const combinedSignal = combineSignals(options.signal, deadlineController.signal);
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      combinedSignal.dispose();
    };

    try {
      const deltas = this.fetchDeltas(body, headers, combinedSignal.signal, options);
      for await (const delta of deltas) {
        resetDeadline();
        yield delta;
      }
    } finally {
      cleanup();
    }
  }

  // ---------------------------------------------------------------------------
  // Request body / headers
  // ---------------------------------------------------------------------------

  /**
   * Build the OpenAI Responses API body. Mirrors open-sse
   * CodexExecutor.transformRequest (codex.md:395-487):
   *  - `model` is the requested model (e.g. "gpt-5.4")
   *  - `input` is an array of message items (we only send one user turn
   *    because the existing LLMHelper assembles a self-contained prompt
   *    string at LLMHelper.buildCodexCliPrompt)
   *  - `instructions` is the system prompt (Codex uses this for its
   *    default behaviour + user customisations)
   *  - `reasoning.effort` is set from the resolved pick
   *  - `stream: true` is mandatory for the streaming endpoint
   *  - `store: false` is mandatory — we don't want the response saved
   *    server-side, and prior server-side item IDs would 404 the request
   *  - `service_tier` is "default" / "fast" / "flex" (or omitted)
   *  - `include: ["reasoning.encrypted_content"]` is required for the
   *    backend to surface reasoning items (codex.md:457-460)
   *  - `prompt_cache_key` is a stable session id so the backend can
   *    cache the prompt prefix (codex.md:428-430)
   */
  private static buildRequestBody(options: CodexCliRunOptions): Record<string, unknown> {
    const resolvedEffort = resolveCodexReasoningEffort(options.model, options.modelReasoningEffort);

    // Image inputs: Responses API wants `type: "input_image"` items.
    // We don't yet support image-bearing Codex calls in this rewrite
    // (LLMHelper.buildCodexCliPrompt only passes text) — the imagePaths
    // arg is accepted for backward-compat but ignored at the wire level.
    // Future: encode as data URLs the same way LocalWhisperSTT does.

    const input: Array<Record<string, unknown>> = [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: options.prompt },
        ],
      },
    ];

    // Stable per-process session id. The Codex backend keys its server-side
    // prompt cache and rate-limit buckets off `session_id`, so a stable value
    // yields cache hits across consecutive calls (saving both latency and
    // input-token cost) instead of every call landing in a fresh bucket.
    // The open-sse reference resolves the same id once per session via
    // `resolveCacheSessionId()` (codex.md:195-204); we mirror it here.
    const sessionId = options.sessionId ?? CodexCliService.SESSION_ID;

    const body: Record<string, unknown> = {
      model: options.model,
      input,
      stream: true,
      store: false,
      // prompt_cache_key is a session-stable key so the backend can
      // cache the prompt prefix. Matches the open-sse pattern at
      // codex.md:427-430 where the key is derived from a stable session
      // id, NOT a per-minute timestamp (which would defeat the cache).
      prompt_cache_key: `codex-${options.model}-${sessionId}`,
    };

    if (options.instructions && options.instructions.trim()) {
      body.instructions = options.instructions;
    }

    if (resolvedEffort) {
      body.reasoning = { effort: resolvedEffort, summary: 'auto' };
      // Required so the backend surfaces the reasoning items in the
      // stream (open-sse includes this for all non-'none' efforts).
      if (resolvedEffort !== 'none') {
        body.include = ['reasoning.encrypted_content'];
      }
    }

    if (options.serviceTier && options.serviceTier !== 'default') {
      body.service_tier = options.serviceTier;
    }

    return body;
  }

  /**
   * Build the request headers. Pulls the bearer token from CodexOAuthService
   * and adds the standard identity headers the Codex backend expects
   * (mirrors open-sse codex.js buildHeaders at codex.md:220-231).
   */
  private static async buildHeadersAsync(): Promise<Record<string, string>> {
    const oauth = CodexOAuthService.getInstance();
    const accessToken = await oauth.getAccessToken();
    if (!accessToken) {
      throw new Error('Not signed in to ChatGPT. Please complete Codex OAuth login from Settings → AI Providers.');
    }
    const tokens = oauth.getCachedTokens();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${accessToken}`,
      // Identify the client. The official codex CLI uses "codex_cli_rs" —
      // matching it keeps the backend on the same routing path. See
      // codex.md:1117 and codex.md:224.
      originator: 'codex_cli_rs',
      // Stable session id for backend routing/billing/cache bucketing.
      // The Codex backend keys prompt-cache + rate-limit off this header
      // (codex.md:222). Default = per-process stable SESSION_ID so
      // consecutive calls land in the same bucket; callers can override
      // via CodexCliRunOptions.sessionId for explicit multi-call flows.
      'session_id': CodexCliService.SESSION_ID,
    };
    // Workspace binding header — improves account scope + cache affinity
    // (codex.md:226-229).
    if (tokens?.accountId) headers['chatgpt-account-id'] = tokens.accountId;
    return headers;
  }

  /**
   * Sync wrapper for callers that already have a token in hand. Most
   * callers should use the async builder; this exists so the retry loop
   * can refresh-and-retry without re-awaiting the same access token
   * check twice in a row.
   */
  private static buildHeaders(): Record<string, string> {
    const oauth = CodexOAuthService.getInstance();
    const tokens = oauth.getCachedTokens();
    if (!tokens || !tokens.accessToken) {
      throw new Error('Not signed in to ChatGPT. Please complete Codex OAuth login from Settings → AI Providers.');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${tokens.accessToken}`,
      originator: 'codex_cli_rs',
      // Stable session id (see buildHeadersAsync for the rationale).
      'session_id': CodexCliService.SESSION_ID,
    };
    if (tokens.accountId) headers['chatgpt-account-id'] = tokens.accountId;
    return headers;
  }

  // ---------------------------------------------------------------------------
  // SSE fetch + parsing
  // ---------------------------------------------------------------------------

  /**
   * Execute the fetch and yield text deltas as they arrive. Handles:
   *  - 401 → force-refresh the token and retry ONCE
   *  - 429 / 5xx → exponential backoff with jitter, up to TRANSIENT_RETRY_MAX
   *  - AbortSignal / deadline → propagate to the fetch + reader
   *  - SSE parsing (event: / data: / [DONE] / multi-line data)
   */
  private static async *fetchDeltas(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal,
    _options: CodexCliRunOptions,
  ): AsyncGenerator<string, void, unknown> {
    let attempt = 0;
    let refreshedOnce = false;

    while (true) {
      if (signal.aborted) {
        throw new Error('Codex request aborted.');
      }

      // Re-mint headers on each attempt so a 401-retry uses the FRESH
      // access token (after the refresh succeeded, not before).
      const currentHeaders = await this.buildHeadersAsync();
      // Merge session-stateful headers (Bearer, account id) with the
      // per-attempt computed ones. Callers may have passed static
      // Content-Type/originator in `headers`; the async builder
      // overwrites with the same values.
      const merged: Record<string, string> = { ...headers, ...currentHeaders };

      let response: Response;
      try {
        response = await fetch(CODEX_RESPONSES_URL, {
          method: 'POST',
          headers: merged,
          body: JSON.stringify(body),
          signal,
        });
      } catch (e: any) {
        // AbortError: re-throw so the generator halts cleanly.
        if (e?.name === 'AbortError') {
          throw new Error('Codex request aborted.');
        }
        // Network error: retry with backoff.
        if (attempt >= TRANSIENT_RETRY_MAX) {
          throw new Error(`Codex request failed after ${TRANSIENT_RETRY_MAX} retries: ${e?.message || e}`);
        }
        await sleepWithJitter(attempt);
        attempt++;
        continue;
      }

      if (response.status === 401 && !refreshedOnce) {
        // Force a refresh and retry exactly once. Matches open-sse
        // chatCore:844-863.
        refreshedOnce = true;
        const oauth = CodexOAuthService.getInstance();
        const refreshed = await oauth.refreshTokens();
        if (!refreshed) {
          throw new Error('Codex session expired. Please sign in again from Settings → AI Providers.');
        }
        continue;
      }

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt >= TRANSIENT_RETRY_MAX) {
          const text = await safeReadText(response);
          throw new Error(`Codex upstream ${response.status} after ${TRANSIENT_RETRY_MAX} retries: ${truncate(text, 500)}`);
        }
        attempt++;
        // Honour Retry-After if the server sends one.
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        await sleepWithJitter(attempt - 1, retryAfter);
        continue;
      }

      if (!response.ok) {
        // Non-retryable upstream error. Read the body (it's small —
        // usually an error envelope) and surface the message verbatim
        // so the user sees "model not supported when using Codex with
        // a ChatGPT account" instead of the canned fallback.
        const text = await safeReadText(response);
        const message = extractResponsesErrorMessage(text) || `Codex upstream ${response.status}`;
        throw new Error(message);
      }

      // Happy path: stream SSE.
      // parseSseStream may throw TransientStreamError for mid-stream
      // "overloaded" responses. Catch here to retry with backoff.
      try {
        yield* this.parseSseStream(response, signal);
        attempt = 0; // reset for the next request in a long-lived session
        return;
      } catch (e: any) {
        if (e instanceof TransientStreamError) {
          if (attempt >= TRANSIENT_RETRY_MAX) {
            throw new Error(e.message);
          }
          await sleepWithJitter(attempt);
          attempt++;
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Parse an SSE byte stream into text deltas. Responses API SSE events:
   *   event: response.created
   *   data: {"type":"response.created",...}
   *
   *   event: response.output_text.delta
   *   data: {"type":"response.output_text.delta","delta":"Hello",...}
   *
   *   event: response.output_text.done
   *   data: {...,"text":"Hello world",...}
   *
   *   event: response.completed
   *   data: {"type":"response.completed",...}
   *
   *   data: [DONE]
   *
   * We extract deltas (response.output_text.delta) and yield them as
   * strings. The done event carries the full text; we don't yield it
   * because the deltas already produced the same content (avoids
   * double-yielding). Errors embedded in the stream surface immediately.
   */
  private static async *parseSseStream(response: Response, signal: AbortSignal): AsyncGenerator<string, void, unknown> {
    if (!response.body) {
      throw new Error('Codex response had no body.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    // Tracks whether the stream for THIS response has finished normally.
    // Set to `true` when ANY of the following happens:
    //   - a terminal event arrives: response.completed / .incomplete / .failed
    //   - the SSE body closes cleanly (reader.read() returns done: true)
    //
    // Once set, an AbortError on a subsequent reader.read() is a benign
    // cleanup event (the ChatGPT OAuth endpoint keeps the SSE body open
    // with :keepalive for ~30s after the model finishes; if our outer
    // controller.abort() fires during that window, the still-bound
    // fetch rejects reader.read() with AbortError — even though the
    // response was already fully delivered). Surfacing such an abort
    // as "Codex request aborted." is the bug this flag was added to
    // address.
    //
    // CRITICAL: this flag MUST also cover the clean-close path (`done:
    // true`) below. The 30s-late AbortError can ALSO fire on a stream
    // that finished via `done: true` without a terminal event name we
    // recognize (in practice chatgpt.com sometimes sends the final
    // delta + closes the body without emitting response.completed).
    let sawTerminalEvent = false;
    let terminalError: Error | null = null;
    try {
      while (true) {
        if (signal.aborted) {
          throw new Error('Codex request aborted.');
        }
        const { value, done } = await reader.read();
        if (done) {
          // Body closed cleanly (server sent EOF, or our own prior
          // reader.cancel() in the finally of an earlier code path
          // unwound the body). This IS a successful completion — deltas
          // were already flushed. Set sawTerminalEvent so any future
          // AbortError on the catch's swallow predicate treats this
          // stream as post-completion cleanup, in case the abort
          // signal fires after the loop exits.
          sawTerminalEvent = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by a blank line ("\n\n" in
        // practice; some servers use \r\n\r\n).
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 4 : 2));
          const parsed = parseSseEvent(raw);
          if (!parsed) continue;
          // The `[DONE]` sentinel was historically used by the old
          // chat-completions SSE protocol to signal end-of-stream. The
          // new Responses API uses `response.completed` / .incomplete /
          // .failed events instead — those drive sawTerminalEvent
          // (the flag that gates the post-completion AbortError
          // swallow). We intentionally IGNORE `[DONE]` here: ignoring
          // it lets the parser keep reading the body until the real
          // terminal event arrives or the body closes, which matches
          // the natively path at LLMHelper.ts:4897-4900 (also ignores
          // `[DONE]` and relies on the terminal event).
          if (parsed.data === '[DONE]') continue;
          let json: any;
          try {
            json = JSON.parse(parsed.data);
          } catch {
            // Tolerate non-JSON lines (e.g. comments). Don't yield.
            continue;
          }
          const delta = extractResponsesTextDelta(json);
          if (delta) yield delta;
          const errMsg = extractResponsesStreamError(json);
          if (errMsg) {
            terminalError = isTransientStreamMessage(errMsg)
              ? new TransientStreamError(errMsg)
              : new Error(errMsg);
            break;
          }
          // Real terminal events on the Responses SSE stream. Once
          // any of these arrive, we know the model has finished and
          // the deltas have all been yielded. From here on, ANY
          // AbortError on reader.read() is post-completion cleanup
          // noise — don't surface it.
          if (json && (json.type === 'response.completed' ||
              json.type === 'response.incomplete' ||
              json.type === 'response.failed')) {
            sawTerminalEvent = true;
            break;
          }
        }
        if (terminalError) break;
        if (sawTerminalEvent) break;
      }
      // Drain any trailing buffer (last event without trailing blank line).
      if (buffer.trim()) {
        const parsed = parseSseEvent(buffer);
        if (parsed && parsed.data && parsed.data !== '[DONE]') {
          try {
            const json = JSON.parse(parsed.data);
            const delta = extractResponsesTextDelta(json);
            if (delta) yield delta;
            const errMsg = extractResponsesStreamError(json);
            if (errMsg) {
              terminalError = isTransientStreamMessage(errMsg)
                ? new TransientStreamError(errMsg)
                : new Error(errMsg);
            }
            if (json && (json.type === 'response.completed' ||
                json.type === 'response.incomplete' ||
                json.type === 'response.failed')) {
              sawTerminalEvent = true;
            }
          } catch { /* not JSON, ignore */ }
        }
      }
    } catch (e: any) {
      // POST-COMPLETION SWALLOW: an AbortError thrown by reader.read()
      // AFTER we've seen a terminal event is benign. The ChatGPT OAuth
      // endpoint keeps the SSE body open with trailing :keepalive for
      // ~30s after the model finishes; any outer controller.abort()
      // (supersession, user stop, deadline teardown) that fires in
      // that window rejects the reader.read() with AbortError, which
      // is a cleanup event — NOT a stream error. The deltas were
      // already flushed upstream before the terminal event arrived.
      const isAbort = e?.name === 'AbortError' || /aborted/i.test(String(e?.message));
      if (isAbort && sawTerminalEvent) {
        // Best-effort log; the IPC handler's catch at ipcHandlers.ts:2299
        // uses the message text to classify, so swallowing here is what
        // removes the "Codex request aborted." log line from the user's
        // session.
        if (process.env.CODEX_DEBUG) {
          console.warn('[Codex] parseSseStream: reader throw AFTER normal completion; swallowed.', {
            stage: 'post_completion_cleanup',
            reason: e?.name || 'unknown',
          });
        }
        return;
      }
      // Pre-completion abort: still surface as before. The outer
      // raceStreamWithDeadline / chatStreamGuard consumes this for
      // supersession/cancel; user's gemini-stream-error UI is the
      // correct signal in that case (matches Escape / Cmd+R behaviour).
      if (isAbort) throw new Error('Codex request aborted.');
      throw e;
    } finally {
      // CANCEL — not releaseLock — to actively tear down the HTTP
      // body. The natively path at LLMHelper.ts:4935 uses the same
      // pattern; releaseLock() only drops the consumer lock on the
      // stream and leaves the body open on the server. The ChatGPT
      // OAuth endpoint specifically keeps the SSE body alive for
      // ~30s after the model finishes; if our outer controller fires
      // a real abort (supersession of the next user request, user
      // presses Cmd+R, etc.) during that window, the still-open body
      // throws AbortError on the next reader.read() — the very error
      // the catch above swallows when sawTerminalEvent is true.
      //
      // reader.cancel() returns a Promise. We attach .catch() because
      // the synchronous try/catch around a Promise-returning call does
      // NOT catch Promise rejections — those surface as
      // unhandledRejection events which Electron's main process treats
      // as fatal under --unhandled-rejections=strict. The reject is
      // benign (the body is already torn down by the abort path or by
      // a prior cancel) — we just need to absorb it.
      reader.cancel().catch(() => { /* already torn down */ });
    }
    if (terminalError) throw terminalError;
    // We intentionally don't require [DONE] — some servers omit it; an
    // open stream that just ends is treated as successful (the deltas
    // already produced the response).
  }

  // ---------------------------------------------------------------------------
  // Text extraction (preserved for legacy callers)
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Kept for the existing test suite. The HTTP-direct path
   * uses the SSE parser above; this method is only used by legacy code
   * that passes raw text dumps to it (the test fixtures do this).
   */
  public static extractText(raw: string): string {
    const text = raw.trim();
    if (!text) return '';

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let sawJson = false;
    const extracted = lines.map(line => {
      const parsed = this.tryParseJson(line);
      if (parsed.ok) {
        sawJson = true;
        return this.findText(parsed.value);
      }
      return '';
    }).filter(Boolean).join('');
    if (extracted.trim()) return extracted.trim();
    if (sawJson && lines.every(line => this.tryParseJson(line).ok)) return '';

    return text
      .replace(/^\s*```(?:json)?/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }

  private static tryParseJson(line: string): { ok: true; value: any } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(line) };
    } catch {
      return { ok: false };
    }
  }

  /**
   * @deprecated Legacy error extraction for the old NDJSON event format.
   * The Responses API stream uses a different envelope; for the new
   * HTTP-direct path, errors are surfaced through `fetchDeltas` directly.
   */
  public static extractCodexError(raw: string): string {
    if (!raw) return '';
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = this.tryParseJson(trimmed);
      if (!parsed.ok) continue;
      const v = parsed.value;
      if (!v || typeof v !== 'object') continue;
      const isError = v.type === 'error' || v.type === 'turn.failed' || v.item?.type === 'error';
      if (!isError) continue;
      const candidates = [v.error?.message, v.error?.error?.message, v.message, v.item?.message];
      for (const c of candidates) {
        if (typeof c !== 'string' || !c) continue;
        const inner = this.tryParseJson(c);
        if (inner.ok && inner.value?.error?.message) return inner.value.error.message;
        return c;
      }
    }
    return '';
  }

  private static findText(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => this.findText(item)).filter(Boolean).join('');
    if (typeof value !== 'object') return '';

    if (value.type === 'error' || value.type === 'thread.started' || value.type === 'turn.started' || value.type === 'turn.completed' || value.type === 'turn.failed') return '';
    if (value.item?.type === 'error') return '';
    if (value.item?.type === 'agent_message') return this.findText(value.item.text);
    if (value.type === 'agent_message') return this.findText(value.text);

    for (const key of ['delta', 'text', 'content', 'output_text', 'output', 'response']) {
      const candidate = this.findText(value[key]);
      if (candidate) return candidate;
    }
    if (value.message) return this.findText(value.message);
    if (value.item) return this.findText(value.item);
    if (value.data) return this.findText(value.data);
    return '';
  }
}

// =============================================================================
// Module-private helpers
// =============================================================================

/** Sleep for `attempt` retries, with full jitter, capped. Honours Retry-After
 *  when the server supplies it (overrides the jitter wait). */
function sleepWithJitter(attempt: number, retryAfterMs?: number): Promise<void> {
  if (retryAfterMs && retryAfterMs > 0) {
    return new Promise(r => setTimeout(r, Math.min(retryAfterMs, TRANSIENT_RETRY_CAP_MS * 4)));
  }
  const base = Math.min(TRANSIENT_RETRY_CAP_MS, TRANSIENT_RETRY_BASE_MS * 2 ** attempt);
  const capped = Math.min(TRANSIENT_RETRY_CAP_MS, base);
  const jitter = Math.random() * capped;
  return new Promise(r => setTimeout(r, jitter));
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  // Retry-After is either an HTTP-date or a delta-seconds. We only
  // handle the seconds form (the Responses backend uses it).
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  return undefined;
}

function safeReadText(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

interface ParsedSse {
  event?: string;
  data: string;
}

function parseSseEvent(raw: string): ParsedSse | null {
  if (!raw.trim()) return null;
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith(':')) continue; // comment
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join('\n') };
}

/** Extract a text delta from a Responses API SSE event payload. */
function extractResponsesTextDelta(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  const type = payload.type;
  if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
    return payload.delta;
  }
  // Some OpenAI proxies emit a Chat-Completions-style chunk instead of
  // a Responses-native event; tolerate it as a fallback.
  if (Array.isArray(payload.choices) && payload.choices[0]?.delta?.content) {
    return String(payload.choices[0].delta.content);
  }
  return '';
}

/** Pull a human-readable error message out of a Responses API SSE event
 *  (e.g. `response.failed` or `error`). Returns empty string if this
 *  event is not an error. */
function extractResponsesStreamError(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  const type = payload.type;
  if (type === 'response.failed' || type === 'error') {
    if (payload.error?.message) return String(payload.error.message);
    if (typeof payload.message === 'string') return payload.message;
  }
  if (payload?.response?.error?.message) {
    return String(payload.response.error.message);
  }
  return '';
}

/** Pull a human-readable error from a non-2xx JSON body. */
function extractResponsesErrorMessage(text: string): string {
  if (!text) return '';
  try {
    const json = JSON.parse(text);
    if (json?.error?.message) return String(json.error.message);
    if (typeof json?.message === 'string') return json.message;
  } catch { /* not JSON */ }
  return text;
}

// =============================================================================
// Signal combination (AbortSignal.any() is Node 20+; keep our own for
// compat with the Electron versions we ship)
// =============================================================================

interface CombinedSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

function combineSignals(...signals: (AbortSignal | undefined)[]): CombinedSignal {
  const filtered = signals.filter((s): s is AbortSignal => !!s);
  const ctrl = new AbortController();
  const onAbort = (e: Event) => {
    const reason = (e.target as AbortSignal)?.reason;
    ctrl.abort(reason);
  };
  for (const s of filtered) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    dispose() {
      for (const s of filtered) {
        try { s.removeEventListener('abort', onAbort); } catch { /* swallow */ }
      }
    },
  };
}
