// Why an embedding availability probe failed — for the log, never for the user.
//
// Every provider's isAvailable() used to `catch { return false }`. The resolver
// could then only print "probe 1/3 failed", a session was demoted to the bundled
// model (new uploads left `lexical_only`, every query lexical), and nothing
// anywhere recorded WHAT failed. Found live 2026-09-19: natively /v1/embed was
// answering 503 auth_unavailable for hours and the log held not one word of it.

/** Anything shaped like a credential. Some SDKs echo part of the key back in the message. */
const KEY_LIKE_RE = /\b(sk-(?:or-|ant-|proj-)?|natively_sk_|pa-|AIza|gsk_|xai-)[A-Za-z0-9_-]{6,}/g;

/** HTTP status / error name / code / message. Never a header, never a credential. */
export function describeProbeError(error: any): string {
  const message = String(error?.message ?? error ?? 'unknown error').replace(KEY_LIKE_RE, '$1…').slice(0, 200);
  return [
    error?.status ? `HTTP ${error.status}` : '',
    error?.name && error.name !== 'Error' ? String(error.name) : '',
    error?.code ? String(error.code) : '',
    message,
  ].filter(Boolean).join(' · ');
}
