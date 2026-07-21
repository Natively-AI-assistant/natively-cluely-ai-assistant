/**
 * Smart Browser Context v2 — local tab classifier.
 *
 * Combines the registry, the additive signal scorer, and the sensitive-page
 * detector into a single TabCandidate. Pure + dependency-injected: it takes a
 * host/url/title and an optional bag of just-in-time page signals; it never
 * reads the DOM or the network itself, and the BACKGROUND path passes only
 * metadata (no signals), so no page body is ever read in the background.
 *
 * It also builds the SafeWebsiteMetadata that — and only that — is what the
 * desktop AI metadata classifier receives (coarse tokens, host, boolean signals;
 * never raw body/code/screenshots or raw private URLs).
 */

import type {
  AutoPolicy,
  BrowserContextCategory,
  SafeWebsiteMetadata,
  TabCandidate,
} from '../types';
import type { CaptureRegistry } from '../registry/registry-types';
import { findCategory, findCategoryByHostUrl, findPlatform, normalizeHost } from '../registry/registry';
import { detectSensitive, type PageSignals } from './sensitive-page-detector';
import { scoreSignals, type ScoreSignals } from './signal-scorer';

/** Coding categories that are eligible to AUTO-attach when high-confidence. */
const CODING_CATEGORIES: ReadonlySet<BrowserContextCategory> = new Set([
  'coding_problem',
  'coding_editor',
  'interview_assessment',
]);

/** Restrictiveness order; the final policy is the most-restrictive of inputs. */
const POLICY_RANK: Record<AutoPolicy, number> = {
  auto: 0,
  auto_if_high_confidence: 1,
  ask: 2,
  manual: 3,
  blocked: 4,
};

function moreRestrictive(a: AutoPolicy, b: AutoPolicy): AutoPolicy {
  return POLICY_RANK[a] >= POLICY_RANK[b] ? a : b;
}

/** URL path tokens that indicate a coding problem/assessment page. */
const PROBLEM_URL_TOKENS = ['/problem', '/problems', '/challenge', '/assessment', '/contest', '/kata', '/task'];
/** Title keywords that indicate a coding/interview problem. */
const PROBLEM_TITLE_KEYWORDS = ['problem', 'coding', 'interview', 'challenge', 'assessment', 'kata', 'leetcode', 'hackerrank'];

/* ──────────────────────────── tokenizer ───────────────────────────── */

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'www', 'com', 'http', 'https']);

/** Split a string into coarse lowercase word tokens (≥2 chars, deduped, capped). */
export function tokenize(input: string | undefined, cap = 24): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= cap) break;
  }
  return out;
}

