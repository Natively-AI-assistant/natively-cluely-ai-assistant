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
import { GROQ_PRIMARY_MODEL } from '../../llm/groqModels';
import {
  customProviderSupportsVision,
  customProviderIsLocal,
  isOllamaVisionModelByName,
} from '../../llm/visionCapability';
import { readActiveCustomProvider, readActiveModelId } from '../../llm/activeCustomProvider';

export interface VisionProviderBuildInputs {
  mode: VisionMode;
  localOnly: boolean;
  scopeAllowsScreenshots: boolean;
}

/**
 * Produce the ordered list of vision providers for the given mode. Order is:
 *   vision_first / vision_only: Natively → OpenAI → Gemini Flash-Lite →
 *                                Gemini Flash → Claude → Gemini Pro → Groq Scout
 *                                → LiteLLM → NVIDIA NIM → Ollama → Codex → Custom
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
    // OpenAI-compatible gateways, last among the cloud rungs. Added 2026-09-03:
    // they were absent entirely, so a profile whose only configured provider was
    // a LiteLLM proxy produced an EMPTY chain and ScreenUnderstandingService
    // reported "no vision-capable provider" for every screenshot — verified live.
    //
    // Seated ONLY when the gateway is the SELECTED model, which is what
    // streamVisionWithFallback enforces — it excludes an unselected gateway
    // outright rather than ordering it last, and this comment previously
    // misdescribed that (code review, 2026-09-04). The distinction matters: a
    // configured base URL is not a standing offer to serve images. Auto-recruiting
    // one as a fallback would send a screenshot to a proxy the user had not
    // pointed this turn at, and the streaming chain would never have done so —
    // two subsystems, two privacy policies.
    providers.push(litellm(credentials, inputs));
    providers.push(nvidiaNim(credentials, inputs));
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
    modelId: 'gemini-3.8-flash',
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
    // The `groq_scout` id is a stable key (health tracking, telemetry, the
    // provider-order tests) and stays even though Scout itself is gone. The
    // model id is derived, not repeated — a second literal is how the NEXT
    // retirement gets missed in one of the two places.
    id: 'groq_scout',
    displayName: `Groq (${GROQ_PRIMARY_MODEL})`,
    modelId: GROQ_PRIMARY_MODEL,
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
  //
  // SAFETY — READ BEFORE FLIPPING `supportsVision` TO TRUE.
  // `isLocal: true` below is a ROUTING hint (no API key, runs via a local CLI
  // binary), NOT a statement about where the pixels go. Codex CLI sends to
  // chatgpt.com/backend-api/codex/responses — it is a CLOUD vision provider.
  //
  // VisionProviderFallbackChain implements `private_vision` as "skip every
  // provider where isLocal !== true", so the moment `supportsVision` becomes
  // true this entry becomes a private_vision-eligible CLOUD destination, and
  // the Settings copy "Use a local vision model (Ollama) only. Cloud vision is
  // never called." becomes false on the one screenshot path that is wired.
  //
  // This is inert TODAY only because `supportsVision: false` and `invoke`
  // throws. If you enable CLI vision, you MUST also set `isLocal: false` (or
  // give the chain a separate `isOnDevice` predicate). Note
  // electron/llm/visionPolicy.ts deliberately does NOT share this predicate —
  // its `isLocalVisionProvider()` is Ollama-only for exactly this reason.
  return {
    id: 'codex_cli',
    displayName: 'Codex CLI',
    modelId: (creds.getAllCredentials() as any)?.codexCliModel,
    isLocal: true,
    isConfigured: !!cliPath,
    supportsVision: false, // unverified; see SAFETY above before flipping — also set isLocal:false
    scopeAllowsScreenshots: true,
    hint: 'codex',
    invoke: async () => { throw new Error('Codex CLI vision unverified — capability disabled'); },
  };
}

function custom(creds: CredentialsManager, inputs: VisionProviderBuildInputs): VisionProviderConfig {
  // The active custom provider lives on the live LLMHelper instance (set via
  // switchToCustom in main.ts). That is the ONLY provider this entry may
  // advertise, because `invoke` resolves the provider from that same instance
  // (runVisionRequest reads this.customProvider).
  //
  // There used to be a `|| customProviders[0]` fallback here, which broke that
  // correspondence in both directions: with a cloud model selected it seated an
  // entry whose invoke throws "No custom provider configured", and with two
  // legacy providers configured it gated on #1's flags while sending to #2 —
  // directly against the comment above it. If no custom provider is active,
  // there is no custom vision target, and isConfigured:false skips the rung.
  const active = readActiveCustomProvider();

  // Both answers come from the SHARED predicates rather than a local copy.
  // `multimodal === true` here disagreed with customProviderSupportsVision in
  // the streaming chain: it read the Settings default of "Auto-detect" (which
  // stores no flag at all) as "no vision", so auto-detect was dead on this
  // path, and it trusted an explicit flag on a template that cannot carry an
  // image, committing to a provider that then dropped the screenshot.
  const multimodal = customProviderSupportsVision(active);
  // Keeps `private_vision` from calling a public custom endpoint. The local
  // copy this replaces recognized only loopback and .local, so an LM Studio box
  // at 192.168.1.50 was "local" to the streaming chain and "cloud" here.
  const localOnly = customProviderIsLocal(active);

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

/**
 * A LiteLLM proxy as a vision rung.
 *
 * `isConfigured` keys off the base URL, matching every other LiteLLM gate in the
 * app (ipcHandlers' modelAvailable) — the API key is optional because a keyless
 * local proxy is supported.
 *
 * `supportsVision` cannot be answered from here: the proxy fronts arbitrary
 * upstreams and only its own config knows whether the routed model takes images.
 * Seating it as vision-capable is the honest choice — the alternative, gating on
 * a guess, is what produced "no vision provider configured" for users who had
 * one. It sits last among the cloud rungs, so a wrong guess costs one failed
 * attempt and the chain moves on; the health tracker deprioritizes it after that.
 */
