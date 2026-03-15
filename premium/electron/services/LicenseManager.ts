/**
 * LicenseManager - Device-locked license verification for premium features.
 * Uses Electron's safeStorage API (OS Keychain) for encrypted persistence,
 * and delegates hardware fingerprinting + Gumroad verification to the
 * compiled Rust native module.
 *
 * ⚠️  PRIVATE FILE — Do NOT commit to the public/OSS repository.
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

// Dynamic import from the Rust native module — graceful fallback if not compiled
let getHardwareId: (() => string) | undefined;
let verifyGumroadKey: ((key: string) => Promise<string>) | undefined;
try {
    const nativeModule = require('natively-audio');
    getHardwareId = nativeModule.getHardwareId;
    verifyGumroadKey = nativeModule.verifyGumroadKey;
} catch {
    console.warn('[LicenseManager] Native module not available — license features disabled.');
}

const LICENSE_PATH = path.join(app.getPath('userData'), 'license.enc');

interface StoredLicense {
    key: string;
    hwid: string;
    activatedAt: string;
}

export class LicenseManager {
    private static instance: LicenseManager;
    private cachedPremium: boolean | null = null;

    private constructor() { }

    public static getInstance(): LicenseManager {
        if (!LicenseManager.instance) {
            LicenseManager.instance = new LicenseManager();
        }
        return LicenseManager.instance;
    }

    /**
     * Activate a Gumroad license key.
     * 1. Verifies with Gumroad via compiled Rust
     * 2. Encrypts { key, hwid } using OS Keychain
     * 3. Writes to license.enc
     */
    public async activateLicense(key: string): Promise<{ success: boolean; error?: string }> {
        if (!verifyGumroadKey || !getHardwareId) {
            return { success: false, error: 'Premium features not available in this build.' };
        }

        try {
            const trimmedKey = key.trim();
            if (!trimmedKey) {
                return { success: false, error: 'License key cannot be empty.' };
            }

            // Verify with Gumroad through compiled Rust (machine code)
            const result = await verifyGumroadKey(trimmedKey);
            console.log('[LicenseManager] Gumroad verify result:', result);
            if (result !== 'OK') {
                const errMsg = result.startsWith('ERR:gumroad:')
                    ? result.replace('ERR:gumroad:', '')
                    : 'Verification failed: ' + result;
                return { success: false, error: errMsg };
            }

            // Build the license payload
            const hwid = getHardwareId();
            const payload: StoredLicense = {
                key: trimmedKey,
                hwid,
                activatedAt: new Date().toISOString(),
            };

            // Encrypt with OS-level keychain (macOS Keychain / Windows Credential Vault)
            if (!safeStorage.isEncryptionAvailable()) {
                return { success: false, error: 'OS encryption not available. Cannot store license securely.' };
            }

            const encrypted = safeStorage.encryptString(JSON.stringify(payload));
            fs.writeFileSync(LICENSE_PATH, encrypted);

            // Update cached state
            this.cachedPremium = true;

            console.log('[LicenseManager] License activated successfully.');
            return { success: true };
        } catch (error: any) {
            console.error('[LicenseManager] Activation error:', error);
            return { success: false, error: error.message || 'Activation failed.' };
        }
    }

    /**
     * Check if the current device has an active premium license.
     * Uses in-memory cache for the session after the first check.
     */
    public isPremium(): boolean {
        // Native module not available — premium is impossible
        if (!getHardwareId) {
            return false;
        }

        // Return cached value if available
        if (this.cachedPremium !== null) {
            return this.cachedPremium;
        }

        try {
            if (!fs.existsSync(LICENSE_PATH)) {
                this.cachedPremium = false;
                return false;
            }

            if (!safeStorage.isEncryptionAvailable()) {
                this.cachedPremium = false;
                return false;
            }

            const encrypted = fs.readFileSync(LICENSE_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            const license: StoredLicense = JSON.parse(decrypted);

            // Validate the hardware ID matches this machine
            const currentHwid = getHardwareId();
            if (license.hwid !== currentHwid) {
                console.warn('[LicenseManager] HWID mismatch — license belongs to a different device.');
                this.cachedPremium = false;
                return false;
            }

            this.cachedPremium = true;
            return true;
        } catch (error: any) {
            console.error('[LicenseManager] Premium check failed:', error.message);
            this.cachedPremium = false;
            return false;
        }
    }

    /**
     * Deactivate the license on this device (removes license.enc).
     */
    public deactivate(): void {
        try {
            if (fs.existsSync(LICENSE_PATH)) {
                fs.unlinkSync(LICENSE_PATH);
            }
            this.cachedPremium = false;
            console.log('[LicenseManager] License deactivated.');
        } catch (error: any) {
            console.error('[LicenseManager] Deactivation error:', error);
        }
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
