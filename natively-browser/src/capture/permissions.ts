/**
 * Smart Browser Context v2 — optional host permission flow (extension).
 *
 * Coding/interview domains are declared as OPTIONAL host permissions (never
 * <all_urls>, never granted at install). When the user enables coding
 * auto-capture, the desktop asks the extension to request them. If the user
 * DENIES, manual capture keeps working unchanged — auto just stays off and a
 * non-blocking warning is shown. Nothing here breaks the existing flow.
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
