// Why an embedding availability probe failed — for the log, never for the user.
//
// Every provider's isAvailable() used to `catch { return false }`. The resolver
// could then only print "probe 1/3 failed", a session was demoted to the bundled
// model (new uploads left `lexical_only`, every query lexical), and nothing
// anywhere recorded WHAT failed. Found live 2026-09-19: natively /v1/embed was
// answering 503 auth_unavailable for hours and the log held not one word of it.

/** Anything shaped like a credential. Some SDKs echo part of the key back in the message. */
// No leading \b: "x_api_key_sk-…" has an underscore before the key, and \b does
// not break there (review finding). Prefixes are distinctive enough without it.
const KEY_LIKE_RE = /(sk-(?:or-|ant-|proj-)?|natively_sk_|pa-|AIza|gsk_|xai-|jina_|hf_|nvapi-|r8_|pplx-)[A-Za-z0-9_-]{6,}/g;
/** "Bearer <anything>", JWTs, and bare long hex/base64url tokens that carry no prefix at all. */
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const LONG_TOKEN_RE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;

export function maskCredentials(text: string): string {
  return text.replace(BEARER_RE, '$1 …').replace(JWT_RE, 'eyJ…').replace(KEY_LIKE_RE, '$1…').replace(LONG_TOKEN_RE, '…');
}

/** HTTP status / error name / code / message. Never a header, never a credential. */
export function describeProbeError(error: any): string {
  const message = maskCredentials(String(error?.message ?? error ?? 'unknown error')).slice(0, 200);
  // Node's fetch reports every network failure as "TypeError · fetch failed" and
  // puts the reason (ENOTFOUND, ECONNREFUSED, a TLS error) on `cause` — without
  // it DNS, refused and TLS failures were indistinguishable in the log.
  const cause = error?.cause ? maskCredentials(String(error.cause?.code ?? error.cause?.message ?? error.cause)).slice(0, 80) : '';
  return [
    error?.status ? `HTTP ${error.status}` : '',
    error?.name && error.name !== 'Error' ? maskCredentials(String(error.name)).slice(0, 40) : '',
    error?.code ? maskCredentials(String(error.code)).slice(0, 40) : '',
    message,
    cause ? `cause: ${cause}` : '',
  ].filter(Boolean).join(' · ');
}
