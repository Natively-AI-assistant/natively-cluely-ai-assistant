// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { loadNativeModule } from "../../../electron/audio/nativeModuleLoader";
import { classifyProVerify } from "./licenseVerifyPolicy";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var import_electron2 = require("electron");
var import_fs2 = __toESM(require("fs"));
var import_path3 = __toESM(require("path"));
// premium/electron/services/LicenseManager.ts
var _nativeMod = loadNativeModule();
var getHardwareId = _nativeMod?.getHardwareId ?? void 0;
var verifyGumroadKey = _nativeMod?.verifyGumroadKey ?? void 0;
var verifyDodoKeyNative = _nativeMod?.verifyDodoKey ?? void 0;
var validateDodoKeyNative = _nativeMod?.validateDodoKey ?? void 0;
var deactivateDodoKeyNative = _nativeMod?.deactivateDodoKey ?? void 0;
if (!_nativeMod) {
    console.warn("[LicenseManager] Native module not available \u2014 license features disabled.");
}
else {
    if (!verifyDodoKeyNative) {
        console.warn("[LicenseManager] verifyDodoKey not available in binary \u2014 Dodo Payments activation disabled. Rebuild the native module.");
    }
    if (!validateDodoKeyNative) {
        console.warn("[LicenseManager] validateDodoKey not available in binary \u2014 startup revocation check disabled. Rebuild the native module.");
    }
    if (!deactivateDodoKeyNative) {
        console.warn("[LicenseManager] deactivateDodoKey not available in binary \u2014 server-side deactivation disabled. Rebuild the native module.");
    }
}
var LICENSE_PATH = import_path3.default.join(import_electron2.app.getPath("userData"), "license.enc");
var NATIVELY_API_BASE = (process.env.NATIVELY_API_URL || "https://api.natively.software").replace(/\/+$/, "");
function describeKeyRejection(code, data) {
    const serverMessage = typeof data?.message === "string" ? data.message.trim() : "";
    if (serverMessage)
        return serverMessage;
    switch (code) {
        case "subscription_inactive":
            return "Your Natively subscription is not active. Renew at natively.software/api";
        case "account_suspended":
            return "This account is suspended. Contact support@natively.software";
        case "key_not_found":
            return "This Natively API key was not recognised. Check it at natively.software/api";
        case "invalid_key_format":
            return "That does not look like a Natively API key \u2014 it should start with natively_sk_.";
        default: {
            const retry = Number(data?.retry_after);
            if (Number.isFinite(retry) && retry > 0) {
                return `Too many attempts. Try again in ${Math.ceil(retry)}s.`;
            }
            return `Natively did not accept this API key (${code}).`;
        }
    }
}
var LicenseManager = class _LicenseManager {
    static instance;
    cachedPremium = null;
    /**
     * Mutex: prevents two concurrent activateLicense() calls from creating a race condition
     * where both succeed the network check but one overwrites the other's stored file.
     */
    activationInFlight = false;
    constructor() {
    }
    static getInstance() {
        const g = globalThis;
        if (!g.__nativelyLicenseManagerV1__) {
            g.__nativelyLicenseManagerV1__ = _LicenseManager.instance ?? new _LicenseManager();
        }
        _LicenseManager.instance = g.__nativelyLicenseManagerV1__;
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
    async activateLicense(key) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
            return { success: false, error: "License key cannot be empty." };
        }
        if (trimmedKey.startsWith("natively_sk_")) {
            console.log("[LicenseManager] activateLicense: Natively API key detected, delegating to activateWithApiKey...");
            const apiResult = await this.activateWithApiKey(trimmedKey);
            if (apiResult.success) {
                return { success: true };
            }
            if (apiResult.skipped && !apiResult.error) {
                console.log("[LicenseManager] activateLicense: perpetual license already active \u2014 key not applied.");
                return {
                    success: false,
                    error: "Pro is already active from your lifetime license, so this key was not applied. Save it under Natively Key if you want it used for API access."
                };
            }
            return { success: false, error: apiResult.error || "Failed to activate with API key." };
        }
        if (!getHardwareId) {
            return { success: false, error: "Premium features not available in this build." };
        }
        if (this.activationInFlight) {
            return { success: false, error: "Activation already in progress. Please wait." };
        }
        this.activationInFlight = true;
        this.cachedPremium = null;
        try {
            if (verifyDodoKeyNative) {
                const deviceLabel = `Natively Pro (${getHardwareId().slice(0, 32)})`;
                let dodoResult;
                try {
                    dodoResult = await verifyDodoKeyNative(trimmedKey, deviceLabel);
                }
                catch (e) {
                    dodoResult = `ERR:dodo:${e?.message ?? "native binding error"}`;
                }
                if (dodoResult.startsWith("OK:")) {
                    const instanceId = dodoResult.slice(3);
                    console.log("[LicenseManager] Dodo activation succeeded.");
                    return await this.storeLicense(trimmedKey, "dodo", instanceId, void 0, { replacePerpetual: true });
                }
                if (dodoResult.startsWith("ERR:dodo:duplicate")) {
                    const existingId = dodoResult.startsWith("ERR:dodo:duplicate:") ? dodoResult.slice("ERR:dodo:duplicate:".length) : "";
                    console.log("[LicenseManager] Dodo 409 duplicate activation detected.");
                    if (existingId) {
                        return await this.storeLicense(trimmedKey, "dodo", existingId, void 0, { replacePerpetual: true });
                    }
                    return await this.storeLicense(trimmedKey, "dodo", void 0, void 0, { replacePerpetual: true });
                }
                if (dodoResult === "ERR:dodo:limit_reached") {
                    console.log("[LicenseManager] Dodo 422 activation limit reached \u2014 validating key ownership...");
                    if (validateDodoKeyNative) {
                        let validateResult;
                        try {
                            validateResult = await validateDodoKeyNative(trimmedKey);
                        }
                        catch (e) {
                            validateResult = `ERR:dodo:${e?.message ?? "binding error"}`;
                        }
                        if (validateResult === "OK") {
                            console.log("[LicenseManager] Dodo validate confirmed key is valid \u2014 storing without new slot.");
                            return await this.storeLicense(trimmedKey, "dodo", void 0, void 0, { replacePerpetual: true });
                        }
                        if (validateResult === "REVOKED") {
                            return { success: false, error: "This license key has been revoked." };
                        }
                    }
                    console.warn("[LicenseManager] Dodo 422: could not validate key \u2014 storing optimistically.");
                    const stored = await this.storeLicense(trimmedKey, "dodo", void 0);
                    if (stored.skipped && !stored.error) {
                        return {
                            success: false,
                            error: "Pro is already active from the lifetime license on this device, so this key was not applied."
                        };
                    }
                    return stored;
                }
                const isDodoNetworkErr = dodoResult.startsWith("ERR:dodo:network:");
                if (!isDodoNetworkErr) {
                    console.log("[LicenseManager] Dodo rejected key (non-network) \u2014 trying Gumroad fallback...");
                }
                else {
                    console.log("[LicenseManager] Dodo network error \u2014 trying Gumroad fallback...");
                }
            }
            if (verifyGumroadKey) {
                let gumroadResult;
                try {
                    gumroadResult = await verifyGumroadKey(trimmedKey);
                }
                catch (e) {
                    gumroadResult = `ERR:gumroad:${e?.message ?? "native binding error"}`;
                }
                if (gumroadResult === "OK") {
                    return await this.storeLicense(trimmedKey, "gumroad", void 0, void 0, { replacePerpetual: true });
                }
                const gumroadErr = gumroadResult.startsWith("ERR:gumroad:") ? gumroadResult.replace("ERR:gumroad:", "") : "License key not recognized.";
                return { success: false, error: gumroadErr };
            }
            return { success: false, error: "License verification unavailable in this build." };
        }
        catch (error) {
            console.error("[LicenseManager] Activation error:", error?.message ?? error);
            return { success: false, error: error?.message || "Activation failed." };
        }
        finally {
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
    async activateWithApiKey(apiKey) {
        const guard = this.perpetualLicenseGuard();
        if (guard)
            return guard;
        try {
            const res = await fetch(`${NATIVELY_API_BASE}/v1/pro/verify`, {
                headers: { "x-natively-key": apiKey },
                signal: AbortSignal.timeout(8e3)
            });
            const data = await res.json().catch(() => ({}));
            const httpOk = res.status >= 200 && res.status < 300;
            if (res.status >= 500) {
                console.warn(`[LicenseManager] activateWithApiKey: /v1/pro/verify returned ${res.status} \u2014 treating as transient`);
                return { success: false, status: res.status, error: "Natively could not verify your key right now. Please try again." };
            }
            if (!httpOk || data?.ok === false) {
                const code = typeof data?.error === "string" ? data.error : `http_${res.status}`;
                console.warn(`[LicenseManager] activateWithApiKey: key REFUSED by server \u2014 status=${res.status} error=${code}`);
                return {
                    success: false,
                    keyRejected: true,
                    code,
                    status: res.status,
                    error: describeKeyRejection(code, data)
                };
            }
            if (data?.ok !== true) {
                console.warn("[LicenseManager] activateWithApiKey: unexpected /v1/pro/verify body on a 2xx \u2014 treating as transient");
                return { success: false, status: res.status, error: "Natively could not verify your key right now. Please try again." };
            }
            if (!data.has_pro) {
                console.log("[LicenseManager] activateWithApiKey: plan has no Pro \u2014", data.plan);
                return { success: false, error: "Your plan does not include Natively Pro." };
            }
            return await this.storeLicense(apiKey, "natively_api", void 0, data.plan);
        }
        catch (e) {
            console.error("[LicenseManager] activateWithApiKey network error:", e?.message ?? e);
            return { success: false, error: "Could not reach server. Please try again." };
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
    perpetualLicenseGuard() {
        const existingProvider = this.peekStoredProvider();
        if (!existingProvider || existingProvider === "natively_api")
            return null;
        if (getHardwareId) {
            console.log("[LicenseManager] existing Gumroad/Dodo license is active \u2014 refusing to replace it.");
            return { success: false, skipped: true };
        }
        console.warn("[LicenseManager] stored Gumroad/Dodo license cannot be verified (native module unavailable) \u2014 refusing to overwrite it. Pro is inactive on this device.");
        return {
            success: false,
            skipped: true,
            // Caller-neutral wording on purpose: this same string is surfaced by
            // activateLicense() (license box, where nothing was saved) and logged by
            // the set-natively-api-key handler (where the key WAS persisted). It must
            // not assert anything about the key's fate.
            error: "A lifetime license is stored on this device but cannot be verified \u2014 the hardware verification component failed to load, so Pro cannot be activated. Reinstall the app or contact support."
        };
    }
    /**
     * Store the verified license securely using atomic write (tmp → rename).
     *
     * @param key        The raw license key (never logged)
     * @param provider   'dodo', 'gumroad', or 'natively_api'
     * @param instanceId Dodo activation instance ID ("lki_xxx"); undefined for Gumroad/natively_api
     */
    async storeLicense(key, provider, instanceId, plan, options = {}) {
        if (provider !== "natively_api" && !getHardwareId) {
            return { success: false, error: "Hardware ID unavailable." };
        }
        if (!options.replacePerpetual) {
            const guard = this.perpetualLicenseGuard();
            if (guard)
                return guard;
        }
        try {
            if (!import_electron2.safeStorage.isEncryptionAvailable()) {
                return { success: false, error: "OS encryption not available." };
            }
            const hwid = provider === "natively_api" ? "" : getHardwareId ? getHardwareId() : "";
            const payload = {
                key,
                hwid,
                activatedAt: ( /* @__PURE__ */new Date()).toISOString(),
                provider,
                ...instanceId ? { instanceId } : {},
                ...plan ? { plan } : {}
            };
            const encrypted = import_electron2.safeStorage.encryptString(JSON.stringify(payload));
            const tmpPath = LICENSE_PATH + ".tmp";
            import_fs2.default.writeFileSync(tmpPath, encrypted);
            import_fs2.default.renameSync(tmpPath, LICENSE_PATH);
            this.cachedPremium = true;
            console.log(`[LicenseManager] ${provider} license activated.` + (instanceId ? " (instance_id stored)" : " (no instance_id)"));
            return { success: true };
        }
        catch (error) {
            console.error("[LicenseManager] storeLicense error:", error?.message ?? error);
            try {
                if (import_fs2.default.existsSync(LICENSE_PATH + ".tmp"))
                    import_fs2.default.unlinkSync(LICENSE_PATH + ".tmp");
            }
            catch {
            }
            return { success: false, error: "Failed to store license securely." };
        }
    }
    /**
     * Read and validate the stored license from disk.
     * Returns null on any failure (file not found, decryption error, HWID mismatch).
     * Never throws.
     */
    readStoredLicense() {
        try {
            if (!import_fs2.default.existsSync(LICENSE_PATH))
                return null;
            if (!import_electron2.safeStorage.isEncryptionAvailable())
                return null;
            const encrypted = import_fs2.default.readFileSync(LICENSE_PATH);
            const decrypted = import_electron2.safeStorage.decryptString(encrypted);
            const license = JSON.parse(decrypted);
            if (license.provider !== "natively_api") {
                if (!getHardwareId)
                    return null;
                const currentHwid = getHardwareId();
                if (license.hwid !== currentHwid) {
                    console.warn("[LicenseManager] HWID mismatch \u2014 license belongs to a different device.");
                    return null;
                }
            }
            return license;
        }
        catch (error) {
            console.error("[LicenseManager] readStoredLicense error:", error?.message ?? error);
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
    peekStoredProvider() {
        try {
            if (!import_fs2.default.existsSync(LICENSE_PATH))
                return null;
            if (!import_electron2.safeStorage.isEncryptionAvailable())
                return null;
            const decrypted = import_electron2.safeStorage.decryptString(import_fs2.default.readFileSync(LICENSE_PATH));
            const license = JSON.parse(decrypted);
            const provider = license.provider ?? "legacy";
            if (provider !== "natively_api" && getHardwareId && license.hwid !== getHardwareId()) {
                return null;
            }
            return provider;
        }
        catch {
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
    isPremium() {
        if (this.cachedPremium !== null)
            return this.cachedPremium;
        const license = this.readStoredLicense();
        this.cachedPremium = license !== null;
        return this.cachedPremium;
    }
    /**
     * Synchronous check that also returns plan details.
     */
    getLicenseDetails() {
        const license = this.readStoredLicense();
        if (!license)
            return { isPremium: false };
        let plan = license.plan;
        if (!plan) {
            if (license.provider === "gumroad")
                plan = "lifetime";
            else if (license.provider === "dodo")
                plan = "lifetime";
        }
        return {
            isPremium: true,
            plan,
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
    async isPremiumAsync() {
        if (!this.isPremium())
            return false;
        const license = this.readStoredLicense();
        if (!license) {
            this.cachedPremium = false;
            return false;
        }
        if (license.provider === "dodo" && validateDodoKeyNative) {
            let result;
            try {
                result = await validateDodoKeyNative(license.key);
            }
            catch (e) {
                console.warn("[LicenseManager] validateDodoKey binding error (fail-open):", e?.message ?? e);
                return true;
            }
            if (result === "OK")
                return true;
            if (result === "REVOKED") {
                console.warn("[LicenseManager] Dodo license REVOKED by server \u2014 deactivating locally.");
                this.removeLocalLicenseFile();
                this.cachedPremium = false;
                return false;
            }
            if (result.startsWith("ERR:dodo:network:")) {
                console.log("[LicenseManager] Dodo validate: network error \u2014 fail-open.");
                return true;
            }
            console.warn("[LicenseManager] Dodo validate unexpected result \u2014 fail-open:", result);
            return true;
        }
        if (license.provider === "natively_api") {
            let status = 0;
            let data = null;
            try {
                const res = await fetch(`${NATIVELY_API_BASE}/v1/pro/verify`, {
                    headers: { "x-natively-key": license.key },
                    signal: AbortSignal.timeout(8e3)
                });
                status = res.status;
                try {
                    data = await res.json();
                }
                catch {
                    data = null;
                }
            }
            catch {
                console.log("[LicenseManager] natively_api verify: network error \u2014 fail-open.");
                return true;
            }
            const decision = classifyProVerify(status, data);
            if (decision === "active")
                return true;
            if (decision === "revoke") {
                console.warn(`[LicenseManager] Natively API Pro entitlement lost (${data?.error ?? "plan downgraded"}) \u2014 revoking locally.`);
                this.removeLocalLicenseFile();
                this.cachedPremium = false;
                return false;
            }
            console.log(`[LicenseManager] natively_api verify non-definitive (status ${status}, error ${data?.error ?? "none"}) \u2014 fail-open (no revoke).`);
            return true;
        }
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
    removeLocalLicenseFile() {
        for (const target of [LICENSE_PATH, LICENSE_PATH + ".tmp"]) {
            try {
                if (import_fs2.default.existsSync(target)) {
                    import_fs2.default.unlinkSync(target);
                }
            }
            catch (error) {
                console.error("[LicenseManager] Failed to remove license file:", error?.message ?? error);
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
    async deactivate() {
        const license = this.readStoredLicense();
        if (license && license.provider === "dodo" && license.instanceId && deactivateDodoKeyNative) {
            try {
                const result = await deactivateDodoKeyNative(license.key, license.instanceId);
                if (result === "OK") {
                    console.log("[LicenseManager] Dodo activation slot freed on server.");
                }
                else if (result.startsWith("ERR:dodo:network:")) {
                    console.warn("[LicenseManager] Dodo deactivate: network error (removing local file anyway). Activation slot may persist on server until next sweep.");
                }
                else {
                    console.warn("[LicenseManager] Dodo deactivate server error:", result);
                }
            }
            catch (e) {
                console.error("[LicenseManager] deactivateDodoKey binding error:", e?.message ?? e);
            }
        }
        else if (license && license.provider === "dodo" && !license.instanceId) {
            console.warn("[LicenseManager] Dodo deactivate: no instanceId in stored license (activated before instance_id was captured). Local file only removal.");
        }
        else if (license && license.provider === "dodo" && !deactivateDodoKeyNative) {
            console.warn("[LicenseManager] deactivateDodoKey not in binary \u2014 skipping server deactivation. Rebuild the native module.");
        }
        this.removeLocalLicenseFile();
        this.cachedPremium = false;
        console.log("[LicenseManager] License deactivated locally.");
    }
    /**
     * Get the hardware ID for display to the user (for support purposes).
     */
    getHardwareId() {
        return getHardwareId ? getHardwareId() : "unavailable";
    }
    /**
     * Clear the in-memory cache (forces re-read from disk on next isPremium call).
     */
    clearCache() {
        this.cachedPremium = null;
    }
};
export { LicenseManager };
