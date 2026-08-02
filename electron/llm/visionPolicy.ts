// electron/llm/visionPolicy.ts
//
// ONE decision for "may this screenshot leave, and where to".
//
// WHY THIS EXISTS
// `screenUnderstandingMode` ('vision_first' | 'vision_only' | 'private_vision')
// is written by "Keep screenshots on this device" in Settings > AI Providers,
// whose copy promises "Use a local vision model (Ollama) only. Cloud vision is
// never called." It was read at exactly ONE runtime call site —
// `generate-what-to-say` — which handed it to ScreenUnderstandingService. Every
// other screenshot-bearing path (the primary Ask-AI-with-screenshot flow,
// generate-code-hint, generate-brainstorm) forwards `imagePaths` straight into
// LLMHelper, which had no notion of the enum. The promise was false on the
// main path.
//
// Enforcing it inside LLMHelper's own routing means every screenshot-bearing
// path is covered by construction, instead of three call sites being patched
// and the fourth being found later.
//
// RECONCILED WITH THE `screenshots` DATA SCOPE
// These are two switches over the same bytes, so they are resolved together
// here rather than as two gates that can disagree. The one asymmetry is
// deliberate and is about honesty, not leakage — NEITHER path ever sends an
// image to the cloud:
//   • `screenshots` denied, no local vision  → DROP the image, answer without it.
//     This is the shipped behaviour and matches the Privacy panel's own
//     "Omitted" badge, which tells the user exactly that.
//   • `private_vision`, no local vision      → BLOCK with an explanation.
//     This setting is a promise about HOW the screenshot is processed, so
//     quietly answering as though a screenshot had been considered would be a
//     different lie: the user believes the image was read locally.
//   • `vision_only` is an explicit "do not answer without the screenshot", so it
//     upgrades any drop into a block.

export type ScreenUnderstandingMode = 'vision_first' | 'vision_only' | 'private_vision';

export const SCREEN_UNDERSTANDING_MODES: readonly ScreenUnderstandingMode[] = [
  'vision_first', 'vision_only', 'private_vision',
];

export type VisionAction =
  /** Images may go to whichever provider the normal cascade selects. */
  | 'allow'
  /** Images may go ONLY to a local vision model. */
  | 'local_only'
  /** The turn cannot be served under the user's settings — refuse, with a reason. */
  | 'block';

export interface VisionDecision {
  action: VisionAction;
  /** Applied when `action` is 'local_only' and local vision turns out to be
   *  unavailable at call time. Never 'send to cloud'. */
  whenLocalUnavailable: 'drop_images' | 'block';
  /** Short machine-readable reason for logs. */
  reason: string;
  /** User-facing text. Present whenever a block is possible. */
  message?: string;
}

export const PRIVATE_VISION_NO_LOCAL_MESSAGE =
  'Screenshots are set to stay on this device, but no local vision model is available right now. '
  + 'The screenshot was not sent anywhere. Start Ollama with a vision-capable model, or change '
  + '"Keep screenshots on this device" in Settings > AI Providers > Privacy, then ask again.';

export const VISION_ONLY_NO_PROVIDER_MESSAGE =
  'This question includes a screenshot and "Require a vision-capable provider" is on, but no '
  + 'vision-capable provider is available. Rather than answer without looking at the screenshot, '
  + "I've stopped here — add a vision-capable provider, or switch screen understanding back to "
  + '"Vision first" in Settings > AI Providers.';

export const SCOPE_DENIED_VISION_ONLY_MESSAGE =
  'This question includes a screenshot, but the Screenshots privacy scope is switched off for cloud '
  + 'providers and no local vision model is available. "Require a vision-capable provider" is also on, '
  + "so I've stopped rather than answer without the screenshot. Re-enable Screenshots for cloud "
  + 'providers, or start a local vision model, then ask again.';

export interface VisionPolicyInputs {
  hasImages: boolean;
  mode: ScreenUnderstandingMode;
  /** FALSE when the `screenshots` provider-data-scope is denied. */
  screenshotsScopeAllowed: boolean;
  /** Any vision-capable provider at all (cloud or local). */
  visionProviderAvailable: boolean;
}

/**
 * Pure. The caller resolves local availability lazily, because probing a local
 * runtime costs a round trip and most turns carry no image at all.
 */
export function resolveVisionPolicy(input: VisionPolicyInputs): VisionDecision {
  if (!input.hasImages) return { action: 'allow', whenLocalUnavailable: 'drop_images', reason: 'no_images' };

  const visionOnly = input.mode === 'vision_only';

  // The strongest promise wins: "cloud vision is never called".
  if (input.mode === 'private_vision') {
    return {
      action: 'local_only',
      whenLocalUnavailable: 'block',
      reason: 'private_vision',
      message: PRIVATE_VISION_NO_LOCAL_MESSAGE,
    };
  }

  if (!input.screenshotsScopeAllowed) {
    return {
      action: 'local_only',
      whenLocalUnavailable: visionOnly ? 'block' : 'drop_images',
      reason: visionOnly ? 'screenshots_scope_denied_vision_only' : 'screenshots_scope_denied',
      ...(visionOnly ? { message: SCOPE_DENIED_VISION_ONLY_MESSAGE } : {}),
    };
  }

  if (visionOnly && !input.visionProviderAvailable) {
    return {
      action: 'block',
      whenLocalUnavailable: 'block',
      reason: 'vision_only_no_provider',
      message: VISION_ONLY_NO_PROVIDER_MESSAGE,
    };
  }

  return { action: 'allow', whenLocalUnavailable: 'drop_images', reason: input.mode };
}

/** Thrown at the last boundary when an image is about to reach a provider the
 *  active screen-understanding mode forbids. Named, not just typed: esbuild
 *  inlines this module per entry bundle, so `instanceof` is unreliable across
 *  bundles and consumers must match on `.name`. */
export class VisionPolicyError extends Error {
  constructor(public readonly provider: string, public readonly userMessage: string) {
    super(`Screenshot blocked for provider ${provider} by the screen-understanding policy`);
    this.name = 'VisionPolicyError';
  }
}

/**
 * The live setting. Read per call — never memoised (esbuild inlines this module
 * into every entry bundle, so a cached value goes stale in all but one).
 * Defaults to 'vision_first' when the store is unavailable, which is the
 * shipped default and the only value that changes nothing.
 */
export function readScreenUnderstandingMode(): ScreenUnderstandingMode {
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    const mode = SettingsManager.getInstance().getScreenUnderstandingMode?.();
    return SCREEN_UNDERSTANDING_MODES.includes(mode) ? mode : 'vision_first';
  } catch {
    return 'vision_first';
  }
}

/** Providers that keep an image on the machine. Deliberately narrow: Codex CLI
 *  is NOT here — it routes to chatgpt.com/backend-api, so counting it as local
 *  (as CredentialsManager.anyLocalVisionProviderConfigured does) would ship a
 *  screenshot to a cloud service while telling the user it stayed on-device. */
export function isLocalVisionProvider(provider: string): boolean {
  return provider === 'ollama';
}
