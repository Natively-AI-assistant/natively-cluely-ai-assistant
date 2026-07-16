// electron/services/screen/VisionProviderRegistry.ts
//
// Builds the ordered VisionProviderConfig[] consumed by VisionProviderFallbackChain.
//
// Each entry knows:
//   - whether the provider is configured (API key, runtime path)
//   - whether the selected model is vision-capable
//   - whether the data scope policy allows screenshots
//   - how to invoke the provider with an optimized image + prompt
//
// The invocation lives in adapter functions that call into LLMHelper. We
// intentionally lazy-import LLMHelper so tests can replace this registry
// without booting the whole LLM stack.

import fs from 'node:fs/promises';
import type {
  VisionProviderConfig,
  VisionInvocationParams,
  VisionMode,
} from './VisionProviderFallbackChain';
import { CredentialsManager } from '../CredentialsManager';

export interface VisionProviderBuildInputs {
  mode: VisionMode;
  localOnly: boolean;
  scopeAllowsScreenshots: boolean;
}

/**
 * Produce the ordered list of vision providers for the given mode. Order is:
 *   vision_first / vision_only: Natively → OpenAI → Gemini Flash-Lite →
 *                                Gemini Flash → Claude → Gemini Pro → Groq Scout
 *                                → Ollama → Codex → Custom
 *   private_vision: Ollama → Codex → local Custom only
 */
export function buildVisionProviders(inputs: VisionProviderBuildInputs): VisionProviderConfig[] {
  const credentials = CredentialsManager.getInstance();
  const providers: VisionProviderConfig[] = [];

  const cloudAllowed = inputs.mode !== 'private_vision';

  if (cloudAllowed) {
    providers.push(natively(credentials, inputs));
    providers.push(openai(credentials, inputs));
    // Gemini cascade leads with flash-lite (cheapest/fastest), then flash.
    providers.push(geminiFlashLite(credentials, inputs));
    providers.push(geminiFlash(credentials, inputs));
    providers.push(claude(credentials, inputs));
    providers.push(geminiPro(credentials, inputs));
    providers.push(groqScout(credentials, inputs));
  }

  // Local providers — always allowed, including in private_vision.
  providers.push(ollama(credentials, inputs));
  providers.push(codex(credentials, inputs));
  providers.push(custom(credentials, inputs));

  return providers.filter(p => p !== null) as VisionProviderConfig[];
}

// ─── Provider builders ────────────────────────────────────────────────────

function natively(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getNativelyApiKey();
  return {
    id: 'natively',
    displayName: 'Natively API',
    modelId: 'natively',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'natively',
    invoke: async (p) => callLLMHelperVision('natively', p),
  };
}

function openai(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getOpenaiApiKey();
  return {
    id: 'openai',
    displayName: 'OpenAI',
    modelId: 'gpt-4o',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'openai',
    invoke: async (p) => callLLMHelperVision('openai', p),
  };
}

function geminiFlashLite(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_flash_lite',
    displayName: 'Gemini Flash-Lite',
    modelId: 'gemini-3.1-flash-lite',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_flash_lite', p),
  };
}

function geminiFlash(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_flash',
    displayName: 'Gemini Flash',
    modelId: 'gemini-3.5-flash',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_flash', p),
  };
}

function claude(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getClaudeApiKey();
  return {
    id: 'claude',
    displayName: 'Claude',
    modelId: 'claude-sonnet-4-6',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'claude',
    invoke: async (p) => callLLMHelperVision('claude', p),
  };
}

function geminiPro(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_pro',
    displayName: 'Gemini Pro',
    modelId: 'gemini-3.1-pro-preview',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_pro', p),
  };
}

function groqScout(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGroqApiKey();
  return {
    id: 'groq_scout',
    displayName: 'Groq Llama-4 Scout',
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'groq',
    invoke: async (p) => callLLMHelperVision('groq_scout', p),
  };
}

function ollama(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const baseUrl = (creds.getAllCredentials() as any)?.ollamaBaseUrl as string | undefined;
  const ollamaModel = (creds.getAllCredentials() as any)?.ollamaModel as string | undefined;
  const isVisionModel = ollamaModel ? isOllamaVisionModel(ollamaModel) : false;
  return {
    id: 'ollama',
    displayName: 'Ollama (local)',
    modelId: ollamaModel,
    isLocal: true,
    isConfigured: !!baseUrl && !!ollamaModel,
    supportsVision: isVisionModel,
    scopeAllowsScreenshots: true,
    hint: 'ollama',
    invoke: async (p) => callOllamaVision(baseUrl!, ollamaModel!, p),
  };
}

function codex(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const cliPath = (creds.getAllCredentials() as any)?.codexCliPath as string | undefined;
  // Codex CLI vision capability is not yet verified across builds — we configure
  // the provider as available but the vision flag is conservative. See ROADMAP.
  return {
    id: 'codex_cli',
    displayName: 'Codex CLI',
    modelId: (creds.getAllCredentials() as any)?.codexCliModel,
    isLocal: true,
    isConfigured: !!cliPath,
    supportsVision: false, // unverified; flip to true when CLI vision is confirmed end-to-end
    scopeAllowsScreenshots: true,
    hint: 'codex',
    invoke: async () => { throw new Error('Codex CLI vision unverified — capability disabled'); },
  };
}

