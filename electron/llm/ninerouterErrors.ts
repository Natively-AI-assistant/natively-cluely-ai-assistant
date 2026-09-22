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
 * The bare model name, as the rest of the UI already shows it.
 *
 * Two prefixes stack on these ids and neither means anything to the person
 * reading the message: Natively's `ninerouter/` routing prefix, and 9Router's
 * own upstream alias (`cc/`, `cx/`, `alicode/`). The user picked a row labelled
 * "claude-opus-5", so that is what a failure should call it.
 *
 * Same last-segment rule as gatewayModelLabel in src/utils/modelUtils.ts,
 * restated because electron/ never imports from src/.
 */
function bareModelName(model: string): string {
  const parts = String(model || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(model || 'The model');
}

/**
 * One sentence of cause plus one of remedy, opening with the app's familiar
 * "did not produce an answer" phrasing so it reads like every other failure.
 *
 * Names ONLY the model. The upstream provider, the routing alias and the proxy
 * are plumbing the user never chose. The single exception is the destination in
 * a remedy — "reconnect it" without saying where is not a remedy.
 */
export function describeNinerouterFailure(error: unknown, model: string): string {
  const err = error as { status?: number; message?: string } | undefined;
  const raw = redact(String(err?.message || ''));
  const status = Number(err?.status) || Number(/\[(\d{3})\]/.exec(raw)?.[1]) || 0;
  const name = bareModelName(model);
  const lead = `${name} did not produce an answer.`;

  if (raw.includes(NINEROUTER_EMPTY_ANSWER)) {
    return `${lead} It returned no text — some models only stream their reasoning. Pick another model.`;
  }

  if (status === 401 || status === 403) {
    // The commonest failure by a wide margin, and the one most likely to be
    // misread: the expired credential belongs to the account behind this model,
    // not to the user's own Natively key.
    return `${lead} Its account is no longer authorised — the sign-in or API key has expired. `
      + `Reconnect it in the 9Router dashboard, or pick another model.`;
  }

  if (status === 410) {
    // Distinct from 429 on purpose: retrying is futile, so the wording must not
    // invite it.
    return `${lead} This model has been retired and can no longer be reached. Pick another model.`;
  }

  if (status === 429) {
    return `${lead} It is rate-limited or out of quota. Try again shortly, or pick another model.`;
  }

  if (status === 404) {
    return `${lead} There is no working account for it. Add one in the 9Router dashboard, or pick another model.`;
  }

  if (status === 400 && /context|too (long|large)|max.*token/i.test(raw)) {
    return `${lead} The request was too large for its context window. `
      + `Send a shorter message, or pick a model with a bigger window.`;
  }

  if (status >= 500) {
    return `${lead} The server returned an error. Try again shortly, or pick another model.`;
  }

  if (status === 400) {
    return `${lead} The request was rejected for this model. Pick another model, or check its settings.`;
  }

  // Unknown shape — still name the model and still lead with the familiar line,
  // so the message degrades to "less specific" rather than "less useful".
  return `${lead} The request could not be completed${raw ? ` (${raw.slice(0, 120)})` : ''}.`;
}
