// intelligence-eval-real-ui/helpers/secret-redactor.ts
// Redacts the API key and private PII from any string before it is logged,
// written to a report, or saved in a network/trace artifact. NEVER let a
// key-shaped or PII token reach disk.

const PII_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PII_PHONE = /\b(\+?\d{1,2}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/g;

export function redact(input: unknown): string {
  let s = typeof input === 'string' ? input : (() => { try { return JSON.stringify(input); } catch { return String(input); } })();
  if (!s) return s;
  // Key-shaped tokens first (most sensitive).
  s = s
    .replace(/natively[_-]?sk[_-]?[A-Za-z0-9_-]+/gi, 'natively_sk_****')
    .replace(/\b(sk|key|tok|bearer)[_-\s][A-Za-z0-9._-]{12,}\b/gi, '$1_****')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, 'natively_sk_****')
    .replace(/("?x-natively-key"?\s*[:=]\s*")[^"]+(")/gi, '$1natively_sk_****$2')
    .replace(/(authorization"?\s*[:=]\s*"?)(bearer\s+)?[^"\s]+/gi, '$1$2****');
  return s;
}

// Heavier redaction for network/trace bodies that may carry resume/JD text.
export function redactPrivate(input: unknown, allowResume = false): string {
  let s = redact(input);
  if (!allowResume) {
    s = s.replace(PII_EMAIL, '<email>').replace(PII_PHONE, '<phone>');
  }
  return s;
}

// Assert a payload is key-free; throws so a bug can never silently ship a key.
export function assertNoKey(s: string, key: string): void {
  if (key && s.includes(key)) {
    throw new Error('SECURITY: raw API key detected in output that was about to be persisted. Aborting.');
  }
}
