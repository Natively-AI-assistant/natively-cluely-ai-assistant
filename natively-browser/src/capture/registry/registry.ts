/**
 * Smart Browser Context v2 — capture registry loader + matchers.
 *
 * The registry is DATA ONLY. This module:
 *   - bundles the default registry (registry.default.json),
 *   - exposes a pure schema validator (no eval, no Function, no code exec),
 *   - exposes an expiry check,
 *   - safely falls back to the bundled registry on any problem with a candidate,
 *   - provides pure host/URL matchers the classifier uses.
 *
 * A future remote registry may ONLY be signed JSON matching CaptureRegistry; it
 * is never executable. `loadRegistry()` already guards that path: anything that
 * fails validation/expiry collapses to the bundled default.
 */

import defaultRegistryJson from './registry.default.json';
import type {
  BlockedHostRule,
  CaptureRegistry,
  CategoryRule,
  PlatformRule,
} from './registry-types';

/** The bundled, always-available registry. Frozen so callers can't mutate it. */
export const DEFAULT_REGISTRY: CaptureRegistry = deepFreeze(
  defaultRegistryJson as CaptureRegistry,
);

const VALID_EXTRACTORS = new Set([
  'codingProblem', 'codingEditor', 'docsVisible', 'notesEditor',
  'article', 'jobDescription', 'selectionOnly', 'blocked',
]);

/* ──────────────────────────── validation ──────────────────────────── */

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isCategoryRule(r: unknown): r is CategoryRule {
  const c = r as CategoryRule;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.label === 'string' &&
    typeof c.autoPolicy === 'string' &&
    typeof c.sensitivity === 'string' &&
    isStringArray(c.urlPatterns) &&
    isStringArray(c.hostPatterns) &&
    isStringArray(c.positiveSignals) &&
    isStringArray(c.negativeSignals) &&
    typeof c.extractor === 'string' &&
    VALID_EXTRACTORS.has(c.extractor)
  );
}

function isPlatformRule(r: unknown): r is PlatformRule {
  const p = r as { extractor?: unknown } & PlatformRule;
  // `extractor` is read as `unknown` so the runtime check against the allowlist
  // (and the no-`blocked` rule) is genuine validation of untrusted JSON, not a
  // statically-impossible comparison against the narrowed PlatformExtractorId.
  const extractor: unknown = p?.extractor;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.label === 'string' &&
    typeof p.category === 'string' &&
    isStringArray(p.hostPatterns) &&
    isStringArray(p.urlPatterns) &&
    isStringArray(p.optionalOrigins) &&
    typeof extractor === 'string' &&
    VALID_EXTRACTORS.has(extractor) &&
    extractor !== 'blocked'
  );
}

function isBlockedHostRule(r: unknown): r is BlockedHostRule {
  const b = r as BlockedHostRule;
  return (
    !!b &&
    typeof b.id === 'string' &&
    typeof b.label === 'string' &&
    typeof b.category === 'string' &&
    isStringArray(b.hostPatterns) &&
    (b.urlPatterns === undefined || isStringArray(b.urlPatterns))
  );
}

/**
 * Pure structural validation. Returns true only if `value` is a well-formed
 * CaptureRegistry. Never throws.
 */
export function isValidRegistry(value: unknown): value is CaptureRegistry {
  const r = value as CaptureRegistry;
  if (!r || typeof r !== 'object') return false;
  if (typeof r.version !== 'string' || typeof r.createdAt !== 'string') return false;
  if (r.expiresAt !== undefined && typeof r.expiresAt !== 'string') return false;
  if (r.signature !== undefined && typeof r.signature !== 'string') return false;
  if (!Array.isArray(r.categories) || !r.categories.every(isCategoryRule)) return false;
  if (!Array.isArray(r.platforms) || !r.platforms.every(isPlatformRule)) return false;
  if (!Array.isArray(r.blockedHosts) || !r.blockedHosts.every(isBlockedHostRule)) return false;
  return true;
}

/** True if the registry has an `expiresAt` in the past. `now` injectable for tests. */
export function isExpired(registry: CaptureRegistry, now: number = Date.now()): boolean {
  if (!registry.expiresAt) return false;
  const t = Date.parse(registry.expiresAt);
  if (Number.isNaN(t)) return false; // unparseable expiry → treat as non-expiring
  return t < now;
}

/**
 * Resolve the active registry. Given an optional candidate (e.g. a future remote
 * registry already parsed from signed JSON), returns it only if it is valid and
 * unexpired; otherwise falls back to the bundled default. With no candidate,
 * returns the bundled default. Never throws, never executes candidate code.
 */
export function loadRegistry(
  candidate?: unknown,
  now: number = Date.now(),
): CaptureRegistry {
  if (candidate && isValidRegistry(candidate) && !isExpired(candidate, now)) {
    return candidate;
  }
  return DEFAULT_REGISTRY;
}

