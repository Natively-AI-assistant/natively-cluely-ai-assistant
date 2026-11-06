// Connectors are a Natively Pro feature (Pro or an unexpired free trial, the
// same gate as Profile Intelligence: services/proAccess.ts).
//
// The connector code stays in this open repo on purpose: anyone can read it,
// fix it and send pull requests. The official app decides access here, in the
// main process, through the premium LicenseManager, which a source build does
// not have, so a source build reads as free.
//
// What the gate covers: connecting a service, sending to it (by hand from the
// Share menu, or by an automatic rule / webhook), Gmail briefs, the MCP server
// and the local API. What it never covers: reading status, disconnecting,
// removing a channel or key, deleting a rule. A free user can always see and
// clear what an earlier Pro or trial left behind; nothing is sent meanwhile.
//
// No platform branches: proAccess hides the macOS Keychain / Windows DPAPI
// storage behind the same call.

import type { OutputResult } from '../../../src/types/meetingOutputs';

/** What the user reads when a connector call is refused. */
export const CONNECTORS_PRO_MESSAGE = 'Connectors are part of Natively Pro. Upgrade in Settings, Plans & Billing to connect and send.';

export const PRO_REQUIRED: OutputResult = Object.freeze({ ok: false, kind: 'pro_required', message: CONNECTORS_PRO_MESSAGE }) as OutputResult;

/** The answer the MCP server and the local API give a client while connectors are locked. */
export const CONNECTORS_PRO_HTTP = Object.freeze({ status: 403, code: 'pro_required', message: 'Natively Pro is required to read meetings through this server. Upgrade in Natively, Settings, Plans & Billing.' });

/** Is this a refusal for want of Pro? Used by the renderer and tests alike. */
export function isProRequired(res: unknown): boolean {
    return !!res && typeof res === 'object' && (res as { kind?: unknown }).kind === 'pro_required';
}

/**
 * Pro or an active trial, asked fresh on every call (a trial can run out, or a
 * licence arrive, while the app is open). Required lazily so this module loads
 * under plain Node in tests; any failure reads as no access.
 */
export function connectorsAllowed(): boolean {
    try {
        const { isProOrTrialActive } = require('../proAccess') as typeof import('../proAccess');
        return isProOrTrialActive();
    } catch {
        return false;
    }
}

/**
 * The one way every surface asks a gate: only a literal `true` is access, and a
 * gate that throws (a licence read that failed) reads as no access, never as
 * an error the caller might treat differently.
 */
export function checkAllowed(allowed: (() => boolean) | undefined): boolean {
    if (typeof allowed !== 'function') return false;
    try { return allowed() === true; } catch { return false; }
}

/** Wraps a handler body: refused with PRO_REQUIRED when `allowed()` is false. */
export function requirePro<A extends any[], R>(allowed: () => boolean, fn: (...args: A) => R): (...args: A) => R | OutputResult {
    return (...args: A) => (checkAllowed(allowed) ? fn(...args) : PRO_REQUIRED);
}
