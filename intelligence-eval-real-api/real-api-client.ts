// intelligence-eval-real-api/real-api-client.ts
//
// Thin client for the REAL Natively API (https://api.natively.software/v1/chat),
// matching exactly what electron/LLMHelper.ts:streamWithNatively sends:
//   POST /v1/chat
//   headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream',
//              'x-natively-key': <key> }
//   body:    { messages:[{role:'user',content}], stream:true, system? }
//   response: SSE — lines `data: {"delta":"...","model":"..."}`, terminated by `data: [DONE]`
//
// No mocking, no stubbing. The only configuration is the endpoint + key, both of
// which must be the real production endpoint and a real key from the env.
//
// SECURITY: the key is never logged, never returned, never embedded in any
// result object. `redactKey()` masks any key-like token to `natively_sk_****`.

export const NATIVELY_CHAT_URL = 'https://api.natively.software/v1/chat';

export function redactKey(s: string): string {
  if (!s) return s;
  // Mask anything that looks like a key (long token, sk-..., natively_...).
  return s
    .replace(/natively[_-]?sk[_-]?[A-Za-z0-9_-]+/gi, 'natively_sk_****')
    .replace(/\b(sk|key|tok)[_-][A-Za-z0-9]{8,}\b/gi, '$1_****')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, 'natively_sk_****');
}

export interface ApiKeyInfo {
  present: boolean;
  // A short, NON-reversible fingerprint for log correlation (never the key).
  fingerprint: string;
}

export function getApiKey(): { key: string; info: ApiKeyInfo } {
  const key = process.env.NATIVELY_TEST_API_KEY || '';
  const present = key.trim().length > 0;
  // Fingerprint: length + last-2 chars only, prefixed; never enough to reconstruct.
  const fingerprint = present ? `len=${key.length}:${'natively_sk_****'}` : 'absent';
  return { key: key.trim(), info: { present, fingerprint } };
}

export interface MockDetection {
  nodeEnv: string;
  apiBaseUrl: string;
  mockProviderDetected: boolean;
  fetchIntercepted: boolean;
  realProviderEvidence: { requestId: string; provider: string; streamingChunksReceived: number };
}

// Detect any sign the test is NOT hitting the real provider. The base URL is a
// hard constant pointing at production; fetch must be the native global.
export function detectMockEnvironment(): MockDetection {
  // Node 18+ ships fetch as a JS wrapper (undici), so a `[native code]` check is
  // a false positive — the genuine global fetch does NOT contain `[native code]`.
  // Real interception is detectable by the markers mock libraries actually set:
  // nock/msw/fetch-mock attach properties (`isMockFunction`, `mock`, `_isMockFunction`,
  // `restore`) or replace globalThis.fetch with a non-`fetch`-named function.
  const f: any = typeof fetch === 'function' ? fetch : null;
  const fetchIntercepted = !f
    || globalThis.fetch !== f
    || f.name !== 'fetch'
    || !!(f.isMockFunction || f._isMockFunction || f.mock || f.restore || f.mockClear);
  return {
    nodeEnv: process.env.NODE_ENV || '',
    apiBaseUrl: NATIVELY_CHAT_URL,
    mockProviderDetected: /mock|fake|localhost|127\.0\.0\.1/i.test(NATIVELY_CHAT_URL),
    fetchIntercepted,
    realProviderEvidence: { requestId: '', provider: '', streamingChunksReceived: 0 },
  };
}

export interface ChatStreamResult {
  httpStatus: number;
  requestId: string;
  provider: string;          // model id reported by the API (provider evidence)
  ok: boolean;
  error?: string;
}

export interface ChatRequest {
  userContent: string;
  system?: string;
  fastMode?: boolean;
}

/**
 * Stream a chat completion from the REAL Natively API.
 * @param onChunk called with each decoded delta string as it arrives.
 * @param onByte  called once when the first network byte arrives.
 * Returns terminal metadata. Throws on network/connect failure.
 */
export async function streamChat(
  key: string,
  req: ChatRequest,
  hooks: {
    onByte?: () => void;
    onChunk?: (delta: string) => void;
    onFirstToken?: () => void;
  },
  connectTimeoutMs = 12_000,
  overallTimeoutMs = 60_000,
): Promise<ChatStreamResult> {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: req.userContent }],
    stream: true,
  };
  if (req.system) body.system = req.system;
  if (req.fastMode) body.fast_mode = true;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'x-natively-key': key,
  };

  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(new Error('connect timeout')), connectTimeoutMs);
  const overallTimer = setTimeout(() => controller.abort(new Error('overall timeout')), overallTimeoutMs);

  let response: Response;
  try {
    response = await fetch(NATIVELY_CHAT_URL, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    });
  } finally {
    clearTimeout(connectTimer);
  }

  const requestId = response.headers.get('x-request-id')
    || response.headers.get('cf-ray')
    || response.headers.get('x-amzn-requestid')
    || '';

  if (!response.ok) {
    clearTimeout(overallTimer);
    let err = 'unknown';
    try { const j: any = await response.json(); err = j.error || JSON.stringify(j); } catch { /* */ }
    return { httpStatus: response.status, requestId, provider: '', ok: false, error: redactKey(String(err)) };
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let firstByteSeen = false;
  let firstTokenSeen = false;
  let provider = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByteSeen) { firstByteSeen = true; hooks.onByte?.(); }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { clearTimeout(overallTimer); return { httpStatus: 200, requestId, provider, ok: true }; }
        try {
          const obj = JSON.parse(payload);
          if (obj.model && !provider) provider = String(obj.model);
          const delta = typeof obj.delta === 'string' ? obj.delta : (obj.choices?.[0]?.delta?.content || '');
          if (delta) {
            if (!firstTokenSeen) { firstTokenSeen = true; hooks.onFirstToken?.(); }
            hooks.onChunk?.(delta);
          }
        } catch { /* non-JSON keepalive line — ignore */ }
      }
    }
  } finally {
    clearTimeout(overallTimer);
  }
  return { httpStatus: 200, requestId, provider, ok: true };
}