/* ──────────────────────────── matchers ────────────────────────────── */

/** Lowercase host with a leading "www." stripped. Returns '' on bad input. */
export function normalizeHost(host?: string | null): string {
  if (!host || typeof host !== 'string') return '';
  return host.toLowerCase().replace(/^www\./, '');
}

/** True if `host` equals or is a subdomain of `pattern` (suffix match). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = normalizeHost(host);
  const p = normalizeHost(pattern);
  if (!h || !p) return false;
  return h === p || h.endsWith('.' + p);
}

/** True if any pattern host-matches. */
export function hostMatchesAny(host: string, patterns: string[]): boolean {
  return patterns.some((p) => hostMatches(host, p));
}

/** True if the URL string contains any of the (lowercased) substrings. */
export function urlMatchesAny(url: string, patterns: string[]): boolean {
  if (!url || !patterns.length) return false;
  const u = url.toLowerCase();
  return patterns.some((p) => p && u.includes(p.toLowerCase()));
}

/** First platform rule whose host matches; if any platform requires a URL
 *  pattern, the URL must also match. Returns null when nothing matches. */
export function findPlatform(
  registry: CaptureRegistry,
  host: string,
  url: string,
): PlatformRule | null {
  for (const p of registry.platforms) {
    if (!hostMatchesAny(host, p.hostPatterns)) continue;
    if (p.urlPatterns.length && !urlMatchesAny(url, p.urlPatterns)) {
      // Host matched but the URL gate didn't: require the URL gate when a rule
      // declares urlPatterns, EXCEPT a bare "/" gate which always matches.
      if (!p.urlPatterns.includes('/')) continue;
    }
    return p;
  }
  return null;
}

/** First blocked-host rule that matches host (or URL pattern). Null if none. */
export function findBlocked(
  registry: CaptureRegistry,
  host: string,
  url: string,
): BlockedHostRule | null {
  for (const b of registry.blockedHosts) {
    if (hostMatchesAny(host, b.hostPatterns)) return b;
    if (b.urlPatterns && urlMatchesAny(url, b.urlPatterns)) return b;
  }
  return null;
}

/** Look up a category rule by id. Null if absent. */
export function findCategory(
  registry: CaptureRegistry,
  id: string,
): CategoryRule | null {
  return registry.categories.find((c) => c.id === id) ?? null;
}

// Categories matchable by a host/URL category rule (no specific platform needed),
// mapped to how strictly they match. Deliberately EXCLUDES the coding categories:
// an unknown coding-like host must NOT be auto-classified as coding from a bare
// URL token like "/challenge" — that stays platform-gated or goes through the AI
// classifier. Also excludes sensitive (handled by the blocked floor), docs/notes
// (manual-first), article, and unknown.
//
//   'host_or_url' — a host match OR a url-pattern match (job_description: its
//                   hosts + tokens like /jobs,/careers are specific, and JD pages
//                   are low-sensitivity).
//   'host_only'   — a HOST match is REQUIRED (developer_docs: its url tokens
//                   /api,/docs,/reference are far too broad to act on alone — they
//                   would mislabel internal admin pages like /api/patients. A
//                   known docs HOST, e.g. MDN, is the trustworthy signal).
const HOST_URL_MATCHABLE_CATEGORIES: ReadonlyMap<string, 'host_or_url' | 'host_only'> = new Map([
  ['job_description', 'host_or_url'],
  ['developer_docs', 'host_only'],
]);

/**
 * Match a non-coding opt-in category rule (job_description / developer_docs) by
 * host/URL when no specific platform rule applies. developer_docs requires a HOST
 * match (its url tokens are too broad); job_description accepts host OR url.
 * Coding categories are intentionally not matchable here.
 */
export function findCategoryByHostUrl(
  registry: CaptureRegistry,
  host: string,
  url: string,
): CategoryRule | null {
  for (const c of registry.categories) {
    const mode = HOST_URL_MATCHABLE_CATEGORIES.get(c.id);
    if (!mode) continue;
    const hostMatch = hostMatchesAny(host, c.hostPatterns);
    const matched = mode === 'host_only' ? hostMatch : hostMatch || urlMatchesAny(url, c.urlPatterns);
    if (matched) {
      return c;
    }
  }
  return null;
}

/** All optional origins across coding-capable platforms (for permission asks). */
export function codingOptionalOrigins(registry: CaptureRegistry): string[] {
  const out = new Set<string>();
  for (const p of registry.platforms) {
    if (p.category === 'coding_problem' || p.category === 'coding_editor' || p.category === 'interview_assessment') {
      for (const o of p.optionalOrigins) out.add(o);
    }
  }
  return [...out];
}

/* ──────────────────────────── util ────────────────────────────────── */

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}
