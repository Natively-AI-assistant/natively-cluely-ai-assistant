/**
 * LicenseManager - Device-locked license verification for premium features.
 * Uses Electron's safeStorage API (OS Keychain) for encrypted persistence,
 * and delegates hardware fingerprinting + network calls to the compiled Rust
 * native module (libuv thread pool — never blocks the event loop).
 *
 * License verification order:
 *   1. Dodo Payments (new purchases from this build onwards)
 *   2. Gumroad (grandfathered users — legacy support, never removed)
 *
 * Anti-tamper mechanisms (parity with Gumroad path):
 *   - HWID-locked: license.enc binds the key to a specific hardware fingerprint via
 *     SHA-256 of the machine UID (compiled Rust, not patchable from JS)
 *   - OS-encrypted: safeStorage (macOS Keychain / Windows DPAPI / Linux SecretService)
 *   - Atomic writes: tmp → rename prevents corrupt files on crash
 *   - Stored instance_id: required to deactivate the Dodo slot on server side
 *   - Startup validation: isPremiumAsync() calls the Dodo validate endpoint to detect
 *     server-side revocations (chargebacks, admin disable, etc.)
 *   - Log sanitization: raw license key and instance_id are NEVER logged
 *   - Cache invalidation: cache is cleared before activation and on deactivation
 *   - Deactivation is async: calls the Dodo server to free the slot before file removal
 *   - Race-condition guard: activation mutex prevents concurrent activate calls from
 *     writing two different license files
 *
 * ⚠️  PRIVATE FILE — Do NOT commit to the public/OSS repository.
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { loadNativeModule } from '../../../electron/audio/nativeModuleLoader';
import { classifyProVerify } from './licenseVerifyPolicy';

// Load via the shared path-based loader (bypasses require('natively-audio') which requires an npm symlink)
const _nativeMod = loadNativeModule();
let getHardwareId: (() => string) | undefined = _nativeMod?.getHardwareId ?? undefined;
let verifyGumroadKey: ((key: string) => Promise<string>) | undefined =
    _nativeMod?.verifyGumroadKey ?? undefined;
// verifyDodoKey: activates key, returns "OK:<instance_id>" or "ERR:dodo:..."
let verifyDodoKeyNative: ((key: string, deviceLabel: string) => Promise<string>) | undefined =
    _nativeMod?.verifyDodoKey ?? undefined;
// validateDodoKey: startup revocation check, returns "OK" | "REVOKED" | "ERR:dodo:..."
let validateDodoKeyNative: ((key: string) => Promise<string>) | undefined =
    _nativeMod?.validateDodoKey ?? undefined;
// deactivateDodoKey: frees activation slot, returns "OK" | "ERR:dodo:..."
let deactivateDodoKeyNative: ((key: string, instanceId: string) => Promise<string>) | undefined =
    _nativeMod?.deactivateDodoKey ?? undefined;

if (!_nativeMod) {
    console.warn('[LicenseManager] Native module not available — license features disabled.');
} else {
    // Warn if the binary is stale (missing new Dodo functions added in this build).
    // All three Dodo functions require a binary rebuild: cargo build --release
    // The app degrades gracefully — Gumroad licenses continue to work.
    if (!verifyDodoKeyNative) {
        console.warn(
            '[LicenseManager] verifyDodoKey not available in binary — ' +
            'Dodo Payments activation disabled. Rebuild the native module.'
        );
    }
    if (!validateDodoKeyNative) {
        console.warn(
            '[LicenseManager] validateDodoKey not available in binary — ' +
            'startup revocation check disabled. Rebuild the native module.'
        );
    }
    if (!deactivateDodoKeyNative) {
        console.warn(
            '[LicenseManager] deactivateDodoKey not available in binary — ' +
            'server-side deactivation disabled. Rebuild the native module.'
        );
    }
}

const LICENSE_PATH = path.join(app.getPath('userData'), 'license.enc');
const NATIVELY_API_BASE = (process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '');

interface StoredLicense {
    key: string;
    hwid: string;
    activatedAt: string;
    provider?: 'gumroad' | 'dodo' | 'natively_api';
    /**
     * Dodo activation instance ID (e.g. "lki_xxx").
     * Required for server-side deactivation and stored at activation time.
     * Absent for Gumroad licenses, legacy Dodo licenses, and natively_api licenses.
     */
    instanceId?: string;
    plan?: string;
}

/**
 * Result of activateWithApiKey.
 *
 * `keyRejected` separates "the server refused this key" (4xx) from both "valid
 * key, plan has no Pro" (200) and "we could not get an answer" (5xx / network).
 * Only the first means the key authenticates nowhere; the other two must leave
 * app state alone.
 */
export interface ActivateWithApiKeyResult {
    success: boolean;
    skipped?: boolean;
    error?: string;
    /** True only for a 4xx refusal of the key itself. */
    keyRejected?: boolean;
    /** Server error code (`subscription_inactive`, `key_not_found`, …) when known. */
    code?: string;
    /** HTTP status, when a response was received at all. */
    status?: number;
}