/** Best-effort path extraction from a URL string (never throws). */
export function pathOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname || '';
  } catch {
    // Fall back to a manual slice after the host.
    const m = url.match(/^[a-z]+:\/\/[^/]+(\/[^?#]*)/i);
    return m ? m[1] : '';
  }
}

/** Lightweight non-cryptographic host hash (djb2) for cache-keying continuity. */
export function hashHost(host: string): string {
  let h = 5381;
  for (let i = 0; i < host.length; i++) h = ((h << 5) + h + host.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// A path/host segment is redacted when it looks like an opaque identifier or PII
// — keeping descriptive slugs (problems, two-sum, challenge) but dropping the
// genuinely-sensitive bits so the sanitized URL is safe to show the AI.
//
// Keep this redaction logic IDENTICAL to the copy in reSanitizeUrl() in
// electron/services/browser-context/BrowserMetadataClassifierService.ts — they
// are the extension-primary + desktop-defense-in-depth copies of the same guard.
// A parity test feeds the same fixtures through both and asserts equal output.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_NUMERIC_RE = /^\d{6,}$/; // long numeric ids
// A single continuous run that looks like a secret: 16+ chars of token alphabet
// (letters/digits) that is NOT a plain dictionary-ish word. We treat a run as
// opaque when it is long AND (mixes letter case, or contains a digit) — real
// words are lowercase and digit-free, secrets/keys/hashes are not. The 16-char
// floor catches short reset tokens; the entropy heuristic keeps long all-lower
// words like "internationalization" readable.
const OPAQUE_RUN_RE = /[A-Za-z0-9]{16,}/g;
function looksOpaque(run: string): boolean {
  if (run.length < 16) return false;
  const hasDigit = /\d/.test(run);
  const hasUpper = /[A-Z]/.test(run);
  const hasLower = /[a-z]/.test(run);
  // A digit or mixed case → opaque (keys/hashes/session ids). A run of ONLY
  // lowercase letters (no digit) is treated as a word and kept UNLESS it is
  // unusually long (>20), which is far more likely a base32-ish token than a
  // real word (`internationalization` is 20). All-UPPER no-digit is treated the
  // same as all-lower.
  if (hasDigit) return true;
  if (hasUpper && hasLower) return true;
  return run.length > 20; // all-one-case, no digit: word unless very long
}
/**
 * Redact a single URL path/host segment. Splits on `-`/`_`/`.` so a secret
 * EMBEDDED in an otherwise-slug-shaped segment (e.g. `sk_live_51HxYz…`,
 * `reset-AbCdEf0123456789`) is caught — if ANY sub-run looks opaque, the whole
 * segment is redacted. Plain descriptive slugs (short words) are kept.
 */
function redactSegment(seg: string): string {
  if (!seg) return seg;
  if (seg.includes('@') && seg.includes('.')) return ':email';
  if (UUID_RE.test(seg)) return ':id';
  if (LONG_NUMERIC_RE.test(seg)) return ':id';
  // Any opaque-looking sub-run (after splitting on -, _, .) → redact the segment.
  const matches = seg.match(OPAQUE_RUN_RE);
  if (matches && matches.some(looksOpaque)) return ':token';
  return seg;
}
/** Redact opaque host LABELS (e.g. a token used as a subdomain) but keep the
 *  registrable domain readable so the AI still recognizes the site. */
function redactHost(host: string): string {
  const labels = host.split('.');
  // Keep the last two labels (registrable domain + TLD) verbatim; scrub opaque
  // subdomain labels above them.
  return labels
    .map((label, i) => {
      if (i >= labels.length - 2) return label; // domain + TLD
      const m = label.match(OPAQUE_RUN_RE);
      return m && m.some(looksOpaque) ? ':sub' : label;
    })
    .join('.');
}

/**
 * Produce a privacy-safe URL for the AI classifier: `scheme://host/path` only.
 * The query string and fragment are dropped entirely (that's where session
 * tokens / candidate PII live), and path segments that look like secrets (UUIDs,
 * emails, long opaque tokens, long numeric ids) are redacted. This gives the
 * model near-full site recognition (host + descriptive path) without ever
 * exposing the sensitive parts of an unknown page's URL. Returns '' on bad input.
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '';
  let scheme = 'https';
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    scheme = (u.protocol || 'https:').replace(/:$/, '');
    host = u.hostname.replace(/^www\./, '');
    path = u.pathname || '';
  } catch {
    const m = url.match(/^([a-z]+):\/\/([^/?#]+)([^?#]*)/i);
    if (!m) return '';
    scheme = m[1];
    host = m[2].replace(/^www\./, '');
    path = m[3] || '';
  }
  if (!host) return '';
  if (scheme !== 'http' && scheme !== 'https') scheme = 'https';
  const cleanHost = redactHost(host);
  const cleanPath =
    path
      .split('/')
      .map(redactSegment)
      .join('/')
      .replace(/\/{2,}/g, '/') || '';
  return `${scheme}://${cleanHost}${cleanPath}`;
}

/* ─────────────────────── safe metadata builder ─────────────────────── */

export interface ClassifyInput {
  registry: CaptureRegistry;
  host: string;
  url: string;
  title?: string;
  metaDescription?: string;
  h1Text?: string;
  /** Just-in-time page signals; OMIT in the background (metadata-only) path. */
  signals?: PageSignals & {
    codeEditorPresent?: boolean;
    ioConstraintSignals?: boolean;
    runSubmitSignals?: boolean;
    hasSelection?: boolean;
  };
}

/**
 * Build the sanitized metadata bundle that may be sent to the AI classifier.
 * Contains coarse tokens + host + boolean signals only — no raw page body, code,
 * screenshots, or raw private URLs.
 */
export function buildSafeMetadata(input: ClassifyInput): SafeWebsiteMetadata {
  const host = normalizeHost(input.host);
  const platform = findPlatform(input.registry, host, input.url);
  const sig = input.signals ?? {};
  const sensitive = detectSensitive(input.registry, host, input.url, sig);
  const tld = host.includes('.') ? host.slice(host.lastIndexOf('.') + 1) : undefined;

  const titleTokens = tokenize(input.title);
  return {
    host,
    hostHash: host ? hashHost(host) : undefined,
    tld,
    sanitizedUrl: sanitizeUrl(input.url) || undefined,
    pathTokens: tokenize(pathOf(input.url)),
    titleTokens,
    metaDescriptionTokens: input.metaDescription ? tokenize(input.metaDescription) : undefined,
    h1Tokens: input.h1Text ? tokenize(input.h1Text) : undefined,
    knownPlatformMatch: platform?.id,
    hasCodeEditorSignal: Boolean(sig.codeEditorPresent),
    hasProblemKeywordSignal: titleTokens.some((t) => PROBLEM_TITLE_KEYWORDS.includes(t)),
    hasLoginOrPaymentSignal: Boolean(sig.hasPasswordField || sig.hasCardInput || sig.hasPaymentWords || sig.hasLoginForm),
    hasSensitiveSignals: sensitive.sensitive,
  };
}

/* ────────────────────────── tab classifier ────────────────────────── */

/**
 * Classify a tab into a TabCandidate using the registry + scorer + sensitive
 * detector. With no `signals` (background path) it scores from metadata only.
 */
export function classifyTab(input: ClassifyInput): TabCandidate {
  const host = normalizeHost(input.host);
  const url = input.url || '';
  const title = input.title || '';
  const sig = input.signals ?? {};
  const reasons: string[] = [];

  // 1. Sensitive floor — wins outright.
  const sensitive = detectSensitive(input.registry, host, url, sig);
  if (sensitive.sensitive) {
    return {
      tabId: -1,
      title,
      url,
      host,
      pathTokens: tokenize(pathOf(url)),
      matchedCategory: sensitive.category,
      confidenceScore: 0,
      autoPolicy: 'blocked',
      lastSeenAt: 0,
      reasons: ['sensitive page → blocked', ...sensitive.reasons],
    };
  }

  // 2. Registry platform → category. When no specific platform matches, fall
  // back to a category rule keyed by host/URL (covers job_description /
  // developer_docs pages on generic hosts, e.g. linkedin.com/jobs).
  const platform = findPlatform(input.registry, host, url);
  let category: BrowserContextCategory = platform?.category ?? 'unknown';
  if (platform) {
    reasons.push(`platform: ${platform.id} (${category})`);
  } else {
    const catRule = findCategoryByHostUrl(input.registry, host, url);
    if (catRule) {
      category = catRule.id;
      reasons.push(`category rule: ${catRule.id}`);
    }
  }

  // 3. Build score signals from metadata + optional JIT page signals.
  const titleLower = title.toLowerCase();
  const scoreSig: ScoreSignals = {
    knownCodingHost: Boolean(platform) && CODING_CATEGORIES.has(category),
    problemUrlToken: PROBLEM_URL_TOKENS.some((t) => url.toLowerCase().includes(t)),
    problemKeywordInTitle: PROBLEM_TITLE_KEYWORDS.some((k) => titleLower.includes(k)),
    ioConstraintSignals: Boolean(sig.ioConstraintSignals),
    codeEditorPresent: Boolean(sig.codeEditorPresent),
    runSubmitSignals: Boolean(sig.runSubmitSignals),
    hasSelection: Boolean(sig.hasSelection),
    blockedHost: false,
    passwordField: Boolean(sig.hasPasswordField),
    paymentWords: Boolean(sig.hasPaymentWords),
    loginPage: Boolean(sig.hasLoginForm),
  };
  const scored = scoreSignals(scoreSig, false);
  reasons.push(...scored.reasons);

  // 4. Band → policy, then constrain by category.
  const bandPolicy: AutoPolicy =
    scored.band === 'auto' ? 'auto'
      : scored.band === 'ask' ? 'ask'
        : scored.band === 'blocked' ? 'blocked'
          : 'manual';

  // The registry category rule is the policy ceiling for known categories; an
  // unknown page can never auto-attach locally (it must go through the AI
  // classifier), so its floor is 'ask'.
  const categoryRule = findCategory(input.registry, category);
  const categoryPolicy: AutoPolicy =
    category === 'unknown' ? 'ask' : (categoryRule?.autoPolicy ?? 'manual');

  // Only coding/interview categories may actually AUTO-attach; otherwise the
  // band's 'auto' is downgraded to 'ask'.
  let finalPolicy = moreRestrictive(bandPolicy, categoryPolicy);
  if ((finalPolicy === 'auto' || finalPolicy === 'auto_if_high_confidence') && !CODING_CATEGORIES.has(category)) {
    finalPolicy = 'ask';
    reasons.push('non-coding category cannot auto-attach → ask');
  }

  return {
    tabId: -1,
    title,
    url,
    host,
    pathTokens: tokenize(pathOf(url)),
    matchedCategory: category,
    matchedPlatform: platform?.id,
    confidenceScore: scored.score,
    autoPolicy: finalPolicy,
    lastSeenAt: 0,
    reasons,
  };
}
