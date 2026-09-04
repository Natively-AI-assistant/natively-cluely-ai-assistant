// electron/llm/visionCapability.ts
//
// Pure, dependency-free helpers for deciding whether a LOCAL provider (Ollama
// model, custom cURL endpoint) can actually accept an image. Kept free of fetch
// / fs / Electron so the decision logic is unit-testable; the I/O (Ollama
// /api/show probe, reading the model list) stays in LLMHelper and feeds these.
//
// Why this exists: cloud providers (OpenAI/Claude/Gemini/Groq) have known,
// fixed vision support. Local providers don't — an Ollama install can hold any
// mix of text-only and vision models, and a custom cURL endpoint can be any
// shape. Guessing wrong means either (a) skipping a capable provider, or worse
// (b) "committing" to a provider that silently drops the image and answers
// text-only. These helpers make the decision authoritative where possible and
// conservative otherwise.

// ── Ollama ──────────────────────────────────────────────────────────────────

// Name heuristic (fallback only). Ollama's /api/show `capabilities` array is the
// authoritative source; this regex is used when capabilities are absent (older
// Ollama servers) or the probe failed.
const OLLAMA_VISION_NAME_RE =
  /(llava|bakllava|moondream|llama-?3\.2-vision|llama3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral|llama-?4|granite3\.2-vision|mistral-small3\.1|llama-?guard3-vision)/i;

export function isOllamaVisionModelByName(modelId: string): boolean {
  return !!modelId && OLLAMA_VISION_NAME_RE.test(modelId.toLowerCase());
}

// A bare `vision` segment. High precision — a model with "vision" in its name
// is one — and it catches the shapes the family list above cannot, because they
// carry a parameter count between the family and the marker:
// `llama-3.2-90b-vision-instruct`, `granite-3.2-2b-vision`.
const GENERIC_VISION_MARKER_RE = /(?:^|[-_./])vision(?:[-_./]|$)/i;

/**
 * Best-effort "does this model name describe a vision model" for a provider
 * whose capabilities we cannot probe — specifically a gateway (LiteLLM, NVIDIA
 * NIM) fronting an arbitrary upstream.
 *
 * WHY (2026-09-03, follow-up): stripping the routing prefix let
 * `litellm/openai/gpt-4o` be recognised, but only because `gpt-4o` matches a
 * known cloud family. A gateway-routed OPEN-WEIGHTS vision model
 * (`litellm/mistral/pixtral-12b`, `nvidia_nim/meta/llama-3.2-90b-vision-instruct`)
 * matched nothing and still came back `supportsImages: false`, so Code Hint went
 * on refusing the very models the vision chain and the provider registry had
 * just been taught to seat. Three subsystems, two answers.
 *
 * Built on the Ollama family list rather than beside it: these are the same
 * open-weights families served through either route, and a second private copy
 * is exactly how the two drifted the last time.
 */
export function modelNameSuggestsVision(modelId: string): boolean {
  if (!modelId) return false;
  return isOllamaVisionModelByName(modelId) || GENERIC_VISION_MARKER_RE.test(modelId);
}

/**
 * Decide vision support from an Ollama /api/show response.
 *   - returns true/false when the response carries a `capabilities` array
 *     (authoritative — Ollama lists "vision" for multimodal models)
 *   - returns null when capabilities are absent, so the caller falls back to
 *     the name heuristic.
 */
export function ollamaVisionFromShow(showJson: any): boolean | null {
  const caps = showJson?.capabilities;
  if (Array.isArray(caps)) {
    return caps.some((c: any) => typeof c === 'string' && c.toLowerCase() === 'vision');
  }
  return null;
}

/**
 * Combine the authoritative probe result with the name heuristic.
 * `probed` is the value from ollamaVisionFromShow (true/false/null).
 */
export function resolveOllamaVision(modelId: string, probed: boolean | null): boolean {
  if (probed !== null) return probed;
  return isOllamaVisionModelByName(modelId);
}

// ── Custom cURL provider ──────────────────────────────────────────────────────

/**
 * Decide whether a custom cURL provider can carry an image.
 *
 * A custom provider supports vision when EITHER:
 *   1. The user explicitly wired the image into the template via the
 *      `{{IMAGE_BASE64}}` placeholder (they know their endpoint's image field), OR
 *   2. The request body is OpenAI-chat-compatible (`messages` array), in which
 *      case `injectImageIntoMessages` auto-upgrades the last user message to a
 *      multimodal `image_url` content array.
 *
 * An explicit `multimodal` flag, when present, overrides the auto-detection
 * (true forces on, false forces off) so users can correct a wrong guess.
 *
 * Conservative by design: a non-OpenAI body with no `{{IMAGE_BASE64}}` returns
 * false, so the chain SKIPS the provider for vision instead of committing to it
 * and silently dropping the screenshot.
 */