/**
 * User-facing reason for a refused key.
 *
 * The server's own `message` wins when it sends one — it is the only source that
 * knows the account-specific next step (it sends "Renew at natively.software/api"
 * for an inactive subscription, "Contact support@natively.software" for a
 * suspended account). These fell on the floor before, replaced by a flat and
 * usually wrong "Your plan does not include Natively Pro."
 */
function describeKeyRejection(code: string, data: any): string {
    const serverMessage = typeof data?.message === 'string' ? data.message.trim() : '';
    if (serverMessage) return serverMessage;

    switch (code) {
        case 'subscription_inactive':
            return 'Your Natively subscription is not active. Renew at natively.software/api';
        case 'account_suspended':
            return 'This account is suspended. Contact support@natively.software';
        case 'key_not_found':
            return 'This Natively API key was not recognised. Check it at natively.software/api';
        case 'invalid_key_format':
            return 'That does not look like a Natively API key — it should start with natively_sk_.';
        default: {
            const retry = Number(data?.retry_after);
            if (Number.isFinite(retry) && retry > 0) {
                return `Too many attempts. Try again in ${Math.ceil(retry)}s.`;
            }
            return `Natively did not accept this API key (${code}).`;
        }
    }
}

export class LicenseManager {
    private static instance: LicenseManager;
    private cachedPremium: boolean | null = null;
    /**
     * Mutex: prevents two concurrent activateLicense() calls from creating a race condition
     * where both succeed the network check but one overwrites the other's stored file.
     */
    private activationInFlight = false;

    private constructor() { }

    public static getInstance(): LicenseManager {
        // Instance anchored on globalThis (9 dist bundles). `cachedPremium` is
        // invalidate-on-write; with per-bundle instances a DEACTIVATION only
        // reached the writing copy — every other copy stayed premium=true until
        // restart, an entitlement fail-open.
        const g = globalThis as unknown as Record<string, LicenseManager | undefined>;
        if (!g.__nativelyLicenseManagerV1__) {
            g.__nativelyLicenseManagerV1__ = LicenseManager.instance ?? new LicenseManager();
        }
        LicenseManager.instance = g.__nativelyLicenseManagerV1__;
        return g.__nativelyLicenseManagerV1__;
    }

    /**
     * Activate a license key (supports Dodo Payments and legacy Gumroad).
     * 1. Tries Dodo Payments verification first
     * 2. Falls back to Gumroad verification
     * 3. Encrypts and stores the license on success (with HWID + instanceId)
     *
     * Race condition guard: concurrent calls are rejected.
     */
    public async activateLicense(key: string): Promise<{ success: boolean; error?: string }> {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
            return { success: false, error: 'License key cannot be empty.' };
        }

        // Handle Natively API keys: delegate directly to activateWithApiKey
        if (trimmedKey.startsWith('natively_sk_')) {
            console.log('[LicenseManager] activateLicense: Natively API key detected, delegating to activateWithApiKey...');
            const apiResult = await this.activateWithApiKey(trimmedKey);
            if (apiResult.success) {
                return { success: true };
            }
            // A `skipped` with no error is the BENIGN skip documented on
            // activateWithApiKey: an active perpetual license was protected, so the
            // user IS Pro and nothing needed doing. Rendering that as "Failed to
            // activate" told a fully-entitled user their activation had failed.
            // Only the ipcHandlers caller was taught this distinction; this is the
            // other caller of the same shape.
            if (apiResult.skipped && !apiResult.error) {
                // A THIRD outcome, not a success and not a failure of the key.
                //
                // The guard runs before /v1/pro/verify, so nothing here validated
                // this key — reporting success would tell a user their subscription
                // key is registered when a typo'd or revoked key would say exactly
                // the same. Reporting "Failed to activate with API key" (the original
                // wording) was equally untrue: the key is fine, it was simply not
                // needed because a lifetime license is already granting Pro. Say that.
                console.log('[LicenseManager] activateLicense: perpetual license already active — key not applied.');
                return {
                    success: false,
                    error:
                        'Pro is already active from your lifetime license, so this key was not applied. ' +
                        'Save it under Natively Key if you want it used for API access.',
                };
            }
            return { success: false, error: apiResult.error || 'Failed to activate with API key.' };
        }

        // Guard: native module required for HWID binding
        if (!getHardwareId) {
            return { success: false, error: 'Premium features not available in this build.' };
        }

        // Race condition guard: reject if another activation is already in progress
        if (this.activationInFlight) {
            return { success: false, error: 'Activation already in progress. Please wait.' };
        }
        this.activationInFlight = true;

        // Invalidate cache. Note: concurrent isPremium() calls between here and
        // storeLicense() will get false from disk — acceptable for an activation flow.
        this.cachedPremium = null;

