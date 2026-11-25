/**
 * One line a user can act on, per failure cause.
 *
 * OpenCode's failures are its own (unlike 9Router, which relays an upstream's
 * status), so the mapping is smaller. The one that matters most is the 403:
 * OpenCode documents that its free-tier chat models answer 403 to every client
 * that is not OpenCode, even with a valid key. That reads exactly like a dead
 * credential unless the message says otherwise, so it gets its own sentence and
 * its own remedy.
 */

import { isFreeOpencodeModel } from './catalog';

/** Thrown when a stream completes with HTTP 200 and zero content. */
export const OPENCODE_EMPTY_ANSWER = 'opencode:empty-answer';

/** Upstream messages can quote a bearer token back at us. Never relay one. */
export function redactOpencodeSecrets(text: string): string {
  return String(text || '')
    .replace(/\boc_sk_[A-Za-z0-9._-]+/g, '[key]')
    .replace(/\bsk-[A-Za-z0-9._-]+/g, '[key]')
    .replace(/\bBearer\s+\S+/gi, '[key]');
}

const redact = redactOpencodeSecrets;

/** The bare model name, as every other surface already shows it. */
function bareModelName(model: string): string {
  const parts = String(model || '').replace(/^opencode\//i, '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(model || 'The model');
}

export interface OpencodeFailureHint {
  /** HTTP status when one was received. */
  status?: number;
  /** The provider's own message, already redacted, for the 403 discriminator. */
  raw?: string;
}

function isFreeModel(model: string, raw: string): boolean {
  return isFreeOpencodeModel(bareModelName(model)) || /free[-_ ]?tier|free model/i.test(raw);
}

/**
 * The provider's own words about a rejection, lowercased, with the model id
 * removed. Classifying on these — never on the humanised sentence, and never on
 * the model's name — is what keeps the parameter corrections honest: a model
 * called `kimi-k3-thinking` is not a complaint about the reasoning setting.
 */
function rejectionText(error: unknown, model: string): string {
  const e = error as any;
  // An error already humanised by opencodeError() keeps the raw one as `cause`.
  const source = e?.provider === 'opencode' && e?.cause ? e.cause : e;
  const text = [
    source?.message,
    source?.error?.message,
    typeof source?.error?.type === 'string' ? source.error.type : '',
    typeof source?.error?.error?.type === 'string' ? source.error.error.type : '',
    typeof source?.error === 'string' ? source.error : '',
    source?.response?.data?.message,
    source?.response?.data?.error?.message,
    typeof source?.response?.data?.error === 'string' ? source.response.data.error : '',
  ].filter((t) => typeof t === 'string' && t).join(' ').toLowerCase();
  const id = bareModelName(model).toLowerCase();
  if (!id) return text;
  // Whole-token occurrences only. A plain substring removal let a short id
  // delete letters out of the very words the classifiers look for: model `m`
  // turned "max_tokens" into " ax_tokens".
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(^|[^a-z0-9._-])${escaped}(?=$|[^a-z0-9._-])`, 'g'), '$1 ');
}

function rejectionStatus(error: unknown): number {
  const e = error as any;
  const source = e?.provider === 'opencode' && e?.cause ? e.cause : e;
  return Number(source?.status ?? source?.response?.status ?? e?.status) || 0;
}

/** `max_tokens`, `max_output_tokens`, Gemini's `maxOutputTokens`, "maximum tokens". */
const OUTPUT_CAP_WORDS = /max[_ ]?(?:output[_ ]?|completion[_ ]?)?tokens|maximum (?:output )?tokens/;
const REASONING_WORDS = /reasoning|effort|thinking/;

/** A 400/422 that names the output ceiling — correctable by dropping (or lowering) it. */
export function opencodeRejectsOutputCap(error: unknown, model: string): boolean {
  const status = rejectionStatus(error);
  return (status === 400 || status === 422) && OUTPUT_CAP_WORDS.test(rejectionText(error, model));
}

/** A 400/422 that names the reasoning parameter — correctable by dropping it. */
export function opencodeRejectsReasoning(error: unknown, model: string): boolean {
  const status = rejectionStatus(error);
  return (status === 400 || status === 422) && REASONING_WORDS.test(rejectionText(error, model));
}

/**
 * The Go route refused the request in a way that may mean "this key has no
 * Go" (or no longer has it): a 403 (Go documents `EntitlementError` 403 for
 * "Keys Go doesn't cover"), a 402, or a 400/404 that names OpenCode Go
 * ("Model X isn't included in OpenCode Go").
 *
 * This is only a TRIGGER: LLMHelper re-reads the key's Go access from the
 * usage endpoint before deciding anything, because the same words can be about
 * one model or one moment. Never a 401 (an invalid key fails on every route)
 * and never a 429 (a Go subscriber at a limit: moving them onto pay-as-you-go
 * credits is OpenCode's Extra Usage setting to decide, not ours).
 */
export function opencodeGoRefused(error: unknown, model: string): boolean {
  const status = rejectionStatus(error);
  if (status === 402 || status === 403) return true;
  const text = rejectionText(error, model);
  if (/entitlementerror/.test(text)) return true;
  return (status === 400 || status === 404) && /opencode go/.test(text);
}

/**
 * The pay-as-you-go base refused the key for balance with words about Go
 * (measured live 2026-11-25: "Insufficient balance. … OpenCode Go covers only
 * requests to the OpenCode Go provider."). Also a TRIGGER only: the same
 * sentence may reach a key with no Go and no credit, so the Go route is tried
 * only once the usage endpoint says the key has Go (or cannot be read).
 */
export function opencodePaygWantsGo(error: unknown, model: string): boolean {
  return rejectionStatus(error) === 402 && /opencode go/.test(rejectionText(error, model));
}

/** A Go-only model refused because the key has no Go subscription. */
export function opencodeGoOnlyError(error: unknown, model: string): Error {
  const name = bareModelName(model);
  return Object.assign(
    new Error(`${name} did not produce an answer. It is only available with OpenCode Go, which this key does not include. Pick another model.`),
    { status: rejectionStatus(error) || undefined, provider: 'opencode', cause: error },
  );
}

/**
 * A sentence of cause plus one of remedy, opening with the app's familiar
 * "did not produce an answer" phrasing so it reads like every other failure.
 */
export function describeOpencodeFailure(error: unknown, model: string): string {
  const err = error as { status?: number; message?: string } | undefined;
  const raw = redact(String(err?.message || ''));
  const status = Number(err?.status) || Number(/\[(\d{3})\]/.exec(raw)?.[1]) || 0;
  const name = bareModelName(model);
  const lead = `${name} did not produce an answer.`;

  if (raw.includes(OPENCODE_EMPTY_ANSWER)) {
    return `${lead} It returned no text — some models only stream their reasoning. Pick another model.`;
  }

  // A refusal the adapter itself produced (Gemini's promptFeedback). It already
  // names the cause, so the only thing missing is which model it was.
  if (/blocked the prompt/i.test(raw)) {
    return `${lead} ${raw}`;
  }

  if (status === 401) {
    return `${lead} OpenCode rejected the API key. Create a new one in the Console → API keys, then save it here.`;
  }

  if (status === 403) {
    if (isFreeModel(model, raw)) {
      return `${lead} Free OpenCode models only work inside the OpenCode app, not from other clients. `
        + `Pick a paid model, or use a Go subscription.`;
    }
    return `${lead} OpenCode refused the request (403). The key may lack access to this model — `
      + `check Models in the Console, then refresh the model list.`;
  }

  if (status === 402 || status === 429) {
    return `${lead} OpenCode refused it for billing or rate limits (${status}). `
      + `Check your balance or Go usage in the Console, or pick another model.`;
  }

  if (status === 404) {
    return `${lead} OpenCode does not serve this model for your key. `
      + `Refresh the model list in Settings, or pick another model.`;
  }

  // The adapters already retried once without the offending parameter, so by
  // the time either of these reaches the user there is nothing to "try again".
  if (opencodeRejectsOutputCap(error, model)) {
    return `${lead} The request asked for more output tokens than this model allows. Pick another model.`;
  }

  if (opencodeRejectsReasoning(error, model)) {
    return `${lead} This model rejected the reasoning setting. Pick another model.`;
  }

  if (status >= 500) {
    return `${lead} OpenCode returned ${status}. Try again in a moment, or pick another model.`;
  }

  // Transport failure (DNS, TLS, timeout) has no status.
  if (!status) {
    return `${lead} Could not reach OpenCode. Check your connection, then try again.`;
  }

  return `${lead} OpenCode returned ${status}. Try again, or pick another model.`;
}

/** Attach the status/provider fields every caller upstream expects. */
export function opencodeError(error: unknown, model: string, status?: number): Error {
  const typed = error as { status?: number; message?: string } | undefined;
  return Object.assign(new Error(describeOpencodeFailure(error, model)), {
    status: status ?? typed?.status,
    provider: 'opencode',
    cause: error,
  });
}