export function customProviderSupportsVision(
  provider: { curlCommand?: string; multimodal?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  if (typeof provider.multimodal === 'boolean') return provider.multimodal;

  const curl = provider.curlCommand || '';
  if (!curl) return false;

  // (1) Explicit image placeholder anywhere in the template.
  if (/\{\{\s*IMAGE_BASE64\s*\}\}/i.test(curl)) return true;

  // (2) OpenAI-compatible body: look for a JSON `"messages"` array in the
  //     payload. We avoid a full JSON parse (the body contains {{TEXT}}-style
  //     placeholders that aren't valid JSON) and instead detect the canonical
  //     OpenAI shape: a `"messages"` array containing a `"role":"user"` message.
  //     We require the USER role specifically because injectImageIntoMessages
  //     only upgrades a user message — a system-only `messages` body would pass
  //     a looser check but then silently drop the image. Aligning detection
  //     with the injector's precondition prevents committing to a provider that
  //     can't actually carry the screenshot.
  const hasMessagesArray = /"messages"\s*:\s*\[/.test(curl);
  const hasUserRole = /"role"\s*:\s*"user"/.test(curl);
  if (!hasMessagesArray || !hasUserRole) return false;

  //     A `messages` array is NOT proof the endpoint speaks OpenAI's multimodal
  //     dialect — only that it has a messages array. Two other APIs share the
  //     shape and reject what injectImageIntoMessages produces:
  //
  //       • Anthropic Messages wants `{type:"image", source:{...}}`; handed an
  //         `image_url` part it returns 400 invalid_request.
  //       • Ollama's native /api/chat wants a message-level `images:[b64]`; it
  //         IGNORES the `image_url` part and answers text-only about a
  //         screenshot it never saw — the silent drop this whole function
  //         exists to prevent.
  //
  //     So the auto-detect branch requires the absence of those signatures.
  //     A user on such an endpoint can still force vision on with the explicit
  //     `multimodal` flag plus an `{{IMAGE_BASE64}}` placeholder they position
  //     correctly for their API — branch (1) above, which is checked first.
  //     Failing closed here is the documented intent: skip the provider rather
  //     than commit to one that cannot carry the image.
  if (isNonOpenAiMessagesDialect(curl)) return false;

  return true;
}

/**
 * True when a `messages`-shaped cURL template targets an API that is NOT
 * OpenAI-multimodal-compatible. Deliberately narrow — it names only the two
 * dialects we can identify from a template with confidence, because a false
 * positive here silently disables vision for a working OpenAI-compatible
 * gateway.
 */
function isNonOpenAiMessagesDialect(curl: string): boolean {
  // Anthropic Messages API: the version header is mandatory on every request,
  // so it is a reliable marker; the host is the second.
  //
  // Both are matched against the URL and the HEADER FLAGS only, never the whole
  // template. Scanning everything meant a body that merely mentioned
  // `anthropic-version:` — a system prompt about the Anthropic API, say — made
  // a working OpenAI-compatible endpoint read as non-multimodal and silently
  // lose vision, which is the false positive this function's docblock warns
  // against. It cut the other way too: any `https://…/v1/…` string inside a
  // prompt defeated the Ollama-native guard below.
  if (/(?:^|\s)(?:-H|--header)\s+(?:'|")?\s*anthropic-version\s*:/i.test(curl)) return true;
  if (/https?:\/\/[^\s'"`]*\bapi\.anthropic\.com\b/i.test(firstUrl(curl))) return true;

  // Ollama's NATIVE endpoints. Its OpenAI-compatible surface lives at
  // /v1/chat/completions and is deliberately not matched — that one does accept
  // image_url parts (see callOllamaVision in VisionProviderRegistry).
  //
  // The path alone is NOT enough. `/api/chat` is an ordinary route name: a
  // self-hosted OpenAI-compatible gateway at https://gw.example.com/api/chat
  // matched it and silently lost vision, which is precisely the false positive
  // this function's own docblock warns against. So require corroboration —
  // Ollama's default port, or a host that is actually on this machine/LAN. A
  // public gateway on 443 no longer matches.
  const url = firstUrl(curl);
  const ollamaNativePath = /\/api\/(chat|generate)\b/i.test(url) && !/\/v1\//i.test(url);
  if (ollamaNativePath && (/:11434\b/.test(url) || customProviderIsLocal({ curlCommand: curl }))) {
    return true;
  }

  return false;
}

/** The first http(s) URL in a cURL template, or '' — so URL-shaped checks never
 *  read the request BODY, which is user prose and can contain anything. */
function firstUrl(curl: string): string {
  const m = curl.match(/https?:\/\/[^\s'"`]+/i);
  return m ? m[0] : '';
}

/**
 * Heuristically decide whether a custom provider's endpoint is loopback/local,
 * so local-only mode keeps using it and the chain doesn't treat it as a cloud
 * provider. Inspects the first http(s) URL in the cURL template for a
 * loopback / link-local / RFC-1918 private host.
 *
 * An explicit `localOnly` flag, when present, wins over URL detection.
 */
export function customProviderIsLocal(
  provider: { curlCommand?: string; localOnly?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  if (typeof provider.localOnly === 'boolean') return provider.localOnly;

  const curl = provider.curlCommand || '';
  const m = curl.match(/https?:\/\/[^\s'"`]+/i);
  if (!m) return false;
  let host: string;
  try {
    host = new URL(m[0]).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  if (host.startsWith('169.254.')) return true;      // link-local
  if (host.startsWith('10.')) return true;            // RFC-1918
  if (host.startsWith('192.168.')) return true;       // RFC-1918
  if (host.startsWith('172.')) {                      // RFC-1918 172.16.0.0–172.31.255.255
    const second = parseInt(host.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}
