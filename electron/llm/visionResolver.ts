// electron/llm/visionResolver.ts
//
// ONE answer to "can this selection read a screenshot?" (design:
// docs/plans/2026-10-01-vision-capability-design.md, phase 1). Pure: every fact
// it needs is passed in, so LLMHelper (live instance state) and
// VisionProviderRegistry (persisted credentials) ask the same function the same
// question and cannot drift apart again — which is how the two Ollama lists,
// and the registry's own copies of the 9Router and AgentRouter rules, came to be.
//
// Three answers, not two. `unknown` means nothing Natively knows says either
// way, which is not "no": treating it as "no" is how every new model family
// came out text-only. Until the one-time image test lands (phase 3), each
// CALLER decides what unknown means for it (readsImages' second argument), and
// each keeps exactly the behaviour it had before this module existed.

import type { DirectAssistProvider } from '../direct-assist/types';
import { getModelCapabilities } from './modelCapabilities';
import { customProviderSupportsVision, isOllamaVisionModelByName } from './visionCapability';

export type VisionAnswer = 'yes' | 'no' | 'unknown';
/** Where an answer came from. */
export type VisionSource = 'override' | 'route' | 'provider' | 'test' | 'names';

export interface VisionVerdict {
  reads: VisionAnswer;
  /** null exactly when `reads` is 'unknown'. */
  source: VisionSource | null;
}

export interface VisionQuery {
  provider: DirectAssistProvider;
  /** As Natively stores it: routed for gateways (`agentrouter/gpt-6-astra`), the tag for Ollama. */
  model: string;
}

export interface VisionFacts {
  /** Ollama's own answer (/api/show capabilities) when probed; undefined = not probed. */
  ollamaReportsVision?: (model: string) => boolean | undefined;
  /** 9Router's catalogue: the WIRE ids it marks vision-capable. Empty = never fetched. */
  ninerouterVisionModels?: readonly string[];
  /** The active custom or cURL provider; its template decides whether an image can travel. */
  customProvider?: { curlCommand?: string; multimodal?: boolean } | null;
  /** What a provider's catalogue publishes (visionCapabilityStore), for a ROUTED id; undefined = it hasn't said. */
  providerReportsVision?: (provider: string, routedModel: string) => boolean | undefined;
  /** A saved one-time image test result (visionCapabilityStore), for a ROUTED id; undefined = never tested. */
  testedVision?: (provider: string, routedModel: string) => boolean | undefined;
  /** The user's own answer in Settings (phase 4), for a ROUTED id: true = On, false = Off, undefined = Auto. */
  overriddenVision?: (provider: string, routedModel: string) => boolean | undefined;
}

const UNKNOWN: VisionVerdict = { reads: 'unknown', source: null };
const answer = (reads: boolean, source: VisionSource): VisionVerdict => ({ reads: reads ? 'yes' : 'no', source });

/** The name list can prove yes; absence from a list is not evidence of no. */
function fromNames(model: string, isOllama: boolean): VisionVerdict {
  return getModelCapabilities(model, isOllama).supportsImages ? answer(true, 'names') : UNKNOWN;
}

/** A saved test result, then the name list. The test ranks first: it asked this very model. */
function fromTestThenNames(q: VisionQuery, facts: VisionFacts): VisionVerdict {
  const tested = facts.testedVision?.(q.provider, q.model || '');
  if (tested !== undefined) return answer(tested, 'test');
  return fromNames(q.model || '', false);
}

/**
 * The answer, the user's own setting included (phase 4):
 *   Off  beats everything, the route too: "never send this model an image".
 *   On   beats the provider's data, a saved test and the name list — but not
 *        the route. A custom or cURL template with nowhere to put an image
 *        cannot carry one whatever the user says, so that stays "no · route".
 *   Auto is resolveVisionAuto.
 */
export function resolveVision(q: VisionQuery, facts: VisionFacts = {}): VisionVerdict {
  const forced = facts.overriddenVision?.(q.provider, q.model || '');
  if (forced === false) return answer(false, 'override');
  const auto = resolveVisionAuto(q, facts);
  if (forced === true) return auto.source === 'route' && auto.reads === 'no' ? auto : answer(true, 'override');
  return auto;
}

/**
 * A catalogue's "yes" does not outrank a FAILED image test (2026-10-01). A
 * catalogue-listed model is only ever tested after it refused a real
 * screenshot (or the user asked for a test), so a saved "no" there is the
 * model itself contradicting its listing. With the catalogue ranked first the
 * model was seated again, refused again and was re-tested every ten minutes,
 * forever. The saved result stops counting after 30 days, like any other.
 */
