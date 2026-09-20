// electron/llm/ninerouterErrors.ts
//
// Turn a 9Router failure into one line a user can act on.
//
// This matters more here than for any other provider, because the failures are
// not 9Router's — it relays whatever its upstream said, and the upstreams fail
// for reasons that need completely different responses from the user. Measured
// across a live 47-model catalogue:
//
//   401  5 models   the Claude account's OAuth expired   -> reconnect it
//   401 14 models   the Codex/ChatGPT sign-in expired    -> reconnect it
//   401  8 models   an API key was revoked               -> paste a new one
//   410  8 models   the vendor RETIRED the model         -> pick another
//   429  n models   quota / rate limit                   -> wait, or pick another
//   400  n models   context window exceeded              -> shorten the prompt
//   200  2 models   answered with NO TEXT AT ALL         -> pick another
//
// "The model did not produce an answer" is true for all seven and useful for
// none. Worse, the advice actively conflicts: 429 means try again, 410 means
// never try again, and 401 means the problem is in a dashboard the user has not
// opened. So each cause gets its own remedy, and the familiar line is kept as
// the opening clause so the message still reads like the rest of the app.

/**
 * Thrown when a stream completes with HTTP 200 and zero content.
 *
 * The quietest failure of the lot: MiniMax-M3 and gemma-4-31b-it both return a
 * well-formed SSE stream carrying no content deltas at all. Nothing rejects, so
 * without an explicit check the user simply gets an empty answer bubble and no
 * indication that anything went wrong.
 */
export const NINEROUTER_EMPTY_ANSWER = 'ninerouter:empty-answer';

/** Upstream messages can quote a bearer token back at us. Never relay one. */
function redact(text: string): string {
  return text.replace(/\bsk-[A-Za-z0-9._-]+/g, '[key]').replace(/\bBearer\s+\S+/gi, '[key]');
}

/**
 * 9Router prefixes a relayed error with `[upstream/model] [status]:`. Pull the
 * upstream's REAL name out of it.
 *
 * Deliberately NOT anchored to the start: the OpenAI SDK puts its own status in
 * front, so the text is `401 [claude/claude-opus-5] [401]: …`. Anchoring made
 * this miss and fall through to the alias, and the alias is the wrong word to
 * put in the message — the user picked `cc/claude-opus-5`, but their dashboard
 * lists that account as "claude", which is what they have to go and reconnect.
 */
function upstreamOf(raw: string, fallbackModel: string): string {
  const m = /\[([A-Za-z0-9_.-]+)\/[^\]]*\]\s*\[\d{3}\]/.exec(raw);
  if (m) return m[1];
  const byProvider = /No active credentials for provider:\s*([\w.-]+)/i.exec(raw);
  if (byProvider) return byProvider[1];
  return fallbackModel.split('/')[0] || fallbackModel;
}

/**
 * One sentence of cause plus one of remedy, prefixed with the app's familiar
 * "did not produce an answer" phrasing so it reads like every other failure.
 *
 * `model` is the id the USER picked (the 9Router wire id, e.g.
 * `cc/claude-opus-5`) — always named, because with 47 selectable models
 * "the model failed" does not identify which one.
 */
export function describeNinerouterFailure(error: unknown, model: string): string {
  const err = error as { status?: number; message?: string } | undefined;
  const raw = redact(String(err?.message || ''));
  const status = Number(err?.status) || Number(/\[(\d{3})\]/.exec(raw)?.[1]) || 0;
  const lead = `${model} did not produce an answer.`;

  if (raw.includes(NINEROUTER_EMPTY_ANSWER)) {
    return `${lead} 9Router accepted the request and returned no text — some models only stream their reasoning. Pick another model.`;
  }

  const upstream = upstreamOf(raw, model);

  if (status === 401 || status === 403) {
    // The commonest failure by a wide margin, and the one most likely to be
    // misread: it is 9ROUTER's account for the upstream that expired, not the
    // user's Natively key and not their 9Router key.
    return `${lead} 9Router's ${upstream} account is no longer authorised — its sign-in or API key has expired. `
      + `Reconnect it in the 9Router dashboard under Providers, or pick another model.`;
  }

  if (status === 410) {
    // Distinct from 429 on purpose: retrying is futile, so the message must not
    // suggest it. 9Router's catalogue can list models a vendor has removed.
    return `${lead} ${upstream} has retired this model, so 9Router can no longer route to it. `
      + `Pick another model — 9Router's list can lag the provider.`;
  }

  if (status === 429) {
    return `${lead} ${upstream} is rate-limited or out of quota. Try again shortly, or pick another model.`;
  }

  if (status === 404) {
    return `${lead} 9Router has no working account for ${upstream}. `
      + `Add one in the 9Router dashboard under Providers, or pick another model.`;
  }

  if (status === 400 && /context|too (long|large)|max.*token/i.test(raw)) {
    return `${lead} The request was too large for this model's context window. `
      + `Send a shorter message, or pick a model with a bigger window.`;
  }

  if (status >= 500) {
    return `${lead} ${upstream} returned a server error through 9Router. Try again shortly, or pick another model.`;
  }

  if (status === 400) {
    return `${lead} 9Router rejected the request for this model. Pick another model, or check the model's settings.`;
  }

  // Unknown shape — still name the model and still lead with the familiar line,
  // so the message degrades to "less specific" rather than "less useful".
  return `${lead} 9Router could not complete the request${raw ? ` (${raw.slice(0, 120)})` : ''}.`;
}