function litellm(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const baseURL = creds.getLitellmBaseURL();
  // The SELECTED model, not the saved preference: runVisionRequest dispatches
  // against LLMHelper's live currentModelId, so a rung seated off a stored
  // preference would advertise one model and execute another.
  const activeModelId = readActiveModelId();
  const isSelected = /^litellm\//i.test(activeModelId);
  const modelId = isSelected ? activeModelId : '';
  return {
    id: 'litellm',
    displayName: modelId ? `LiteLLM (${modelId.replace(/^litellm\//, '')})` : 'LiteLLM proxy',
    modelId,
    isLocal: false,
    isConfigured: !!baseURL && isSelected,
    supportsVision: !!baseURL && isSelected,
    scopeAllowsScreenshots: true,
    hint: 'generic',
    invoke: async (p) => callLLMHelperVision('litellm', p),
  };
}

/** An NVIDIA NIM endpoint as a vision rung. Same reasoning as litellm() above. */
function nvidiaNim(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getNvidiaNimApiKey?.();
  const activeModelId = readActiveModelId();
  const isSelected = /^nvidia_nim\//i.test(activeModelId);
  const modelId = isSelected ? activeModelId : '';
  return {
    id: 'nvidia_nim',
    displayName: modelId ? `NVIDIA NIM (${modelId.replace(/^nvidia_nim\//, '')})` : 'NVIDIA NIM',
    modelId,
    isLocal: false,
    isConfigured: !!apiKey && isSelected,
    supportsVision: !!apiKey && isSelected,
    scopeAllowsScreenshots: true,
    hint: 'generic',
    invoke: async (p) => callLLMHelperVision('nvidia_nim', p),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Single definition, re-exported. The local copy this replaces had drifted:
// it was missing llama-4, granite3.2-vision, mistral-small3.1 and
// llama-guard3-vision, so a user running one of those got no vision here while
// the streaming chain happily used it.
export function isOllamaVisionModel(modelId: string): boolean {
  return isOllamaVisionModelByName(modelId);
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
