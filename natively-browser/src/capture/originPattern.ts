/**
 * Origin match-pattern derivation, deliberately in its own module.
 *
 * The service worker needs this, but importing it from `./permissions` would
 * drag the whole coding-site registry into the service-worker bundle (esbuild
 * bundles per entry point, and `permissions.ts` imports the registry at module
 * top). Keeping it standalone means both consumers get the function and only
 * the permission flow pays for the registry.
 */

/**
 * The narrowest match pattern that grants access to ONE site, e.g.
 * "https://www.youtube.com/shorts/abc?t=1" -> "https://www.youtube.com/*".
 *
 * Host-scoped on purpose: never a wildcard subdomain, never <all_urls>.
 * Granting "*://*.example.com/*" would silently cover hosts the user never
 * looked at. Returns null for anything that is not a real http(s) page
 * (chrome://, file://, about:blank, devtools, malformed) — the same class
 * `isCapturable` already refuses upstream.
 */
export function originPatternFromUrl(url: string): string | null {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}