function failedTest(q: VisionQuery, facts: VisionFacts): boolean {
  return facts.testedVision?.(q.provider, q.model || '') === false;
}

/** What Natively itself can tell — the answer on Auto. */
export function resolveVisionAuto(q: VisionQuery, facts: VisionFacts = {}): VisionVerdict {
  const model = q.model || '';
  switch (q.provider) {
    // These adapters always carry the image to a model that reads it.
    case 'natively':
    case 'codex-cli':
    case 'antigravity':
      return answer(true, 'route');
    // An explicit multimodal flag, an {{IMAGE_BASE64}} placeholder, or an OpenAI-compatible body.
    case 'custom':
    case 'curl':
      return answer(customProviderSupportsVision(facts.customProvider ?? null), 'route');
    case 'ollama': {
      const reported = facts.ollamaReportsVision?.(model);
      if (reported !== undefined) return answer(reported, 'provider');
      return isOllamaVisionModelByName(model) ? answer(true, 'names') : UNKNOWN;
    }
    case 'ninerouter': {
      const catalogue = facts.ninerouterVisionModels ?? [];
      if (catalogue.length > 0) {
        const listed = catalogue.includes(model.replace(/^ninerouter\//, ''));
        return listed && failedTest(q, facts) ? answer(false, 'test') : answer(listed, 'provider');
      }
      return fromTestThenNames(q, facts);
    }
    // OpenRouter publishes input_modalities per model and refuses images to the
    // ones it lists as text-only, so its answer is trusted both ways (2026-10-01).
    case 'openrouter': {
      const reported = facts.providerReportsVision?.('openrouter', model);
      if (reported === true && failedTest(q, facts)) return answer(false, 'test');
      if (reported !== undefined) return answer(reported, 'provider');
      return fromTestThenNames(q, facts);
    }
    // LiteLLM's /model/info can say `supports_vision: true`; nothing there means "no".
    case 'litellm': {
      if (facts.providerReportsVision?.('litellm', model) === true) return failedTest(q, facts) ? answer(false, 'test') : answer(true, 'provider');
      return fromTestThenNames(q, facts);
    }
    default:
      return fromTestThenNames(q, facts);
  }
}

/** The boolean a caller acts on. `unknownMeans` is the caller's policy, stated at the call site. */
export function readsImages(v: VisionVerdict, unknownMeans: boolean): boolean {
  return v.reads === 'unknown' ? unknownMeans : v.reads === 'yes';
}

/**
 * What an unknown answer means for each selected-gateway seat. 9Router and
 * OpenRouter seat (an unfetched catalogue is not "text-only"; failing closed on
 * absent data was a bug once already); AgentRouter does not (no evidence, no
 * screenshot). Phase 1 kept each rung's behaviour; OpenRouter joined in phase 2,
 * and LiteLLM, NVIDIA NIM and Fluxion in phase 3, where a saved test result can
 * say "no" for them. Unknown still seats them, as it always has.
 */
const SEAT_ON_UNKNOWN = { ninerouter: true, openrouter: true, litellm: true, nvidia_nim: true, fluxion: true, agentrouter: false } as const;

/**
 * Whether a selected gateway model is seated for a screenshot. One function for
 * BOTH screenshot paths — LLMHelper's streaming chain and VisionProviderRegistry
 * — so they cannot answer differently.
 */
export function gatewaySeatReadsImages(provider: keyof typeof SEAT_ON_UNKNOWN, model: string, facts: VisionFacts = {}): boolean {
  return readsImages(resolveVision({ provider, model }, facts), SEAT_ON_UNKNOWN[provider]);
}

/**
 * What Settings › AI Providers shows on a model's row (phase 4).
 *   setting   the user's own answer; `auto` leaves it to Natively.
 *   reads     the answer in force (the setting included), and where it came from.
 *   auto      what Natively itself can tell — shown beside the control, so the
 *             user sees what "Auto" means before choosing it.
 */
export interface VisionModelState {
  setting: 'auto' | 'on' | 'off';
  reads: VisionAnswer;
  source: VisionSource | null;
  auto: { reads: VisionAnswer; source: VisionSource | null; testedAt?: number };
  provider: DirectAssistProvider;
  /** A one-time image test of this model is running now. */
  checking: boolean;
  /** The one-time test may ask this model now (a key, the provider on, screenshots allowed off this device). */
  testable: boolean;
}
