// electron/llm/activeCustomProvider.ts
//
// The ACTIVE custom provider — the one the user actually selected — read from
// the live LLMHelper instance that main.ts publishes on a global accessor.
//
// WHY THIS IS ITS OWN MODULE (2026-09-04)
// Three places need this answer and they must give the same one:
//
//   • VisionProviderRegistry.custom() — decides whether to seat a custom vision
//     rung, and with which flags.
//   • CredentialsManager.anyVisionProviderConfigured / anyLocalVisionProvider-
//     Configured — decide whether vision_only refuses and whether
//     private_vision has anything local to use.
//   • LLMHelper.assertOutboundImagesAllowed — the last boundary, which has to
//     know whether THIS custom provider keeps the image on the machine.
//
// They had drifted: the registry read the active provider, the credential gates
// read every SAVED provider. Under private_vision that combination reported
// "local vision is available" for a provider the chain would then skip, and the
// request died with "No vision-capable provider configured".
//
// Active-only is the correct rule for VISION specifically. The vision chain
// (streamVisionWithFallback) and runVisionRequest both resolve the provider from
// `this.customProvider`, so a saved-but-unselected provider genuinely cannot
// serve an image request — counting it would be a promise nothing can keep.
// (The TEXT fallback in _streamChatInner deliberately DOES reach saved-but-
// unselected providers; that rung is explicitly text-only, and this module is
// not used there.)
//
// Kept free of imports so every consumer can take it without a cycle —
// CredentialsManager cannot import VisionProviderRegistry, which imports
// CredentialsManager.

export interface ActiveCustomProvider {
  id?: string;
  name?: string;
  curlCommand?: string;
  model?: string;
  multimodal?: boolean;
  localOnly?: boolean;
  responsePath?: string;
}

/**
 * The custom provider currently selected, or null when the user has a
 * non-custom model selected (setModel nulls it) or the helper is not up yet
 * (unit tests, early boot).
 *
 * Deliberately returns null rather than falling back to "the first saved
 * provider": that fallback made the registry advertise one provider's flags
 * while runVisionRequest executed a different one.
 */
export function readActiveCustomProvider(): ActiveCustomProvider | null {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return null;
    const helper = g.__nativelyGetLLMHelper();
    if (!helper || typeof helper.getActiveCustomProvider !== 'function') return null;
    return helper.getActiveCustomProvider() || null;
  } catch {
    return null;
  }
}

/**
 * The model id currently selected, or '' when the helper is not up yet.
 *
 * Same "ask the live helper, never the credential store" rule as above, and it
 * lives here for the same reason: a second way of reading the active selection
 * is how the registry and the streaming chain drifted apart the first time.
 *
 * Needed by the gateway vision rungs (LiteLLM / NVIDIA NIM). Unlike an API key,
 * a configured gateway is not a standing offer to serve images: it fronts an
 * arbitrary upstream, so it may only be used for a turn the user pointed at it.
 * `streamVisionWithFallback` already enforces exactly that; the registry has to
 * agree or ScreenUnderstandingService will route screenshots somewhere the
 * streaming chain never would.
 */
export function readActiveModelId(): string {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return '';
    const helper = g.__nativelyGetLLMHelper();
    if (!helper || typeof helper.getCurrentModelId !== 'function') return '';
    return helper.getCurrentModelId() || '';
  } catch {
    return '';
  }
}

/**
 * Each vendor's fixed vision model, as the live helper would send it (see
 * LLMHelper.getFixedVisionModels). Empty when the helper is not up: the
 * registry then keeps its own label, and no request can be made anyway.
 */
export function readFixedVisionModels(): { openai?: string; claude?: string } {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return {};
    const helper = g.__nativelyGetLLMHelper();
    if (!helper || typeof helper.getFixedVisionModels !== 'function') return {};
    return helper.getFixedVisionModels() || {};
  } catch {
    return {};
  }
}

/**
 * The live selection — provider and model — or null when the helper is not up
 * or cannot name one (an id with no adapter). Callers treat null as "no
 * selection known", never as a refusal.
 */
export function readActiveSelection(): { provider: string; model: string } | null {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return null;
    const helper = g.__nativelyGetLLMHelper();
    if (!helper || typeof helper.getDirectAssistSelection !== 'function') return null;
    const sel = helper.getDirectAssistSelection();
    return sel && typeof sel.provider === 'string' ? { provider: sel.provider, model: String(sel.model ?? '') } : null;
  } catch {
    return null;
  }
}

/** The cURL provider currently selected, or null. Same rule as readActiveCustomProvider. */
export function readActiveCurlProvider(): ActiveCustomProvider | null {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return null;
    const helper = g.__nativelyGetLLMHelper();
    if (!helper || typeof helper.getActiveCurlProvider !== 'function') return null;
    return helper.getActiveCurlProvider() || null;
  } catch {
    return null;
  }
}

/**
 * The selected Ollama's vision model and URL as last resolved, or null. Read
 * synchronously by the registry; call resolveOllamaRecordTarget() first.
 */
export function readOllamaRecordTarget(): { model: string; url: string } | null {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return null;
    const helper = g.__nativelyGetLLMHelper();
    if (!helper || typeof helper.getOllamaRecordTarget !== 'function') return null;
    const target = helper.getOllamaRecordTarget();
    return target && typeof target.model === 'string' && target.model ? { model: target.model, url: String(target.url ?? '') } : null;
  } catch {
    return null;
  }
}

/** Ask the live helper to resolve it (bounded and cached there). Never throws. */
export async function resolveOllamaRecordTarget(): Promise<void> {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return;
    const helper = g.__nativelyGetLLMHelper();
    if (helper && typeof helper.resolveOllamaRecordTarget === 'function') await helper.resolveOllamaRecordTarget();
  } catch {
    /* no local record this turn */
  }
}


/**
 * Is Ollama the selected provider? Asked separately from readActiveSelection
 * because that one has no answer while Ollama is selected with no model named
 * yet (startup, or nothing installed), and "no selection known" must not be
 * read as "not local".
 */
export function readUsingOllama(): boolean {
  try {
    const g = globalThis as any;
    if (typeof g.__nativelyGetLLMHelper !== 'function') return false;
    const helper = g.__nativelyGetLLMHelper();
    return !!helper && typeof helper.isUsingOllama === 'function' && helper.isUsingOllama() === true;
  } catch {
    return false;
  }
}

/**
 * Does the turn being assembled stay on this device (2026-10-01)? True only
 * when the live helper says its SELECTED provider is a local one — Ollama on
 * this machine or network, or a custom / cURL endpoint whose request goes to a
 * private host. False when there is no helper to ask, and false on any error:
 * the caller is deciding whether text read off a kept-on-device screenshot may
 * be put in a prompt, and "nobody can say" must not mean yes.
 */
export function readSelectionStaysOnDevice(): boolean {
  try {
    const getHelper = (globalThis as Record<string, unknown>).__nativelyGetLLMHelper as (() => any) | undefined;
    return getHelper?.()?.selectionStaysOnDevice?.() === true;
  } catch {
    return false;
  }
}
