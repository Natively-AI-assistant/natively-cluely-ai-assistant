/**
 * Any failed call to the Natively API starts the connection check (2026-11-18, #759).
 *
 * Only the Pro check could before: a Standard-plan key, a trial, chat, usage or
 * embeddings that could not reach us started nothing, and the person was left
 * with "fetch failed". This wraps fetch for the API's origin ONLY. It changes
 * nothing about the request, the response or the failure: the original error is
 * rethrown as it was, and what it hands the callback is a description, never the
 * request. Fire-and-forget: a callback that throws is contained.
 *
 * Not triggers: an answer of any status (the server was reached), a cancel or a
 * timeout (not proof of a connection problem), and our own background reporting
 * (/v1/telemetry, /v1/usage/audit), which would otherwise start a check every
 * time a laptop is offline.
 *
 * PURE ON PURPOSE (injected fetch, origin, callback). Type-erasable TypeScript
 * only: the test imports this file directly.
 */

export interface ApiFailureHookOptions {
  /** e.g. https://api.natively.software */
  apiOrigin: string;
  onFailure(reason: 'api_call', description: string): void;
  describe(error: unknown): string;
}

const BACKGROUND = /^\/v1\/(telemetry|usage\/audit)(\/|$)/;

function urlOf(input: unknown): URL | null {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    const u = (input as { url?: unknown })?.url;
    return typeof u === 'string' ? new URL(u) : null;
  } catch {
    return null;
  }
}

export function wrapFetchForApiFailures(original: typeof fetch, opts: ApiFailureHookOptions): typeof fetch {
  let apiOrigin = '';
  try { apiOrigin = new URL(opts.apiOrigin).origin; } catch { /* hook stays inert */ }

  return async function natively_fetch(this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
    try {
      return await original.apply(this, args);
    } catch (error) {
      try {
        const url = urlOf(args[0]);
        const name = (error as { name?: string })?.name;
        if (apiOrigin && url && url.origin === apiOrigin && !BACKGROUND.test(url.pathname)
          && error instanceof TypeError && name !== 'AbortError' && name !== 'TimeoutError') {
          opts.onFailure('api_call', opts.describe(error));
        }
      } catch { /* never change what the caller sees */ }
      throw error;
    }
  } as typeof fetch;
}
