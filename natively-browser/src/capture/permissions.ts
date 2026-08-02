/**
 * Smart Browser Context v2 — optional host permission flow (extension).
 *
 * Coding/interview domains are declared as OPTIONAL host permissions (never
 * <all_urls>, never granted at install). When the user enables coding
 * auto-capture, the desktop asks the extension to request them. If the user
 * DENIES, manual capture keeps working unchanged — auto just stays off and a
 * non-blocking warning is shown. Nothing here breaks the existing flow.
 *
 * MANIFEST NOTE (2026-08-02). `optional_host_permissions` also declares the
 * broad all-https and all-http match patterns. That is NOT a widening of what
 * the extension holds — Chrome prompts at install for `host_permissions` only
 * (still loopback-only here); the optional list is a declaration of what MAY be
 * requested later, granted per-site, one user gesture at a time. Chrome
 * REQUIRES it: `permissions.request` rejects for any origin not covered by a
 * declared optional pattern ("You can request subsets of optional origin
 * permissions" — permissions API reference). Without it,
 * requestOriginPermission() below could only ever succeed for the ~44 hosts in
 * the coding registry, so the desktop Cmd+Shift+Y hotkey fell through to a
 * screenshot on every other site. The explicit 44 are kept beneath the broad
 * patterns (now redundant for matching) because they are the documented
 * auto-capture set that `requestCodingHostPermissions` asks for as one batch.
 *
 * The chrome.permissions API is dependency-injected so the logic is unit-testable
 * under `node --test` with a fake API and no browser.
 */

import { DEFAULT_REGISTRY, codingOptionalOrigins } from './registry/registry';

/** The minimal chrome.permissions surface we use (injected for tests). */
export interface PermissionsApi {
  request(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  contains(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  remove?(p: { origins?: string[] }): Promise<boolean>;
}

/** The set of coding/IDE/interview origins we may request (from the registry). */
export function codingOrigins(): string[] {
  return codingOptionalOrigins(DEFAULT_REGISTRY);
}

export interface PermissionResult {
  granted: boolean;
  /** Origins that were ALREADY granted before this request. */
  alreadyHad: boolean;
  reason?: string;
}

/**
 * Request the coding host permissions. Resolves `{ granted }`. A denial is NOT
 * an error — the caller keeps manual capture and surfaces a soft warning.
 * `chrome.permissions.request` must be called from a user gesture; the popup /
 * settings flow ensures that upstream.
 */
export async function requestCodingHostPermissions(
  api: PermissionsApi,
  origins: string[] = codingOrigins(),
): Promise<PermissionResult> {
  if (!origins.length) return { granted: true, alreadyHad: true };
  try {
    const already = await api.contains({ origins });
    if (already) return { granted: true, alreadyHad: true };
    const granted = await api.request({ origins });
    return { granted, alreadyHad: false, reason: granted ? undefined : 'user denied optional host permissions' };
  } catch (err) {
    return { granted: false, alreadyHad: false, reason: 'permission request failed' };
  }
}

export { originPatternFromUrl } from './originPattern';

/**
 * Request access to a SINGLE origin, on demand, for the site the user is
 * actually looking at (2026-08-02).
 *
 * Why this exists: the optional-permission list above is the coding
 * auto-capture registry — ~44 fixed hosts. Any other site (a ChatGPT thread, a
 * YouTube page, an internal wiki) could never be captured by the desktop pull,
 * because nothing anywhere requested its origin. The popup's Capture button
 * appeared to work on those sites only because Chrome's `activeTab` grants
 * one-shot access after a click on the extension action — a grant the desktop
 * hotkey path cannot obtain, since it has no browser-side user gesture.
 *
 * MUST be called from a user gesture (the popup's click handler). Denial is not
 * an error: the caller reports it and everything else keeps working.
 */
export async function requestOriginPermission(
  api: PermissionsApi,
  origin: string,
): Promise<PermissionResult> {
  if (!origin) return { granted: false, alreadyHad: false, reason: 'no origin' };
  const origins = [origin];
  try {
    const already = await api.contains({ origins });
    if (already) return { granted: true, alreadyHad: true };
    const granted = await api.request({ origins });
    return {
      granted,
      alreadyHad: false,
      reason: granted ? undefined : 'user denied host permission',
    };
  } catch {
    return { granted: false, alreadyHad: false, reason: 'permission request failed' };
  }
}

/** True if the coding host permissions are currently granted. */
export async function hasCodingHostPermissions(
  api: PermissionsApi,
  origins: string[] = codingOrigins(),
): Promise<boolean> {
  if (!origins.length) return true;
  try {
    return await api.contains({ origins });
  } catch {
    return false;
  }
}
