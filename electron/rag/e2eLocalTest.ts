// Local-test authentication for a LOCALLY RUN natively-api (NATIVELY_LOCAL_TEST_AUTH=1
// on the server). The chat path has sent this header since the Modes Manager E2E
// mission (LLMHelper: `e2eLocalToken`); the embedding and rerank clients did not,
// so a local server could answer chat but never /v1/embed or /v1/rerank — the
// retrieval stack was untestable end to end without production and its database
// (found 2026-09-19, when the hosted API was unavailable and every live retrieval test was blocked).
//
// Same gate as chat, to the letter: NATIVELY_E2E=1 AND a token. The server refuses
// the bypass in production and without an explicit token, so this is inert in a
// shipped app. The header goes ONLY to the natively API — never a third party.

const DEFAULT_NATIVELY_API_URL = 'https://api.natively.software';

export function nativelyApiBase(): string {
  return (process.env.NATIVELY_API_URL || DEFAULT_NATIVELY_API_URL).replace(/\/+$/, '');
}

/** `{ 'x-natively-local-test': token }` under the E2E gate, else `{}`. */
export function e2eLocalTestHeader(): Record<string, string> {
  const token = process.env.NATIVELY_E2E === '1' ? (process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || '') : '';
  return token ? { 'x-natively-local-test': token } : {};
}

/** The header, but only for a request that is going to the natively API. */
export function e2eLocalTestHeaderFor(url: string): Record<string, string> {
  // ORIGIN equality, not a string prefix (review finding): a prefix match sent
  // the header to http://127.0.0.1:8791.evil.com, to …:87910, and to
  // http://127.0.0.1:8791@evil.com — whose real host is evil.com. Not reachable
  // today (every base URL is static or the same env var), which is no reason to
  // leave a credential's destination to string luck.
  try {
    return new URL(String(url)).origin === new URL(nativelyApiBase()).origin ? e2eLocalTestHeader() : {};
  } catch {
    return {};
  }
}