        try {
            // 1. Try Dodo Payments (Rust native — libuv thread, compiled machine code)
            if (verifyDodoKeyNative) {
                // Send first 32 chars of HWID as the device label so activations
                // appear labelled in the Dodo merchant dashboard.
                const deviceLabel = `Natively Pro (${getHardwareId().slice(0, 32)})`;
                let dodoResult: string;
                try {
                    dodoResult = await verifyDodoKeyNative(trimmedKey, deviceLabel);
                } catch (e: any) {
                    // Should never throw — Rust wraps all errors in "ERR:dodo:..." strings.
                    // Extra safety net in case of NAPI binding failure.
                    dodoResult = `ERR:dodo:${e?.message ?? 'native binding error'}`;
                }

                // Dodo success — result is "OK:<instance_id>"
                if (dodoResult.startsWith('OK:')) {
                    const instanceId = dodoResult.slice(3); // strip "OK:" prefix
                    console.log('[LicenseManager] Dodo activation succeeded.');
                    return await this.storeLicense(trimmedKey, 'dodo', instanceId, undefined, { replacePerpetual: true });
                }

                // 409 duplicate — the key was already activated on this or another device.
                // The response may include the existing instance_id so we can reuse the slot.
                if (dodoResult.startsWith('ERR:dodo:duplicate')) {
                    const existingId = dodoResult.startsWith('ERR:dodo:duplicate:')
                        ? dodoResult.slice('ERR:dodo:duplicate:'.length)
                        : '';
                    console.log('[LicenseManager] Dodo 409 duplicate activation detected.');
                    if (existingId) {
                        // Reuse the existing slot — store with the instance we already have
                        return await this.storeLicense(trimmedKey, 'dodo', existingId, undefined, { replacePerpetual: true });
                    }
                    // No instance_id in the 409 — store without it (deactivation won't work
                    // but the user can still use the license on this device)
                    return await this.storeLicense(trimmedKey, 'dodo', undefined, undefined, { replacePerpetual: true });
                }

                // 422 "activation limit reached" — key is valid but the product's activation limit
                // is exhausted (or set to 0). Rust returns stable "ERR:dodo:limit_reached" for 422.
                // Validate the key to confirm ownership, then store without consuming a new slot.
                if (dodoResult === 'ERR:dodo:limit_reached') {
                    console.log('[LicenseManager] Dodo 422 activation limit reached — validating key ownership...');
                    if (validateDodoKeyNative) {
                        let validateResult: string;
                        try {
                            validateResult = await validateDodoKeyNative(trimmedKey);
                        } catch (e: any) {
                            validateResult = `ERR:dodo:${e?.message ?? 'binding error'}`;
                        }
                        if (validateResult === 'OK') {
                            console.log('[LicenseManager] Dodo validate confirmed key is valid — storing without new slot.');
                            // Store without instanceId: user must contact support to free a slot
                            // for full deactivation support, but the license is usable now.
                            return await this.storeLicense(trimmedKey, 'dodo', undefined, undefined, { replacePerpetual: true });
                        }
                        if (validateResult === 'REVOKED') {
                            return { success: false, error: 'This license key has been revoked.' };
                        }
                    }
                    // Validate unavailable or errored, so NOTHING confirmed this key —
                    // 422 alone only says the product's activation limit is full, which
                    // an invalid key produces too. Every other opt-in below rests on a
                    // server confirmation (OK:, a 409 duplicate proving the key is real,
                    // or validate === 'OK'); this one has none, so it must NOT pass
                    // replacePerpetual. Storing optimistically over free space is the
                    // benefit of the doubt; overwriting a VERIFIED perpetual license with
                    // an unverified key is not, and the next validate would then revoke
                    // it and leave the user with nothing on disk to restore.
                    console.warn('[LicenseManager] Dodo 422: could not validate key — storing optimistically.');
                    const stored = await this.storeLicense(trimmedKey, 'dodo', undefined);
                    // This is the only activateLicense branch that reaches the guard
                    // (the rest opt in), and the guard's benign refusal carries no
                    // error — which the license box renders as the generic
                    // "Activation failed. Please try again.", blaming the key for a
                    // refusal caused by the license already on disk.
                    if (stored.skipped && !stored.error) {
                        return {
                            success: false,
                            error:
                                'Pro is already active from the lifetime license on this device, ' +
                                'so this key was not applied.',
                        };
                    }
                    return stored;
                }

                // Network error — fall through to Gumroad, don't reject yet
                const isDodoNetworkErr = dodoResult.startsWith('ERR:dodo:network:');
                if (!isDodoNetworkErr) {
                    // Dodo gave a definitive non-network rejection — key might be a Gumroad key
                    console.log('[LicenseManager] Dodo rejected key (non-network) — trying Gumroad fallback...');
                } else {
                    console.log('[LicenseManager] Dodo network error — trying Gumroad fallback...');
                }
            }

            // 2. Fallback to Gumroad (grandfathered / legacy users — Rust native)
            if (verifyGumroadKey) {
                let gumroadResult: string;
                try {
                    gumroadResult = await verifyGumroadKey(trimmedKey);
                } catch (e: any) {
                    gumroadResult = `ERR:gumroad:${e?.message ?? 'native binding error'}`;
                }

                if (gumroadResult === 'OK') {
                    return await this.storeLicense(trimmedKey, 'gumroad', undefined, undefined, { replacePerpetual: true });
                }

                const gumroadErr = gumroadResult.startsWith('ERR:gumroad:')
                    ? gumroadResult.replace('ERR:gumroad:', '')
                    : 'License key not recognized.';
                return { success: false, error: gumroadErr };
            }

            // Native module not loaded at all
            return { success: false, error: 'License verification unavailable in this build.' };
        } catch (error: any) {
            console.error('[LicenseManager] Activation error:', error?.message ?? error);
            return { success: false, error: error?.message || 'Activation failed.' };
        } finally {
            this.activationInFlight = false;
        }
    }

    /**
     * Activate Natively Pro using a Natively API subscription key (pro/max/ultra plans).
     * Called automatically when a user saves an API key in settings.
     *
     * Edge cases:
     *   - Existing Gumroad/Dodo lifetime license → skip (never overwrite a perpetual license)
     *   - Existing natively_api license → overwrite (allows reactivation after reinstall)
     *   - Plan is standard → return failure (no Pro entitlement), keyRejected FALSE
     *   - Key refused by the server (4xx) → return failure with keyRejected TRUE
     *   - Server fault (5xx) or network error → return failure, keyRejected FALSE
     *
     * `keyRejected` is the load-bearing distinction for callers. A standard-plan
     * key still authenticates against /v1/chat (the server gates only
     * /v1/pro/verify on PRO_PLANS), so "no Pro" must NOT change how the app
     * routes requests. A REFUSED key authenticates nowhere, so a caller that
     * auto-promoted anything on the strength of that key has to undo it.
     *
     * The skip result carries `error` ONLY when the stored perpetual license is
     * unverifiable on this device. Callers must treat `skipped` without `error` as
     * benign ("you already have Pro") and `skipped` with `error` as user-visible
     * ("you have Pro from neither credential, and here is why").
     */
    public async activateWithApiKey(
        apiKey: string
    ): Promise<ActivateWithApiKeyResult> {
        // Deliberate second evaluation, kept after measuring the alternative.
        // storeLicense() remains the AUTHORITY — it re-runs this immediately before
        // the write, so no caller can skip it and no verdict can go stale between
        // deciding and writing. This call is a fast path only, and removing it costs
        // more than the duplication: activateWithApiKey would then always hit the
        // network first, so an offline user holding a lifetime license gets "Could
        // not reach server" instead of the real reason, and every save spends a
        // round trip on a request whose result is discarded. The two evaluations can
        // disagree only if the stored license changes mid-flight, and the worst
        // outcome of that race is a wrong message, not a wrong write.
        const guard = this.perpetualLicenseGuard();
        if (guard) return guard;

        try {
            const res = await fetch(`${NATIVELY_API_BASE}/v1/pro/verify`, {
                headers: { 'x-natively-key': apiKey },
                signal: AbortSignal.timeout(8000),
            });
            // .catch: a proxy/5xx can answer with HTML, and a parse throw here
            // used to escape to the outer catch and be reported as "Could not
            // reach server" — wrong for a server that answered perfectly well.
            const data = (await res.json().catch(() => ({}))) as any;

            // Derive success from `status` rather than reading `res.ok`.
            // Response.ok is *defined* as status in [200,299], so this is exactly
            // equivalent — and it stays correct against any Response-like object
            // that omits `ok` (a partial test double, a fetch polyfill). Reading
            // res.ok directly made an absent property read as a 4xx, i.e. as a
            // refused key: the worst possible direction to be wrong in.
            const httpOk = res.status >= 200 && res.status < 300;

            // 5xx: Natively is unwell. NOT a verdict about this key — never let
            // a caller tear down state on it.
            if (res.status >= 500) {
                console.warn(
                    `[LicenseManager] activateWithApiKey: /v1/pro/verify returned ${res.status} — treating as transient`,
                );
                return { success: false, status: res.status, error: 'Natively could not verify your key right now. Please try again.' };
            }

            // 4xx: the server REFUSED the key. This is the branch that used to be
            // misreported. /v1/pro/verify only reaches its success body after
            // validateKey passes; every refusal returns {ok:false, error} with NO
            // `plan` field, so the old `!data.ok || !data.has_pro` check printed
            // "plan has no Pro — undefined" and told the user their plan lacked
            // Pro. The real cause is one of invalid_key_format / key_not_found /
            // subscription_inactive / account_suspended / identity_blocked — each
            // needing a different action from the user, and the server even sends
            // a `message` for the two that have one. `undefined` vs a real plan
            // name is the only way to tell these apart from a log, so keep the
            // code in the line.
            if (!httpOk || data?.ok === false) {
                const code = typeof data?.error === 'string' ? data.error : `http_${res.status}`;
                console.warn(
                    `[LicenseManager] activateWithApiKey: key REFUSED by server — status=${res.status} error=${code}`,
                );
                return {
                    success: false,
                    keyRejected: true,
                    code,
                    status: res.status,
                    error: describeKeyRejection(code, data),
                };
            }

            // 2xx that is not the documented success shape. Not a plan verdict and
            // not a refusal — refuse to guess in either direction.
            if (data?.ok !== true) {
                console.warn(
                    '[LicenseManager] activateWithApiKey: unexpected /v1/pro/verify body on a 2xx — treating as transient',
                );
                return { success: false, status: res.status, error: 'Natively could not verify your key right now. Please try again.' };
            }

            // Authenticated fine, plan simply has no Pro entitlement. The key still
            // works for /v1/chat, so this must not be treated as a bad key.
            if (!data.has_pro) {
                console.log('[LicenseManager] activateWithApiKey: plan has no Pro —', data.plan);
                return { success: false, error: 'Your plan does not include Natively Pro.' };
            }

            // No re-check here: storeLicense() runs the guard itself, immediately
            // before the write, and is the authority. The check above is only a fast
            // path — it answers offline and skips a pointless round trip.
            return await this.storeLicense(apiKey, 'natively_api', undefined, data.plan);
        } catch (e: any) {
            console.error('[LicenseManager] activateWithApiKey network error:', e?.message ?? e);
            return { success: false, error: 'Could not reach server. Please try again.' };
        }
    }

    /**
     * Overwrite protection for perpetual (Gumroad/Dodo) licenses.
     * Returns the caller's result when the stored license must NOT be replaced,
     * or null when the path is clear.
     *
     * peekStoredProvider, NOT readStoredLicense: this is overwrite protection,
     * not an entitlement check. readStoredLicense() returns null for an
     * HWID-bound license it cannot verify — correct for entitlement, wrong here,
     * because it makes a perpetual Gumroad/Dodo license look ABSENT and so
     * eligible to be clobbered by storeLicense() on any machine where the native
     * module fails to load. Never overwrite a perpetual license.
     *
     * Cheap and side-effect free, so callers re-run it immediately before a write
     * rather than trusting a verdict taken before a network round trip.
     */
    private perpetualLicenseGuard(): { success: false; skipped: true; error?: string } | null {
        const existingProvider = this.peekStoredProvider();
        if (!existingProvider || existingProvider === 'natively_api') return null;

        if (getHardwareId) {
            // Ownership is verifiable and matched (peekStoredProvider releases
            // protection on a proven mismatch), so this perpetual license is
            // granting Pro on this device right now. Nothing is lost by skipping.
            //
            // This branch used to clear cachedPremium, to beat a stale `false`
            // memoised earlier in the session (a transient safeStorage failure at
            // launch). That was removed: it fails OPEN. After a server-confirmed
            // revocation whose unlink failed — removeLocalLicenseFile is best-effort
            // and license.enc can be locked on Windows — the cached `false` is the
            // ONLY thing still withholding Pro, and this line discarded it, so a
            // revoked license granted Pro again for the rest of the session. The
            // stale-`false` case costs a restart; this one costs entitlement. Keeping
            // the function side-effect free is also what makes it safe for
            // storeLicense to re-run as the authority.
            console.log('[LicenseManager] existing Gumroad/Dodo license is active — refusing to replace it.');
            return { success: false, skipped: true };
        }

        // Ownership is UNVERIFIABLE — no native module, so readStoredLicense()
        // rejects this license and it grants nothing here. Protecting it from
        // overwrite is still right (its key and Dodo instanceId are not
        // recoverable from this machine), but a bare `skipped` was not: it left
        // a user who paid for BOTH credentials with Pro from neither, and
        // activateLicense() rendered the empty `error` as "Failed to activate
        // with API key" — blaming the one credential that is fine. Name the
        // real cause so the caller can surface it.
        console.warn(
            '[LicenseManager] stored Gumroad/Dodo license cannot be verified ' +
            '(native module unavailable) — refusing to overwrite it. Pro is inactive on this device.'
        );
        return {
            success: false,
            skipped: true,
            // Caller-neutral wording on purpose: this same string is surfaced by
            // activateLicense() (license box, where nothing was saved) and logged by
            // the set-natively-api-key handler (where the key WAS persisted). It must
            // not assert anything about the key's fate.
            error:
                'A lifetime license is stored on this device but cannot be verified — the hardware ' +
                'verification component failed to load, so Pro cannot be activated. ' +
                'Reinstall the app or contact support.',
        };
    }

    /**
     * Store the verified license securely using atomic write (tmp → rename).
     *
     * @param key        The raw license key (never logged)
     * @param provider   'dodo', 'gumroad', or 'natively_api'
     * @param instanceId Dodo activation instance ID ("lki_xxx"); undefined for Gumroad/natively_api
     */
    private async storeLicense(
        key: string,
        provider: 'gumroad' | 'dodo' | 'natively_api',
        instanceId: string | undefined,
        plan?: string,
        options: { replacePerpetual?: boolean } = {}
    ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
        // natively_api licenses are server-validated — no HWID binding needed.
        // All other providers (dodo, gumroad) require the Rust native module for HWID.
        if (provider !== 'natively_api' && !getHardwareId) {
            return { success: false, error: 'Hardware ID unavailable.' };
        }

        // THE overwrite-protection point. This is the only writer of license.enc, so
        // it is the only place that can destroy a previous license and therefore the
        // only place the check belongs. Callers used to guard themselves, which meant
        // the guard could be (and was) missing on one path, and — where it existed —
        // was evaluated before an 8s network round trip and stale by the time the
        // write happened. Here there is no window and no path around it.
        //
        // replacePerpetual is the explicit opt-in for a caller whose whole purpose is
        // to replace a perpetual license: activateLicense() is the user deliberately
        // entering a new Gumroad/Dodo key. An API-key activation never passes it.
        if (!options.replacePerpetual) {
            const guard = this.perpetualLicenseGuard();
            if (guard) return guard;
        }

        try {
            if (!safeStorage.isEncryptionAvailable()) {
                return { success: false, error: 'OS encryption not available.' };
            }

            // natively_api licenses: use empty-string sentinel for HWID —
            // these are server-validated per-request, not device-bound.
            const hwid = provider === 'natively_api' ? '' : (getHardwareId ? getHardwareId() : '');
            const payload: StoredLicense = {
                key,
                hwid,
                activatedAt: new Date().toISOString(),
                provider,
                ...(instanceId ? { instanceId } : {}),
                ...(plan ? { plan } : {}),
            };

            const encrypted = safeStorage.encryptString(JSON.stringify(payload));
            // Atomic write: write to .tmp then rename — prevents corrupt files on crash
            const tmpPath = LICENSE_PATH + '.tmp';
            fs.writeFileSync(tmpPath, encrypted);
            fs.renameSync(tmpPath, LICENSE_PATH);

            this.cachedPremium = true;
            console.log(
                `[LicenseManager] ${provider} license activated.` +
                (instanceId ? ' (instance_id stored)' : ' (no instance_id)')
            );

            return { success: true };
        } catch (error: any) {
            console.error('[LicenseManager] storeLicense error:', error?.message ?? error);
            // A failed rename leaves the .tmp behind holding a complete,
            // safeStorage-decryptable license that a revoked user could rename back
            // into place. Cleaned up here AND in removeLocalLicenseFile(), because
            // this unlink is best-effort: on Windows the same lock that made the
            // rename fail can make it fail too.
            try { if (fs.existsSync(LICENSE_PATH + '.tmp')) fs.unlinkSync(LICENSE_PATH + '.tmp'); } catch { /* best effort */ }
            return { success: false, error: 'Failed to store license securely.' };
        }
    }

    /**
     * Read and validate the stored license from disk.
     * Returns null on any failure (file not found, decryption error, HWID mismatch).
     * Never throws.
     */
    private readStoredLicense(): StoredLicense | null {
        try {
            if (!fs.existsSync(LICENSE_PATH)) return null;
            if (!safeStorage.isEncryptionAvailable()) return null;

            const encrypted = fs.readFileSync(LICENSE_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            const license: StoredLicense = JSON.parse(decrypted);

            // natively_api licenses are server-validated, not HWID-bound — skip device check.
            //
            // The native module is required only by providers that ARE HWID-bound.
            // This guard used to sit above the branch and reject EVERY license when
            // the Rust binary failed to load (ASAR unpack failure, AV quarantine on
            // Windows, or an unbuilt dev checkout). That silently revoked valid
            // API-plan Pro even though storeLicense() deliberately exempts
            // natively_api from the HWID requirement — the two disagreed.
            //
            // INVARIANT: gumroad/dodo with no native module must still resolve to
            // null (premium impossible), because their device binding cannot be
            // verified without getHardwareId. Keep this guard inside the branch.
            if (license.provider !== 'natively_api') {
                if (!getHardwareId) return null;
                const currentHwid = getHardwareId();
                if (license.hwid !== currentHwid) {
                    console.warn('[LicenseManager] HWID mismatch — license belongs to a different device.');
                    return null;
                }
            }

            return license;
        } catch (error: any) {
            // Catches: ENOENT, decryption failure, JSON parse error
            console.error('[LicenseManager] readStoredLicense error:', error?.message ?? error);
            return null;
        }
    }

    /**
     * Which provider owns the stored license, read WITHOUT the HWID gate.
     * Returns null when no license file exists or it cannot be decrypted.
     *
     * Deliberately narrow — this must NEVER be used to grant entitlement. It
     * answers only "is a license already on disk, and whose is it?", so an
     * API-key activation cannot silently overwrite a perpetual license.
     *
     * A file predating the `provider` field reports 'legacy' rather than null:
     * absent an explicit natively_api marker it must be treated as protected,
     * not as free space.
     *
     * A license we can PROVE belongs to another device reports null. Protection
     * is for licenses whose ownership is unverifiable (no native module), not
     * for ones positively shown to be foreign: a stale license.enc restored from
     * another machine's backup grants nothing here, and treating it as protected
     * would block the user's own API-key activation with no visible error.
     *
     * A file that cannot be DECRYPTED also reports null — this check is
     * decrypt-based and has nothing to go on. Refusing on a file nobody can read
     * would lock the user out of activating at all, with no local way to clear it.
     */
    private peekStoredProvider(): string | null {
        try {
            if (!fs.existsSync(LICENSE_PATH)) return null;
            if (!safeStorage.isEncryptionAvailable()) return null;
            const decrypted = safeStorage.decryptString(fs.readFileSync(LICENSE_PATH));
            const license: StoredLicense = JSON.parse(decrypted);
            const provider = license.provider ?? 'legacy';

            if (provider !== 'natively_api' && getHardwareId && license.hwid !== getHardwareId()) {
                return null;
            }

            return provider;
        } catch {
            // Unreadable/corrupt file — nothing to go on, so it cannot be
            // protected as a perpetual license.
            return null;
        }
    }

    /**
     * Synchronous premium check. Uses in-memory cache for the session after the first call.
     * Performs:
     *   1. HWID binding check (compiled Rust — not patchable from JS)
     *   2. License file decrypt + parse
     * Does NOT make any network calls — use isPremiumAsync() for revocation detection.
     */
    public isPremium(): boolean {
        // No native-module guard here: readStoredLicense() applies it per-provider.
        // A blanket `if (!getHardwareId) return false` also short-circuited ahead of
        // the cache read below, so a just-activated natively_api license reported
        // false for the rest of the session despite storeLicense() setting the cache.

        // Return cached value if available
        if (this.cachedPremium !== null) return this.cachedPremium;

        const license = this.readStoredLicense();
        this.cachedPremium = license !== null;
        return this.cachedPremium;
    }

    /**
     * Synchronous check that also returns plan details.
     */
    public getLicenseDetails(): { isPremium: boolean; plan?: string; provider?: string } {
        // Native-module availability is enforced per-provider by readStoredLicense().
        const license = this.readStoredLicense();
        if (!license) return { isPremium: false };

        let plan = license.plan;

        // Infer plan if not explicitly stored
        if (!plan) {
            if (license.provider === 'gumroad') plan = 'lifetime';
            else if (license.provider === 'dodo') plan = 'lifetime'; // Assuming lifetime for legacy dodo if not specified
        }

        return {
            isPremium: true,
            plan: plan,
            provider: license.provider
        };
    }

    /**
     * Async premium check with server-side revocation detection.
     * Called on app startup (license:check-premium-async IPC handler).
     *
     * Algorithm:
     *   1. Run the sync check (HWID + file) — if no local license, return false immediately
     *   2. For Dodo licenses: call the Dodo validate endpoint (Rust, libuv thread)
     *      - "OK"      → return true (valid)
     *      - "REVOKED" → deactivate locally and return false
     *      - network error → fail-open (return true; don't punish offline users)
     *   3. For Gumroad licenses (or if validateDodoKey not in binary): return sync result
     *
     * Security note: network errors always fail-open to prevent denial-of-service from
     * an attacker cutting the network. Only a definitive "REVOKED" response clears the license.
     */
    public async isPremiumAsync(): Promise<boolean> {
        // Step 1: sync check (HWID + decrypt)
        if (!this.isPremium()) return false;

        // Read the full license payload for provider/key info
        const license = this.readStoredLicense();
        if (!license) {
            this.cachedPremium = false;
            return false;
        }

        // Step 2: server-side check for Dodo licenses
        if (license.provider === 'dodo' && validateDodoKeyNative) {
            let result: string;
            try {
                result = await validateDodoKeyNative(license.key);
            } catch (e: any) {
                console.warn('[LicenseManager] validateDodoKey binding error (fail-open):', e?.message ?? e);
                return true;
            }

            if (result === 'OK') return true;

            if (result === 'REVOKED') {
                console.warn('[LicenseManager] Dodo license REVOKED by server — deactivating locally.');
                this.removeLocalLicenseFile();
                this.cachedPremium = false;
                return false;
            }

            if (result.startsWith('ERR:dodo:network:')) {
                console.log('[LicenseManager] Dodo validate: network error — fail-open.');
                return true;
            }

            console.warn('[LicenseManager] Dodo validate unexpected result — fail-open:', result);
            return true;
        }

        // Step 2b: natively_api subscription license — re-validate against server.
        // The revoke/keep decision is delegated to classifyProVerify (pure, unit-tested).
        // CRITICAL (paying-user safety): we only delete a paid user's local license on a
        // CONFIRMED loss of entitlement (plan downgraded / subscription_inactive / key gone).
        // Transient server states (429 ip_blocked, 403 account_suspended payment-hold, 5xx,
        // network error, unparseable body) FAIL OPEN — they must never downgrade a paying
        // customer. Previously, any non-{ok,has_pro} response deleted the license, so a
        // transient rate-limit or suspension hold would knock a paying user out of Pro.
        if (license.provider === 'natively_api') {
            let status = 0;
            let data: { ok?: boolean; has_pro?: boolean; error?: string } | null = null;
            try {
                const res = await fetch(`${NATIVELY_API_BASE}/v1/pro/verify`, {
                    headers: { 'x-natively-key': license.key },
                    signal: AbortSignal.timeout(8000),
                });
                status = res.status;
                try {
                    data = await res.json() as any;
                } catch {
                    data = null; // unparseable → treated as transient by the policy
                }
            } catch {
                // Network error / timeout → status stays 0 → policy returns 'keep' (fail-open).
                console.log('[LicenseManager] natively_api verify: network error — fail-open.');
                return true;
            }

            const decision = classifyProVerify(status, data);
            if (decision === 'active') return true;
            if (decision === 'revoke') {
                console.warn(
                    `[LicenseManager] Natively API Pro entitlement lost (${data?.error ?? 'plan downgraded'}) — revoking locally.`
                );
                this.removeLocalLicenseFile();
                this.cachedPremium = false;
                return false;
            }
            // 'keep' — transient/ambiguous; do NOT revoke a paying user.
            console.log(
                `[LicenseManager] natively_api verify non-definitive (status ${status}, error ${data?.error ?? 'none'}) — fail-open (no revoke).`
            );
            return true;
        }

        // Step 3: Gumroad or no validate function available — return sync result
        return true;
    }

    /**
     * Remove the local license file without contacting the server.
     * Used internally for server-confirmed revocations (isPremiumAsync).
     *
     * Removes license.enc. storeLicense() also writes license.enc.tmp and unlinks
     * it on failure, but that unlink is best-effort: on Windows the same lock that
     * makes the rename fail (AV scanner, a second instance holding the handle) can
     * make the unlink fail too, leaving a decryptable copy behind. So this deletes
     * the .tmp as well — a revocation must not leave a file that can be renamed
     * back into a working license.
     */
    private removeLocalLicenseFile(): void {
        for (const target of [LICENSE_PATH, LICENSE_PATH + '.tmp']) {
            try {
                if (fs.existsSync(target)) {
                    fs.unlinkSync(target);
                }
            } catch (error: any) {
                console.error('[LicenseManager] Failed to remove license file:', error?.message ?? error);
            }
        }
    }

    /**
     * Deactivate the license on this device.
     *
     * For Dodo licenses: calls the Dodo deactivate API to free the activation slot,
     * enabling the user to re-activate on a new machine. This is atomic from the user's
     * perspective — the local file is ALWAYS removed after the attempt (success or failure),
     * so users are never stuck in an "activated but license not working" state.
     *
     * For Gumroad licenses: removes the local file only (no server call needed).
     *
     * Network failures are non-fatal: the local file is still removed so the user
     * can clear their activation. The Dodo slot may remain occupied until the next
     * server-side sweep, but the user's premium access is correctly revoked locally.
     */
    public async deactivate(): Promise<void> {
        const license = this.readStoredLicense();

        if (license && license.provider === 'dodo' && license.instanceId && deactivateDodoKeyNative) {
            try {
                const result = await deactivateDodoKeyNative(license.key, license.instanceId);
                if (result === 'OK') {
                    console.log('[LicenseManager] Dodo activation slot freed on server.');
                } else if (result.startsWith('ERR:dodo:network:')) {
                    // Network failure — still remove locally (non-fatal)
                    console.warn(
                        '[LicenseManager] Dodo deactivate: network error (removing local file anyway).' +
                        ' Activation slot may persist on server until next sweep.'
                    );
                } else {
                    console.warn('[LicenseManager] Dodo deactivate server error:', result);
                }
            } catch (e: any) {
                // NAPI binding failure — still safe to remove local file
                console.error('[LicenseManager] deactivateDodoKey binding error:', e?.message ?? e);
            }
        } else if (license && license.provider === 'dodo' && !license.instanceId) {
            // Legacy Dodo activation without stored instanceId (pre-fix activations)
            console.warn(
                '[LicenseManager] Dodo deactivate: no instanceId in stored license ' +
                '(activated before instance_id was captured). Local file only removal.'
            );
        } else if (license && license.provider === 'dodo' && !deactivateDodoKeyNative) {
            console.warn(
                '[LicenseManager] deactivateDodoKey not in binary — skipping server deactivation. ' +
                'Rebuild the native module.'
            );
        }

        // Always remove the local file — regardless of server call success/failure
        this.removeLocalLicenseFile();
        this.cachedPremium = false;
        console.log('[LicenseManager] License deactivated locally.');
    }

    /**
     * Get the hardware ID for display to the user (for support purposes).
     */
    public getHardwareId(): string {
        return getHardwareId ? getHardwareId() : 'unavailable';
    }

    /**
     * Clear the in-memory cache (forces re-read from disk on next isPremium call).
     */
    public clearCache(): void {
        this.cachedPremium = null;
    }
}