function custom(creds: CredentialsManager, inputs: VisionProviderBuildInputs): VisionProviderConfig {
  // The active custom provider lives on the live LLMHelper instance (set via
  // switchToCustom in main.ts). CredentialsManager stores all configured custom
  // providers; we only show the active one as a vision target so the chain
  // never silently calls a provider the user didn't pick.
  const customProviders = creds.getCustomProviders();
  // Prefer the explicitly-set active provider if any; fall back to the first
  // configured entry so the registry remains useful when LLMHelper hasn't been
  // initialized yet (e.g. during unit tests).
  const fromHelper = readActiveCustomProviderSync();
  const active = fromHelper || customProviders[0];

  const multimodal = (active as any)?.multimodal === true;
  // Treat a provider as local-only if explicitly flagged OR if its URL targets
  // a loopback host. This keeps `private_vision` mode from silently calling a
  // public custom endpoint.
  const localOnly = isLocalOnlyCustomProvider(active);

  return {
    id: 'custom',
    displayName: active?.name || 'Custom Provider',
    modelId: (active as any)?.model,
    isLocal: localOnly,
    isConfigured: !!active,
    supportsVision: multimodal,
    scopeAllowsScreenshots: inputs.scopeAllowsScreenshots,
    hint: 'custom',
    invoke: async (p) => callLLMHelperVision('custom', p),
  };
}

function readActiveCustomProviderSync(): any | null {
  try {
    const g = global as any;
    if (typeof g.__nativelyGetLLMHelper === 'function') {
      const helper = g.__nativelyGetLLMHelper();
      if (helper && typeof helper.getActiveCustomProvider === 'function') {
        return helper.getActiveCustomProvider() || null;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function isLocalOnlyCustomProvider(provider: any | undefined | null): boolean {
  if (!provider) return false;
  if (provider.localOnly === true) return true;
  // Inspect the cURL command for a localhost / 127.0.0.1 / 0.0.0.0 / ::1 target.
  const curl: string | undefined = provider.curlCommand;
  if (!curl) return false;
  try {
    const urlMatch = curl.match(/https?:\/\/([^\s'"`]+)/i);
    if (!urlMatch) return false;
    const host = new URL(urlMatch[0]).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local');
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const OLLAMA_VISION_MODELS_RE = /(llava|bakllava|moondream|llama3\.2-vision|llama-3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral)/i;
export function isOllamaVisionModel(modelId: string): boolean {
  return OLLAMA_VISION_MODELS_RE.test(modelId);
}

/**
 * Call into LLMHelper to run a vision request against the chosen cloud provider.
 * We funnel everything through LLMHelper.streamChat so the auth, retries, and
 * per-provider payload shape are handled in one place.
 */
async function callLLMHelperVision(providerId: string, params: VisionInvocationParams): Promise<string> {
  const helper = await getActiveLLMHelper();
  if (!helper) throw new Error('LLMHelper not initialized');
  return helper.runVisionRequest(providerId, params.userPrompt, params.systemPrompt, params.optimized.path);
}

/**
 * Call a local Ollama vision model. Uses the OpenAI-compatible /v1/chat/completions
 * endpoint at `${baseUrl}/v1/` with an image_url data URL — supported by every
 * vision-capable Ollama model we care about (llava family, qwen2.5-vl, etc.).
 */
async function callOllamaVision(baseUrl: string, model: string, params: VisionInvocationParams): Promise<string> {
  const { optimized, systemPrompt, userPrompt, signal } = params;
  const data = await fs.readFile(optimized.path);
  const dataUrl = `data:${optimized.mimeType};base64,${data.toString('base64')}`;
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const url = `${trimmedBase}/v1/chat/completions`;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    stream: false,
  };

  const serializedBody = JSON.stringify(body);
  require('../../llm/providerPayloadCapture').captureProviderPayload({
    provider: 'ollama_vision',
    classification: 'exact_serialized_provider_payload',
    payload: body,
    serializedPayload: serializedBody,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: serializedBody,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Surface a classifiable error so VisionProviderFallbackChain can bucket it.
    throw new Error(`Ollama ${res.status}: ${text.substring(0, 200)}`);
  }

  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  throw new Error('Ollama returned empty content');
}

/**
 * Retrieve the live LLMHelper instance. main.ts owns the LLMHelper; we expose
 * it via a global accessor function set up there. If the accessor is missing,
 * return null and let the caller fail closed.
 */
async function getActiveLLMHelper(): Promise<any | null> {
  const g = global as any;
  if (typeof g.__nativelyGetLLMHelper === 'function') {
    try {
      return g.__nativelyGetLLMHelper();
    } catch {
      return null;
    }
  }
  return null;
}
